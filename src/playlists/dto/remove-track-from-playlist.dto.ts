import { IsNotEmpty, IsString } from 'class-validator';

export class RemoveTrackFromPlaylistParamsDto {
  @IsString()
  @IsNotEmpty()
  playlistId!: string;

  @IsString()
  @IsNotEmpty()
  trackId!: string;
}

export class RemoveTrackFromPlaylistResponseDto {
  message!: string;
}
