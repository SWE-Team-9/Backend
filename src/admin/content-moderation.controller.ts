import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ThrottlePolicy } from "../common/decorators/throttle-policy.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ContentModerationService } from "./content-moderation.service";
import {
  ModerateTrackDto,
  ModerateCommentDto,
  ModeratePlaylistDto,
} from "./dto/content-moderation.dto";

@ApiTags("Admin - Content Moderation")
@ApiCookieAuth("access_token")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("admin")
@Roles("ADMIN", "MODERATOR")
@ThrottlePolicy(30, 60_000)
export class ContentModerationController {
  constructor(
    private readonly contentModerationService: ContentModerationService,
  ) {}

  // PATCH /api/v1/admin/tracks/:id/moderation
  @ApiOperation({
    summary: "Moderate a track",
    description: `Updates moderation state for a track and writes a moderation audit action.

**Primary use cases for other teams:**
- Resolve report-driven content actions
- Manual moderation queue actions
- Moderator tooling for state transitions (VISIBLE/HIDDEN/REMOVED)

**Behavior:**
- \`moderationState\` drives visibility/removal policy
- \`reason\` is mandatory and stored for auditability
- \`reportId\` can be supplied to link action to an existing report

**Roles allowed:** ADMIN, MODERATOR`,
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Track UUID.",
  })
  @ApiBody({ type: ModerateTrackDto })
  @ApiOkResponse({
    description: "Track moderation action applied.",
    schema: {
      example: {
        action_id: "2df584a2-bac5-4f16-b4c4-5f0f4c67be4b",
        action_type: "HIDE_TRACK",
        track: {
          id: "9eb9086e-96fc-4c2f-9ed4-ab59e8aa0bd1",
          title: "Track A",
          previous_state: "VISIBLE",
          new_state: "HIDDEN",
        },
        admin_id: "1efb4228-2d9a-4c10-9de3-fc2f8f5b1a63",
        notes: "Contains copyright-infringing material.",
        created_at: "2026-04-30T12:25:10.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error or no-op transition (`NO_STATE_CHANGE`) when requested state equals current state.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - ADMIN or MODERATOR role required.",
  })
  @ApiResponse({ status: 404, description: "Track not found." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Patch("tracks/:id/moderation")
  @HttpCode(200)
  moderateTrack(
    @CurrentUser("userId") adminId: string,
    @Param("id", ParseUUIDPipe) trackId: string,
    @Body() dto: ModerateTrackDto,
  ) {
    return this.contentModerationService.moderateTrack(adminId, trackId, dto);
  }

  // PATCH /api/v1/admin/comments/:id/moderation
  @ApiOperation({
    summary: "Moderate a comment",
    description: `Moderates a comment by toggling hidden visibility and recording an audit action.

**Primary use cases for other teams:**
- Abuse/harassment moderation in conversation surfaces
- Report resolution workflows for comment targets

**Behavior:**
- \`isHidden=true\` hides comment from normal viewers
- \`isHidden=false\` restores comment visibility
- \`reason\` is required and persisted in moderation history

**Roles allowed:** ADMIN, MODERATOR`,
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Comment UUID.",
  })
  @ApiBody({ type: ModerateCommentDto })
  @ApiOkResponse({
    description: "Comment moderation action applied.",
    schema: {
      example: {
        action_id: "abf4c943-0d8d-40e2-8ad8-0c9b8a154f99",
        action_type: "HIDE_COMMENT",
        comment: {
          id: "5ab95a60-4a57-4efe-a9f4-d1d430163e72",
          track_id: "9eb9086e-96fc-4c2f-9ed4-ab59e8aa0bd1",
          is_hidden: true,
        },
        admin_id: "1efb4228-2d9a-4c10-9de3-fc2f8f5b1a63",
        notes: "Comment contains hate speech.",
        created_at: "2026-04-30T12:30:22.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error or no-op transition (`NO_STATE_CHANGE`) when requested visibility equals current state.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - ADMIN or MODERATOR role required.",
  })
  @ApiResponse({ status: 404, description: "Comment not found." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Patch("comments/:id/moderation")
  @HttpCode(200)
  moderateComment(
    @CurrentUser("userId") adminId: string,
    @Param("id", ParseUUIDPipe) commentId: string,
    @Body() dto: ModerateCommentDto,
  ) {
    return this.contentModerationService.moderateComment(
      adminId,
      commentId,
      dto,
    );
  }

  // PATCH /api/v1/admin/playlists/:id/moderation
  @ApiOperation({
    summary: "Moderate a playlist",
    description: `Updates moderation state for playlists and writes corresponding audit actions.

**Primary use cases for other teams:**
- Playlist policy enforcement
- Report resolution for playlist targets

**Behavior:**
- \`moderationState\` controls playlist visibility/removal
- \`reason\` is required for compliance and audit trails
- Optional \`reportId\` links action back to report lifecycle

**Roles allowed:** ADMIN, MODERATOR`,
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Playlist UUID.",
  })
  @ApiBody({ type: ModeratePlaylistDto })
  @ApiOkResponse({
    description: "Playlist moderation action applied.",
    schema: {
      example: {
        action_id: "9d7f2c88-67c2-4f66-8910-0bd520501a6c",
        action_type: "REMOVE_PLAYLIST",
        playlist: {
          id: "9adbe26a-4b95-4f3a-8706-0dd39f97f50a",
          title: "Playlist A",
          previous_state: "VISIBLE",
          new_state: "REMOVED",
        },
        admin_id: "1efb4228-2d9a-4c10-9de3-fc2f8f5b1a63",
        notes: "Playlist promotes harmful content.",
        created_at: "2026-04-30T12:34:08.000Z",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation error or no-op transition (`NO_STATE_CHANGE`) when requested state equals current state.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - ADMIN or MODERATOR role required.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
  @ApiResponse({
    status: 429,
    description: "Rate limit exceeded — max 30 requests per 60 seconds.",
  })
  @Patch("playlists/:id/moderation")
  @HttpCode(200)
  moderatePlaylist(
    @CurrentUser("userId") adminId: string,
    @Param("id", ParseUUIDPipe) playlistId: string,
    @Body() dto: ModeratePlaylistDto,
  ) {
    return this.contentModerationService.moderatePlaylist(
      adminId,
      playlistId,
      dto,
    );
  }
}
