import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { AdminReportsController } from "../src/reports/admin-reports.controller";
import { ReportsController } from "../src/reports/reports.controller";
import { ReportsService } from "../src/reports/reports.service";
import { DiscoveryController } from "../src/discovery/discovery.controller";
import { DiscoveryService } from "../src/discovery/discovery.service";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";

const USER_ID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const REPORT_ID = "b1c2d3e4-f5a6-4890-abcd-ef1234567890";

// Fixture track used in genre-trending e2e tests.
// Using local test constants — NOT production values.
const E2E_GENRE_SLUG = "electronic";
const E2E_GENRE_NAME = "Electronic";
const E2E_TRACK_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const E2E_ARTIST_ID = "bbbbbbbb-0000-0000-0000-000000000002";

const makeTrendingGenreResponse = (overrides: Record<string, unknown> = {}) => ({
  genre: { slug: E2E_GENRE_SLUG, name: E2E_GENRE_NAME },
  limit: 5,
  total: 1,
  tracks: [
    {
      trackId: E2E_TRACK_ID,
      title: "Test Track Title",
      slug: "test-track-title",
      artist: {
        id: E2E_ARTIST_ID,
        displayName: "Test Artist",
        handle: "test-artist",
        avatarUrl: null,
      },
      genre: { slug: E2E_GENRE_SLUG, name: E2E_GENRE_NAME },
      coverArtUrl: null,
      durationMs: 210000,
      waveformData: [0.1, 0.5, 0.9],
      likesCount: 42,
      repostsCount: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
      publishedAt: "2026-01-01T01:00:00.000Z",
    },
  ],
  ...overrides,
});

function buildDiscoveryServiceMock(): {
  search: jest.Mock;
  trending: jest.Mock;
  resolveResource: jest.Mock;
  getTrendingTracksByGenre: jest.Mock;
} {
  return {
    search: jest.fn().mockResolvedValue({
      data: { tracks: [], users: [], playlists: [] },
      meta: { current_page: 1, total_results: 0, total_pages: 0 },
    }),
    trending: jest.fn().mockResolvedValue({
      windowDays: 7,
      items: [
        {
          id: "track-1",
          title: "Trending Track",
          slug: "trending-track",
          coverArtUrl: "https://example.com/cover.jpg",
          uploaderId: "user-1",
          uploader: { userId: "user-1", handle: "artist", displayName: "Artist" },
          recentPlays: 100,
          recentLikes: 50,
          velocityScore: 200,
          liked: false,
        },
      ],
    }),
    resolveResource: jest.fn().mockResolvedValue({
      matched: true,
      resourceType: "TRACK",
      id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      slug: "night-drive",
    }),
    getTrendingTracksByGenre: jest
      .fn()
      .mockResolvedValue(makeTrendingGenreResponse()),
  };
}

function buildReportsServiceMock(): {
  createReport: jest.Mock;
  createAppeal: jest.Mock;
  getReports: jest.Mock;
  getReportById: jest.Mock;
  updateReport: jest.Mock;
  bulkUpdateReports: jest.Mock;
  assignReport: jest.Mock;
} {
  return {
    createReport: jest.fn().mockResolvedValue({
      id: REPORT_ID,
      reporterId: USER_ID,
      targetType: "TRACK",
      targetId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      reason: "SPAM",
      status: "PENDING",
    }),
    createAppeal: jest.fn().mockResolvedValue({
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      reportId: REPORT_ID,
      userId: USER_ID,
      message: "Please review this report again.",
    }),
    getReports: jest.fn().mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    }),
    getReportById: jest.fn().mockResolvedValue({
      id: REPORT_ID,
      appeals: [],
    }),
    updateReport: jest.fn().mockResolvedValue({
      report: { id: REPORT_ID, status: "RESOLVED" },
      notesAppliedToAppeals: 0,
    }),
    bulkUpdateReports: jest.fn().mockResolvedValue({
      updatedReports: 1,
      updatedAppeals: 0,
    }),
    assignReport: jest.fn().mockResolvedValue({
      id: REPORT_ID,
      resolvedBy: USER_ID,
    }),
  };
}

describe("Module 8+11 smoke e2e (Discovery + Reports)", () => {
  let app: INestApplication;
  let discoveryServiceMock: ReturnType<typeof buildDiscoveryServiceMock>;
  let reportsServiceMock: ReturnType<typeof buildReportsServiceMock>;

  beforeAll(async () => {
    discoveryServiceMock = buildDiscoveryServiceMock();
    reportsServiceMock = buildReportsServiceMock();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        DiscoveryController,
        ReportsController,
        AdminReportsController,
      ],
      providers: [
        { provide: DiscoveryService, useValue: discoveryServiceMock },
        { provide: ReportsService, useValue: reportsServiceMock },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: any) => {
              ctx.switchToHttp().getRequest().user = {
                userId: USER_ID,
                role: "ADMIN",
              };
              return true;
            },
          },
        },
        // Replace JwtAuthGuard used by controllers with a simple allow-all mock
        {
          provide: JwtAuthGuard,
          useValue: {
            canActivate: (ctx: any) => {
              const req = ctx.switchToHttp().getRequest();
              req.user = { userId: USER_ID, role: "ADMIN" };
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

  afterAll(async () => {
    await app.close();
  });

  describe("Discovery endpoints", () => {
    it("GET /discovery/search should return grouped search results", async () => {
      const res = await request(app.getHttpServer())
        .get("/discovery/search")
        .query({ q: "lofi", type: "all", page: 1, limit: 20 })
        .expect(200);

      expect(discoveryServiceMock.search).toHaveBeenCalledWith("lofi", "all", 1, 20);
      expect(res.body).toHaveProperty("data");
      expect(res.body.data).toHaveProperty("tracks");
      expect(res.body.data).toHaveProperty("users");
      expect(res.body.data).toHaveProperty("playlists");
      expect(res.body).toHaveProperty("meta");
      expect(res.body.meta).toHaveProperty("current_page");
      expect(res.body.meta).toHaveProperty("total_results");
      expect(res.body.meta).toHaveProperty("total_pages");
    });

    it("GET /discovery/trending should return trending payload", async () => {
      const res = await request(app.getHttpServer())
        .get("/discovery/trending")
        .query({ limit: 10, windowDays: 7 })
        .expect(200);

      expect(discoveryServiceMock.trending).toHaveBeenCalledWith(10, 7, USER_ID);
      expect(res.body).toHaveProperty("items");
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toEqual(
        expect.objectContaining({
          id: "track-1",
          title: "Trending Track",
          liked: false,
          velocityScore: 200,
        }),
      );
    });

    it("GET /discovery/resolve should resolve resource url", async () => {
      const res = await request(app.getHttpServer())
        .get("/discovery/resolve")
        .query({ url: "/john-doe/night-drive" })
        .expect(200);

      expect(discoveryServiceMock.resolveResource).toHaveBeenCalledWith(
        "/john-doe/night-drive",
      );
      expect(res.body).toHaveProperty("matched", true);
      expect(res.body).toHaveProperty("resourceType");
      expect(res.body).toHaveProperty("id");
    });

    describe("GET /discovery/trending/genres/:genreSlug/tracks", () => {
      it("200 with valid genre and matching tracks", async () => {
        discoveryServiceMock.getTrendingTracksByGenre.mockResolvedValueOnce(
          makeTrendingGenreResponse(),
        );

        const res = await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .expect(200);

        expect(discoveryServiceMock.getTrendingTracksByGenre).toHaveBeenCalledWith(
          E2E_GENRE_SLUG,
          5,
        );
        expect(res.body.genre.slug).toBe(E2E_GENRE_SLUG);
        expect(res.body.genre.name).toBe(E2E_GENRE_NAME);
        expect(res.body.tracks).toHaveLength(1);
        expect(res.body.total).toBe(1);
      });

      it("200 with valid genre and no matching tracks returns tracks: []", async () => {
        discoveryServiceMock.getTrendingTracksByGenre.mockResolvedValueOnce(
          makeTrendingGenreResponse({ total: 0, tracks: [] }),
        );

        const res = await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .expect(200);

        expect(res.body.tracks).toEqual([]);
        expect(res.body.total).toBe(0);
        expect(res.body.genre.slug).toBe(E2E_GENRE_SLUG);
      });

      it("404 with invalid genre propagates from service", async () => {
        const { NotFoundException } = await import("@nestjs/common");
        discoveryServiceMock.getTrendingTracksByGenre.mockRejectedValueOnce(
          new NotFoundException(`Genre "no-such" not found.`),
        );

        const res = await request(app.getHttpServer())
          .get("/discovery/trending/genres/no-such/tracks")
          .expect(404);

        expect(res.body.message).toContain("no-such");
      });

      it("passes correct default limit=5 when no query param", async () => {
        discoveryServiceMock.getTrendingTracksByGenre.mockResolvedValueOnce(
          makeTrendingGenreResponse(),
        );

        await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .expect(200);

        expect(discoveryServiceMock.getTrendingTracksByGenre).toHaveBeenCalledWith(
          E2E_GENRE_SLUG,
          5,
        );
      });

      it("passes explicit valid limit", async () => {
        discoveryServiceMock.getTrendingTracksByGenre.mockResolvedValueOnce(
          makeTrendingGenreResponse(),
        );

        await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .query({ limit: 3 })
          .expect(200);

        expect(discoveryServiceMock.getTrendingTracksByGenre).toHaveBeenCalledWith(
          E2E_GENRE_SLUG,
          3,
        );
      });

      it("400 when limit exceeds maximum of 5", async () => {
        await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .query({ limit: 10 })
          .expect(400);
      });

      it("400 when limit is zero", async () => {
        await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .query({ limit: 0 })
          .expect(400);
      });

      it("400 when limit is a non-numeric string", async () => {
        await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .query({ limit: "abc" })
          .expect(400);
      });

      it("response track shape includes all required contract fields", async () => {
        discoveryServiceMock.getTrendingTracksByGenre.mockResolvedValueOnce(
          makeTrendingGenreResponse(),
        );

        const res = await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .expect(200);

        const track = res.body.tracks[0];
        expect(track).toHaveProperty("trackId");
        expect(track).toHaveProperty("title");
        expect(track).toHaveProperty("slug");
        expect(track).toHaveProperty("artist");
        expect(track.artist).toHaveProperty("id");
        expect(track.artist).toHaveProperty("displayName");
        expect(track.artist).toHaveProperty("handle");
        expect(track.artist).toHaveProperty("avatarUrl");
        expect(track).toHaveProperty("genre");
        expect(track.genre).toHaveProperty("slug");
        expect(track.genre).toHaveProperty("name");
        expect(track).toHaveProperty("coverArtUrl");
        expect(track).toHaveProperty("durationMs");
        expect(track).toHaveProperty("waveformData");
        expect(track).toHaveProperty("likesCount");
        expect(track).toHaveProperty("repostsCount");
        expect(track).toHaveProperty("createdAt");
        expect(track).toHaveProperty("publishedAt");
      });

      it("response does not expose secretToken or internal fields", async () => {
        discoveryServiceMock.getTrendingTracksByGenre.mockResolvedValueOnce(
          makeTrendingGenreResponse(),
        );

        const res = await request(app.getHttpServer())
          .get(`/discovery/trending/genres/${E2E_GENRE_SLUG}/tracks`)
          .expect(200);

        const body = JSON.stringify(res.body);
        expect(body).not.toContain("secretToken");
        expect(body).not.toContain("passwordHash");
        expect(body).not.toContain("email");
      });
    });
  });

  describe.skip("Reports endpoints", () => {
    it("POST /reports should create a report", async () => {
      const body = {
        targetId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
        targetType: "TRACK",
        reason: "SPAM",
        description: "Suspected spam upload",
      };

      const res = await request(app.getHttpServer())
        .post("/reports")
        .send(body)
        .expect(201);

      expect(reportsServiceMock.createReport).toHaveBeenCalledWith(
        USER_ID,
        body,
      );
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("status");
    });

    it("POST /reports/appeal should create an appeal", async () => {
      const body = {
        reportId: REPORT_ID,
        message: "Please review this report again.",
      };

      const res = await request(app.getHttpServer())
        .post("/reports/appeal")
        .send(body)
        .expect(201);

      expect(reportsServiceMock.createAppeal).toHaveBeenCalledWith(
        body.reportId,
        USER_ID,
        body,
      );
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("reportId", REPORT_ID);
    });

    it("GET /admin/reports should return paginated list", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/reports")
        .query({ page: 1, limit: 20 })
        .expect(200);

      expect(reportsServiceMock.getReports).toHaveBeenCalled();
      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("pagination");
    });
  });
});
