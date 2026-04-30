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

jest.mock("argon2");

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  userSession: { updateMany: jest.fn() },
  track: { updateMany: jest.fn() },
  playlist: { updateMany: jest.fn() },
  moderationAction: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotificationsService = {
  createNotification: jest.fn(),
};

const ADMIN_ID = "admin-uuid-1";
const TARGET_ID = "user-uuid-2";

const makeTargetUser = (overrides = {}) => ({
  id: TARGET_ID,
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
      ],
    }).compile();

    service = module.get<UserEnforcementService>(UserEnforcementService);
    jest.clearAllMocks();
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
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        makeTargetUser({ systemRole: "ADMIN" }),
      );
      await expect(
        service.warnUser(ADMIN_ID, TARGET_ID, {
          reason: "test",
          currentPassword: "pw",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ConflictException when target is already BANNED", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        makeTargetUser({ accountStatus: "BANNED" }),
      );
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
      mockNotificationsService.createNotification.mockResolvedValueOnce(
        undefined,
      );

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
      mockNotificationsService.createNotification.mockResolvedValueOnce(
        undefined,
      );

      await service.warnUser(ADMIN_ID, TARGET_ID, {
        reason: "spam",
        currentPassword: "correct-pw",
      });

      expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: TARGET_ID, actorId: ADMIN_ID }),
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
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        makeTargetUser({ systemRole: "ADMIN" }),
      );
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
      mockNotificationsService.createNotification.mockResolvedValueOnce(
        undefined,
      );

      const result = await service.suspendUser(ADMIN_ID, TARGET_ID, {
        reason: "abuse",
        currentPassword: "correct-pw",
        durationDays: 7,
      });
      expect(result.action_type).toBe("SUSPEND_USER");
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
      mockNotificationsService.createNotification.mockResolvedValueOnce(
        undefined,
      );

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
      mockPrisma.user.findUnique.mockResolvedValueOnce(
        makeTargetUser({ accountStatus: "BANNED" }),
      );
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
      mockNotificationsService.createNotification.mockResolvedValueOnce(
        undefined,
      );

      const result = await service.banUser(ADMIN_ID, TARGET_ID, {
        reason: "severe violation",
        currentPassword: "pw",
      });

      expect(result.tracks_hidden).toBe(5);
      expect(result.action_type).toBe("BAN_USER");
    });
  });

  // ─── restoreUser ─────────────────────────────────────────────────────────────

  describe("restoreUser", () => {
    it("throws ForbiddenException on self-restore", async () => {
      await expect(
        service.restoreUser(ADMIN_ID, ADMIN_ID, { reason: "test" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ConflictException when user is already ACTIVE", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(makeTargetUser());
      await expect(
        service.restoreUser(ADMIN_ID, TARGET_ID, { reason: "test" }),
      ).rejects.toThrow(ConflictException);
    });

    it("restores user and content when restoreContent=true", async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(makeTargetUser({ accountStatus: "BANNED" }))
        .mockResolvedValueOnce(makeAdmin());
      mockPrisma.$transaction.mockResolvedValueOnce([
        { count: 3 },
        { count: 1 },
      ]);
      mockPrisma.user.update.mockResolvedValueOnce({});
      mockPrisma.moderationAction.create.mockResolvedValueOnce({
        id: "a4",
        actionType: "RESTORE_CONTENT",
        createdAt: new Date(),
      });
      mockNotificationsService.createNotification.mockResolvedValueOnce(
        undefined,
      );

      const result = await service.restoreUser(ADMIN_ID, TARGET_ID, {
        reason: "appeal approved",
        restoreContent: true,
      });

      expect(result.tracks_restored).toBe(3);
      expect(result.playlists_restored).toBe(1);
    });
  });
});
