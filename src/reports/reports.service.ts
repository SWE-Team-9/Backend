import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ReportStatus, ReportTargetType, SystemRole } from "@prisma/client";
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

  private isTerminalStatus(status: ReportStatus): boolean {
    return status === ReportStatus.RESOLVED || status === ReportStatus.REJECTED;
  }

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

    const itemsQuery = this.prisma.report.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        reporter: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                displayName: true,
                handle: true,
              },
            },
          },
        },
        adminResolution: {
          select: {
            id: true,
            email: true,
            profile: { select: { displayName: true, handle: true } },
          },
        },
        _count: {
          select: { appeals: true },
        },
      },
    });
    const [total, items] = await Promise.all([this.prisma.report.count({ where }), itemsQuery]);

    const resolvedItems = await Promise.all(items.map((item) => this.resolveReportTarget(item)));

    return {
      items: resolvedItems,
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

  private async resolveReportTarget(report: {
    id: string;
    targetType: ReportTargetType;
    targetId: string;
    reason: string;
    status: string;
    description: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    resolvedBy: string | null;
    reporter: {
      id: string;
      email: string;
      profile: { displayName: string; handle: string } | null;
    } | null;
    adminResolution: {
      id: string;
      email: string;
      profile: { displayName: string; handle: string } | null;
    } | null;
    _count?: { appeals: number };
  }) {
    let targetTitle: string | null = null;
    let targetOwnerHandle: string | null = null;
    let offenderId: string | null = null;
    let offenderAccountStatus: string | null = null;

    if (report.targetType === ReportTargetType.TRACK) {
      const track = await this.prisma.track.findUnique({
        where: { id: report.targetId },
        select: {
          title: true,
          uploader: {
            select: {
              id: true,
              accountStatus: true,
              profile: { select: { handle: true } },
            },
          },
        },
      });
      targetTitle = track?.title ?? null;
      targetOwnerHandle = track?.uploader?.profile?.handle ?? null;
      offenderId = track?.uploader?.id ?? null;
      offenderAccountStatus = track?.uploader?.accountStatus ?? null;
    } else if (report.targetType === ReportTargetType.USER) {
      const user = await this.prisma.user.findUnique({
        where: { id: report.targetId },
        select: {
          id: true,
          accountStatus: true,
          profile: { select: { displayName: true, handle: true } },
        },
      });
      targetTitle = user?.profile?.displayName ?? null;
      targetOwnerHandle = user?.profile?.handle ?? null;
      offenderId = user?.id ?? null;
      offenderAccountStatus = user?.accountStatus ?? null;
    } else if (report.targetType === ReportTargetType.PLAYLIST) {
      const playlist = await this.prisma.playlist.findUnique({
        where: { id: report.targetId },
        select: {
          title: true,
          owner: {
            select: {
              id: true,
              accountStatus: true,
              profile: { select: { handle: true } },
            },
          },
        },
      });
      targetTitle = playlist?.title ?? null;
      targetOwnerHandle = playlist?.owner?.profile?.handle ?? null;
      offenderId = playlist?.owner?.id ?? null;
      offenderAccountStatus = playlist?.owner?.accountStatus ?? null;
    } else if (report.targetType === ReportTargetType.COMMENT) {
      const comment = await this.prisma.comment.findUnique({
        where: { id: report.targetId },
        select: {
          content: true,
          user: {
            select: {
              id: true,
              accountStatus: true,
              profile: { select: { handle: true } },
            },
          },
        },
      });
      targetTitle = comment?.content ? comment.content.slice(0, 80) : null;
      targetOwnerHandle = comment?.user?.profile?.handle ?? null;
      offenderId = comment?.user?.id ?? null;
      offenderAccountStatus = comment?.user?.accountStatus ?? null;
    }

    return {
      id: report.id,
      reporter: report.reporter
        ? {
            id: report.reporter.id,
            email: report.reporter.email,
            display_name: report.reporter.profile?.displayName ?? "",
            handle: report.reporter.profile?.handle ?? "",
          }
        : null,
      category: report.reason,
      target: {
        type: report.targetType,
        id: report.targetId,
        title: targetTitle,
        owner_handle: targetOwnerHandle,
      },
      offender: offenderId
        ? { id: offenderId, account_status: offenderAccountStatus }
        : null,
      status: report.status,
      description: report.description,
      created_at: report.createdAt,
      resolved_at: report.resolvedAt,
      resolved_by: report.adminResolution
        ? {
            id: report.adminResolution.id,
            display_name: report.adminResolution.profile?.displayName ?? "",
            handle: report.adminResolution.profile?.handle ?? "",
          }
        : null,
      appeals_count: report._count?.appeals ?? 0,
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
            profile: { select: { displayName: true, handle: true } },
          },
        },
        adminResolution: {
          select: {
            id: true,
            email: true,
            profile: { select: { displayName: true, handle: true } },
          },
        },
        appeals: {
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { displayName: true, handle: true } },
              },
            },
            adminResolution: {
              select: {
                id: true,
                email: true,
                profile: { select: { displayName: true, handle: true } },
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

    const resolved = await this.resolveReportTarget({
      ...report,
      _count: undefined,
    });

    return {
      ...resolved,
      appeals: report.appeals.map((appeal) => ({
        id: appeal.id,
        message: appeal.message,
        status: appeal.status,
        created_at: appeal.createdAt,
        resolved_at: appeal.resolvedAt,
        resolution_notes: appeal.resolutionNotes,
        user: appeal.user
          ? {
              id: appeal.user.id,
              email: appeal.user.email,
              display_name: appeal.user.profile?.displayName ?? "",
              handle: appeal.user.profile?.handle ?? "",
            }
          : null,
      })),
    };
  }

  async updateReport(reportId: string, adminId: string, dto: UpdateReportDto) {
    const currentReport = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { status: true },
    });

    if (!currentReport) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "Report not found.",
      });
    }

    if (dto.status && this.isTerminalStatus(currentReport.status)) {
      throw new ConflictException({
        code: "REPORT_ALREADY_HANDLED",
        message: "Report has already been resolved or rejected.",
      });
    }

    const now = new Date();
    const shouldResolve = dto.status ? this.isTerminalStatus(dto.status) : false;

    const { updatedReport, notesAppliedToAppeals } = await this.prisma.$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id: reportId },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
        },
      });

      if (!dto.resolutionNotes) {
        return { updatedReport: report, notesAppliedToAppeals: 0 };
      }

      const appealResult = await tx.appeal.updateMany({
        where: { reportId },
        data: {
          resolutionNotes: dto.resolutionNotes,
          ...(dto.status ? { status: dto.status } : {}),
          ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
        },
      });

      return { updatedReport: report, notesAppliedToAppeals: appealResult.count };
    });

    return {
      report: updatedReport,
      notesAppliedToAppeals,
    };
  }

  async bulkUpdateReports(adminId: string, dto: BulkUpdateReportsDto) {
    const handledReports = await this.prisma.report.findMany({
      where: {
        id: { in: dto.reportIds },
        status: { in: [ReportStatus.RESOLVED, ReportStatus.REJECTED] },
      },
      select: { id: true },
    });

    if ((handledReports ?? []).length > 0) {
      throw new ConflictException({
        code: "REPORT_ALREADY_HANDLED",
        message: "One or more reports have already been resolved or rejected.",
      });
    }

    const now = new Date();
    const shouldResolve = this.isTerminalStatus(dto.status);

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
              ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
            },
          })
        : this.prisma.appeal.updateMany({
            where: { reportId: { in: dto.reportIds } },
            data: {
              status: dto.status,
              ...(shouldResolve ? { resolvedAt: now, resolvedBy: adminId } : {}),
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
        status: ReportStatus.UNDER_REVIEW,
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

  private async ensureTargetExists(targetType: ReportTargetType, targetId: string): Promise<void> {
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

    if (targetType === ReportTargetType.COMMENT) {
      const comment = await this.prisma.comment.findUnique({
        where: { id: targetId },
        select: { id: true },
      });

      if (!comment) {
        throw new NotFoundException({
          code: "COMMENT_NOT_FOUND",
          message: "Comment not found.",
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
