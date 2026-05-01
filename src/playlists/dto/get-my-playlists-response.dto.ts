import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MyPlaylistItemDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiProperty({ example: 'PUBLIC' })
  visibility!: string;

  @ApiProperty({ example: 12 })
  tracksCount!: number;

  @ApiProperty({ example: 10 })
  likesCount!: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/playlists/pl_101.jpg',
    nullable: true,
  })
  coverImageUrl!: string | null;

  @ApiPropertyOptional({
    example: 'Electronic',
    nullable: true,
  })
  genre!: string | null;
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
