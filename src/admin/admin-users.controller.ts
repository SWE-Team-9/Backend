import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminUsersService } from "./admin-users.service";
import {
  AdminUsersQueryDto,
  AuditLogQueryDto,
  DailyStatsQueryDto,
  MostReportedQueryDto,
} from "./dto/admin-users.dto";

@ApiTags("Admin - Users")
@ApiCookieAuth("access_token")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("admin")
@Roles("ADMIN")
@ThrottlePolicy(30, 60_000)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // GET /api/v1/admin/users
  @ApiOperation({
    summary: "List all users",
    description: `Returns a paginated, filterable directory of platform users for admin tooling.

**Primary use cases for other teams:**
- Admin dashboard user table (search, sort, pagination)
- Support tooling (lookup by email/handle)
- Moderation pre-check before enforcement actions

**Recommended flow:**
1. Start with \`page=1&limit=20&sortBy=created_at&sortOrder=desc\`
2. Apply \`search\` for email/display name/handle
3. Add \`status\` and \`role\` filters for moderation workflows

**Notes:**
- Result ordering is deterministic based on \`sortBy\` + \`sortOrder\`
- Query params are validated; invalid enums/ranges return 400
- Endpoint is ADMIN-only`,
  })
  @ApiOkResponse({
    description: "Paginated user list returned.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 284,
        total_pages: 15,
        users: [
          {
            id: "dca3cba3-4a77-4eac-9ebc-594a8887a02a",
            display_name: "mohan2",
            handle: "mohan2",
            email: "mohanad.said06@eng-st.cu.edu.eg",
            system_role: "ADMIN",
            account_status: "ACTIVE",
            is_verified: true,
            created_at: "2026-03-21T01:58:04.035Z",
            avatar_url:
              "https://iqa3-media-storage.s3.eu-north-1.amazonaws.com/avatar/68cd3125-f2a4-4423-b94b-434c8190d9ab.png",
            account_type: "ARTIST",
            track_count: 3,
            report_count: 0,
            last_login_at: "2026-04-30T11:22:10.000Z",
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid query params." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Get("users")
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersService.getUsers(query);
  }

  // GET /api/v1/admin/users/:userId
  @ApiOperation({
    summary: "Get user detail",
    description: `Returns enriched details for a single user by UUID.

**Primary use cases for other teams:**
- Open user profile from admin list row click
- Build user-side panel in moderation dashboard
- Preload data before warn/suspend/ban actions

**Includes:**
- Identity and profile fields
- System role and account status
- Content and report counters
- Activity timestamps

**Behavior:**
- 404 when the target UUID does not exist
- ADMIN-only endpoint`,
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "Target user UUID.",
  })
  @ApiOkResponse({
    description: "User detail returned.",
    schema: {
      example: {
        id: "dca3cba3-4a77-4eac-9ebc-594a8887a02a",
        display_name: "mohan2",
        handle: "mohan2",
        email: "mohanad.said06@eng-st.cu.edu.eg",
        system_role: "ADMIN",
        account_status: "ACTIVE",
        is_verified: true,
        suspended_until: null,
        created_at: "2026-03-21T01:58:04.035Z",
        avatar_url:
          "https://iqa3-media-storage.s3.eu-north-1.amazonaws.com/avatar/68cd3125-f2a4-4423-b94b-434c8190d9ab.png",
        account_type: "ARTIST",
        last_login_at: "2026-04-30T11:22:10.000Z",
        stats: {
          tracks_uploaded: 3,
          playlists_created: 2,
          followers_count: 0,
          following_count: 2,
        },
        subscription: {
          tier: "GO_PLUS",
          status: "TRIALING",
          current_period_end: "2026-05-28T15:08:28.172Z",
        },
        moderation_history: [
          {
            id: "8f245b80-99df-453b-91ec-67f260f9b517",
            action_type: "WARN_USER",
            admin_handle: "admin1",
            notes: "Posting misleading content repeatedly.",
            created_at: "2026-04-28T12:12:03.000Z",
          },
        ],
        reports_against: {
          total: 2,
          pending: 1,
          resolved: 1,
        },
        reports_submitted: {
          total: 0,
          pending: 0,
          resolved: 0,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid UUID format." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({ status: 404, description: "User not found." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Get("users/:userId")
  getUserDetail(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.adminUsersService.getUserDetail(userId);
  }

  // GET /api/v1/admin/audit-log
  @ApiOperation({
    summary: "Get audit log",
    description: `Returns paginated moderation/admin audit actions.

**Primary use cases for other teams:**
- Compliance timeline views
- Incident investigation tooling
- "Who changed what" forensic lookups

**Filter support:**
- \`actionType\` (warn/suspend/ban/restore/etc.)
- \`adminId\`
- \`targetUserId\`
- date range via \`dateFrom\` / \`dateTo\`

**Notes:**
- Date filters use ISO-8601 strings
- Results are sorted by newest first by default
- ADMIN-only endpoint`,
  })
  @ApiOkResponse({
    description: "Audit log entries returned.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 87,
        total_pages: 5,
        actions: [
          {
            id: "8f245b80-99df-453b-91ec-67f260f9b517",
            action_type: "SUSPEND_USER",
            admin: {
              id: "1efb4228-2d9a-4c10-9de3-fc2f8f5b1a63",
              display_name: "Admin One",
              handle: "admin1",
            },
            target_user: {
              id: "5ae99a52-31de-4bc0-9ef4-69c0c8343b8d",
              display_name: "User Two",
              handle: "user2",
            },
            target_track: null,
            target_comment: null,
            target_playlist: null,
            linked_report_id: "44fcd6ab-7f8a-4465-8e8e-66cdb5409d65",
            notes: "Repeated policy violations",
            created_at: "2026-04-30T10:12:03.000Z",
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid query params." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Get("audit-log")
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.adminUsersService.getAuditLog(query);
  }

  // GET /api/v1/admin/stats/overview
  @ApiOperation({
    summary: "Get platform overview stats",
    description: `Returns high-level platform analytics for the admin dashboard. Admin only.

**Key metrics returned:**
- **Total Users** with artist/listener breakdown and artist-to-listener ratio
- **Total Tracks** (visible / hidden / removed)
- **Total Plays** (all play events recorded)
- **Play Through Rate** = (completed plays / total plays) × 100, where a completed play has \`completionRatio >= 0.90\` (user listened to ≥ 90% of the track)
- **Total Storage Used** in bytes across all uploaded track files
- **Moderation** report and action counts

Results are cached for 5 minutes.`,
  })
  @ApiOkResponse({
    description: "Overview stats returned.",
    schema: {
      example: {
        users: {
          total: 5000,
          active: 4700,
          suspended: 50,
          banned: 150,
          verified: 4800,
          unverified: 200,
          artists: 800,
          listeners: 4200,
          artist_to_listener_ratio: 0.1905,
        },
        content: {
          total_tracks: 12000,
          tracks_visible: 11500,
          tracks_hidden: 300,
          tracks_removed: 200,
          total_playlists: 3000,
          total_comments: 45000,
        },
        engagement: {
          total_play_events: 1500000,
          completed_play_events: 900000,
          play_through_rate_pct: 60.0,
          total_likes: 250000,
          total_reposts: 80000,
        },
        billing: {
          active_subscriptions: 320,
          total_storage_bytes: 536870912000,
        },
        moderation: {
          reports_pending: 12,
          reports_in_review: 5,
          reports_resolved_this_week: 30,
          actions_taken_this_week: 18,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Get("stats/overview")
  getOverviewStats() {
    return this.adminUsersService.getOverviewStats();
  }

  // GET /api/v1/admin/stats/daily
  @ApiOperation({
    summary: "Get daily stats",
    description: `Returns time-series metrics for dashboard charting.

**Primary use cases for other teams:**
- Analytics chart components (daily/weekly/monthly)
- Capacity planning and growth monitoring
- KPI exports

**Query behavior:**
- \`dateFrom\` / \`dateTo\` define range
- \`granularity\` controls bucket size (daily, weekly, monthly)
- Missing dates fallback to service defaults

**ADMIN-only endpoint.**`,
  })
  @ApiOkResponse({
    description: "Daily stats returned.",
    schema: {
      example: {
        date_from: "2026-04-01",
        date_to: "2026-04-30",
        granularity: "daily",
        metrics: [
          {
            date: "2026-04-01",
            new_users: 24,
            tracks_uploaded: 52,
            total_storage_bytes: 125634987654,
            active_subscribers: 329,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid date range or granularity." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Get("stats/daily")
  getDailyStats(@Query() query: DailyStatsQueryDto) {
    return this.adminUsersService.getDailyStats(query);
  }

  // GET /api/v1/admin/stats/most-reported
  @ApiOperation({
    summary: "Get most-reported users",
    description: `Returns leaderboard-style "most reported" entities for trust & safety triage.

**Primary use cases for other teams:**
- High-risk queue widgets
- Prioritization panels for moderation shifts
- Weekly reporting snapshots

**Query behavior:**
- \`period\` selects time window (7d/30d/90d/all_time)
- \`limit\` caps result size per category

**ADMIN-only endpoint.**`,
  })
  @ApiOkResponse({
    description: "Most-reported users list returned.",
    schema: {
      example: {
        period: "last_30_days",
        most_reported_users: [
          {
            user_id: "5ae99a52-31de-4bc0-9ef4-69c0c8343b8d",
            display_name: "User Two",
            handle: "user2",
            report_count: 17,
          },
        ],
        most_reported_tracks: [
          {
            track_id: "9eb9086e-96fc-4c2f-9ed4-ab59e8aa0bd1",
            title: "Track A",
            report_count: 9,
          },
        ],
        most_reported_playlists: [
          {
            playlist_id: "9adbe26a-4b95-4f3a-8706-0dd39f97f50a",
            title: "Playlist A",
            report_count: 9,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid period or limit value." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Get("stats/most-reported")
  getMostReported(@Query() query: MostReportedQueryDto) {
    return this.adminUsersService.getMostReported(query);
  }
}
