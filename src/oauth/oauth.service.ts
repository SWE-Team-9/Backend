import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizeDto, TokenDto, RevokeDto } from './dto';

/**
 * OAuth2 Provider Service (RFC 6749, RFC 7009, RFC 7636 PKCE)
 * 
 * Implements authorization code flow with optional PKCE support for public clients.
 * Generates opaque access/refresh tokens (not JWTs) for third-party API access.
 */
@Injectable()
export class OAuthService {
  private readonly AUTHORIZATION_CODE_TTL_SECONDS = 60; // 1 minute
  private readonly ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
  private readonly REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private get db(): any {
    return this.prisma as any;
  }

  // ---------------------------------------------------------------------------
  // Utility: Hash tokens for secure storage
  // ---------------------------------------------------------------------------

  /**
   * Hash a token using SHA-256 before storing in database.
   * This prevents database breach attackers from getting raw tokens.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate a cryptographically secure random token.
   * 32 bytes = 256 bits, base64-encoded.
   */
  private generateRandomToken(bytes: number = 32): string {
    return randomBytes(bytes).toString('base64url');
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
    const client = await this.db.apiClient.findUnique({
      where: { clientId },
    });

    if (!client || !client.isActive) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    // Constant-time comparison of secrets
    const secretHash = this.hashToken(clientSecret);
    if (!this.timingSafeCompare(secretHash, client.clientSecretHash)) {
      throw new UnauthorizedException('Invalid client credentials');
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
      throw new BadRequestException('invalid_client');
    }

    // Check redirect URI is registered
    if (!client.redirectUris.some((uri: string) => uri === redirectUri)) {
      throw new BadRequestException('invalid_redirect_uri');
    }

    // Validate scopes are within allowed for this client
    const requestedScopes = scope.split(' ').filter((s: string) => s);
    const validScopes = requestedScopes.every((s: string) =>
      client.allowedScopes.includes(s),
    );
    if (!validScopes) {
      throw new BadRequestException('invalid_scope');
    }

    // Generate authorization code (one-time use, expires in 60 seconds)
    const rawCode = this.generateRandomToken(32);
    const codeHash = this.hashToken(rawCode);

    const expiresAt = new Date(Date.now() + this.AUTHORIZATION_CODE_TTL_SECONDS * 1000);

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
      throw new BadRequestException('Failed to generate authorization code');
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
    clientSecret: string,
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{ access_token: string; token_type: 'Bearer'; refresh_token: string; expires_in: number; scope: string }> {
    // 1. Validate client credentials
    const client = await this.validateClientCredentials(clientId, clientSecret);

    // 2. Find authorization code
    const codeHash = this.hashToken(code);
    const authCode = await this.db.apiAuthCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });

    if (!authCode || authCode.clientId !== client.id) {
      throw new BadRequestException('invalid_grant');
    }

    if (authCode.consumedAt) {
      throw new BadRequestException('invalid_grant'); // Code already used
    }

    if (authCode.expiresAt < new Date()) {
      throw new BadRequestException('invalid_grant'); // Code expired
    }

    if (authCode.redirectUri !== redirectUri) {
      throw new BadRequestException('invalid_grant'); // redirect_uri mismatch
    }

    // 3. Validate PKCE if it was used
    if (authCode.codeChallenge) {
      if (!codeVerifier) {
        throw new BadRequestException('invalid_request'); // PKCE required but missing verifier
      }

      // Verify code_verifier: SHA256(code_verifier) should equal code_challenge
      const calculatedChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      if (!this.timingSafeCompare(calculatedChallenge, authCode.codeChallenge)) {
        throw new BadRequestException('invalid_pkce');
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

    const accessTokenExpiresAt = new Date(Date.now() + this.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL_SECONDS * 1000);

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
      throw new BadRequestException('Failed to issue tokens');
    }

    // 7. Return tokens
    // token_type: 'Bearer' is required by RFC 6749 section 5.1.
    return {
      access_token: accessToken,
      token_type: 'Bearer' as const,
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
  ): Promise<{ access_token: string; token_type: 'Bearer'; refresh_token: string; expires_in: number; scope: string }> {
    // 1. Validate client credentials
    const client = await this.validateClientCredentials(clientId, clientSecret);

    // 2. Find refresh token and validate it
    const refreshTokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.db.apiAccessToken.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.clientId !== client.id) {
      throw new BadRequestException('invalid_grant');
    }

    if (tokenRecord.revokedAt) {
      throw new BadRequestException('invalid_grant'); // Token revoked
    }

    if (tokenRecord.refreshExpiresAt && tokenRecord.refreshExpiresAt < new Date()) {
      throw new BadRequestException('invalid_grant'); // Refresh token expired
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

    const accessTokenExpiresAt = new Date(Date.now() + this.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL_SECONDS * 1000);

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
      throw new BadRequestException('Failed to refresh token');
    }

    // 6. Return new tokens
    // token_type: 'Bearer' is required by RFC 6749 section 5.1.
    return {
      access_token: newAccessToken,
      token_type: 'Bearer' as const,
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
        OR: [
          { accessTokenHash: tokenHash },
          { refreshTokenHash: tokenHash },
        ],
      },
    });

    if (tokenRecord && !tokenRecord.revokedAt) {
      await this.db.apiAccessToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      });
    }

    // 4. Always return success (RFC 7009 compliance)
    return { message: 'Token revoked successfully' };
  }
}
