import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AllowSuspended } from "../common/decorators/allow-suspended.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import { CreateAppealDto } from "./dto/create-appeal.dto";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("Reports")
@ApiCookieAuth("access_token")
@UseGuards(JwtAuthGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ThrottlePolicy(10, 3_600_000) // 10 per hour per spec
  @ApiOperation({ summary: "Create a new report" })
  @ApiResponse({ status: 201, description: "Report created successfully." })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Target entity not found." })
  createReport(@CurrentUser("userId") reporterId: string, @Body() dto: CreateReportDto) {
    return this.reportsService.createReport(reporterId, dto);
  }

  @Post("appeal")
  @HttpCode(201)
  @AllowSuspended()
  @ApiOperation({ summary: "Create an appeal for a report" })
  @ApiResponse({ status: 201, description: "Appeal created successfully." })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Report not found." })
  createAppeal(@CurrentUser("userId") userId: string, @Body() dto: CreateAppealDto) {
    return this.reportsService.createAppeal(dto.reportId, userId, dto);
  }
}
