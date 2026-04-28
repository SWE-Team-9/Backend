import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { Public } from "../common/decorators/public.decorator";
import { RegisterProgressDto, UpdateSessionDto } from "./dto";
import { PlayerService } from "./player.service";

@ApiTags("Player")
@Controller("player")
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  // 1. GET /player/tracks/:trackId/source
  @Get("tracks/:trackId/source")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get playback source URL for a track" })
  @ApiParam({ name: "trackId", description: "Track ID" })
  @ApiOkResponse({
    description: "Playback source returned.",
    schema: {
      example: {
        trackId: "uuid",
        streamUrl: "https://cdn.example.com/audio/trk_123.mp3",
        accessState: "PLAYABLE",
        expiresAt: "2026-03-07T18:30:00Z",
      },
    },
  })
  getPlaybackSource(
    @CurrentUser("userId") userId: string,
    @Param("trackId", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ) {
    return this.playerService.getPlaybackSource(userId, trackId);
  }

  // 2. GET /player/tracks/:trackId/state
  @Get("tracks/:trackId/state")
  @Public()
  @ApiOperation({ summary: "Get playback access state for a track" })
  @ApiParam({ name: "trackId", description: "Track ID" })
  @ApiOkResponse({
    description: "Access state returned.",
    schema: {
      example: {
        trackId: "uuid",
        accessState: "PLAYABLE",
        reason: null,
      },
    },
  })
  getPlaybackState(
    @Param("trackId", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ) {
    return this.playerService.getPlaybackState(trackId);
  }

  // 3. POST /player/tracks/:trackId/progress
  @Post("tracks/:trackId/progress")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Register playback progress" })
  @ApiParam({ name: "trackId", description: "Track ID" })
  @ApiBody({ type: RegisterProgressDto })
  @ApiOkResponse({
    description: "Progress saved.",
    schema: {
      example: {
        message: "Playback progress saved successfully",
        trackId: "uuid",
        positionSeconds: 97,
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  registerProgress(
    @CurrentUser("userId") userId: string,
    @Param("trackId", new ParseUUIDPipe({ version: "4" })) trackId: string,
    @Body() body: RegisterProgressDto,
  ) {
    return this.playerService.registerProgress(
      userId,
      trackId,
      body.positionSeconds,
      body.durationSeconds,
      body.isCompleted,
    );
  }

  // 4. POST /player/tracks/:trackId/play
  @Post("tracks/:trackId/play")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Mark track as played" })
  @ApiParam({ name: "trackId", description: "Track ID" })
  @ApiCreatedResponse({
    description: "Play event recorded.",
    schema: {
      example: {
        message: "Play event recorded successfully",
        trackId: "uuid",
        playCount: 4821,
      },
    },
  })
  @ApiQuery({ name: "playlistId", required: false, description: "Optional playlist context" })
  markPlayed(
    @CurrentUser("userId") userId: string,
    @Param("trackId", new ParseUUIDPipe({ version: "4" })) trackId: string,
    @Query("playlistId") playlistId?: string,
  ) {
    if (playlistId) {
      return this.playerService.markPlayed(userId, trackId, playlistId);
    }

    return this.playerService.markPlayed(userId, trackId);
  }

  // 5. GET /player/history/recent
  @Get("history/recent")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get recently played tracks" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiOkResponse({
    description: "Recently played tracks.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 14,
        tracks: [
          {
            trackId: "uuid",
            title: "Layali",
            artist: { id: "uuid", display_name: "Ahmed Hassan" },
            lastPlayedAt: "2026-03-07T17:15:00Z",
            lastPositionSeconds: 97,
          },
        ],
      },
    },
  })
  getRecentlyPlayed(
    @CurrentUser("userId") userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.playerService.getRecentlyPlayed(
      userId,
      pagination.page,
      pagination.limit,
    );
  }

  // 6. GET /player/history
  @Get("history")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get full listening history" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiOkResponse({
    description: "Listening history.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 43,
        history: [
          {
            trackId: "uuid",
            title: "Layali",
            playedAt: "2026-03-07T17:15:00Z",
            positionSeconds: 97,
            durationSeconds: 240,
            isCompleted: false,
          },
        ],
      },
    },
  })
  getHistory(
    @CurrentUser("userId") userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.playerService.getHistory(
      userId,
      pagination.page,
      pagination.limit,
    );
  }

  // 7. DELETE /player/history
  @Delete("history")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Clear listening history" })
  @ApiOkResponse({
    description: "History cleared.",
    schema: {
      example: { message: "Listening history cleared successfully" },
    },
  })
  @HttpCode(HttpStatus.OK)
  clearHistory(@CurrentUser("userId") userId: string) {
    return this.playerService.clearHistory(userId);
  }

  // 8. GET /player/tracks/:trackId/resume
  @Get("tracks/:trackId/resume")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get resume position for a track" })
  @ApiParam({ name: "trackId", description: "Track ID" })
  @ApiOkResponse({
    description: "Resume position returned.",
    schema: {
      example: {
        trackId: "uuid",
        resumePositionSeconds: 97,
      },
    },
  })
  getResumePosition(
    @CurrentUser("userId") userId: string,
    @Param("trackId", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ) {
    return this.playerService.getResumePosition(userId, trackId);
  }

  // 9. GET /player/session
  @Get("session")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current player session / queue" })
  @ApiOkResponse({
    description: "Player session returned.",
    schema: {
      example: {
        currentTrack: { trackId: "uuid", title: "Layali" },
        positionSeconds: 97,
        isPlaying: true,
        volume: 0.8,
        queue: [
          { trackId: "uuid", title: "Sahar" },
          { trackId: "uuid", title: "Nostalgia Mix" },
        ],
      },
    },
  })
  getSession(@CurrentUser("userId") userId: string) {
    return this.playerService.getSession(userId);
  }

  // 10. PUT /player/session
  @Put("session")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update player session / queue" })
  @ApiBody({ type: UpdateSessionDto })
  @ApiOkResponse({
    description: "Session updated.",
    schema: {
      example: { message: "Player session updated successfully" },
    },
  })
  @HttpCode(HttpStatus.OK)
  updateSession(
    @CurrentUser("userId") userId: string,
    @Body() body: UpdateSessionDto,
  ) {
    return this.playerService.updateSession(userId, body);
  }

  // POST alias for PUT /player/session - used by navigator.sendBeacon on page unload
  @Post("session")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  updateSessionBeacon(
    @CurrentUser("userId") userId: string,
    @Body() body: UpdateSessionDto,
  ) {
    return this.playerService.updateSession(userId, body);
  }

  // 11. GET /player/tracks/:trackId/preview
  @Get("tracks/:trackId/preview")
  @Public()
  @ApiOperation({ summary: "Get track preview stream URL" })
  @ApiParam({ name: "trackId", description: "Track ID" })
  @ApiOkResponse({
    description: "Preview URL returned.",
    schema: {
      example: {
        trackId: "uuid",
        previewUrl: "https://cdn.example.com/audio/previews/trk_555.mp3",
        previewDurationSeconds: 30,
        accessState: "PREVIEW",
      },
    },
  })
  getTrackPreview(
    @Param("trackId", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ) {
    return this.playerService.getTrackPreview(trackId);
  }
}
