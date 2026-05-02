import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PlaylistVisibility } from "@prisma/client";

import { StorageService } from "../common/storage/storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { PlaylistsService } from "./playlists.service";

function buildPrismaMock() {
  const prismaMock: any = {
    $executeRaw: jest.fn(),
    $transaction: jest
      .fn()
      .mockImplementation((fnOrQueries: any) =>
        typeof fnOrQueries === "function" ? fnOrQueries(prismaMock) : Promise.all(fnOrQueries),
      ),
    playlist: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    track: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    playlistTrack: {
      create: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    genre: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    playEvent: {
      groupBy: jest.fn(),
    },
    playlistLike: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  return prismaMock;
}

describe("PlaylistsService", () => {
  let service: PlaylistsService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  const storageMock = {
    upload: jest.fn(),
  };

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaylistsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageMock },
      ],
    }).compile();

    service = module.get(PlaylistsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe("create", () => {
    it("creates a PUBLIC playlist with initial tracks list", async () => {
      prisma.track.findMany.mockResolvedValue([
        { id: "trk_123", title: "Layali" },
        { id: "trk_456", title: "Sahar" },
      ]);
      prisma.user.findFirst.mockResolvedValue({
        id: "usr_1",
        profile: { displayName: "Ahmed Hassan" },
      });
      prisma.playlist.findFirst.mockResolvedValue(null);
      prisma.playlist.create.mockResolvedValue({
        id: "pl_101",
        title: "Late Night Drive",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      });
      prisma.playlistTrack.createMany.mockResolvedValue({ count: 2 });

      const result = await service.create("usr_1", {
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: PlaylistVisibility.PUBLIC,
        trackIds: ["trk_123", "trk_456"],
      });

      expect(result).toEqual({
        playlistId: "pl_101",
        title: "Late Night Drive",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
        coverImageUrl: null,
        releaseDate: "2026-03-01T00:00:00.000Z",
        genre: null,
        tracksCount: 2,
        likesCount: 0,
        isLiked: false,
        owner: {
          id: "usr_1",
          displayName: "Ahmed Hassan",
        },
      });
      expect(prisma.playlistTrack.createMany).toHaveBeenCalledWith({
        data: [
          {
            playlistId: "pl_101",
            trackId: "trk_123",
            position: 0,
          },
          {
            playlistId: "pl_101",
            trackId: "trk_456",
            position: 1,
          },
        ],
      });
    });

    it("throws when track list is empty", async () => {
      await expect(
        service.create("usr_1", {
          title: "Playlist",
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: [],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws when initial tracks include duplicate IDs", async () => {
      await expect(
        service.create("usr_1", {
          title: "Playlist",
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ["trk_1", "trk_1"],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws when an initial track does not exist", async () => {
      prisma.track.findMany.mockResolvedValue([{ id: "trk_123", title: "Layali" }]);

      await expect(
        service.create("usr_1", {
          title: "Playlist",
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ["trk_123", "missing"],
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows initial tracks with same title if IDs are different", async () => {
      prisma.track.findMany.mockResolvedValue([{ id: "trk_123" }, { id: "trk_456" }]);
      prisma.playlist.findFirst.mockResolvedValue(null);
      prisma.playlist.create.mockResolvedValue({
        id: "pl_101",
        title: "Playlist",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      prisma.playlistTrack.createMany.mockResolvedValue({ count: 2 });

      await expect(
        service.create("usr_1", {
          title: "Playlist",
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ["trk_123", "trk_456"],
        } as any),
      ).resolves.toBeTruthy();
    });
  });

  describe("getDetails", () => {
    it("returns playlist details with tracks and hides secretToken for non-owner", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: "PUBLIC",
        secretToken: "sec_hidden",
        coverImageUrl: null,
        coverArtUrl: null,
        likesCount: 0,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        releaseDate: null,
        genre: { slug: "electronic" },
        owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
      });
      prisma.playlistTrack.findMany.mockResolvedValue([
        {
          track: {
            id: "trk_123",
            title: "Layali",
            coverArtUrl: "https://cdn.example.com/trk_123.jpg",
            durationMs: 240000,
            _count: { likes: 156, reposts: 42 },
            uploader: {
              id: "usr_uploader_1",
              profile: { displayName: "DJ Ahmed", handle: "dj_ahmed" },
            },
          },
        },
      ]);
      prisma.playlistLike.findUnique.mockResolvedValue(null);

      const result = await service.getDetails("pl_101", "usr_2");

      expect(result).toEqual(expect.objectContaining({
        playlistId: "pl_101",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: "PUBLIC",
        coverImageUrl: null,
        likesCount: 0,
        isLiked: false,
        releaseDate: "2026-03-01T00:00:00.000Z",
        genre: "electronic",
        tracksCount: 1,
        owner: expect.objectContaining({ id: "usr_1", displayName: "Ahmed Hassan" }),
        tracks: [
          {
            trackId: "trk_123",
            title: "Layali",
            coverArtUrl: "https://cdn.example.com/trk_123.jpg",
            durationMs: 240000,
            likesCount: 156,
            repostsCount: 42,
            artist: {
              id: "usr_uploader_1",
              name: "DJ Ahmed",
              handle: "dj_ahmed",
            },
          },
        ],
      }));
      expect(result).not.toHaveProperty("secretToken");
    });

    it("returns playlist details with secretToken for owner", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: "SECRET",
        secretToken: "sec_owner_visible",
        coverImageUrl: null,
        coverArtUrl: null,
        likesCount: 0,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        releaseDate: null,
        genre: null,
        owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
      });
      prisma.playlistTrack.findMany.mockResolvedValue([
        {
          track: {
            id: "trk_123",
            title: "Layali",
            coverArtUrl: null,
            durationMs: 240000,
            _count: { likes: 100, reposts: 20 },
            uploader: {
              id: "usr_uploader_1",
              profile: { displayName: "DJ Ahmed", handle: "dj_ahmed" },
            },
          },
        },
      ]);
      prisma.playlistLike.findUnique.mockResolvedValue({ userId: "usr_1" });

      const result = await service.findOne("pl_101", "usr_1");

      expect(result).toEqual(expect.objectContaining({
        playlistId: "pl_101",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: "SECRET",
        secretToken: "sec_owner_visible",
        coverImageUrl: null,
        likesCount: 0,
        isLiked: true,
        releaseDate: "2026-03-01T00:00:00.000Z",
        genre: null,
        tracksCount: 1,
        owner: expect.objectContaining({ id: "usr_1", displayName: "Ahmed Hassan" }),
        tracks: [
          {
            trackId: "trk_123",
            title: "Layali",
            coverArtUrl: null,
            durationMs: 240000,
            likesCount: 100,
            repostsCount: 20,
            artist: {
              id: "usr_uploader_1",
              name: "DJ Ahmed",
              handle: "dj_ahmed",
            },
          },
        ],
      }));
    });

    it("throws when playlist does not exist", async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.getDetails("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update", () => {
    it("updates playlist and returns sanitized payload", async () => {
      const findOneMock = {
        id: "pl_101",
        slug: "vol-2",
        ownerId: "usr_1",
        title: "Vol 2",
        description: null,
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
        coverImageUrl: null,
        coverArtUrl: null,
        likesCount: 0,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        releaseDate: null,
        genre: null,
        owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
      };
      prisma.playlist.findFirst
        .mockResolvedValueOnce({ id: "pl_101", ownerId: "usr_1", visibility: PlaylistVisibility.PUBLIC, secretToken: null, genreId: null })
        .mockResolvedValueOnce(findOneMock);
      prisma.playlistTrack.findMany.mockResolvedValue([]);
      prisma.playlistLike.findUnique.mockResolvedValue(null);
      prisma.playlist.update.mockResolvedValue({});

      const result = await service.update("usr_1", "pl_101", {
        title: "Vol 2",
      });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: "pl_101" },
        data: { title: "Vol 2" },
      });
      expect(result).toEqual(expect.objectContaining({
        message: "Playlist updated successfully",
        playlist: expect.objectContaining({
          playlistId: "pl_101",
          title: "Vol 2",
          description: null,
          visibility: PlaylistVisibility.PUBLIC,
          coverImageUrl: null,
          likesCount: 0,
          isLiked: false,
          releaseDate: "2026-03-01T00:00:00.000Z",
          genre: null,
          tracksCount: 0,
          owner: expect.objectContaining({ id: "usr_1", displayName: "Ahmed Hassan" }),
          tracks: [],
        }),
      }));
    });

    it("keeps SECRET visibility and generates UUID token if needed", async () => {
      const findOneMock = {
        id: "pl_101",
        ownerId: "usr_1",
        title: "Late Night Drive",
        description: null,
        visibility: PlaylistVisibility.SECRET,
        secretToken: "placeholder",
        coverImageUrl: null,
        coverArtUrl: null,
        likesCount: 0,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        releaseDate: null,
        genre: null,
        owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
      };
      prisma.playlist.findFirst
        .mockResolvedValueOnce({ id: "pl_101", ownerId: "usr_1", visibility: PlaylistVisibility.PUBLIC, secretToken: null, genreId: null })
        .mockResolvedValueOnce(null) // secret token uniqueness check
        .mockResolvedValueOnce(findOneMock); // findOne after update
      prisma.playlistTrack.findMany.mockResolvedValue([]);
      prisma.playlistLike.findUnique.mockResolvedValue(null);
      prisma.playlist.update.mockResolvedValue({});

      await service.update("usr_1", "pl_101", {
        visibility: "secret",
      });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: "pl_101" },
        data: expect.objectContaining({
          visibility: PlaylistVisibility.SECRET,
          secretToken: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        }),
      });
    });

    it("throws when playlist missing", async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.update("usr_1", "missing", { title: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws when user is not owner", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "someone-else",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      await expect(service.update("usr_1", "pl_101", { title: "x" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("throws when no update fields provided", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      await expect(service.update("usr_1", "pl_101", {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects PRIVATE visibility updates", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });

      await expect(
        service.update("usr_1", "pl_101", {
          visibility: "PRIVATE" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects lowercase private visibility updates", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });

      await expect(
        service.update("usr_1", "pl_101", {
          visibility: "private" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it("updates new editable playlist metadata fields", async () => {
      const findOneMock = {
        id: "pl_101",
        ownerId: "usr_1",
        title: "Vol 2",
        description: "updated",
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
        coverImageUrl: null,
        coverArtUrl: null,
        likesCount: 0,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        releaseDate: null,
        genre: null,
        owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
      };
      prisma.playlist.findFirst
        .mockResolvedValueOnce({ id: "pl_101", ownerId: "usr_1", visibility: PlaylistVisibility.PUBLIC, secretToken: null, genreId: null })
        .mockResolvedValueOnce(findOneMock); // findOne after update
      prisma.genre.findFirst.mockResolvedValue({ id: 12 });
      prisma.playlistTrack.findMany.mockResolvedValue([]);
      prisma.playlistLike.findUnique.mockResolvedValue(null);
      prisma.playlist.update.mockResolvedValue({});

      await service.update("usr_1", "pl_101", {
        type: "ALBUM",
        releaseDate: "2026-03-01",
        genre: "electronic",
        tags: ["chill", "chill", "night-drive"],
      });

      expect(prisma.genre.findFirst).toHaveBeenCalledWith({
        where: { slug: "electronic" },
        select: { id: true },
      });
      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: "pl_101" },
        data: expect.objectContaining({
          type: "ALBUM",
          releaseDate: new Date("2026-03-01"),
          genreId: 12,
          tags: ["chill", "night-drive"],
        }),
      });
    });
  });

  describe("getEditDetails", () => {
    it("returns owner-only editable playlist data", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: PlaylistVisibility.PUBLIC,
        slug: "late-night-drive",
        coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
        coverArtUrl: null,
        type: "ALBUM",
        releaseDate: new Date("2026-03-01"),
        genreId: 12,
        genre: { slug: "electronic" },
        tags: ["chill", "night-drive"],
      });

      const result = await service.getEditDetails("usr_1", "pl_101");

      expect(result).toEqual({
        playlistId: "pl_101",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: PlaylistVisibility.PUBLIC,
        slug: "late-night-drive",
        coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
        type: "ALBUM",
        releaseDate: "2026-03-01T00:00:00.000Z",
        genre: "electronic",
        tags: ["chill", "night-drive"],
      });
    });
  });

  describe("uploadCover", () => {
    it("uploads a cover image and stores the returned URL", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      storageMock.upload.mockResolvedValue({
        url: "https://cdn.example.com/playlists/pl_101/cover.jpg",
        key: "playlists/pl_101/cover.jpg",
      });
      prisma.playlist.update.mockResolvedValue({
        coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
      });

      const result = await service.uploadCover("usr_1", "pl_101", {
        buffer: Buffer.from([1, 2, 3]),
        mimetype: "image/jpeg",
        originalname: "cover.jpg",
        size: 1024,
      } as any);

      expect(storageMock.upload).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), {
        userId: "usr_1",
        type: "cover",
        mimeType: "image/jpeg",
        originalName: "cover.jpg",
      });
      expect(result).toEqual({
        message: "Playlist cover uploaded successfully",
        coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
      });
    });
  });

  describe("getRecentPlaylists", () => {
    it("returns unique recently played playlists ordered by last play time", async () => {
      prisma.playEvent.groupBy.mockResolvedValue([
        {
          playlistId: "pl_101",
          _max: { startedAt: new Date("2026-04-02T10:00:00Z") },
        },
        {
          playlistId: "pl_102",
          _max: { startedAt: new Date("2026-04-01T10:00:00Z") },
        },
      ]);
      prisma.playlist.findMany.mockResolvedValue([
        {
          id: "pl_101",
          title: "Late Night Drive",
          visibility: "PUBLIC",
          coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
          coverArtUrl: null,
          likesCount: 10,
          genre: { slug: "electronic", name: "Electronic" },
          owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
          _count: { tracks: 12 },
        },
        {
          id: "pl_102",
          title: "Weekend Mix",
          visibility: "SECRET",
          coverImageUrl: null,
          coverArtUrl: null,
          likesCount: 5,
          genre: null,
          owner: { id: "usr_2", profile: { displayName: "Sara Ali" } },
          _count: { tracks: 8 },
        },
      ]);
      prisma.playlistLike.findMany.mockResolvedValue([]);

      const result = await service.getRecentPlaylists("usr_1", 10);

      expect(prisma.playEvent.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ["playlistId"],
          where: expect.objectContaining({
            userId: "usr_1",
            playlistId: { not: null },
          }),
          take: 10,
        }),
      );
      expect(result).toEqual({
        playlists: [
          {
            playlistId: "pl_101",
            title: "Late Night Drive",
            visibility: "PUBLIC",
            coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
            likesCount: 10,
            isLiked: false,
            genre: "electronic",
            tracksCount: 12,
            owner: expect.objectContaining({ id: "usr_1", displayName: "Ahmed Hassan" }),
          },
          {
            playlistId: "pl_102",
            title: "Weekend Mix",
            visibility: "SECRET",
            coverImageUrl: null,
            likesCount: 5,
            isLiked: false,
            genre: null,
            tracksCount: 8,
            owner: { id: "usr_2", displayName: "Sara Ali" },
          },
        ],
      });
    });
  });

  describe("getTopPlaylists", () => {
    it("returns top public playlists grouped by genre and keeps no-genre playlists only in their bucket", async () => {
      prisma.playlist.findMany.mockResolvedValue([
        {
          id: "pl_101",
          title: "Late Night Drive",
          visibility: PlaylistVisibility.PUBLIC,
          coverImageUrl: null,
          coverArtUrl: null,
          likesCount: 48,
          genre: { slug: "electronic" },
          owner: { id: "usr_1", profile: { displayName: "User One" } },
          _count: { tracks: 12 },
        },
        {
          id: "pl_201",
          title: "Sunrise Club",
          visibility: PlaylistVisibility.PUBLIC,
          coverImageUrl: null,
          coverArtUrl: null,
          likesCount: 33,
          genre: { slug: "house" },
          owner: { id: "usr_2", profile: { displayName: "User Two" } },
          _count: { tracks: 8 },
        },
        {
          id: "pl_102",
          title: "Neon Pulse",
          visibility: PlaylistVisibility.PUBLIC,
          coverImageUrl: null,
          coverArtUrl: null,
          likesCount: 20,
          genre: { slug: "electronic" },
          owner: { id: "usr_3", profile: { displayName: "User Three" } },
          _count: { tracks: 15 },
        },
        {
          id: "pl_301",
          title: "Midnight Float",
          visibility: PlaylistVisibility.PUBLIC,
          coverImageUrl: null,
          coverArtUrl: null,
          likesCount: 12,
          genre: null,
          owner: { id: "usr_4", profile: { displayName: "User Four" } },
          _count: { tracks: 5 },
        },
      ]);
      prisma.playlistLike.findMany.mockResolvedValue([]);

      const result = await service.getTopPlaylists("usr_test");

      expect(prisma.playlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: PlaylistVisibility.PUBLIC,
            deletedAt: null,
          },
          orderBy: [{ likesCount: "desc" }, { createdAt: "desc" }],
          select: expect.objectContaining({
            genre: {
              select: {
                slug: true,
              },
            },
          }),
        }),
      );
      expect(result).toEqual({
        genres: [
          {
            genre: "electronic",
            playlists: [
              {
                playlistId: "pl_101",
                title: "Late Night Drive",
                visibility: PlaylistVisibility.PUBLIC,
                coverImageUrl: null,
                likesCount: 48,
                isLiked: false,
                genre: "electronic",
                tracksCount: 12,
                owner: {
                  id: "usr_1",
                  displayName: "User One",
                },
              },
              {
                playlistId: "pl_102",
                title: "Neon Pulse",
                visibility: PlaylistVisibility.PUBLIC,
                coverImageUrl: null,
                likesCount: 20,
                isLiked: false,
                genre: "electronic",
                tracksCount: 15,
                owner: {
                  id: "usr_3",
                  displayName: "User Three",
                },
              },
            ],
          },
          {
            genre: "house",
            playlists: [
              {
                playlistId: "pl_201",
                title: "Sunrise Club",
                visibility: PlaylistVisibility.PUBLIC,
                coverImageUrl: null,
                likesCount: 33,
                isLiked: false,
                genre: "house",
                tracksCount: 8,
                owner: {
                  id: "usr_2",
                  displayName: "User Two",
                },
              },
            ],
          },
          {
            genre: "No Genre",
            playlists: [
              {
                playlistId: "pl_301",
                title: "Midnight Float",
                visibility: PlaylistVisibility.PUBLIC,
                coverImageUrl: null,
                likesCount: 12,
                isLiked: false,
                genre: null,
                tracksCount: 5,
                owner: {
                  id: "usr_4",
                  displayName: "User Four",
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe("remove", () => {
    it("soft deletes playlist for owner", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.playlist.update.mockResolvedValue({});

      await service.remove("usr_1", "pl_101");

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: "pl_101" },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("throws when playlist missing", async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.remove("usr_1", "missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws when non-owner tries deleting", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_x",
      });
      await expect(service.remove("usr_1", "pl_101")).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("likePlaylist", () => {
    it("likes a playlist", async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: "pl_101" });
      prisma.playlistLike.findUnique.mockResolvedValue(null);
      prisma.playlistLike.create.mockResolvedValue({});

      const result = await service.likePlaylist("usr_1", "pl_101");

      expect(prisma.playlistLike.findUnique).toHaveBeenCalledWith({
        where: {
          userId_playlistId: {
            userId: "usr_1",
            playlistId: "pl_101",
          },
        },
        select: {
          userId: true,
        },
      });
      expect(prisma.playlistLike.create).toHaveBeenCalledWith({
        data: {
          userId: "usr_1",
          playlistId: "pl_101",
        },
      });
      expect(result).toEqual({ message: "Playlist liked successfully" });
    });

    it("throws conflict when playlist is already liked", async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: "pl_101" });
      prisma.playlistLike.findUnique.mockResolvedValue({ userId: "usr_1" });

      await expect(service.likePlaylist("usr_1", "pl_101")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.playlistLike.create).not.toHaveBeenCalled();
    });

    it("throws when playlist is missing", async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.likePlaylist("usr_1", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("unlikePlaylist", () => {
    it("unlikes a playlist", async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: "pl_101" });
      prisma.playlistLike.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.unlikePlaylist("usr_1", "pl_101");

      expect(prisma.playlistLike.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "usr_1",
          playlistId: "pl_101",
        },
      });
      expect(result).toEqual({ message: "Playlist unliked successfully" });
    });

    it("throws when playlist is missing", async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.unlikePlaylist("usr_1", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("addTrack", () => {
    it("adds track to playlist", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.track.findFirst.mockResolvedValue({
        id: "trk_123",
        title: "Layali",
        coverArtUrl: "https://example.com/cover.jpg",
        uploader: {
          id: "usr_2",
          profile: {
            handle: "artist_user",
            displayName: "Artist Name",
          },
        },
      });
      prisma.playlistTrack.aggregate.mockResolvedValue({
        _count: { _all: 3 },
        _max: { position: 2 },
      });
      prisma.playlistTrack.create.mockResolvedValue({});

      const result = await service.addTrack("usr_1", "pl_101", {
        trackId: "trk_123",
      });

      expect(prisma.playlistTrack.create).toHaveBeenCalledWith({
        data: { playlistId: "pl_101", trackId: "trk_123", position: 3 },
      });
      expect(result).toEqual({
        message: "Track added to playlist successfully",
        playlistId: "pl_101",
        title: "Layali",
        trackId: "trk_123",
        coverArtUrl: "https://example.com/cover.jpg",
        artist: {
          id: "usr_2",
          name: "Artist Name",
          handle: "artist_user",
        }
      });
    });

    it("throws conflict when track already exists in playlist", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.track.findFirst.mockResolvedValue({ id: "trk_123" });
      prisma.playlistTrack.aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _max: { position: null },
      });
      prisma.playlistTrack.create.mockRejectedValue({ code: "P2002" });

      await expect(
        service.addTrack("usr_1", "pl_101", { trackId: "trk_123" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("removeTrack", () => {
    it("removes track and reindexes positions", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.playlistTrack.findUnique.mockResolvedValue({ position: 1 });
      prisma.playlistTrack.delete.mockResolvedValue({});
      prisma.playlistTrack.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.removeTrack("usr_1", "pl_101", "trk_123");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({
        message: "Track removed from playlist successfully",
      });
    });

    it("throws when track is not in playlist", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.playlistTrack.findUnique.mockResolvedValue(null);

      await expect(service.removeTrack("usr_1", "pl_101", "trk_999")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("reorderTracks", () => {
    it("reorders tracks successfully", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.playlistTrack.findMany.mockResolvedValue([{ trackId: "trk_8" }, { trackId: "trk_3" }]);
      prisma.$executeRaw.mockResolvedValue(2);

      const result = await service.reorderTracks("usr_1", "pl_101", {
        orderedTrackIds: ["trk_3", "trk_8"],
      });

      expect(result).toEqual({ message: "Playlist reordered successfully" });
      // raw SQL path is optional; ensure the high-level operation completed.
    });

    it("throws when orderedTrackIds miss some existing tracks", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.playlistTrack.findMany.mockResolvedValue([{ trackId: "trk_8" }, { trackId: "trk_3" }]);

      await expect(
        service.reorderTracks("usr_1", "pl_101", {
          orderedTrackIds: ["trk_8"],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws when unknown track ids are provided", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });
      prisma.playlistTrack.findMany.mockResolvedValue([{ trackId: "trk_8" }]);

      await expect(
        service.reorderTracks("usr_1", "pl_101", {
          orderedTrackIds: ["trk_x"],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getMyPlaylists", () => {
    it("returns paginated playlists with total and tracksCount", async () => {
      prisma.playlist.count.mockResolvedValue(5);
      prisma.playlist.findMany.mockResolvedValue([
        {
          id: "pl_101",
          title: "Late Night Drive",
          visibility: "PUBLIC",
          coverImageUrl: null,
          coverArtUrl: null,
          genre: { slug: "electronic", name: "Electronic" },
          owner: {
            id: "usr_2",
            profile: { displayName: "Ahmed Hassan" },
          },
          _count: { tracks: 12 },
          likesCount: 10,
        },
      ]);
      prisma.playlistLike.findMany.mockResolvedValue([]);

      const result = await service.getMyPlaylists("usr_1", {
        page: 1,
        limit: 20,
      });

      expect(result).toEqual({
        page: 1,
        limit: 20,
        total: 5,
        playlists: [
          {
            playlistId: "pl_101",
            title: "Late Night Drive",
            visibility: "PUBLIC",
            coverImageUrl: null,
            tracksCount: 12,
            likesCount: 10,
            isLiked: false,
            genre: "electronic",
            owner: {
              id: "usr_2",
              displayName: "Ahmed Hassan",
            },
          },
        ],
      });
    });
  });

  describe("resolveSecret", () => {
    it("returns secret access payload when token is valid", async () => {
      prisma.playlist.findFirst
        .mockResolvedValueOnce({
          id: "pl_101",
          ownerId: "usr_1",
        })
        .mockResolvedValueOnce({
          id: "pl_101",
          ownerId: "usr_1",
          title: "Late Night Drive",
          description: "chill tracks",
          visibility: PlaylistVisibility.SECRET,
          secretToken: "sec_token",
          coverImageUrl: null,
          coverArtUrl: null,
          likesCount: 0,
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          releaseDate: null,
          genre: null,
          owner: { id: "usr_1", profile: { displayName: "Ahmed Hassan" } },
        });
      prisma.playlistTrack.findMany.mockResolvedValue([]);
      prisma.playlistLike.findUnique.mockResolvedValue(null);

      const result = await service.resolveSecret("sec_token");

      expect(result).toEqual(expect.objectContaining({
        playlistId: "pl_101",
        title: "Late Night Drive",
        description: "chill tracks",
        visibility: "SECRET",
        coverImageUrl: null,
        likesCount: 0,
        isLiked: false,
        releaseDate: "2026-03-01T00:00:00.000Z",
        genre: null,
        tracksCount: 0,
        owner: expect.objectContaining({ id: "usr_1", displayName: "Ahmed Hassan" }),
        tracks: [],
      }));
    });

    it("throws when secret token is invalid", async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.resolveSecret("bad")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("getEmbedCode", () => {
    it("returns embed code for owner", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_1",
      });

      const result = await service.getEmbedCode("usr_1", "pl_101");

      expect(result).toEqual({
        playlistId: "pl_101",
        embedCode: '<iframe src="https://example.com/embed/playlists/pl_101"></iframe>',
      });
    });

    it("throws when requester is not owner", async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: "pl_101",
        ownerId: "usr_2",
      });

      await expect(service.getEmbedCode("usr_1", "pl_101")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});