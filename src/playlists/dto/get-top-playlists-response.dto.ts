import { ApiProperty } from '@nestjs/swagger';

export class TopPlaylistItemDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiProperty({ example: 'PUBLIC' })
  visibility!: string;

  @ApiProperty({ example: 48 })
  likesCount!: number;
}

export class TopGenrePlaylistsDto {
  @ApiProperty({ example: 'Electronic' })
  genre!: string;

  @ApiProperty({ type: () => TopPlaylistItemDto, isArray: true })
  playlists!: TopPlaylistItemDto[];
}

export class GetTopPlaylistsResponseDto {
  @ApiProperty({ type: () => TopGenrePlaylistsDto, isArray: true })
  genres!: TopGenrePlaylistsDto[];
}
