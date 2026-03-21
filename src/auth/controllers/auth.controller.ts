import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiExcludeEndpoint,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { AuthService } from "../auth.service";
import { CookieService } from "../services/cookie.service";
import { TokenService } from "../services/token.service";
import { SessionService } from "../services/session.service";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ThrottlePolicy } from "../../common/decorators/throttle-policy.decorator";
import { GoogleAuthGuard } from "../guards/google-auth.guard";
import {
  RegisterDto,
  VerifyEmailDto,
  ResendVerificationDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  RequestEmailChangeDto,
  ConfirmEmailChangeDto,
  RevokeSessionParamsDto,
} from "../dto/auth.dto";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Endpoint 1: POST /auth/register ───────────────────────────────────
  @ApiOperation({
    summary: "Register a new account",
    description:
      "Creates a new user account. A verification email is sent to the provided address. " +
      "The account cannot be used until the email is verified. " +
      "Requires a reCAPTCHA v3 token in production.",
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: "Account created — verification email sent.", schema: { example: { message: "Registration successful. Please check your email to verify your account." } } })
  @ApiResponse({ status: 400, description: "Validation error (weak password, invalid DOB, underage, etc.)", schema: { example: { statusCode: 400, error: "Bad Request", message: "Password must be at least 8 characters..." } } })
  @ApiResponse({ status: 409, description: "Email already registered.", schema: { example: { statusCode: 409, error: "EMAIL_ALREADY_EXISTS", message: "An account with this email already exists." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (5 requests/min)." })
  @Public()
  @ThrottlePolicy(5, 60_000)
  @Post("register")
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const ip = req.ip;
    return this.authService.register(dto, ip);
  }

  // ─── Endpoint 2: POST /auth/verify-email ───────────────────────────────
  @ApiOperation({
    summary: "Verify email address",
    description:
      "Activates the account using the token from the verification email link. " +
      "Tokens expire after 24 hours. Use /auth/resend-verification to get a new one.",
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({ status: 200, description: "Email verified — account is now active.", schema: { example: { message: "Email verified successfully." } } })
  @ApiResponse({ status: 400, description: "Token missing or malformed." })
  @ApiResponse({ status: 410, description: "Token expired or already used.", schema: { example: { statusCode: 410, error: "TOKEN_EXPIRED", message: "Verification token has expired." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (10 requests/min)." })
  @Public()
  @ThrottlePolicy(10, 60_000)
  @Post("verify-email")
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  // ─── Endpoint 3: POST /auth/resend-verification ────────────────────────
  @ApiOperation({
    summary: "Resend verification email",
    description:
      "Sends a fresh verification link if the original expired or was not received. " +
      "Always returns 200 to prevent email enumeration — even if the email is not registered.",
  })
  @ApiBody({ type: ResendVerificationDto })
  @ApiResponse({ status: 200, description: "Verification email sent (always, regardless of whether the email exists).", schema: { example: { message: "If this email is registered and unverified, a new verification link has been sent." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (3 requests/min)." })
  @Public()
  @ThrottlePolicy(3, 60_000)
  @Post("resend-verification")
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  // ─── Endpoint 4: POST /auth/login ──────────────────────────────────────
  @ApiOperation({
    summary: "Login with email and password",
    description:
      "Authenticates the user and sets httpOnly cookies: `access_token` (15 min) and `refresh_token` " +
      "(7 days, or 30 days with remember_me). " +
      "The email must be verified before login is allowed.",
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: "Login successful — auth cookies set.",
    schema: {
      example: {
        message: "Login successful",
        user: {
          id: "uuid",
          email: "user@example.com",
          display_name: "John Doe",
          handle: "johndoe",
          avatar_url: null,
          is_verified: true,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Invalid credentials.", schema: { example: { statusCode: 401, error: "INVALID_CREDENTIALS", message: "Invalid email or password." } } })
  @ApiResponse({ status: 403, description: "Email not verified.", schema: { example: { statusCode: 403, error: "EMAIL_NOT_VERIFIED", message: "Please verify your email address before logging in." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (10 requests/min)." })
  @Public()
  @ThrottlePolicy(10, 60_000)
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? "unknown";
    const userAgent = req.headers["user-agent"] ?? "unknown";

    const result = await this.authService.login(dto, ip, userAgent);

    // Set httpOnly cookies
    this.cookieService.setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      dto.remember_me,
    );

    // Return user data (without raw tokens in bod─── Endpoint 5:
    return {
      message: "Login successful",
      user: result.user,
    };
  }

  // ─── Endpoint 5: GET /auth/google ──────────────────────────────────────
  @ApiOperation({
    summary: "Initiate Google OAuth login",
    description:
      "Redirects the browser to Google's OAuth consent page. " +
      "This endpoint is not testable via Swagger — open it directly in a browser tab.",
  })
  @ApiResponse({ status: 302, description: "Redirect to Google OAuth consent page." })
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("google")
  googleRedirect() {
    // Passport redirects to Google — this method body is never reached
  }

  // ─── Endpoint 6: GET /auth/google/callback ─────────────────────────────
  @ApiExcludeEndpoint() // Google redirects here — not callable from Swagger
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("google/callback")
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const googleUser = req.user as any;
    const ip = req.ip ?? "unknown";
    const userAgent = req.headers["user-agent"] ?? "unknown";

    const result = await this.authService.googleLogin(googleUser, ip, userAgent);

    // Set httpOnly cookies
    this.cookieService.setAuthCookies(res, result.accessToken, result.refreshToken);

    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}/auth/callback`);
  }

  // ─── Endpoint 7: POST /auth/refresh ────────────────────────────────────
  @ApiOperation({
    summary: "Refresh access token",
    description:
      "Uses the `refresh_token` httpOnly cookie to issue a new rotated pair of " +
      "`access_token` + `refresh_token` cookies. " +
      "The frontend axios interceptor calls this automatically on 401 responses. " +
      "Token reuse detection is active — a reused refresh token invalidates all sessions.",
  })
  @ApiResponse({ status: 200, description: "New tokens issued — cookies updated.", schema: { example: { message: "Token refreshed successfully" } } })
  @ApiResponse({ status: 401, description: "No refresh token cookie, or token is invalid/expired/reused.", schema: { example: { statusCode: 401, error: "NO_REFRESH_TOKEN", message: "No refresh token provided." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (30 requests/min)." })
  @Public()
  @ThrottlePolicy(30, 60_000)
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenRaw = req.cookies?.["refresh_token"];
    if (!refreshTokenRaw) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "NO_REFRESH_TOKEN",
        message: "No refresh token provided.",
      });
    }

    const result = await this.authService.refresh(refreshTokenRaw);

    // Set new cookies with rotated tokens
    this.cookieService.setAuthCookies(res, result.accessToken, result.refreshToken);

    return { message: "Token refreshed successfully" };
  }

  // ─── Endpoint 8: POST /auth/logout ─────────────────────────────────────
  @ApiOperation({
    summary: "Logout from current session",
    description:
      "Revokes the current session's refresh token and clears both auth cookies. " +
      "Does NOT require authentication — anyone can call this (idempotent).",
  })
  @ApiResponse({ status: 200, description: "Logged out — cookies cleared.", schema: { example: { message: "Logged out successfully" } } })
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenRaw = req.cookies?.["refresh_token"];
    await this.authService.logout(refreshTokenRaw);
    this.cookieService.clearAuthCookies(res);
    return { message: "Logged out successfully" };
  }

  // ─── Endpoint 9: POST /auth/logout-all ─────────────────────────────────
  @ApiOperation({
    summary: "Logout from all devices",
    description:
      "Revokes ALL active sessions for the authenticated user. " +
      "Useful if the account is compromised. Requires a valid access_token cookie.",
  })
  @ApiCookieAuth("access_token")
  @ApiResponse({ status: 200, description: "All sessions revoked — cookies cleared.", schema: { example: { message: "All sessions revoked", revokedCount: 3 } } })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("logout-all")
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser("userId") userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logoutAll(userId);
    this.cookieService.clearAuthCookies(res);
    return result;
  }

  // ─── Endpoint 10: POST /auth/forgot-password ──────────────────────────
  @ApiOperation({
    summary: "Request a password reset email",
    description:
      "Sends a password reset link to the given email if an account exists. " +
      "Always returns 200 to prevent account enumeration. " +
      "The reset link is valid for 1 hour.",
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: "Reset email sent (always, regardless of whether the email exists).", schema: { example: { message: "If this email is registered, a password reset link has been sent." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (3 requests/min)." })
  @Public()
  @ThrottlePolicy(3, 60_000)
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  // ─── Endpoint 11: POST /auth/reset-password ───────────────────────────
  @ApiOperation({
    summary: "Reset password using email token",
    description:
      "Sets a new password using the token from the reset email. " +
      "The token is single-use and expires after 1 hour. " +
      "On success, all other sessions are revoked.",
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: "Password reset successfully.", schema: { example: { message: "Password has been reset successfully." } } })
  @ApiResponse({ status: 400, description: "Weak password or passwords do not match." })
  @ApiResponse({ status: 410, description: "Token expired or already used.", schema: { example: { statusCode: 410, error: "TOKEN_EXPIRED", message: "Reset token has expired." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (5 requests/min)." })
  @Public()
  @ThrottlePolicy(5, 60_000)
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // ─── Endpoint 12: POST /auth/change-password ──────────────────────────
  @ApiOperation({
    summary: "Change password (authenticated)",
    description:
      "Changes the password for the currently logged-in user. " +
      "Requires the current password for confirmation. " +
      "On success, all OTHER sessions are revoked (current session stays active).",
  })
  @ApiCookieAuth("access_token")
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: "Password changed — other sessions revoked.", schema: { example: { message: "Password changed successfully." } } })
  @ApiResponse({ status: 400, description: "Weak password, passwords don't match, or same as current." })
  @ApiResponse({ status: 401, description: "Current password is incorrect or not authenticated.", schema: { example: { statusCode: 401, error: "INVALID_CURRENT_PASSWORD", message: "Current password is incorrect." } } })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (5 requests/min)." })
  @ThrottlePolicy(5, 60_000)
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser("userId") userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    // Find current session from the refresh token cookie
    const refreshTokenRaw = req.cookies?.["refresh_token"];
    let currentSessionId = "";
    if (refreshTokenRaw) {
      const hash = this.tokenService.hashToken(refreshTokenRaw);
      const session = await this.sessionService.findActiveSessionByHash(hash);
      if (session) currentSessionId = session.id;
    }
    return this.authService.changePassword(userId, currentSessionId, dto);
  }

  // ─── Endpoint 13: POST /auth/email/change ─────────────────────────────
  @ApiOperation({
    summary: "Request email address change",
    description:
      "Initiates an email change by sending a confirmation link to the NEW email address. " +
      "Current password is required to authorise the change. " +
      "The confirmation link is valid for 1 hour.",
  })
  @ApiCookieAuth("access_token")
  @ApiBody({ type: RequestEmailChangeDto })
  @ApiResponse({ status: 200, description: "Confirmation email sent to the new address.", schema: { example: { message: "A confirmation link has been sent to your new email address." } } })
  @ApiResponse({ status: 400, description: "Invalid email or same as current." })
  @ApiResponse({ status: 401, description: "Current password is incorrect or not authenticated." })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (3 requests/min)." })
  @ThrottlePolicy(3, 60_000)
  @Post("email/change")
  @HttpCode(HttpStatus.OK)
  async requestEmailChange(
    @CurrentUser("userId") userId: string,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.authService.requestEmailChange(userId, dto);
  }

  // ─── Endpoint 14: POST /auth/email/confirm-change ─────────────────────
  @ApiOperation({
    summary: "Confirm email address change",
    description:
      "Completes the email change using the token from the confirmation email. " +
      "On success, the email is updated and ALL sessions are revoked (user must log in again with the new email).",
  })
  @ApiBody({ type: ConfirmEmailChangeDto })
  @ApiResponse({ status: 200, description: "Email changed — all sessions revoked.", schema: { example: { message: "Email address updated successfully." } } })
  @ApiResponse({ status: 410, description: "Token expired or already used." })
  @ApiResponse({ status: 429, description: "Rate limit exceeded (5 requests/min)." })
  @Public()
  @ThrottlePolicy(5, 60_000)
  @Post("email/confirm-change")
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.authService.confirmEmailChange(dto.token);
  }

  // ─── Endpoint 15: GET /auth/me ─────────────────────────────────────────
  @ApiOperation({
    summary: "Get current user",
    description:
      "Returns the profile of the currently authenticated user. " +
      "Used by the frontend to restore session state on page load.",
  })
  @ApiCookieAuth("access_token")
  @ApiResponse({
    status: 200,
    description: "Current user profile.",
    schema: {
      example: {
        id: "uuid",
        email: "user@example.com",
        display_name: "John Doe",
        handle: "johndoe",
        avatar_url: null,
        is_verified: true,
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("me")
  async getMe(@CurrentUser("userId") userId: string) {
    return this.authService.getMe(userId);
  }

  // ─── Endpoint 16: GET /auth/sessions ───────────────────────────────────
  @ApiOperation({
    summary: "List active sessions",
    description:
      "Returns all active sessions for the current user. " +
      "The current session is flagged with `isCurrent: true`. " +
      "Use DELETE /auth/sessions/:sessionId to revoke individual sessions.",
  })
  @ApiCookieAuth("access_token")
  @ApiResponse({
    status: 200,
    description: "List of active sessions.",
    schema: {
      example: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          ip: "127.0.0.1",
          userAgent: "Mozilla/5.0 ...",
          createdAt: "2026-03-01T10:00:00.000Z",
          lastUsedAt: "2026-03-21T08:30:00.000Z",
          isCurrent: true,
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("sessions")
  async getActiveSessions(
    @CurrentUser("userId") userId: string,
    @Req() req: Request,
  ) {
    const refreshTokenRaw = req.cookies?.["refresh_token"];
    return this.authService.getActiveSessions(userId, refreshTokenRaw);
  }

  // ─── Endpoint 17: DELETE /auth/sessions/:sessionId ─────────────────────
  @ApiOperation({
    summary: "Revoke a specific session",
    description:
      "Revokes a single session by its UUID. " +
      "Cannot revoke the current active session (use POST /auth/logout for that). " +
      "The sessionId must be a valid v4 UUID.",
  })
  @ApiCookieAuth("access_token")
  @ApiParam({ name: "sessionId", type: "string", format: "uuid", description: "UUID of the session to revoke", example: "550e8400-e29b-41d4-a716-446655440000" })
  @ApiResponse({ status: 200, description: "Session revoked.", schema: { example: { message: "Session revoked successfully." } } })
  @ApiResponse({ status: 400, description: "sessionId is not a valid UUID." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Attempt to revoke current session or session belonging to another user." })
  @ApiResponse({ status: 404, description: "Session not found." })
  @Delete("sessions/:sessionId")
  async revokeSession(
    @CurrentUser("userId") userId: string,
    @Param() params: RevokeSessionParamsDto,
    @Req() req: Request,
  ) {
    const refreshTokenRaw = req.cookies?.["refresh_token"];
    return this.authService.revokeSession(userId, params.sessionId, refreshTokenRaw);
  }
}
