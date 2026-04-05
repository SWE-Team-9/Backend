import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";

const UUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

function buildServiceMock() {
  return {
    blockUser: jest.fn().mockResolvedValue({
      message: "User blocked successfully",
      blockedUserId: UUID,
    }),
    unblockUser: jest.fn().mockResolvedValue({
      message: "User unblocked successfully",
      blockedUserId: UUID,
    }),
    getBlockedUsers: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      blockedUsers: [
        {
          id: UUID,
          display_name: "Blocked User",
          handle: "blocked-user",
          avatar_url: null,
          blockedAt: "2026-03-07T11:00:00.000Z",
        },
      ],
    }),
  };
}

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [SocialController],
    providers: [
      { provide: SocialService, useValue: serviceMock },
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

describe("SocialController", () => {
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

  // ── POST /social/block/:userId ──────────────────────────────────────
  describe("POST /social/block/:userId", () => {
    it("should return 201 and call blockUser", async () => {
      const res = await request(app.getHttpServer())
        .post(`/social/block/${UUID}`)
        .expect(201);

      expect(svc.blockUser).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body.message).toBe("User blocked successfully");
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .post("/social/block/not-a-uuid")
        .expect(400);
    });
  });

  // ── DELETE /social/block/:userId ────────────────────────────────────
  describe("DELETE /social/block/:userId", () => {
    it("should return 200 and call unblockUser", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/social/block/${UUID}`)
        .expect(200);

      expect(svc.unblockUser).toHaveBeenCalledWith("user-1", UUID);
      expect(res.body.message).toBe("User unblocked successfully");
    });

    it("should return 400 for invalid UUID", async () => {
      await request(app.getHttpServer())
        .delete("/social/block/not-a-uuid")
        .expect(400);
    });
  });

  // ── GET /social/blocked-users ───────────────────────────────────────
  describe("GET /social/blocked-users", () => {
    it("should return 200 with blocked users list", async () => {
      const res = await request(app.getHttpServer())
        .get("/social/blocked-users")
        .expect(200);

      expect(svc.getBlockedUsers).toHaveBeenCalledWith("user-1", 1, 20);
      expect(res.body).toHaveProperty("blockedUsers");
      expect(res.body.blockedUsers).toHaveLength(1);
    });

    it("should forward custom page and limit", async () => {
      await request(app.getHttpServer())
        .get("/social/blocked-users?page=2&limit=10")
        .expect(200);

      expect(svc.getBlockedUsers).toHaveBeenCalledWith("user-1", 2, 10);
    });
  });
});
