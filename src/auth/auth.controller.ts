import {
	Body,
	Controller,
	Get,
	HttpCode,
	Post,
	Query,
	Req,
	Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import {
	AUTH_RATE_LIMITS,
} from "./constants/auth.constants";
import {
	ForgotPasswordDto,
	LoginDto,
	RegisterDto,
	ResendVerificationDto,
	ResetPasswordDto,
	VerifyEmailQueryDto,
} from "./dto/auth.dto";
import { AuthService } from "./auth.service";
import { extractClientIp, normalizeUserAgent } from "../common/utils/security.utils";

@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

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
}
