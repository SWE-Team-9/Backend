import { ApiProperty } from '@nestjs/swagger';
import { PlaylistItemDto } from './playlist-item.dto';

export class GetMyPlaylistsResponseDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 5 })
  total!: number;

  @ApiProperty({ type: () => PlaylistItemDto, isArray: true })
  playlists!: PlaylistItemDto[];
}
