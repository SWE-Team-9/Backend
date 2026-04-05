import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { SocialService } from "./social.service";

describe("SocialService", () => {
  let service: SocialService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    userBlock: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    userFollow: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialService(prismaMock);
  });

  // ── blockUser ───────────────────────────────────────────────────────────
  describe("blockUser", () => {
    it("should block a user successfully", async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
        id: "target-uuid",
      });
      (prismaMock.userBlock.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        { count: 0 },
        { count: 0 },
        { blockerId: "blocker-uuid", blockedId: "target-uuid" },
      ]);

      const result = await service.blockUser("blocker-uuid", "target-uuid");

      expect(result).toEqual({
        message: "User blocked successfully",
        blockedUserId: "target-uuid",
      });
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it("should throw ForbiddenException when blocking self", async () => {
      await expect(
        service.blockUser("user-uuid", "user-uuid"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("should throw NotFoundException when target user does not exist", async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.blockUser("blocker-uuid", "missing-uuid"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should throw ConflictException when user is already blocked", async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue({
        id: "target-uuid",
      });
      (prismaMock.userBlock.findUnique as jest.Mock).mockResolvedValue({
        blockerId: "blocker-uuid",
        blockedId: "target-uuid",
      });

      await expect(
        service.blockUser("blocker-uuid", "target-uuid"),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── unblockUser ─────────────────────────────────────────────────────────
  describe("unblockUser", () => {
    it("should unblock a user successfully", async () => {
      (prismaMock.userBlock.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.unblockUser("blocker-uuid", "target-uuid");

      expect(result).toEqual({
        message: "User unblocked successfully",
        blockedUserId: "target-uuid",
      });
    });

    it("should throw NotFoundException when user is not blocked", async () => {
      (prismaMock.userBlock.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await expect(
        service.unblockUser("blocker-uuid", "target-uuid"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getBlockedUsers ─────────────────────────────────────────────────────
  describe("getBlockedUsers", () => {
    it("should return paginated blocked users", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            createdAt: new Date("2026-03-07T11:00:00Z"),
            blocked: {
              id: "blocked-uuid",
              profile: {
                displayName: "Blocked User",
                handle: "blocked-user",
                avatarUrl: null,
              },
            },
          },
        ],
      ]);

      const result = await service.getBlockedUsers("user-uuid", 1, 20);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(1);
      expect(result.blockedUsers).toHaveLength(1);
      expect(result.blockedUsers[0].id).toBe("blocked-uuid");
      expect(result.blockedUsers[0].display_name).toBe("Blocked User");
      expect(result.blockedUsers[0].handle).toBe("blocked-user");
    });

    it("should return empty when no blocked users", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([0, []]);

      const result = await service.getBlockedUsers("user-uuid", 1, 20);

      expect(result.total).toBe(0);
      expect(result.blockedUsers).toEqual([]);
    });

    it("should cap limit at 100", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([0, []]);

      const result = await service.getBlockedUsers("user-uuid", 1, 999);

      expect(result.limit).toBe(100);
    });

    it("should handle user with null profile", async () => {
      (prismaMock.$transaction as jest.Mock).mockResolvedValue([
        1,
        [
          {
            createdAt: new Date(),
            blocked: {
              id: "blocked-uuid",
              profile: null,
            },
          },
        ],
      ]);

      const result = await service.getBlockedUsers("user-uuid", 1, 20);

      expect(result.blockedUsers[0].display_name).toBeNull();
      expect(result.blockedUsers[0].handle).toBeNull();
      expect(result.blockedUsers[0].avatar_url).toBeNull();
    });
  });
});
