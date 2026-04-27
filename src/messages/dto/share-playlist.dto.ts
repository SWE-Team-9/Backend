import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class SharePlaylistDto {
  @IsUUID()
  receiverId!: string;

  @IsUUID()
  playlistId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
