import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AdminUsersService } from "./admin-users.service";
import { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  userProfile: { count: jest.fn() },
  moderationAction: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  moderationReport: {
    aggregate: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  report: {
    count: jest.fn(),
  },
  track: { count: jest.fn() },
  playlist: { count: jest.fn() },
  comment: { count: jest.fn() },
  like: { count: jest.fn() },
  repost: { count: jest.fn() },
  playEvent: { count: jest.fn() },
  userSubscription: { count: jest.fn() },
  trackFile: { aggregate: jest.fn() },
  dailyPlatformMetric: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

describe("AdminUsersService", () => {
  let service: AdminUsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminUsersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
    jest.clearAllMocks();
    // Clear TTL cache between tests
    (service as unknown as { cache: Map<string, unknown> }).cache.clear();
  });

  // ─── getUserDetail ────────────────────────────────────────────────────────────

  describe("getUserDetail", () => {
    it("throws NotFoundException when user does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.getUserDetail("no-such-id")).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when user is DELETED", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        accountStatus: "DELETED",
        subscriptions: [],
        _count: { tracks: 0, playlists: 0, followers: 0, following: 0 },
      });
      await expect(service.getUserDetail("u1")).rejects.toThrow(NotFoundException);
    });

    it("returns user detail with moderation history", async () => {
      const user = {
        id: "u1",
        email: "test@example.com",
        systemRole: "USER",
        accountStatus: "ACTIVE",
        isVerified: true,
        suspendedUntil: null,
        lastLoginAt: null,
        createdAt: new Date(),
        profile: {
          displayName: "Test",
          handle: "test",
          avatarUrl: null,
          accountType: "FREE",
        },
        subscriptions: [],
        _count: { tracks: 5, playlists: 2, followers: 10, following: 3 },
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.moderationAction.findMany.mockResolvedValueOnce([]);
      mockPrisma.moderationReport.aggregate
        .mockResolvedValueOnce({ _count: { id: 3 } })
        .mockResolvedValueOnce({ _count: { id: 0 } });
      mockPrisma.moderationReport.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const result = await service.getUserDetail("u1");

      expect(result.id).toBe("u1");
      expect(result.stats.tracks_uploaded).toBe(5);
      expect(result.reports_against.total).toBe(3);
      expect(result.subscription).toBeNull();
    });
  });

  // ─── getUsers ────────────────────────────────────────────────────────────────

  describe("getUsers", () => {
    it("returns paginated user list", async () => {
      mockPrisma.user.count.mockResolvedValueOnce(1);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: "u1",
          email: "a@b.com",
          systemRole: "USER",
          accountStatus: "ACTIVE",
          isVerified: true,
          lastLoginAt: null,
          createdAt: new Date(),
          profile: {
            displayName: "Alice",
            handle: "alice",
            avatarUrl: null,
            accountType: "FREE",
          },
          _count: { tracks: 2, submittedReports: 0 },
        },
      ]);

      const result = await service.getUsers({ page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].handle).toBe("alice");
    });
  });

  // ─── getOverviewStats — play-through rate ─────────────────────────────────────

  describe("getOverviewStats — play_through_rate_pct", () => {
    function setupOverviewMocks(totalPlays: number, completedPlays: number) {
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.userProfile.count.mockResolvedValue(5);
      mockPrisma.track.count.mockResolvedValue(20);
      mockPrisma.playlist.count.mockResolvedValue(3);
      mockPrisma.comment.count.mockResolvedValue(50);
      mockPrisma.like.count.mockResolvedValue(100);
      mockPrisma.repost.count.mockResolvedValue(30);
      // playEvent.count is called twice: total then completed
      mockPrisma.playEvent.count
        .mockResolvedValueOnce(totalPlays)
        .mockResolvedValueOnce(completedPlays);
      mockPrisma.userSubscription.count.mockResolvedValue(0);
      mockPrisma.trackFile.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: BigInt(0) },
      });
      mockPrisma.moderationReport.count.mockResolvedValue(0);
      mockPrisma.moderationAction.count.mockResolvedValue(0);
    }

    it("returns 0 when total plays is 0 (no division by zero)", async () => {
      setupOverviewMocks(0, 0);
      const result = await service.getOverviewStats();
      expect(result.engagement.play_through_rate_pct).toBe(0);
    });

    it("returns 100 when all plays are completed (completionRatio >= 0.90)", async () => {
      setupOverviewMocks(50, 50);
      const result = await service.getOverviewStats();
      expect(result.engagement.play_through_rate_pct).toBe(100);
    });

    it("returns correct rate when exactly 90% of plays completed", async () => {
      setupOverviewMocks(100, 90);
      const result = await service.getOverviewStats();
      expect(result.engagement.play_through_rate_pct).toBe(90);
    });

    it("returns correct rate when fewer than 90% of plays completed", async () => {
      setupOverviewMocks(100, 45);
      const result = await service.getOverviewStats();
      expect(result.engagement.play_through_rate_pct).toBe(45);
    });

    it("returns correct rate for partial completion (mixed plays)", async () => {
      // 200 total plays, 160 completed → 80%
      setupOverviewMocks(200, 160);
      const result = await service.getOverviewStats();
      expect(result.engagement.play_through_rate_pct).toBe(80);
    });

    it("returns correct total and completed play event counts", async () => {
      setupOverviewMocks(500, 300);
      const result = await service.getOverviewStats();
      expect(result.engagement.total_play_events).toBe(500);
      expect(result.engagement.completed_play_events).toBe(300);
    });

    it("aggregates storage from track_files and returns 0 when no files", async () => {
      setupOverviewMocks(10, 5);
      const result = await service.getOverviewStats();
      expect(result.billing.total_storage_bytes).toBe(0);
    });

    it("aggregates storage correctly when files exist", async () => {
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.userProfile.count.mockResolvedValue(1);
      mockPrisma.track.count.mockResolvedValue(1);
      mockPrisma.playlist.count.mockResolvedValue(0);
      mockPrisma.comment.count.mockResolvedValue(0);
      mockPrisma.like.count.mockResolvedValue(0);
      mockPrisma.repost.count.mockResolvedValue(0);
      mockPrisma.playEvent.count.mockResolvedValue(0).mockResolvedValueOnce(0);
      mockPrisma.userSubscription.count.mockResolvedValue(0);
      mockPrisma.moderationReport.count.mockResolvedValue(0);
      mockPrisma.moderationAction.count.mockResolvedValue(0);
      // 500 MB in bytes
      mockPrisma.trackFile.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: BigInt(500 * 1024 * 1024) },
      });
      (service as unknown as { cache: Map<string, unknown> }).cache.clear();
      const result = await service.getOverviewStats();
      expect(result.billing.total_storage_bytes).toBe(500 * 1024 * 1024);
    });

    it("returns artist_to_listener_ratio as 0 when no artists or listeners", async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.userProfile.count.mockResolvedValue(0);
      mockPrisma.track.count.mockResolvedValue(0);
      mockPrisma.playlist.count.mockResolvedValue(0);
      mockPrisma.comment.count.mockResolvedValue(0);
      mockPrisma.like.count.mockResolvedValue(0);
      mockPrisma.repost.count.mockResolvedValue(0);
      mockPrisma.playEvent.count.mockResolvedValue(0);
      mockPrisma.userSubscription.count.mockResolvedValue(0);
      mockPrisma.trackFile.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: null },
      });
      mockPrisma.moderationReport.count.mockResolvedValue(0);
      mockPrisma.moderationAction.count.mockResolvedValue(0);
      (service as unknown as { cache: Map<string, unknown> }).cache.clear();
      const result = await service.getOverviewStats();
      expect(result.users.artist_to_listener_ratio).toBe(0);
    });
  });

  // ─── TTL cache ────────────────────────────────────────────────────────────────

  describe("cache", () => {
    it("caches getOverviewStats and returns same result on second call", async () => {
      // getOverviewStats calls 24 Promise.all items (added artistCount, listenerCount, completedPlayEvents)
      mockPrisma.user.count.mockResolvedValue(100);
      mockPrisma.userProfile.count.mockResolvedValue(50);
      mockPrisma.track.count.mockResolvedValue(200);
      mockPrisma.playlist.count.mockResolvedValue(10);
      mockPrisma.comment.count.mockResolvedValue(500);
      mockPrisma.like.count.mockResolvedValue(2000);
      mockPrisma.repost.count.mockResolvedValue(300);
      mockPrisma.playEvent.count.mockResolvedValue(1000);
      mockPrisma.userSubscription.count.mockResolvedValue(25);
      mockPrisma.trackFile.aggregate.mockResolvedValue({
        _sum: { fileSizeBytes: BigInt(1024 * 1024 * 500) },
      });
      mockPrisma.report.count.mockResolvedValue(5);
      mockPrisma.moderationAction.count.mockResolvedValue(20);

      const first = await service.getOverviewStats();
      const second = await service.getOverviewStats();

      // Should return same reference (cached)
      expect(first).toStrictEqual(second);
      // Prisma track.count should only have been called once (4x on first call, 0x on cached second)
      expect(mockPrisma.track.count).toHaveBeenCalledTimes(4);
      // New metrics should be present
      expect(first.users).toHaveProperty("artists");
      expect(first.users).toHaveProperty("listeners");
      expect(first.users).toHaveProperty("artist_to_listener_ratio");
      expect(first.engagement).toHaveProperty("play_through_rate_pct");
      expect(first.engagement).toHaveProperty("completed_play_events");
    });
  });
});
