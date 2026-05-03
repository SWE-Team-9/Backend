import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Artist preview information (for tracks within playlist details)
 * Maps from uploader.profile.displayName with fallback to the uploader handle.
 */
export class ArtistPreviewDto {
  @ApiProperty({
    description: 'Artist user ID',
    example: 'usr_456',
  })
  id!: string;

  @ApiProperty({
    description: 'Artist display name (from profile.displayName or username)',
    example: 'DJ Ahmed',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Artist username handle',
    example: 'dj_ahmed',
    type: String,
    nullable: true,
  })
  handle!: string | null;
}

/**
 * Rich Track preview for detailed playlist views
 * Includes full track metadata and artist information
 */
export class PlaylistDetailsTrackDto {
  @ApiProperty({
    description: 'Track unique identifier',
    example: 'trk_123',
  })
  trackId!: string;

  @ApiProperty({
    description: 'Track title',
    example: 'Layali',
  })
  title!: string;

  @ApiPropertyOptional({
    description: 'Track cover art URL',
    example: 'https://cdn.example.com/tracks/trk_123.jpg',
    type: String,
    nullable: true,
  })
  coverArtUrl!: string | null;

  @ApiProperty({
    description: 'Track duration in milliseconds',
    example: 240000,
    type: Number,
  })
  durationMs!: number;

  @ApiProperty({
    description: 'Number of likes on the track',
    example: 156,
    type: Number,
  })
  likesCount!: number;

  @ApiProperty({
    description: 'Number of reposts/shares of the track',
    example: 42,
    type: Number,
  })
  repostsCount!: number;

  @ApiProperty({
    description: 'Track uploader/artist information',
    type: () => ArtistPreviewDto,
  })
  artist!: ArtistPreviewDto;
}