import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import axios from "axios";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { AuthorizeDto, TokenDto, RevokeDto } from "./dto";
import { CallbackDto } from "./dto/callback.dto";

/**
 * OAuth2 Provider Service (RFC 6749, RFC 7009, RFC 7636 PKCE)
 *
 * Implements authorization code flow with optional PKCE support for public clients.
 * Generates opaque access/refresh tokens (not JWTs) for third-party API access.
 * Also handles the native Google OAuth PKCE flow for mobile/desktop apps.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly allowedNativeRedirectUris = new Set([
    "soundclone://oauth/callback",
    "http://127.0.0.1:8080/oauth/callback",
  ]);
  private readonly AUTHORIZATION_CODE_TTL_SECONDS = 60; // 1 minute
  private readonly ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
  private readonly REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

  // In-memory store for pending native OAuth codes.
  // Maps internal code → { tokens, user, codeChallenge, expiresAt }
  private readonly pendingNativeCodes = new Map<
    string,
    {
      accessToken: string;
      refreshToken: string;
      user: any;
      scope: string;
      codeChallenge: string;
      expiresAt: number;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  // ---------------------------------------------------------------------------
  // Native PKCE Authorization Redirect
  // ---------------------------------------------------------------------------

  isNativeClient(clientId: string): boolean {
    const normalized = (clientId ?? "").trim().toLowerCase();
    return normalized === "soundclone-native-app";
  }

  buildGoogleAuthorizeUrl(query: AuthorizeDto): string {
    const googleClientId =
      this.config.get<string>("google.clientId") || "fallback_google_client_id";

    // Use the backend's own HTTPS callback URL for Google — NOT the native URI.
    // Google only accepts redirect URIs registered in Google Cloud Console.
    // The native redirect URI is stored in the state param and used later.
    const backendCallbackUrl = this.getNativeOAuthCallbackUrl();

    // Encode everything the backend callback will need into Google's state param:
    // - nativeRedirectUri: where to redirect the app after Google auth
    // - codeChallenge/Method: for PKCE validation when the app exchanges the code
    // - originalState: the app's anti-CSRF state to return unchanged
    const statePayload = Buffer.from(
      JSON.stringify({
        nativeRedirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method || "S256",
        originalState: query.state,
      }),
    ).toString("base64url");

    const params = new URLSearchParams();
    params.set("client_id", googleClientId);
    params.set("redirect_uri", backendCallbackUrl);
    params.set("response_type", "code");
    params.set("scope", "openid email profile");
    params.set("state", statePayload);
    params.set("access_type", "offline");
    params.set("include_granted_scopes", "true");
    params.set("prompt", "consent");

    // Note: PKCE code_challenge is NOT sent to Google — it's between the app and our backend.
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Uses GOOGLE_CALLBACK_URL and maps it to the OAuth callback route.
   * This URL must be registered in Google Cloud Console as an authorized redirect URI.
   */
  private getNativeOAuthCallbackUrl(): string {
    const googleCallbackUrl =
      this.config.get<string>("GOOGLE_CALLBACK_URL") ??
      this.config.get<string>("google.callbackUrl");

    if (!googleCallbackUrl) {
      throw new InternalServerErrorException(
        "GOOGLE_CALLBACK_URL is not configured.",
      );
    }

    return googleCallbackUrl.replace(
      "/auth/google/callback",
      "/oauth/google/callback",
    );
  }

  // ---------------------------------------------------------------------------
  // Native OAuth: Google redirects here → exchange code → redirect to app
  // ---------------------------------------------------------------------------

  async processGoogleNativeCallback(
    googleCode: string,
    encodedState: string,
    ip: string,
    userAgent: string,
  ): Promise<{ redirectUrl: string }> {
    // Decode the state we packed in buildGoogleAuthorizeUrl
    let state: {
      nativeRedirectUri: string;
      codeChallenge: string;
      codeChallengeMethod: string;
      originalState: string;
    };
    try {
      state = JSON.parse(
        Buffer.from(encodedState, "base64url").toString("utf8"),
      );
    } catch {
      throw new BadRequestException("Invalid state parameter.");
    }

    if (!this.allowedNativeRedirectUris.has(state.nativeRedirectUri)) {
      throw new BadRequestException("invalid_redirect_uri");
    }

    // Exchange Google's authorization code for tokens
    const googleClientId = this.config.get<string>("google.clientId") || "";
    const googleClientSecret =
      this.config.get<string>("google.clientSecret") || "";
    const backendCallbackUrl = this.getNativeOAuthCallbackUrl();

    const tokenParams = new URLSearchParams();
    tokenParams.set("grant_type", "authorization_code");
    tokenParams.set("client_id", googleClientId);
    tokenParams.set("client_secret", googleClientSecret);
    tokenParams.set("code", googleCode);
    tokenParams.set("redirect_uri", backendCallbackUrl);

    let idToken: string;
    try {
      const response = await axios.post(
        "https://oauth2.googleapis.com/token",
        tokenParams.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 10_000,
        },
      );
      idToken = response.data?.id_token;
    } catch (err) {
      this.logger.error("Google token exchange failed", err);
      throw new BadRequestException(
        "Failed to exchange authorization code with Google.",
      );
    }

    if (!idToken) {
      throw new BadRequestException(
        "Google token response did not include id_token.",
      );
    }

    const payload = this.decodeIdTokenPayload(idToken);
    const email = String(payload.email || "").toLowerCase();
    const displayName = String(payload.name || "Google User");
    const googleId = String(payload.sub || "");
    const avatarUrl = payload.picture ? String(payload.picture) : null;

    if (!email || !googleId) {
      throw new BadRequestException(
        "Google id_token is missing required fields.",
      );
    }

    // Create local session via the existing auth flow
    const tokens = await this.authService.googleLogin(
      { googleId, email, displayName, avatarUrl },
      ip,
      userAgent,
    );

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    // Generate a short-lived internal code for the app to exchange
    const internalCode = randomBytes(32).toString("base64url");

    // Purge any expired codes before adding a new one
    this.purgeExpiredCodes();

    this.pendingNativeCodes.set(internalCode, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: user
        ? {
            id: user.id,
            email: user.email,
            display_name: user.profile?.displayName ?? displayName,
            handle: user.profile?.handle ?? "",
            avatar_url: user.profile?.avatarUrl ?? avatarUrl,
            is_verified: user.isVerified,
          }
        : { email, display_name: displayName, avatar_url: avatarUrl },
      scope: "read write",
      codeChallenge: state.codeChallenge,
      expiresAt: Date.now() + this.AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    });

    // Redirect the browser (native WebView) to the app's custom scheme
    const redirectUrl = new URL(state.nativeRedirectUri);
    redirectUrl.searchParams.set("code", internalCode);
    redirectUrl.searchParams.set("state", state.originalState);

    return { redirectUrl: redirectUrl.toString() };
  }

  // ---------------------------------------------------------------------------
  // Native OAuth: App exchanges internal code for cookies
  // ---------------------------------------------------------------------------

  async handleCallback(dto: CallbackDto, _ip: string, _userAgent: string) {
    // Look up the pending internal code
    const pending = this.pendingNativeCodes.get(dto.code);

    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingNativeCodes.delete(dto.code);
      throw new BadRequestException(
        "Authorization code is invalid or expired.",
      );
    }

    // Validate PKCE: SHA256(code_verifier) must match stored code_challenge
    const challengeFromVerifier = createHash("sha256")
      .update(dto.code_verifier)
      .digest("base64url");

    if (!this.timingSafeCompare(challengeFromVerifier, pending.codeChallenge)) {
      this.pendingNativeCodes.delete(dto.code);
      throw new BadRequestException("invalid_pkce");
    }

    // Consume code (single use)
    this.pendingNativeCodes.delete(dto.code);

    return {
      accessToken: pending.accessToken,
      refreshToken: pending.refreshToken,
      user: pending.user,
    };
  }

  private purgeExpiredCodes(): void {
    const now = Date.now();
    for (const [code, data] of this.pendingNativeCodes) {
      if (data.expiresAt < now) {
        this.pendingNativeCodes.delete(code);
      }
    }
  }

  private decodeIdTokenPayload(idToken: string): Record<string, any> {
    const parts = idToken.split(".");
    if (parts.length < 2) {
      throw new BadRequestException("Invalid id_token format.");
    }

    try {
      const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
      return JSON.parse(payload);
    } catch {
      throw new BadRequestException("Unable to decode id_token payload.");
    }
  }

  private resolveAllowedNativeRedirectUri(
    redirectUri: string | undefined,
    fallback: string,
  ): string {
    const normalized = (redirectUri ?? "").trim();
    if (normalized && this.allowedNativeRedirectUris.has(normalized)) {
      return normalized;
    }

    if (normalized) {
      throw new BadRequestException("invalid_redirect_uri");
    }

    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Utility: Hash tokens for secure storage
  // ---------------------------------------------------------------------------

  /**
   * Hash a token using SHA-256 before storing in database.
   * This prevents database breach attackers from getting raw tokens.
   */
  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Generate a cryptographically secure random token.
   * 32 bytes = 256 bits, base64-encoded.
   */
  private generateRandomToken(bytes: number = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  /**
   * Constant-time comparison to prevent timing attacks.
   */
  private timingSafeCompare(a: string, b: string): boolean {
    try {
      return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Client Authentication
  // ---------------------------------------------------------------------------

  /**
   * Validate client credentials (client_id + client_secret).
   * Returns the client if valid; throws UnauthorizedException otherwise.
   * Uses timing-safe comparison to prevent secret enumeration attacks.
   */
  async validateClientCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<any> {
    const client = await this.getActiveClient(clientId);

    if (!clientSecret) {
      throw new UnauthorizedException("Invalid client credentials");
    }

    // Constant-time comparison of secrets
    const secretHash = this.hashToken(clientSecret);
    if (!this.timingSafeCompare(secretHash, client.clientSecretHash)) {
      throw new UnauthorizedException("Invalid client credentials");
    }

    return client;
  }

  /**
   * Resolve an active OAuth client by client_id.
   */
  private async getActiveClient(clientId: string): Promise<any> {
    const client = await this.db.apiClient.findUnique({
      where: { clientId },
    });

    if (!client || !client.isActive) {
      throw new UnauthorizedException("Invalid client credentials");
    }

    return client;
  }

  // ---------------------------------------------------------------------------
  // Authorization Code Flow: Authorize Endpoint
  // ---------------------------------------------------------------------------

  /**
   * Validate authorization request and generate authorization code.
   * Called by GET /api/v1/oauth/authorize (user approves the authorization on front-end).
   *
   * Steps:
   * 1. Validate client exists, is active, and redirect_uri matches registered URI
   * 2. Validate scopes are allowed by the client
   * 3. Generate authorization code (one-time use, 60-second TTL)
   * 4. Store code in database with optional PKCE challenge
   * 5. Return code + original state to the caller (for redirect)
   *
   * @returns { code, state } to include in redirect: {redirect_uri}?code={code}&state={state}
   */
  async generateAuthorizationCode(
    clientId: string,
    userId: string,
    redirectUri: string,
    scope: string,
    state: string,
    codeChallengeOpt?: { challenge: string; method: string },
  ): Promise<{ code: string; state: string }> {
    // Validate client and redirect URI
    const client = await this.db.apiClient.findUnique({
      where: { clientId },
    });

    if (!client || !client.isActive) {
      throw new BadRequestException("invalid_client");
    }

    // Check redirect URI is registered
    if (!client.redirectUris.some((uri: string) => uri === redirectUri)) {
      throw new BadRequestException("invalid_redirect_uri");
    }

    // Validate scopes are within allowed for this client
    const requestedScopes = scope.split(" ").filter((s: string) => s);
    const validScopes = requestedScopes.every((s: string) =>
      client.allowedScopes.includes(s),
    );
    if (!validScopes) {
      throw new BadRequestException("invalid_scope");
    }

    // Generate authorization code (one-time use, expires in 60 seconds)
    const rawCode = this.generateRandomToken(32);
    const codeHash = this.hashToken(rawCode);

    const expiresAt = new Date(
      Date.now() + this.AUTHORIZATION_CODE_TTL_SECONDS * 1000,
    );

    // Store in database
    try {
      await this.db.apiAuthCode.create({
        data: {
          clientId: client.id,
          userId,
          codeHash,
          scope,
          redirectUri,
          codeChallenge: codeChallengeOpt?.challenge,
          codeChallengeMethod: codeChallengeOpt?.method,
          expiresAt,
        },
      });
    } catch (error) {
      throw new BadRequestException("Failed to generate authorization code");
    }

    // Return the raw code and state to the frontend (for redirect)
    return { code: rawCode, state };
  }

  // ---------------------------------------------------------------------------
  // Authorization Code Flow: Token Endpoint
  // ---------------------------------------------------------------------------

  /**
   * Exchange authorization code for access/refresh tokens.
   * Called by POST /api/v1/oauth/token with grant_type=authorization_code.
   *
   * Steps:
   * 1. Validate client credentials
   * 2. Find authorization code by hash, verify not expired or consumed
   * 3. If PKCE was used, validate code_verifier matches code_challenge
   * 4. Mark code as consumed (one-time use enforcement)
   * 5. Generate access token (1 hour TTL) and refresh token (30 day TTL)
   * 6. Store refresh token hash in database
   * 7. Return both tokens to the third-party app
   */
  async exchangeAuthorizationCode(
    clientId: string,
    clientSecret: string | undefined,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{
    access_token: string;
    token_type: "Bearer";
    refresh_token: string;
    expires_in: number;
    scope: string;
    user?: any;
  }> {
    if (
      !clientId ||
      !clientId.trim() ||
      !code ||
      !code.trim() ||
      !redirectUri ||
      !redirectUri.trim()
    ) {
      throw new BadRequestException("invalid_request");
    }

    this.purgeExpiredCodes();

    const isNativeClient = this.isNativeClient(clientId);
    const pendingNativeCode = this.pendingNativeCodes.get(code);

    // Native app flow: consume in-memory authorization code minted by processGoogleNativeCallback.
    if (pendingNativeCode) {
      if (!isNativeClient) {
        throw new UnauthorizedException("Invalid client credentials");
      }

      if (pendingNativeCode.expiresAt < Date.now()) {
        this.pendingNativeCodes.delete(code);
        throw new BadRequestException("invalid_grant");
      }

      if (!codeVerifier || !codeVerifier.trim()) {
        throw new BadRequestException("invalid_request");
      }

      const calculatedChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      if (
        !pendingNativeCode.codeChallenge ||
        !this.timingSafeCompare(
          calculatedChallenge,
          pendingNativeCode.codeChallenge,
        )
      ) {
        this.pendingNativeCodes.delete(code);
        throw new BadRequestException("invalid_pkce");
      }

      this.pendingNativeCodes.delete(code);

      return {
        access_token: pendingNativeCode.accessToken,
        token_type: "Bearer" as const,
        refresh_token: pendingNativeCode.refreshToken,
        expires_in: this.ACCESS_TOKEN_TTL_SECONDS,
        scope: pendingNativeCode.scope || "read write",
        user: pendingNativeCode.user,
      };
    }

    // 1. Validate client authentication.
    // Public clients are allowed only when PKCE is present.
    const isPublicPkceRequest =
      !clientSecret && !!codeVerifier && !isNativeClient;
    if (!clientSecret && !isPublicPkceRequest) {
      throw new UnauthorizedException("Invalid client credentials");
    }

    const client = isPublicPkceRequest
      ? await this.getActiveClient(clientId)
      : await this.validateClientCredentials(clientId, clientSecret as string);

    // 2. Find authorization code
    const codeHash = this.hashToken(code);
    const authCode = await this.db.apiAuthCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });

    if (!authCode || !client || authCode.clientId !== client.id) {
      throw new BadRequestException("invalid_grant");
    }

    if (authCode.consumedAt) {
      throw new BadRequestException("invalid_grant"); // Code already used
    }

    if (authCode.expiresAt < new Date()) {
      throw new BadRequestException("invalid_grant"); // Code expired
    }

    if (authCode.redirectUri !== redirectUri) {
      throw new BadRequestException("invalid_grant"); // redirect_uri mismatch
    }

    // Public clients must use PKCE-protected codes.
    if (isPublicPkceRequest && !authCode.codeChallenge) {
      throw new BadRequestException("invalid_request");
    }

    // 3. Validate PKCE if it was used
    if (authCode.codeChallenge) {
      if (!codeVerifier) {
        throw new BadRequestException("invalid_request"); // PKCE required but missing verifier
      }

      // Verify code_verifier: SHA256(code_verifier) should equal code_challenge
      const calculatedChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      if (
        !this.timingSafeCompare(calculatedChallenge, authCode.codeChallenge)
      ) {
        throw new BadRequestException("invalid_pkce");
      }
    }

    // 4. Mark code as consumed
    await this.db.apiAuthCode.update({
      where: { id: authCode.id },
      data: { consumedAt: new Date() },
    });

    // 5 & 6. Generate tokens and store refresh token
    const accessToken = this.generateRandomToken(32);
    const refreshToken = this.generateRandomToken(32);
    const accessTokenHash = this.hashToken(accessToken);
    const refreshTokenHash = this.hashToken(refreshToken);

    const accessTokenExpiresAt = new Date(
      Date.now() + this.ACCESS_TOKEN_TTL_SECONDS * 1000,
    );
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    try {
      await this.db.apiAccessToken.create({
        data: {
          clientId: client.id,
          userId: authCode.userId,
          accessTokenHash,
          refreshTokenHash,
          scope: authCode.scope,
          expiresAt: accessTokenExpiresAt,
          refreshExpiresAt: refreshTokenExpiresAt,
        },
      });
    } catch (error) {
      throw new BadRequestException("Failed to issue tokens");
    }

    // 7. Return tokens
    // token_type: 'Bearer' is required by RFC 6749 section 5.1.
    return {
      access_token: accessToken,
      token_type: "Bearer" as const,
      refresh_token: refreshToken,
      expires_in: this.ACCESS_TOKEN_TTL_SECONDS,
      scope: authCode.scope,
    };
  }

  // ---------------------------------------------------------------------------
  // Refresh Token Grant
  // ---------------------------------------------------------------------------

  /**
   * Exchange refresh token for new access token.
   * Called by POST /api/v1/oauth/token with grant_type=refresh_token.
   *
   * Steps:
   * 1. Validate client credentials
   * 2. Find refresh token by hash, verify not expired or revoked
   * 3. Revoke the old token pair (refresh token rotation)
   * 4. Generate new access + refresh token pair
   * 5. Store new pair in database
   * 6. Return new tokens
   *
   * This implements the recommendation from RFC 6749 sect. 10.4 to rotate
   * refresh tokens on every use, reducing the window for token theft attacks.
   */
  async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<{
    access_token: string;
    token_type: "Bearer";
    refresh_token: string;
    expires_in: number;
    scope: string;
  }> {
    // 1. Validate client credentials
    const client = await this.validateClientCredentials(clientId, clientSecret);

    // 2. Find refresh token and validate it
    const refreshTokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.db.apiAccessToken.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.clientId !== client.id) {
      throw new BadRequestException("invalid_grant");
    }

    if (tokenRecord.revokedAt) {
      throw new BadRequestException("invalid_grant"); // Token revoked
    }

    if (
      tokenRecord.refreshExpiresAt &&
      tokenRecord.refreshExpiresAt < new Date()
    ) {
      throw new BadRequestException("invalid_grant"); // Refresh token expired
    }

    // 3. Revoke the old token pair
    await this.db.apiAccessToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    // 4 & 5. Generate new token pair and store
    const newAccessToken = this.generateRandomToken(32);
    const newRefreshToken = this.generateRandomToken(32);
    const newAccessTokenHash = this.hashToken(newAccessToken);
    const newRefreshTokenHash = this.hashToken(newRefreshToken);

    const accessTokenExpiresAt = new Date(
      Date.now() + this.ACCESS_TOKEN_TTL_SECONDS * 1000,
    );
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    try {
      await this.db.apiAccessToken.create({
        data: {
          clientId: client.id,
          userId: tokenRecord.userId,
          accessTokenHash: newAccessTokenHash,
          refreshTokenHash: newRefreshTokenHash,
          scope: tokenRecord.scope,
          expiresAt: accessTokenExpiresAt,
          refreshExpiresAt: refreshTokenExpiresAt,
        },
      });
    } catch (error) {
      throw new BadRequestException("Failed to refresh token");
    }

    // 6. Return new tokens
    // token_type: 'Bearer' is required by RFC 6749 section 5.1.
    return {
      access_token: newAccessToken,
      token_type: "Bearer" as const,
      refresh_token: newRefreshToken,
      expires_in: this.ACCESS_TOKEN_TTL_SECONDS,
      scope: tokenRecord.scope,
    };
  }

  // ---------------------------------------------------------------------------
  // Token Revocation
  // ---------------------------------------------------------------------------

  /**
   * Revoke an access or refresh token.
   * Called by POST /api/v1/oauth/revoke.
   *
   * Per RFC 7009 section 2.2:
   * "If the revocation request is valid and the token has been revoked,
   * the authorization server responds with HTTP status code 200."
   *
   * The endpoint MUST NOT indicate whether the token was found or how
   * revocation was performed, as this could leak information about token
   * existence. It always returns 200 OK.
   *
   * Steps:
   * 1. Validate client credentials
   * 2. Search for the token by access_token_hash or refresh_token_hash
   * 3. If found and not already revoked, mark as revoked
   * 4. Return 200 OK regardless of whether token was found
   */
  async revokeToken(
    clientId: string,
    clientSecret: string,
    token: string,
  ): Promise<{ message: string }> {
    // 1. Validate client credentials
    const client = await this.validateClientCredentials(clientId, clientSecret);

    // 2. Hash the token
    const tokenHash = this.hashToken(token);

    // 3. Search for token and revoke if found
    const tokenRecord = await this.db.apiAccessToken.findFirst({
      where: {
        clientId: client.id,
        OR: [{ accessTokenHash: tokenHash }, { refreshTokenHash: tokenHash }],
      },
    });

    if (tokenRecord && !tokenRecord.revokedAt) {
      await this.db.apiAccessToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      });
    }

    // 4. Always return success (RFC 7009 compliance)
    return { message: "Token revoked successfully" };
  }
}
