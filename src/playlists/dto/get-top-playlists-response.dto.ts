import { ApiProperty } from "@nestjs/swagger";

export class TopPlaylistItemDto {
  @ApiProperty({ example: "pl_101" })
  playlistId!: string;

  @ApiProperty({ example: "Late Night Drive" })
  title!: string;

  @ApiProperty({ example: "PUBLIC" })
  visibility!: string;

  @ApiProperty({ example: 48 })
  likesCount!: number;
}

export class GetTopPlaylistsResponseDto {
  @ApiProperty({ type: () => TopPlaylistItemDto, isArray: true })
  playlists!: TopPlaylistItemDto[];
}
