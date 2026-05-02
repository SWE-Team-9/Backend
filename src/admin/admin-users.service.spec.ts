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
    findMany: jest.fn(),
  },
  track: { count: jest.fn(), findMany: jest.fn() },
  playlist: { count: jest.fn(), findMany: jest.fn() },
  comment: { count: jest.fn(), findMany: jest.fn() },
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

    mockPrisma.track.findMany.mockResolvedValue([]);
    mockPrisma.playlist.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([]);
    mockPrisma.report.findMany.mockResolvedValue([]);
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

    it("counts only non-deleted tracks in tracks_uploaded (deletedAt: null filter)", async () => {
      const user = {
        id: "u2",
        email: "b@example.com",
        systemRole: "USER",
        accountStatus: "ACTIVE",
        isVerified: false,
        suspendedUntil: null,
        lastLoginAt: null,
        createdAt: new Date(),
        profile: { displayName: "Bob", handle: "bob", avatarUrl: null, accountType: "FREE" },
        subscriptions: [],
        // 3 live tracks (deletedAt: null), 2 soft-deleted — mock returns 3
        _count: { tracks: 3, playlists: 0, followers: 0, following: 0 },
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.moderationAction.findMany.mockResolvedValueOnce([]);
      mockPrisma.moderationReport.aggregate
        .mockResolvedValueOnce({ _count: { id: 0 } })
        .mockResolvedValueOnce({ _count: { id: 0 } });
      mockPrisma.moderationReport.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.getUserDetail("u2");

      // Verify the query includes a where filter on the tracks _count
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            _count: expect.objectContaining({
              select: expect.objectContaining({
                tracks: expect.objectContaining({ where: { deletedAt: null } }),
              }),
            }),
          }),
        }),
      );
      expect(result.stats.tracks_uploaded).toBe(3);
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
          _count: { tracks: 2, reportedIn: 0 },
        },
      ]);

      const result = await service.getUsers({ page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].handle).toBe("alice");
    });

    it("queries track_count with deletedAt: null filter (excludes soft-deleted tracks)", async () => {
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
          profile: { displayName: "Alice", handle: "alice", avatarUrl: null, accountType: "FREE" },
          // 4 live tracks (mock already excludes deleted via the query filter)
          _count: { tracks: 4, reportedIn: 0 },
        },
      ]);

      const result = await service.getUsers({ page: 1, limit: 20 });

      // Verify findMany is called with the filtered _count on tracks
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            _count: expect.objectContaining({
              select: expect.objectContaining({
                tracks: expect.objectContaining({ where: { deletedAt: null } }),
              }),
            }),
          }),
        }),
      );
      expect(result.users[0].track_count).toBe(4);
    });
  });

  // ─── getAuditLog ───────────────────────────────────────────────────────────

  describe("getAuditLog", () => {
    it("returns paginated and mapped moderation actions", async () => {
      const createdAt = new Date("2026-05-02T10:00:00.000Z");
      mockPrisma.moderationAction.count.mockResolvedValueOnce(1);
      mockPrisma.moderationAction.findMany.mockResolvedValueOnce([
        {
          id: "act-1",
          actionType: "HIDE_TRACK",
          notes: "policy violation",
          createdAt,
          reportId: "rep-1",
          admin: {
            id: "admin-1",
            profile: { displayName: "Admin", handle: "admin" },
          },
          targetUser: {
            id: "user-1",
            profile: { displayName: "User", handle: "user" },
          },
          track: { id: "track-1", title: "Track A" },
          comment: null,
          playlist: null,
        },
      ]);

      const result = await service.getAuditLog({ page: 1, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toEqual(
        expect.objectContaining({
          id: "act-1",
          action_type: "HIDE_TRACK",
          linked_report_id: "rep-1",
          target_track: { id: "track-1", title: "Track A" },
          admin: expect.objectContaining({ handle: "admin" }),
          target_user: expect.objectContaining({ handle: "user" }),
        }),
      );
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
      mockPrisma.report.count.mockResolvedValue(0);
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
      mockPrisma.report.count.mockResolvedValue(0);
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
      mockPrisma.report.count.mockResolvedValue(0);
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

  // ─── getDailyStats ─────────────────────────────────────────────────────────

  describe("getDailyStats", () => {
    it("returns fallback daily buckets with zeros when metrics table is empty", async () => {
      mockPrisma.dailyPlatformMetric.findMany.mockResolvedValueOnce([]);

      const result = await service.getDailyStats({
        dateFrom: "2026-05-01",
        dateTo: "2026-05-03",
        granularity: "daily",
      });

      expect(result.metrics).toHaveLength(3);
      expect(result.metrics[0]).toEqual(
        expect.objectContaining({
          date: "2026-05-03",
          new_users: 0,
          tracks_uploaded: 0,
          total_storage_bytes: 0,
          active_subscribers: 0,
        }),
      );
      expect(result.metrics[2]).toEqual(
        expect.objectContaining({
          date: "2026-05-01",
          new_users: 0,
          tracks_uploaded: 0,
          total_storage_bytes: 0,
          active_subscribers: 0,
        }),
      );
    });

    it("aggregates multiple metric rows into weekly buckets", async () => {
      mockPrisma.dailyPlatformMetric.findMany.mockResolvedValueOnce([
        {
          metricDate: new Date("2026-05-01T00:00:00.000Z"),
          newUsers: 2,
          tracksUploaded: 4,
          totalStorageBytes: BigInt(100),
          activeSubscribers: 8,
        },
        {
          metricDate: new Date("2026-05-03T00:00:00.000Z"),
          newUsers: 3,
          tracksUploaded: 1,
          totalStorageBytes: BigInt(40),
          activeSubscribers: 10,
        },
      ]);

      const result = await service.getDailyStats({
        dateFrom: "2026-05-01",
        dateTo: "2026-05-14",
        granularity: "weekly",
      });

      expect(result.metrics).toHaveLength(2);
      const metrics = result.metrics as Array<{
        date: string;
        new_users: number;
        tracks_uploaded: number;
        total_storage_bytes: number;
        active_subscribers: number;
      }>;
      const weekBucket = metrics.find((m) => m.date === "2026-05-01");
      expect(weekBucket).toEqual(
        expect.objectContaining({
          new_users: 5,
          tracks_uploaded: 5,
          total_storage_bytes: 140,
          active_subscribers: 10,
        }),
      );
    });
  });

  // ─── getMostReported ───────────────────────────────────────────────────────

  describe("getMostReported", () => {
    it("returns enriched most-reported entities for users/tracks/playlists", async () => {
      mockPrisma.moderationReport.groupBy
        .mockResolvedValueOnce([{ reportedUserId: "u1", _count: { id: 7 } }])
        .mockResolvedValueOnce([{ trackId: "t1", _count: { id: 5 } }])
        .mockResolvedValueOnce([{ playlistId: "p1", _count: { id: 3 } }]);

      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: "u1", profile: { handle: "user1", displayName: "User One" } },
      ]);
      mockPrisma.track.findMany.mockResolvedValueOnce([{ id: "t1", title: "Track One" }]);
      mockPrisma.playlist.findMany.mockResolvedValueOnce([{ id: "p1", title: "Playlist One" }]);

      const result = await service.getMostReported({ period: "last_30_days", limit: 10 });

      expect(result.most_reported_users[0]).toEqual(
        expect.objectContaining({ user_id: "u1", handle: "user1", report_count: 7 }),
      );
      expect(result.most_reported_tracks[0]).toEqual(
        expect.objectContaining({ track_id: "t1", title: "Track One", report_count: 5 }),
      );
      expect(result.most_reported_playlists[0]).toEqual(
        expect.objectContaining({ playlist_id: "p1", title: "Playlist One", report_count: 3 }),
      );
    });
  });
});
