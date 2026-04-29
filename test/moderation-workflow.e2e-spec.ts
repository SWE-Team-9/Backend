import { INestApplication, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  AccountStatus,
  AccountType,
  Gender,
  ProfileVisibility,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  SystemRole,
  TrackStatus,
  TrackVisibility,
} from "@prisma/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest") as typeof import("supertest");

import { AdminUsersController } from "../src/admin/admin-users.controller";
import { AdminUsersService } from "../src/admin/admin-users.service";
import { AdminReportsController } from "../src/reports/admin-reports.controller";
import { ReportsController } from "../src/reports/reports.controller";
import { ReportsService } from "../src/reports/reports.service";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard";
import { RolesGuard } from "../src/common/guards/roles.guard";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const REPORTER_ID = "33333333-3333-4333-8333-333333333333";
const TRACK_OWNER_ID = "44444444-4444-4444-8444-444444444444";
const WORKFLOW_TRACK_ID = "55555555-5555-4555-8555-555555555555";
const WORKFLOW_REPORTER_EMAIL = "workflow-reporter@example.com";
const WORKFLOW_OWNER_EMAIL = "workflow-owner@example.com";
const WORKFLOW_ADMIN_EMAIL = "workflow-admin@example.com";
const BULK_REPORT_PREFIX = "bulk-resolve-report-";

function buildAuthGuard() {
  return {
    canActivate: (ctx: any) => {
      const requestObject = ctx.switchToHttp().getRequest();
      const userId = requestObject.headers["x-test-user-id"] ?? REPORTER_ID;
      const role = requestObject.headers["x-test-role"] ?? "USER";
      requestObject.user = {
        userId,
        role,
      };
      return true;
    },
  };
}

describe("Moderation workflow e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workflowReportId = "";

  beforeAll(async () => {
    jest.setTimeout(120_000);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController, AdminReportsController, AdminUsersController],
      providers: [
        ReportsService,
        AdminUsersService,
        PrismaService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: APP_GUARD,
          useValue: buildAuthGuard(),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(buildAuthGuard())
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    await prisma.report.deleteMany({ where: { reporterId: { in: [REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.moderationReport.deleteMany({ where: { reporterId: { in: [REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.track.deleteMany({ where: { id: WORKFLOW_TRACK_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: { in: [ADMIN_ID, REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, REPORTER_ID, TRACK_OWNER_ID] } } });

    await prisma.user.createMany({
      data: [
        {
          id: ADMIN_ID,
          email: WORKFLOW_ADMIN_EMAIL,
          passwordHash: "hash",
          systemRole: SystemRole.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          isVerified: true,
          dateOfBirth: new Date("1990-01-01"),
          gender: Gender.PREFER_NOT_TO_SAY,
        },
        {
          id: REPORTER_ID,
          email: WORKFLOW_REPORTER_EMAIL,
          passwordHash: "hash",
          systemRole: SystemRole.USER,
          accountStatus: AccountStatus.ACTIVE,
          isVerified: true,
          dateOfBirth: new Date("1991-01-01"),
          gender: Gender.PREFER_NOT_TO_SAY,
        },
        {
          id: TRACK_OWNER_ID,
          email: WORKFLOW_OWNER_EMAIL,
          passwordHash: "hash",
          systemRole: SystemRole.USER,
          accountStatus: AccountStatus.ACTIVE,
          isVerified: true,
          dateOfBirth: new Date("1992-01-01"),
          gender: Gender.PREFER_NOT_TO_SAY,
        },
      ],
    });

    await prisma.userProfile.createMany({
      data: [
        {
          userId: ADMIN_ID,
          handle: "workflow-admin",
          displayName: "Workflow Admin",
          accountType: AccountType.LISTENER,
          visibility: ProfileVisibility.PUBLIC,
          likesVisible: true,
        },
        {
          userId: REPORTER_ID,
          handle: "workflow-reporter",
          displayName: "Workflow Reporter",
          accountType: AccountType.LISTENER,
          visibility: ProfileVisibility.PUBLIC,
          likesVisible: true,
        },
        {
          userId: TRACK_OWNER_ID,
          handle: "workflow-owner",
          displayName: "Workflow Owner",
          accountType: AccountType.ARTIST,
          visibility: ProfileVisibility.PUBLIC,
          likesVisible: true,
        },
      ],
    });

    await prisma.track.create({
      data: {
        id: WORKFLOW_TRACK_ID,
        uploaderId: TRACK_OWNER_ID,
        title: "Workflow Test Track",
        slug: "workflow-test-track",
        description: "Moderation workflow test track",
        waveformData: [],
        visibility: TrackVisibility.PUBLIC,
        status: TrackStatus.FINISHED,
        moderationState: "VISIBLE",
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { reporterId: { in: [REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.moderationReport.deleteMany({ where: { reporterId: { in: [REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.track.deleteMany({ where: { id: WORKFLOW_TRACK_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: { in: [ADMIN_ID, REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, REPORTER_ID, TRACK_OWNER_ID] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it("runs the full report lifecycle and updates overview stats", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/reports")
      .set("x-test-user-id", REPORTER_ID)
      .set("x-test-role", "USER")
      .send({
        targetId: WORKFLOW_TRACK_ID,
        targetType: ReportTargetType.TRACK,
        reason: ReportReason.SPAM,
        description: "Workflow report for moderation test",
      })
      .expect(201);

    workflowReportId = createResponse.body.id;
    expect(createResponse.body.status).toBe(ReportStatus.PENDING);

    const listResponse = await request(app.getHttpServer())
      .get("/admin/reports")
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "ADMIN")
      .expect(200);

    const createdReport = listResponse.body.items.find(
      (item: any) => item.id === workflowReportId,
    );
    expect(createdReport).toBeDefined();
    expect(createdReport.status).toBe(ReportStatus.PENDING);

    const assignResponse = await request(app.getHttpServer())
      .patch(`/admin/reports/${workflowReportId}/assign`)
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "ADMIN")
      .send({ adminId: ADMIN_ID })
      .expect(200);

    expect(assignResponse.body.status).toBe(ReportStatus.UNDER_REVIEW);

    const resolveResponse = await request(app.getHttpServer())
      .patch(`/admin/reports/${workflowReportId}`)
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "ADMIN")
      .send({
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Confirmed spam",
      })
      .expect(200);

    expect(resolveResponse.body.report.status).toBe(ReportStatus.RESOLVED);

    const statsResponse = await request(app.getHttpServer())
      .get("/admin/stats/overview")
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "ADMIN")
      .expect(200);

    expect(statsResponse.body.moderation.reports_resolved_this_week).toBeGreaterThanOrEqual(
      1,
    );

    const appealResponse = await request(app.getHttpServer())
      .post("/reports/appeal")
      .set("x-test-user-id", TRACK_OWNER_ID)
      .set("x-test-role", "USER")
      .send({
        reportId: workflowReportId,
        message: "The report was made in error.",
      })
      .expect(201);

    expect(appealResponse.body.reportId).toBe(workflowReportId);
  });

  it("bulk resolves 50 pending reports", async () => {
    const runPrefix = `${BULK_REPORT_PREFIX}${Date.now()}-`;

    await prisma.report.deleteMany({
      where: { description: { startsWith: runPrefix } },
    });

    const bulkRows = Array.from({ length: 50 }, (_, index) => ({
      reporterId: REPORTER_ID,
      targetType: ReportTargetType.TRACK,
      targetId: WORKFLOW_TRACK_ID,
      reason: ReportReason.SPAM,
      description: `${runPrefix}${index}`,
      status: ReportStatus.PENDING,
    }));

    await prisma.report.createMany({ data: bulkRows });

    const seededReports = await prisma.report.findMany({
      where: { description: { startsWith: runPrefix } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    const reportIds = seededReports.map((report) => report.id);

    const bulkResponse = await request(app.getHttpServer())
      .patch("/admin/reports/bulk")
      .set("x-test-user-id", ADMIN_ID)
      .set("x-test-role", "ADMIN")
      .send({
        reportIds,
        status: ReportStatus.RESOLVED,
      })
      .expect(200);

    expect(bulkResponse.body.updatedReports).toBe(50);

    const resolvedCount = await prisma.report.count({
      where: {
        id: { in: reportIds },
        status: ReportStatus.RESOLVED,
      },
    });

    expect(resolvedCount).toBe(50);

    await prisma.report.deleteMany({
      where: { description: { startsWith: runPrefix } },
    });
  });
});
