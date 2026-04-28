import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ReportTargetType } from "@prisma/client";

export class DiscoveryUserResultDto {
  @ApiProperty({ example: "usr_123" })
  userId!: string;

  @ApiProperty({ example: "nightowl" })
  handle!: string;

  @ApiProperty({ example: "Night Owl" })
  displayName!: string;

  @ApiPropertyOptional({ example: "https://cdn.example.com/avatar.jpg", nullable: true })
  avatarUrl!: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/avatar.jpg", nullable: true })
  avatar_url!: string | null;
}

export class DiscoveryTrackResultDto {
  @ApiProperty({ example: "trk_123" })
  id!: string;

  @ApiProperty({ example: "Night Drive" })
  title!: string;

  @ApiProperty({ example: "night-drive" })
  slug!: string;

  @ApiPropertyOptional({ example: "Late-night synthwave track", nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/cover.jpg", nullable: true })
  coverArtUrl!: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/cover.jpg", nullable: true })
  coverArt!: string | null;

  @ApiPropertyOptional({ example: "synthwave", nullable: true })
  genre!: string | null;

  @ApiProperty({ example: "nightowl" })
  artist_handle!: string;
}

export class DiscoveryPlaylistResultDto {
  @ApiProperty({ example: "pl_123" })
  id!: string;

  @ApiProperty({ example: "Night Drive Mix" })
  title!: string;

  @ApiProperty({ example: "night-drive-mix" })
  slug!: string;

  @ApiPropertyOptional({ example: "Late-night playlist", nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/playlist-cover.jpg", nullable: true })
  coverArtUrl!: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/playlist-cover.jpg", nullable: true })
  coverArt!: string | null;

  @ApiProperty({ example: "nightowl" })
  owner_handle!: string;
}

export class DiscoverySearchResultsDto {
  @ApiProperty({ type: () => DiscoveryTrackResultDto, isArray: true })
  tracks!: DiscoveryTrackResultDto[];

  @ApiProperty({ type: () => DiscoveryUserResultDto, isArray: true })
  users!: DiscoveryUserResultDto[];

  @ApiProperty({ type: () => DiscoveryPlaylistResultDto, isArray: true })
  playlists!: DiscoveryPlaylistResultDto[];
}

export class DiscoverySearchTotalsDto {
  @ApiProperty({ example: 12 })
  tracks!: number;

  @ApiProperty({ example: 4 })
  users!: number;

  @ApiProperty({ example: 3 })
  playlists!: number;
}

export class DiscoverySearchResponseDto {
  @ApiProperty({ example: "lofi chill" })
  query!: string;

  @ApiProperty({ type: () => DiscoverySearchResultsDto })
  results!: DiscoverySearchResultsDto;

  @ApiProperty({ type: () => DiscoverySearchTotalsDto })
  totals!: DiscoverySearchTotalsDto;
}

export class DiscoveryResolveResponseDto {
  @ApiProperty({ example: true })
  matched!: boolean;

  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.TRACK })
  resourceType!: ReportTargetType;

  @ApiPropertyOptional({ example: "trk_123" })
  id?: string;

  @ApiPropertyOptional({ example: "nightowl" })
  handle?: string;

  @ApiPropertyOptional({ example: "Night Owl" })
  displayName?: string;

  @ApiPropertyOptional({ example: "https://cdn.example.com/avatar.jpg", nullable: true })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/avatar.jpg", nullable: true })
  avatar_url?: string | null;

  @ApiPropertyOptional({ example: "Night Drive" })
  title?: string;

  @ApiPropertyOptional({ example: "Late-night synthwave track", nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ example: "night-drive" })
  slug?: string;

  @ApiPropertyOptional({ example: "https://cdn.example.com/cover.jpg", nullable: true })
  coverArtUrl?: string | null;

  @ApiPropertyOptional({ example: "https://cdn.example.com/cover.jpg", nullable: true })
  coverArt?: string | null;

  @ApiPropertyOptional({ example: "synthwave", nullable: true })
  genre?: string | null;

  @ApiPropertyOptional({ example: "nightowl" })
  artist_handle?: string | null;

  @ApiPropertyOptional({ example: "nightowl" })
  owner_handle?: string | null;
}
