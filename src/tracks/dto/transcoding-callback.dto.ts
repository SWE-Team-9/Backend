import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TrackStatus } from "@prisma/client";

export class TranscodingCallbackDto {
  @ApiProperty({ description: "Track ID", example: "trk_001" })
  @IsString()
  trackId!: string;

  @ApiProperty({
    description: "Processing result status",
    enum: ["FINISHED", "FAILED"],
    example: "FINISHED",
  })
  @IsEnum({ FINISHED: "FINISHED", FAILED: "FAILED" })
  status!: "FINISHED" | "FAILED";

  @ApiPropertyOptional({
    description: "Generated file URLs",
    example: { mp3: "https://...", wav: "https://..." },
  })
  @IsOptional()
  fileUrls?: Record<string, string>;

  @ApiPropertyOptional({
    description: "Waveform amplitude peaks (normalised 0..1)",
    example: [0.1, 0.3, 0.5, 0.8, 0.4],
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  waveformData?: number[];

  @ApiPropertyOptional({
    description: "Track duration in milliseconds",
    example: 210000,
  })
  @IsOptional()
  @IsNumber()
  durationMs?: number;
}
