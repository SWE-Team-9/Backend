import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { AdminUsersService } from "./admin-users.service";
import {
  AdminUsersQueryDto,
  AuditLogQueryDto,
  DailyStatsQueryDto,
  MostReportedQueryDto,
} from "./dto/admin-users.dto";

@Controller("admin")
@Roles("ADMIN")
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // GET /api/v1/admin/users
  @Get("users")
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersService.getUsers(query);
  }

  // GET /api/v1/admin/users/:userId
  @Get("users/:userId")
  getUserDetail(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.adminUsersService.getUserDetail(userId);
  }

  // GET /api/v1/admin/audit-log
  @Get("audit-log")
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.adminUsersService.getAuditLog(query);
  }

  // GET /api/v1/admin/stats/overview
  @Get("stats/overview")
  getOverviewStats() {
    return this.adminUsersService.getOverviewStats();
  }

  // GET /api/v1/admin/stats/daily
  @Get("stats/daily")
  getDailyStats(@Query() query: DailyStatsQueryDto) {
    return this.adminUsersService.getDailyStats(query);
  }

  // GET /api/v1/admin/stats/most-reported
  @Get("stats/most-reported")
  getMostReported(@Query() query: MostReportedQueryDto) {
    return this.adminUsersService.getMostReported(query);
  }
}
