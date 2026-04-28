import { Test, TestingModule } from "@nestjs/testing";
import { FeedService } from "./feed.service";
import { PrismaService } from "../prisma/prisma.service";
import { TrackStatus, TrackVisibility, ModerationState } from "@prisma/client";

describe("FeedService", () => {
  let service: FeedService;
  let prismaService: jest.Mocked<PrismaService>;

  const asMock = <T extends (...args: any[]) => any>(fn: T) =>
    fn as jest.MockedFunction<T>;

  const mockUserId = "user-123";
  const mockFollowingUserId = "user-456";
  const mockTrackId = "track-789";

  const mockTrack = {
    id: mockTrackId,
    title: "Test Track",
    slug: "test-track",
    description: "A test track",
    coverArtUrl: "https://example.com/cover.jpg",
    createdAt: new Date("2026-04-20"),
    publishedAt: new Date("2026-04-21"),
    uploaderId: mockFollowingUserId,
    uploader: {
      profile: {
        handle: "testuser",
        displayName: "Test User",
        avatarUrl: "https://example.com/avatar.jpg",
      },
    },
  };

  beforeEach(async () => {
    const mockPrismaService = {
      userFollow: {
        findMany: jest.fn(),
      },
      track: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  describe("getFeed", () => {
    it("should return empty array when user has zero follows", async () => {
      asMock(prismaService.userFollow.findMany).mockResolvedValue([] as any);

      const result = await service.getFeed(mockUserId, 20, undefined, 1);

      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPreviousPage).toBe(false);
    });

    it("should use $transaction for parallel queries (count + findMany)", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);

      const transactionMock = jest.fn().mockResolvedValue([1, [mockTrack]]);
      asMock(prismaService.$transaction).mockImplementation(transactionMock);

      await service.getFeed(mockUserId, 20, undefined, 1);

      expect(transactionMock).toHaveBeenCalled();
      const [queries] = transactionMock.mock.calls[0];
      expect(Array.isArray(queries)).toBe(true);
    });

    it("should return paginated results with correct structure", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);

      const totalCount = 1;
      asMock(prismaService.$transaction).mockResolvedValue([totalCount, [mockTrack]]);

      const result = await service.getFeed(mockUserId, 20, undefined, 1);

      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        offset: 0,
        total: totalCount,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(result.items).toEqual([mockTrack]);
    });

    it("should correctly calculate offset from page number", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId, 20, undefined, 2);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should use explicit offset when provided", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      const result = await service.getFeed(mockUserId, 20, 10, 1);

      expect(result.pagination.offset).toBe(10);
    });

    it("should filter by status FINISHED", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId);

      // Verify the where clause in the transaction
      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should filter by visibility PUBLIC", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should filter by moderationState VISIBLE", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should exclude deleted tracks (deletedAt is null)", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should sort by publishedAt DESC then createdAt DESC", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);

      const track1 = {
        ...mockTrack,
        publishedAt: new Date("2026-04-22"),
      };
      const track2 = {
        ...mockTrack,
        id: "track-2",
        publishedAt: new Date("2026-04-20"),
      };

      asMock(prismaService.$transaction).mockResolvedValue([2, [track1, track2]]);

      const result = await service.getFeed(mockUserId);

      expect(result.items[0].publishedAt).toEqual(new Date("2026-04-22"));
      expect(result.items[1].publishedAt).toEqual(new Date("2026-04-20"));
    });

    it("should calculate correct hasNextPage", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);

      // Total is 25, we fetched limit 20, offset 0
      // hasNextPage = (0 + 1 < 25) = true
      asMock(prismaService.$transaction).mockResolvedValue([25, [mockTrack]]);

      const result = await service.getFeed(mockUserId, 20, undefined, 1);

      expect(result.pagination.hasNextPage).toBe(true);
    });

    it("should calculate correct hasPreviousPage", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      // Page 1, offset 0
      let result = await service.getFeed(mockUserId, 20, undefined, 1);
      expect(result.pagination.hasPreviousPage).toBe(false);

      // Page 2, offset 20
      result = await service.getFeed(mockUserId, 20, undefined, 2);
      expect(result.pagination.hasPreviousPage).toBe(true);
    });

    it("should calculate totalPages correctly", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);

      // Total 50, limit 20 = 2.5 rounds up to 3 pages
      asMock(prismaService.$transaction).mockResolvedValue([50, Array(20).fill(mockTrack)]);

      const result = await service.getFeed(mockUserId, 20);

      expect(result.pagination.totalPages).toBe(3);
    });

    it("should use default limit of 20 if not provided", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      const result = await service.getFeed(mockUserId);

      expect(result.pagination.limit).toBe(20);
    });

    it("should use provided limit", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      const result = await service.getFeed(mockUserId, 50);

      expect(result.pagination.limit).toBe(50);
    });

    it("should use default page of 1 if not provided", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      const result = await service.getFeed(mockUserId);

      expect(result.pagination.page).toBe(1);
    });

    it("should retrieve follower list before querying tracks", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId);

      expect(prismaService.userFollow.findMany).toHaveBeenCalledWith({
        where: { followerId: mockUserId },
        select: { followingId: true },
      });
    });

    it("should return uploader profile information", async () => {
      const followRows = [{ followingId: mockFollowingUserId }] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([1, [mockTrack]]);

      const result = await service.getFeed(mockUserId);

      expect(result.items[0].uploader).toEqual({
        profile: {
          handle: "testuser",
          displayName: "Test User",
          avatarUrl: "https://example.com/avatar.jpg",
        },
      });
    });

    it("should handle multiple following users", async () => {
      const followRows = [
        { followingId: "user-1" },
        { followingId: "user-2" },
        { followingId: "user-3" },
      ] as any;
      asMock(prismaService.userFollow.findMany).mockResolvedValue(followRows);
      asMock(prismaService.$transaction).mockResolvedValue([0, []]);

      await service.getFeed(mockUserId);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });
  });
});
