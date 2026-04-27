import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { TracksController } from "../src/tracks/tracks.controller";
import { UserTracksController } from "../src/tracks/user-tracks.controller";
import { TracksService } from "../src/tracks/tracks.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { TranscodingService } from "../src/tracks/transcoding.service";
import { TrackStatus, TrackVisibility } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Mock auth guard — simulate authenticated requests
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock — simulates DB interactions for E2E
// ─────────────────────────────────────────────────────────────────────────────

const TRACK_ID = "b1c2d3e4-f5a6-4890-abcd-ef1234567890";

function buildTrackRow(overrides: any = {}) {
  return {
    id: TRACK_ID,
    uploaderId: USER_ID,
    title: "Test Track",
    slug: "test-track",
    description: null,
    releaseDate: null,
    durationMs: null,
    waveformData: [],
    visibility: TrackVisibility.PRIVATE,
    accessLevel: "PLAYABLE",
    status: TrackStatus.PROCESSING,
    license: "ALL_RIGHTS_RESERVED",
    allowComments: true,
    downloadable: false,
    coverArtUrl: null,
    secretToken: "secret123456789012345678",
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    primaryGenreId: null,
    uploader: {
      id: USER_ID,
      profile: {
        displayName: "Test Artist",
        handle: "testartist",
        avatarUrl: null,
      },
    },
    primaryGenre: null,
    tags: [],
    files: [],
    _count: { likes: 0, reposts: 0 },
    ...overrides,
  };
}

function buildPrismaMock() {
  const $transaction = jest
    .fn()
    .mockImplementation((fn: any) =>
      typeof fn === "function" ? fn(prismaMock) : Promise.all(fn),
    );

  const prismaMock: any = {
    $transaction,
    track: {
      create: jest.fn().mockResolvedValue(buildTrackRow()),
      findFirst: jest.fn().mockResolvedValue(buildTrackRow()),
      findUnique: jest.fn().mockResolvedValue(buildTrackRow()),
      findMany: jest.fn().mockResolvedValue([buildTrackRow()]),
      update: jest.fn().mockResolvedValue(buildTrackRow()),
      count: jest.fn().mockResolvedValue(1),
    },
    trackFile: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    trackTag: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    tag: {
      upsert: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve({ id: 1, name: where.slug, slug: where.slug }),
        ),
    },
    genre: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: USER_ID,
        profile: { displayName: "Test Artist", avatarUrl: null },
      }),
    },
  };

  return prismaMock;
}

function buildConfigMock() {
  const configMap: Record<string, any> = {
    "storage.provider": "local",
    "storage.localUploadDir": "./test-uploads",
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
// Build MP3 magic bytes for valid file
// ─────────────────────────────────────────────────────────────────────────────

function mp3Buffer(): Buffer {
  const buf = Buffer.alloc(256);
  buf[0] = 0x49; // 'I'
  buf[1] = 0x44; // 'D'
  buf[2] = 0x33; // '3'
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// E2E test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("Tracks E2E (upload + CRUD flow)", () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let transcodingService: { processTrack: jest.Mock };

  beforeAll(async () => {
    prisma = buildPrismaMock();
    transcodingService = {
      processTrack: jest.fn().mockResolvedValue(undefined),
    };

    // Mock fs to avoid actual file writes
    jest.spyOn(require("fs").promises, "mkdir").mockResolvedValue(undefined);
    jest
      .spyOn(require("fs").promises, "writeFile")
      .mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TracksController, UserTracksController],
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: buildConfigMock() },
        { provide: TranscodingService, useValue: transcodingService },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: any) => {
              ctx.switchToHttp().getRequest().user = {
                userId: USER_ID,
                role: "USER",
              };
              return true;
            },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  // Reset all mock return values before each test so earlier tests don't
  // consume the mocked responses needed by later tests.
  beforeEach(() => {
    prisma.track.create.mockResolvedValue(buildTrackRow());
    prisma.track.findFirst.mockResolvedValue(buildTrackRow());
    prisma.track.findUnique.mockResolvedValue(buildTrackRow());
    prisma.track.findMany.mockResolvedValue([buildTrackRow()]);
    prisma.track.update.mockResolvedValue(buildTrackRow());
    prisma.track.count.mockResolvedValue(1);
    prisma.trackFile.create.mockResolvedValue({});
    prisma.trackFile.findMany.mockResolvedValue([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  // ─── 1. Upload → 202 PROCESSING ─────────────────────────────────────
  describe("POST /tracks (upload)", () => {
    it("should accept a valid MP3 upload and return PROCESSING", async () => {
      const res = await request(app.getHttpServer())
        .post("/tracks")
        .attach("audioFile", mp3Buffer(), {
          filename: "song.mp3",
          contentType: "audio/mpeg",
        })
        .field("title", "E2E Track")
        .expect(202);

      expect(res.body).toHaveProperty("trackId", TRACK_ID);
      expect(res.body.status).toBe("PROCESSING");
      expect(res.body.visibility).toBe("PRIVATE");
    });

    it("should trigger background transcoding after upload", async () => {
      await request(app.getHttpServer())
        .post("/tracks")
        .attach("audioFile", mp3Buffer(), {
          filename: "song.mp3",
          contentType: "audio/mpeg",
        })
        .field("title", "E2E Track 2")
        .expect(202);

      // processTrack is fire-and-forget, allow microtask to resolve
      await new Promise((r) => setTimeout(r, 50));
      expect(transcodingService.processTrack).toHaveBeenCalledWith(
        TRACK_ID,
        expect.stringMatching(/^tracks\/.*\.mp3$/),
      );
    });

    it("should reject upload with missing title", async () => {
      await request(app.getHttpServer())
        .post("/tracks")
        .attach("audioFile", mp3Buffer(), {
          filename: "song.mp3",
          contentType: "audio/mpeg",
        })
        .expect(400);
    });

    it("should reject non-audio file types", async () => {
      await request(app.getHttpServer())
        .post("/tracks")
        .attach("audioFile", Buffer.from("not-audio"), {
          filename: "image.png",
          contentType: "image/png",
        })
        .field("title", "Bad File")
        .expect(400);
    });
  });

  // ─── 2. Get Track Status → poll loop ─────────────────────────────────
  describe("GET /tracks/:trackId/status", () => {
    it("should return track status", async () => {
      const res = await request(app.getHttpServer())
        .get(`/tracks/${TRACK_ID}/status`)
        .expect(200);

      expect(res.body).toHaveProperty("trackId", TRACK_ID);
      expect(res.body).toHaveProperty("status");
    });
  });

  // ─── 3. Get Track Details ─────────────────────────────────────────────
  describe("GET /tracks/:trackId", () => {
    it("should return full track details", async () => {
      prisma.track.findFirst.mockResolvedValue(
        buildTrackRow({ status: TrackStatus.FINISHED }),
      );

      const res = await request(app.getHttpServer())
        .get(`/tracks/${TRACK_ID}`)
        .expect(200);

      expect(res.body).toHaveProperty("trackId", TRACK_ID);
      expect(res.body).toHaveProperty("title", "Test Track");
    });

    it("should return 404 for non-existent track", async () => {
      prisma.track.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get("/tracks/00000000-0000-4000-8000-000000000000")
        .expect(404);
    });
  });

  // ─── 4. Update Track Metadata ─────────────────────────────────────────
  describe("PUT /tracks/:trackId", () => {
    it("should update track title", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: null,
      });
      prisma.track.findUnique.mockResolvedValue({
        status: TrackStatus.FINISHED,
      });
      prisma.track.update.mockResolvedValue(
        buildTrackRow({ title: "Updated Title", slug: "updated-title" }),
      );

      const res = await request(app.getHttpServer())
        .put(`/tracks/${TRACK_ID}`)
        .send({ title: "Updated Title" })
        .expect(200);

      expect(res.body.title).toBe("Updated Title");
    });

    it("should reject edits while PROCESSING", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: null,
      });
      prisma.track.findUnique.mockResolvedValue({
        status: TrackStatus.PROCESSING,
      });

      await request(app.getHttpServer())
        .put(`/tracks/${TRACK_ID}`)
        .send({ title: "Too Early" })
        .expect(409);
    });
  });

  // ─── 5. Change Visibility ─────────────────────────────────────────────
  describe("PATCH /tracks/:trackId/visibility", () => {
    it("should toggle visibility to PUBLIC", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
        publishedAt: null,
      });
      prisma.track.update.mockResolvedValue(
        buildTrackRow({
          visibility: TrackVisibility.PUBLIC,
          publishedAt: new Date(),
        }),
      );

      const res = await request(app.getHttpServer())
        .patch(`/tracks/${TRACK_ID}/visibility`)
        .send({ visibility: "PUBLIC" })
        .expect(200);

      expect(res.body.visibility).toBe("PUBLIC");
    });
  });

  // ─── 6. Delete Track ──────────────────────────────────────────────────
  describe("DELETE /tracks/:trackId", () => {
    it("should soft-delete a track", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        uploaderId: USER_ID,
      });
      prisma.track.update.mockResolvedValue({});
      prisma.trackFile.findMany.mockResolvedValue([]);

      await request(app.getHttpServer())
        .delete(`/tracks/${TRACK_ID}`)
        .expect(204);
    });
  });

  // ─── 7. Get Waveform ──────────────────────────────────────────────────
  describe("GET /tracks/:trackId/waveform", () => {
    it("should return waveform data", async () => {
      prisma.track.findFirst.mockResolvedValue({
        id: TRACK_ID,
        waveformData: [0.1, 0.3, 0.5, 0.8],
        status: TrackStatus.FINISHED,
      });

      const res = await request(app.getHttpServer())
        .get(`/tracks/${TRACK_ID}/waveform`)
        .expect(200);

      expect(res.body.waveformData).toEqual([0.1, 0.3, 0.5, 0.8]);
    });
  });

  // ─── 8. Secret Token Access ───────────────────────────────────────────
  describe("GET /tracks/secret/:secretToken", () => {
    it("should resolve a private track by secret token", async () => {
      prisma.track.findFirst.mockResolvedValue(buildTrackRow());

      const res = await request(app.getHttpServer())
        .get("/tracks/secret/secret123456789012345678")
        .expect(200);

      expect(res.body).toHaveProperty("trackId", TRACK_ID);
      expect(res.body.message).toContain("secret token");
    });

    it("should 404 for invalid secret token", async () => {
      prisma.track.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get("/tracks/secret/badtoken")
        .expect(404);
    });
  });
});
