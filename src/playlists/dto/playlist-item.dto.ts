import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standardized Playlist Item DTO
 * Used by: GET /api/v1/playlists/me, /top, /recent, /me/liked
 * Represents a playlist card with core information for display in list views.
 */
export class PlaylistOwnerDto {
  @ApiProperty({
    description: 'Owner user ID',
    example: 'usr_1',
  })
  id!: string;

  @ApiProperty({
    description: 'Owner display name',
    example: 'Ahmed Hassan',
  })
  displayName!: string;
}

export class PlaylistItemDto {
  @ApiProperty({
    description: 'Playlist unique identifier',
    example: 'pl_101',
  })
  playlistId!: string;

  @ApiProperty({
    description: 'Playlist title',
    example: 'Late Night Drive',
  })
  title!: string;

  @ApiProperty({
    description: 'Playlist visibility level',
    enum: ['PUBLIC', 'SECRET'],
    example: 'PUBLIC',
  })
  visibility!: string;

  @ApiProperty({
    description: 'Total number of tracks in playlist',
    example: 12,
    type: Number,
  })
  tracksCount!: number;

  @ApiProperty({
    description: 'Total number of likes on the playlist',
    example: 48,
    type: Number,
  })
  likesCount!: number;

  @ApiProperty({
    description: 'Whether the current user has liked this playlist',
    example: false,
    type: Boolean,
  })
  isLiked!: boolean;

  @ApiPropertyOptional({
    description: 'Playlist cover image URL',
    example: 'https://cdn.example.com/playlists/pl_101.jpg',
    type: String,
    nullable: true,
  })
  coverImageUrl!: string | null;

  @ApiPropertyOptional({
    description: 'Playlist genre slug',
    example: 'electronic',
    type: String,
    nullable: true,
  })
  genre!: string | null;

  @ApiProperty({
    description: 'Playlist owner information',
    type: () => PlaylistOwnerDto,
  })
  owner!: PlaylistOwnerDto;
}
