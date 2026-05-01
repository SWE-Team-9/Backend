import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AssignReportDto } from './dto/assign-report.dto';
import { BulkUpdateReportsDto } from './dto/bulk-update-reports.dto';
import { AdminReportsQueryDto } from './dto/admin-reports-query.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Admin Reports')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'List reports with pagination and filters',
    description: `Returns moderation reports with optional status/target filtering and pagination.

**Primary use cases for other teams:**
- Reports inbox UI for moderators/admins
- Filtered queues (PENDING, UNDER_REVIEW, RESOLVED)
- Content-type queues (TRACK, USER, COMMENT, PLAYLIST)

**Recommended flow:**
1. Load \`page=1&limit=20\`
2. Filter by \`status\` and \`targetType\`
3. Drill down into \`GET /admin/reports/:id\``,
  })
  @ApiOkResponse({
    description: 'Reports fetched successfully.',
    schema: {
      example: {
        items: [
          {
            id: '44fcd6ab-7f8a-4465-8e8e-66cdb5409d65',
            category: 'SPAM',
            status: 'PENDING',
            description: 'Abusive language in comments',
            created_at: '2026-04-30T10:20:00.000Z',
            resolved_at: null,
            resolved_by: null,
            reporter: {
              id: 'f131f6e8-f8a4-48d6-8a2d-f1c47cf978f3',
              email: 'user1@example.com',
              display_name: 'User One',
              handle: 'userone',
            },
            target: {
              type: 'TRACK',
              id: '9eb9086e-96fc-4c2f-9ed4-ab59e8aa0bd1',
              title: 'Track A',
              owner_handle: 'artist1',
            },
            offender: {
              id: 'uuid-of-artist1',
              account_status: 'ACTIVE',
            },
            appeals_count: 0,
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 132,
          totalPages: 7,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid pagination or filter query params.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  getReports(@Query() query: AdminReportsQueryDto) {
    return this.reportsService.getReports(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single report with related appeals',
    description: `Returns one report, including relation data needed by detail views and appeal processing.

**Primary use cases for other teams:**
- Report details page
- Appeal-review workflows
- Reporter/target context rendering`,
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Report UUID.',
  })
  @ApiOkResponse({
    description: 'Report fetched successfully.',
    schema: {
      example: {
        id: '44fcd6ab-7f8a-4465-8e8e-66cdb5409d65',
        category: 'SPAM',
        status: 'PENDING',
        description: 'Abusive language in comments',
        created_at: '2026-04-30T10:20:00.000Z',
        resolved_at: null,
        resolved_by: null,
        reporter: {
          id: 'f131f6e8-f8a4-48d6-8a2d-f1c47cf978f3',
          email: 'user1@example.com',
          display_name: 'User One',
          handle: 'userone',
        },
        target: {
          type: 'TRACK',
          id: '9eb9086e-96fc-4c2f-9ed4-ab59e8aa0bd1',
          title: 'Track A',
          owner_handle: 'artist1',
        },
        offender: {
          id: 'uuid-of-artist1',
          account_status: 'ACTIVE',
        },
        appeals_count: 0,
        appeals: [
          {
            id: '0e6f6fc5-62f9-4a15-b8de-f5f3949cf767',
            message: 'I believe this report is incorrect.',
            status: 'PENDING',
            created_at: '2026-04-30T11:00:00.000Z',
            resolved_at: null,
            resolution_notes: null,
            user: {
              id: 'f131f6e8-f8a4-48d6-8a2d-f1c47cf978f3',
              email: 'user1@example.com',
              display_name: 'User One',
              handle: 'userone',
            },
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid report UUID format.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Report not found.' })
  getReportById(@Param('id', new ParseUUIDPipe({ version: '4' })) reportId: string) {
    return this.reportsService.getReportById(reportId);
  }

  @Patch('bulk')
  @ApiOperation({
    summary: 'Bulk update multiple reports to one status',
    description: `Applies the same status transition to up to 50 reports in one request.

**Primary use cases for other teams:**
- Triage queue bulk resolve/reject actions
- Operational cleanup of stale reports

**Notes:**
- \`reportIds\` max size is 50
- Optional \`resolutionNotes\` propagates to linked appeal context when relevant`,
  })
  @ApiBody({ type: BulkUpdateReportsDto })
  @ApiOkResponse({
    description: 'Reports updated successfully.',
    schema: {
      example: {
        updatedReports: 3,
        updatedAppeals: 2,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation error or business rule violation (`INVALID_TRANSITION`) when any target report is already RESOLVED.',
    schema: {
      example: {
        code: 'INVALID_TRANSITION',
        message: 'Cannot transition from RESOLVED status to another state.',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  bulkUpdateReports(@CurrentUser('userId') adminId: string, @Body() dto: BulkUpdateReportsDto) {
    return this.reportsService.bulkUpdateReports(adminId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update report status and resolution notes',
    description: `Updates one report lifecycle state and optional resolution notes.

**Primary use cases for other teams:**
- Single-report resolution actions
- Moderator handoff comments
- Appeal outcome annotation`,
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Report UUID.',
  })
  @ApiBody({ type: UpdateReportDto })
  @ApiOkResponse({
    description: 'Report updated successfully.',
    schema: {
      example: {
        report: {
          id: '44fcd6ab-7f8a-4465-8e8e-66cdb5409d65',
          status: 'RESOLVED',
          resolvedAt: '2026-04-30T12:10:00.000Z',
          resolvedBy: '1efb4228-2d9a-4c10-9de3-fc2f8f5b1a63',
        },
        notesAppliedToAppeals: 1,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation error or business rule violation (`INVALID_TRANSITION`) when attempting to change a RESOLVED report.',
    schema: {
      example: {
        code: 'INVALID_TRANSITION',
        message: 'Cannot transition from RESOLVED status to another state.',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Report not found.' })
  updateReport(
    @CurrentUser('userId') adminId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reportsService.updateReport(reportId, adminId, dto);
  }

  @Patch(':id/assign')
  @ApiOperation({
    summary: 'Assign report to an admin',
    description: `Assigns a report to an ADMIN for ownership-based workflows.

**Primary use cases for other teams:**
- Work distribution in moderation queue
- SLA ownership tracking
- Team handoff automation`,
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Report UUID.',
  })
  @ApiBody({ type: AssignReportDto })
  @ApiOkResponse({
    description: 'Report assigned successfully.',
    schema: {
      example: {
        id: '44fcd6ab-7f8a-4465-8e8e-66cdb5409d65',
        status: 'UNDER_REVIEW',
        resolvedBy: '4d2f5dd5-f6dd-44fb-bddb-53eb95ef2d34',
        createdAt: '2026-04-30T10:20:00.000Z',
        updatedAt: '2026-04-30T12:15:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid assignee.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Report or admin not found.' })
  assignReport(
    @Param('id', new ParseUUIDPipe({ version: '4' })) reportId: string,
    @Body() dto: AssignReportDto,
  ) {
    return this.reportsService.assignReport(reportId, dto.adminId);
  }
}
