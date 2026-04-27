import { Transform } from "class-transformer";
import { IsNotEmpty, IsString } from "class-validator";

export class AddTrackToPlaylistDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  trackId!: string;
}

export class AddTrackToPlaylistResponseDto {
  message!: string;
  playlistId!: string;
  trackId!: string;
}
