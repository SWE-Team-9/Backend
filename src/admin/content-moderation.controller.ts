import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ContentModerationService } from "./content-moderation.service";
import {
  ModerateTrackDto,
  ModerateCommentDto,
  ModeratePlaylistDto,
} from "./dto/content-moderation.dto";

@Controller("admin")
@Roles("ADMIN", "MODERATOR")
export class ContentModerationController {
  constructor(private readonly contentModerationService: ContentModerationService) {}

  // PATCH /api/v1/admin/tracks/:id/moderation
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
  @Patch("comments/:id/moderation")
  @HttpCode(200)
  moderateComment(
    @CurrentUser("userId") adminId: string,
    @Param("id", ParseUUIDPipe) commentId: string,
    @Body() dto: ModerateCommentDto,
  ) {
    return this.contentModerationService.moderateComment(adminId, commentId, dto);
  }

  // PATCH /api/v1/admin/playlists/:id/moderation
  @Patch("playlists/:id/moderation")
  @HttpCode(200)
  moderatePlaylist(
    @CurrentUser("userId") adminId: string,
    @Param("id", ParseUUIDPipe) playlistId: string,
    @Body() dto: ModeratePlaylistDto,
  ) {
    return this.contentModerationService.moderatePlaylist(adminId, playlistId, dto);
  }
}
