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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Public } from '../common/decorators/public.decorator';
import { RegisterProgressDto, UpdateSessionDto } from './dto';
import { LoadQueueDto } from './dto/load-queue.dto';
import { JumpToTrackDto } from './dto/jump-to-track.dto';
import { PlayerService } from './player.service';

@ApiTags('Player')
@Controller('player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  // 1. GET /player/tracks/:trackId/source
  @Get('tracks/:trackId/source')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get playback source URL for a track',
    description:
      'Returns a signed CDN stream URL for the requested track. ' +
      'The URL expires after a short window (see `expiresAt`). ' +
      'Access is gated by subscription tier: FREE users receive PREVIEW access for non-free tracks.',
  })
  @ApiParam({ name: 'trackId', format: 'uuid', description: 'Track UUID' })
  @ApiOkResponse({
    description: 'Playback source returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        streamUrl: 'https://cdn.iqa3.tech/audio/trk_123.mp3?token=xyz',
        accessState: 'PLAYABLE',
        expiresAt: '2026-03-07T18:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Track is private.' })
  @ApiResponse({ status: 404, description: 'Track not found or not published.' })
  @ApiResponse({ status: 409, description: 'Track is still processing and cannot be played yet.' })
  getPlaybackSource(
    @CurrentUser('userId') userId: string,
    @Param('trackId', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ) {
    return this.playerService.getPlaybackSource(userId, trackId);
  }

  // 2. GET /player/tracks/:trackId/state
  @Get('tracks/:trackId/state')
  @Public()
  @ApiOperation({
    summary: 'Get playback access state for a track',
    description:
      'Public endpoint. Returns the access state without issuing a stream URL. ' +
      'Use this to decide whether to show a preview, paywall, or full play button before requesting a source URL. ' +
      'Possible values: `PLAYABLE`, `PREVIEW`, `BLOCKED`, `PROCESSING`. Returns 404 when the track does not exist.',
  })
  @ApiParam({ name: 'trackId', format: 'uuid', description: 'Track UUID' })
  @ApiOkResponse({
    description: 'Access state returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        accessState: 'PLAYABLE',
        reason: null,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Track not found or not published.' })
  getPlaybackState(@Param('trackId', new ParseUUIDPipe({ version: '4' })) trackId: string) {
    return this.playerService.getPlaybackState(trackId);
  }

  // 3. POST /player/tracks/:trackId/progress
  @Post('tracks/:trackId/progress')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register playback progress',
    description:
      'Saves the current playback position for resume-later functionality. ' +
      'Call this periodically (e.g. every 10s) and on pause/seek. ' +
      'Also used to record track completion when `isCompleted=true`.',
  })
  @ApiParam({ name: 'trackId', format: 'uuid', description: 'Track UUID' })
  @ApiBody({ type: RegisterProgressDto })
  @ApiOkResponse({
    description: 'Progress saved.',
    schema: {
      example: {
        message: 'Playback progress saved successfully',
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        positionSeconds: 97,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @HttpCode(HttpStatus.OK)
  registerProgress(
    @CurrentUser('userId') userId: string,
    @Param('trackId', new ParseUUIDPipe({ version: '4' })) trackId: string,
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
  @Post('tracks/:trackId/play')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mark track as played',
    description:
      'Records a play event for the track, increments the play count, and writes to listening history. ' +
      'Optionally associates the play with a playlist context for analytics. ' +
      'Should be called once per intentional play (not on preview or seek).',
  })
  @ApiParam({ name: 'trackId', format: 'uuid', description: 'Track UUID' })
  @ApiCreatedResponse({
    description: 'Play event recorded.',
    schema: {
      example: {
        message: 'Play event recorded successfully',
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        playCount: 4821,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiQuery({
    name: 'playlistId',
    required: false,
    type: String,
    description: 'Optional playlist context UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  markPlayed(
    @CurrentUser('userId') userId: string,
    @Param('trackId', new ParseUUIDPipe({ version: '4' })) trackId: string,
    @Query('playlistId') playlistId?: string,
  ) {
    if (playlistId) {
      return this.playerService.markPlayed(userId, trackId, playlistId);
    }

    return this.playerService.markPlayed(userId, trackId);
  }

  // 5. GET /player/history/recent
  @Get('history/recent')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get recently played tracks',
    description:
      'Returns the most recently played unique tracks for the authenticated user. ' +
      'Includes resume position so the player can show a "continue listening" UI.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Recently played tracks.',
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 14,
        tracks: [
          {
            trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Layali',
            artist: {
              id: 'usr_456',
              display_name: 'Ahmed Hassan',
            },
            lastPlayedAt: '2026-03-07T17:15:00.000Z',
            lastPositionSeconds: 97,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  getRecentlyPlayed(
    @CurrentUser('userId') userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.playerService.getRecentlyPlayed(userId, pagination.page, pagination.limit);
  }

  // 6. GET /player/history
  @Get('history')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get full listening history',
    description:
      'Returns the full paginated listening history for the authenticated user, ' +
      'including repeat plays of the same track. Each entry records when the track was played, ' +
      'how far the user got, and whether playback completed.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Listening history.',
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 43,
        history: [
          {
            trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Layali',
            playedAt: '2026-03-07T17:15:00.000Z',
            positionSeconds: 97,
            durationSeconds: 240,
            isCompleted: false,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  getHistory(@CurrentUser('userId') userId: string, @Query() pagination: PaginationQueryDto) {
    return this.playerService.getHistory(userId, pagination.page, pagination.limit);
  }

  // 7. DELETE /player/history
  @Delete('history')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Clear listening history',
    description:
      'Permanently deletes all listening history entries for the authenticated user. ' +
      'This also clears resume positions. This action cannot be undone.',
  })
  @ApiOkResponse({
    description: 'History cleared.',
    schema: {
      example: { message: 'Listening history cleared successfully' },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @HttpCode(HttpStatus.OK)
  clearHistory(@CurrentUser('userId') userId: string) {
    return this.playerService.clearHistory(userId);
  }

  // 8. GET /player/tracks/:trackId/resume
  @Get('tracks/:trackId/resume')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get resume position for a track',
    description:
      'Returns the last saved playback position for the given track and authenticated user. ' +
      'Returns `resumePositionSeconds: 0` if the track has never been played.',
  })
  @ApiParam({ name: 'trackId', format: 'uuid', description: 'Track UUID' })
  @ApiOkResponse({
    description: 'Resume position returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        resumePositionSeconds: 97,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  getResumePosition(
    @CurrentUser('userId') userId: string,
    @Param('trackId', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ) {
    return this.playerService.getResumePosition(userId, trackId);
  }

  // 9. GET /player/session
  @Get('session')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current player session / queue',
    description:
      'Restores the full player state for the authenticated user across devices. ' +
      'Use this on app load to resume from wherever the user left off. ' +
      'Returns `null` if no active session exists.',
  })
  @ApiOkResponse({
    description: 'Player session returned.',
    schema: {
      example: {
        currentTrack: {
          trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          title: 'Layali',
        },
        positionSeconds: 97,
        isPlaying: false,
        volume: 0.8,
        shuffle: false,
        repeatMode: 'OFF',
        queue: [
          { trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', title: 'Layali' },
          { trackId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', title: 'Sahar' },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  getSession(@CurrentUser('userId') userId: string) {
    return this.playerService.getSession(userId);
  }

  // 10. PUT /player/session
  @Put('session')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update player session / queue',
    description:
      'Persists the full player state (current track, position, shuffle, repeat, queue) to the backend. ' +
      'Call this on pause, track change, or app background. ' +
      'The beacon alias `POST /player/session` provides the same functionality for `navigator.sendBeacon` on page unload.',
  })
  @ApiBody({ type: UpdateSessionDto })
  @ApiOkResponse({
    description: 'Session updated.',
    schema: {
      example: { message: 'Player session updated successfully' },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @HttpCode(HttpStatus.OK)
  updateSession(@CurrentUser('userId') userId: string, @Body() body: UpdateSessionDto) {
    return this.playerService.updateSession(userId, body);
  }

  // POST alias for PUT /player/session - used by navigator.sendBeacon on page unload
  @Post('session')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  updateSessionBeacon(@CurrentUser('userId') userId: string, @Body() body: UpdateSessionDto) {
    return this.playerService.updateSession(userId, body);
  }

  // 11. GET /player/tracks/:trackId/preview
  @Get('tracks/:trackId/preview')
  @Public()
  @ApiOperation({
    summary: 'Get track preview stream URL',
    description:
      'Public endpoint. Returns a short preview clip URL (typically 30s) for unauthenticated users ' +
      'or FREE-tier users who do not have full access. ' +
      'Use `GET /player/tracks/:trackId/state` first to check if a preview is needed.',
  })
  @ApiParam({ name: 'trackId', format: 'uuid', description: 'Track UUID' })
  @ApiOkResponse({
    description: 'Preview URL returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        previewUrl: 'https://cdn.iqa3.tech/audio/previews/trk_555.mp3',
        previewDurationSeconds: 30,
        accessState: 'PREVIEW',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Track not found or preview unavailable.' })
  getTrackPreview(@Param('trackId', new ParseUUIDPipe({ version: '4' })) trackId: string) {
    return this.playerService.getTrackPreview(trackId);
  }

  // -- Queue management

  // 12. POST /player/queue/load
  @Post('queue/load')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Load a playback queue',
    description:
      'Initialises the backend-managed queue from a context (single track, playlist, artist discography, ' +
      'or an explicit list of track IDs). ' +
      'The backend becomes the sole owner of queue state — call `POST /player/queue/next` / ' +
      '`/previous` to navigate. ' +
      'Ad slots are injected automatically every 3 tracks for FREE-tier users.',
  })
  @ApiBody({ type: LoadQueueDto })
  @ApiOkResponse({
    description: 'Queue loaded. Returns the first track to start playing immediately.',
    schema: {
      example: {
        currentTrack: {
          trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          title: 'Layali',
          artist: 'Ahmed Hassan',
          artistId: 'usr_456',
          artistHandle: 'ahmed-hassan',
          artistAvatarUrl: null,
          cover: 'https://cdn.iqa3.tech/covers/layali.jpg',
          duration: 237,
          genre: 'Arabic Pop',
        },
        currentIndex: 0,
        queueLength: 12,
        tracksUntilAd: 3,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid context type or missing required fields.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Context entity (playlist/artist) not found.' })
  loadQueue(@CurrentUser('userId') userId: string, @Body() body: LoadQueueDto) {
    return this.playerService.loadQueueContext(userId, body);
  }

  // 13. POST /player/queue/next
  @Post('queue/next')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Advance the queue to the next track',
    description:
      'Moves the queue cursor forward and returns the next item. ' +
      'Response `type` is one of: `TRACK` (normal track), `AD` (ad slot for FREE users — show an IQA3 ad), ' +
      'or `ENDED` (queue finished). When `type=AD`, play the ad then call `/next` again.',
  })
  @ApiOkResponse({
    description: 'Next item in queue.',
    schema: {
      examples: {
        track: {
          summary: 'Normal track',
          value: {
            type: 'TRACK',
            track: {
              trackId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
              title: 'Sahar',
              artist: 'Hamza',
              artistId: 'usr_789',
              artistHandle: 'hamza',
              artistAvatarUrl: null,
              cover: null,
              duration: 195,
              genre: null,
            },
            currentIndex: 1,
            queueLength: 12,
            tracksUntilAd: 2,
          },
        },
        ad: {
          summary: 'Ad slot (FREE tier)',
          value: {
            type: 'AD',
            ad: {
              adId: 'ad_001',
              title: 'Upgrade to IQA3 Premium - No Ads',
              durationSeconds: 15,
              clickUrl: null,
            },
            currentIndex: 1,
            queueLength: 12,
            tracksUntilAd: 3,
          },
        },
        ended: {
          summary: 'Queue finished',
          value: { type: 'ENDED', currentIndex: 11, queueLength: 12 },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({
    status: 404,
    description: 'No active queue session. Call POST /player/queue/load first.',
  })
  nextTrack(@CurrentUser('userId') userId: string) {
    return this.playerService.getNextTrackInQueue(userId);
  }

  // 14. POST /player/queue/previous
  @Post('queue/previous')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Go back to the previous track in the queue',
    description:
      'Moves the queue cursor back one position. ' +
      'When `repeatMode` is `ALL` and the cursor is at index 0, wraps around to the last track. ' +
      'Otherwise stays at index 0. ' +
      'Note: `tracksUntilAd` is not included in this response (ad counter is unchanged on previous).',
  })
  @ApiOkResponse({
    description: 'Previous track in queue.',
    schema: {
      example: {
        type: 'TRACK',
        track: {
          trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          title: 'Layali',
          artist: 'Ahmed Hassan',
          artistId: 'usr_456',
          artistHandle: 'ahmed-hassan',
          artistAvatarUrl: null,
          cover: 'https://cdn.iqa3.tech/covers/layali.jpg',
          duration: 237,
          genre: 'Arabic Pop',
        },
        currentIndex: 0,
        queueLength: 12,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'No active queue session.' })
  previousTrack(@CurrentUser('userId') userId: string) {
    return this.playerService.getPreviousTrackInQueue(userId);
  }

  // 15. GET /player/queue
  @Get('queue')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the current backend-managed queue',
    description:
      'Returns the full queue (up to 100 tracks), current index, ad counter, and playback settings. ' +
      'Use this to populate the queue panel UI. ' +
      'Returns 404 if no queue session has been loaded yet.',
  })
  @ApiOkResponse({
    description: 'Queue state.',
    schema: {
      example: {
        queue: [
          {
            trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Layali',
            artist: 'Ahmed Hassan',
            artistId: 'usr_456',
            artistHandle: 'ahmed-hassan',
            artistAvatarUrl: null,
            cover: 'https://cdn.iqa3.tech/covers/layali.jpg',
            duration: 237,
            genre: 'Arabic Pop',
          },
          {
            trackId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
            title: 'Sahar',
            artist: 'Hamza',
            artistId: 'usr_789',
            artistHandle: 'hamza',
            artistAvatarUrl: null,
            cover: null,
            duration: 195,
            genre: null,
          },
        ],
        currentIndex: 0,
        queueLength: 12,
        tracksUntilAd: 3,
        shuffle: false,
        repeatMode: 'OFF',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  getQueue(@CurrentUser('userId') userId: string) {
    return this.playerService.getQueueState(userId);
  }

  // 16. POST /player/queue/jump
  @Post('queue/jump')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Jump to a specific track in the current queue',
    description:
      'Moves the queue cursor directly to the given `trackId`. ' +
      'Resets the ad counter. ' +
      'The track must already be present in the current queue (loaded via `POST /player/queue/load`).',
  })
  @ApiBody({ type: JumpToTrackDto })
  @ApiOkResponse({
    description: 'Queue position updated. Returns the track to play.',
    schema: {
      example: {
        type: 'TRACK',
        track: {
          trackId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          title: 'Sahar',
          artist: 'Hamza',
          artistId: 'usr_789',
          artistHandle: 'hamza',
          artistAvatarUrl: null,
          cover: null,
          duration: 195,
          genre: null,
        },
        currentIndex: 4,
        queueLength: 12,
        tracksUntilAd: 3,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({
    status: 404,
    description: 'No active queue session, or track not found in the current queue.',
  })
  jumpToTrack(@CurrentUser('userId') userId: string, @Body() body: JumpToTrackDto) {
    return this.playerService.jumpToTrackInQueue(userId, body.trackId);
  }
}
