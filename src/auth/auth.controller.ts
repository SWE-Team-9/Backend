import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import {
  extractClientIp,
  normalizeUserAgent,
} from "../common/utils/security.utils";
import { AuthService } from "./auth.service";
import {
  AUTH_RATE_LIMITS,
  REFRESH_COOKIE_NAME,
} from "./constants/auth.constants";
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  RequestEmailChangeDto,
  RevokeSessionParamsDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailQueryDto,
} from "./dto/auth.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { CookieService } from "./services/cookie.service";
import { TokenService } from "./services/token.service";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
    private readonly tokenService: TokenService,
  ) {}

  @Public()
  @Post("register")
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.register.limit,
    AUTH_RATE_LIMITS.register.ttlMs,
  )
  @ApiOperation({
    summary: "Register a new user account",
    description: `Create a new Spotly account with email and password. Includes Google reCAPTCHA v3 verification to prevent automated abuse.

Flow:
1. Validate email (must not already exist)
2. Verify CAPTCHA token with Google
3. Hash password using Argon2 (GPU-resistant)
4. Create user, profile, and auth identity records
5. Send email verification link (24-hour token TTL)
6. Return confirmation message

Rate Limited: 3 attempts per minute.
Email verification required before login.`,
  })
  @ApiResponse({ status: 201, description: "Registration successful, verification email sent" })
  @ApiResponse({ status: 400, description: "Validation failed (invalid email, weak password, CAPTCHA failed)" })
  @ApiResponse({ status: 409, description: "Email already registered" })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (3/min)" })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: extractClientIp(req),
      userAgent: normalizeUserAgent(req),
    });
  }

  @Public()
  @Get("verify-email")
  @ApiOperation({
    summary: "Verify user email using token",
    description: `Confirm email ownership by validating the verification token sent to the user's inbox.

Flow:
1. Hash the provided token (SHA-256)
2. Look up matching token in database
3. Verify token not expired (24-hour TTL)
4. Mark user as verified
5. Delete all other verification tokens for this user
6. Return success message

Token Expiry: 24 hours from registration.
Tokens are single-use only.`,
  })
  @ApiResponse({ status: 200, description: "Email verified successfully" })
  @ApiResponse({
    status: 400,
    description: "Validation failed: Invalid, expired, or already-used verification token",
  })
  async verifyEmail(@Query() query: VerifyEmailQueryDto) {
    return this.authService.verifyEmail(query);
  }

  @Public()
  @Post("resend-verification")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.resendVerification.limit,
    AUTH_RATE_LIMITS.resendVerification.ttlMs,
  )
  @ApiOperation({
    summary: "Resend verification email",
    description: `Request a new email verification link if the previous one expired.

Flow:
1. Look up user by email (same response regardless of account existence — prevents enumeration)
2. If user exists AND not verified, generate new token and send email
3. Automatically delete any previous tokens for this user
4. Return generic success message

Rate Limited: 3 attempts per hour.
Security: Response is always positive to prevent user enumeration.`,
  })
  @ApiResponse({
    status: 200,
    description: "If account exists and is unverified, verification email sent",
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (3/hour)",
  })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.loginByIp.limit,
    AUTH_RATE_LIMITS.loginByIp.ttlMs,
  )
  @ApiOperation({
    summary: "Login with email and password",
    description: `Authenticate user and create a session with JWT token pair.

Flow:
1. Look up user by email (constant-time comparison to prevent timing attacks)
2. Verify password against Argon2 hash
3. Check email is verified
4. Create new session with device fingerprinting (user agent, IP address)
5. Issue access token (15-minute TTL) + refresh token (7-day TTL)
6. Set both tokens as httpOnly cookies (XSS-safe, CSRF-safe with SameSite=Strict)
7. Return user info + sessions

Rate Limited: 10 attempts per minute by IP, 5 attempts per 15 minutes by email.
Tokens: Access cookies are httpOnly, Secure, and SameSite=Strict.
Remember Me: Optional flag extends refresh token to 30 days.`,
  })
  @ApiResponse({ status: 200, description: "Login successful, tokens set as httpOnly cookies" })
  @ApiResponse({
    status: 401,
    description: "Invalid credentials, email not verified, or account status (suspended/banned/deleted)",
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (10/min per IP or 5/15min per email)",
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, {
      ipAddress: extractClientIp(req),
      userAgent: normalizeUserAgent(req),
    });

    this.authService.applyAuthCookies({
      response: res,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      rememberMe: result.rememberMe,
    });

    return {
      message: "Login successful.",
      user: result.user,
    };
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.forgotPassword.limit,
    AUTH_RATE_LIMITS.forgotPassword.ttlMs,
  )
  @ApiOperation({
    summary: "Request password reset email",
    description: `Initiate password recovery flow by sending reset link to registered email.

Flow:
1. Look up user by email (same response regardless of existence — prevents enumeration)
2. If user exists, generate password reset token (SHA-256 hashed, 1-hour TTL)
3. Delete any existing tokens for this user
4. Send reset email with secure link
5. Return generic success message

Rate Limited: 3 attempts per hour.
Security: Response is always positive to prevent user enumeration.
Token Expiry: 1 hour. Tokens are single-use.`,
  })
  @ApiResponse({ status: 200, description: "If account exists, password reset email sent" })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (3/hour)",
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.forgotPassword.limit,
    AUTH_RATE_LIMITS.forgotPassword.ttlMs,
  )
  @ApiOperation({
    summary: "Reset password with token",
    description: `Complete password recovery by providing a new password and reset token.

Flow:
1. Hash the reset token (SHA-256)
2. Look up matching token in database
3. Verify token not expired (1-hour TTL)
4. Validate new password strength (include uppercase, lowercase, number, special char)
5. Hash new password with Argon2
6. Update user password
7. Delete all password reset tokens for this user
8. Revoke all existing sessions (force re-login on all devices)
9. Return success message

Rate Limited: 3 attempts per hour.
Security: All sessions revoked — user must login again on all devices.
Token Expiry: 1 hour.`,
  })
  @ApiResponse({ status: 200, description: "Password reset successful, all sessions revoked" })
  @ApiResponse({ status: 400, description: "Validation failed: Invalid, expired token, or weak password" })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (3/hour)",
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.refresh.limit,
    AUTH_RATE_LIMITS.refresh.ttlMs,
  )
  @ApiOperation({
    summary: "Rotate refresh token and issue new access token",
    description: `Extend session by exchanging refresh token for new access token.

Flow:
1. Extract refresh token from httpOnly cookie (or request body fallback)
2. Hash token and look up active session
3. Verify session not revoked
4. Verify token not expired
5. Generate new access token (15-minute TTL)
6. Generate new refresh token with automatic rotation
7. Update session record in database
8. Set new tokens as httpOnly cookies
9. Return new tokens + user info

Rate Limited: 30 attempts per minute.
Token Rotation: Old refresh token invalidated, new one issued — prevents token replay.
Refresh TTL: 7 days (or 30 days if Remember Me enabled).
Access TTL: 15 minutes.`,
  })
  @ApiResponse({ status: 200, description: "New tokens issued and set as cookies" })
  @ApiResponse({
    status: 401,
    description: "Invalid, expired, or revoked refresh token",
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (30/min)",
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RefreshTokenDto,
  ) {
    const refreshToken =
      dto?.refreshToken ??
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ??
      "";

    if (!refreshToken) {
      throw new UnauthorizedException({
        code: "REFRESH_TOKEN_MISSING",
        message: "Refresh token is required.",
      });
    }

    const result = await this.authService.refreshSession(refreshToken, {
      ipAddress: extractClientIp(req),
      userAgent: normalizeUserAgent(req),
    });

    this.authService.applyAuthCookies({
      response: res,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      rememberMe: result.rememberMe,
    });

    return {
      message: "Token refreshed successfully.",
      user: result.user,
    };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  @ApiOperation({
    summary: "Logout current session",
    description: `Invalidate current session and clear authentication cookies.

Flow:
1. Extract refresh token from cookie or body
2. If token provided, find corresponding session
3. Mark session as revoked (set revokedAt timestamp)
4. Clear both access and refresh cookies
5. Return success message

Note: Logout is optional on client — cookies will auto-expire.
Session Tracking: Revocation is soft-delete (historical audit trail preserved).`,
  })
  @ApiResponse({ status: 200, description: "Session revoked, cookies cleared" })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RefreshTokenDto,
  ) {
    const refreshToken =
      dto?.refreshToken ??
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);

    if (refreshToken) {
      await this.authService.logoutByRefreshToken(refreshToken);
    }

    this.cookieService.clearAuthCookies(res);
    return { message: "Logout successful." };
  }

  @Post("sessions/revoke-all")
  @HttpCode(200)
  @ApiOperation({
    summary: "Revoke all active sessions for the current user",
    description: `Logout all devices — invalidate all refresh tokens and sessions.

Flow:
1. Get current authenticated user
2. Query all non-revoked sessions for this user
3. Mark each session as revoked (revokedAt = now)
4. Clear cookies on current response
5. Return success message

Use Case: User suspects account compromise or wants to logout all devices.
Security: All refresh tokens invalidated, forcing re-login everywhere.
Authentication: Requires valid access token (protected endpoint).`,
  })
  @ApiResponse({ status: 200, description: "All sessions revoked" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  async revokeAllSessions(
    @CurrentUser("userId") userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAllSessions(userId);
    this.cookieService.clearAuthCookies(res);
    return { message: "All sessions revoked successfully." };
  }

  @Get("sessions")
  @ApiOperation({
    summary: "Get active sessions for the current user",
    description: `Retrieve list of all active sessions/devices logged into this account.

Returned per session:
- Device name (extracted from User-Agent)
- Platform (WEB, ANDROID, IOS, DESKTOP)
- Last seen timestamp
- IP address (from login/refresh)
- Expiry time

Use Case: Users can see all active logins and revoke suspicious ones.
Authentication: Requires valid access token (protected endpoint).`,
  })
  @ApiResponse({ status: 200, description: "List of active sessions" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  async getSessions(@CurrentUser("userId") userId: string) {
    return this.authService.listActiveSessions(userId);
  }

  @Delete("sessions/:sessionId")
  @HttpCode(200)
  @ApiOperation({
    summary: "Revoke a specific session for current user",
    description: `Logout a single device by revoking its session.

Flow:
1. Get current user
2. Verify requestor owns the session (security)
3. Mark session as revoked
4. Return success

Use Case: User revokes a suspicious login from the session list.
Security: Can only revoke own sessions, not other users' sessions.
Authentication: Requires valid access token.`,
  })
  @ApiResponse({ status: 200, description: "Session revoked" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({ status: 404, description: "Session not found or not owned by user" })
  async revokeSession(
    @CurrentUser("userId") userId: string,
    @Param() params: RevokeSessionParamsDto,
  ) {
    await this.authService.revokeSession(userId, params.sessionId);
    return { message: "Session revoked successfully." };
  }

  @Patch("change-password")
  @ApiOperation({
    summary: "Change password for current user",
    description: `Update account password for authenticated user (requires current password verification).

Flow:
1. Get current authenticated user
2. Fetch user with password hash
3. Verify current password matches
4. Hash new password with Argon2
5. Update password
6. Revoke all sessions (force re-login everywhere)
7. Clear current cookies
8. Return success message

Security: Requires verification of current password (prevents CSRF).
Sessions: All devices logged out after password change.
Authentication: Requires valid access token.`,
  })
  @ApiResponse({ status: 200, description: "Password changed, all sessions revoked" })
  @ApiResponse({ status: 401, description: "Invalid current password or not authenticated" })
  async changePassword(
    @CurrentUser("userId") userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changePassword(userId, dto);
    this.cookieService.clearAuthCookies(res);
    return result;
  }

  @Get("me")
  @ApiOperation({
    summary: "Get current authenticated user",
    description: `Retrieve profile and account info for authenticated user.

Returned data:
- User ID
- Email
- Display name
- Account status (ACTIVE, SUSPENDED, BANNED, DELETED)
- Verification status
- Created timestamp
- Profile info (handle, bio, avatar URL, etc.)

Note: Private profile fields only visible to owner.
Authentication: Requires valid access token.`,
  })
  @ApiResponse({ status: 200, description: "Current user profile" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  async me(@CurrentUser("userId") userId: string) {
    return this.authService.getMe(userId);
  }

  @Post("request-email-change")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.requestEmailChange.limit,
    AUTH_RATE_LIMITS.requestEmailChange.ttlMs,
  )
  @ApiOperation({
    summary: "Request email change",
    description: `Initiate email address change with verification.

Flow:
1. Get current authenticated user
2. Verify new email is not already taken
3. Generate email change token (SHA-256 hashed, 24-hour TTL)
4. Store new email + token in database
5. Send verification email to NEW address with confirmation link
6. Return success message

Note: Old email remains active until verification completes.
Rate Limited: 3 attempts per hour.
Token Expiry: 24 hours.
Authentication: Requires valid access token.`,
  })
  @ApiResponse({ status: 200, description: "Verification email sent to new address" })
  @ApiResponse({ status: 400, description: "Validation failed: New email already in use" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (3/hour)",
  })
  async requestEmailChange(
    @CurrentUser("userId") userId: string,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.authService.requestEmailChange(userId, dto);
  }

  @Post("confirm-email-change")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.requestEmailChange.limit,
    AUTH_RATE_LIMITS.requestEmailChange.ttlMs,
  )
  @ApiOperation({
    summary: "Confirm email change",
    description: `Complete email address change by validating confirmation token.

Flow:
1. Get current authenticated user
2. Hash provided token
3. Look up pending email change request
4. Verify token not expired (24-hour TTL)
5. Update user's email address
6. Delete all pending email change requests for this user
7. Return success message

Note: Old email no longer associated with account after confirmation.
Rate Limited: 3 attempts per hour.
Token Expiry: 24 hours. Tokens single-use.
Authentication: Requires valid access token.`,
  })
  @ApiResponse({ status: 200, description: "Email successfully changed" })
  @ApiResponse({ status: 400, description: "Invalid or expired confirmation token" })
  @ApiResponse({ status: 401, description: "Not authenticated" })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded (3/hour)",
  })
  async confirmEmailChange(
    @CurrentUser("userId") userId: string,
    @Body() dto: ConfirmEmailChangeDto,
  ) {
    return this.authService.confirmEmailChange(userId, dto);
  }

  @Public()
  @Get("google")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Initiate Google OAuth flow" })
  @ApiResponse({ status: 302, description: "Redirects to Google login" })
  initiateGoogleAuth() {
    // Handled by Passport guard redirection.
  }

  @Public()
  @Get("google/callback")
  @UseGuards(AuthGuard("google"))
  @ApiOperation({ summary: "Google OAuth callback handler" })
  @ApiResponse({ status: 200, description: "Login successful, token returned" })
  @ApiResponse({ status: 401, description: "Authentication failed" })
  async googleCallback(
    @Req() req: Request & { user?: any },
    @Res() res: Response,
  ) {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      role: "USER",
    });

    const rememberMe = true;
    const {
      rawToken: refreshTokenRaw,
      tokenHash,
      expiresAt,
    } = this.tokenService.createRefreshToken(rememberMe);

    await this.authService.createOAuthSession({
      userId: user.id,
      refreshTokenHash: tokenHash,
      expiresAt,
      userAgent: normalizeUserAgent(req),
      ipAddress: extractClientIp(req),
    });

    this.cookieService.setAuthCookies({
      response: res,
      accessToken,
      refreshToken: refreshTokenRaw,
      rememberMe,
    });

    return res.json({
      message: "Google login successful.",
      user: {
        id: user.id,
        email: user.email,
      },
    });
  }
}
