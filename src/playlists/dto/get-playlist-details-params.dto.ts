import { IsNotEmpty, IsString } from 'class-validator';

export class GetPlaylistDetailsParamsDto {
  @IsString()
  @IsNotEmpty()
  playlistId!: string;
}
