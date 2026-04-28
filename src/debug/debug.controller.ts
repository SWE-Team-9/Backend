import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PlaylistsService } from '../playlists/playlists.service';
import { PlaylistRecentQueryDto } from '../playlists/dto/playlist-recent-query.dto';

@Controller('debug')
@ApiTags('Debug')
export class DebugController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Get('playlists/recent')
  @Public()
  async recentPlaylists(@Query('userId') userId: string, @Query() query: PlaylistRecentQueryDto) {
    return this.playlistsService.getRecentPlaylists(userId, query.limit);
  }
}
