import { ApiProperty } from '@nestjs/swagger';
import { PlaylistItemDto } from './playlist-item.dto';

export class GetRecentPlaylistsResponseDto {
  @ApiProperty({ type: () => PlaylistItemDto, isArray: true })
  playlists!: PlaylistItemDto[];
}
