import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AdminUsersQueryDto,
  AuditLogQueryDto,
  DailyStatsQueryDto,
  MostReportedQueryDto,
} from "./dto/admin-users.dto";

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Get all users ───────────────────────────────────────────────────────────

  async getUsers(query: AdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { accountStatus: query.status } : {}),
      ...(query.role ? { systemRole: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: "insensitive" } },
              { profile: { displayName: { contains: query.search, mode: "insensitive" } } },
              { profile: { handle: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const orderByField = query.sortBy ?? "created_at";
    const orderDir = query.sortOrder ?? "desc";
    let orderBy: Prisma.UserOrderByWithRelationInput;
    if (orderByField === "display_name") {
      orderBy = { profile: { displayName: orderDir } };
    } else if (orderByField === "last_login_at") {
      orderBy = { lastLoginAt: orderDir };
    } else {
      orderBy = { createdAt: orderDir };
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          systemRole: true,
          accountStatus: true,
          isVerified: true,
          lastLoginAt: true,
          createdAt: true,
          profile: {
            select: {
              displayName: true,
              handle: true,
              avatarUrl: true,
              accountType: true,
            },
          },
          _count: {
            select: {
              tracks: true,
              submittedReports: true,
            },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.profile?.displayName ?? null,
        handle: u.profile?.handle ?? null,
        avatar_url: u.profile?.avatarUrl ?? null,
        account_type: u.profile?.accountType ?? null,
        system_role: u.systemRole,
        account_status: u.accountStatus,
        is_verified: u.isVerified,
        track_count: u._count.tracks,
        report_count: u._count.submittedReports,
        last_login_at: u.lastLoginAt,
        created_at: u.createdAt,
      })),
    };
  }

  // ─── Get user detail ─────────────────────────────────────────────────────────

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        systemRole: true,
        accountStatus: true,
        isVerified: true,
        suspendedUntil: true,
        lastLoginAt: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            handle: true,
            avatarUrl: true,
            accountType: true,
          },
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            plan: { select: { tier: true } },
            status: true,
            currentPeriodEnd: true,
          },
        },
        _count: {
          select: {
            tracks: true,
            playlists: true,
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user || user.accountStatus === "DELETED") {
      throw new NotFoundException({ code: "USER_NOT_FOUND", message: "User not found." });
    }

    const [moderationHistory, reportsAgainst, reportsSubmitted] = await Promise.all([
      this.prisma.moderationAction.findMany({
        where: { targetUserId: userId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          actionType: true,
          notes: true,
          createdAt: true,
          admin: { select: { profile: { select: { handle: true } } } },
        },
      }),
      this.prisma.moderationReport.aggregate({
        where: { reportedUserId: userId },
        _count: { id: true },
      }),
      this.prisma.moderationReport.aggregate({
        where: { reporterId: userId },
        _count: { id: true },
      }),
    ]);

    const pendingAgainst = await this.prisma.moderationReport.count({
      where: { reportedUserId: userId, status: "PENDING" },
    });
    const resolvedAgainst = await this.prisma.moderationReport.count({
      where: { reportedUserId: userId, status: "RESOLVED" },
    });

    const latestSub = user.subscriptions[0];

    return {
      id: user.id,
      email: user.email,
      display_name: user.profile?.displayName ?? null,
      handle: user.profile?.handle ?? null,
      avatar_url: user.profile?.avatarUrl ?? null,
      account_type: user.profile?.accountType ?? null,
      system_role: user.systemRole,
      account_status: user.accountStatus,
      is_verified: user.isVerified,
      suspended_until: user.suspendedUntil,
      last_login_at: user.lastLoginAt,
      created_at: user.createdAt,
      stats: {
        tracks_uploaded: user._count.tracks,
        playlists_created: user._count.playlists,
        followers_count: user._count.followers,
        following_count: user._count.following,
      },
      subscription: latestSub
        ? {
            tier: latestSub.plan.tier,
            status: latestSub.status,
            current_period_end: latestSub.currentPeriodEnd,
          }
        : null,
      moderation_history: moderationHistory.map((a) => ({
        id: a.id,
        action_type: a.actionType,
        admin_handle: a.admin.profile?.handle ?? null,
        notes: a.notes,
        created_at: a.createdAt,
      })),
      reports_against: {
        total: reportsAgainst._count.id,
        pending: pendingAgainst,
        resolved: resolvedAgainst,
      },
      reports_submitted: {
        total: reportsSubmitted._count.id,
        pending: 0,
        resolved: 0,
      },
    };
  }

  // ─── Audit log ───────────────────────────────────────────────────────────────

  async getAuditLog(query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ModerationActionWhereInput = {
      ...(query.actionType ? { actionType: query.actionType as Prisma.EnumModerationActionTypeFilter } : {}),
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.targetUserId ? { targetUserId: query.targetUserId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [total, actions] = await Promise.all([
      this.prisma.moderationAction.count({ where }),
      this.prisma.moderationAction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          actionType: true,
          notes: true,
          createdAt: true,
          reportId: true,
          admin: {
            select: {
              id: true,
              profile: { select: { displayName: true, handle: true } },
            },
          },
          targetUser: {
            select: {
              id: true,
              profile: { select: { displayName: true, handle: true } },
            },
          },
          track: { select: { id: true, title: true } },
          comment: { select: { id: true } },
          playlist: { select: { id: true, title: true } },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      actions: actions.map((a) => ({
        id: a.id,
        action_type: a.actionType,
        admin: {
          id: a.admin.id,
          display_name: a.admin.profile?.displayName ?? null,
          handle: a.admin.profile?.handle ?? null,
        },
        target_user: a.targetUser
          ? {
              id: a.targetUser.id,
              display_name: a.targetUser.profile?.displayName ?? null,
              handle: a.targetUser.profile?.handle ?? null,
            }
          : null,
        target_track: a.track ? { id: a.track.id, title: a.track.title } : null,
        target_comment: a.comment ? { id: a.comment.id } : null,
        target_playlist: a.playlist ? { id: a.playlist.id, title: a.playlist.title } : null,
        linked_report_id: a.reportId,
        notes: a.notes,
        created_at: a.createdAt,
      })),
    };
  }

  // ─── Overview stats ──────────────────────────────────────────────────────────

  async getOverviewStats() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      bannedUsers,
      verifiedUsers,
      totalTracks,
      visibleTracks,
      hiddenTracks,
      removedTracks,
      totalPlaylists,
      totalComments,
      totalLikes,
      totalReposts,
      reportsPending,
      reportsInReview,
      reportsResolvedThisWeek,
      actionsThisWeek,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { accountStatus: "ACTIVE", deletedAt: null } }),
      this.prisma.user.count({ where: { accountStatus: "SUSPENDED" } }),
      this.prisma.user.count({ where: { accountStatus: "BANNED" } }),
      this.prisma.user.count({ where: { isVerified: true, deletedAt: null } }),
      this.prisma.track.count({ where: { deletedAt: null } }),
      this.prisma.track.count({ where: { moderationState: "VISIBLE", deletedAt: null } }),
      this.prisma.track.count({ where: { moderationState: "HIDDEN" } }),
      this.prisma.track.count({ where: { moderationState: "REMOVED" } }),
      this.prisma.playlist.count({ where: { deletedAt: null } }),
      this.prisma.comment.count(),
      this.prisma.like.count(),
      this.prisma.repost.count(),
      this.prisma.moderationReport.count({ where: { status: "PENDING" } }),
      this.prisma.moderationReport.count({ where: { status: "UNDER_REVIEW" } }),
      this.prisma.moderationReport.count({ where: { status: "RESOLVED", resolvedAt: { gte: weekAgo } } }),
      this.prisma.moderationAction.count({ where: { createdAt: { gte: weekAgo } } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        banned: bannedUsers,
        verified: verifiedUsers,
        unverified: totalUsers - verifiedUsers,
      },
      content: {
        total_tracks: totalTracks,
        tracks_visible: visibleTracks,
        tracks_hidden: hiddenTracks,
        tracks_removed: removedTracks,
        total_playlists: totalPlaylists,
        total_comments: totalComments,
      },
      engagement: {
        total_likes: totalLikes,
        total_reposts: totalReposts,
      },
      moderation: {
        reports_pending: reportsPending,
        reports_in_review: reportsInReview,
        reports_resolved_this_week: reportsResolvedThisWeek,
        actions_taken_this_week: actionsThisWeek,
      },
    };
  }

  // ─── Daily stats ─────────────────────────────────────────────────────────────

  async getDailyStats(query: DailyStatsQueryDto) {
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();

    const metrics = await this.prisma.dailyPlatformMetric.findMany({
      where: {
        metricDate: { gte: dateFrom, lte: dateTo },
      },
      orderBy: { metricDate: "desc" },
    });

    return {
      date_from: dateFrom.toISOString().split("T")[0],
      date_to: dateTo.toISOString().split("T")[0],
      granularity: query.granularity ?? "daily",
      metrics: metrics.map((m) => ({
        date: m.metricDate.toISOString().split("T")[0],
        new_users: m.newUsers,
        tracks_uploaded: m.tracksUploaded,
        total_storage_bytes: m.totalStorageBytes,
        active_subscribers: m.activeSubscribers,
      })),
    };
  }

  // ─── Most reported ───────────────────────────────────────────────────────────

  async getMostReported(query: MostReportedQueryDto) {
    const period = query.period ?? "last_30_days";
    const limit = query.limit ?? 10;

    const since = this.periodToDate(period);
    const dateFilter = since ? { createdAt: { gte: since } } : {};

    const [userReports, trackReports, playlistReports] = await Promise.all([
      this.prisma.moderationReport.groupBy({
        by: ["reportedUserId"],
        where: { ...dateFilter, reportedUserId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: limit,
      }),
      this.prisma.moderationReport.groupBy({
        by: ["trackId"],
        where: { ...dateFilter, trackId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: limit,
      }),
      this.prisma.moderationReport.groupBy({
        by: ["playlistId"],
        where: { ...dateFilter, playlistId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: limit,
      }),
    ]);

    return {
      period,
      most_reported_users: userReports.map((r) => ({
        user_id: r.reportedUserId,
        report_count: r._count.id,
      })),
      most_reported_tracks: trackReports.map((r) => ({
        track_id: r.trackId,
        report_count: r._count.id,
      })),
      most_reported_playlists: playlistReports.map((r) => ({
        playlist_id: r.playlistId,
        report_count: r._count.id,
      })),
    };
  }

  private periodToDate(period: string): Date | null {
    const now = new Date();
    switch (period) {
      case "last_7_days":
        return new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      case "last_30_days":
        return new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      case "last_90_days":
        return new Date(now.getTime() - 90 * 24 * 3600 * 1000);
      default:
        return null;
    }
  }
}
