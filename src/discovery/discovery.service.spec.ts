import { Test, TestingModule } from "@nestjs/testing";
import {
  ModerationState,
  PlaylistVisibility,
  ProfileVisibility,
  ReportTargetType,
  TrackStatus,
  TrackVisibility,
} from "@prisma/client";
import { DiscoveryService } from "./discovery.service";
import { PrismaService } from "../prisma/prisma.service";

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: PrismaService,
          useValue: {
            track: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            userProfile: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            playlist: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("search", () => {
    it("should search tracks, users, and playlists", async () => {
      const query = "test";
      const expectedTsQuery = "test";

      const mockTracks = [
        {
          id: "track-1",
          title: "Test Track",
          slug: "test-track",
          description: "A test track",
          coverArtUrl: "https://example.com/cover.jpg",
          uploaderId: "user-1",
          uploader: {
            profile: {
              handle: "testuser",
              displayName: "Test User",
            },
          },
        },
      ];

      const mockUsers = [
        {
          userId: "user-1",
          handle: "testuser",
          displayName: "Test User",
          avatarUrl: "https://example.com/avatar.jpg",
          bio: "A test user",
        },
      ];

      const mockPlaylists = [
        {
          id: "playlist-1",
          ownerId: "user-1",
          title: "Test Playlist",
          slug: "test-playlist",
          description: "A test playlist",
          coverArtUrl: "https://example.com/playlist-cover.jpg",
          owner: {
            profile: {
              handle: "testuser",
              displayName: "Test User",
            },
          },
        },
      ];

      jest
        .spyOn(prisma.track, "findMany")
        .mockResolvedValueOnce(mockTracks as any);
      jest
        .spyOn(prisma.userProfile, "findMany")
        .mockResolvedValueOnce(mockUsers as any);
      jest
        .spyOn(prisma.playlist, "findMany")
        .mockResolvedValueOnce(mockPlaylists as any);

      const result = await service.search(query);

      expect(result).toEqual({
        query: "test",
        results: {
          tracks: mockTracks,
          users: mockUsers,
          playlists: mockPlaylists,
        },
        totals: {
          tracks: 1,
          users: 1,
          playlists: 1,
        },
      });

      expect(prisma.track.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          visibility: TrackVisibility.PUBLIC,
          status: TrackStatus.FINISHED,
          moderationState: ModerationState.VISIBLE,
          OR: [
            { title: { search: expectedTsQuery } },
            { description: { search: expectedTsQuery } },
          ],
        },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          coverArtUrl: true,
          uploaderId: true,
          uploader: {
            select: {
              profile: {
                select: {
                  handle: true,
                  displayName: true,
                },
              },
            },
          },
        },
        take: 20,
      });

      expect(prisma.userProfile.findMany).toHaveBeenCalledWith({
        where: {
          visibility: ProfileVisibility.PUBLIC,
          user: {
            deletedAt: null,
          },
          OR: [
            { handle: { search: expectedTsQuery } },
            { displayName: { search: expectedTsQuery } },
          ],
        },
        select: {
          userId: true,
          handle: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
        },
        take: 20,
      });

      expect(prisma.playlist.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          visibility: PlaylistVisibility.PUBLIC,
          moderationState: ModerationState.VISIBLE,
          OR: [
            { title: { search: expectedTsQuery } },
            { description: { search: expectedTsQuery } },
          ],
        },
        select: {
          id: true,
          ownerId: true,
          title: true,
          slug: true,
          description: true,
          coverArtUrl: true,
          owner: {
            select: {
              profile: {
                select: {
                  handle: true,
                  displayName: true,
                },
              },
            },
          },
        },
        take: 20,
      });
    });

    it("should handle empty search results", async () => {
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.userProfile, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.playlist, "findMany").mockResolvedValueOnce([]);

      const result = await service.search("nonexistent");

      expect(result).toEqual({
        query: "nonexistent",
        results: {
          tracks: [],
          users: [],
          playlists: [],
        },
        totals: {
          tracks: 0,
          users: 0,
          playlists: 0,
        },
      });
    });

    it("should normalize the search query", async () => {
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.userProfile, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.playlist, "findMany").mockResolvedValueOnce([]);

      await service.search("  multiple   words  ");

      // The toTsQuery method should convert "multiple   words" to "multiple & words"
      const callArgs = (prisma.track.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.OR[0].title.search).toBe("multiple & words");
    });
  });

  describe("trending", () => {
    it("should fetch trending tracks with default parameters", async () => {
      const mockRawRows = [
        {
          id: "track-1",
          title: "Popular Track",
          slug: "popular-track",
          cover_art_url: "https://example.com/cover.jpg",
          uploader_id: "user-1",
          recent_plays: BigInt(100),
          recent_likes: BigInt(50),
          velocity_score: 200,
        },
      ];

      const mockProfiles = [
        {
          userId: "user-1",
          handle: "popularuser",
          displayName: "Popular User",
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockRawRows);
      jest
        .spyOn(prisma.userProfile, "findMany")
        .mockResolvedValueOnce(mockProfiles as any);

      const result = await service.trending();

      expect(result).toEqual({
        windowDays: 7,
        items: [
          {
            id: "track-1",
            title: "Popular Track",
            slug: "popular-track",
            coverArtUrl: "https://example.com/cover.jpg",
            uploaderId: "user-1",
            uploader: {
              userId: "user-1",
              handle: "popularuser",
              displayName: "Popular User",
            },
            recentPlays: 100,
            recentLikes: 50,
            velocityScore: 200,
          },
        ],
      });
    });

    it("should fetch trending tracks with custom parameters", async () => {
      const mockRawRows = [
        {
          id: "track-1",
          title: "Trending Track",
          slug: "trending-track",
          cover_art_url: null,
          uploader_id: "user-1",
          recent_plays: BigInt(50),
          recent_likes: BigInt(25),
          velocity_score: 100,
        },
      ];

      const mockProfiles = [
        {
          userId: "user-1",
          handle: "trendinguser",
          displayName: "Trending User",
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockRawRows);
      jest
        .spyOn(prisma.userProfile, "findMany")
        .mockResolvedValueOnce(mockProfiles as any);

      const result = await service.trending(10, 30);

      expect(result.windowDays).toBe(30);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: "track-1",
        title: "Trending Track",
        slug: "trending-track",
        coverArtUrl: null,
        uploaderId: "user-1",
        uploader: {
          userId: "user-1",
          handle: "trendinguser",
          displayName: "Trending User",
        },
        recentPlays: 50,
        recentLikes: 25,
        velocityScore: 100,
      });
    });

    it("should handle tracks with no uploader profile", async () => {
      const mockRawRows = [
        {
          id: "track-1",
          title: "Orphan Track",
          slug: "orphan-track",
          cover_art_url: "https://example.com/cover.jpg",
          uploader_id: "nonexistent-user",
          recent_plays: BigInt(10),
          recent_likes: BigInt(5),
          velocity_score: 20,
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockRawRows);
      jest.spyOn(prisma.userProfile, "findMany").mockResolvedValueOnce([]);

      const result = await service.trending();

      expect(result.items[0].uploader).toBeNull();
    });

    it("should handle empty trending results", async () => {
      jest.spyOn(prisma, "$queryRaw" as any).mockResolvedValueOnce([]);

      const result = await service.trending();

      expect(result).toEqual({
        windowDays: 7,
        items: [],
      });

      expect(prisma.userProfile.findMany).not.toHaveBeenCalled();
    });

    it("should handle multiple tracks with duplicate uploaders", async () => {
      const mockRawRows = [
        {
          id: "track-1",
          title: "Track 1",
          slug: "track-1",
          cover_art_url: "https://example.com/cover1.jpg",
          uploader_id: "user-1",
          recent_plays: BigInt(100),
          recent_likes: BigInt(50),
          velocity_score: 200,
        },
        {
          id: "track-2",
          title: "Track 2",
          slug: "track-2",
          cover_art_url: "https://example.com/cover2.jpg",
          uploader_id: "user-1",
          recent_plays: BigInt(80),
          recent_likes: BigInt(40),
          velocity_score: 160,
        },
      ];

      const mockProfiles = [
        {
          userId: "user-1",
          handle: "prolificuser",
          displayName: "Prolific User",
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockRawRows);
      jest
        .spyOn(prisma.userProfile, "findMany")
        .mockResolvedValueOnce(mockProfiles as any);

      const result = await service.trending();

      expect(result.items).toHaveLength(2);
      expect(result.items[0].uploader).toBeDefined();
      expect(result.items[1].uploader).toBeDefined();
      expect(result.items[0].uploaderId).toBe("user-1");
      expect(result.items[1].uploaderId).toBe("user-1");

      // Should only call findMany once even though user-1 appears twice
      expect(prisma.userProfile.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ["user-1"] } },
        select: {
          userId: true,
          handle: true,
          displayName: true,
        },
      });
    });
  });

  describe("resolveResource", () => {
    describe("User resolution", () => {
      it("should resolve a user by handle", async () => {
        const mockUserProfile = {
          userId: "user-123",
          handle: "johndoe",
        };

        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce(mockUserProfile as any);

        const result = await service.resolveResource("johndoe");

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.USER,
          id: "user-123",
          handle: "johndoe",
        });

        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
          where: { handle: "johndoe" },
          select: { userId: true, handle: true },
        });
      });

      it("should return not matched when user is not found", async () => {
        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce(null);

        const result = await service.resolveResource("nonexistent");

        expect(result).toEqual({ matched: false });
      });

      it("should handle URL format for user resolution", async () => {
        const mockUserProfile = {
          userId: "user-456",
          handle: "jane",
        };

        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce(mockUserProfile as any);

        const result = await service.resolveResource("/jane");

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.USER,
          id: "user-456",
          handle: "jane",
        });
      });
    });

    describe("Track resolution", () => {
      it("should resolve a track by handle and slug", async () => {
        const mockTrack = {
          id: "track-789",
          slug: "my-track",
        };

        jest
          .spyOn(prisma.track, "findFirst")
          .mockResolvedValueOnce(mockTrack as any);

        const result = await service.resolveResource("johndoe/my-track");

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.TRACK,
          id: "track-789",
          slug: "my-track",
        });

        expect(prisma.track.findFirst).toHaveBeenCalledWith({
          where: {
            slug: "my-track",
            uploader: {
              profile: {
                handle: "johndoe",
              },
            },
          },
          select: { id: true, slug: true },
        });
      });

      it("should return not matched when track is not found", async () => {
        jest.spyOn(prisma.track, "findFirst").mockResolvedValueOnce(null);
        jest
          .spyOn(prisma.playlist, "findFirst")
          .mockResolvedValueOnce(null);

        const result = await service.resolveResource("johndoe/nonexistent");

        expect(result).toEqual({ matched: false });
      });
    });

    describe("Playlist resolution", () => {
      it("should resolve a playlist via sets notation", async () => {
        const mockPlaylist = {
          id: "playlist-101",
          slug: "my-playlist",
        };

        jest
          .spyOn(prisma.playlist, "findFirst")
          .mockResolvedValueOnce(mockPlaylist as any);

        const result = await service.resolveResource("johndoe/sets/my-playlist");

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.PLAYLIST,
          id: "playlist-101",
          slug: "my-playlist",
        });

        expect(prisma.playlist.findFirst).toHaveBeenCalledWith({
          where: {
            slug: "my-playlist",
            owner: {
              profile: {
                handle: "johndoe",
              },
            },
          },
          select: { id: true, slug: true },
        });
      });

      it("should resolve a playlist by handle and slug when not using sets notation", async () => {
        const mockPlaylist = {
          id: "playlist-202",
          slug: "another-playlist",
        };

        jest.spyOn(prisma.track, "findFirst").mockResolvedValueOnce(null);
        jest
          .spyOn(prisma.playlist, "findFirst")
          .mockResolvedValueOnce(mockPlaylist as any);

        const result = await service.resolveResource(
          "johndoe/another-playlist"
        );

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.PLAYLIST,
          id: "playlist-202",
          slug: "another-playlist",
        });
      });

      it("should return not matched when playlist is not found", async () => {
        jest
          .spyOn(prisma.playlist, "findFirst")
          .mockResolvedValueOnce(null);

        const result = await service.resolveResource("johndoe/sets/nonexistent");

        expect(result).toEqual({ matched: false });
      });
    });

    describe("URL parsing", () => {
      it("should handle absolute paths", async () => {
        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce({ userId: "user-1", handle: "john" } as any);

        await service.resolveResource("/john");

        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
          where: { handle: "john" },
          select: { userId: true, handle: true },
        });
      });

      it("should handle relative paths", async () => {
        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce({ userId: "user-1", handle: "jane" } as any);

        await service.resolveResource("jane");

        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
          where: { handle: "jane" },
          select: { userId: true, handle: true },
        });
      });

      it("should handle HTTP URLs", async () => {
        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce({ userId: "user-1", handle: "bob" } as any);

        await service.resolveResource("http://example.com/bob");

        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
          where: { handle: "bob" },
          select: { userId: true, handle: true },
        });
      });

      it("should handle HTTPS URLs", async () => {
        jest
          .spyOn(prisma.userProfile, "findFirst")
          .mockResolvedValueOnce({ userId: "user-1", handle: "alice" } as any);

        await service.resolveResource("https://example.com/alice");

        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
          where: { handle: "alice" },
          select: { userId: true, handle: true },
        });
      });

      it("should return not matched for empty path", async () => {
        const result = await service.resolveResource("");

        expect(result).toEqual({ matched: false });
      });

      it("should return not matched for path with only slashes", async () => {
        const result = await service.resolveResource("/");

        expect(result).toEqual({ matched: false });
      });
    });

    describe("Case sensitivity", () => {
      it("should handle uppercase sets notation", async () => {
        const mockPlaylist = {
          id: "playlist-303",
          slug: "test-playlist",
        };

        jest
          .spyOn(prisma.playlist, "findFirst")
          .mockResolvedValueOnce(mockPlaylist as any);

        const result = await service.resolveResource("user/SETS/test-playlist");

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.PLAYLIST,
          id: "playlist-303",
          slug: "test-playlist",
        });
      });
    });
  });
});
