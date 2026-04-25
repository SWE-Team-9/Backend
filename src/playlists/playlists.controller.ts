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
  GetPlaylistDetailsResponseDto,
  GetPlaylistDetailsParamsDto,
  PlaylistPaginationQueryDto,
  ReorderPlaylistTracksDto,
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
  resolveSecret(@Param('secretToken') secretToken: string) {
    return this.playlistsService.resolveSecret(secretToken);
  }

  @Get(':playlistId/embed')
  getEmbedCode(@Param('playlistId') playlistId: string) {
    return this.playlistsService.getEmbedCode(playlistId);
  }

  @Post(':playlistId/tracks')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  addTrack(
    @CurrentUser('userId') userId: string,
    @Param() params: GetPlaylistDetailsParamsDto,
    @Body() dto: AddTrackToPlaylistDto,
  ) {
    return this.playlistsService.addTrack(userId, params.playlistId, dto);
  }

  @Delete(':playlistId/tracks/:trackId')
  removeTrack(
    @CurrentUser('userId') userId: string,
    @Param('playlistId') playlistId: string,
    @Param('trackId') trackId: string,
  ) {
    return this.playlistsService.removeTrack(userId, playlistId, trackId);
  }

  @Patch(':playlistId/reorder')
  reorderTracks(
    @CurrentUser('userId') userId: string,
    @Param('playlistId') playlistId: string,
    @Body() dto: ReorderPlaylistTracksDto,
  ) {
    return this.playlistsService.reorderTracks(userId, playlistId, dto);
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
