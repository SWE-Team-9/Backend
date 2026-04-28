import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { PlayerController } from "./player.controller";
import { PlayerService } from "./player.service";

const UUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

function buildServiceMock() {
  return {
    getPlaybackSource: jest.fn().mockResolvedValue({
      trackId: UUID,
      streamUrl: "audio/trk.mp3",
      accessState: "PLAYABLE",
      expiresAt: "2026-03-07T18:30:00Z",
    }),
    getPlaybackState: jest.fn().mockResolvedValue({
      trackId: UUID,
      accessState: "PLAYABLE",
      reason: null,
    }),
    registerProgress: jest.fn().mockResolvedValue({
      message: "Playback progress saved successfully",
      trackId: UUID,
      positionSeconds: 97,
    }),
    markPlayed: jest.fn().mockResolvedValue({
      message: "Play event recorded successfully",
      trackId: UUID,
      playCount: 4821,
    }),
    getRecentlyPlayed: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      tracks: [
        {
          trackId: UUID,
          title: "Layali",
          artist: { id: "usr-1", display_name: "Ahmed" },
          lastPlayedAt: "2026-03-07T17:15:00Z",
          lastPositionSeconds: 97,
        },
      ],
    }),
    getHistory: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      history: [
        {
          trackId: UUID,
          title: "Layali",
          playedAt: "2026-03-07T17:15:00Z",
          positionSeconds: 97,
          durationSeconds: 240,
          isCompleted: false,
        },
      ],
    }),
    clearHistory: jest.fn().mockResolvedValue({
      message: "Listening history cleared successfully",
    }),
    getResumePosition: jest.fn().mockResolvedValue({
      trackId: UUID,
      resumePositionSeconds: 97,
    }),
    getSession: jest.fn().mockResolvedValue({
      currentTrack: { trackId: UUID, title: "Layali" },
      positionSeconds: 97,
      isPlaying: true,
      volume: 0.8,
      queue: [],
    }),
    updateSession: jest.fn().mockResolvedValue({
      message: "Player session updated successfully",
    }),
    getTrackPreview: jest.fn().mockResolvedValue({
      trackId: UUID,
      previewUrl: "previews/trk.mp3",
      previewDurationSeconds: 30,
      accessState: "PREVIEW",
    }),
  };
}

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [PlayerController],
    providers: [
      { provide: PlayerService, useValue: serviceMock },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: (ctx: any) => {
            ctx.switchToHttp().getRequest().user = {
              userId: "user-1",
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

describe("PlayerController", () => {
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

  // ── GET /player/tracks/:trackId/source ──────────────────────────────
  describe("GET /player/tracks/:trackId/source", () => {
    it("should return 200 with playback source", async () => {
      const res = await request(app.getHttpServer())
        .get(`/player/tracks/${UUID}/source`)
        .expect(200);

      expect(svc.getPlaybackSource).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body.accessState).toBe("PLAYABLE");
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .get("/player/tracks/bad/source")
        .expect(400);
    });
  });

  // ── GET /player/tracks/:trackId/state ───────────────────────────────
  describe("GET /player/tracks/:trackId/state", () => {
    it("should return 200 with access state", async () => {
      const res = await request(app.getHttpServer())
        .get(`/player/tracks/${UUID}/state`)
        .expect(200);

      expect(svc.getPlaybackState).toHaveBeenCalledWith(UUID);
      expect(res.body.accessState).toBe("PLAYABLE");
    });
  });

  // ── POST /player/tracks/:trackId/progress ──────────────────────────
  describe("POST /player/tracks/:trackId/progress", () => {
    it("should return 200 and save progress", async () => {
      const res = await request(app.getHttpServer())
        .post(`/player/tracks/${UUID}/progress`)
        .send({ positionSeconds: 97, durationSeconds: 240, isCompleted: false })
        .expect(200);

      expect(svc.registerProgress).toHaveBeenCalledWith(
        "user-1",
        UUID,
        97,
        240,
        false,
      );
      expect(res.body.message).toBe("Playback progress saved successfully");
    });

    it("should return 400 when required fields missing", async () => {
      await request(app.getHttpServer())
        .post(`/player/tracks/${UUID}/progress`)
        .send({ positionSeconds: 97 })
        .expect(400);
    });
  });

  // ── POST /player/tracks/:trackId/play ──────────────────────────────
  describe("POST /player/tracks/:trackId/play", () => {
    it("should return 201 and record play event", async () => {
      const res = await request(app.getHttpServer())
        .post(`/player/tracks/${UUID}/play`)
        .expect(201);

      expect(svc.markPlayed).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body.playCount).toBe(4821);
    });

    it("should pass optional playlist context through", async () => {
      await request(app.getHttpServer())
        .post(`/player/tracks/${UUID}/play?playlistId=pl_101`)
        .expect(201);

      expect(svc.markPlayed).toHaveBeenCalledWith("user-1", UUID, "pl_101");
    });
  });

  // ── GET /player/history/recent ─────────────────────────────────────
  describe("GET /player/history/recent", () => {
    it("should return 200 with recently played", async () => {
      const res = await request(app.getHttpServer())
        .get("/player/history/recent")
        .expect(200);

      expect(svc.getRecentlyPlayed).toHaveBeenCalledWith("user-1", 1, 20);
      expect(res.body.tracks).toHaveLength(1);
    });

    it("should forward page and limit", async () => {
      await request(app.getHttpServer())
        .get("/player/history/recent?page=2&limit=10")
        .expect(200);

      expect(svc.getRecentlyPlayed).toHaveBeenCalledWith("user-1", 2, 10);
    });
  });

  // ── GET /player/history ────────────────────────────────────────────
  describe("GET /player/history", () => {
    it("should return 200 with listening history", async () => {
      const res = await request(app.getHttpServer())
        .get("/player/history")
        .expect(200);

      expect(svc.getHistory).toHaveBeenCalledWith("user-1", 1, 20);
      expect(res.body.history).toHaveLength(1);
    });
  });

  // ── DELETE /player/history ─────────────────────────────────────────
  describe("DELETE /player/history", () => {
    it("should return 200 and clear history", async () => {
      const res = await request(app.getHttpServer())
        .delete("/player/history")
        .expect(200);

      expect(svc.clearHistory).toHaveBeenCalledWith("user-1");
      expect(res.body.message).toBe("Listening history cleared successfully");
    });
  });

  // ── GET /player/tracks/:trackId/resume ─────────────────────────────
  describe("GET /player/tracks/:trackId/resume", () => {
    it("should return 200 with resume position", async () => {
      const res = await request(app.getHttpServer())
        .get(`/player/tracks/${UUID}/resume`)
        .expect(200);

      expect(svc.getResumePosition).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body.resumePositionSeconds).toBe(97);
    });
  });

  // ── GET /player/session ────────────────────────────────────────────
  describe("GET /player/session", () => {
    it("should return 200 with player session", async () => {
      const res = await request(app.getHttpServer())
        .get("/player/session")
        .expect(200);

      expect(svc.getSession).toHaveBeenCalledWith("user-1");
      expect(res.body.isPlaying).toBe(true);
    });
  });

  // ── PUT /player/session ────────────────────────────────────────────
  describe("PUT /player/session", () => {
    it("should return 200 and update session", async () => {
      const res = await request(app.getHttpServer())
        .put("/player/session")
        .send({
          currentTrackId: UUID,
          positionSeconds: 97,
          isPlaying: true,
          volume: 0.8,
          queueTrackIds: [UUID],
        })
        .expect(200);

      expect(svc.updateSession).toHaveBeenCalledWith("user-1", {
        currentTrackId: UUID,
        positionSeconds: 97,
        isPlaying: true,
        volume: 0.8,
        queueTrackIds: [UUID],
      });
      expect(res.body.message).toBe("Player session updated successfully");
    });

    it("should accept partial updates", async () => {
      await request(app.getHttpServer())
        .put("/player/session")
        .send({ isPlaying: false })
        .expect(200);

      expect(svc.updateSession).toHaveBeenCalledWith("user-1", {
        isPlaying: false,
      });
    });
  });

  // ── GET /player/tracks/:trackId/preview ────────────────────────────
  describe("GET /player/tracks/:trackId/preview", () => {
    it("should return 200 with preview URL", async () => {
      const res = await request(app.getHttpServer())
        .get(`/player/tracks/${UUID}/preview`)
        .expect(200);

      expect(svc.getTrackPreview).toHaveBeenCalledWith(UUID);
      expect(res.body.accessState).toBe("PREVIEW");
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .get("/player/tracks/bad-id/preview")
        .expect(400);
    });
  });
});
