import { IsUUID } from "class-validator";

export class JumpToTrackDto {
  @IsUUID("4")
  trackId!: string;
}
