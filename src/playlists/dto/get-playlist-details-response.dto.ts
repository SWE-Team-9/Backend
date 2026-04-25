export class PlaylistDetailsOwnerDto {
  id!: string;

  display_name!: string;
}

export class PlaylistDetailsTrackDto {
  trackId!: string;

  title!: string;
}

export class GetPlaylistDetailsResponseDto {
  playlistId!: string;

  title!: string;

  description!: string | null;

  visibility!: string;

  owner!: PlaylistDetailsOwnerDto;

  tracks!: PlaylistDetailsTrackDto[];
}
