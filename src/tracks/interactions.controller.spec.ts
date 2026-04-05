import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { InteractionsController } from "./interactions.controller";
import { InteractionsService } from "./interactions.service";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const UUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

const mockTrackSummary = {
  id: UUID,
  title: "Test Track",
  slug: "test-track",
  coverArtUrl: null,
  publishedAt: "2026-04-01T12:00:00.000Z",
  likesCount: 3,
  repostsCount: 1,
};

const mockPagination = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock service
// ─────────────────────────────────────────────────────────────────────────────

function buildServiceMock() {
  return {
    likeTrack: jest.fn().mockResolvedValue(undefined),
    unlikeTrack: jest.fn().mockResolvedValue(undefined),
    repostTrack: jest.fn().mockResolvedValue(undefined),
    unrepostTrack: jest.fn().mockResolvedValue(undefined),
    getMyLikedTracks: jest.fn().mockResolvedValue({
      items: [
        {
          interactedAt: "2026-04-04T12:00:00.000Z",
          track: mockTrackSummary,
        },
      ],
      pagination: mockPagination,
    }),
    getMyRepostedTracks: jest.fn().mockResolvedValue({
      items: [],
      pagination: { ...mockPagination, total: 0, totalPages: 0 },
    }),
    getTrackLikers: jest.fn().mockResolvedValue({
      track: mockTrackSummary,
      items: [
        {
          interactedAt: "2026-04-04T12:00:00.000Z",
          user: { userId: "u-1", displayName: "Fan", avatarUrl: null },
        },
      ],
      pagination: mockPagination,
    }),
    getTrackReposters: jest.fn().mockResolvedValue({
      track: mockTrackSummary,
      items: [],
      pagination: { ...mockPagination, total: 0, totalPages: 0 },
    }),
    createComment: jest.fn().mockResolvedValue({
      id: "comment-uuid",
      content: "Great drop!",
      timestampAt: 42,
      user: { userId: "user-1", displayName: "Demo", avatarUrl: null },
    }),
    deleteComment: jest.fn().mockResolvedValue({
      message: "Comment deleted successfully",
    }),
    getTrackComments: jest.fn().mockResolvedValue([]),
    getInteractionStatus: jest
      .fn()
      .mockResolvedValue({ isLiked: true, isReposted: false }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [InteractionsController],
    providers: [
      { provide: InteractionsService, useValue: serviceMock },
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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("InteractionsController", () => {
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

  // ── POST /interactions/tracks/:id/like ─────────────────────────────────
  describe("POST /interactions/tracks/:id/like", () => {
    it("should return 204 and call likeTrack", async () => {
      await request(app.getHttpServer())
        .post(`/interactions/tracks/${UUID}/like`)
        .expect(204);

      expect(svc.likeTrack).toHaveBeenCalledWith("user-1", UUID);
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .post("/interactions/tracks/not-a-uuid/like")
        .expect(400);
    });
  });

  // ── DELETE /interactions/tracks/:id/like ────────────────────────────────
  describe("DELETE /interactions/tracks/:id/like", () => {
    it("should return 204 and call unlikeTrack", async () => {
      await request(app.getHttpServer())
        .delete(`/interactions/tracks/${UUID}/like`)
        .expect(204);

      expect(svc.unlikeTrack).toHaveBeenCalledWith("user-1", UUID);
    });
  });

  // ── POST /interactions/tracks/:id/repost ───────────────────────────────
  describe("POST /interactions/tracks/:id/repost", () => {
    it("should return 204 and call repostTrack", async () => {
      await request(app.getHttpServer())
        .post(`/interactions/tracks/${UUID}/repost`)
        .expect(204);

      expect(svc.repostTrack).toHaveBeenCalledWith("user-1", UUID);
    });
  });

  // ── DELETE /interactions/tracks/:id/repost ─────────────────────────────
  describe("DELETE /interactions/tracks/:id/repost", () => {
    it("should return 204 and call unrepostTrack", async () => {
      await request(app.getHttpServer())
        .delete(`/interactions/tracks/${UUID}/repost`)
        .expect(204);

      expect(svc.unrepostTrack).toHaveBeenCalledWith("user-1", UUID);
    });
  });

  // ── GET /interactions/me/likes ─────────────────────────────────────────
  describe("GET /interactions/me/likes", () => {
    it("should return 200 with liked tracks and pagination", async () => {
      const res = await request(app.getHttpServer())
        .get("/interactions/me/likes")
        .expect(200);

      expect(svc.getMyLikedTracks).toHaveBeenCalledWith("user-1", 1, 20);
      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("pagination");
    });

    it("should forward custom page and limit", async () => {
      await request(app.getHttpServer())
        .get("/interactions/me/likes?page=3&limit=10")
        .expect(200);

      expect(svc.getMyLikedTracks).toHaveBeenCalledWith("user-1", 3, 10);
    });
  });

  // ── GET /interactions/me/reposts ───────────────────────────────────────
  describe("GET /interactions/me/reposts", () => {
    it("should return 200 with reposted tracks", async () => {
      await request(app.getHttpServer())
        .get("/interactions/me/reposts")
        .expect(200);

      expect(svc.getMyRepostedTracks).toHaveBeenCalledWith("user-1", 1, 20);
    });
  });

  // ── GET /interactions/tracks/:id/likers ────────────────────────────────
  describe("GET /interactions/tracks/:id/likers", () => {
    it("should return 200 with likers list", async () => {
      const res = await request(app.getHttpServer())
        .get(`/interactions/tracks/${UUID}/likers`)
        .expect(200);

      expect(svc.getTrackLikers).toHaveBeenCalledWith(UUID, 1, 20);
      expect(res.body).toHaveProperty("track");
      expect(res.body).toHaveProperty("items");
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .get("/interactions/tracks/bad-id/likers")
        .expect(400);
    });
  });

  // ── GET /interactions/tracks/:id/reposters ─────────────────────────────
  describe("GET /interactions/tracks/:id/reposters", () => {
    it("should return 200 with reposters list", async () => {
      await request(app.getHttpServer())
        .get(`/interactions/tracks/${UUID}/reposters`)
        .expect(200);

      expect(svc.getTrackReposters).toHaveBeenCalledWith(UUID, 1, 20);
    });
  });

  // ── POST /interactions/tracks/:id/comments ─────────────────────────────
  describe("POST /interactions/tracks/:id/comments", () => {
    it("should return 201 and call createComment", async () => {
      const res = await request(app.getHttpServer())
        .post(`/interactions/tracks/${UUID}/comments`)
        .send({ content: "Great drop!", timestampAt: 42 })
        .expect(201);

      expect(svc.createComment).toHaveBeenCalledWith(
        "user-1",
        UUID,
        "Great drop!",
        42,
      );
      expect(res.body).toHaveProperty("id", "comment-uuid");
    });

    it("should return 400 when content is missing", async () => {
      await request(app.getHttpServer())
        .post(`/interactions/tracks/${UUID}/comments`)
        .send({ timestampAt: 10 })
        .expect(400);
    });

    it("should return 400 when timestampAt is missing", async () => {
      await request(app.getHttpServer())
        .post(`/interactions/tracks/${UUID}/comments`)
        .send({ content: "Hello" })
        .expect(400);
    });

    it("should return 400 when timestampAt is negative", async () => {
      await request(app.getHttpServer())
        .post(`/interactions/tracks/${UUID}/comments`)
        .send({ content: "Hello", timestampAt: -1 })
        .expect(400);
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .post("/interactions/tracks/bad-id/comments")
        .send({ content: "Hello", timestampAt: 0 })
        .expect(400);
    });
  });

  // ── GET /interactions/tracks/:id/comments ──────────────────────────────
  describe("GET /interactions/tracks/:id/comments", () => {
    it("should return 200 with comments array", async () => {
      const res = await request(app.getHttpServer())
        .get(`/interactions/tracks/${UUID}/comments`)
        .expect(200);

      expect(svc.getTrackComments).toHaveBeenCalledWith(UUID);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── DELETE /interactions/comments/:commentId ────────────────────────────
  describe("DELETE /interactions/comments/:commentId", () => {
    it("should return 200 and call deleteComment", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/interactions/comments/${UUID}`)
        .expect(200);

      expect(svc.deleteComment).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body.message).toBe("Comment deleted successfully");
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .delete("/interactions/comments/not-a-uuid")
        .expect(400);
    });
  });

  // ── GET /interactions/tracks/:id/status ────────────────────────────────
  describe("GET /interactions/tracks/:id/status", () => {
    it("should return 200 with isLiked and isReposted", async () => {
      const res = await request(app.getHttpServer())
        .get(`/interactions/tracks/${UUID}/status`)
        .expect(200);

      expect(svc.getInteractionStatus).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body).toEqual({ isLiked: true, isReposted: false });
    });
  });
});
