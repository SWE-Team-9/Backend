import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
//
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottlePolicy } from '../common/decorators/throttle-policy.decorator';
import { TracksService } from './tracks.service';
import {
  CreateTrackDto,
  PaginationQueryDto,
  TrackVisibilityDto,
  TranscodingCallbackDto,
  UpdateTrackDto,
} from './dto';

// ──────────────────────────────────────────────────────────────────────────────
// The multer config: keep file in memory buffer (no disk temp files).
// Max 250 MB. Only accept audio MIME types.
// ──────────────────────────────────────────────────────────────────────────────
const AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav'];
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const UPLOAD_OPTIONS = {
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (
    _req: any,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (file.fieldname === 'audioFile') {
      if (AUDIO_MIMES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Only MP3 and WAV audio files are allowed.'), false);
      }
    } else if (file.fieldname === 'coverArt') {
      if (IMAGE_MIMES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new BadRequestException('Only JPEG, PNG, and WebP images are allowed for cover art.'),
          false,
        );
      }
    } else {
      cb(null, false);
    }
  },
};

@ApiTags('Tracks')
@ApiBearerAuth()
@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  // ─── Endpoint 1: POST /tracks - Upload a new track ────────────────────
  @ApiOperation({
    summary: 'Upload a new audio track',
    description:
      'Accepts a multipart/form-data request containing an audio file (MP3 or WAV, max 250 MB) ' +
      'and track metadata. The file is validated by magic bytes (not just MIME type) to prevent ' +
      'disguised uploads. Returns immediately with status=PROCESSING - the frontend should poll ' +
      'GET /tracks/{trackId}/status until it becomes FINISHED or FAILED. ' +
      'Rate limited to 5 uploads per minute per user.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Audio file with track metadata',
    schema: {
      type: 'object',
      required: ['audioFile', 'title'],
      properties: {
        audioFile: {
          type: 'string',
          format: 'binary',
          description: 'MP3 or WAV file (max 250 MB)',
        },
        coverArt: {
          type: 'string',
          format: 'binary',
          description: 'Optional cover art image (JPEG, PNG, or WebP, max 15 MB)',
        },
        title: { type: 'string', maxLength: 100, example: 'Ya Ana' },
        genre: {
          type: 'string',
          example: 'Pop',
          description: 'Must match an existing genre name',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          example: ['pop', 'arabic'],
          description: 'Max 10 tags, 30 chars each',
        },
        releaseDate: { type: 'string', format: 'date', example: '2026-03-01' },
        description: { type: 'string', maxLength: 5000 },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Track upload accepted - processing started.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Ya Ana',
        artistId: 'user_123',
        status: 'PROCESSING',
        visibility: 'PRIVATE',
        coverArtUrl: null,
        waveformData: null,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid file or metadata - file missing, too large, not a real audio file, invalid genre, or validation errors.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid audio file. Only MP3 and WAV files are accepted.',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated - missing or invalid JWT cookie.',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 403,
    description: 'Upload quota reached - user must upgrade their plan to upload more tracks.',
    schema: {
      example: {
        statusCode: 403,
        message: 'You have reached your upload limit. Upgrade your plan to upload more tracks.',
        error: 'Forbidden',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (5 uploads per minute).',
  })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ThrottlePolicy(5, 60_000)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'audioFile', maxCount: 1 },
        { name: 'coverArt', maxCount: 1 },
      ],
      UPLOAD_OPTIONS,
    ),
  )
  async uploadTrack(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTrackDto,
    @UploadedFiles()
    files: {
      audioFile?: Express.Multer.File[];
      coverArt?: Express.Multer.File[];
    },
  ) {
    const audioFile = files?.audioFile?.[0] as Express.Multer.File;
    const coverArt = files?.coverArt?.[0];
    return this.tracksService.uploadTrack(userId, dto, audioFile, coverArt);
  }

  // ─── Endpoint 10: GET /tracks/secret/:secretToken - Resolve private track ─
  // (must be declared BEFORE :trackId routes to avoid param collision)
  @ApiOperation({
    summary: 'Access a private track via secret token',
    description:
      'Returns full track details for a private track using its unique secret share link. ' +
      'This endpoint is public - no authentication required. ' +
      'A new secret token is generated every time a track is switched to PRIVATE, ' +
      'so old links become invalid.',
  })
  @ApiParam({
    name: 'secretToken',
    description: 'Nanoid secret token (24 characters) from the share link',
    example: 'V1StGXR8_Z5jdHi6B-myT-RQ',
  })
  @ApiResponse({
    status: 200,
    description: 'Track details returned - access granted via secret token.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Unreleased Demo',
        slug: 'unreleased-demo',
        artist: 'Amr Diab',
        artistId: 'usr_456',
        artistHandle: 'amrdiab',
        artistAvatarUrl: 'https://example.com/avatars/amrdiab.jpg',
        genre: 'Pop',
        tags: ['pop', '2026'],
        releaseDate: '2026-03-06T00:00:00.000Z',
        visibility: 'PRIVATE',
        status: 'FINISHED',
        waveformData: [0.1, 0.3, 0.5, 0.7, 0.4],
        likesCount: 0,
        repostsCount: 0,
        message: 'Access granted via secret token',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Token is invalid, expired (track switched visibility), or track was deleted.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found or token is invalid.',
        error: 'Not Found',
      },
    },
  })
  @Get('secret/:secretToken')
  @Public()
  async getTrackBySecretToken(@Param('secretToken') secretToken: string) {
    return this.tracksService.getTrackBySecretToken(secretToken);
  }

  // ─── Endpoint 9: POST /tracks/transcoding/callback - Internal callback ─
  @ApiOperation({
    summary: 'Transcoding service callback (internal)',
    description:
      'Called by the transcoding service when audio processing is complete. ' +
      'Protected by a shared API key in the x-api-key header (NOT JWT). ' +
      'Updates the track status to FINISHED or FAILED and stores generated file references. ' +
      'Uses constant-time comparison for the API key to prevent timing attacks. ' +
      'This endpoint is not intended for frontend use.',
  })
  @ApiHeader({
    name: 'x-api-key',
    description: 'Shared secret API key for the transcoding service',
    required: true,
    example: 'your-transcoding-api-key',
  })
  @ApiBody({ type: TranscodingCallbackDto })
  @ApiResponse({
    status: 200,
    description: 'Track status updated successfully.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        status: 'FINISHED',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Transcoding API key is not configured on the server.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Transcoding API key is not configured.',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or missing API key.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid transcoding API key.',
        error: 'Unauthorized',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Track is not in PROCESSING state (already finished or failed).',
    schema: {
      example: {
        statusCode: 409,
        message: 'Track is not in PROCESSING state.',
        error: 'Conflict',
      },
    },
  })
  @Post('transcoding/callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  async transcodingCallback(
    @Headers('x-api-key') apiKey: string,
    @Body() dto: TranscodingCallbackDto,
  ) {
    return this.tracksService.handleTranscodingCallback(apiKey, dto);
  }

  // ─── Endpoint 2: GET /tracks/:trackId - Get track details ─────────────
  @ApiOperation({
    summary: 'Get full track details',
    description:
      'Returns complete track metadata including artist info, genre, tags, waveform data, and files. ' +
      'Public tracks are visible to everyone. Private tracks are only visible to the owner - ' +
      'other users receive a 404 (to avoid leaking the existence of private tracks). ' +
      'Use GET /tracks/secret/{secretToken} for sharing private tracks externally.',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Full track details returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Ya Ana',
        slug: 'ya-ana',
        description: 'Latest single from the album',
        artist: 'Amr Diab',
        artistId: 'usr_456',
        artistHandle: 'amrdiab',
        artistAvatarUrl: 'https://example.com/avatars/amrdiab.jpg',
        genre: 'Pop',
        tags: ['pop', '2026'],
        releaseDate: '2026-03-06T00:00:00.000Z',
        durationMs: 215000,
        waveformData: [0.1, 0.3, 0.5, 0.7, 0.4],
        visibility: 'PUBLIC',
        accessLevel: 'PUBLIC',
        status: 'FINISHED',
        license: 'ALL_RIGHTS_RESERVED',
        allowComments: true,
        downloadable: false,
        coverArtUrl: 'https://example.com/covers/ya-ana.jpg',
        secretToken: null,
        publishedAt: '2026-03-06T12:00:00.000Z',
        createdAt: '2026-03-06T11:00:00.000Z',
        updatedAt: '2026-03-06T12:00:00.000Z',
        files: [
          {
            id: 'file_001',
            role: 'ORIGINAL',
            mimeType: 'audio/mpeg',
            format: 'mp3',
            size: 8500000,
            status: 'READY',
          },
        ],
        likesCount: 12,
        repostsCount: 3,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found, deleted, or private (and requester is not the owner).',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @Get(':trackId')
  @Public()
  async getTrack(@Param('trackId', ParseUUIDPipe) trackId: string, @Req() req: Request) {
    const requesterId = (req as any).user?.userId;
    return this.tracksService.getTrackById(trackId, requesterId);
  }

  // ─── Endpoint 3: GET /tracks/:trackId/status - Lightweight polling ────
  @ApiOperation({
    summary: 'Get track processing status (lightweight)',
    description:
      'Returns only the trackId and current status - designed for polling after upload. ' +
      'The frontend should call this every few seconds after uploading until status is ' +
      'FINISHED or FAILED. Private tracks return 404 for non-owners.',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Current track processing status.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        status: 'PROCESSING',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found or private (requester is not the owner).',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @Get(':trackId/status')
  @Public()
  async getTrackStatus(@Param('trackId', ParseUUIDPipe) trackId: string, @Req() req: Request) {
    const requesterId = (req as any).user?.userId;
    return this.tracksService.getTrackStatus(trackId, requesterId);
  }

  // ─── Endpoint 8: GET /tracks/:trackId/waveform - Waveform data ────────
  @ApiOperation({
    summary: 'Get track waveform data',
    description:
      'Returns only the waveform amplitude array for a track - lightweight endpoint for rendering. ' +
      'Returns null waveformData if the track is still processing (status≠FINISHED).',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Waveform data for the track.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        waveformData: [0.1, 0.3, 0.5, 0.8, 0.6, 0.4, 0.2, 0.7, 0.9, 0.3],
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found or deleted.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @Get(':trackId/waveform')
  @Public()
  async getWaveform(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.tracksService.getWaveform(trackId);
  }

  // ─── Endpoint 4: PUT /tracks/:trackId - Update track metadata ─────────
  @ApiOperation({
    summary: 'Update track metadata (owner only)',
    description:
      'Updates one or more metadata fields for a track. Only the track owner can update. ' +
      'All fields are optional - only provided fields are changed. ' +
      'Changing the title automatically regenerates the slug. ' +
      'Tags are replaced entirely (not merged) when provided. ' +
      'An optional cover art image can also be uploaded in the same request.',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 100, example: 'New Title' },
        genre: { type: 'string', example: 'Pop' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          example: ['summer', 'hit'],
        },
        releaseDate: { type: 'string', format: 'date', example: '2026-03-01' },
        description: { type: 'string', maxLength: 5000 },
        coverArt: {
          type: 'string',
          format: 'binary',
          description: 'Optional cover art image (JPEG, PNG, or WebP)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Updated track details returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'New Title',
        slug: 'new-title',
        artist: 'Amr Diab',
        genre: 'Pop',
        tags: ['summer', 'hit'],
        status: 'FINISHED',
        visibility: 'PUBLIC',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error (genre not found, title too long, etc.).',
    schema: {
      example: {
        statusCode: 400,
        message: 'Genre "NonExistent" not found.',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated.',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user is not the track owner.',
    schema: {
      example: {
        statusCode: 403,
        message: 'You do not have permission to modify this track.',
        error: 'Forbidden',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found or deleted.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Cannot edit track while it is still processing.',
    schema: {
      example: {
        statusCode: 409,
        message: 'Cannot edit track while it is still processing.',
        error: 'Conflict',
      },
    },
  })
  @Put(':trackId')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  @UseInterceptors(FileFieldsInterceptor([{ name: 'coverArt', maxCount: 1 }], UPLOAD_OPTIONS))
  async updateTrack(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateTrackDto,
    @UploadedFiles()
    files: {
      coverArt?: Express.Multer.File[];
    },
  ) {
    const coverArt = files?.coverArt?.[0];
    return this.tracksService.updateTrack(trackId, userId, dto, coverArt);
  }

  // ─── Endpoint 5: DELETE /tracks/:trackId - Soft-delete track ──────────
  @ApiOperation({
    summary: 'Delete a track (owner or admin)',
    description:
      'Soft-deletes a track by setting its deletedAt timestamp. ' +
      'Only the track owner or an ADMIN user can delete. ' +
      'Returns 204 No Content on success - no response body. ' +
      'Associated files (S3 or local) are cleaned up asynchronously in the background.',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 204,
    description: 'Track deleted successfully - no response body.',
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated.',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 403,
    description: 'User is not the track owner and not an admin.',
    schema: {
      example: {
        statusCode: 403,
        message: 'You do not have permission to delete this track.',
        error: 'Forbidden',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found or already deleted.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @Delete(':trackId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTrack(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: string,
  ) {
    await this.tracksService.deleteTrack(trackId, userId, role);
  }

  // ─── Endpoint 7: PATCH /tracks/:trackId/visibility - Toggle visibility ─
  @ApiOperation({
    summary: 'Change track visibility (owner only)',
    description:
      'Sets the track visibility to PUBLIC or PRIVATE. Only the track owner can change visibility. ' +
      'When switching to PRIVATE, a new secret token is generated (old share links become invalid). ' +
      'When switching to PUBLIC for the first time, the publishedAt timestamp is set.',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({ type: TrackVisibilityDto })
  @ApiResponse({
    status: 200,
    description: 'Track visibility updated - full track details returned.',
    schema: {
      example: {
        trackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: 'Ya Ana',
        visibility: 'PUBLIC',
        status: 'FINISHED',
        publishedAt: '2026-03-06T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated.',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 403,
    description: 'User is not the track owner.',
    schema: {
      example: {
        statusCode: 403,
        message: 'You do not have permission to modify this track.',
        error: 'Forbidden',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Track not found or deleted.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Track not found.',
        error: 'Not Found',
      },
    },
  })
  @Patch(':trackId/visibility')
  async changeVisibility(
    @Param('trackId', ParseUUIDPipe) trackId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: TrackVisibilityDto,
  ) {
    return this.tracksService.changeVisibility(trackId, userId, dto.visibility);
  }
}
