import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AssignReportDto } from "./dto/assign-report.dto";
import { BulkUpdateReportsDto } from "./dto/bulk-update-reports.dto";
import { AdminReportsQueryDto } from "./dto/admin-reports-query.dto";
import { UpdateReportDto } from "./dto/update-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("Admin Reports")
@ApiCookieAuth("access_token")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "MODERATOR")
@Controller("admin/reports")
export class AdminReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({ summary: "List reports with pagination and filters" })
  @ApiResponse({ status: 200, description: "Reports fetched successfully." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  getReports(@Query() query: AdminReportsQueryDto) {
    return this.reportsService.getReports(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single report with related appeals" })
  @ApiParam({ name: "id", type: "string", format: "uuid", description: "Report UUID." })
  @ApiResponse({ status: 200, description: "Report fetched successfully." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Report not found." })
  getReportById(
    @Param("id", new ParseUUIDPipe({ version: "4" })) reportId: string,
  ) {
    return this.reportsService.getReportById(reportId);
  }

  @Patch("bulk")
  @ApiOperation({ summary: "Bulk update multiple reports to one status" })
  @ApiResponse({ status: 200, description: "Reports updated successfully." })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  bulkUpdateReports(
    @CurrentUser("userId") adminId: string,
    @Body() dto: BulkUpdateReportsDto,
  ) {
    return this.reportsService.bulkUpdateReports(adminId, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update report status and resolution notes" })
  @ApiParam({ name: "id", type: "string", format: "uuid", description: "Report UUID." })
  @ApiResponse({ status: 200, description: "Report updated successfully." })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Report not found." })
  updateReport(
    @CurrentUser("userId") adminId: string,
    @Param("id", new ParseUUIDPipe({ version: "4" })) reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reportsService.updateReport(reportId, adminId, dto);
  }

  @Patch(":id/assign")
  @ApiOperation({ summary: "Assign report to an admin" })
  @ApiParam({ name: "id", type: "string", format: "uuid", description: "Report UUID." })
  @ApiResponse({ status: 200, description: "Report assigned successfully." })
  @ApiResponse({ status: 400, description: "Invalid assignee." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Report or admin not found." })
  assignReport(
    @Param("id", new ParseUUIDPipe({ version: "4" })) reportId: string,
    @Body() dto: AssignReportDto,
  ) {
    return this.reportsService.assignReport(reportId, dto.adminId);
  }
}
