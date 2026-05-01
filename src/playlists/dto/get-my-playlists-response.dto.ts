import { ApiProperty } from '@nestjs/swagger';

export class MyPlaylistItemDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiProperty({ example: 'PUBLIC' })
  visibility!: string;

  @ApiProperty({ example: 12 })
  tracksCount!: number;
}

export class GetMyPlaylistsResponseDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 5 })
  total!: number;

  @ApiProperty({ type: () => MyPlaylistItemDto, isArray: true })
  playlists!: MyPlaylistItemDto[];
}
