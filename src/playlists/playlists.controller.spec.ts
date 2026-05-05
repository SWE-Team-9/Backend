import { BadRequestException, INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { PlaylistsController } from "./playlists.controller";
import { PlaylistsService } from "./playlists.service";

const playlistId = "b521ecbb-85e1-4083-9fb5-ea91114abc99";
const trackId = "95ea95c7-9277-46a8-8e44-7e31c3d11c58";
const artistId = "a4b9c2d6-0714-4e88-96c0-599b1f82c413";

function buildServiceMock() {
  return {
    create: jest.fn().mockResolvedValue({
      playlistId,
      title: "Late Night Drive",
      visibility: "PUBLIC",
      secretToken: null,
      releaseDate: null,
      coverImageUrl: null,
      tracksCount: 2,
      likesCount: 0,
      isLiked: false,
      genre: null,
      owner: {
        id: artistId,
        displayName: "Ahmed Hassan",
      },
    }),
    getTopPlaylists: jest.fn().mockResolvedValue({
      genres: [
        {
          genre: "electronic",
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
      playlistId,
      title: "Late Night Drive",
      description: "chill tracks",
      visibility: "SECRET",
      coverImageUrl: null,
      likesCount: 0,
      isLiked: false,
      releaseDate: null,
      genre: "electronic",
      tracksCount: 0,
      owner: { id: artistId, displayName: "Ahmed Hassan" },
      tracks: [],
    }),
    getRecentPlaylists: jest.fn().mockResolvedValue({ playlists: [] }),
    getEditDetails: jest.fn().mockResolvedValue({
      playlistId,
      title: "Late Night Drive",
      description: "chill tracks",
      visibility: "PUBLIC",
      slug: "late-night-drive",
      coverImageUrl: null,
      type: "PLAYLIST",
      releaseDate: null,
      genre: "electronic",
      tags: [],
    }),
    uploadCover: jest.fn().mockResolvedValue({
      message: "Playlist cover uploaded successfully",
      coverImageUrl: "https://cdn.example.com/playlists/b521ecbb-85e1-4083-9fb5-ea91114abc99/cover.jpg",
    }),
    likePlaylist: jest.fn().mockResolvedValue({
      message: "Playlist liked successfully",
    }),
    unlikePlaylist: jest.fn().mockResolvedValue({
      message: "Playlist unliked successfully",
    }),
    getEmbedCode: jest.fn().mockResolvedValue({
      playlistId,
      embedCode: `<iframe src="https://dev.iqa3.tech/embed/playlists/${playlistId}"></iframe>`,
    }),
    addTrack: jest.fn().mockResolvedValue({
      message: "Track added to playlist successfully",
      playlistId,
      trackId,
      title: "Layali",
      coverArtUrl: "https://example.com/cover.jpg",
      artist: {
        id: artistId,
        name: "Artist Name",
        handle: "artist-name",
      },
    }),
    removeTrack: jest.fn().mockResolvedValue({
      message: "Track removed from playlist successfully",
    }),
    reorderTracks: jest.fn().mockResolvedValue({
      message: "Playlist reordered successfully",
    }),
    getDetails: jest.fn().mockResolvedValue({
      playlistId,
      title: "Late Night Drive",
      description: "chill tracks",
      visibility: "PUBLIC",
      genre: "electronic",
      releaseDate: null,
      owner: { id: artistId, displayName: "Ahmed Hassan" },
      tracks: [{ trackId, title: "Layali", coverArtUrl: null, durationMs: 0, likesCount: 0, repostsCount: 0, artist: { id: artistId, name: "Ahmed Hassan", handle: "test-user" } }],
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
        trackIds: [
          "95ea95c7-9277-46a8-8e44-7e31c3d11c58",
          "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
        ],
      };

      const res = await request(app.getHttpServer()).post("/playlists").send(payload).expect(201);

      expect(res.body).toHaveProperty("playlistId", playlistId);
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
      expect(res.body.genres[0]).toHaveProperty("genre", "electronic");
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
      const res = await request(app.getHttpServer()).get(`/playlists/${playlistId}/edit`).expect(200);

      expect(service.getEditDetails).toHaveBeenCalledWith("usr_1", playlistId);
      expect(res.body).toHaveProperty("slug", "late-night-drive");
    });
  });

  describe("POST /playlists/:playlistId/cover", () => {
    it("uploads playlist cover image", async () => {
      const res = await request(app.getHttpServer())
        .post(`/playlists/${playlistId}/cover`)
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
      await request(app.getHttpServer()).post(`/playlists/${playlistId}/like`).expect(201);

      expect(service.likePlaylist).toHaveBeenCalledWith("usr_1", playlistId);
    });
  });

  describe("DELETE /playlists/:playlistId/like", () => {
    it("unlikes playlist", async () => {
      await request(app.getHttpServer()).delete(`/playlists/${playlistId}/like`).expect(200);

      expect(service.unlikePlaylist).toHaveBeenCalledWith("usr_1", playlistId);
    });
  });

  describe("GET /playlists/:playlistId/embed", () => {
    it("returns embed code", async () => {
      await request(app.getHttpServer()).get(`/playlists/${playlistId}/embed`).expect(200);

      expect(service.getEmbedCode).toHaveBeenCalledWith("usr_1", playlistId, {});
    });
  });

  describe("POST /playlists/:playlistId/tracks", () => {
    it("adds track to playlist", async () => {
      const res = await request(app.getHttpServer())
        .post(`/playlists/${playlistId}/tracks`)
        .send({ trackId })
        .expect(201);

      expect(service.addTrack).toHaveBeenCalledWith("usr_1", playlistId, {
        trackId,
      });
      expect(res.body).toEqual({
        message: expect.any(String),
        playlistId: expect.any(String),
        title: expect.any(String),
        trackId: expect.any(String),
        coverArtUrl: expect.anything(),
        artist: {
          id: expect.any(String),
          name: expect.any(String),
          handle: expect.any(String),
        },
      });
    });

    it("returns 400 when body is invalid", async () => {
      await request(app.getHttpServer())
        .post(`/playlists/${playlistId}/tracks`)
        .send({ trackId: "" })
        .expect(400);
    });
  });

  describe("DELETE /playlists/:playlistId/tracks/:trackId", () => {
    it("removes track from playlist", async () => {
      await request(app.getHttpServer())
        .delete(`/playlists/${playlistId}/tracks/${trackId}`)
        .expect(200);

      expect(service.removeTrack).toHaveBeenCalledWith("usr_1", playlistId, trackId);
    });
  });

  describe("PATCH /playlists/:playlistId/reorder", () => {
    it("reorders tracks", async () => {
      const payload = {
        orderedTrackIds: [
          "95ea95c7-9277-46a8-8e44-7e31c3d11c58",
          "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
        ],
      };

      await request(app.getHttpServer())
        .patch(`/playlists/${playlistId}/reorder`)
        .send(payload)
        .expect(200);

      expect(service.reorderTracks).toHaveBeenCalledWith("usr_1", playlistId, payload);
    });

    it("returns 400 for invalid reorder body", async () => {
      await request(app.getHttpServer())
        .patch(`/playlists/${playlistId}/reorder`)
        .send({ orderedTrackIds: ["95ea95c7-9277-46a8-8e44-7e31c3d11c58", ""] })
        .expect(400);
    });
  });

  describe("GET /playlists/:playlistId", () => {
    it("returns playlist details", async () => {
      await request(app.getHttpServer()).get(`/playlists/${playlistId}`).expect(200);
      expect(service.getDetails).toHaveBeenCalledWith(playlistId, "usr_1", {});
    });
  });

  describe("PATCH /playlists/:playlistId", () => {
    it("updates playlist", async () => {
      await request(app.getHttpServer())
        .patch(`/playlists/${playlistId}`)
        .send({ title: "Vol 2" })
        .expect(200);

      expect(service.update).toHaveBeenCalledWith("usr_1", playlistId, {
        title: "Vol 2",
      });
    });

    it("returns 400 for invalid visibility", async () => {
      await request(app.getHttpServer())
        .patch(`/playlists/${playlistId}`)
        .send({ visibility: "FRIENDS_ONLY" })
        .expect(400);
    });
  });

  describe("PATCH /playlists/:playlistId", () => {
    it("returns 400 for private visibility payloads", async () => {
      await request(app.getHttpServer())
        .patch(`/playlists/${playlistId}`)
        .send({ visibility: "private" })
        .expect(400);

      expect(service.update).not.toHaveBeenCalled();
    });

    it("accepts lowercase secret visibility payloads", async () => {
      await request(app.getHttpServer())
        .patch(`/playlists/${playlistId}`)
        .send({ visibility: "secret" })
        .expect(200);

      expect(service.update).toHaveBeenCalledWith("usr_1", playlistId, { visibility: "secret" });
    });
  });

  describe("DELETE /playlists/:playlistId", () => {
    it("returns 204 and delegates removal", async () => {
      await request(app.getHttpServer()).delete(`/playlists/${playlistId}`).expect(204);
      expect(service.remove).toHaveBeenCalledWith("usr_1", playlistId);
    });
  });
});

