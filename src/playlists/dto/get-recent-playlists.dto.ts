import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecentPlaylistOwnerDto {
  @ApiProperty({ example: 'usr_1' })
  id!: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  display_name!: string;
}

export class RecentPlaylistItemDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'Late Night Drive' })
  title!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/playlists/pl_101.jpg',
    nullable: true,
  })
  coverImageUrl!: string | null;

  @ApiProperty({ type: () => RecentPlaylistOwnerDto })
  owner!: RecentPlaylistOwnerDto;
}

export class GetRecentPlaylistsResponseDto {
  @ApiProperty({ type: () => RecentPlaylistItemDto, isArray: true })
  playlists!: RecentPlaylistItemDto[];
}
