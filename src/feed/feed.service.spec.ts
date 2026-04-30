import { Test, TestingModule } from "@nestjs/testing";
import { ModerationState, TrackStatus, TrackVisibility } from "@prisma/client";
import { FeedService } from "./feed.service";
import { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
  userFollow: {
    findMany: jest.fn(),
  },
  track: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  like: {
    findMany: jest.fn(),
  },
  repost: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe("FeedService", () => {
  let service: FeedService;
  let prisma: typeof mockPrisma;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
    prisma = module.get(PrismaService);
  });

  describe("getFeed", () => {
    it("returns an empty array for users with no follows", async () => {
      prisma.userFollow.findMany.mockResolvedValueOnce([]);

      const result = await service.getFeed("user-1");

      expect(result).toEqual({
        data: [],
        pagination: {
          page: 1,
          limit: 20,
          offset: 0,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
      expect(prisma.track.count).not.toHaveBeenCalled();
      expect(prisma.track.findMany).not.toHaveBeenCalled();
    });

    it("filters out private tracks and only returns public finished visible tracks", async () => {
      prisma.userFollow.findMany.mockResolvedValueOnce([
        { followingId: "artist-1" },
      ]);

      prisma.$transaction.mockResolvedValueOnce([
        1,
        [
          {
            id: "track-1",
            title: "Public Track",
            slug: "public-track",
            description: "A public track",
            coverArtUrl: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            publishedAt: new Date("2026-04-02T00:00:00.000Z"),
            uploaderId: "artist-1",
            status: "FINISHED",
            visibility: "PUBLIC",
            durationMs: 180000,
            waveformData: [0.1, 0.2, 0.15],
            primaryGenreId: 1,
            primaryGenre: { id: 1, name: "electronic" },
            tags: [
              { tag: { id: 1, name: "ambient" } },
              { tag: { id: 2, name: "lofi" } },
            ],
            uploader: {
              profile: {
                handle: "artist",
                displayName: "Artist",
                avatarUrl: null,
              },
            },
            _count: {
              likes: 10,
              reposts: 3,
            },
          },
        ],
      ]);

      prisma.like.findMany.mockResolvedValueOnce([]);
      prisma.repost.findMany.mockResolvedValueOnce([]);

      const result = await service.getFeed("user-1", 20, undefined, 1);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            uploaderId: { in: ["artist-1"] },
            deletedAt: null,
            status: TrackStatus.FINISHED,
            visibility: TrackVisibility.PUBLIC,
            moderationState: ModerationState.VISIBLE,
          }),
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          slug: "public-track",
          status: "FINISHED",
          visibility: "PUBLIC",
          durationMs: 180000,
          genre: "electronic",
          tags: ["ambient", "lofi"],
          waveformData: [0.1, 0.2, 0.15],
          likesCount: 10,
          repostsCount: 3,
          liked: false,
          reposted: false,
        }),
      );
    });

    it("uses offset and pagination defaults correctly", async () => {
      prisma.userFollow.findMany.mockResolvedValueOnce([
        { followingId: "artist-1" },
      ]);

      prisma.$transaction.mockResolvedValueOnce([0, []]);

      const result = await service.getFeed("user-1", 10, 30, 4);

      expect(result.pagination).toEqual({
        page: 4,
        limit: 10,
        offset: 30,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });
});
