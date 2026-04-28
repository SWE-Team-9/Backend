import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryService } from "./discovery.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReportTargetType } from "@prisma/client";

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let prismaService: jest.Mocked<PrismaService>;

  const asMock = <T extends (...args: any[]) => any>(fn: T) =>
    fn as jest.MockedFunction<T>;

  const mockTrack = {
    id: "track-1",
    title: "Night Drive",
    slug: "night-drive",
    description: "A lofi track",
    coverArtUrl: "https://example.com/cover.jpg",
    uploaderId: "user-1",
    uploader: {
      profile: {
        handle: "lofiartist",
        displayName: "Lofi Artist",
      },
    },
  };

  const mockUser = {
    userId: "user-1",
    handle: "lofiartist",
    displayName: "Lofi Artist",
    avatarUrl: "https://example.com/avatar.jpg",
    bio: "Lofi producer",
  };

  const mockPlaylist = {
    id: "playlist-1",
    ownerId: "user-1",
    title: "Lofi Beats",
    slug: "lofi-beats",
    description: "Best lofi beats",
    coverArtUrl: "https://example.com/playlist-cover.jpg",
    owner: {
      profile: {
        handle: "lofiartist",
        displayName: "Lofi Artist",
      },
    },
  };

  beforeEach(async () => {
    const mockPrismaService = {
      $queryRaw: jest.fn(),
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
  });

  describe("search", () => {
    it("should use Promise.all for parallel queries", async () => {
      const findManySpy = jest
        .spyOn(prismaService.track, "findMany")
        .mockResolvedValue([]);
      jest
        .spyOn(prismaService.userProfile, "findMany")
        .mockResolvedValue([]);
      jest
        .spyOn(prismaService.playlist, "findMany")
        .mockResolvedValue([]);

      await service.search("lofi");

      expect(findManySpy).toHaveBeenCalled();
    });

    it("should return search results with normalized query", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([mockTrack] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([mockUser] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([mockPlaylist] as any);

      const result = await service.search("  lofi  ");

      expect(result.query).toBe("lofi");
      expect(result.results.tracks).toContain(mockTrack);
      expect(result.results.users).toContain(mockUser);
      expect(result.results.playlists).toContain(mockPlaylist);
    });

    it("should return correct totals", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([mockTrack] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([mockUser, mockUser] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      const result = await service.search("lofi");

      expect(result.totals.tracks).toBe(1);
      expect(result.totals.users).toBe(2);
      expect(result.totals.playlists).toBe(0);
    });

    it("should search tracks by title and description", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      await service.search("lofi");

      expect(prismaService.track.findMany).toHaveBeenCalled();
    });

    it("should search users by handle and displayName", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      await service.search("lofi");

      expect(prismaService.userProfile.findMany).toHaveBeenCalled();
    });

    it("should search playlists by title and description", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      await service.search("lofi");

      expect(prismaService.playlist.findMany).toHaveBeenCalled();
    });

    it("should return empty results when no matches", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      const result = await service.search("xyz123notfound");

      expect(result.results.tracks).toEqual([]);
      expect(result.results.users).toEqual([]);
      expect(result.results.playlists).toEqual([]);
      expect(result.totals.tracks).toBe(0);
      expect(result.totals.users).toBe(0);
      expect(result.totals.playlists).toBe(0);
    });

    it("should limit results to 20 per category", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      await service.search("lofi");

      expect(prismaService.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
      expect(prismaService.userProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
      expect(prismaService.playlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
    });

    it("should handle whitespace normalization", async () => {
      asMock(prismaService.track.findMany).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);
      asMock(prismaService.playlist.findMany).mockResolvedValue([] as any);

      const result = await service.search("   lofi   beats   ");

      expect(result.query).toBe("lofi   beats");
    });
  });

  describe("trending", () => {
    it("should return items sorted by velocity_score DESC", async () => {
      const row1 = {
        id: "track-1",
        title: "Track 1",
        slug: "track-1",
        cover_art_url: null,
        uploader_id: "user-1",
        recent_plays: BigInt(100),
        recent_likes: BigInt(50),
        velocity_score: 200,
      };
      const row2 = {
        id: "track-2",
        title: "Track 2",
        slug: "track-2",
        cover_art_url: null,
        uploader_id: "user-2",
        recent_plays: BigInt(50),
        recent_likes: BigInt(25),
        velocity_score: 100,
      };

      asMock(prismaService.$queryRaw).mockResolvedValue([row1, row2] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([
        { userId: "user-1", handle: "artist1", displayName: "Artist 1" },
        { userId: "user-2", handle: "artist2", displayName: "Artist 2" },
      ] as any);

      const result = await service.trending(20, 7);

      expect(result.items[0].velocityScore).toBe(200);
      expect(result.items[1].velocityScore).toBe(100);
    });

    it("should use default limit of 20", async () => {
      asMock(prismaService.$queryRaw).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);

      await service.trending();

      expect(prismaService.$queryRaw).toHaveBeenCalled();
    });

    it("should use default windowDays of 7", async () => {
      asMock(prismaService.$queryRaw).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);

      const result = await service.trending();

      expect(result.windowDays).toBe(7);
    });

    it("should use provided limit", async () => {
      asMock(prismaService.$queryRaw).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);

      await service.trending(50);

      expect(prismaService.$queryRaw).toHaveBeenCalled();
    });

    it("should use provided windowDays", async () => {
      asMock(prismaService.$queryRaw).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);

      const result = await service.trending(20, 30);

      expect(result.windowDays).toBe(30);
    });

    it("should convert bigint to number for plays and likes", async () => {
      const rawRow = {
        id: "track-1",
        title: "Track 1",
        slug: "track-1",
        cover_art_url: null,
        uploader_id: "user-1",
        recent_plays: BigInt(100),
        recent_likes: BigInt(50),
        velocity_score: 200,
      };

      asMock(prismaService.$queryRaw).mockResolvedValue([rawRow] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([
        { userId: "user-1", handle: "artist1", displayName: "Artist 1" },
      ] as any);

      const result = await service.trending();

      expect(result.items[0].recentPlays).toBe(100);
      expect(result.items[0].recentLikes).toBe(50);
      expect(typeof result.items[0].recentPlays).toBe("number");
      expect(typeof result.items[0].recentLikes).toBe("number");
    });

    it("should map uploader profiles to items", async () => {
      const rawRow = {
        id: "track-1",
        title: "Track 1",
        slug: "track-1",
        cover_art_url: null,
        uploader_id: "user-1",
        recent_plays: BigInt(100),
        recent_likes: BigInt(50),
        velocity_score: 200,
      };

      asMock(prismaService.$queryRaw).mockResolvedValue([rawRow] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([
        { userId: "user-1", handle: "testartist", displayName: "Test Artist" },
      ] as any);

      const result = await service.trending();

      expect(result.items[0].uploader).toEqual({
        userId: "user-1",
        handle: "testartist",
        displayName: "Test Artist",
      });
    });

    it("should handle missing uploader profiles with null", async () => {
      const rawRow = {
        id: "track-1",
        title: "Track 1",
        slug: "track-1",
        cover_art_url: null,
        uploader_id: "user-missing",
        recent_plays: BigInt(100),
        recent_likes: BigInt(50),
        velocity_score: 200,
      };

      asMock(prismaService.$queryRaw).mockResolvedValue([rawRow] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([] as any);

      const result = await service.trending();

      expect(result.items[0].uploader).toBeNull();
    });

    it("should return empty items array when no trending tracks", async () => {
      asMock(prismaService.$queryRaw).mockResolvedValue([] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([]);

      const result = await service.trending();

      expect(result.items).toEqual([]);
    });

    it("should transform raw row format to result format", async () => {
      const rawRow = {
        id: "track-1",
        title: "Night Drive",
        slug: "night-drive",
        cover_art_url: "https://example.com/cover.jpg",
        uploader_id: "user-1",
        recent_plays: BigInt(100),
        recent_likes: BigInt(50),
        velocity_score: 200,
      };

      asMock(prismaService.$queryRaw).mockResolvedValue([rawRow] as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([
        { userId: "user-1", handle: "artist", displayName: "Artist" },
      ] as any);

      const result = await service.trending();

      expect(result.items[0]).toEqual({
        id: "track-1",
        title: "Night Drive",
        slug: "night-drive",
        coverArtUrl: "https://example.com/cover.jpg",
        uploaderId: "user-1",
        uploader: { userId: "user-1", handle: "artist", displayName: "Artist" },
        recentPlays: 100,
        recentLikes: 50,
        velocityScore: 200,
      });
    });

    it("should fetch uploader profiles in batch", async () => {
      const rows = [
        {
          id: "track-1",
          title: "Track 1",
          slug: "track-1",
          cover_art_url: null,
          uploader_id: "user-1",
          recent_plays: BigInt(100),
          recent_likes: BigInt(50),
          velocity_score: 200,
        },
        {
          id: "track-2",
          title: "Track 2",
          slug: "track-2",
          cover_art_url: null,
          uploader_id: "user-2",
          recent_plays: BigInt(50),
          recent_likes: BigInt(25),
          velocity_score: 100,
        },
      ];

      asMock(prismaService.$queryRaw).mockResolvedValue(rows as any);
      asMock(prismaService.userProfile.findMany).mockResolvedValue([
        { userId: "user-1", handle: "artist1", displayName: "Artist 1" },
        { userId: "user-2", handle: "artist2", displayName: "Artist 2" },
      ] as any);

      await service.trending();

      expect(prismaService.userProfile.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ["user-1", "user-2"] } },
        select: {
          userId: true,
          handle: true,
          displayName: true,
        },
      });
    });

    it("should not query profiles if no trending rows", async () => {
      asMock(prismaService.$queryRaw).mockResolvedValue([] as any);

      await service.trending();

      expect(prismaService.userProfile.findMany).not.toHaveBeenCalled();
    });
  });

  describe("resolveResource", () => {
    it("should resolve /handle format to user profile", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue({
        userId: "user-1",
        handle: "testuser",
      } as any);

      const result = await service.resolveResource("/testuser");

      expect(result.matched).toBe(true);
      expect(result.resourceType).toBe(ReportTargetType.USER);
      expect(result.id).toBe("user-1");
      expect(result.handle).toBe("testuser");
    });

    it("should resolve /handle/slug format to track", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null);
      asMock(prismaService.track.findFirst).mockResolvedValue({
        id: "track-1",
        slug: "track-slug",
      } as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue(null as any);

      const result = await service.resolveResource("/testuser/track-slug");

      expect(result.matched).toBe(true);
      expect(result.resourceType).toBe(ReportTargetType.TRACK);
      expect(result.id).toBe("track-1");
    });

    it("should resolve /handle/sets/slug format to playlist", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue({
        id: "playlist-1",
        slug: "playlist-slug",
      } as any);

      const result = await service.resolveResource("/testuser/sets/playlist-slug");

      expect(result.matched).toBe(true);
      expect(result.resourceType).toBe(ReportTargetType.PLAYLIST);
      expect(result.id).toBe("playlist-1");
      expect(result.slug).toBe("playlist-slug");
    });

    it("should return matched false for unknown handle", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.track.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue(null as any);

      const result = await service.resolveResource("/unknownhandle");

      expect(result.matched).toBe(false);
    });

    it("should return matched false for unknown handle/slug combination", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.track.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue(null as any);

      const result = await service.resolveResource("/testuser/unknown-slug");

      expect(result.matched).toBe(false);
    });

    it("should handle empty path", async () => {
      const result = await service.resolveResource("");

      expect(result.matched).toBe(false);
    });

    it("should handle path with trailing slashes", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue({
        userId: "user-1",
        handle: "testuser",
      } as any);

      const result = await service.resolveResource("/testuser/");

      expect(prismaService.userProfile.findFirst).toHaveBeenCalled();
    });

    it("should normalize URL to path", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue({
        userId: "user-1",
        handle: "testuser",
      } as any);

      await service.resolveResource("testuser");

      expect(prismaService.userProfile.findFirst).toHaveBeenCalled();
    });

    it("should prioritize track over playlist when both have same slug", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.track.findFirst).mockResolvedValue({
        id: "track-1",
        slug: "slug",
      } as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue({
        id: "playlist-1",
        slug: "slug",
      } as any);

      const result = await service.resolveResource("/testuser/slug");

      expect(result.resourceType).toBe(ReportTargetType.TRACK);
    });

    it("should check playlist if track not found with same slug", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.track.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue({
        id: "playlist-1",
        slug: "slug",
      } as any);

      const result = await service.resolveResource("/testuser/slug");

      expect(result.matched).toBe(true);
      expect(result.resourceType).toBe(ReportTargetType.PLAYLIST);
    });

    it("should handle case-insensitive 'sets' keyword", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.playlist.findFirst).mockResolvedValue({
        id: "playlist-1",
        slug: "playlist-slug",
      } as any);

      const result = await service.resolveResource("/testuser/SETS/playlist-slug");

      expect(result.matched).toBe(true);
      expect(result.resourceType).toBe(ReportTargetType.PLAYLIST);
    });

    it("should return resource with handle and slug information", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue({
        userId: "user-1",
        handle: "testuser",
      } as any);

      const result = await service.resolveResource("/testuser");

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("matched");
    });

    it("should handle multiple path segments correctly", async () => {
      asMock(prismaService.userProfile.findFirst).mockResolvedValue(null as any);
      asMock(prismaService.track.findFirst).mockResolvedValue({
        id: "track-1",
        slug: "track-slug",
      } as any);

      const result = await service.resolveResource("/testuser/track-slug/extra");

      // Should still match track
      expect(prismaService.track.findFirst).toHaveBeenCalled();
    });
  });
});
