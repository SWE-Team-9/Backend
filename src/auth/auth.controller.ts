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
  @ApiOperation({ summary: "Register a new user account" })
  @ApiResponse({ status: 201, description: "Registration successful" })
  @ApiResponse({ status: 409, description: "Email already registered" })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: extractClientIp(req),
      userAgent: normalizeUserAgent(req),
    });
  }

  @Public()
  @Get("verify-email")
  @ApiOperation({ summary: "Verify user email using token" })
  @ApiResponse({ status: 200, description: "Email verified" })
  @ApiResponse({
    status: 400,
    description: "Invalid or expired verification token",
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
  @ApiOperation({ summary: "Resend verification email" })
  @ApiResponse({
    status: 200,
    description: "Verification email resend processed",
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
  @ApiOperation({ summary: "Login with email and password" })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({
    status: 401,
    description: "Invalid credentials or email not verified",
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
  @ApiOperation({ summary: "Request password reset email" })
  @ApiResponse({ status: 200, description: "Password reset request processed" })
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
  @ApiOperation({ summary: "Reset password with token" })
  @ApiResponse({ status: 200, description: "Password reset successful" })
  @ApiResponse({ status: 400, description: "Invalid or expired reset token" })
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
  @ApiOperation({ summary: "Rotate refresh token and issue new access token" })
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
  @ApiOperation({ summary: "Logout current session" })
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
  @ApiOperation({ summary: "Revoke all active sessions for the current user" })
  async revokeAllSessions(
    @CurrentUser("userId") userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAllSessions(userId);
    this.cookieService.clearAuthCookies(res);
    return { message: "All sessions revoked successfully." };
  }

  @Get("sessions")
  @ApiOperation({ summary: "Get active sessions for the current user" })
  async getSessions(@CurrentUser("userId") userId: string) {
    return this.authService.listActiveSessions(userId);
  }

  @Delete("sessions/:sessionId")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke a specific session for current user" })
  async revokeSession(
    @CurrentUser("userId") userId: string,
    @Param() params: RevokeSessionParamsDto,
  ) {
    await this.authService.revokeSession(userId, params.sessionId);
    return { message: "Session revoked successfully." };
  }

  @Patch("change-password")
  @ApiOperation({ summary: "Change password for current user" })
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
  @ApiOperation({ summary: "Get current authenticated user" })
  async me(@CurrentUser("userId") userId: string) {
    return this.authService.getMe(userId);
  }

  @Post("request-email-change")
  @HttpCode(200)
  @ThrottlePolicy(
    AUTH_RATE_LIMITS.requestEmailChange.limit,
    AUTH_RATE_LIMITS.requestEmailChange.ttlMs,
  )
  @ApiOperation({ summary: "Request email change" })
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
  @ApiOperation({ summary: "Confirm email change" })
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
