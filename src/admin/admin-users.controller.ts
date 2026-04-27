import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { AdminUsersService } from "./admin-users.service";
import {
  AdminUsersQueryDto,
  AuditLogQueryDto,
  DailyStatsQueryDto,
  MostReportedQueryDto,
} from "./dto/admin-users.dto";

@ApiTags("Admin — Users")
@ApiCookieAuth("access_token")
@Controller("admin")
@Roles("ADMIN")
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // GET /api/v1/admin/users
  @ApiOperation({
    summary: "List all users",
    description: "Returns a paginated, filterable list of all users. Admin only.",
  })
  @ApiResponse({ status: 200, description: "Paginated user list." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden — Admin role required." })
  @Get("users")
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersService.getUsers(query);
  }

  // GET /api/v1/admin/users/:userId
  @ApiOperation({
    summary: "Get user detail",
    description: "Returns full profile and account detail for a specific user. Admin only.",
  })
  @ApiParam({ name: "userId", type: "string", format: "uuid", description: "Target user UUID." })
  @ApiResponse({ status: 200, description: "User detail returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden — Admin role required." })
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
  @ApiResponse({ status: 403, description: "Forbidden — Admin role required." })
  @Get("audit-log")
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.adminUsersService.getAuditLog(query);
  }

  // GET /api/v1/admin/stats/overview
  @ApiOperation({
    summary: "Get platform overview stats",
    description: "Returns high-level platform statistics (user counts, track counts, etc.). Admin only.",
  })
  @ApiResponse({ status: 200, description: "Overview stats returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden — Admin role required." })
  @Get("stats/overview")
  getOverviewStats() {
    return this.adminUsersService.getOverviewStats();
  }

  // GET /api/v1/admin/stats/daily
  @ApiOperation({
    summary: "Get daily stats",
    description: "Returns daily registration/activity statistics for a given date range. Admin only.",
  })
  @ApiResponse({ status: 200, description: "Daily stats returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden — Admin role required." })
  @Get("stats/daily")
  getDailyStats(@Query() query: DailyStatsQueryDto) {
    return this.adminUsersService.getDailyStats(query);
  }

  // GET /api/v1/admin/stats/most-reported
  @ApiOperation({
    summary: "Get most-reported users",
    description: "Returns users with the highest number of reports in descending order. Admin only.",
  })
  @ApiResponse({ status: 200, description: "Most-reported users list returned." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden — Admin role required." })
  @Get("stats/most-reported")
  getMostReported(@Query() query: MostReportedQueryDto) {
    return this.adminUsersService.getMostReported(query);
  }
}
