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

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
  ) {}

  // ─── Endpoint 1: POST /auth/register ───────────────────────────────────
  @Public()
  @ThrottlePolicy(5, 60_000) // 5 requests per minute
  @Post("register")
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const ip = req.ip;
    return this.authService.register(dto, ip);
  }

  // ─── Endpoint 2: POST /auth/verify-email ───────────────────────────────
  @Public()
  @ThrottlePolicy(10, 60_000)
  @Post("verify-email")
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  // ─── Endpoint 3: POST /auth/resend-verification ────────────────────────
  @Public()
  @ThrottlePolicy(3, 60_000) // 3 requests per minute
  @Post("resend-verification")
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  // ─── Endpoint 4: POST /auth/login ──────────────────────────────────────
  @Public()
  @ThrottlePolicy(10, 60_000) // 10 requests per minute
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
  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("google")
  googleRedirect() {
    // Passport redirects to Google — this method body is never reached
  }

  // ─── Endpoint 6: GET /auth/google/callback ─────────────────────────────
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
  @Public()
  @ThrottlePolicy(3, 60_000)
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  // ─── Endpoint 11: POST /auth/reset-password ───────────────────────────
  @Public()
  @ThrottlePolicy(5, 60_000)
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // ─── Endpoint 12: POST /auth/change-password ──────────────────────────
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
  @Public()
  @ThrottlePolicy(5, 60_000)
  @Post("email/confirm-change")
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(@Body() dto: ConfirmEmailChangeDto) {
    return this.authService.confirmEmailChange(dto.token);
  }

  // ─── Endpoint 15: GET /auth/me ─────────────────────────────────────────
  @Get("me")
  async getMe(@CurrentUser("userId") userId: string) {
    return this.authService.getMe(userId);
  }

  // ─── Endpoint 16: GET /auth/sessions ───────────────────────────────────
  @Get("sessions")
  async getActiveSessions(
    @CurrentUser("userId") userId: string,
    @Req() req: Request,
  ) {
    const refreshTokenRaw = req.cookies?.["refresh_token"];
    return this.authService.getActiveSessions(userId, refreshTokenRaw);
  }

  // ─── Endpoint 17: DELETE /auth/sessions/:sessionId ─────────────────────
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