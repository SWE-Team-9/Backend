import {
  Body,
  Controller,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateAppealDto } from "./dto/create-appeal.dto";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportsService } from "./reports.service";

@ApiTags("Reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new report" })
  @ApiResponse({ status: 201, description: "Report created successfully." })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Target entity not found." })
  createReport(
    @CurrentUser("userId") reporterId: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.createReport(reporterId, dto);
  }

  @Post("appeal")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create an appeal for a report" })
  @ApiResponse({ status: 201, description: "Appeal created successfully." })
  @ApiResponse({ status: 400, description: "Validation error." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Report not found." })
  createAppeal(
    @CurrentUser("userId") userId: string,
    @Body() dto: CreateAppealDto,
  ) {
    return this.reportsService.createAppeal(dto.reportId, userId, dto);
  }
}
