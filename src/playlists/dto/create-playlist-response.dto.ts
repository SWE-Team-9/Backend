import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlaylistOwnerDto {
  @ApiProperty({ example: 'usr_1' })
  id!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  displayName!: string;
}

export class CreatePlaylistResponseDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiProperty({ example: 'PUBLIC' })
  visibility!: string;

  @ApiPropertyOptional({ example: '2e8b35f8-98d2-4f78-8899-b5fb688d809a', nullable: true })
  secretToken!: string | null;

  @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z', nullable: true })
  releaseDate!: string | null;

  @ApiPropertyOptional({ example: 'late-night-drive', nullable: true })
  genre!: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/playlists/pl_101.jpg', nullable: true })
  coverImageUrl!: string | null;

  @ApiProperty({ example: 12 })
  tracksCount!: number;

  @ApiProperty({ example: 0 })
  likesCount!: number;

  @ApiProperty({ example: false })
  isLiked!: boolean;

  @ApiProperty({ type: () => CreatePlaylistOwnerDto })
  owner!: CreatePlaylistOwnerDto;
}