import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { randomBytes } from "crypto";
import {
	EMAIL_VERIFICATION_TTL_SECONDS,
	PASSWORD_RESET_TTL_SECONDS,
	TIMING_SAFE_DUMMY_HASH,
} from "./constants/auth.constants";
import {
	ForgotPasswordDto,
	LoginDto,
	RegisterDto,
	ResendVerificationDto,
	ResetPasswordDto,
	VerifyEmailQueryDto,
} from "./dto/auth.dto";
import { CookieService } from "./services/cookie.service";
import { RecaptchaService } from "./services/recaptcha.service";
import { SessionService } from "./services/session.service";
import { TokenService } from "./services/token.service";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { sanitizeHandle } from "../common/utils/security.utils";

@Injectable()
export class AuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tokenService: TokenService,
		private readonly recaptchaService: RecaptchaService,
		private readonly sessionService: SessionService,
		private readonly mailService: MailService,
		private readonly cookieService: CookieService,
	) {}

	private get db(): any {
		return this.prisma as any;
	}

	async register(
		dto: RegisterDto,
		context: { ipAddress?: string; userAgent?: string },
	): Promise<{ message: string }> {
		await this.recaptchaService.verifyToken(dto.captchaToken ?? "", context.ipAddress);

		const existing = await this.db.user.findUnique({
			where: { email: dto.email },
			select: { id: true },
		});

		if (existing) {
			throw new ConflictException({
				code: "EMAIL_ALREADY_REGISTERED",
				message: "An account with this email already exists.",
			});
		}

		const passwordHash = await argon2.hash(dto.password);
		const uniqueHandle = await this.buildUniqueHandle(dto.display_name);

		const { userId, displayName } = await this.db.$transaction(async (tx: any) => {
			const user = await tx.user.create({
				data: {
					email: dto.email,
					passwordHash,
					dateOfBirth: new Date(dto.date_of_birth),
					  gender: dto.gender,
				},
				select: { id: true },
			});

			await tx.userProfile.create({
				data: {
					userId: user.id,
					displayName: dto.display_name,
					handle: uniqueHandle,
				},
			});

			await tx.authIdentity.create({
				data: {
					userId: user.id,
					  provider: "LOCAL",
					providerEmail: dto.email,
				},
			});

			return { userId: user.id, displayName: dto.display_name };
		});

		await this.issueEmailVerificationToken(userId, dto.email, displayName);

		return {
			message:
				"Registration successful. Please check your email for a verification link.",
		};
	}

	async verifyEmail(dto: VerifyEmailQueryDto): Promise<{ message: string }> {
		const tokenHash = this.tokenService.hashToken(dto.token);

		const verification = await this.db.emailVerificationToken.findFirst({
			where: {
				tokenHash,
				consumedAt: null,
				expiresAt: { gt: new Date() },
			},
			select: {
				id: true,
				userId: true,
			},
		});

		if (!verification) {
			throw new BadRequestException({
				code: "EMAIL_VERIFICATION_TOKEN_INVALID",
				message: "Invalid or expired email verification token.",
			});
		}

		await this.db.$transaction(async (tx: any) => {
			await tx.user.update({
				where: { id: verification.userId },
				data: { isVerified: true },
			});

			await tx.emailVerificationToken.update({
				where: { id: verification.id },
				data: { consumedAt: new Date() },
			});

			await tx.emailVerificationToken.deleteMany({
				where: {
					userId: verification.userId,
					id: { not: verification.id },
				},
			});
		});

		return { message: "Email verified successfully." };
	}

	async resendVerification(dto: ResendVerificationDto): Promise<{ message: string }> {
		const user = await this.db.user.findUnique({
			where: { email: dto.email },
			select: {
				id: true,
				email: true,
				isVerified: true,
				profile: {
					select: { displayName: true },
				},
			},
		});

		if (user && !user.isVerified) {
			await this.issueEmailVerificationToken(
				user.id,
				user.email,
				user.profile?.displayName ?? undefined,
			);
		}

		return {
			message:
				"If the account exists and is not verified, a new verification email has been sent.",
		};
	}

	async login(
		dto: LoginDto,
		context: { ipAddress?: string; userAgent?: string },
	): Promise<{
		accessToken: string;
		refreshToken: string;
		rememberMe: boolean;
		user: { id: string; email: string; role: string; isVerified: boolean };
	}> {
		const user = await this.db.user.findUnique({
			where: { email: dto.email },
			select: {
				id: true,
				email: true,
				passwordHash: true,
				isVerified: true,
				accountStatus: true,
				systemRole: true,
			},
		});

		const hashToVerify = user?.passwordHash ?? TIMING_SAFE_DUMMY_HASH;
		const passwordValid = await argon2.verify(hashToVerify, dto.password);

		if (!user || !user.passwordHash || !passwordValid) {
			throw new UnauthorizedException({
				code: "INVALID_CREDENTIALS",
				message: "Invalid email or password.",
			});
		}

		if (!user.isVerified) {
			throw new UnauthorizedException({
				code: "EMAIL_NOT_VERIFIED",
				message: "Please verify your email before logging in.",
			});
		}

		if (user.accountStatus !== "ACTIVE") {
			throw new ForbiddenException({
				code: "ACCOUNT_UNAVAILABLE",
				message: "Your account is currently unavailable.",
			});
		}

		const accessToken = this.tokenService.signAccessToken({
			sub: user.id,
			role: user.systemRole,
		});

		const rememberMe = dto.remember_me ?? false;
		const refresh = this.tokenService.createRefreshToken(rememberMe);

		await this.sessionService.createSession({
			userId: user.id,
			refreshTokenHash: refresh.tokenHash,
			expiresAt: refresh.expiresAt,
			ipAddress: context.ipAddress,
			userAgent: context.userAgent,
		});

		await this.db.user.update({
			where: { id: user.id },
			data: { lastLoginAt: new Date() },
		});

		return {
			accessToken,
			refreshToken: refresh.rawToken,
			rememberMe,
			user: {
				id: user.id,
				email: user.email,
				role: user.systemRole,
				isVerified: user.isVerified,
			},
		};
	}

	async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
		const user = await this.db.user.findUnique({
			where: { email: dto.email },
			select: {
				id: true,
				email: true,
				passwordHash: true,
				profile: { select: { displayName: true } },
			},
		});

		if (user?.passwordHash) {
			const rawToken = randomBytes(48).toString("base64url");
			const tokenHash = this.tokenService.hashToken(rawToken);
			const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

			await this.db.$transaction(async (tx: any) => {
				await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
				await tx.passwordResetToken.create({
					data: {
						userId: user.id,
						tokenHash,
						expiresAt,
					},
				});
			});

			await this.mailService.sendPasswordResetEmail({
				to: user.email,
				displayName: user.profile?.displayName ?? undefined,
				token: rawToken,
			});
		}

		return {
			message: "If the email exists, a password reset link has been sent.",
		};
	}

	async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
		const tokenHash = this.tokenService.hashToken(dto.token);

		const resetToken = await this.db.passwordResetToken.findFirst({
			where: {
				tokenHash,
				consumedAt: null,
				expiresAt: { gt: new Date() },
			},
			select: {
				id: true,
				userId: true,
			},
		});

		if (!resetToken) {
			throw new BadRequestException({
				code: "PASSWORD_RESET_TOKEN_INVALID",
				message: "Invalid or expired password reset token.",
			});
		}

		const passwordHash = await argon2.hash(dto.new_password);

		await this.db.$transaction(async (tx: any) => {
			await tx.user.update({
				where: { id: resetToken.userId },
				data: { passwordHash },
			});

			await tx.passwordResetToken.update({
				where: { id: resetToken.id },
				data: { consumedAt: new Date() },
			});

			await tx.passwordResetToken.deleteMany({
				where: {
					userId: resetToken.userId,
					id: { not: resetToken.id },
				},
			});
		});

		await this.sessionService.revokeAllUserSessions(resetToken.userId);

		return { message: "Password has been reset successfully." };
	}

	applyAuthCookies(params: {
		response: Parameters<CookieService["setAuthCookies"]>[0]["response"];
		accessToken: string;
		refreshToken: string;
		rememberMe: boolean;
	}): void {
		this.cookieService.setAuthCookies({
			response: params.response,
			accessToken: params.accessToken,
			refreshToken: params.refreshToken,
			rememberMe: params.rememberMe,
		});
	}

	private async issueEmailVerificationToken(
		userId: string,
		email: string,
		displayName?: string,
	): Promise<void> {
		const rawToken = randomBytes(48).toString("base64url");
		const tokenHash = this.tokenService.hashToken(rawToken);
		const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000);

		await this.db.$transaction(async (tx: any) => {
			await tx.emailVerificationToken.deleteMany({ where: { userId } });
			await tx.emailVerificationToken.create({
				data: {
					userId,
					tokenHash,
					expiresAt,
				},
			});
		});

		await this.mailService.sendVerificationEmail({
			to: email,
			displayName,
			token: rawToken,
		});
	}

	private async buildUniqueHandle(displayName: string): Promise<string> {
		const baseHandle = sanitizeHandle(displayName);
		let candidate = baseHandle;

		for (let index = 0; index < 20; index += 1) {
			const existing = await this.db.userProfile.findUnique({
				where: { handle: candidate },
				select: { userId: true },
			});

			if (!existing) {
				return candidate;
			}

			candidate = `${baseHandle}_${Math.floor(Math.random() * 10_000)}`.slice(
				0,
				30,
			);
		}

		return `${baseHandle}_${Date.now().toString(36)}`.slice(0, 30);
	}
}
