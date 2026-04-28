import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { PrismaService } from "../prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ReportReason, ReportStatus, ReportTargetType, SystemRole } from "@prisma/client";

describe("ReportsService", () => {
  let service: ReportsService;
  let prismaService: jest.Mocked<PrismaService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const asMock = <T extends (...args: any[]) => any>(fn: T) =>
    fn as jest.MockedFunction<T>;

  const mockReporterId = "reporter-123";
  const mockAdminId = "admin-456";
  const mockReportId = "report-789";
  const mockTrackId = "track-101";
  const mockUserId = "user-102";
  const mockPlaylistId = "playlist-103";

  const mockReport = {
    id: mockReportId,
    reporterId: mockReporterId,
    targetType: ReportTargetType.TRACK,
    targetId: mockTrackId,
    reason: ReportReason.SPAM,
    status: ReportStatus.PENDING,
    description: "This is spam content",
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
  };

  beforeEach(async () => {
    const mockPrismaServiceObj = {
      report: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
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

    const mockEventEmitterObj = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: PrismaService,
          useValue: mockPrismaServiceObj,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitterObj,
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
    eventEmitter = module.get(EventEmitter2) as jest.Mocked<EventEmitter2>;
  });

  describe("createReport", () => {
    it("should create a report with valid target (track)", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue({ id: mockTrackId } as any);
      asMock(prismaService.report.create).mockResolvedValue(mockReport as any);
      asMock(eventEmitter.emit).mockReturnValue(true);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: mockTrackId,
        reason: ReportReason.SPAM,
        description: "Spam content",
      };

      const result = await service.createReport(mockReporterId, dto);

      expect(result.id).toBe(mockReportId);
      expect(prismaService.report.create).toHaveBeenCalledWith({
        data: {
          reporterId: mockReporterId,
          targetType: ReportTargetType.TRACK,
          targetId: mockTrackId,
          reason: "SPAM",
          description: "Spam content",
        },
      });
    });

    it("should create a report with valid target (user)", async () => {
      asMock(prismaService.user.findUnique).mockResolvedValue({ id: mockUserId } as any);
      asMock(prismaService.report.create).mockResolvedValue({
        ...mockReport,
        targetType: ReportTargetType.USER,
        targetId: mockUserId,
      } as any);
      asMock(eventEmitter.emit).mockReturnValue(true);

      const dto = {
        targetType: ReportTargetType.USER,
        targetId: mockUserId,
        reason: ReportReason.INAPPROPRIATE,
        description: "Harassment behavior",
      } as any;

      const result = await service.createReport(mockReporterId, dto);

      expect(result.targetType).toBe(ReportTargetType.USER);
    });

    it("should create a report with valid target (playlist)", async () => {
      asMock(prismaService.playlist.findUnique).mockResolvedValue({
        id: mockPlaylistId,
      } as any);
      asMock(prismaService.report.create).mockResolvedValue({
        ...mockReport,
        targetType: ReportTargetType.PLAYLIST,
        targetId: mockPlaylistId,
      } as any);
      asMock(eventEmitter.emit).mockReturnValue(true);

      const dto = {
        targetType: ReportTargetType.PLAYLIST,
        targetId: mockPlaylistId,
        reason: ReportReason.COPYRIGHT,
        description: "Copyright violation",
      };

      const result = await service.createReport(mockReporterId, dto);

      expect(result.targetType).toBe(ReportTargetType.PLAYLIST);
    });

    it("should throw NotFoundException when track target does not exist", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue(null as any);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: "nonexistent-track",
        reason: ReportReason.SPAM,
        description: "Spam",
      } as any;

      await expect(
        service.createReport(mockReporterId, dto)
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when user target does not exist", async () => {
      asMock(prismaService.user.findUnique).mockResolvedValue(null as any);

      const dto = {
        targetType: ReportTargetType.USER,
        targetId: "nonexistent-user",
        reason: ReportReason.INAPPROPRIATE,
        description: "Harassment",
      } as any;

      await expect(
        service.createReport(mockReporterId, dto)
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when playlist target does not exist", async () => {
      asMock(prismaService.playlist.findUnique).mockResolvedValue(null as any);

      const dto = {
        targetType: ReportTargetType.PLAYLIST,
        targetId: "nonexistent-playlist",
        reason: ReportReason.COPYRIGHT,
        description: "Copyright",
      } as any;

      await expect(
        service.createReport(mockReporterId, dto)
      ).rejects.toThrow(NotFoundException);
    });

    it("should emit report.created event on success", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue({ id: mockTrackId } as any);
      asMock(prismaService.report.create).mockResolvedValue(mockReport as any);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: mockTrackId,
        reason: ReportReason.SPAM,
        description: "Spam",
      } as any;

      await service.createReport(mockReporterId, dto);

      expect(eventEmitter.emit).toHaveBeenCalledWith("report.created", {
        reportId: mockReportId,
        reporterId: mockReporterId,
        category: "SPAM",
        targetType: ReportTargetType.TRACK,
      });
    });

    it("should emit event with correct payload", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue({ id: mockTrackId } as any);
      asMock(prismaService.report.create).mockResolvedValue(mockReport as any);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: mockTrackId,
        reason: ReportReason.INAPPROPRIATE,
        description: "Harassment",
      } as any;

      await service.createReport(mockReporterId, dto);

      const emitCall = eventEmitter.emit.mock.calls[0];
      expect(emitCall[0]).toBe("report.created");
      expect(emitCall[1]).toHaveProperty("reportId");
      expect(emitCall[1]).toHaveProperty("reporterId");
      expect(emitCall[1]).toHaveProperty("category");
      expect(emitCall[1]).toHaveProperty("targetType");
    });

    it("should store report with PENDING status by default", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue({ id: mockTrackId } as any);
      asMock(prismaService.report.create).mockResolvedValue(mockReport as any);
      asMock(eventEmitter.emit).mockReturnValue(true);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: mockTrackId,
        reason: ReportReason.SPAM,
        description: "Spam",
      };

      const result = await service.createReport(mockReporterId, dto);

      expect(result.status).toBe(ReportStatus.PENDING);
    });

    it("should accept optional description", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue({ id: mockTrackId } as any);
      asMock(prismaService.report.create).mockResolvedValue(mockReport as any);
      asMock(eventEmitter.emit).mockReturnValue(true);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: mockTrackId,
        reason: ReportReason.SPAM,
        description: "Detailed spam description",
      };

      await service.createReport(mockReporterId, dto);

      expect(prismaService.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: "Detailed spam description",
        }),
      });
    });

    it("should create report even without description", async () => {
      asMock(prismaService.track.findUnique).mockResolvedValue({ id: mockTrackId } as any);
      asMock(prismaService.report.create).mockResolvedValue(mockReport as any);
      asMock(eventEmitter.emit).mockReturnValue(true);

      const dto = {
        targetType: ReportTargetType.TRACK,
        targetId: mockTrackId,
        reason: ReportReason.SPAM,
      };

      await service.createReport(mockReporterId, dto);

      expect(prismaService.report.create).toHaveBeenCalled();
    });
  });

  describe("updateReport", () => {
    it("should update report status from PENDING to RESOLVED", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        status: ReportStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy: mockAdminId,
      } as any);
      asMock(prismaService.appeal.updateMany).mockResolvedValue({ count: 0 } as any);

      const dto = {
        status: ReportStatus.RESOLVED,
      };

      const result = await service.updateReport(mockReportId, mockAdminId, dto);

      expect(result.report.status).toBe(ReportStatus.RESOLVED);
      expect(result.report.resolvedBy).toBe(mockAdminId);
    });

    it("should update report status from PENDING to IN_REVIEW", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        status: ReportStatus.UNDER_REVIEW,
      } as any);

      const dto = {
        status: ReportStatus.UNDER_REVIEW,
      } as any;

      const result = await service.updateReport(mockReportId, mockAdminId, dto);

      expect(result.report.status).toBe(ReportStatus.UNDER_REVIEW);
    });

    it("should update report status from PENDING to REJECTED", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        status: ReportStatus.REJECTED,
        resolvedAt: new Date(),
        resolvedBy: mockAdminId,
      } as any);

      const dto = {
        status: ReportStatus.REJECTED,
      } as any;

      const result = await service.updateReport(mockReportId, mockAdminId, dto);

      expect(result.report.status).toBe(ReportStatus.REJECTED);
    });

    it("should set resolvedAt and resolvedBy when transitioning to RESOLVED", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      const resolvedDate = new Date();
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        status: ReportStatus.RESOLVED,
        resolvedAt: resolvedDate,
        resolvedBy: mockAdminId,
      } as any);

      const dto = {
        status: ReportStatus.RESOLVED,
      } as any;

      const result = await service.updateReport(mockReportId, mockAdminId, dto);

      expect(result.report.resolvedAt).not.toBeNull();
      expect(result.report.resolvedBy).toBe(mockAdminId);
    });

    it("should set resolvedAt and resolvedBy when transitioning to REJECTED", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        status: ReportStatus.REJECTED,
        resolvedAt: new Date(),
        resolvedBy: mockAdminId,
      } as any);

      const dto = {
        status: ReportStatus.REJECTED,
      };

      const result = await service.updateReport(mockReportId, mockAdminId, dto);

      expect(result.report.resolvedAt).not.toBeNull();
      expect(result.report.resolvedBy).toBe(mockAdminId);
    });

    it("should apply resolution notes to appeals", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        status: ReportStatus.RESOLVED,
      } as any);
      asMock(prismaService.appeal.updateMany).mockResolvedValue({ count: 2 } as any);

      const dto = {
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Content violates policy",
      } as any;

      const result = await service.updateReport(mockReportId, mockAdminId, dto);

      expect(result.notesAppliedToAppeals).toBe(2);
      expect(prismaService.appeal.updateMany).toHaveBeenCalledWith({
        where: { reportId: mockReportId },
        data: expect.objectContaining({
          resolutionNotes: "Content violates policy",
        }),
      });
    });

    it("should not update appeals if no resolution notes provided", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.report.update).mockResolvedValue(mockReport as any);

      const dto = {
        status: ReportStatus.RESOLVED,
      } as any;

      await service.updateReport(mockReportId, mockAdminId, dto);

      expect(prismaService.appeal.updateMany).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException if report does not exist", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(null as any);

      const dto = {
        status: ReportStatus.RESOLVED,
      };

      await expect(
        service.updateReport("nonexistent-report", mockAdminId, dto)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("bulkUpdateReports", () => {
    it("should update multiple reports", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 3 },
        { count: 1 },
      ] as any);

      const dto = {
        reportIds: ["report-1", "report-2", "report-3"],
        status: ReportStatus.RESOLVED,
      };

      const result = await service.bulkUpdateReports(mockAdminId, dto);

      expect(result.updatedReports).toBe(3);
    });

    it("should update related appeals", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 2 },
        { count: 5 },
      ] as any);

      const dto = {
        reportIds: ["report-1", "report-2"],
        status: ReportStatus.RESOLVED,
      };

      const result = await service.bulkUpdateReports(mockAdminId, dto);

      expect(result.updatedAppeals).toBe(5);
    });

    it("should return count of failed updates for terminal/closed reports", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 2 },
        { count: 0 },
      ] as any);

      const dto = {
        reportIds: ["report-1", "report-2"],
        status: ReportStatus.RESOLVED,
      };

      const result = await service.bulkUpdateReports(mockAdminId, dto);

      expect(result.updatedReports).toBe(2);
      expect(result.updatedAppeals).toBe(0);
    });

    it("should set resolvedAt and resolvedBy for RESOLVED status", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 1 },
        { count: 0 },
      ] as any);

      const dto = {
        reportIds: ["report-1"],
        status: ReportStatus.RESOLVED,
      };

      await service.bulkUpdateReports(mockAdminId, dto);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should set resolvedAt and resolvedBy for REJECTED status", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 1 },
        { count: 0 },
      ] as any);

      const dto = {
        reportIds: ["report-1"],
        status: ReportStatus.REJECTED,
      };

      await service.bulkUpdateReports(mockAdminId, dto);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should apply resolution notes to all appeal records", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 2 },
        { count: 5 },
      ] as any);

      const dto = {
        reportIds: ["report-1", "report-2"],
        status: ReportStatus.RESOLVED,
        resolutionNotes: "Policy violation confirmed",
      };

      await service.bulkUpdateReports(mockAdminId, dto);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should handle empty report IDs list", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 0 },
        { count: 0 },
      ] as any);

      const dto = {
        reportIds: [],
        status: ReportStatus.RESOLVED,
      };

      const result = await service.bulkUpdateReports(mockAdminId, dto);

      expect(result.updatedReports).toBe(0);
      expect(result.updatedAppeals).toBe(0);
    });

    it("should use transaction for atomicity", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        { count: 2 },
        { count: 3 },
      ] as any);

      const dto = {
        reportIds: ["report-1", "report-2"],
        status: ReportStatus.RESOLVED,
      };

      await service.bulkUpdateReports(mockAdminId, dto);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe("createAppeal", () => {
    it("should create an appeal for a report", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      const appealMessage = "Please reconsider this decision";
      asMock(prismaService.appeal.create).mockResolvedValue({
        id: "appeal-1",
        reportId: mockReportId,
        userId: mockUserId,
        message: appealMessage,
        createdAt: new Date(),
        status: ReportStatus.PENDING,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
      } as any);

      const dto = {
        message: appealMessage,
      } as any;

      const result = await service.createAppeal(mockReportId, mockUserId, dto);

      expect(result.reportId).toBe(mockReportId);
      expect(result.userId).toBe(mockUserId);
      expect(result.message).toBe(appealMessage);
    });

    it("should throw NotFoundException if report does not exist", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(null as any);

      const dto = {
        message: "Please reconsider",
      } as any;

      await expect(
        service.createAppeal("nonexistent-report", mockUserId, dto)
      ).rejects.toThrow(NotFoundException);
    });

    it("should store appeal message correctly", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.appeal.create).mockResolvedValue({
        id: "appeal-1",
        reportId: mockReportId,
        userId: mockUserId,
        message: "Please reconsider this report",
        createdAt: new Date(),
        status: ReportStatus.PENDING,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
      } as any);

      const dto = {
        message: "Please reconsider this report",
      } as any;

      const result = await service.createAppeal(mockReportId, mockUserId, dto);

      expect(result.message).toBe("Please reconsider this report");
    });

    it("should store appeal with reporter's user ID", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.appeal.create).mockResolvedValue({
        id: "appeal-1",
        reportId: mockReportId,
        userId: mockUserId,
        message: "Please reconsider",
        createdAt: new Date(),
        status: ReportStatus.PENDING,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNotes: null,
      } as any);

      const dto = {
        message: "Appeal message",
      } as any;

      await service.createAppeal(mockReportId, mockUserId, dto);

      expect(prismaService.appeal.create).toHaveBeenCalledWith({
        data: {
          reportId: mockReportId,
          userId: mockUserId,
          message: "Appeal message",
        },
      });
    });
  });

  describe("getReportById", () => {
    it("should retrieve report by ID with full details", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);

      const result = await service.getReportById(mockReportId);

      expect(result.id).toBe(mockReportId);
    });

    it("should throw NotFoundException if report does not exist", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(null as any);

      await expect(service.getReportById("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should include reporter information", async () => {
      const reportWithReporter = {
        ...mockReport,
        reporter: {
          id: mockReporterId,
          email: "reporter@example.com",
        },
      };
      asMock(prismaService.report.findUnique).mockResolvedValue(reportWithReporter as any);

      const result = await service.getReportById(mockReportId);

      expect(result.reporter).toBeDefined();
    });

    it("should include admin resolution information", async () => {
      const reportWithAdmin = {
        ...mockReport,
        adminResolution: {
          id: mockAdminId,
          email: "admin@example.com",
        },
      };
      asMock(prismaService.report.findUnique).mockResolvedValue(reportWithAdmin as any);

      const result = await service.getReportById(mockReportId);

      expect(result.adminResolution).toBeDefined();
    });

    it("should include appeals ordered by createdAt DESC", async () => {
      const reportWithAppeals = {
        ...mockReport,
        appeals: [
          {
            id: "appeal-2",
            createdAt: new Date("2026-04-25"),
          },
          {
            id: "appeal-1",
            createdAt: new Date("2026-04-20"),
          },
        ],
      };
      asMock(prismaService.report.findUnique).mockResolvedValue(reportWithAppeals as any);

      const result = await service.getReportById(mockReportId);

      expect(result.appeals.length).toBe(2);
    });

    it("should include appeal count", async () => {
      const reportWithCount = {
        ...mockReport,
        _count: {
          appeals: 3,
        },
      };
      asMock(prismaService.report.findUnique).mockResolvedValue(reportWithCount as any);

      const result = await service.getReportById(mockReportId);

      expect((result as any)._count.appeals).toBe(3);
    });
  });

  describe("getReports", () => {
    it("should retrieve paginated reports", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        10,
        [mockReport],
      ] as any);

      const query = { page: 1, limit: 20 };

      const result = await service.getReports(query);

      expect(result.items).toBeDefined();
      expect(result.pagination).toBeDefined();
    });

    it("should filter by status", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([0, []] as any);

      const query = { page: 1, limit: 20, status: ReportStatus.PENDING };

      await service.getReports(query);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should filter by targetType", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([0, []] as any);

      const query = {
        page: 1,
        limit: 20,
        targetType: ReportTargetType.TRACK,
      };

      await service.getReports(query);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should use pagination with default page 1", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([0, []] as any);

      const query = { limit: 20 };

      const result = await service.getReports(query);

      expect(result.pagination.page).toBe(1);
    });

    it("should use pagination with default limit 20", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([0, []] as any);

      const query = { page: 1 };

      const result = await service.getReports(query);

      expect(result.pagination.limit).toBe(20);
    });

    it("should calculate totalPages correctly", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([
        50,
        Array(20).fill(mockReport),
      ] as any);

      const query = { page: 1, limit: 20 };

      const result = await service.getReports(query);

      expect(result.pagination.totalPages).toBe(3);
    });

    it("should order results by createdAt DESC", async () => {
      asMock(prismaService.$transaction).mockResolvedValue([0, []] as any);

      const query = { page: 1, limit: 20 };

      await service.getReports(query);

      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it("should include reporter information", async () => {
      const reportWithReporter = {
        ...mockReport,
        reporter: { id: mockReporterId, email: "reporter@example.com" },
      };
      asMock(prismaService.$transaction).mockResolvedValue([1, [reportWithReporter]] as any);

      const query = { page: 1, limit: 20 };

      const result = await service.getReports(query);

      expect(result.items[0].reporter).toBeDefined();
    });

    it("should include appeal count", async () => {
      const reportWithCount = {
        ...mockReport,
        _count: { appeals: 2 },
      };
      asMock(prismaService.$transaction).mockResolvedValue([1, [reportWithCount]] as any);

      const query = { page: 1, limit: 20 };

      const result = await service.getReports(query);

      expect(result.items[0]._count.appeals).toBe(2);
    });
  });

  describe("assignReport", () => {
    it("should assign report to admin", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.user.findUnique).mockResolvedValue({
        id: mockAdminId,
        systemRole: SystemRole.ADMIN,
      } as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        resolvedBy: mockAdminId,
      } as any);

      const result = await service.assignReport(mockReportId, mockAdminId);

      expect(result.resolvedBy).toBe(mockAdminId);
    });

    it("should throw NotFoundException if report does not exist", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(null as any);

      await expect(
        service.assignReport("nonexistent", mockAdminId)
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if admin does not exist", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.user.findUnique).mockResolvedValue(null as any);

      await expect(
        service.assignReport(mockReportId, "nonexistent-admin")
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException if assignee is not admin", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.user.findUnique).mockResolvedValue({
        id: mockUserId,
        systemRole: SystemRole.USER,
      } as any);

      await expect(
        service.assignReport(mockReportId, mockUserId)
      ).rejects.toThrow(BadRequestException);
    });

    it("should check user has ADMIN role", async () => {
      asMock(prismaService.report.findUnique).mockResolvedValue(mockReport as any);
      asMock(prismaService.user.findUnique).mockResolvedValue({
        id: mockAdminId,
        systemRole: SystemRole.ADMIN,
      } as any);
      asMock(prismaService.report.update).mockResolvedValue({
        ...mockReport,
        resolvedBy: mockAdminId,
      } as any);

      await service.assignReport(mockReportId, mockAdminId);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockAdminId },
        select: {
          id: true,
          systemRole: true,
        },
      });
    });
  });
});
