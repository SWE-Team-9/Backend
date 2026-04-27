import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ContentModerationService } from "./content-moderation.service";
import {
  ModerateTrackDto,
  ModerateCommentDto,
  ModeratePlaylistDto,
} from "./dto/content-moderation.dto";

@ApiTags("Admin - Content Moderation")
@ApiCookieAuth("access_token")
@Controller("admin")
@Roles("ADMIN", "MODERATOR")
export class ContentModerationController {
  constructor(
    private readonly contentModerationService: ContentModerationService,
  ) {}

  // PATCH /api/v1/admin/tracks/:id/moderation
  @ApiOperation({
    summary: "Moderate a track",
    description:
      "Approve, remove, or flag a track. Requires ADMIN or MODERATOR role.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Track UUID.",
  })
  @ApiResponse({ status: 200, description: "Track moderation action applied." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - ADMIN or MODERATOR role required.",
  })
  @ApiResponse({ status: 404, description: "Track not found." })
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
    description:
      "Approve, remove, or flag a comment. Requires ADMIN or MODERATOR role.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Comment UUID.",
  })
  @ApiResponse({
    status: 200,
    description: "Comment moderation action applied.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - ADMIN or MODERATOR role required.",
  })
  @ApiResponse({ status: 404, description: "Comment not found." })
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
    description:
      "Approve, remove, or flag a playlist. Requires ADMIN or MODERATOR role.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Playlist UUID.",
  })
  @ApiResponse({
    status: 200,
    description: "Playlist moderation action applied.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - ADMIN or MODERATOR role required.",
  })
  @ApiResponse({ status: 404, description: "Playlist not found." })
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
