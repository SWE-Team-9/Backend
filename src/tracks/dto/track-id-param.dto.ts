import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

const TRACK_ID_REGEX = /^trk_[a-zA-Z0-9_-]+$/;

export class TrackIdParamDto {
  // TODO(Module 4): Replace local regex with shared TrackId validator once common DTO utils exist.
  @ApiProperty({
    example: "trk_12345",
    description: "Track ID in project format (trk_*).",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(TRACK_ID_REGEX, {
    message: "trackId must match project format like trk_12345",
  })
  trackId!: string;
}
