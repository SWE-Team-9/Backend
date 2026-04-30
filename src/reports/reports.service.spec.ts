import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ReportStatus, ReportTargetType } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ReportsService } from "./reports.service";
import { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
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
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  track: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  playlist: { findUnique: jest.fn() },
  comment: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const REPORTER_ID = "reporter-uuid";

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

  // ─── createReport ─────────────────────────────────────────────────────────────

  describe("createReport", () => {
    it("throws NotFoundException when target track does not exist", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.TRACK,
          targetId: "no-track",
          reason: "SPAM",
          description: "spam content",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when target user does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.USER,
          targetId: "no-user",
          reason: "INAPPROPRIATE",
          description: "harassment",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when target playlist does not exist", async () => {
      mockPrisma.playlist.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.PLAYLIST,
          targetId: "no-playlist",
          reason: "SPAM",
          description: "test",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when target comment does not exist", async () => {
      mockPrisma.comment.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.COMMENT,
          targetId: "no-comment",
          reason: "SPAM",
          description: "test",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("creates report for a COMMENT target", async () => {
      mockPrisma.comment.findUnique.mockResolvedValueOnce({ id: "comment-1" });
      mockPrisma.report.findFirst.mockResolvedValueOnce(null);
      const mockReport = {
        id: "report-comment-1",
        reporterId: REPORTER_ID,
        targetType: ReportTargetType.COMMENT,
        targetId: "comment-1",
        reason: "INAPPROPRIATE",
        status: ReportStatus.PENDING,
        createdAt: new Date(),
      };
      mockPrisma.report.create.mockResolvedValueOnce(mockReport);

      const result = await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.COMMENT,
        targetId: "comment-1",
        reason: "INAPPROPRIATE",
        description: "offensive comment",
      });

      expect(result.targetType).toBe(ReportTargetType.COMMENT);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "report.created",
        expect.objectContaining({ targetType: ReportTargetType.COMMENT }),
      );
    });

    it("throws BadRequestException for truly invalid target type", async () => {
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: "UNKNOWN_TYPE" as ReportTargetType,
          targetId: "some-id",
          reason: "SPAM",
          description: "test",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ConflictException on duplicate report from same user", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: "track-1" });
      mockPrisma.report.findFirst.mockResolvedValueOnce({ id: "existing" });
      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.TRACK,
          targetId: "track-1",
          reason: "SPAM",
          description: "duplicate",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("creates report and emits event on success", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: "track-1" });
      mockPrisma.report.findFirst.mockResolvedValueOnce(null);
      const mockReport = {
        id: "report-1",
        reporterId: REPORTER_ID,
        targetType: ReportTargetType.TRACK,
        targetId: "track-1",
        reason: "SPAM",
        status: ReportStatus.PENDING,
        createdAt: new Date(),
      };
      mockPrisma.report.create.mockResolvedValueOnce(mockReport);

      const result = await service.createReport(REPORTER_ID, {
        targetType: ReportTargetType.TRACK,
        targetId: "track-1",
        reason: "SPAM",
        description: "spam content",
      });

      expect(result).toEqual(mockReport);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "report.created",
        expect.objectContaining({ reportId: "report-1" }),
      );
    });

    it("allows re-reporting the same content after previous report was REJECTED", async () => {
      mockPrisma.track.findUnique.mockResolvedValueOnce({ id: "track-1" });
      // findFirst returns null (no non-rejected existing report)
      mockPrisma.report.findFirst.mockResolvedValueOnce(null);
      const mockReport = { id: "r2", createdAt: new Date() };
      mockPrisma.report.create.mockResolvedValueOnce(mockReport);

      await expect(
        service.createReport(REPORTER_ID, {
          targetType: ReportTargetType.TRACK,
          targetId: "track-1",
          reason: "SPAM",
          description: "new report after rejection",
        }),
      ).resolves.toBeDefined();
    });
  });

  // ─── getReportById ────────────────────────────────────────────────────────────

  describe("getReportById", () => {
    it("throws NotFoundException when report does not exist", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce(null);
      await expect(service.getReportById("no-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns report with appeals and resolved target info", async () => {
      const mockReport = {
        id: "r1",
        targetType: ReportTargetType.TRACK,
        targetId: "track-1",
        reason: "SPAM",
        status: ReportStatus.PENDING,
        description: "test",
        createdAt: new Date(),
        resolvedAt: null,
        resolvedBy: null,
        reporter: {
          id: "u1",
          email: "a@b.com",
          profile: { displayName: "Alice", handle: "alice" },
        },
        adminResolution: null,
        appeals: [],
      };
      mockPrisma.report.findUnique.mockResolvedValueOnce(mockReport);
      mockPrisma.track.findUnique.mockResolvedValueOnce({
        title: "Night Drive",
        uploader: { profile: { handle: "artist1" } },
      });
      const result = await service.getReportById("r1");
      expect(result.id).toBe("r1");
      expect(result.reporter?.display_name).toBe("Alice");
      expect(result.category).toBe("SPAM");
      expect(result.target.title).toBe("Night Drive");
    });
  });

  // ─── updateReport ─────────────────────────────────────────────────────────────

  describe("updateReport", () => {
    it("throws NotFoundException when report not found", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateReport("no-id", "admin-1", {
          status: ReportStatus.RESOLVED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("sets resolvedAt and resolvedBy when status is RESOLVED", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: "r1" });
      const updatedReport = {
        id: "r1",
        status: "RESOLVED",
        resolvedAt: new Date(),
      };
      mockPrisma.report.update.mockResolvedValueOnce(updatedReport);
      mockPrisma.appeal.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.updateReport("r1", "admin-1", {
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Action taken.",
      });

      expect(mockPrisma.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resolvedBy: "admin-1" }),
        }),
      );
      expect(result.report.status).toBe("RESOLVED");
    });
  });

  // ─── assignReport ─────────────────────────────────────────────────────────────

  describe("assignReport", () => {
    it("throws NotFoundException when admin user not found", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: "r1" });
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.assignReport("r1", "no-admin")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when assignee is not ADMIN", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: "r1" });
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "u1",
        systemRole: "USER",
      });
      await expect(service.assignReport("r1", "u1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("assigns report to valid admin", async () => {
      mockPrisma.report.findUnique.mockResolvedValueOnce({ id: "r1" });
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "admin-1",
        systemRole: "ADMIN",
      });
      mockPrisma.report.update.mockResolvedValueOnce({
        id: "r1",
        resolvedBy: "admin-1",
      });

      const result = await service.assignReport("r1", "admin-1");
      expect(result.resolvedBy).toBe("admin-1");
    });
  });

  // ─── bulkUpdateReports ────────────────────────────────────────────────────────

  describe("bulkUpdateReports", () => {
    it("updates multiple reports in a transaction", async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([
        { count: 3 },
        { count: 2 },
      ]);

      const result = await service.bulkUpdateReports("admin-1", {
        reportIds: ["r1", "r2", "r3"],
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Batch resolved",
      });

      expect(result.updatedReports).toBe(3);
      expect(result.updatedAppeals).toBe(2);
    });
  });
});
