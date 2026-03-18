import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service";
import { Gender } from "./dto/auth.dto";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "./services/token.service";
import { RecaptchaService } from "./services/recaptcha.service";
import { SessionManagementService } from "./services/session-management.service";
import { MailService } from "../mail/mail.service";
import { CookieService } from "./services/cookie.service";

jest.mock("argon2", () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

type MockDb = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  userProfile: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  authIdentity: {
    create: jest.Mock;
  };
  emailVerificationToken: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  passwordResetToken: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function buildDbMock(): MockDb {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    authIdentity: {
      create: jest.fn(),
    },
    emailVerificationToken: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    passwordResetToken: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe("AuthService", () => {
  let service: AuthService;
  let db: MockDb;
  let recaptchaService: jest.Mocked<RecaptchaService>;
  let tokenService: jest.Mocked<TokenService>;
  let sessionManagementService: jest.Mocked<SessionManagementService>;
  let mailService: jest.Mocked<MailService>;

  beforeEach(async () => {
    db = buildDbMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: db,
        },
        {
          provide: TokenService,
          useValue: {
            hashToken: jest.fn().mockImplementation((v: string) => `hash-${v}`),
            signAccessToken: jest.fn().mockReturnValue("access-token"),
            createRefreshToken: jest.fn().mockReturnValue({
              rawToken: "refresh-token",
              tokenHash: "refresh-hash",
              expiresAt: new Date("2030-01-01T00:00:00.000Z"),
            }),
          },
        },
        {
          provide: RecaptchaService,
          useValue: {
            verifyToken: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: SessionManagementService,
          useValue: {
            createSession: jest.fn().mockResolvedValue({ sessionId: "session-1" }),
            deleteUserSessions: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
            sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CookieService,
          useValue: {
            setAuthCookies: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    recaptchaService = module.get(RecaptchaService);
    tokenService = module.get(TokenService);
    sessionManagementService = module.get(SessionManagementService);
    mailService = module.get(MailService);

    db.$transaction.mockImplementation(async (cb: (tx: MockDb) => Promise<unknown>) =>
      cb(db),
    );

    (argon2.hash as jest.Mock).mockResolvedValue("argon-hash");
    (argon2.verify as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("creates user/profile and sends verification email", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.userProfile.findUnique.mockResolvedValue(null);
      db.user.create.mockResolvedValue({ id: "user-1" });

      const result = await service.register(
        {
          email: "new@user.com",
          password: "SecureP@ss1",
          password_confirm: "SecureP@ss1",
          display_name: "New User",
          date_of_birth: "2000-01-01",
          gender: Gender.MALE,
          captchaToken: "captcha-token",
        },
        { ipAddress: "1.1.1.1", userAgent: "UA" },
      );

      expect(recaptchaService.verifyToken).toHaveBeenCalledWith(
        "captcha-token",
        "1.1.1.1",
      );
      expect(db.user.create).toHaveBeenCalled();
      expect(db.userProfile.create).toHaveBeenCalled();
      expect(db.authIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: "LOCAL" }),
        }),
      );
      expect(db.emailVerificationToken.create).toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).toHaveBeenCalled();
      expect(result.message).toContain("Registration successful");
    });

    it("throws conflict when email already exists", async () => {
      db.user.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.register(
          {
            email: "existing@user.com",
            password: "SecureP@ss1",
            password_confirm: "SecureP@ss1",
            display_name: "Existing",
            date_of_birth: "2000-01-01",
            gender: Gender.MALE,
            captchaToken: "captcha-token",
          },
          { ipAddress: "1.1.1.1", userAgent: "UA" },
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("verifyEmail", () => {
    it("throws when token is invalid", async () => {
      db.emailVerificationToken.findFirst.mockResolvedValue(null);

      await expect(service.verifyEmail({ token: "bad" })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("marks user as verified and consumes token", async () => {
      db.emailVerificationToken.findFirst.mockResolvedValue({
        id: "evt-1",
        userId: "user-1",
      });

      const result = await service.verifyEmail({ token: "good-token" });

      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: { isVerified: true },
        }),
      );
      expect(db.emailVerificationToken.update).toHaveBeenCalled();
      expect(result.message).toContain("verified");
    });
  });

  describe("resendVerification", () => {
    it("returns generic response and sends for unverified user", async () => {
      db.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "u@test.com",
        isVerified: false,
        profile: { displayName: "U" },
      });

      const result = await service.resendVerification({ email: "u@test.com" });

      expect(db.emailVerificationToken.create).toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).toHaveBeenCalled();
      expect(result.message).toContain("If the account exists");
    });

    it("does not send when account is already verified", async () => {
      db.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "u@test.com",
        isVerified: true,
        profile: { displayName: "U" },
      });

      await service.resendVerification({ email: "u@test.com" });

      expect(mailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("throws unauthorized on bad password", async () => {
      db.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "u@test.com",
        passwordHash: "stored-hash",
        isVerified: true,
        accountStatus: "ACTIVE",
        systemRole: "USER",
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login(
          { email: "u@test.com", password: "wrong", remember_me: false },
          { ipAddress: "2.2.2.2", userAgent: "UA" },
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("returns tokens and stores session on success", async () => {
      db.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "u@test.com",
        passwordHash: "stored-hash",
        isVerified: true,
        accountStatus: "ACTIVE",
        systemRole: "USER",
      });

      const result = await service.login(
        { email: "u@test.com", password: "CorrectP@ss1", remember_me: true },
        { ipAddress: "2.2.2.2", userAgent: "UA" },
      );

      expect(tokenService.signAccessToken).toHaveBeenCalledWith({
        sub: "user-1",
        role: "USER",
      });
      expect(tokenService.createRefreshToken).toHaveBeenCalledWith(true);
      expect(sessionManagementService.createSession).toHaveBeenCalled();
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } }),
      );
      expect(result.accessToken).toBe("access-token");
      expect(result.refreshToken).toBe("refresh-token");
    });
  });

  describe("forgotPassword", () => {
    it("returns generic message even if user does not exist", async () => {
      db.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: "missing@test.com" });

      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(result.message).toContain("If the email exists");
    });

    it("creates token and sends reset email when account exists", async () => {
      db.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "u@test.com",
        passwordHash: "stored-hash",
        profile: { displayName: "U" },
      });

      await service.forgotPassword({ email: "u@test.com" });

      expect(db.passwordResetToken.deleteMany).toHaveBeenCalled();
      expect(db.passwordResetToken.create).toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalled();
    });
  });

  describe("resetPassword", () => {
    it("throws when token is invalid", async () => {
      db.passwordResetToken.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: "bad",
          new_password: "NewSecureP@ss1",
          new_password_confirm: "NewSecureP@ss1",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("updates password, consumes token, and revokes sessions", async () => {
      db.passwordResetToken.findFirst.mockResolvedValue({
        id: "prt-1",
        userId: "user-1",
      });

      const result = await service.resetPassword({
        token: "good-token",
        new_password: "NewSecureP@ss1",
        new_password_confirm: "NewSecureP@ss1",
      });

      expect(argon2.hash).toHaveBeenCalledWith("NewSecureP@ss1");
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } }),
      );
      expect(db.passwordResetToken.update).toHaveBeenCalled();
      expect(sessionManagementService.deleteUserSessions).toHaveBeenCalledWith("user-1");
      expect(result.message).toContain("Password has been reset");
    });
  });
});
