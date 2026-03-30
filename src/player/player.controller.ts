import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { RegisterPlaybackProgressDto } from "./dto/register-playback-progress.dto";
import { TrackIdParamDto } from "./dto/track-id-param.dto";
import { UpdateQueueSessionDto } from "./dto/update-queue-session.dto";
import { PlayerService } from "./player.service";

@ApiTags("Player")
@ApiCookieAuth("access_token")
@Controller("player")
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @ApiOperation({
    summary: "Get playback source",
    description: "Returns stream source URL and playback access state.",
  })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        trackId: "trk_123",
        streamUrl: "https://cdn.example.com/audio/trk_123.mp3",
        accessState: "PLAYABLE",
        expiresAt: "2026-03-07T18:30:00Z",
      },
    },
  })
  @ApiResponse({ status: 403, description: "Track blocked for current requester." })
  @ApiResponse({ status: 404, description: "Track not found." })
  @ApiResponse({ status: 409, description: "Track still processing." })
  @Get("tracks/:trackId/source")
  getPlaybackSource(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no stream URL generation logic implemented yet.
    return this.playerService.getPlaybackSource(userId, params);
  }

  @ApiOperation({
    summary: "Get playback state",
    description: "Returns PLAYABLE/PREVIEW/BLOCKED state for current requester.",
  })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        trackId: "trk_123",
        accessState: "PLAYABLE",
        reason: null,
      },
    },
  })
  @Get("tracks/:trackId/state")
  getPlaybackState(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no access-state logic implemented yet.
    return this.playerService.getPlaybackState(userId, params);
  }

  @ApiOperation({
    summary: "Register playback progress",
    description: "Stores playback position for history and resume support.",
  })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiBody({ type: RegisterPlaybackProgressDto })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        message: "Playback progress saved successfully",
        trackId: "trk_123",
        positionSeconds: 97,
      },
    },
  })
  @Post("tracks/:trackId/progress")
  registerPlaybackProgress(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
    @Body() dto: RegisterPlaybackProgressDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no progress persistence logic implemented yet.
    return this.playerService.registerPlaybackProgress(userId, params, dto);
  }

  @ApiOperation({
    summary: "Mark track as played",
    description: "Registers a play event and updates recently played list.",
  })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        message: "Play event recorded successfully",
        trackId: "trk_123",
        playCount: 4821,
      },
    },
  })
  @Post("tracks/:trackId/play")
  @HttpCode(HttpStatus.CREATED)
  markTrackAsPlayed(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no play event logic implemented yet.
    return this.playerService.markTrackAsPlayed(userId, params);
  }

  @ApiOperation({
    summary: "Get recently played",
    description: "Returns recently played tracks in reverse chronological order.",
  })
  @ApiResponse({ status: 200, description: "Recently played list returned." })
  @Get("history/recent")
  getRecentlyPlayed(
    @CurrentUser("userId") userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no recent history read logic implemented yet.
    return this.playerService.getRecentlyPlayed(userId, query);
  }

  @ApiOperation({
    summary: "Get listening history",
    description: "Returns listening history with playback timestamps and progress.",
  })
  @ApiResponse({ status: 200, description: "Listening history returned." })
  @Get("history")
  getListeningHistory(
    @CurrentUser("userId") userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no history read logic implemented yet.
    return this.playerService.getListeningHistory(userId, query);
  }

  @ApiOperation({
    summary: "Clear listening history",
    description: "Clears all listening history entries for current user.",
  })
  @ApiResponse({
    status: 200,
    schema: { example: { message: "Listening history cleared successfully" } },
  })
  @Delete("history")
  clearListeningHistory(@CurrentUser("userId") userId: string) {
    // TODO(Module 5): endpoint placeholder - no clear-history logic implemented yet.
    return this.playerService.clearListeningHistory(userId);
  }

  @ApiOperation({
    summary: "Get resume position",
    description: "Returns last saved playback position for current user and track.",
  })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        trackId: "trk_123",
        resumePositionSeconds: 97,
      },
    },
  })
  @Get("tracks/:trackId/resume")
  getResumePosition(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no resume lookup logic implemented yet.
    return this.playerService.getResumePosition(userId, params);
  }

  @ApiOperation({
    summary: "Get queue session",
    description: "Returns persistent player session state for current user.",
  })
  @ApiResponse({ status: 200, description: "Player session returned." })
  @Get("session")
  getQueueSession(@CurrentUser("userId") userId: string) {
    // TODO(Module 5): endpoint placeholder - no session read logic implemented yet.
    return this.playerService.getQueueSession(userId);
  }

  @ApiOperation({
    summary: "Update queue session",
    description: "Updates persistent player session state for current user.",
  })
  @ApiBody({ type: UpdateQueueSessionDto })
  @ApiResponse({
    status: 200,
    schema: { example: { message: "Player session updated successfully" } },
  })
  @Put("session")
  updateQueueSession(
    @CurrentUser("userId") userId: string,
    @Body() dto: UpdateQueueSessionDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no session update logic implemented yet.
    return this.playerService.updateQueueSession(userId, dto);
  }

  @ApiOperation({
    summary: "Stream track preview",
    description: "Returns preview streaming source for preview-access tracks.",
  })
  @ApiParam({ name: "trackId", example: "trk_555" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        trackId: "trk_555",
        previewUrl: "https://cdn.example.com/audio/previews/trk_555.mp3",
        previewDurationSeconds: 30,
        accessState: "PREVIEW",
      },
    },
  })
  @Get("tracks/:trackId/preview")
  getTrackPreviewSource(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 5): endpoint placeholder - no preview source logic implemented yet.
    return this.playerService.getTrackPreviewSource(userId, params);
  }
}
