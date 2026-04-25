export class MyPlaylistItemDto {
  playlistId!: string;
  title!: string;
  visibility!: string;
  tracksCount!: number;
}

export class GetMyPlaylistsResponseDto {
  page!: number;
  limit!: number;
  total!: number;
  playlists!: MyPlaylistItemDto[];
}
