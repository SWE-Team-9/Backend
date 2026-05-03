import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlaylistType } from '@prisma/client';

export class GetPlaylistEditResponseDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiPropertyOptional({ example: 'My favorite chill tracks', nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['PUBLIC', 'SECRET'], example: 'PUBLIC' })
  visibility!: 'PUBLIC' | 'SECRET';

  @ApiProperty({ example: 'late-night-drive' })
  slug!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/playlists/pl_101.jpg',
    nullable: true,
  })
  coverImageUrl!: string | null;

  @ApiProperty({ enum: PlaylistType, example: 'PLAYLIST' })
  type!: PlaylistType;

  @ApiPropertyOptional({ example: '2026-03-01', nullable: true })
  releaseDate!: string | null;

  @ApiPropertyOptional({ example: 'electronic', nullable: true })
  genre!: string | null;

  @ApiProperty({ type: [String], example: ['chill', 'night-drive'] })
  tags!: string[];
}
