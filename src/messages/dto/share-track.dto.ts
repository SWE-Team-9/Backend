import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class ShareTrackDto {
  @IsUUID()
  receiverId!: string;

  @IsUUID()
  trackId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
