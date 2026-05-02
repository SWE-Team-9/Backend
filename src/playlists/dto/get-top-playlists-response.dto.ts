import { ApiProperty } from '@nestjs/swagger';
import { PlaylistItemDto } from './playlist-item.dto';

export class TopGenrePlaylistsDto {
  @ApiProperty({ example: 'electronic' })
  genre!: string;

  @ApiProperty({ type: () => PlaylistItemDto, isArray: true })
  playlists!: PlaylistItemDto[];
}

export class GetTopPlaylistsResponseDto {
  @ApiProperty({ type: () => TopGenrePlaylistsDto, isArray: true })
  genres!: TopGenrePlaylistsDto[];
}
