import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { UserEnforcementService } from "./user-enforcement.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MailService } from "../mail/mail.service";

jest.mock("argon2");

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  userSession: { updateMany: jest.fn() },
  track: { updateMany: jest.fn() },
  playlist: { updateMany: jest.fn() },
  moderationAction: { create: jest.fn() },
  moderationReport: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationsService = {
  createNotification: jest.fn(),
};

const mockMailService = {
  sendAccountWarnedEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountSuspendedEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountBannedEmail: jest.fn().mockResolvedValue(undefined),
  sendAccountRestoredEmail: jest.fn().mockResolvedValue(undefined),
};

const ADMIN_ID = "admin-uuid-1";
const TARGET_ID = "user-uuid-2";

const makeTargetUser = (overrides = {}) => ({
  id: TARGET_ID,
  email: "alice@example.com",
  accountStatus: "ACTIVE",
  systemRole: "USER",
  profile: { displayName: "Alice", handle: "alice" },
  ...overrides,
});

const makeAdmin = (overrides = {}) => ({
  systemRole: "ADMIN",
  passwordHash: "hashed-pw",
  ...overrides,
});

describe("UserEnforcementService", () => {
  let service: UserEnforcementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEnforcementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<UserEnforcementService>(UserEnforcementService);
    jest.clearAllMocks();
    mockPrisma.moderationReport.findUnique.mockResolvedValue(null);
    mockPrisma.moderationReport.update.mockResolvedValue({});
  });

  // ─── warnUser ────────────────────────────────────────────────────────────────

  describe("warnUser", () => {
    it("throws ForbiddenException when admin tries to warn themselves", async () => {
      await expect(
        service.warnUser(ADMIN_ID, ADMIN_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when target user does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.warnUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when target is an ADMIN", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser({ systemRole: "ADMIN" }));
      await expect(
        service.warnUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ConflictException when target is already BANNED", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }));
      await expect(
        service.warnUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws UnauthorizedException when password is incorrect", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser()) // ensureTargetUser
        .mockResolvedValueOnce(makeAdmin()) // reVerifyAdminRole
        .mockResolvedValueOnce(makeAdmin()); // verifyAdminPassword
      (argon2.verify as jest.Mock).mockResolvedValueOnce(false);
      await expect(
        service.warnUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "wrong-pw",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("throws PASSWORD_SETUP_REQUIRED when an admin has no local password", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser()) // ensureTargetUser
        .mockResolvedValueOnce(makeAdmin()) // reVerifyAdminRole
        .mockResolvedValueOnce(makeAdmin({ passwordHash: null })); // verifyAdminPassword

      await expect(
        service.warnUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "google-only-admin",
        }),
      ).rejects.toMatchObject({
        response: {
          code: "PASSWORD_SETUP_REQUIRED",
          message: "Set a local password in Settings before performing sensitive admin actions.",
        },
      });
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it("creates ModerationAction on successful warn", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser()) // ensureTargetUser
        .mockResolvedValueOnce(makeAdmin()) // reVerifyAdminRole
        .mockResolvedValueOnce(makeAdmin()); // verifyAdminPassword
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "action-1",
        actionType: "WARN_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      const result = await service.warnUser(ADMIN_ID, TARGET_ID, {
        reason: "spamming",
        currentPassword: "correct-pw",
      });

      expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: ADMIN_ID,
            targetUserId: TARGET_ID,
            actionType: "WARN_USER",
          }),
        }),
      );
      expect(result.action_type).toBe("WARN_USER");
    });

    it("sends notification to target user after warn", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "action-2",
        actionType: "WARN_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      await service.warnUser(ADMIN_ID, TARGET_ID, {
        reason: "spam",
        currentPassword: "correct-pw",
      });

      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: TARGET_ID, actorId: ADMIN_ID }),
      );
    });

    it("notifies reporter on linked moderation report and does not misroute reporter message to target", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "action-report-link",
        actionType: "WARN_USER",
        createdAt: new Date(),
      });
      mockPrisma.moderationReport.findUnique
        .mockResolvedValueOnce({ id: "report-1", reporterId: "reporter-1", status: "PENDING" });
      mockNotificationsService.createNotification.mockResolvedValue(undefined);

      await service.warnUser(ADMIN_ID, TARGET_ID, {
        reason: "Posting misleading content repeatedly.",
        currentPassword: "correct-pw",
        reportId: "report-1",
      });

      expect(mockPrisma.moderationReport.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "report-1" } }),
      );
      expect(mockNotificationsService.createNotification).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ recipientId: TARGET_ID }),
      );
      expect(mockNotificationsService.createNotification).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          recipientId: "reporter-1",
          eventType: "REPORT_RESOLVED",
          metadata: expect.objectContaining({ outcome: "ACTION_TAKEN" }),
        }),
      );
    });

    it("re-queries the DB for admin systemRole — does not rely on JWT claim", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser()) // ensureTargetUser
        .mockResolvedValueOnce(makeAdmin()) // reVerifyAdminRole
        .mockResolvedValueOnce(makeAdmin()); // verifyAdminPassword
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "action-3",
        actionType: "WARN_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      await service.warnUser(ADMIN_ID, TARGET_ID, {
        reason: "test",
        currentPassword: "correct-pw",
      });

      // reVerifyAdminRole performs a fresh DB lookup for the admin's systemRole field
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ADMIN_ID },
          select: expect.objectContaining({ systemRole: true }),
        }),
      );
    });
  });

  // ─── suspendUser ─────────────────────────────────────────────────────────────

  describe("suspendUser", () => {
    it("throws ForbiddenException on self-suspend", async () => {
      await expect(
        service.suspendUser(ADMIN_ID, ADMIN_ID, {
          reason: "test",
          currentPassword: "pw",
          durationDays: 3,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when target is ADMIN", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser({ systemRole: "ADMIN" }));
      await expect(
        service.suspendUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
          durationDays: 3,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("does NOT throw when target is MODERATOR", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser({ systemRole: "MODERATOR" }))
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a1",
        actionType: "SUSPEND_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      const result = await service.suspendUser(ADMIN_ID, TARGET_ID, {
        reason: "abuse",
        currentPassword: "correct-pw",
        durationDays: 7,
      });
      expect(result.action_type).toBe("SUSPEND_USER");
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "ACCOUNT_SUSPENDED" }),
      );
      expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "LIKE" }),
      );
    });

    it("revokes sessions via updateMany with revokedAt (not deleteMany)", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a2",
        actionType: "SUSPEND_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      await service.suspendUser(ADMIN_ID, TARGET_ID, {
        reason: "abuse",
        currentPassword: "pw",
        durationDays: 3,
      });

      // $transaction should have been called exactly once (for user update + session revocation)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // userSession.updateMany should be called with revokedAt (not deleteMany)
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: TARGET_ID,
            revokedAt: null,
          }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it("sets accountStatus=SUSPENDED and suspendedUntil in the transaction", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a3",
        actionType: "SUSPEND_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      await service.suspendUser(ADMIN_ID, TARGET_ID, {
        reason: "abuse",
        currentPassword: "pw",
        durationDays: 3,
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID },
          data: expect.objectContaining({
            accountStatus: "SUSPENDED",
            suspendedUntil: expect.any(Date),
          }),
        }),
      );
    });

    it("does not fail when notification dispatch errors after suspension", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a3b",
        actionType: "SUSPEND_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockRejectedValueOnce(
        new Error("Notification service unavailable"),
      );

      await expect(
        service.suspendUser(ADMIN_ID, TARGET_ID, {
          reason: "abuse",
          currentPassword: "pw",
          durationDays: 3,
        }),
      ).resolves.toMatchObject({ action_type: "SUSPEND_USER" });
    });
  });

  // ─── banUser ─────────────────────────────────────────────────────────────────

  describe("banUser", () => {
    it("throws ForbiddenException on self-ban", async () => {
      await expect(
        service.banUser(ADMIN_ID, ADMIN_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ConflictException when user is already BANNED", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }));
      await expect(
        service.banUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("hides tracks and playlists and creates BAN_USER action", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.$transaction.mockResolvedValueOnce([
        { count: 5 }, // tracks hidden
        { count: 2 }, // playlists hidden
        {}, // user update
        { count: 3 }, // sessions revoked
      ]);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a3",
        actionType: "BAN_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      const result = await service.banUser(ADMIN_ID, TARGET_ID, {
        reason: "severe violation",
        currentPassword: "pw",
      });

      expect(result.tracks_hidden).toBe(5);
      expect(result.action_type).toBe("BAN_USER");
    });

    it("throws ForbiddenException with code CANNOT_BAN_ADMIN when target is an ADMIN", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser({ systemRole: "ADMIN" }));

      await expect(
        service.banUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CANNOT_BAN_ADMIN" }),
      });
    });

    it("throws ConflictException with code USER_ALREADY_BANNED when user is already banned", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }));

      await expect(
        service.banUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "USER_ALREADY_BANNED" }),
      });
    });

    it("calls track.updateMany and playlist.updateMany with moderationState=HIDDEN", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser())
        .mockResolvedValueOnce(makeAdmin())
        .mockResolvedValueOnce(makeAdmin());
      (argon2.verify as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 2 }, { count: 1 }, {}, { count: 1 }]);
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a4",
        actionType: "BAN_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      await service.banUser(ADMIN_ID, TARGET_ID, {
        reason: "severe violation",
        currentPassword: "pw",
      });

      expect(mockPrisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ moderationState: "HIDDEN" }),
        }),
      );
      expect(mockPrisma.playlist.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ moderationState: "HIDDEN" }),
        }),
      );
    });
  });

  // ─── restoreUser ─────────────────────────────────────────────────────────────

  describe("restoreUser", () => {
    it("throws ForbiddenException on self-restore", async () => {
      await expect(service.restoreUser(ADMIN_ID, ADMIN_ID, { reason: "test" })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ConflictException when user is already ACTIVE", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser());
      await expect(service.restoreUser(ADMIN_ID, TARGET_ID, { reason: "test" })).rejects.toThrow(
        ConflictException,
      );
    });

    it("restores user and content when restoreContent=true", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }))
        .mockResolvedValueOnce(makeAdmin());
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 3 }, { count: 1 }]);
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a4",
        actionType: "RESTORE_CONTENT",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      const result = await service.restoreUser(ADMIN_ID, TARGET_ID, {
        reason: "appeal approved",
        restoreContent: true,
      });

      expect(result.tracks_restored).toBe(3);
      expect(result.playlists_restored).toBe(1);
      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "ACCOUNT_RESTORED" }),
      );
      expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "LIKE" }),
      );
    });

    it("throws ConflictException with code USER_ALREADY_ACTIVE for an ACTIVE user", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser()); // default ACTIVE

      await expect(
        service.restoreUser(ADMIN_ID, TARGET_ID, { reason: "test" }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "USER_ALREADY_ACTIVE" }),
      });
    });

    it("does NOT call $transaction when restoreContent is false", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }))
        .mockResolvedValueOnce(makeAdmin());
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a5",
        actionType: "RESTORE_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

      await service.restoreUser(ADMIN_ID, TARGET_ID, {
        reason: "appeal",
        restoreContent: false,
      });

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.track.updateMany).not.toHaveBeenCalled();
    });

    it("does not fail when notification dispatch errors after restore", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }))
        .mockResolvedValueOnce(makeAdmin());
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a6",
        actionType: "RESTORE_USER",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockRejectedValueOnce(
        new Error("Notification service unavailable"),
      );

      await expect(
        service.restoreUser(ADMIN_ID, TARGET_ID, {
          reason: "appeal",
          restoreContent: false,
        }),
      ).resolves.toMatchObject({ target_user: { account_status: "ACTIVE" } });
    });
  });
});
