import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlaylistsService } from './playlists.service';
import {
  AddTrackToPlaylistDto,
  CreatePlaylistDto,
  DeletePlaylistParamsDto,
  GetPlaylistEmbedCodeParamsDto,
  GetPlaylistEmbedCodeResponseDto,
  GetPlaylistDetailsResponseDto,
  GetPlaylistDetailsParamsDto,
  PlaylistPaginationQueryDto,
  RemoveTrackFromPlaylistParamsDto,
  ReorderPlaylistTracksDto,
  ResolveSecretPlaylistParamsDto,
  ResolveSecretPlaylistResponseDto,
  UpdatePlaylistDto,
} from './dto';

@Controller('playlists')
@ApiTags('Playlists')
@ApiBearerAuth()
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Create playlist',
    description: 'Creates a new playlist (set) for the authenticated user.',
  })
  @ApiBody({ type: CreatePlaylistDto })
  @ApiResponse({
    status: 201,
    description: 'Playlist created successfully.',
    schema: {
      example: {
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        visibility: 'PUBLIC',
        secretToken: null,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreatePlaylistDto) {
    return this.playlistsService.create(userId, dto);
  }

  @Get('me')
  getMyPlaylists(
    @CurrentUser('userId') userId: string,
    @Query() query: PlaylistPaginationQueryDto,
  ) {
    return this.playlistsService.getMyPlaylists(userId, query);
  }

  @Get('secret/:secretToken')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Resolve secret playlist access',
    description:
      'Allows access to a private/secret playlist via an unguessable tokenized link.',
  })
  @ApiParam({
    name: 'secretToken',
    description: 'Secret share token for a private playlist',
    example: 'sec_9f1d2a3b4c5d6e7f8a9b0c',
  })
  @ApiResponse({
    status: 200,
    description: 'Access granted via secret token.',
    type: ResolveSecretPlaylistResponseDto,
    schema: {
      example: {
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        visibility: 'PRIVATE',
        message: 'Access granted via secret token',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Secret playlist not found.' })
  resolveSecret(@Param() params: ResolveSecretPlaylistParamsDto) {
    return this.playlistsService.resolveSecret(params.secretToken);
  }

  @Get(':playlistId/embed')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Get playlist embed code',
    description: 'Returns a simple iframe embed code for externally sharing a playlist.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiResponse({
    status: 200,
    description: 'Playlist embed code generated successfully.',
    type: GetPlaylistEmbedCodeResponseDto,
    schema: {
      example: {
        playlistId: 'pl_101',
        embedCode: '<iframe src="https://example.com/embed/playlists/pl_101"></iframe>',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Only playlist owner can access embed code.' })
  @ApiResponse({ status: 404, description: 'Playlist not found.' })
  getEmbedCode(
    @CurrentUser('userId') userId: string,
    @Param() params: GetPlaylistEmbedCodeParamsDto,
  ) {
    return this.playlistsService.getEmbedCode(userId, params.playlistId);
  }

  @Post(':playlistId/tracks')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Add track to playlist',
    description: 'Adds a track to an existing playlist. Owner only.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiBody({
    type: AddTrackToPlaylistDto,
    schema: {
      example: {
        trackId: 'trk_123',
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Track added to playlist successfully.',
    schema: {
      example: {
        message: 'Track added to playlist successfully',
        playlistId: 'pl_101',
        trackId: 'trk_123',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Only playlist owner can add tracks.' })
  @ApiResponse({ status: 404, description: 'Playlist or track not found.' })
  @ApiResponse({ status: 409, description: 'Track already exists in playlist.' })
  addTrack(
    @CurrentUser('userId') userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: AddTrackToPlaylistDto,
  ) {
    return this.playlistsService.addTrack(userId, params.playlistId, dto);
  }

  @Delete(':playlistId/tracks/:trackId')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Remove track from playlist',
    description: 'Removes a track from a playlist. Owner only.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiParam({
    name: 'trackId',
    description: 'Track identifier',
    example: 'trk_123',
  })
  @ApiResponse({
    status: 200,
    description: 'Track removed from playlist successfully.',
    schema: {
      example: {
        message: 'Track removed from playlist successfully',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Only playlist owner can remove tracks.' })
  @ApiResponse({ status: 404, description: 'Playlist not found or track is not in playlist.' })
  removeTrack(
    @CurrentUser('userId') userId: string,
    @Param() params: RemoveTrackFromPlaylistParamsDto,
  ) {
    return this.playlistsService.removeTrack(userId, params.playlistId, params.trackId);
  }

  @Patch(':playlistId/reorder')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Reorder playlist tracks',
    description: 'Reorders tracks inside a playlist. Owner only.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiBody({
    type: ReorderPlaylistTracksDto,
    schema: {
      example: {
        orderedTrackIds: ['trk_8', 'trk_3', 'trk_10', 'trk_2'],
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Playlist reordered successfully.',
    schema: {
      example: {
        message: 'Playlist reordered successfully',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error or invalid reorder payload.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Only playlist owner can reorder tracks.' })
  @ApiResponse({ status: 404, description: 'Playlist not found or some track IDs are invalid.' })
  reorderTracks(
    @CurrentUser('userId') userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: ReorderPlaylistTracksDto,
  ) {
    return this.playlistsService.reorderTracks(userId, params.playlistId, dto);
  }

  @Get(':playlistId')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Get playlist details',
    description: 'Returns playlist details and its tracks.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiResponse({
    status: 200,
    description: 'Playlist details fetched successfully.',
    type: GetPlaylistDetailsResponseDto,
    schema: {
      example: {
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        description: 'My favorite chill tracks',
        visibility: 'PUBLIC',
        owner: {
          id: 'usr_1',
          display_name: 'Ahmed Hassan',
        },
        tracks: [
          {
            trackId: 'trk_123',
            title: 'Layali',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Playlist not found.' })
  getDetails(@Param() params: GetPlaylistDetailsParamsDto) {
    return this.playlistsService.getDetails(params.playlistId);
  }

  @Patch(':playlistId')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Update playlist',
    description: 'Updates playlist title, description, or visibility. Owner only.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiBody({
    type: UpdatePlaylistDto,
    schema: {
      example: {
        title: 'Late Night Drive Vol. 2',
        visibility: 'PRIVATE',
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Playlist updated successfully.',
    schema: {
      example: {
        message: 'Playlist updated successfully',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error or empty update payload.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Only playlist owner can update this playlist.' })
  @ApiResponse({ status: 404, description: 'Playlist not found.' })
  update(
    @CurrentUser('userId') userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlistsService.update(userId, params.playlistId, dto);
  }

  @Delete(':playlistId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({
    summary: 'Delete playlist',
    description: 'Permanently deletes a playlist. Owner only.',
  })
  @ApiParam({
    name: 'playlistId',
    description: 'Playlist identifier',
    example: 'pl_101',
  })
  @ApiResponse({ status: 204, description: 'Playlist deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Only playlist owner can delete this playlist.' })
  @ApiResponse({ status: 404, description: 'Playlist not found.' })
  remove(@CurrentUser('userId') userId: string, @Param() params: DeletePlaylistParamsDto) {
    this.playlistsService.remove(userId, params.playlistId);
  }
}
