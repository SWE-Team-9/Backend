import { IsNotEmpty, IsString } from "class-validator";

export class DeletePlaylistParamsDto {
  @IsString()
  @IsNotEmpty()
  playlistId!: string;
}
