import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  ReportReason,
  ReportStatus,
  ReportTargetType,
  SystemRole,
} from "@prisma/client";
import { ReportsService } from "./reports.service";
import { PrismaService } from "../prisma/prisma.service";

type MockPrismaService = {
  report: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  appeal: {
    findFirst: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  track: {
    findUnique: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
  playlist: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockPrisma: MockPrismaService = {
  report: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  appeal: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  track: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  playlist: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockEventEmitter: { emit: jest.Mock } = {
  emit: jest.fn(),
};

const REPORTER_ID = "reporter-uuid";
const ADMIN_ID = "admin-uuid";
const REPORT_ID = "report-uuid";
const TRACK_ID = "track-uuid";
const USER_ID = "user-uuid";
const PLAYLIST_ID = "playlist-uuid";

describe("ReportsService", () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  describe("createReport", () => {
    it("throws NotFoundException when target track does not exist", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce(null as any);

      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.TRACK,
          targetId: TRACK_ID,
          reason: ReportReason.SPAM,
          description: "spam content",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when target user does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null as any);

      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.USER,
          targetId: USER_ID,
          reason: ReportReason.INAPPROPRIATE,
          description: "harassment",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when target playlist does not exist", async () => {
      mockPrisma.playlist.findUnique.mockResolvedValueOnce(null as any);

      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.PLAYLIST,
          targetId: PLAYLIST_ID,
          reason: ReportReason.SPAM,
          description: "playlist spam",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException for invalid target type", async () => {
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: "COMMENT" as ReportTargetType,
          targetId: "some-id",
          reason: ReportReason.SPAM,
          description: "invalid target",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ConflictException on duplicate report from same user", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce({ id: "existing" } as any);

      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.TRACK,
          targetId: TRACK_ID,
          reason: ReportReason.SPAM,
          description: "duplicate",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("creates report and emits event on success", async () => {
      const createdReport = {
        id: REPORT_ID,
        reporterId: REPORTER_ID,
        targetType: ReportTargetType.TRACK,
        targetId: TRACK_ID,
        reason: ReportReason.SPAM,
        status: ReportStatus.PENDING,
        createdAt: new Date(),
      };

      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce(createdReport as any);

      const result = await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.TRACK,
        targetId: TRACK_ID,
        reason: ReportReason.SPAM,
        description: "spam content",
      });

      expect(result).toEqual(createdReport);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "report.created",
        expect.objectContaining({ reportId: REPORT_ID }),
      );
    });

    it("emits report.created with the full payload", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce({ id: REPORT_ID } as any);

      await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.TRACK,
        targetId: TRACK_ID,
        reason: ReportReason.SPAM,
        description: "spam content",
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith("report.created", {
        reportId: REPORT_ID,
        reporterId: REPORTER_ID,
        category: ReportReason.SPAM,
        targetType: ReportTargetType.TRACK,
      });
    });

    it("stores PENDING status by default", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce({
        id: REPORT_ID,
        status: ReportStatus.PENDING,
      } as any);

      const result = await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.TRACK,
        targetId: TRACK_ID,
        reason: ReportReason.SPAM,
        description: "spam content",
      });

      expect(result.status).toBe(ReportStatus.PENDING);
    });

    it("allows re-reporting the same content after previous report was REJECTED", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce({ id: "r2" } as any);

      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.TRACK,
          targetId: TRACK_ID,
          reason: ReportReason.SPAM,
          description: "new report after rejection",
        }),
      ).resolves.toBeDefined();
    });

    it("creates report with a playlist target", async () => {
      mockPrisma.playlist.findUnique.mockResolvedValueOnce({ id: PLAYLIST_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce({ id: "playlist-report" } as any);

      const result = await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.PLAYLIST,
        targetId: PLAYLIST_ID,
        reason: ReportReason.COPYRIGHT,
        description: "Copyright violation",
      });

      expect(result).toBeDefined();
    });

    it("stores optional description when provided", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce({ id: REPORT_ID } as any);

      await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.TRACK,
        targetId: TRACK_ID,
        reason: ReportReason.SPAM,
        description: "Detailed spam description",
      });

      expect(mockPrisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: "Detailed spam description",
        }),
      });
    });

    it("creates report even without description", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: TRACK_ID } as any);
      mockPrisma.report.findFirst.mockResolvedValueOnce(null as any);
      mockPrisma.report.create.mockResolvedValueOnce({ id: REPORT_ID } as any);

      await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.TRACK,
        targetId: TRACK_ID,
        reason: ReportReason.SPAM,
      } as any);

      expect(mockPrisma.report.create).toHaveBeenCalled();
    });
  });

  describe("getReportById", () => {
    it("throws NotFoundException when report does not exist", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce(null as any);

      await expect(service.getReportById("no-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns report with appeals", async () => {
      const reportWithAppeals = {
        id: REPORT_ID,
        reporter: { id: REPORTER_ID, email: "a@b.com" },
        adminResolution: null,
        appeals: [],
      };

      mockPrisma.report.findUnique.mockResolvedValueOnce(reportWithAppeals as any);

      const result = await service.getReportById(REPORT_ID);

      expect(result.id).toBe(REPORT_ID);
    });

    it("includes reporter information", async () => {
      const reportWithReporter = {
        id: REPORT_ID,
        reporter: { id: REPORTER_ID, email: "reporter@example.com" },
      };

      mockPrisma.report.findUnique.mockResolvedValueOnce(reportWithReporter as any);

      const result = await service.getReportById(REPORT_ID);

      expect(result.reporter).toBeDefined();
    });

    it("includes admin resolution information", async () => {
      const reportWithAdmin = {
        id: REPORT_ID,
        adminResolution: { id: ADMIN_ID, email: "admin@example.com" },
      };

      mockPrisma.report.findUnique.mockResolvedValueOnce(reportWithAdmin as any);

      const result = await service.getReportById(REPORT_ID);

      expect(result.adminResolution).toBeDefined();
    });

    it("includes appeal count", async () => {
      const reportWithCount = {
        id: REPORT_ID,
        _count: { appeals: 3 },
      };

      mockPrisma.report.findUnique.mockResolvedValueOnce(reportWithCount as any);

      const result = await service.getReportById(REPORT_ID);

      expect((result as any)._count.appeals).toBe(3);
    });
  });

  describe("getReports", () => {
    it("retrieves paginated reports", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([10, [{ id: REPORT_ID }]] as any);

      const result = await service.getReports({ page: 1, limit: 20 } as any);

      expect(result.items).toBeDefined();
      expect(result.pagination).toBeDefined();
    });

    it("filters by status", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([0, []] as any);

      await service.getReports({ page: 1, limit: 20, status: ReportStatus.PENDING } as any);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("filters by targetType", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([0, []] as any);

      await service.getReports({
        page: 1,
        limit: 20,
        targetType: ReportTargetType.TRACK,
      } as any);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("uses default page 1", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([0, []] as any);

      const result = await service.getReports({ limit: 20 } as any);

      expect(result.pagination.page).toBe(1);
    });

    it("uses default limit 20", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([0, []] as any);

      const result = await service.getReports({ page: 1 } as any);

      expect(result.pagination.limit).toBe(20);
    });

    it("calculates totalPages correctly", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([50, Array(20).fill({ id: REPORT_ID })] as any);

      const result = await service.getReports({ page: 1, limit: 20 } as any);

      expect(result.pagination.totalPages).toBe(3);
    });

    it("includes reporter information", async () => {
      const reportWithReporter = {
        id: REPORT_ID,
        reporter: { id: REPORTER_ID, email: "reporter@example.com" },
      };

      mockPrisma.$transaction.mockResolvedValueOnce([1, [reportWithReporter]] as any);

      const result = await service.getReports({ page: 1, limit: 20 } as any);

      expect(result.items[0].reporter).toBeDefined();
    });

    it("includes appeal count", async () => {
      const reportWithCount = {
        id: REPORT_ID,
        _count: { appeals: 2 },
      };

      mockPrisma.$transaction.mockResolvedValueOnce([1, [reportWithCount]] as any);

      const result = await service.getReports({ page: 1, limit: 20 } as any);

      expect(result.items[0]._count.appeals).toBe(2);
    });
  });

  describe("updateReport", () => {
    it("throws NotFoundException when report not found", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce(null as any);

      await expect(
        service.updateReport("no-id", ADMIN_ID, { status: ReportStatus.RESOLVED }),
      ).rejects.toThrow(NotFoundException);
    });

    it("sets resolvedAt and resolvedBy when status is RESOLVED", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.report.update.mockResolvedValueOnce({
        id: REPORT_ID,
        status: ReportStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy: ADMIN_ID,
      } as any);
      mockPrisma.appeal.updateMany.mockResolvedValueOnce({ count: 0 } as any);

      const result = await service.updateReport(REPORT_ID, ADMIN_ID, {
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Action taken.",
      });

      expect(mockPrisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resolvedBy: ADMIN_ID }),
        }),
      );
      expect(result.report.status).toBe(ReportStatus.RESOLVED);
    });

    it("updates status to UNDER_REVIEW", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.report.update.mockResolvedValueOnce({
        id: REPORT_ID,
        status: ReportStatus.UNDER_REVIEW,
      } as any);

      const result = await service.updateReport(REPORT_ID, ADMIN_ID, {
        status: ReportStatus.UNDER_REVIEW,
      } as any);

      expect(result.report.status).toBe(ReportStatus.UNDER_REVIEW);
    });

    it("applies resolution notes to appeals", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.report.update.mockResolvedValueOnce({
        id: REPORT_ID,
        status: ReportStatus.RESOLVED,
      } as any);
      mockPrisma.appeal.updateMany.mockResolvedValueOnce({ count: 2 } as any);

      const result = await service.updateReport(REPORT_ID, ADMIN_ID, {
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Content violates policy",
      } as any);

      expect(result.notesAppliedToAppeals).toBe(2);
      expect(mockPrisma.appeal.updateMany).toHaveBeenCalledWith({
        where: { reportId: REPORT_ID },
        data: expect.objectContaining({
          resolutionNotes: "Content violates policy",
        }),
      });
    });

    it("sets resolvedAt and resolvedBy when transitioning to REJECTED", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.report.update.mockResolvedValueOnce({
        id: REPORT_ID,
        status: ReportStatus.REJECTED,
        resolvedAt: new Date(),
        resolvedBy: ADMIN_ID,
      } as any);

      const result = await service.updateReport(REPORT_ID, ADMIN_ID, {
        status: ReportStatus.REJECTED,
      } as any);

      expect(result.report.resolvedBy).toBe(ADMIN_ID);
      expect(result.report.resolvedAt).not.toBeNull();
    });

    it("does not update appeals if no resolution notes are provided", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.report.update.mockResolvedValueOnce({ id: REPORT_ID } as any);

      await service.updateReport(REPORT_ID, ADMIN_ID, {
        status: ReportStatus.RESOLVED,
      } as any);

      expect(mockPrisma.appeal.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("bulkUpdateReports", () => {
    it("updates multiple reports in a transaction", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 3 }, { count: 2 }] as any);

      const result = await service.bulkUpdateReports(ADMIN_ID, {
        reportIds: ["r1", "r2", "r3"],
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Batch resolved",
      } as any);

      expect(result.updatedReports).toBe(3);
      expect(result.updatedAppeals).toBe(2);
    });

    it("updates related appeals", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 2 }, { count: 5 }] as any);

      const result = await service.bulkUpdateReports(ADMIN_ID, {
        reportIds: ["r1", "r2"],
        status: ReportStatus.RESOLVED,
      } as any);

      expect(result.updatedAppeals).toBe(5);
    });

    it("handles empty report IDs list", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 0 }, { count: 0 }] as any);

      const result = await service.bulkUpdateReports(ADMIN_ID, {
        reportIds: [],
        status: ReportStatus.RESOLVED,
      } as any);

      expect(result.updatedReports).toBe(0);
      expect(result.updatedAppeals).toBe(0);
    });

    it("uses transaction for atomicity", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 2 }, { count: 3 }] as any);

      await service.bulkUpdateReports(ADMIN_ID, {
        reportIds: ["r1", "r2"],
        status: ReportStatus.RESOLVED,
      } as any);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("createAppeal", () => {
    it("creates an appeal for a report", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.appeal.create.mockResolvedValueOnce({
        id: "appeal-1",
        reportId: REPORT_ID,
        userId: USER_ID,
        message: "Please reconsider this decision",
        createdAt: new Date(),
        status: ReportStatus.PENDING,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
      } as any);

      const result = await service.createAppeal(REPORT_ID, USER_ID, {
        message: "Please reconsider this decision",
      } as any);

      expect(result.reportId).toBe(REPORT_ID);
      expect(result.userId).toBe(USER_ID);
      expect(result.message).toBe("Please reconsider this decision");
    });

    it("throws NotFoundException if report does not exist", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce(null as any);

      await expect(
        service.createAppeal(REPORT_ID, USER_ID, { message: "Please reconsider" } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("stores appeal message correctly", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.appeal.create.mockResolvedValueOnce({
        id: "appeal-1",
        reportId: REPORT_ID,
        userId: USER_ID,
        message: "Please reconsider this report",
        createdAt: new Date(),
        status: ReportStatus.PENDING,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
      } as any);

      const result = await service.createAppeal(REPORT_ID, USER_ID, {
        message: "Please reconsider this report",
      } as any);

      expect(result.message).toBe("Please reconsider this report");
    });

    it("stores appeal with the reporter user ID", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.appeal.create.mockResolvedValueOnce({
        id: "appeal-1",
        reportId: REPORT_ID,
        userId: USER_ID,
        message: "Appeal message",
        createdAt: new Date(),
        status: ReportStatus.PENDING,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
      } as any);

      await service.createAppeal(REPORT_ID, USER_ID, {
        message: "Appeal message",
      } as any);

      expect(mockPrisma.appeal.create).toHaveBeenCalledWith({
        data: {
          reportId: REPORT_ID,
          userId: USER_ID,
          message: "Appeal message",
        },
      });
    });
  });

  describe("assignReport", () => {
    it("assigns report to valid admin", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: ADMIN_ID,
        systemRole: SystemRole.ADMIN,
      } as any);
      mockPrisma.report.update.mockResolvedValueOnce({
        id: REPORT_ID,
        resolvedBy: ADMIN_ID,
      } as any);

      const result = await service.assignReport(REPORT_ID, ADMIN_ID);

      expect(result.resolvedBy).toBe(ADMIN_ID);
    });

    it("throws NotFoundException when admin user not found", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null as any);

      await expect(service.assignReport(REPORT_ID, "no-admin")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when assignee is not ADMIN", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        systemRole: SystemRole.USER,
      } as any);

      await expect(service.assignReport(REPORT_ID, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("checks user has ADMIN role", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: REPORT_ID } as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: ADMIN_ID,
        systemRole: SystemRole.ADMIN,
      } as any);
      mockPrisma.report.update.mockResolvedValueOnce({
        id: REPORT_ID,
        resolvedBy: ADMIN_ID,
      } as any);

      await service.assignReport(REPORT_ID, ADMIN_ID);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: ADMIN_ID },
        select: {
          id: true,
          systemRole: true,
        },
      });
    });
  });
});
