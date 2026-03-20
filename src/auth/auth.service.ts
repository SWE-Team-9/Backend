import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import * as crypto from "crypto";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { TokenService } from "./services/token.service";
import { SessionService } from "./services/session.service";
import { RecaptchaService } from "./services/recaptcha.service";

import {
  RegisterDto,
  LoginDto,
  ResetPasswordDto,
  ChangePasswordDto,
  RequestEmailChangeDto,
} from "./dto/auth.dto";

// Token expiry durations
const EMAIL_VERIFY_EXPIRY_HOURS = 24;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const EMAIL_CHANGE_EXPIRY_HOURS = 1;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly recaptchaService: RecaptchaService,
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 1: Register
  // ═══════════════════════════════════════════════════════════════════════════
  async register(dto: RegisterDto, ip?: string) {
    // Verify CAPTCHA
    await this.recaptchaService.verify(dto.captcha_token, ip);

    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException({
        statusCode: 409,
        error: "EMAIL_ALREADY_EXISTS",
        message: "An account with this email already exists.",
      });
    }

    // Hash the password
    const passwordHash = await argon2.hash(dto.password);

    // Generate verification token before the transaction so it's ready to store atomically
    const rawVerificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.tokenService.hashToken(rawVerificationToken);
    const tokenExpiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRY_HOURS * 60 * 60 * 1000);

    // Create user, profile, auth identity, AND email token in one transaction.
    // If anything here fails the entire insert is rolled back — no orphaned rows.
    const user = await this.prisma.$transaction(async (tx: any) => {
      // Create the user
      const newUser = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          dateOfBirth: new Date(dto.date_of_birth),
          gender: dto.gender,
          isVerified: false,
        },
      });

      // Create user profile with auto-generated handle
      const handle = await this.buildUniqueHandle(dto.display_name, tx);
      await tx.userProfile.create({
        data: {
          userId: newUser.id,
          handle,
          displayName: dto.display_name,
        },
      });

      // Create local auth identity
      await tx.authIdentity.create({
        data: {
          userId: newUser.id,
          provider: "LOCAL",
        },
      });

      // Create email verification token inside the transaction so it rolls back
      // together with the user if anything goes wrong.
      await tx.emailVerificationToken.create({
        data: {
          userId: newUser.id,
          tokenHash,
          expiresAt: tokenExpiresAt,
        },
      });

      return newUser;
    });

    // Send verification email AFTER the transaction commits (non-fatal — user
    // can always request a resend via /auth/resend-verification).
    await this.sendVerificationEmail(dto.email, dto.display_name, rawVerificationToken);

    return {
      message: "Registration successful. Please check your email to verify your account.",
      user: {
        id: user.id,
        email: user.email,
        display_name: dto.display_name,
        is_verified: false,
        created_at: user.createdAt,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 2: Verify Email
  // ═══════════════════════════════════════════════════════════════════════════
  async verifyEmail(token: string) {
    const tokenHash = this.tokenService.hashToken(token);

    // Find the token
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.consumedAt) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_TOKEN",
        message: "This verification link is invalid or has already been used.",
      });
    }

    if (record.expiresAt < new Date()) {
      throw new GoneException({
        statusCode: 410,
        error: "TOKEN_EXPIRED",
        message: "This verification link has expired. Please request a new one.",
      });
    }

    if (record.user.isVerified) {
      throw new ConflictException({
        statusCode: 409,
        error: "ALREADY_VERIFIED",
        message: "This account is already verified.",
      });
    }

    // Mark user as verified and consume the token
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { isVerified: true },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    return { message: "Email verified successfully. You can now log in." };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 3: Resend Verification Email
  // ═══════════════════════════════════════════════════════════════════════════
  async resendVerification(email: string) {
    // Always return success to prevent email enumeration
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { profile: true },
    });

    if (user && !user.isVerified) {
      // Invalidate old verification tokens
      await this.prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      // Create a fresh token then send the email
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = this.tokenService.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRY_HOURS * 60 * 60 * 1000);

      await this.prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      await this.sendVerificationEmail(user.email, user.profile?.displayName, rawToken);
    }

    return {
      message: "If an unverified account with this email exists, a new verification link has been sent.",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 4: Login
  // ═══════════════════════════════════════════════════════════════════════════
  async login(dto: LoginDto, ip: string, userAgent: string) {
    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { profile: true },
    });

    // If user doesn't exist, still hash to prevent timing attacks
    if (!user) {
      await argon2.hash("dummy-password-for-timing-safety");
      throw new UnauthorizedException({
        statusCode: 401,
        error: "INVALID_CREDENTIALS",
        message: "The email or password you entered is incorrect.",
      });
    }

    // Check password
    if (!user.passwordHash) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "INVALID_CREDENTIALS",
        message: "The email or password you entered is incorrect.",
      });
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "INVALID_CREDENTIALS",
        message: "The email or password you entered is incorrect.",
      });
    }

    // Check if email is verified
    if (!user.isVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before logging in.",
      });
    }

    // Check account status
    if (user.accountStatus === "SUSPENDED") {
      throw new ForbiddenException({
        statusCode: 403,
        error: "ACCOUNT_SUSPENDED",
        message: `Your account is suspended until ${user.suspendedUntil?.toISOString() ?? "further notice"}.`,
      });
    }
    if (user.accountStatus === "BANNED") {
      throw new ForbiddenException({
        statusCode: 403,
        error: "ACCOUNT_BANNED",
        message: "Your account has been permanently banned.",
      });
    }

    // Create tokens and session
    const accessToken = this.tokenService.signAccessToken(user.id, user.systemRole);
    const { raw: refreshToken, hash: refreshTokenHash } = this.tokenService.createRefreshToken();

    const sessionId = await this.sessionService.createSession({
      userId: user.id,
      refreshTokenHash,
      ipAddress: ip,
      userAgent,
      rememberMe: dto.remember_me,
    });

    // Update last login time
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      sessionId,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.profile?.displayName ?? "",
        handle: user.profile?.handle ?? "",
        avatar_url: user.profile?.avatarUrl ?? null,
        account_type: user.profile?.accountType ?? "LISTENER",
        system_role: user.systemRole,
        is_verified: user.isVerified,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoints 5 & 6: Google OAuth Login
  // ═══════════════════════════════════════════════════════════════════════════
  async googleLogin(
    googleUser: {
      googleId: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
    },
    ip: string,
    userAgent: string,
  ) {
    const email = googleUser.email.toLowerCase();

    // Case A: Check if Google identity already exists
    const authIdentity = await this.prisma.authIdentity.findFirst({
      where: {
        provider: "GOOGLE",
        providerUserId: googleUser.googleId,
      },
      include: { user: { include: { profile: true } } },
    });

    let user: any;

    if (authIdentity) {
      // Existing Google user — just log them in
      user = authIdentity.user;
    } else {
      // Case B: Check if a user with this email already exists (registered via email)
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
        include: { profile: true },
      });

      if (existingUser) {
        // Link Google identity to existing account
        await this.prisma.authIdentity.create({
          data: {
            userId: existingUser.id,
            provider: "GOOGLE",
            providerUserId: googleUser.googleId,
            providerEmail: email,
          },
        });
        user = existingUser;
      } else {
        // Case C: Brand new user — create everything
        user = await this.prisma.$transaction(async (tx: any) => {
          const newUser = await tx.user.create({
            data: {
              email,
              isVerified: true, // Google already verified the email
              dateOfBirth: new Date("2000-01-01"), // Placeholder
              gender: "PREFER_NOT_TO_SAY",
            },
          });

          const handle = await this.buildUniqueHandle(googleUser.displayName, tx);
          await tx.userProfile.create({
            data: {
              userId: newUser.id,
              handle,
              displayName: googleUser.displayName,
              avatarUrl: googleUser.avatarUrl,
            },
          });

          await tx.authIdentity.create({
            data: {
              userId: newUser.id,
              provider: "GOOGLE",
              providerUserId: googleUser.googleId,
              providerEmail: email,
            },
          });

          return {
            ...newUser,
            profile: {
              handle,
              displayName: googleUser.displayName,
              avatarUrl: googleUser.avatarUrl,
              accountType: "LISTENER",
            },
          };
        });
      }
    }

    // Create tokens and session
    const accessToken = this.tokenService.signAccessToken(user.id, user.systemRole ?? "USER");
    const { raw: refreshToken, hash: refreshTokenHash } = this.tokenService.createRefreshToken();

    await this.sessionService.createSession({
      userId: user.id,
      refreshTokenHash,
      ipAddress: ip,
      userAgent,
    });

    // Update last login time
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { accessToken, refreshToken };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 7: Refresh Token
  // ═══════════════════════════════════════════════════════════════════════════
  async refresh(refreshTokenRaw: string) {
    const tokenHash = this.tokenService.hashToken(refreshTokenRaw);

    // Find active session with this token
    const session = await this.sessionService.findActiveSessionByHash(tokenHash);

    if (!session) {
      // Token reuse detection: if this hash belongs to a revoked session,
      // someone is replaying an old token -> revoke ALL sessions for safety
      const revokedSession = await this.sessionService.wasTokenReusedFromRevokedSession(tokenHash);
      if (revokedSession) {
        this.logger.warn(`Refresh token reuse detected for user ${revokedSession.userId}. Revoking all sessions.`);
        await this.sessionService.revokeAllUserSessions(revokedSession.userId);
        throw new UnauthorizedException({
          statusCode: 401,
          error: "TOKEN_REUSE_DETECTED",
          message: "A previously used refresh token was reused. All sessions have been revoked for security.",
        });
      }

      throw new UnauthorizedException({
        statusCode: 401,
        error: "INVALID_REFRESH_TOKEN",
        message: "Invalid or expired refresh token.",
      });
    }

    // Check account status
    if (session.user.accountStatus === "SUSPENDED") {
      throw new ForbiddenException({
        statusCode: 403,
        error: "ACCOUNT_SUSPENDED",
        message: "Your account has been suspended.",
      });
    }

    // Rotate the refresh token
    const { raw: newRefreshToken, hash: newHash } = this.tokenService.createRefreshToken();
    const newSessionId = await this.sessionService.rotateRefreshToken(session, newHash);

    // Sign a new access token
    const accessToken = this.tokenService.signAccessToken(
      session.user.id,
      session.user.systemRole,
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      sessionId: newSessionId,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 8: Logout
  // ═══════════════════════════════════════════════════════════════════════════
  async logout(refreshTokenRaw: string | undefined) {
    if (refreshTokenRaw) {
      const tokenHash = this.tokenService.hashToken(refreshTokenRaw);
      const session = await this.sessionService.findActiveSessionByHash(tokenHash);
      if (session) {
        await this.sessionService.revokeSession(session.id);
      }
    }
    return { message: "Logged out successfully" };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 9: Logout All Devices
  // ═══════════════════════════════════════════════════════════════════════════
  async logoutAll(userId: string) {
    const revokedCount = await this.sessionService.revokeAllUserSessions(userId);
    return {
      message: "All sessions have been revoked. You have been logged out of all devices.",
      revoked_count: revokedCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 10: Forgot Password
  // ═══════════════════════════════════════════════════════════════════════════
  async forgotPassword(email: string) {
    // Always return success to prevent email enumeration
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { profile: true },
    });

    if (user) {
      // Invalidate old reset tokens
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      // Create a new reset token
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = this.tokenService.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      // Send the reset email
      try {
        await this.mailService.sendPasswordResetEmail({
          to: user.email,
          displayName: user.profile?.displayName,
          token: rawToken,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to send password reset email to ${user.email}: ${(err as Error).message}`,
        );
      }
    }

    return {
      message: "If an account with this email exists, a password reset link has been sent.",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 11: Reset Password
  // ═══════════════════════════════════════════════════════════════════════════
  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.tokenService.hashToken(dto.token);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.consumedAt) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_TOKEN",
        message: "This reset link is invalid or has already been used.",
      });
    }

    if (record.expiresAt < new Date()) {
      throw new GoneException({
        statusCode: 410,
        error: "TOKEN_EXPIRED",
        message: "This reset link has expired. Please request a new one.",
      });
    }

    // Hash new password and update
    const passwordHash = await argon2.hash(dto.new_password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    // Revoke all sessions (force re-login)
    await this.sessionService.revokeAllUserSessions(record.userId);

    return { message: "Password reset successful. Please log in with your new password." };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 12: Change Password
  // ═══════════════════════════════════════════════════════════════════════════
  async changePassword(userId: string, currentSessionId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "NOT_AUTHENTICATED",
        message: "User not found.",
      });
    }

    // Verify current password
    const currentValid = await argon2.verify(user.passwordHash, dto.current_password);
    if (!currentValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "INCORRECT_PASSWORD",
        message: "The current password you entered is incorrect.",
      });
    }

    // Check that new password is different from current
    if (dto.current_password === dto.new_password) {
      throw new BadRequestException({
        statusCode: 400,
        error: "VALIDATION_FAILED",
        message: "New password must be different from your current password.",
      });
    }

    // Hash and update
    const passwordHash = await argon2.hash(dto.new_password);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Revoke all OTHER sessions (keep current one active)
    await this.sessionService.revokeOtherSessions(userId, currentSessionId);

    return { message: "Password changed successfully. All other sessions have been revoked." };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 13: Request Email Change
  // ═══════════════════════════════════════════════════════════════════════════
  async requestEmailChange(userId: string, dto: RequestEmailChangeDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "NOT_AUTHENTICATED",
        message: "User not found.",
      });
    }

    // Verify current password
    const valid = await argon2.verify(user.passwordHash, dto.current_password);
    if (!valid) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "INCORRECT_PASSWORD",
        message: "The current password you entered is incorrect.",
      });
    }

    // Check if new email is already taken
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: dto.new_email.toLowerCase() },
    });
    if (emailTaken) {
      throw new ConflictException({
        statusCode: 409,
        error: "EMAIL_ALREADY_EXISTS",
        message: "This email is already used by another account.",
      });
    }

    // Invalidate old email change requests
    await this.prisma.emailChangeRequest.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // Create new email change request
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.tokenService.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_HOURS * 60 * 60 * 1000);

    await this.prisma.emailChangeRequest.create({
      data: {
        userId,
        newEmail: dto.new_email.toLowerCase(),
        tokenHash,
        expiresAt,
      },
    });

    // Send confirmation email to the NEW address
    try {
      await this.mailService.sendEmailChangeVerificationEmail({
        to: dto.new_email,
        displayName: user.profile?.displayName,
        token: rawToken,
        newEmail: dto.new_email,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send email change confirmation to ${dto.new_email}: ${(err as Error).message}`,
      );
    }

    return {
      message: "A confirmation link has been sent to your new email address. The link expires in 1 hour.",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 14: Confirm Email Change
  // ═══════════════════════════════════════════════════════════════════════════
  async confirmEmailChange(token: string) {
    const tokenHash = this.tokenService.hashToken(token);

    const record = await this.prisma.emailChangeRequest.findUnique({
      where: { tokenHash },
    });

    if (!record || record.consumedAt) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_TOKEN",
        message: "This confirmation link is invalid or has already been used.",
      });
    }

    if (record.expiresAt < new Date()) {
      throw new GoneException({
        statusCode: 410,
        error: "TOKEN_EXPIRED",
        message: "This confirmation link has expired.",
      });
    }

    // Final check: make sure nobody took the email in the meantime
    const emailTaken = await this.prisma.user.findUnique({
      where: { email: record.newEmail },
    });
    if (emailTaken) {
      throw new ConflictException({
        statusCode: 409,
        error: "EMAIL_ALREADY_EXISTS",
        message: "This email has been taken by another account since you requested the change.",
      });
    }

    // Apply the email change
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { email: record.newEmail },
      }),
      this.prisma.emailChangeRequest.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    // Revoke all sessions (force re-login with new email)
    await this.sessionService.revokeAllUserSessions(record.userId);

    return { message: "Email changed successfully. Please log in with your new email." };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 15: Get Current User
  // ═══════════════════════════════════════════════════════════════════════════
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          include: { plan: true },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: "NOT_AUTHENTICATED",
        message: "User not found.",
      });
    }

    const activeSub = user.subscriptions[0];

    return {
      id: user.id,
      email: user.email,
      display_name: user.profile?.displayName ?? "",
      handle: user.profile?.handle ?? "",
      avatar_url: user.profile?.avatarUrl ?? null,
      account_type: user.profile?.accountType ?? "LISTENER",
      system_role: user.systemRole,
      is_verified: user.isVerified,
      subscription_tier: activeSub?.plan?.name ?? "FREE",
      created_at: user.createdAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 16: Get Active Sessions
  // ═══════════════════════════════════════════════════════════════════════════
  async getActiveSessions(userId: string, currentRefreshTokenRaw?: string) {
    const sessions = await this.sessionService.getActiveSessions(userId);

    // Figure out which session is the current one
    let currentSessionHash: string | null = null;
    if (currentRefreshTokenRaw) {
      currentSessionHash = this.tokenService.hashToken(currentRefreshTokenRaw);
    }

    return {
      sessions: sessions.map((s: any) => ({
        id: s.id,
        device: {
          platform: s.device?.platform ?? "WEB",
          device_name: s.device?.deviceName ?? "Unknown",
        },
        ip_address: s.ipAddress,
        user_agent: s.userAgent,
        is_current: s.refreshTokenHash === currentSessionHash,
        created_at: s.createdAt,
        expires_at: s.expiresAt,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Endpoint 17: Revoke a Specific Session
  // ═══════════════════════════════════════════════════════════════════════════
  async revokeSession(
    userId: string,
    sessionId: string,
    currentRefreshTokenRaw?: string,
  ) {
    // Find the session
    const session = await this.sessionService.findSessionByIdAndUser(sessionId, userId);
    if (!session) {
      throw new NotFoundException({
        statusCode: 404,
        error: "SESSION_NOT_FOUND",
        message: "Session not found, does not belong to you, or is already revoked.",
      });
    }

    // Don't allow revoking the current session
    if (currentRefreshTokenRaw) {
      const currentHash = this.tokenService.hashToken(currentRefreshTokenRaw);
      if (session.refreshTokenHash === currentHash) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "CANNOT_REVOKE_CURRENT",
          message: "You cannot revoke the session you are currently using. Use the logout endpoint instead.",
        });
      }
    }

    await this.sessionService.revokeSession(sessionId);
    return { message: "Session revoked successfully" };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper: Send verification email (mail only — token already saved to DB)
  // ═══════════════════════════════════════════════════════════════════════════
  private async sendVerificationEmail(
    email: string,
    displayName?: string,
    rawToken?: string,
  ) {
    if (!rawToken) return;
    try {
      await this.mailService.sendVerificationEmail({
        to: email,
        displayName,
        token: rawToken,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send verification email to ${email}: ${(err as Error).message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper: Build a unique handle from a display name
  // ═══════════════════════════════════════════════════════════════════════════
  private async buildUniqueHandle(
    displayName: string,
    tx?: any,
  ): Promise<string> {
    const db = tx || this.prisma;

    // Sanitize: lowercase, replace spaces/special chars with hyphens
    let base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 25);

    if (!base) base = "user";

    // Check if handle is taken, if so add random suffix
    let handle = base;
    let attempts = 0;

    while (attempts < 10) {
      const existing = await db.userProfile.findUnique({
        where: { handle },
      });
      if (!existing) return handle;

      // Add a random 4-digit suffix
      const suffix = Math.floor(1000 + Math.random() * 9000);
      handle = `${base}-${suffix}`;
      attempts++;
    }

    // Fallback: use UUID snippet
    handle = `${base}-${crypto.randomBytes(3).toString("hex")}`;
    return handle;
  }
}
