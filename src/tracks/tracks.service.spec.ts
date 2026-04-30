import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { TracksService } from "./tracks.service";
import { TranscodingService } from "./transcoding.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../common/storage/storage.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import {
  TrackVisibility,
  TrackStatus,
  FileRole,
  FileStatus,
} from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Test data factories
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_USER_ID = "11111111-2222-3333-4444-555555555555";
const TRACK_ID = "tttttttt-rrrr-aaaa-cccc-kkkkkkkkkkkk";

function buildTrackRecord(overrides: Partial<any> = {}) {
  return {
    id: TRACK_ID,
    uploaderId: USER_ID,
    title: "Test Track",
    slug: "test-track",
    description: "A test track",
    releaseDate: new Date("2026-03-01"),
    durationMs: 180000,
    waveformData: [0.1, 0.3, 0.5],
    visibility: TrackVisibility.PUBLIC,
    accessLevel: "PLAYABLE",
    status: TrackStatus.FINISHED,
    license: "ALL_RIGHTS_RESERVED",
    allowComments: true,
    downloadable: false,
    coverArtUrl: null,
    secretToken: "abc123secrettoken1234567",
    publishedAt: new Date("2026-03-01"),
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-03-01"),
    deletedAt: null,
    primaryGenreId: 1,
    uploader: {
      id: USER_ID,
      profile: {
        displayName: "Test Artist",
        handle: "testartist",
        avatarUrl: "https://example.com/avatar.jpg",
      },
    },
    primaryGenre: { id: 1, name: "Pop", slug: "pop" },
    tags: [{ tag: { name: "pop", slug: "pop" } }],
    files: [
      {
        id: "file-1",
        fileRole: FileRole.ORIGINAL,
        mimeType: "audio/mpeg",
        format: "mp3",
        fileSizeBytes: BigInt(5000000),
        status: FileStatus.READY,
      },
    ],
    ...overrides,
  };
}

/** Valid MP3 buffer (starts with ID3 header) */
function buildValidMp3Buffer(sizeBytes = 1024): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  // ID3 magic bytes
  buf[0] = 0x49; // 'I'
  buf[1] = 0x44; // 'D'
  buf[2] = 0x33; // '3'
  return buf;
}

/** Valid WAV buffer (starts with RIFF....WAVE) */
function buildValidWavBuffer(sizeBytes = 1024): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(sizeBytes - 8, 4);
  buf.write("WAVE", 8);
  return buf;
}

/** Invalid file buffer (e.g., a PNG) */
function buildInvalidBuffer(): Buffer {
  const buf = Buffer.alloc(1024);
  // PNG magic bytes
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  return buf;
}

function buildMulterFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: "audioFile",
    originalname: "test-song.mp3",
    encoding: "7bit",
    mimetype: "audio/mpeg",
    size: 1024,
    buffer: buildValidMp3Buffer(),
    destination: "",
    filename: "",
    path: "",
    stream: null as any,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock
// ─────────────────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  const $transaction = jest
    .fn()
    .mockImplementation((fn: any) =>
      typeof fn === "function" ? fn(prismaMock) : Promise.all(fn),
    );

  const prismaMock: any = {
    $transaction,
    track: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    trackFile: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    trackTag: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    tag: {
      upsert: jest.fn(),
    },
    genre: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    like: {
      findUnique: jest.fn(),
    },
    repost: {
      findUnique: jest.fn(),
    },
  };

  return prismaMock;
}

function buildConfigMock() {
  const configMap: Record<string, any> = {
    "storage.provider": "local",
    "storage.localUploadDir": "./uploads",
    "storage.localUploadUrl": "http://localhost:3000/uploads",
    "storage.s3Bucket": "",
    "storage.s3Region": "us-east-1",
    "storage.cdnUrl": "",
    "storage.awsAccessKeyId": "",
    "storage.awsSecretAccessKey": "",
    "app.transcodingApiKey": "test-api-key-123456789012345678901234567890",
  };

  return {
    get: jest.fn(
      (key: string, defaultValue?: any) => configMap[key] ?? defaultValue,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("TracksService", () => {
  let service: TracksService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let config: ReturnType<typeof buildConfigMock>;
  let transcodingService: { processTrack: jest.Mock };
  let subscriptionsServiceMock: { getUploadQuota: jest.Mock };
  let storageServiceMock: { upload: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    config = buildConfigMock();
    transcodingService = {
      processTrack: jest.fn().mockResolvedValue(undefined),
    };
    subscriptionsServiceMock = {
      getUploadQuota: jest
        .fn()
        .mockResolvedValue({ uploadLimit: 100, uploadedCount: 0 }),
    };
    storageServiceMock = {
      upload: jest.fn().mockResolvedValue({
        url: "https://cdn.example.com/cover/test.jpg",
        key: "cover/test.jpg",
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: TranscodingService, useValue: transcodingService },
        { provide: StorageService, useValue: storageServiceMock },
        { provide: SubscriptionsService, useValue: subscriptionsServiceMock },
      ],
    }).compile();

    service = module.get<TracksService>(TracksService);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD TRACK
  // ═══════════════════════════════════════════════════════════════════════════

  describe("uploadTrack", () => {
    const dto = { title: "Ya Ana", genre: "Pop", tags: ["pop", "arabic"] };

    beforeEach(() => {
      prisma.genre.findFirst.mockResolvedValue({
        id: 1,
        name: "Pop",
        slug: "pop",
      });
      prisma.track.create.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        title: "Ya Ana",
        slug: "ya-ana",
        status: TrackStatus.PROCESSING,
        visibility: TrackVisibility.PRIVATE,
      });
      prisma.trackFile.create.mockResolvedValue({});
      prisma.tag.upsert.mockImplementation(({ where }: any) =>
        Promise.resolve({ id: 1, name: where.slug, slug: where.slug }),
      );
      prisma.trackTag.create.mockResolvedValue({});

      // Mock fs for local upload
      jest.spyOn(require("fs").promises, "mkdir").mockResolvedValue(undefined);
      jest
        .spyOn(require("fs").promises, "writeFile")
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should upload a valid MP3 track", async () => {
      const file = buildMulterFile();
      const result = await service.uploadTrack(USER_ID, dto, file);

      expect(result).toEqual({
        trackId: TRACK_ID,
        title: "Ya Ana",
        artistId: USER_ID,
        status: TrackStatus.PROCESSING,
        visibility: TrackVisibility.PRIVATE,
        coverArtUrl: null,
        waveformData: null,
      });
      expect(prisma.track.create).toHaveBeenCalledTimes(1);
      expect(prisma.trackFile.create).toHaveBeenCalledTimes(1);
    });

    it("should upload a valid WAV track", async () => {
      const file = buildMulterFile({
        mimetype: "audio/wav",
        buffer: buildValidWavBuffer(),
      });
      const result = await service.uploadTrack(USER_ID, dto, file);

      expect(result.trackId).toBe(TRACK_ID);
      expect(result.status).toBe(TrackStatus.PROCESSING);
    });

    it("should reject when no file is provided", async () => {
      await expect(
        service.uploadTrack(USER_ID, dto, null as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject when file has no buffer", async () => {
      const file = buildMulterFile({ buffer: undefined as any });
      await expect(service.uploadTrack(USER_ID, dto, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject files that exceed 250MB", async () => {
      const file = buildMulterFile({ size: 251 * 1024 * 1024 });
      await expect(service.uploadTrack(USER_ID, dto, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject non-audio files (invalid magic bytes)", async () => {
      const file = buildMulterFile({ buffer: buildInvalidBuffer() });
      await expect(service.uploadTrack(USER_ID, dto, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reject unknown genre", async () => {
      prisma.genre.findFirst.mockResolvedValue(null);
      const file = buildMulterFile();
      await expect(
        service.uploadTrack(
          USER_ID,
          { title: "Test", genre: "FakeGenre" },
          file,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should work without optional genre and tags", async () => {
      const file = buildMulterFile();
      const result = await service.uploadTrack(
        USER_ID,
        { title: "Simple" },
        file,
      );

      expect(result.trackId).toBe(TRACK_ID);
    });

    it("should create tags when provided", async () => {
      const file = buildMulterFile();
      await service.uploadTrack(USER_ID, dto, file);

      // Called once per tag
      expect(prisma.tag.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.trackTag.create).toHaveBeenCalledTimes(2);
    });

    it("should accept MP3 with frame sync bytes (0xFF 0xFB)", async () => {
      const buf = Buffer.alloc(1024);
      buf[0] = 0xff;
      buf[1] = 0xfb;
      const file = buildMulterFile({ buffer: buf });

      const result = await service.uploadTrack(USER_ID, dto, file);
      expect(result.status).toBe(TrackStatus.PROCESSING);
    });

    it("should reject buffer smaller than 12 bytes", async () => {
      const file = buildMulterFile({ buffer: Buffer.alloc(5) });
      await expect(service.uploadTrack(USER_ID, dto, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should set releaseDate when provided", async () => {
      const file = buildMulterFile();
      await service.uploadTrack(
        USER_ID,
        { title: "With Date", releaseDate: "2026-06-01" },
        file,
      );

      const createCall = prisma.track.create.mock.calls[0][0];
      expect(createCall.data.releaseDate).toEqual(new Date("2026-06-01"));
    });

    it("should set description when provided", async () => {
      const file = buildMulterFile();
      await service.uploadTrack(
        USER_ID,
        { title: "With Desc", description: "A great song" },
        file,
      );

      const createCall = prisma.track.create.mock.calls[0][0];
      expect(createCall.data.description).toBe("A great song");
    });

    it("should handle unknown mimetype by defaulting to audio/mpeg", async () => {
      const file = buildMulterFile({ mimetype: "application/octet-stream" });
      const result = await service.uploadTrack(
        USER_ID,
        { title: "Unknown Mime" },
        file,
      );
      expect(result.trackId).toBe(TRACK_ID);
    });

    // ── Upload quota enforcement ─────────────────────────────────────────────

    it("should throw ForbiddenException when free user has reached the 3-track limit", async () => {
      subscriptionsServiceMock.getUploadQuota.mockResolvedValue({
        uploadLimit: 3,
        uploadedCount: 3,
      });
      const file = buildMulterFile();

      await expect(
        service.uploadTrack(USER_ID, { title: "Over Limit" }, file),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should allow upload when free user still has quota remaining (2 of 3 used)", async () => {
      subscriptionsServiceMock.getUploadQuota.mockResolvedValue({
        uploadLimit: 3,
        uploadedCount: 2,
      });
      const file = buildMulterFile();

      const result = await service.uploadTrack(
        USER_ID,
        { title: "Under Limit" },
        file,
      );
      expect(result.trackId).toBe(TRACK_ID);
    });

    it("should allow PRO user to upload beyond 3 tracks (uploadLimit=100, uploadedCount=50)", async () => {
      subscriptionsServiceMock.getUploadQuota.mockResolvedValue({
        uploadLimit: 100,
        uploadedCount: 50,
      });
      const file = buildMulterFile();

      const result = await service.uploadTrack(
        USER_ID,
        { title: "PRO Track 51" },
        file,
      );
      expect(result.trackId).toBe(TRACK_ID);
    });

    it("should allow GO+ user with high track count (uploadLimit=1000, uploadedCount=500)", async () => {
      subscriptionsServiceMock.getUploadQuota.mockResolvedValue({
        uploadLimit: 1000,
        uploadedCount: 500,
      });
      const file = buildMulterFile();

      const result = await service.uploadTrack(
        USER_ID,
        { title: "GO+ Track" },
        file,
      );
      expect(result.trackId).toBe(TRACK_ID);
    });

    // ── Cover art upload ─────────────────────────────────────────────────────

    it("should upload with cover art and set coverArtUrl on the track", async () => {
      const file = buildMulterFile();
      const coverArtFile = buildMulterFile({
        fieldname: "coverArt",
        originalname: "cover.jpg",
        mimetype: "image/jpeg",
        buffer: Buffer.alloc(1024, 0xff),
      });

      prisma.track.create.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        title: "With Cover",
        slug: "with-cover",
        status: TrackStatus.PROCESSING,
        visibility: TrackVisibility.PRIVATE,
        coverArtUrl: "https://cdn.example.com/cover/test.jpg",
      });

      const result = await service.uploadTrack(
        USER_ID,
        { title: "With Cover" },
        file,
        coverArtFile,
      );

      expect(storageServiceMock.upload).toHaveBeenCalledTimes(1);
      expect(storageServiceMock.upload).toHaveBeenCalledWith(
        coverArtFile.buffer,
        expect.objectContaining({ type: "cover", mimeType: "image/jpeg" }),
      );
      expect(result.coverArtUrl).toBe("https://cdn.example.com/cover/test.jpg");
    });

    it("should upload without cover art and have null coverArtUrl", async () => {
      const file = buildMulterFile();

      const result = await service.uploadTrack(
        USER_ID,
        { title: "No Cover" },
        file,
      );

      expect(storageServiceMock.upload).not.toHaveBeenCalled();
      expect(result.coverArtUrl).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET TRACK BY ID
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getTrackById", () => {
    it("should return a public track for any user", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRecord());
      const result = await service.getTrackById(TRACK_ID, OTHER_USER_ID);

      expect(result.trackId).toBe(TRACK_ID);
      expect(result.title).toBe("Test Track");
      expect(result.artist).toBe("Test Artist");
    });

    it("should return a private track to its owner", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({ visibility: TrackVisibility.PRIVATE }),
      );
      const result = await service.getTrackById(TRACK_ID, USER_ID);

      expect(result.trackId).toBe(TRACK_ID);
    });

    it("should hide a private track from non-owners", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({ visibility: TrackVisibility.PRIVATE }),
      );
      await expect(
        service.getTrackById(TRACK_ID, OTHER_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);
      await expect(
        service.getTrackById("nonexistent-id", USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return a public track for unauthenticated users", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRecord());
      const result = await service.getTrackById(TRACK_ID, undefined);

      expect(result.trackId).toBe(TRACK_ID);
    });

    it("should format tags correctly", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({
          tags: [
            { tag: { name: "pop", slug: "pop" } },
            { tag: { name: "arabic", slug: "arabic" } },
          ],
        }),
      );
      const result = await service.getTrackById(TRACK_ID, USER_ID);
      expect(result.tags).toEqual(["pop", "arabic"]);
    });

    it("should handle track with no genre", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({ primaryGenre: null }),
      );
      const result = await service.getTrackById(TRACK_ID, USER_ID);
      expect(result.genre).toBeNull();
    });

    it("should handle track with no tags", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRecord({ tags: [] }));
      const result = await service.getTrackById(TRACK_ID, USER_ID);
      expect(result.tags).toEqual([]);
    });

    it("should handle track with no files", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRecord({ files: [] }));
      const result = await service.getTrackById(TRACK_ID, USER_ID);
      expect(result.files).toEqual([]);
    });

    it("should convert BigInt fileSizeBytes to Number", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({
          files: [
            {
              id: "file-1",
              fileRole: FileRole.ORIGINAL,
              mimeType: "audio/mpeg",
              format: "mp3",
              fileSizeBytes: BigInt(5000000),
              status: FileStatus.READY,
            },
          ],
        }),
      );
      const result = await service.getTrackById(TRACK_ID, USER_ID);
      expect(result.files[0].size).toBe(5000000);
      expect(typeof result.files[0].size).toBe("number");
    });

    it("should return null size when fileSizeBytes is null", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({
          files: [
            {
              id: "file-1",
              fileRole: FileRole.ORIGINAL,
              mimeType: "audio/mpeg",
              format: "mp3",
              fileSizeBytes: null,
              status: FileStatus.READY,
            },
          ],
        }),
      );
      const result = await service.getTrackById(TRACK_ID, USER_ID);
      expect(result.files[0].size).toBeNull();
    });

    it("should return complete detail shape", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRecord());
      const result = await service.getTrackById(TRACK_ID, USER_ID);

      // Verify all expected fields exist
      expect(result).toHaveProperty("trackId");
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("slug");
      expect(result).toHaveProperty("description");
      expect(result).toHaveProperty("artist");
      expect(result).toHaveProperty("artistId");
      expect(result).toHaveProperty("artistHandle");
      expect(result).toHaveProperty("artistAvatarUrl");
      expect(result).toHaveProperty("genre");
      expect(result).toHaveProperty("tags");
      expect(result).toHaveProperty("releaseDate");
      expect(result).toHaveProperty("durationMs");
      expect(result).toHaveProperty("waveformData");
      expect(result).toHaveProperty("visibility");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("secretToken");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("updatedAt");
      expect(result).toHaveProperty("files");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET TRACK STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getTrackStatus", () => {
    it("should return status for any visible track", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
        uploaderId: USER_ID,
        visibility: TrackVisibility.PUBLIC,
      });
      const result = await service.getTrackStatus(TRACK_ID, OTHER_USER_ID);

      expect(result).toEqual({
        trackId: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
    });

    it("should hide private track status from non-owners", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
        uploaderId: USER_ID,
        visibility: TrackVisibility.PRIVATE,
      });
      await expect(
        service.getTrackStatus(TRACK_ID, OTHER_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("should allow owner to see private track status", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
        uploaderId: USER_ID,
        visibility: TrackVisibility.PRIVATE,
      });
      const result = await service.getTrackStatus(TRACK_ID, USER_ID);
      expect(result.status).toBe(TrackStatus.PROCESSING);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);
      await expect(
        service.getTrackStatus("nonexistent", USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it("should allow unauthenticated users to see public track status", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.FINISHED,
        uploaderId: USER_ID,
        visibility: TrackVisibility.PUBLIC,
      });
      const result = await service.getTrackStatus(TRACK_ID, undefined);
      expect(result.status).toBe(TrackStatus.FINISHED);
    });

    it("should hide private track from unauthenticated users", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
        uploaderId: USER_ID,
        visibility: TrackVisibility.PRIVATE,
      });
      await expect(service.getTrackStatus(TRACK_ID, undefined)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE TRACK
  // ═══════════════════════════════════════════════════════════════════════════

  describe("updateTrack", () => {
    beforeEach(() => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: null,
      });
      prisma.track.findUnique.mockResolvedValue({
        status: TrackStatus.FINISHED,
      });
      prisma.trackTag.deleteMany.mockResolvedValue({ count: 0 });
      prisma.tag.upsert.mockImplementation(({ where }: any) =>
        Promise.resolve({ id: 1, name: where.slug, slug: where.slug }),
      );
      prisma.trackTag.create.mockResolvedValue({});
    });

    it("should update title for the owner", async () => {
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ title: "New Title", slug: "new-title" }),
      );
      const result = await service.updateTrack(TRACK_ID, USER_ID, {
        title: "New Title",
      });

      expect(result.title).toBe("New Title");
      expect(prisma.track.update).toHaveBeenCalledTimes(1);
    });

    it("should reject updates from non-owners", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: OTHER_USER_ID,
        publishedAt: null,
      });

      await expect(
        service.updateTrack(TRACK_ID, USER_ID, { title: "Hack" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);
      await expect(
        service.updateTrack("nonexistent", USER_ID, { title: "X" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should reject edits while track is PROCESSING", async () => {
      prisma.track.findUnique.mockResolvedValue({
        status: TrackStatus.PROCESSING,
      });
      await expect(
        service.updateTrack(TRACK_ID, USER_ID, { title: "Too Early" }),
      ).rejects.toThrow(ConflictException);
    });

    it("should resolve a new genre when updating", async () => {
      prisma.genre.findFirst.mockResolvedValue({
        id: 2,
        name: "Rock",
        slug: "rock",
      });
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({
          primaryGenre: { id: 2, name: "Rock", slug: "rock" },
        }),
      );

      const result = await service.updateTrack(TRACK_ID, USER_ID, {
        genre: "Rock",
      });
      expect(result.genre).toBe("Rock");
    });

    it("should reject unknown genre on update", async () => {
      prisma.genre.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTrack(TRACK_ID, USER_ID, { genre: "Nonexistent" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should replace tags when updating", async () => {
      prisma.track.update.mockResolvedValue(buildTrackRecord());

      await service.updateTrack(TRACK_ID, USER_ID, { tags: ["newtag"] });

      expect(prisma.trackTag.deleteMany).toHaveBeenCalledWith({
        where: { trackId: TRACK_ID },
      });
      expect(prisma.tag.upsert).toHaveBeenCalledTimes(1);
    });

    it("should clear all tags when empty array is provided", async () => {
      prisma.track.update.mockResolvedValue(buildTrackRecord({ tags: [] }));

      await service.updateTrack(TRACK_ID, USER_ID, { tags: [] });

      expect(prisma.trackTag.deleteMany).toHaveBeenCalledWith({
        where: { trackId: TRACK_ID },
      });
      expect(prisma.tag.upsert).not.toHaveBeenCalled();
    });

    it("should remove genre when empty string is provided", async () => {
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ primaryGenre: null }),
      );

      const result = await service.updateTrack(TRACK_ID, USER_ID, {
        genre: "",
      });

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.primaryGenre).toEqual({ disconnect: true });
      expect(result.genre).toBeNull();
    });

    it("should update description", async () => {
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ description: "Updated desc" }),
      );

      const result = await service.updateTrack(TRACK_ID, USER_ID, {
        description: "Updated desc",
      });

      expect(result.description).toBe("Updated desc");
    });

    it("should update releaseDate", async () => {
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ releaseDate: new Date("2026-06-01") }),
      );

      await service.updateTrack(TRACK_ID, USER_ID, {
        releaseDate: "2026-06-01",
      });

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.releaseDate).toEqual(new Date("2026-06-01"));
    });

    it("should clear releaseDate when null is provided", async () => {
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ releaseDate: null }),
      );

      await service.updateTrack(TRACK_ID, USER_ID, {
        releaseDate: null as any,
      });

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.releaseDate).toBeNull();
    });

    it("should auto-regenerate slug when title is updated", async () => {
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ title: "New Title", slug: "new-title" }),
      );

      await service.updateTrack(TRACK_ID, USER_ID, { title: "New Title" });

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.slug).toBe("new-title");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE TRACK
  // ═══════════════════════════════════════════════════════════════════════════

  describe("deleteTrack", () => {
    beforeEach(() => {
      prisma.trackFile.findMany.mockResolvedValue([]);
    });

    it("should soft-delete a track for the owner", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
      });
      prisma.track.update.mockResolvedValue({});

      await service.deleteTrack(TRACK_ID, USER_ID, "USER");

      expect(prisma.track.update).toHaveBeenCalledWith({
        where: { id: TRACK_ID },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("should allow admin to delete any track", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: OTHER_USER_ID,
      });
      prisma.track.update.mockResolvedValue({});

      await service.deleteTrack(TRACK_ID, USER_ID, "ADMIN");

      expect(prisma.track.update).toHaveBeenCalledTimes(1);
    });

    it("should reject delete from non-owner non-admin", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: OTHER_USER_ID,
      });

      await expect(
        service.deleteTrack(TRACK_ID, USER_ID, "USER"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteTrack("nonexistent", USER_ID, "USER"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should trigger file cleanup after deletion", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
      });
      prisma.track.update.mockResolvedValue({});
      prisma.trackFile.findMany.mockResolvedValue([
        { storageKey: "tracks/test.mp3" },
      ]);

      await service.deleteTrack(TRACK_ID, USER_ID, "USER");

      // Give the fire-and-forget promise a tick to resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(prisma.trackFile.findMany).toHaveBeenCalledWith({
        where: { trackId: TRACK_ID },
        select: { storageKey: true },
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANGE VISIBILITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe("changeVisibility", () => {
    it("should change visibility for the owner", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: null,
      });
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({
          visibility: TrackVisibility.PUBLIC,
          publishedAt: new Date(),
        }),
      );

      const result = await service.changeVisibility(
        TRACK_ID,
        USER_ID,
        TrackVisibility.PUBLIC,
      );

      expect(result.visibility).toBe(TrackVisibility.PUBLIC);
    });

    it("should regenerate secretToken when switching to PRIVATE", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: new Date(),
      });
      prisma.track.update.mockResolvedValue(
        buildTrackRecord({ visibility: TrackVisibility.PRIVATE }),
      );

      await service.changeVisibility(
        TRACK_ID,
        USER_ID,
        TrackVisibility.PRIVATE,
      );

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.secretToken).toBeDefined();
      expect(typeof updateCall.data.secretToken).toBe("string");
    });

    it("should set publishedAt when first going PUBLIC", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: null, // never published before
      });
      prisma.track.update.mockResolvedValue(buildTrackRecord());

      await service.changeVisibility(TRACK_ID, USER_ID, TrackVisibility.PUBLIC);

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.publishedAt).toEqual(expect.any(Date));
    });

    it("should reject from non-owner", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: OTHER_USER_ID,
        publishedAt: null,
      });

      await expect(
        service.changeVisibility(TRACK_ID, USER_ID, TrackVisibility.PUBLIC),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);

      await expect(
        service.changeVisibility(TRACK_ID, USER_ID, TrackVisibility.PUBLIC),
      ).rejects.toThrow(NotFoundException);
    });

    it("should NOT reset publishedAt when already published and going PUBLIC again", async () => {
      const existingDate = new Date("2026-01-01");
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: existingDate, // already published
      });
      prisma.track.update.mockResolvedValue(buildTrackRecord());

      await service.changeVisibility(TRACK_ID, USER_ID, TrackVisibility.PUBLIC);

      const updateCall = prisma.track.update.mock.calls[0][0];
      // publishedAt should NOT be in the update data - keep existing
      expect(updateCall.data.publishedAt).toBeUndefined();
    });

    it("should NOT set secretToken when going PUBLIC", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: new Date(),
      });
      prisma.track.update.mockResolvedValue(buildTrackRecord());

      await service.changeVisibility(TRACK_ID, USER_ID, TrackVisibility.PUBLIC);

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.secretToken).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET USER TRACKS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getUserTracks", () => {
    const mockArtist = {
      id: USER_ID,
      profile: {
        displayName: "Test Artist",
        avatarUrl: "https://example.com/avatar.jpg",
      },
    };

    it("should return paginated tracks for owner (all tracks)", async () => {
      const tracks = [buildTrackRecord()];
      prisma.track.findMany.mockResolvedValue(tracks);
      prisma.track.count.mockResolvedValue(1);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      const result = await service.getUserTracks(USER_ID, USER_ID, 1, 20);

      expect(result.totalTracks).toBe(1);
      expect(result.tracks).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      // Owner sees all - no visibility filter
      const whereArg = prisma.track.findMany.mock.calls[0][0].where;
      expect(whereArg.visibility).toBeUndefined();
    });

    it("should filter to PUBLIC+FINISHED for non-owners", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      await service.getUserTracks(USER_ID, OTHER_USER_ID, 1, 20);

      const whereArg = prisma.track.findMany.mock.calls[0][0].where;
      expect(whereArg.visibility).toBe(TrackVisibility.PUBLIC);
      expect(whereArg.status).toBe(TrackStatus.FINISHED);
    });

    it("should filter to PUBLIC+FINISHED for unauthenticated users", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      await service.getUserTracks(USER_ID, undefined, 1, 20);

      const whereArg = prisma.track.findMany.mock.calls[0][0].where;
      expect(whereArg.visibility).toBe(TrackVisibility.PUBLIC);
    });

    it("should apply correct pagination offset", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(50);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      await service.getUserTracks(USER_ID, USER_ID, 3, 10);

      const findCall = prisma.track.findMany.mock.calls[0][0];
      expect(findCall.skip).toBe(20); // (3 - 1) * 10
      expect(findCall.take).toBe(10);
    });

    it("should format artist info from user profile", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      const result = await service.getUserTracks(USER_ID, undefined, 1, 20);

      expect(result.artist).toEqual({
        userId: USER_ID,
        name: "Test Artist",
        avatarUrl: "https://example.com/avatar.jpg",
      });
    });

    it("should return null artist when user not found", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getUserTracks(USER_ID, undefined, 1, 20);

      expect(result.artist).toBeNull();
    });

    it("should format track list items correctly", async () => {
      prisma.track.findMany.mockResolvedValue([buildTrackRecord()]);
      prisma.track.count.mockResolvedValue(1);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      const result = await service.getUserTracks(USER_ID, USER_ID, 1, 20);
      const item = result.tracks[0];

      expect(item).toHaveProperty("trackId");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("slug");
      expect(item).toHaveProperty("durationMs");
      expect(item).toHaveProperty("waveformData");
      expect(item).toHaveProperty("visibility");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("coverArtUrl");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("genre");
      expect(item.artist).toHaveProperty("id");
      expect(item.artist).toHaveProperty("displayName");
      expect(item.artist).toHaveProperty("handle");
      expect(item.artist).toHaveProperty("avatarUrl");
    });

    it("should order by createdAt descending", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(mockArtist);

      await service.getUserTracks(USER_ID, USER_ID, 1, 20);

      const findCall = prisma.track.findMany.mock.calls[0][0];
      expect(findCall.orderBy).toEqual({ createdAt: "desc" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET WAVEFORM
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getWaveform", () => {
    it("should return waveform data", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        waveformData: [0.1, 0.3, 0.5],
        status: TrackStatus.FINISHED,
      });

      const result = await service.getWaveform(TRACK_ID);

      expect(result).toEqual({
        trackId: TRACK_ID,
        waveformData: [0.1, 0.3, 0.5],
      });
    });

    it("should return empty array if no waveform yet", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        waveformData: [],
        status: TrackStatus.PROCESSING,
      });

      const result = await service.getWaveform(TRACK_ID);
      expect(result.waveformData).toEqual([]);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);
      await expect(service.getWaveform("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return null waveformData when not yet generated", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        waveformData: null,
        status: TrackStatus.PROCESSING,
      });

      const result = await service.getWaveform(TRACK_ID);
      expect(result.waveformData).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSCODING CALLBACK
  // ═══════════════════════════════════════════════════════════════════════════

  describe("handleTranscodingCallback", () => {
    const API_KEY = "test-api-key-123456789012345678901234567890";

    it("should update track status to FINISHED", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});
      prisma.trackFile.create.mockResolvedValue({});

      const result = await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FINISHED",
        fileUrls: { mp3: "https://cdn.example.com/track.mp3" },
      });

      expect(result).toEqual({
        trackId: TRACK_ID,
        status: TrackStatus.FINISHED,
      });
    });

    it("should update track status to FAILED", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});

      const result = await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FAILED",
      });

      expect(result.status).toBe(TrackStatus.FAILED);
    });

    it("should reject invalid API key", async () => {
      await expect(
        service.handleTranscodingCallback("wrong-key", {
          trackId: TRACK_ID,
          status: "FINISHED",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should reject if track not in PROCESSING state", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.FINISHED,
      });

      await expect(
        service.handleTranscodingCallback(API_KEY, {
          trackId: TRACK_ID,
          status: "FINISHED",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw 404 for non-existent track", async () => {
      prisma.track.findUnique.mockResolvedValue(null);

      await expect(
        service.handleTranscodingCallback(API_KEY, {
          trackId: "nonexistent",
          status: "FINISHED",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should store generated file URLs on FINISHED", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});
      prisma.trackFile.create.mockResolvedValue({});

      await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FINISHED",
        fileUrls: { mp3: "url1", wav: "url2" },
      });

      expect(prisma.trackFile.create).toHaveBeenCalledTimes(2);
    });

    it("should NOT store files on FAILED status", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});

      await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FAILED",
      });

      expect(prisma.trackFile.create).not.toHaveBeenCalled();
    });

    it("should assign STREAM role to mp3 and ORIGINAL role to other formats", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});
      prisma.trackFile.create.mockResolvedValue({});

      await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FINISHED",
        fileUrls: { mp3: "url1", wav: "url2" },
      });

      const calls = prisma.trackFile.create.mock.calls;
      const mp3Call = calls.find((c: any) => c[0].data.format === "mp3");
      const wavCall = calls.find((c: any) => c[0].data.format === "wav");
      expect(mp3Call[0].data.fileRole).toBe(FileRole.STREAM);
      expect(wavCall[0].data.fileRole).toBe(FileRole.ORIGINAL);
    });

    it("should store waveformData and durationMs on FINISHED", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});
      prisma.trackFile.create.mockResolvedValue({});

      await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FINISHED",
        fileUrls: { mp3: "url1" },
        waveformData: [0.1, 0.5, 0.9],
        durationMs: 210000,
      });

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.waveformData).toEqual([0.1, 0.5, 0.9]);
      expect(updateCall.data.durationMs).toBe(210000);
    });

    it("should NOT store waveformData on FAILED", async () => {
      prisma.track.findUnique.mockResolvedValue({
        id: TRACK_ID,
        status: TrackStatus.PROCESSING,
      });
      prisma.track.update.mockResolvedValue({});

      await service.handleTranscodingCallback(API_KEY, {
        trackId: TRACK_ID,
        status: "FAILED",
        waveformData: [0.1, 0.5],
        durationMs: 100000,
      });

      const updateCall = prisma.track.update.mock.calls[0][0];
      expect(updateCall.data.waveformData).toBeUndefined();
      expect(updateCall.data.durationMs).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECRET TOKEN ACCESS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getTrackBySecretToken", () => {
    it("should return a track by its secret token", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRecord());

      const result = await service.getTrackBySecretToken(
        "abc123secrettoken1234567",
      );

      expect(result.trackId).toBe(TRACK_ID);
      expect(result.title).toBe("Test Track");
      expect(result.message).toBe("Access granted via secret token");
    });

    it("should throw 404 for invalid token", async () => {
      prisma.track.findFirst.mockResolvedValue(null);

      await expect(
        service.getTrackBySecretToken("invalid-token"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should include full detail fields plus message", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRecord({ visibility: TrackVisibility.PRIVATE }),
      );

      const result = await service.getTrackBySecretToken(
        "abc123secrettoken1234567",
      );

      expect(result.visibility).toBe("PRIVATE");
      expect(result.artist).toBe("Test Artist");
      expect(result.genre).toBe("Pop");
      expect(result.files).toBeDefined();
      expect(result.message).toBe("Access granted via secret token");
    });
  });
});
