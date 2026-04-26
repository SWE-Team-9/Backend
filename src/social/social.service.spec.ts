import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SocialService } from "./social.service";
import { PrismaService } from "../prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";

function buildPrismaMock() {
  const prismaMock: any = {
    $transaction: jest
      .fn()
      .mockImplementation((ops: Array<Promise<unknown>>) => Promise.all(ops)),
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    userBlock: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    userFollow: {
      create: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    userFavoriteGenre: {
      findMany: jest.fn(),
    },
  };

  return prismaMock;
}

describe("SocialService", () => {
  let service: SocialService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(() => {
    prisma = buildPrismaMock();
    eventEmitter = { emit: jest.fn() };
    service = new SocialService(prisma as unknown as PrismaService, eventEmitter as unknown as EventEmitter2);
  });

  describe("followUser", () => {
    it("follows target user and returns expected payload", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_target", deletedAt: null });
      prisma.userBlock.findUnique.mockResolvedValue(null);
      prisma.userFollow.create.mockResolvedValue({});
      prisma.userFollow.count.mockResolvedValue(3);

      await expect(service.followUser("usr_me", "usr_target")).resolves.toEqual({
        message: "User followed successfully",
        targetUserId: "usr_target",
        followersCount: 3,
        isFollowing: true,
      });
    });

    it("throws BadRequestException when user follows themselves", async () => {
      await expect(service.followUser("usr_me", "usr_me")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("unfollowUser", () => {
    it("unfollows target user and returns expected payload", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_target", deletedAt: null });
      prisma.userFollow.findUnique.mockResolvedValue({ followerId: "usr_me" });
      prisma.userFollow.delete.mockResolvedValue({});

      await expect(service.unfollowUser("usr_me", "usr_target")).resolves.toEqual({
        message: "User unfollowed successfully",
        targetUserId: "usr_target",
        isFollowing: false,
      });
    });

    it("throws NotFoundException when relation does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_target", deletedAt: null });
      prisma.userFollow.findUnique.mockResolvedValue(null);

      await expect(service.unfollowUser("usr_me", "usr_target")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getFollowers", () => {
    it("returns paginated followers", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_target", deletedAt: null });
      prisma.userFollow.count.mockResolvedValue(1);
      prisma.userFollow.findMany.mockResolvedValue([
        {
          follower: {
            id: "usr_f1",
            profile: {
              displayName: "Follower One",
              handle: "follower-one",
              avatarUrl: null,
            },
          },
        },
      ]);

      const result = await service.getFollowers("usr_target", { page: 1, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.followers[0]).toMatchObject({
        id: "usr_f1",
        display_name: "Follower One",
      });
    });
  });

  describe("getFollowing", () => {
    it("returns paginated following", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_me", deletedAt: null });
      prisma.userFollow.count.mockResolvedValue(1);
      prisma.userFollow.findMany.mockResolvedValue([
        {
          following: {
            id: "usr_t1",
            profile: {
              displayName: "Target One",
              handle: "target-one",
              avatarUrl: null,
            },
          },
        },
      ]);

      const result = await service.getFollowing("usr_me", { page: 1, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.following[0]).toMatchObject({
        id: "usr_t1",
        display_name: "Target One",
      });
    });
  });

  describe("getSuggestions", () => {
    it("returns suggestions list", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_me", deletedAt: null });
      prisma.userFollow.findMany.mockResolvedValue([]);
      prisma.userBlock.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.userFavoriteGenre.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: "usr_s1",
          profile: { displayName: "Suggest One", handle: "suggest-one", avatarUrl: null },
          favoriteGenres: [],
        },
      ]);

      const result = await service.getSuggestions("usr_me", { limit: 10 });
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toMatchObject({ id: "usr_s1" });
    });
  });

  describe("blockUser", () => {
    it("blocks target user and returns expected payload", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_target", deletedAt: null });
      prisma.userBlock.upsert.mockResolvedValue({});
      prisma.userFollow.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.blockUser("usr_me", "usr_target")).resolves.toEqual({
        message: "User blocked successfully",
        blockedUserId: "usr_target",
      });
    });

    it("throws BadRequestException when user blocks themselves", async () => {
      await expect(service.blockUser("usr_me", "usr_me")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("unblockUser", () => {
    it("unblocks target user and returns expected payload", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_target", deletedAt: null });
      prisma.userBlock.findUnique.mockResolvedValue({ blockerId: "usr_me" });
      prisma.userBlock.delete.mockResolvedValue({});

      await expect(service.unblockUser("usr_me", "usr_target")).resolves.toEqual({
        message: "User unblocked successfully",
        blockedUserId: "usr_target",
      });
    });
  });

  describe("getBlockedUsers", () => {
    it("returns paginated blocked users", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "usr_me", deletedAt: null });
      prisma.userBlock.count.mockResolvedValue(1);
      prisma.userBlock.findMany.mockResolvedValue([
        {
          createdAt: new Date("2026-04-05T00:00:00.000Z"),
          blocked: {
            id: "usr_b1",
            profile: {
              displayName: "Blocked One",
              handle: "blocked-one",
              avatarUrl: null,
            },
          },
        },
      ]);

      const result = await service.getBlockedUsers("usr_me", { page: 1, limit: 20 });
      expect(result.total).toBe(1);
      expect(result.blockedUsers[0]).toMatchObject({
        id: "usr_b1",
        display_name: "Blocked One",
      });
    });
  });
});
