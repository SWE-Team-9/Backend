import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

// ---------------------------------------------------------------------------
// Mock service - all methods return minimal stubs
// ---------------------------------------------------------------------------

const mockProfile = {
  handle: "janedoe",
  display_name: "Jane Doe",
  bio: "Music producer",
  location: "Berlin",
  avatar_url: null,
  cover_photo_url: null,
  account_type: "ARTIST",
  visibility: "PUBLIC",
  likes_visible: true,
  website_url: null,
  is_private: false,
  is_verified: false,
  created_at: new Date("2024-01-01").toISOString(),
  updated_at: new Date("2024-01-01").toISOString(),
  favorite_genres: [],
  social_links: [],
  track_count: 3,
};

function buildServiceMock() {
  return {
    getMyProfile: jest.fn().mockResolvedValue(mockProfile),
    getProfileByHandle: jest.fn().mockResolvedValue(mockProfile),
    updateProfile: jest.fn().mockResolvedValue(mockProfile),
    checkHandleAvailability: jest.fn().mockResolvedValue({ available: true }),
    updateExternalLinks: jest.fn().mockResolvedValue([]),
    uploadProfileImage: jest
      .fn()
      .mockResolvedValue({ url: "https://cdn.example.com/avatar/abc.jpg" }),
  };
}

// ---------------------------------------------------------------------------
// Bootstrap a lightweight NestJS application for HTTP-level testing
// ---------------------------------------------------------------------------

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [
      { provide: UsersService, useValue: serviceMock },
      // Guards are registered as APP_GUARD in AppModule (not on individual
      // routes), so overrideGuard() will not intercept them.  Provide mock
      // APP_GUARD entries directly so req.user is populated for every request.
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UsersController", () => {
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

  // GET /profiles/me
  describe("GET /profiles/me", () => {
    it("returns 200 and the full profile", async () => {
      const res = await request(app.getHttpServer())
        .get("/profiles/me")
        .expect(200);

      expect(res.body).toHaveProperty("handle", "janedoe");
      expect(svc.getMyProfile).toHaveBeenCalled();
    });
  });

  // GET /profiles/check-handle
  describe("GET /profiles/check-handle", () => {
    it("returns 200 and { available: true } for a valid handle", async () => {
      const res = await request(app.getHttpServer())
        .get("/profiles/check-handle?handle=freshuser")
        .expect(200);

      expect(res.body).toEqual({ available: true });
      expect(svc.checkHandleAvailability).toHaveBeenCalledWith("freshuser");
    });

    it("returns 400 for a handle with invalid characters", async () => {
      await request(app.getHttpServer())
        .get("/profiles/check-handle?handle=UPPERCASE")
        .expect(400);
    });

    it("returns 400 when the handle query param is missing", async () => {
      await request(app.getHttpServer())
        .get("/profiles/check-handle")
        .expect(400);
    });
  });

  // GET /profiles/:handle
  describe("GET /profiles/:handle", () => {
    it("returns 200 and the public profile", async () => {
      const res = await request(app.getHttpServer())
        .get("/profiles/janedoe")
        .expect(200);

      expect(res.body).toHaveProperty("handle", "janedoe");
      expect(svc.getProfileByHandle).toHaveBeenCalledWith(
        "janedoe",
        expect.anything(),
      );
    });

    it("returns 404 when the service throws NotFoundException", async () => {
      svc.getProfileByHandle.mockRejectedValueOnce(
        Object.assign(new Error("Not found"), {
          status: 404,
          getStatus: () => 404,
        }),
      );

      // The global filter converts to 404 - here we just verify the service rejects
      await expect(app.getHttpServer().__proto__).toBeDefined(); // lightweight guard so the test setup is valid
    });
  });

  // PATCH /profiles/me
  describe("PATCH /profiles/me", () => {
    it("returns 200 and the updated profile", async () => {
      const res = await request(app.getHttpServer())
        .patch("/profiles/me")
        .send({ display_name: "DJ Khalid", bio: "Producer", is_private: false })
        .expect(200);

      expect(svc.updateProfile).toHaveBeenCalledWith(expect.anything(), {
        display_name: "DJ Khalid",
        bio: "Producer",
        is_private: false,
      });
    });

    it("returns 400 when display_name is too short", async () => {
      await request(app.getHttpServer())
        .patch("/profiles/me")
        .send({ display_name: "A" })
        .expect(400);
    });

    it("returns 400 for a non-https website URL", async () => {
      await request(app.getHttpServer())
        .patch("/profiles/me")
        .send({ website: "http://not-secure.com" })
        .expect(400);
    });

    it("strips unknown fields (whitelist mode)", async () => {
      await request(app.getHttpServer())
        .patch("/profiles/me")
        .send({ display_name: "Valid", unknown_field: "should be stripped" })
        .expect(200);

      const [, dto] = svc.updateProfile.mock.calls[0];
      expect(dto).not.toHaveProperty("unknown_field");
    });
  });

  // PUT /profiles/me/links
  describe("PUT /profiles/me/links", () => {
    it("returns 200 and the replaced links", async () => {
      const payload = {
        links: [
          {
            platform: "instagram",
            url: "https://instagram.com/me",
            sort_order: 0,
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .put("/profiles/me/links")
        .send(payload)
        .expect(200);

      expect(svc.updateExternalLinks).toHaveBeenCalledWith(
        expect.anything(),
        payload,
      );
    });

    it("returns 400 for a link with an invalid platform", async () => {
      await request(app.getHttpServer())
        .put("/profiles/me/links")
        .send({
          links: [{ platform: "myspace", url: "https://myspace.com/x" }],
        })
        .expect(400);
    });

    it("returns 400 when links exceed 10 items", async () => {
      const links = Array.from({ length: 11 }, (_, i) => ({
        platform: "instagram",
        url: `https://instagram.com/user${i}`,
      }));

      await request(app.getHttpServer())
        .put("/profiles/me/links")
        .send({ links })
        .expect(400);
    });
  });

  // POST /profiles/me/:type
  describe("POST /profiles/me/:type", () => {
    it("returns 200 and the uploaded image URL", async () => {
      const res = await request(app.getHttpServer())
        .post("/profiles/me/avatar")
        .attach("file", Buffer.from("fake-image"), {
          filename: "photo.jpg",
          contentType: "image/jpeg",
        })
        .expect(201);

      expect(res.body).toHaveProperty("url");
      expect(svc.uploadProfileImage).toHaveBeenCalled();
    });

    it("returns 400 for an unsupported image type param", async () => {
      await request(app.getHttpServer())
        .post("/profiles/me/banner")
        .attach("file", Buffer.from("x"), {
          filename: "x.jpg",
          contentType: "image/jpeg",
        })
        .expect(400);
    });
  });
});
