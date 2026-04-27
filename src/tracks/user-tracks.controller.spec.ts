import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { UserTracksController } from "./user-tracks.controller";
import { TracksService } from "./tracks.service";

// ─────────────────────────────────────────────────────────────────────────────
// Stub responses
// ─────────────────────────────────────────────────────────────────────────────

const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const mockListResponse = {
  artist: { userId: UUID, name: "Test Artist", avatarUrl: null },
  page: 1,
  limit: 20,
  totalTracks: 1,
  tracks: [
    {
      trackId: "trk-1111-2222-3333-444444444444",
      title: "Song One",
      slug: "song-one",
      visibility: "PUBLIC",
      status: "FINISHED",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock service (only getUserTracks is needed)
// ─────────────────────────────────────────────────────────────────────────────

function buildServiceMock() {
  return {
    getUserTracks: jest.fn().mockResolvedValue(mockListResponse),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [UserTracksController],
    providers: [
      { provide: TracksService, useValue: serviceMock },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: (ctx: any) => {
            ctx.switchToHttp().getRequest().user = {
              userId: "requester-1",
              role: "USER",
            };
            return true;
          },
        },
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("UserTracksController", () => {
  let app: INestApplication;
  let svc: ReturnType<typeof buildServiceMock>;

  beforeEach(async () => {
    svc = buildServiceMock();
    app = await buildApp(svc);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  // ── GET /users/:userId/tracks ──────────────────────────────────────────
  describe("GET /users/:userId/tracks", () => {
    it("should return 200 and call getUserTracks with defaults", async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${UUID}/tracks`)
        .expect(200);

      expect(svc.getUserTracks).toHaveBeenCalledWith(
        UUID,
        "requester-1", // requesterId from guard mock
        1, // default page
        20, // default limit
      );
      expect(res.body).toHaveProperty("totalTracks", 1);
      expect(res.body.tracks).toHaveLength(1);
    });

    it("should forward custom page and limit query params", async () => {
      await request(app.getHttpServer())
        .get(`/users/${UUID}/tracks?page=3&limit=10`)
        .expect(200);

      expect(svc.getUserTracks).toHaveBeenCalledWith(
        UUID,
        "requester-1",
        3,
        10,
      );
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .get("/users/not-a-uuid/tracks")
        .expect(400);
    });

    it("should return 400 for page < 1", async () => {
      await request(app.getHttpServer())
        .get(`/users/${UUID}/tracks?page=0`)
        .expect(400);
    });

    it("should return 400 for non-integer page", async () => {
      await request(app.getHttpServer())
        .get(`/users/${UUID}/tracks?page=abc`)
        .expect(400);
    });
  });
});
