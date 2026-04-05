import { Test, TestingModule } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { INestApplication, ValidationPipe } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";

const TARGET_USER_ID = "550e8400-e29b-41d4-a716-446655440000";

function buildServiceMock() {
  return {
    followUser: jest.fn().mockResolvedValue({
      message: "User followed successfully",
      targetUserId: TARGET_USER_ID,
      followersCount: 1,
      isFollowing: true,
    }),
    unfollowUser: jest.fn().mockResolvedValue({
      message: "User unfollowed successfully",
      targetUserId: TARGET_USER_ID,
      isFollowing: false,
    }),
    getFollowers: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      followers: [],
    }),
    getFollowing: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      following: [],
    }),
    getSuggestions: jest.fn().mockResolvedValue({
      suggestions: [],
    }),
    blockUser: jest.fn().mockResolvedValue({
      message: "User blocked successfully",
      blockedUserId: TARGET_USER_ID,
    }),
    unblockUser: jest.fn().mockResolvedValue({
      message: "User unblocked successfully",
      blockedUserId: TARGET_USER_ID,
    }),
    getBlockedUsers: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 0,
      blockedUsers: [],
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
              userId: "usr_requester",
              role: "USER",
            };
            return true;
          },
        },
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
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

  describe("POST /social/follow/:userId", () => {
    it("returns 201 and delegates to SocialService.followUser", async () => {
      const res = await request(app.getHttpServer())
        .post(`/social/follow/${TARGET_USER_ID}`)
        .expect(201);

      expect(res.body).toHaveProperty("isFollowing", true);
      expect(svc.followUser).toHaveBeenCalledWith("usr_requester", TARGET_USER_ID);
    });

    it("returns 400 for invalid userId format", async () => {
      await request(app.getHttpServer()).post("/social/follow/not-valid").expect(400);
      expect(svc.followUser).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /social/follow/:userId", () => {
    it("returns 200 and delegates to SocialService.unfollowUser", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/social/follow/${TARGET_USER_ID}`)
        .expect(200);

      expect(res.body).toHaveProperty("isFollowing", false);
      expect(svc.unfollowUser).toHaveBeenCalledWith("usr_requester", TARGET_USER_ID);
    });
  });

  describe("GET /social/:userId/followers", () => {
    it("returns 200 and delegates params + query", async () => {
      const res = await request(app.getHttpServer())
        .get(`/social/${TARGET_USER_ID}/followers?page=1&limit=20`)
        .expect(200);

      expect(res.body).toHaveProperty("followers");
      expect(svc.getFollowers).toHaveBeenCalledWith(
        TARGET_USER_ID,
        { page: 1, limit: 20 },
      );
    });

    it("returns 400 for invalid pagination", async () => {
      await request(app.getHttpServer())
        .get(`/social/${TARGET_USER_ID}/followers?page=0&limit=20`)
        .expect(400);
      expect(svc.getFollowers).not.toHaveBeenCalled();
    });
  });

  describe("GET /social/:userId/following", () => {
    it("returns 200 and delegates params + query", async () => {
      const res = await request(app.getHttpServer())
        .get(`/social/${TARGET_USER_ID}/following?page=2&limit=10`)
        .expect(200);

      expect(res.body).toHaveProperty("following");
      expect(svc.getFollowing).toHaveBeenCalledWith(
        TARGET_USER_ID,
        { page: 2, limit: 10 },
      );
    });
  });

  describe("GET /social/suggestions", () => {
    it("returns 200 and delegates query", async () => {
      const res = await request(app.getHttpServer())
        .get("/social/suggestions?limit=10")
        .expect(200);

      expect(res.body).toHaveProperty("suggestions");
      expect(svc.getSuggestions).toHaveBeenCalledWith("usr_requester", { limit: 10 });
    });

    it("returns 400 when limit exceeds maximum", async () => {
      await request(app.getHttpServer())
        .get("/social/suggestions?limit=999")
        .expect(400);
      expect(svc.getSuggestions).not.toHaveBeenCalled();
    });
  });

  describe("POST /social/block/:userId", () => {
    it("returns 201 and delegates to SocialService.blockUser", async () => {
      const res = await request(app.getHttpServer())
        .post(`/social/block/${TARGET_USER_ID}`)
        .expect(201);

      expect(res.body).toHaveProperty("blockedUserId", TARGET_USER_ID);
      expect(svc.blockUser).toHaveBeenCalledWith("usr_requester", TARGET_USER_ID);
    });
  });

  describe("DELETE /social/block/:userId", () => {
    it("returns 200 and delegates to SocialService.unblockUser", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/social/block/${TARGET_USER_ID}`)
        .expect(200);

      expect(res.body).toHaveProperty("blockedUserId", TARGET_USER_ID);
      expect(svc.unblockUser).toHaveBeenCalledWith("usr_requester", TARGET_USER_ID);
    });
  });

  describe("GET /social/blocked-users", () => {
    it("returns 200 and delegates pagination query", async () => {
      const res = await request(app.getHttpServer())
        .get("/social/blocked-users?page=1&limit=20")
        .expect(200);

      expect(res.body).toHaveProperty("blockedUsers");
      expect(svc.getBlockedUsers).toHaveBeenCalledWith("usr_requester", {
        page: 1,
        limit: 20,
      });
    });

    it("returns 400 for invalid limit", async () => {
      await request(app.getHttpServer())
        .get("/social/blocked-users?page=1&limit=0")
        .expect(400);
      expect(svc.getBlockedUsers).not.toHaveBeenCalled();
    });
  });
});
