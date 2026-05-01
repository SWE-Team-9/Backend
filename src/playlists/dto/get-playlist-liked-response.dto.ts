import { ApiProperty } from '@nestjs/swagger';
import { PlaylistItemDto } from './playlist-item.dto';

/**
 * Response DTO for GET /api/v1/playlists/me/liked
 * Returns paginated list of playlists liked by the current user
 */
export class GetPlaylistLikedResponseDto {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
    type: Number,
  })
  page!: number;

  @ApiProperty({
    description: 'Page size (number of items per page)',
    example: 20,
    type: Number,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of liked playlists',
    example: 47,
    type: Number,
  })
  total!: number;

  @ApiProperty({
    description: 'List of liked playlists on current page',
    type: () => PlaylistItemDto,
    isArray: true,
  })
  playlists!: PlaylistItemDto[];
}
