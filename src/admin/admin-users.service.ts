import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ReportStatus, ReportTargetType } from "@prisma/client";
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

  private readonly DAY_MS = 24 * 60 * 60 * 1000;

  private formatStorageBytes(totalBytes: number) {
    return {
      totalBytes,
      totalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      totalGB: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2)),
      source: "track_files.file_size_bytes",
    };
  }

  private startOfDayUtc(input: Date): Date {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }

  private dateKey(input: Date): string {
    return input.toISOString().split("T")[0];
  }

  private addDaysUtc(input: Date, days: number): Date {
    return new Date(input.getTime() + days * this.DAY_MS);
  }

  private monthStartUtc(input: Date): Date {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1));
  }

  private nextMonthUtc(input: Date): Date {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + 1, 1));
  }

  private getBucketKey(
    date: Date,
    granularity: "daily" | "weekly" | "monthly",
    dateFrom: Date,
  ): string {
    const normalized = this.startOfDayUtc(date);

    if (granularity === "daily") {
      return this.dateKey(normalized);
    }

    if (granularity === "weekly") {
      const start = this.startOfDayUtc(dateFrom);
      const diffDays = Math.floor((normalized.getTime() - start.getTime()) / this.DAY_MS);
      const bucketIndex = Math.max(0, Math.floor(diffDays / 7));
      return this.dateKey(this.addDaysUtc(start, bucketIndex * 7));
    }

    return this.dateKey(this.monthStartUtc(normalized));
  }

  private buildMetricBuckets(
    dateFrom: Date,
    dateTo: Date,
    granularity: "daily" | "weekly" | "monthly",
  ) {
    const buckets = new Map<
      string,
      {
        date: string;
        new_users: number;
        tracks_uploaded: number;
        total_storage_bytes: number;
        active_subscribers: number;
      }
    >();

    const from = this.startOfDayUtc(dateFrom);
    const to = this.startOfDayUtc(dateTo);

    if (granularity === "daily") {
      for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = this.addDaysUtc(cursor, 1)) {
        const key = this.dateKey(cursor);
        buckets.set(key, {
          date: key,
          new_users: 0,
          tracks_uploaded: 0,
          total_storage_bytes: 0,
          active_subscribers: 0,
        });
      }
      return buckets;
    }

    if (granularity === "weekly") {
      for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = this.addDaysUtc(cursor, 7)) {
        const key = this.dateKey(cursor);
        buckets.set(key, {
          date: key,
          new_users: 0,
          tracks_uploaded: 0,
          total_storage_bytes: 0,
          active_subscribers: 0,
        });
      }
      return buckets;
    }

    for (
      let cursor = this.monthStartUtc(from);
      cursor.getTime() <= to.getTime();
      cursor = this.nextMonthUtc(cursor)
    ) {
      const key = this.dateKey(cursor);
      buckets.set(key, {
        date: key,
        new_users: 0,
        tracks_uploaded: 0,
        total_storage_bytes: 0,
        active_subscribers: 0,
      });
    }

    return buckets;
  }

  private async buildReportCountMap(userIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const userId of userIds) counts.set(userId, 0);
    if (userIds.length === 0) return counts;

    const [tracks, playlists, comments] = await Promise.all([
      this.prisma.track.findMany({
        where: { uploaderId: { in: userIds } },
        select: { id: true, uploaderId: true },
      }),
      this.prisma.playlist.findMany({
        where: { ownerId: { in: userIds } },
        select: { id: true, ownerId: true },
      }),
      this.prisma.comment.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true },
      }),
    ]);

    const trackOwnerById = new Map(tracks.map((t) => [t.id, t.uploaderId]));
    const playlistOwnerById = new Map(playlists.map((p) => [p.id, p.ownerId]));
    const commentOwnerById = new Map(comments.map((c) => [c.id, c.userId]));

    const orFilters: Prisma.ReportWhereInput[] = [];
    if (userIds.length > 0) {
      orFilters.push({
        targetType: ReportTargetType.USER,
        targetId: { in: userIds },
      });
    }
    if (tracks.length > 0) {
      orFilters.push({
        targetType: ReportTargetType.TRACK,
        targetId: { in: tracks.map((t) => t.id) },
      });
    }
    if (playlists.length > 0) {
      orFilters.push({
        targetType: ReportTargetType.PLAYLIST,
        targetId: { in: playlists.map((p) => p.id) },
      });
    }
    if (comments.length > 0) {
      orFilters.push({
        targetType: ReportTargetType.COMMENT,
        targetId: { in: comments.map((c) => c.id) },
      });
    }

    if (orFilters.length === 0) return counts;

    const reports = await this.prisma.report.findMany({
      where: {
        status: { not: ReportStatus.REJECTED },
        OR: orFilters,
      },
      select: {
        targetType: true,
        targetId: true,
      },
    });

    for (const report of reports) {
      let ownerId: string | undefined;

      if (report.targetType === ReportTargetType.USER) {
        ownerId = report.targetId;
      } else if (report.targetType === ReportTargetType.TRACK) {
        ownerId = trackOwnerById.get(report.targetId);
      } else if (report.targetType === ReportTargetType.PLAYLIST) {
        ownerId = playlistOwnerById.get(report.targetId);
      } else if (report.targetType === ReportTargetType.COMMENT) {
        ownerId = commentOwnerById.get(report.targetId);
      }

      if (ownerId && counts.has(ownerId)) {
        counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
      }
    }

    return counts;
  }

  // ─── In-memory TTL cache (5-minute TTL for expensive stat queries) ─────────────────

  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private cache = new Map<string, { data: unknown; expiresAt: number }>();

  private async getCached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data as T;
    }
    const data = await fn();
    this.cache.set(key, { data, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return data;
  }

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
              {
                profile: {
                  displayName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                profile: {
                  handle: { contains: query.search, mode: "insensitive" },
                },
              },
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
              // Count non-deleted tracks only
              tracks: { where: { deletedAt: null } },
              reportedIn: true,
            },
          },
        },
      }),
    ]);

    const reportCounts = await this.buildReportCountMap(users.map((u) => u.id));

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
        report_count: (reportCounts.get(u.id) ?? 0) + u._count.reportedIn,
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
            // Count non-deleted tracks only
            tracks: { where: { deletedAt: null } },
            // Count non-deleted playlists only
            playlists: { where: { deletedAt: null } },
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user || user.accountStatus === "DELETED") {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "User not found.",
      });
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
      ...(query.actionType
        ? {
            actionType: query.actionType as Prisma.EnumModerationActionTypeFilter,
          }
        : {}),
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

  async getTotalStorage() {
    const storageAggregate = await this.prisma.trackFile.aggregate({
      _sum: { fileSizeBytes: true },
    });

    return this.formatStorageBytes(Number(storageAggregate._sum.fileSizeBytes ?? BigInt(0)));
  }

  async getOverviewStats() {
    return this.getCached("overview_stats", async () => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        activeUsers,
        suspendedUsers,
        bannedUsers,
        verifiedUsers,
        artistCount,
        listenerCount,
        totalTracks,
        visibleTracks,
        hiddenTracks,
        removedTracks,
        totalPlaylists,
        totalComments,
        totalLikes,
        totalReposts,
        totalPlayEvents,
        completedPlayEvents,
        activeSubscriptions,
        storageAggregate,
        reportsPending,
        reportsInReview,
        reportsResolvedThisWeek,
        actionsThisWeek,
      ] = await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({
          where: { accountStatus: "ACTIVE", deletedAt: null },
        }),
        this.prisma.user.count({ where: { accountStatus: "SUSPENDED" } }),
        this.prisma.user.count({ where: { accountStatus: "BANNED" } }),
        this.prisma.user.count({
          where: { isVerified: true, deletedAt: null },
        }),
        // Artist vs Listener breakdown (from UserProfile.accountType)
        this.prisma.userProfile.count({ where: { accountType: "ARTIST" } }),
        this.prisma.userProfile.count({ where: { accountType: "LISTENER" } }),
        this.prisma.track.count({ where: { deletedAt: null } }),
        this.prisma.track.count({
          where: { moderationState: "VISIBLE", deletedAt: null },
        }),
        this.prisma.track.count({ where: { moderationState: "HIDDEN" } }),
        this.prisma.track.count({ where: { moderationState: "REMOVED" } }),
        this.prisma.playlist.count({ where: { deletedAt: null } }),
        this.prisma.comment.count(),
        this.prisma.like.count(),
        this.prisma.repost.count(),
        this.prisma.playEvent.count(),
        // Completed plays: completionRatio >= 0.90 (listened >= 90% of track)
        this.prisma.playEvent.count({
          where: { completionRatio: { gte: 0.9 } },
        }),
        this.prisma.userSubscription.count({ where: { status: "ACTIVE" } }),
        this.prisma.trackFile.aggregate({ _sum: { fileSizeBytes: true } }),
        this.prisma.report.count({ where: { status: "PENDING" } }),
        this.prisma.report.count({
          where: { status: "UNDER_REVIEW" },
        }),
        this.prisma.report.count({
          where: { status: "RESOLVED", resolvedAt: { gte: weekAgo } },
        }),
        this.prisma.moderationAction.count({
          where: { createdAt: { gte: weekAgo } },
        }),
      ]);

      const totalStorageBytes = this.formatStorageBytes(
        Number(storageAggregate._sum.fileSizeBytes ?? BigInt(0)),
      ).totalBytes;

      // Play Through Rate = (completedPlays / totalPlays) × 100
      // A completed play is one where completionRatio >= 0.90
      const playThroughRate =
        totalPlayEvents > 0
          ? Number(((completedPlayEvents / totalPlayEvents) * 100).toFixed(2))
          : 0;

      // Artist-to-Listener ratio: how many artists per listener (e.g. 0.25 = 1 artist per 4 listeners)
      const artistToListenerRatio =
        listenerCount > 0
          ? Number((artistCount / listenerCount).toFixed(4))
          : artistCount > 0
            ? null // all artists, no listeners
            : 0;

      return {
        users: {
          total: totalUsers,
          active: activeUsers,
          suspended: suspendedUsers,
          banned: bannedUsers,
          verified: verifiedUsers,
          unverified: totalUsers - verifiedUsers,
          artists: artistCount,
          listeners: listenerCount,
          artist_to_listener_ratio: artistToListenerRatio,
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
          total_play_events: totalPlayEvents,
          completed_play_events: completedPlayEvents,
          play_through_rate_pct: playThroughRate,
          total_likes: totalLikes,
          total_reposts: totalReposts,
        },
        billing: {
          active_subscriptions: activeSubscriptions,
          total_storage_bytes: totalStorageBytes,
        },
        moderation: {
          reports_pending: reportsPending,
          reports_in_review: reportsInReview,
          reports_resolved_this_week: reportsResolvedThisWeek,
          actions_taken_this_week: actionsThisWeek,
        },
      };
    });
  }

  // ─── Daily stats ─────────────────────────────────────────────────────────────

  async getDailyStats(query: DailyStatsQueryDto) {
    const dateFrom = query.dateFrom
      ? new Date(query.dateFrom)
      : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();

    const cacheKey = `daily_stats:${dateFrom.toISOString()}:${dateTo.toISOString()}:${query.granularity ?? "daily"}`;

    return this.getCached(cacheKey, async () => {
      const granularity = query.granularity ?? "daily";

      const metrics = await this.prisma.dailyPlatformMetric.findMany({
        where: {
          metricDate: { gte: dateFrom, lte: dateTo },
        },
        orderBy: { metricDate: "desc" },
      });

      const buckets = this.buildMetricBuckets(dateFrom, dateTo, granularity);

      for (const m of metrics) {
        const bucketKey = this.getBucketKey(m.metricDate, granularity, dateFrom);
        if (!buckets.has(bucketKey)) {
          continue;
        }

        const bucket = buckets.get(bucketKey)!;
        bucket.new_users += m.newUsers;
        bucket.tracks_uploaded += m.tracksUploaded;
        bucket.total_storage_bytes += Number(m.totalStorageBytes);
        bucket.active_subscribers = Math.max(bucket.active_subscribers, m.activeSubscribers);
      }

      const normalizedMetrics = Array.from(buckets.values()).sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      );

      return {
        date_from: dateFrom.toISOString().split("T")[0],
        date_to: dateTo.toISOString().split("T")[0],
        granularity,
        metrics: normalizedMetrics,
      };
    });
  }

  // ─── Most reported ───────────────────────────────────────────────────────────

  async getMostReported(query: MostReportedQueryDto) {
    const period = query.period ?? "last_30_days";
    const limit = query.limit ?? 10;

    return this.getCached(`most_reported:${period}:${limit}`, async () => {
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

      // Enrich with target info
      const userIds = userReports
        .map((r) => r.reportedUserId)
        .filter((id): id is string => id !== null);
      const trackIds = trackReports.map((r) => r.trackId).filter((id): id is string => id !== null);
      const playlistIds = playlistReports
        .map((r) => r.playlistId)
        .filter((id): id is string => id !== null);

      const [users, tracks, playlists] = await Promise.all([
        userIds.length
          ? this.prisma.user.findMany({
              where: { id: { in: userIds } },
              select: {
                id: true,
                profile: { select: { handle: true, displayName: true } },
              },
            })
          : [],
        trackIds.length
          ? this.prisma.track.findMany({
              where: { id: { in: trackIds } },
              select: { id: true, title: true },
            })
          : [],
        playlistIds.length
          ? this.prisma.playlist.findMany({
              where: { id: { in: playlistIds } },
              select: { id: true, title: true },
            })
          : [],
      ]);

      const userMap = new Map(users.map((u) => [u.id, u]));
      const trackMap = new Map(tracks.map((t) => [t.id, t]));
      const playlistMap = new Map(playlists.map((p) => [p.id, p]));

      return {
        period,
        most_reported_users: userReports.map((r) => {
          const u = r.reportedUserId ? userMap.get(r.reportedUserId) : null;
          return {
            user_id: r.reportedUserId,
            handle: u?.profile?.handle ?? null,
            display_name: u?.profile?.displayName ?? null,
            report_count: r._count.id,
          };
        }),
        most_reported_tracks: trackReports.map((r) => {
          const t = r.trackId ? trackMap.get(r.trackId) : null;
          return {
            track_id: r.trackId,
            title: t?.title ?? null,
            report_count: r._count.id,
          };
        }),
        most_reported_playlists: playlistReports.map((r) => {
          const p = r.playlistId ? playlistMap.get(r.playlistId) : null;
          return {
            playlist_id: r.playlistId,
            title: p?.title ?? null,
            report_count: r._count.id,
          };
        }),
      };
    });
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
