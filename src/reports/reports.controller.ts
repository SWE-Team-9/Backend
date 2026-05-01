import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AllowSuspended } from '../common/decorators/allow-suspended.decorator';
import { ThrottlePolicy } from '../common/decorators/throttle-policy.decorator';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ThrottlePolicy(10, 3_600_000) // 10 per hour per spec
  @ApiOperation({
    summary: 'Create a new report',
    description: 'Reports a track, user, playlist, or comment for violating community guidelines.',
  })
  @ApiBody({ type: CreateReportDto })
  @ApiResponse({
    status: 201,
    description: 'Report created successfully.',
    schema: {
      example: {
        id: 'rpt-uuid-1',
        reporterId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        targetId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        targetType: 'TRACK',
        reason: 'SPAM',
        description: null,
        status: 'PENDING',
        createdAt: '2026-04-30T18:00:00.000Z',
        resolvedAt: null,
        resolvedBy: null,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Target entity not found.' })
  @ApiResponse({ status: 409, description: 'You have already reported this content.' })
  createReport(@CurrentUser('userId') reporterId: string, @Body() dto: CreateReportDto) {
    return this.reportsService.createReport(reporterId, dto);
  }

  @Post('appeal')
  @HttpCode(201)
  @AllowSuspended()
  @ApiOperation({
    summary: 'Create an appeal for a report',
    description: 'Submits an appeal against a moderation action or reported content decision.',
  })
  @ApiBody({ type: CreateAppealDto })
  @ApiResponse({
    status: 201,
    description: 'Appeal created successfully.',
    schema: {
      example: {
        id: 'appeal-uuid-1',
        reportId: 'rpt-uuid-1',
        userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        message: 'This content was wrongly flagged.',
        status: 'PENDING',
        createdAt: '2026-04-30T18:05:00.000Z',
        resolvedAt: null,
        resolutionNotes: null,
        resolvedBy: null,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Report not found.' })
  createAppeal(@CurrentUser('userId') userId: string, @Body() dto: CreateAppealDto) {
    return this.reportsService.createAppeal(dto.reportId, userId, dto);
  }
}
