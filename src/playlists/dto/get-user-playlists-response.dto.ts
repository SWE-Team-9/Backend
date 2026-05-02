import { ApiProperty } from '@nestjs/swagger';

export class PlaylistResponseDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiProperty({ example: 'late-night-drive' })
  slug!: string;

  @ApiProperty({ example: null, nullable: true })
  coverImageUrl!: string | null;

  @ApiProperty({ example: 'PUBLIC' })
  visibility!: string;

  @ApiProperty({ example: 48 })
  likesCount!: number;

  @ApiProperty({ example: 12 })
  tracksCount!: number;

  @ApiProperty({ example: 'electronic', nullable: true })
  genre!: string | null;
}

export class PaginatedResponseDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 5 })
  total!: number;

  @ApiProperty({ type: () => PlaylistResponseDto, isArray: true })
  playlists!: PlaylistResponseDto[];
}
