import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

const TRACK_ID_REGEX = /^trk_[a-zA-Z0-9_-]+$/;

export class TranscodingCallbackDto {
  // TODO(Module 4): Protect callback authenticity (signature/shared-secret) at controller/guard level.
  @ApiProperty({
    example: "trk_12345",
    description: "Track ID that finished background processing.",
  })
  @IsString()
  @Matches(TRACK_ID_REGEX, {
    message: "trackId must match project format like trk_12345",
  })
  trackId!: string;

  @ApiProperty({
    example: "FINISHED",
    enum: ["PROCESSING", "FINISHED", "FAILED"],
  })
  @IsString()
  @IsIn(["PROCESSING", "FINISHED", "FAILED"])
  status!: "PROCESSING" | "FINISHED" | "FAILED";

  @ApiPropertyOptional({
    type: "object",
    example: {
      mp3: "https://example.com/audio.mp3",
    },
    description: "Optional processed file URLs from transcoder.",
  })
  // TODO(Module 4): Replace loose object with strict nested DTO when callback schema is finalized.
  @IsOptional()
  fileUrls?: {
    mp3?: string;
  };
}
