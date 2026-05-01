import { Test, TestingModule } from "@nestjs/testing";
import {
  ModerationState,
  PlaylistVisibility,
  ProfileVisibility,
  ReportTargetType,
  TrackStatus,
  TrackVisibility,
} from "@prisma/client";
import { NotFoundException } from "@nestjs/common";
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
              count: jest.fn(),
            },
            genre: {
              findUnique: jest.fn(),
            },
            userProfile: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
            },
            playlist: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            like: {
              findMany: jest.fn(),
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
    it("should search tracks, users, and playlists with enriched data", async () => {
      const query = "test";

      const mockTracks = [
        {
          id: "track-1",
          title: "Test Track",
          slug: "test-track",
          description: "A test track",
          cover_art_url: "https://example.com/cover.jpg",
          uploader_id: "user-1",
          artist_handle: "testartist",
          duration_ms: 180000,
          views: 250,
          exact_prefix_match: true,
          fuzzy_score: 0.95,
          total_count: BigInt(1),
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

      const mockUsersRaw = [
        {
          user_id: "user-1",
          handle: "testuser",
          display_name: "Test User",
          avatar_url: "https://example.com/avatar.jpg",
          bio: "A test user",
          total_count: BigInt(1),
        },
      ];

      const mockPlaylists = [
        {
          id: "playlist-1",
          owner_id: "user-1",
          title: "Test Playlist",
          slug: "test-playlist",
          description: "A test playlist",
          cover_art_url: "https://example.com/playlist-cover.jpg",
          total_count: BigInt(1),
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockTracks)
        .mockResolvedValueOnce(mockUsersRaw)
        .mockResolvedValueOnce(mockPlaylists);

      const result = await service.search(query);

      expect(result).toEqual({
        data: {
          tracks: [
            {
              id: "track-1",
              title: "Test Track",
              slug: "test-track",
              description: "A test track",
              coverArtUrl: "https://example.com/cover.jpg",
              uploaderId: "user-1",
              artistHandle: "testartist",
              duration: 180,
              views: 250,
            },
          ],
          users: mockUsers,
          playlists: [
            {
              id: "playlist-1",
              ownerId: "user-1",
              title: "Test Playlist",
              slug: "test-playlist",
              description: "A test playlist",
              coverArtUrl: "https://example.com/playlist-cover.jpg",
            },
          ],
        },
        meta: {
          current_page: 1,
          total_results: 3,
          total_pages: 1,
        },
      });
    });

    it("should handle empty search results", async () => {
      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.search("nonexistent");

      expect(result).toEqual({
        data: {
          tracks: [],
          users: [],
          playlists: [],
        },
        meta: {
          current_page: 1,
          total_results: 0,
          total_pages: 0,
        },
      });
    });

    it("should normalize the search query", async () => {
      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.search("  multiple   words  ");
      // Verify $queryRaw was called for tsvector/search
      expect((prisma.$queryRaw as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("should match partial user input (e.g. 'mo' -> 'Mohammed')", async () => {
      const partial = "mo";

      const mockTracks: any[] = [];
      const mockPlaylists: any[] = [];
      const mockUsersRaw = [
        {
          user_id: "user-xyz",
          handle: "mohammed",
          display_name: "Mohammed",
          avatar_url: null,
          bio: null,
          total_count: BigInt(1),
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockTracks)
        .mockResolvedValueOnce(mockUsersRaw)
        .mockResolvedValueOnce(mockPlaylists);

      const result = await service.search(partial);

      expect(result.data.users).toEqual([
        {
          userId: "user-xyz",
          handle: "mohammed",
          displayName: "Mohammed",
          avatarUrl: null,
          bio: null,
        },
      ]);
    });

    it("should include artistHandle, duration, and views in track results", async () => {
      const mockTracks = [
        {
          id: "track-1",
          title: "Extended Track",
          slug: "extended-track",
          description: "A long track",
          cover_art_url: "https://example.com/cover.jpg",
          uploader_id: "user-1",
          artist_handle: "extended_artist",
          duration_ms: 360000,
          views: 1500,
          exact_prefix_match: true,
          fuzzy_score: 0.9,
          total_count: BigInt(1),
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockTracks)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.search("extended");

      expect(result.data.tracks[0]).toMatchObject({
        id: "track-1",
        artistHandle: "extended_artist",
        duration: 360,
        views: 1500,
      });
    });

    it("should handle tracks with null duration", async () => {
      const mockTracks = [
        {
          id: "track-1",
          title: "No Duration Track",
          slug: "no-duration-track",
          description: null,
          cover_art_url: null,
          uploader_id: "user-1",
          artist_handle: "artist1",
          duration_ms: null,
          views: 100,
          exact_prefix_match: false,
          fuzzy_score: 0.5,
          total_count: BigInt(1),
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockTracks)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.search("duration");

      expect(result.data.tracks[0]).toMatchObject({
        id: "track-1",
        duration: null,
      });
    });

    it("should sort by views when query is very short (2-3 chars)", async () => {
      const mockTracks = [
        {
          id: "track-popular",
          title: "Very Popular Track",
          slug: "very-popular-track",
          description: null,
          cover_art_url: null,
          uploader_id: "user-1",
          artist_handle: "popular_artist",
          duration_ms: 240000,
          views: 5000,
          exact_prefix_match: false,
          fuzzy_score: 0.6,
          total_count: BigInt(1),
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockTracks)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.search("ver");

      expect(result.data.tracks[0]).toMatchObject({
        id: "track-popular",
        views: 5000,
      });
    });

    it("should convert milliseconds to seconds for duration", async () => {
      const mockTracks = [
        {
          id: "track-1",
          title: "Test Track",
          slug: "test-track",
          description: "Test",
          cover_art_url: null,
          uploader_id: "user-1",
          artist_handle: "testartist",
          duration_ms: 123456,
          views: 50,
          exact_prefix_match: true,
          fuzzy_score: 0.85,
          total_count: BigInt(1),
        },
      ];

      jest
        .spyOn(prisma, "$queryRaw" as any)
        .mockResolvedValueOnce(mockTracks)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.search("test");

      expect(result.data.tracks[0].duration).toBe(123);
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

      jest.spyOn(prisma, "$queryRaw" as any).mockResolvedValueOnce(mockRawRows);
      jest.spyOn(prisma.userProfile, "findMany").mockResolvedValueOnce(mockProfiles as any);

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
            liked: false,
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

      jest.spyOn(prisma, "$queryRaw" as any).mockResolvedValueOnce(mockRawRows);
      jest.spyOn(prisma.userProfile, "findMany").mockResolvedValueOnce(mockProfiles as any);
      jest.spyOn(prisma.like, "findMany").mockResolvedValueOnce([]);

      const result = await service.trending(10, 30, "user-123");

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
        liked: false,
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

      jest.spyOn(prisma, "$queryRaw" as any).mockResolvedValueOnce(mockRawRows);
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

      jest.spyOn(prisma, "$queryRaw" as any).mockResolvedValueOnce(mockRawRows);
      jest.spyOn(prisma.userProfile, "findMany").mockResolvedValueOnce(mockProfiles as any);

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

        jest.spyOn(prisma.userProfile, "findFirst").mockResolvedValueOnce(mockUserProfile as any);

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
        jest.spyOn(prisma.userProfile, "findFirst").mockResolvedValueOnce(null);

        const result = await service.resolveResource("nonexistent");

        expect(result).toEqual({ matched: false });
      });

      it("should handle URL format for user resolution", async () => {
        const mockUserProfile = {
          userId: "user-456",
          handle: "jane",
        };

        jest.spyOn(prisma.userProfile, "findFirst").mockResolvedValueOnce(mockUserProfile as any);

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

        jest.spyOn(prisma.track, "findFirst").mockResolvedValueOnce(mockTrack as any);

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
        jest.spyOn(prisma.playlist, "findFirst").mockResolvedValueOnce(null);

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

        jest.spyOn(prisma.playlist, "findFirst").mockResolvedValueOnce(mockPlaylist as any);

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
        jest.spyOn(prisma.playlist, "findFirst").mockResolvedValueOnce(mockPlaylist as any);

        const result = await service.resolveResource("johndoe/another-playlist");

        expect(result).toEqual({
          matched: true,
          resourceType: ReportTargetType.PLAYLIST,
          id: "playlist-202",
          slug: "another-playlist",
        });
      });

      it("should return not matched when playlist is not found", async () => {
        jest.spyOn(prisma.playlist, "findFirst").mockResolvedValueOnce(null);

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

        jest.spyOn(prisma.playlist, "findFirst").mockResolvedValueOnce(mockPlaylist as any);

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

  // ─── getTrendingTracksByGenre ─────────────────────────────────────────────

  describe("getTrendingTracksByGenre", () => {
    const mockGenre = { slug: "electronic", name: "Electronic" };

    const makeTrack = (overrides: Record<string, unknown> = {}) => ({
      id: "track-uuid-1",
      title: "A Track",
      slug: "a-track",
      durationMs: 210000,
      waveformData: [0.1, 0.5, 0.9],
      coverArtUrl: "https://example.com/cover.png",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      publishedAt: new Date("2026-01-01T01:00:00.000Z"),
      uploader: {
        id: "artist-uuid-1",
        profile: {
          displayName: "Artist One",
          handle: "artist-one",
          avatarUrl: "https://example.com/avatar.png",
        },
      },
      primaryGenre: { slug: "electronic", name: "Electronic" },
      _count: { likes: 42, reposts: 7 },
      ...overrides,
    });

    it("returns tracks for a valid genre slug", async () => {
      const track = makeTrack();
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([track] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);

      expect(result.genre).toEqual({ slug: "electronic", name: "Electronic" });
      expect(result.total).toBe(1);
      expect(result.tracks).toHaveLength(1);
    });

    it("throws NotFoundException when genre does not exist", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(null);

      await expect(
        service.getTrendingTracksByGenre("no-such-genre", 5),
      ).rejects.toThrow(NotFoundException);
    });

    it("includes genre slug in 404 message", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(null);

      await expect(
        service.getTrendingTracksByGenre("missing-slug", 5),
      ).rejects.toThrow('Genre "missing-slug" not found.');
    });

    it("returns tracks: [] when genre exists but has no matching tracks", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      const result = await service.getTrendingTracksByGenre("electronic", 5);

      expect(result.genre).toEqual({ slug: "electronic", name: "Electronic" });
      expect(result.total).toBe(0);
      expect(result.tracks).toEqual([]);
    });

    it("uses the requested genre slug and real name from DB (not hardcoded)", async () => {
      const customGenre = { slug: "ambient", name: "Ambient" };
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(customGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      const result = await service.getTrendingTracksByGenre("ambient", 5);

      expect(result.genre.slug).toBe("ambient");
      expect(result.genre.name).toBe("Ambient");
    });

    it("applies default limit of 5 to findMany", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("respects smaller valid limit", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 3);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it("filters only PUBLIC tracks", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ visibility: TrackVisibility.PUBLIC }),
        }),
      );
    });

    it("filters only FINISHED tracks", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: TrackStatus.FINISHED }),
        }),
      );
    });

    it("excludes deleted tracks (deletedAt: null)", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it("excludes hidden/removed tracks (moderationState: VISIBLE)", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            moderationState: ModerationState.VISIBLE,
          }),
        }),
      );
    });

    it("filters by exact genre slug", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            primaryGenre: { slug: "electronic" },
          }),
        }),
      );
    });

    it("sorts by likesCount descending", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      await service.getTrendingTracksByGenre("electronic", 5);

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { likes: { _count: "desc" } },
        }),
      );
    });

    it("returns total count independently of limit", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([makeTrack()] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(12);

      const result = await service.getTrendingTracksByGenre("electronic", 5);

      expect(result.total).toBe(12);
      expect(result.tracks).toHaveLength(1);
    });

    it("maps artist fields correctly", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([makeTrack()] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);
      const artist = result.tracks[0].artist;

      expect(artist.id).toBe("artist-uuid-1");
      expect(artist.displayName).toBe("Artist One");
      expect(artist.handle).toBe("artist-one");
      expect(artist.avatarUrl).toBe("https://example.com/avatar.png");
    });

    it("maps genre fields correctly in track", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([makeTrack()] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);
      const genre = result.tracks[0].genre;

      expect(genre.slug).toBe("electronic");
      expect(genre.name).toBe("Electronic");
    });

    it("maps trackId (not id) in response", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([makeTrack()] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);
      const track = result.tracks[0];

      expect(track).toHaveProperty("trackId", "track-uuid-1");
      expect(track).not.toHaveProperty("id");
    });

    it("maps likesCount and repostsCount correctly", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([makeTrack()] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);
      const track = result.tracks[0];

      expect(track.likesCount).toBe(42);
      expect(track.repostsCount).toBe(7);
    });

    it("does not expose secretToken in response", async () => {
      const trackWithSecret = makeTrack({ secretToken: "super-secret" });
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([trackWithSecret] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);
      const track = result.tracks[0];

      expect(track).not.toHaveProperty("secretToken");
      expect(JSON.stringify(track)).not.toContain("super-secret");
    });

    it("does not expose uploader email in response", async () => {
      const trackWithEmail = makeTrack({
        uploader: {
          id: "artist-uuid-1",
          email: "private@example.com",
          profile: { displayName: "A", handle: "a", avatarUrl: null },
        },
      });
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([trackWithEmail] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);

      expect(JSON.stringify(result)).not.toContain("private@example.com");
    });

    it("handles uploader with no profile gracefully", async () => {
      const trackNoProfile = makeTrack({
        uploader: { id: "artist-uuid-2", profile: null },
      });
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([trackNoProfile] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);
      const artist = result.tracks[0].artist;

      expect(artist.displayName).toBeNull();
      expect(artist.handle).toBeNull();
      expect(artist.avatarUrl).toBeNull();
    });

    it("returns the limit value in the response", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([]);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(0);

      const result = await service.getTrendingTracksByGenre("electronic", 3);

      expect(result.limit).toBe(3);
    });

    it("response shape matches the required contract", async () => {
      jest.spyOn(prisma.genre, "findUnique" as any).mockResolvedValueOnce(mockGenre);
      jest.spyOn(prisma.track, "findMany").mockResolvedValueOnce([makeTrack()] as any);
      jest.spyOn(prisma.track, "count").mockResolvedValueOnce(1);

      const result = await service.getTrendingTracksByGenre("electronic", 5);

      expect(result).toMatchObject({
        genre: { slug: expect.any(String), name: expect.any(String) },
        limit: expect.any(Number),
        total: expect.any(Number),
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: expect.any(String),
            title: expect.any(String),
            slug: expect.any(String),
            artist: expect.objectContaining({ id: expect.any(String) }),
            genre: expect.objectContaining({ slug: expect.any(String) }),
            likesCount: expect.any(Number),
            repostsCount: expect.any(Number),
          }),
        ]),
      });
    });
  });
});
