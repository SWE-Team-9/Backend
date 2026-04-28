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
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // GET /api/v1/admin/users
  @ApiOperation({
    summary: "List all users",
    description:
      "Returns a paginated, filterable list of all users. Admin only.",
  })
  @ApiResponse({ status: 200, description: "Paginated user list." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @Get("users")
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersService.getUsers(query);
  }

  // GET /api/v1/admin/users/:userId
  @ApiOperation({
    summary: "Get user detail",
    description:
      "Returns full profile and account detail for a specific user. Admin only.",
  })
  @ApiParam({
    name: "userId",
    type: "string",
    format: "uuid",
    description: "Target user UUID.",
  })
  @ApiResponse({ status: 200, description: "User detail returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @ApiResponse({ status: 404, description: "User not found." })
  @Get("users/:userId")
  getUserDetail(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.adminUsersService.getUserDetail(userId);
  }

  // GET /api/v1/admin/audit-log
  @ApiOperation({
    summary: "Get audit log",
    description: "Returns a paginated audit log of admin actions. Admin only.",
  })
  @ApiResponse({ status: 200, description: "Audit log entries returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
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
  @Get("stats/overview")
  getOverviewStats() {
    return this.adminUsersService.getOverviewStats();
  }

  // GET /api/v1/admin/stats/daily
  @ApiOperation({
    summary: "Get daily stats",
    description:
      "Returns daily registration/activity statistics for a given date range. Admin only.",
  })
  @ApiResponse({ status: 200, description: "Daily stats returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @Get("stats/daily")
  getDailyStats(@Query() query: DailyStatsQueryDto) {
    return this.adminUsersService.getDailyStats(query);
  }

  // GET /api/v1/admin/stats/most-reported
  @ApiOperation({
    summary: "Get most-reported users",
    description:
      "Returns users with the highest number of reports in descending order. Admin only.",
  })
  @ApiResponse({
    status: 200,
    description: "Most-reported users list returned.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required." })
  @Get("stats/most-reported")
  getMostReported(@Query() query: MostReportedQueryDto) {
    return this.adminUsersService.getMostReported(query);
  }
}
