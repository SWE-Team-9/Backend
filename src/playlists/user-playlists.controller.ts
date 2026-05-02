import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginatedResponseDto, PlaylistPaginationQueryDto } from './dto';
import { PlaylistsService } from './playlists.service';

@ApiTags('Playlists')
@ApiBearerAuth()
@Controller('users')
export class UserPlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Get(':userId/playlists')
  @Public()
  @ApiOperation({
    summary: 'Get user public playlists',
    description:
      'Returns paginated playlists for a user. SECRET playlists are visible only when the requester is the same owner user.',
  })
  @ApiParam({
    name: 'userId',
    example: 'usr_123',
    description: 'Owner user ID',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Paginated public playlists for the requested user.',
    type: PaginatedResponseDto,
  })
  getUserPlaylists(
    @Param('userId') userId: string,
    @Query() query: PlaylistPaginationQueryDto,
    @CurrentUser('userId') requestingUserId?: string,
  ) {
    return this.playlistsService.getUserPlaylists(userId, query, requestingUserId);
  }
}
