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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlaylistsService } from './playlists.service';
import {
  AddTrackToPlaylistDto,
  CreatePlaylistDto,
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
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
  addTrack(
    @CurrentUser('userId') userId: string,
    @Param('playlistId') playlistId: string,
    @Body() dto: AddTrackToPlaylistDto,
  ) {
    return this.playlistsService.addTrack(userId, playlistId, dto);
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
  getDetails(@Param('playlistId') playlistId: string) {
    return this.playlistsService.getDetails(playlistId);
  }

  @Patch(':playlistId')
  update(
    @CurrentUser('userId') userId: string,
    @Param('playlistId') playlistId: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlistsService.update(userId, playlistId, dto);
  }

  @Delete(':playlistId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('userId') userId: string, @Param('playlistId') playlistId: string) {
    this.playlistsService.remove(userId, playlistId);
  }
}
