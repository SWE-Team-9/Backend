import { BadRequestException, INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { PlaylistsController } from "./playlists.controller";
import { PlaylistsService } from "./playlists.service";

function buildServiceMock() {
  return {
    create: jest.fn().mockResolvedValue({
      playlistId: "pl_101",
      title: "Late Night Drive",
      visibility: "PUBLIC",
      secretToken: null,
    }),
    getTopPlaylists: jest.fn().mockResolvedValue({
      genres: [
        {
          genre: "Electronic",
          playlists: [
            {
              playlistId: "pl_101",
              title: "Late Night Drive",
              visibility: "PUBLIC",
              likesCount: 48,
            },
          ],
        },
      ],
    }),
    getMyPlaylists: jest.fn().mockResolvedValue({
      page: 1,
      limit: 20,
      total: 1,
      playlists: [],
    }),
    resolveSecret: jest.fn().mockResolvedValue({
      playlistId: "pl_101",
      title: "Late Night Drive",
      visibility: "PRIVATE",
      message: "Access granted via secret token",
    }),
    getRecentPlaylists: jest.fn().mockResolvedValue({ playlists: [] }),
    getEditDetails: jest.fn().mockResolvedValue({
      playlistId: "pl_101",
      title: "Late Night Drive",
      description: "chill tracks",
      visibility: "PUBLIC",
      slug: "late-night-drive",
      coverImageUrl: null,
      type: "PLAYLIST",
      releaseDate: null,
      genreId: null,
      tags: [],
    }),
    uploadCover: jest.fn().mockResolvedValue({
      message: "Playlist cover uploaded successfully",
      coverImageUrl: "https://cdn.example.com/playlists/pl_101/cover.jpg",
    }),
    likePlaylist: jest.fn().mockResolvedValue({
      message: "Playlist liked successfully",
    }),
    unlikePlaylist: jest.fn().mockResolvedValue({
      message: "Playlist unliked successfully",
    }),
    getEmbedCode: jest.fn().mockResolvedValue({
      playlistId: "pl_101",
      embedCode: '<iframe src="https://example.com/embed/playlists/pl_101"></iframe>',
    }),
    addTrack: jest.fn().mockResolvedValue({
      message: "Track added to playlist successfully",
      playlistId: "pl_101",
      trackId: "trk_123",
    }),
    removeTrack: jest.fn().mockResolvedValue({
      message: "Track removed from playlist successfully",
    }),
    reorderTracks: jest.fn().mockResolvedValue({
      message: "Playlist reordered successfully",
    }),
    getDetails: jest.fn().mockResolvedValue({
      playlistId: "pl_101",
      title: "Late Night Drive",
      description: "chill tracks",
      visibility: "PUBLIC",
      owner: { id: "usr_1", display_name: "Ahmed Hassan" },
      tracks: [{ trackId: "trk_123", title: "Layali" }],
    }),
    update: jest.fn().mockResolvedValue({ message: "Playlist updated successfully" }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

async function buildApp(
  serviceMock: ReturnType<typeof buildServiceMock>,
): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [PlaylistsController],
    providers: [
      { provide: PlaylistsService, useValue: serviceMock },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: (ctx: any) => {
            ctx.switchToHttp().getRequest().user = {
              userId: "usr_1",
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

describe("PlaylistsController", () => {
  let app: INestApplication;
  let service: ReturnType<typeof buildServiceMock>;

  beforeEach(async () => {
    service = buildServiceMock();
    app = await buildApp(service);
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe("POST /playlists", () => {
    it("returns 201 and creates a playlist", async () => {
      const payload = {
        title: "Late Night Drive",
        visibility: "PUBLIC",
        trackIds: ["trk_123", "trk_456"],
      };

      const res = await request(app.getHttpServer()).post("/playlists").send(payload).expect(201);

      expect(res.body).toHaveProperty("playlistId", "pl_101");
      expect(service.create).toHaveBeenCalledWith("usr_1", payload);
    });

    it("returns 400 when required fields are missing", async () => {
      await request(app.getHttpServer())
        .post("/playlists")
        .send({ title: "Only title" })
        .expect(400);
    });

    it("returns 400 when trackIds is empty", async () => {
      service.create.mockRejectedValueOnce(
        new BadRequestException("Playlist must start with at least one track."),
      );

      await request(app.getHttpServer())
        .post("/playlists")
        .send({ title: "Late Night Drive", visibility: "PUBLIC", trackIds: [] })
        .expect(400);
    });
  });

  describe("GET /playlists/me", () => {
    it("returns paginated playlists", async () => {
      await request(app.getHttpServer()).get("/playlists/me?page=2&limit=10").expect(200);

      expect(service.getMyPlaylists).toHaveBeenCalledWith("usr_1", {
        page: 2,
        limit: 10,
      });
    });

    it("returns 400 for invalid pagination values", async () => {
      await request(app.getHttpServer()).get("/playlists/me?page=0&limit=500").expect(400);
    });
  });

  describe("GET /playlists/top", () => {
    it("returns top playlists", async () => {
      const res = await request(app.getHttpServer()).get("/playlists/top").expect(200);

      expect(service.getTopPlaylists).toHaveBeenCalled();
      expect(res.body.genres).toHaveLength(1);
      expect(res.body.genres[0]).toHaveProperty("genre", "Electronic");
    });
  });

  describe("GET /playlists/secret/:secretToken", () => {
    it("resolves secret playlist", async () => {
      await request(app.getHttpServer()).get("/playlists/secret/sec_abc").expect(200);

      expect(service.resolveSecret).toHaveBeenCalledWith("sec_abc");
    });
  });

  describe("GET /playlists/recent", () => {
    it("returns recently played playlists", async () => {
      await request(app.getHttpServer()).get("/playlists/recent?limit=5").expect(200);

      expect(service.getRecentPlaylists).toHaveBeenCalledWith("usr_1", 5);
    });
  });

  describe("GET /playlists/:playlistId/edit", () => {
    it("returns owner edit payload", async () => {
      const res = await request(app.getHttpServer()).get("/playlists/pl_101/edit").expect(200);

      expect(service.getEditDetails).toHaveBeenCalledWith("usr_1", "pl_101");
      expect(res.body).toHaveProperty("slug", "late-night-drive");
    });
  });

  describe("POST /playlists/:playlistId/cover", () => {
    it("uploads playlist cover image", async () => {
      const res = await request(app.getHttpServer())
        .post("/playlists/pl_101/cover")
        .attach("file", Buffer.from([0xff, 0xd8, 0xff]), {
          filename: "cover.jpg",
          contentType: "image/jpeg",
        })
        .expect(200);

      expect(service.uploadCover).toHaveBeenCalled();
      expect(res.body).toHaveProperty("message", "Playlist cover uploaded successfully");
    });
  });

  describe("POST /playlists/:playlistId/like", () => {
    it("likes playlist", async () => {
      await request(app.getHttpServer()).post("/playlists/pl_101/like").expect(201);

      expect(service.likePlaylist).toHaveBeenCalledWith("usr_1", "pl_101");
    });
  });

  describe("DELETE /playlists/:playlistId/like", () => {
    it("unlikes playlist", async () => {
      await request(app.getHttpServer()).delete("/playlists/pl_101/like").expect(200);

      expect(service.unlikePlaylist).toHaveBeenCalledWith("usr_1", "pl_101");
    });
  });

  describe("GET /playlists/:playlistId/embed", () => {
    it("returns embed code", async () => {
      await request(app.getHttpServer()).get("/playlists/pl_101/embed").expect(200);

      expect(service.getEmbedCode).toHaveBeenCalledWith("usr_1", "pl_101", {});
    });
  });

  describe("POST /playlists/:playlistId/tracks", () => {
    it("adds track to playlist", async () => {
      await request(app.getHttpServer())
        .post("/playlists/pl_101/tracks")
        .send({ trackId: "trk_123" })
        .expect(201);

      expect(service.addTrack).toHaveBeenCalledWith("usr_1", "pl_101", {
        trackId: "trk_123",
      });
    });

    it("returns 400 when body is invalid", async () => {
      await request(app.getHttpServer())
        .post("/playlists/pl_101/tracks")
        .send({ trackId: "" })
        .expect(400);
    });
  });

  describe("DELETE /playlists/:playlistId/tracks/:trackId", () => {
    it("removes track from playlist", async () => {
      await request(app.getHttpServer()).delete("/playlists/pl_101/tracks/trk_123").expect(200);

      expect(service.removeTrack).toHaveBeenCalledWith("usr_1", "pl_101", "trk_123");
    });
  });

  describe("PATCH /playlists/:playlistId/reorder", () => {
    it("reorders tracks", async () => {
      const payload = { orderedTrackIds: ["trk_3", "trk_8"] };

      await request(app.getHttpServer())
        .patch("/playlists/pl_101/reorder")
        .send(payload)
        .expect(200);

      expect(service.reorderTracks).toHaveBeenCalledWith("usr_1", "pl_101", payload);
    });

    it("returns 400 for invalid reorder body", async () => {
      await request(app.getHttpServer())
        .patch("/playlists/pl_101/reorder")
        .send({ orderedTrackIds: ["trk_3", ""] })
        .expect(400);
    });
  });

  describe("GET /playlists/:playlistId", () => {
    it("returns playlist details", async () => {
      await request(app.getHttpServer()).get("/playlists/pl_101").expect(200);
      expect(service.getDetails).toHaveBeenCalledWith("pl_101", "usr_1", {});
    });
  });

  describe("PATCH /playlists/:playlistId", () => {
    it("updates playlist", async () => {
      await request(app.getHttpServer())
        .patch("/playlists/pl_101")
        .send({ title: "Vol 2" })
        .expect(200);

      expect(service.update).toHaveBeenCalledWith("usr_1", "pl_101", {
        title: "Vol 2",
      });
    });

    it("returns 400 for invalid visibility", async () => {
      await request(app.getHttpServer())
        .patch("/playlists/pl_101")
        .send({ visibility: "FRIENDS_ONLY" })
        .expect(400);
    });
  });

  describe("DELETE /playlists/:playlistId", () => {
    it("returns 204 and delegates removal", async () => {
      await request(app.getHttpServer()).delete("/playlists/pl_101").expect(204);
      expect(service.remove).toHaveBeenCalledWith("usr_1", "pl_101");
    });
  });
});
// "FRIENDS_ONLY" })
//         .expect(400);
//     });
//   });

//   describe("DELETE /playlists/:playlistId", () => {
//     it("returns 204 and delegates removal", async () => {
//       await request(app.getHttpServer()).delete("/playlists/pl_101").expect(204);
//       expect(service.remove).toHaveBeenCalledWith("usr_1", "pl_101");
//     });
//   });
// });
