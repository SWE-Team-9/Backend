import { IsNotEmpty, IsString } from "class-validator";

export class ResolveSecretPlaylistParamsDto {
  @IsString()
  @IsNotEmpty()
  secretToken!: string;
}

export class ResolveSecretPlaylistResponseDto {
  playlistId!: string;
  title!: string;
  visibility!: "PRIVATE";
  message!: string;
}
