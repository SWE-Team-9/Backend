import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlaylistDetailsTrackDto, ArtistPreviewDto } from './track-details.dto';

export class PlaylistDetailsOwnerDto {
  @ApiProperty({ example: 'usr_1' })
  id!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  displayName!: string;
}

export class GetPlaylistDetailsResponseDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiPropertyOptional({ example: 'My favorite chill tracks', nullable: true })
  description!: string | null;

  @ApiProperty({ example: 'PUBLIC' })
  visibility!: string;

  @ApiPropertyOptional({
    example: '2e8b35f8-98d2-4f78-8899-b5fb688d809a',
    nullable: true,
    description: 'Returned only when requester is the playlist owner.',
  })
  secretToken?: string | null;

  @ApiPropertyOptional({
    example: 'Electronic',
    nullable: true,
  })
  genre!: string | null;

  @ApiPropertyOptional({
    example: '2026-03-01T00:00:00.000Z',
    nullable: true,
  })
  releaseDate!: string | null;

  @ApiProperty({ type: () => PlaylistDetailsOwnerDto })
  owner!: PlaylistDetailsOwnerDto;

  @ApiProperty({ type: () => PlaylistDetailsTrackDto, isArray: true })
  tracks!: PlaylistDetailsTrackDto[];
}
