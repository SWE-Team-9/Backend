import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  ReportStatus,
  ReportTargetType,
  SystemRole,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { BulkUpdateReportsDto } from "./dto/bulk-update-reports.dto";
import { CreateAppealDto } from "./dto/create-appeal.dto";
import { CreateReportDto } from "./dto/create-report.dto";
import { UpdateReportDto } from "./dto/update-report.dto";
import { AdminReportsQueryDto } from "./dto/admin-reports-query.dto";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createReport(reporterId: string, dto: CreateReportDto) {
    await this.ensureTargetExists(dto.targetType, dto.targetId);

    // Prevent duplicate reports from same user on same content
    const existing = await this.prisma.report.findFirst({
      where: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        status: { not: ReportStatus.REJECTED },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: "DUPLICATE_REPORT",
        message: "You have already reported this content.",
      });
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        description: dto.description,
      },
    });

    this.eventEmitter.emit("report.created", {
      reportId: report.id,
      reporterId,
      category: dto.reason,
      targetType: dto.targetType,
    });

    return report;
  }

  async createAppeal(reportId: string, userId: string, dto: CreateAppealDto) {
    await this.ensureReportExists(reportId);

    return this.prisma.appeal.create({
      data: {
        reportId,
        userId,
        message: dto.message,
      },
    });
  }

  async getReports(query: AdminReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          reporter: {
            select: {
              id: true,
              email: true,
            },
          },
          adminResolution: {
            select: {
              id: true,
              email: true,
            },
          },
          _count: {
            select: { appeals: true },
          },
        },
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: skip + items.length < total,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getReportById(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        reporter: {
          select: {
            id: true,
            email: true,
          },
        },
        adminResolution: {
          select: {
            id: true,
            email: true,
          },
        },
        appeals: {
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                email: true,
              },
            },
            adminResolution: {
              select: {
                id: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "Report not found.",
      });
    }

    return report;
  }

  async updateReport(reportId: string, adminId: string, dto: UpdateReportDto) {
    await this.ensureReportExists(reportId);

    const now = new Date();
    const shouldResolve =
      dto.status === ReportStatus.RESOLVED ||
      dto.status === ReportStatus.REJECTED;

    const updatedReport = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
      },
    });

    let notesAppliedToAppeals = 0;

    // Schema note: resolutionNotes is stored on Appeal, not Report.
    if (dto.resolutionNotes) {
      const appealResult = await this.prisma.appeal.updateMany({
        where: {
          reportId,
        },
        data: {
          resolutionNotes: dto.resolutionNotes,
          ...(dto.status ? { status: dto.status } : {}),
          ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
        },
      });

      notesAppliedToAppeals = appealResult.count;
    }

    return {
      report: updatedReport,
      notesAppliedToAppeals,
    };
  }

  async bulkUpdateReports(adminId: string, dto: BulkUpdateReportsDto) {
    const now = new Date();
    const shouldResolve =
      dto.status === ReportStatus.RESOLVED ||
      dto.status === ReportStatus.REJECTED;

    const [reportResult, appealResult] = await this.prisma.$transaction([
      this.prisma.report.updateMany({
        where: { id: { in: dto.reportIds } },
        data: {
          status: dto.status,
          ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
        },
      }),
      dto.resolutionNotes
        ? this.prisma.appeal.updateMany({
            where: { reportId: { in: dto.reportIds } },
            data: {
              resolutionNotes: dto.resolutionNotes,
              status: dto.status,
              ...(shouldResolve
                ? { resolvedAt: now, resolvedBy: adminId }
                : {}),
            },
          })
        : this.prisma.appeal.updateMany({
            where: { reportId: { in: dto.reportIds } },
            data: {
              status: dto.status,
              ...(shouldResolve
                ? { resolvedAt: now, resolvedBy: adminId }
                : {}),
            },
          }),
    ]);

    return {
      updatedReports: reportResult.count,
      updatedAppeals: appealResult.count,
    };
  }

  async assignReport(reportId: string, adminId: string) {
    await this.ensureReportExists(reportId);

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        systemRole: true,
      },
    });

    if (!admin) {
      throw new NotFoundException({
        code: "ADMIN_NOT_FOUND",
        message: "Admin user not found.",
      });
    }

    if (admin.systemRole !== SystemRole.ADMIN) {
      throw new BadRequestException({
        code: "INVALID_ASSIGNEE",
        message: "Assigned user must have ADMIN role.",
      });
    }

    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        resolvedBy: adminId,
      },
    });
  }

  private async ensureReportExists(reportId: string): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true },
    });

    if (!report) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "Report not found.",
      });
    }
  }

  private async ensureTargetExists(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<void> {
    if (targetType === ReportTargetType.TRACK) {
      const track = await this.prisma.track.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!track) {
        throw new NotFoundException({
          code: "TRACK_NOT_FOUND",
          message: "Track not found.",
        });
      }
      return;
    }

    if (targetType === ReportTargetType.USER) {
      const user = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!user) {
        throw new NotFoundException({
          code: "USER_NOT_FOUND",
          message: "User not found.",
        });
      }
      return;
    }

    if (targetType === ReportTargetType.PLAYLIST) {
      const playlist = await this.prisma.playlist.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!playlist) {
        throw new NotFoundException({
          code: "PLAYLIST_NOT_FOUND",
          message: "Playlist not found.",
        });
      }
      return;
    }

    throw new BadRequestException({
      code: "INVALID_TARGET_TYPE",
      message: "Unsupported report target type.",
    });
  }
}
