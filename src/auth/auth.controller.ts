import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import { extractClientIp, normalizeUserAgent } from "../common/utils/security.utils";
import { AuthService } from "./auth.service";
import { AUTH_RATE_LIMITS } from "./constants/auth.constants";
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailQueryDto,
} from "./dto/auth.dto";
import { SessionManagementService } from "./services/session-management.service";
import { TokenService } from "./services/token.service";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly sessionManagement: SessionManagementService,
  ) {}

  @Public()
  @Post("register")
  @ThrottlePolicy(AUTH_RATE_LIMITS.register.limit, AUTH_RATE_LIMITS.register.ttlMs)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: extractClientIp(req),
      userAgent: normalizeUserAgent(req),
    });
  }

  @Public()
  @Get("verify-email")
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
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @ThrottlePolicy(AUTH_RATE_LIMITS.loginByIp.limit, AUTH_RATE_LIMITS.loginByIp.ttlMs)
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
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
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
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      role: "USER",
    });

    const { rawToken: refreshTokenRaw, tokenHash } =
      this.tokenService.createRefreshToken();

    await this.sessionManagement.createSession(
      user.id,
      req.headers["user-agent"] || "unknown",
      req.ip || req.connection?.remoteAddress || "unknown",
      tokenHash,
    );

    return res.json({
      accessToken,
      refreshToken: refreshTokenRaw,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  }
}
