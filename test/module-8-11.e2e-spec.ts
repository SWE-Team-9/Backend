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

const USER_ID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const REPORT_ID = "b1c2d3e4-f5a6-4890-abcd-ef1234567890";

function buildDiscoveryServiceMock(): {
  search: jest.Mock;
  trending: jest.Mock;
  resolveResource: jest.Mock;
} {
  return {
    search: jest.fn().mockResolvedValue({
      query: "lofi",
      results: { tracks: [], users: [], playlists: [] },
      totals: { tracks: 0, users: 0, playlists: 0 },
    }),
    trending: jest.fn().mockResolvedValue({
      windowDays: 7,
      items: [],
    }),
    resolveResource: jest.fn().mockResolvedValue({
      matched: true,
      resourceType: "TRACK",
      id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      slug: "night-drive",
    }),
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
        .query({ q: "lofi" })
        .expect(200);

      expect(discoveryServiceMock.search).toHaveBeenCalledWith("lofi");
      expect(res.body).toHaveProperty("results");
      expect(res.body.results).toHaveProperty("tracks");
      expect(res.body.results).toHaveProperty("users");
      expect(res.body.results).toHaveProperty("playlists");
    });

    it("GET /discovery/trending should return trending payload", async () => {
      const res = await request(app.getHttpServer())
        .get("/discovery/trending")
        .query({ limit: 10, windowDays: 7 })
        .expect(200);

      expect(discoveryServiceMock.trending).toHaveBeenCalledWith(10, 7);
      expect(res.body).toHaveProperty("items");
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
  });

  describe("Reports endpoints", () => {
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

      expect(reportsServiceMock.createReport).toHaveBeenCalledWith(USER_ID, body);
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
