import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsInt, IsNumber, IsString, Matches, Max, Min } from "class-validator";

const TRACK_ID_REGEX = /^trk_[a-zA-Z0-9_-]+$/;

export class UpdateQueueSessionDto {
  // TODO(Module 5): Decide whether currentTrackId should be nullable to represent empty player state.
  @ApiProperty({ example: "trk_123" })
  @IsString()
  @Matches(TRACK_ID_REGEX, {
    message: "currentTrackId must match project format like trk_123",
  })
  currentTrackId!: string;

  @ApiProperty({ example: 97 })
  @IsInt()
  @Min(0)
  positionSeconds!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isPlaying!: boolean;

  @ApiProperty({ example: 0.8, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  volume!: number;

  @ApiProperty({ type: [String], example: ["trk_124", "trk_130", "trk_140"] })
  // TODO(Module 5): Enforce queue size cap and duplicate prevention in service implementation.
  @IsArray()
  @IsString({ each: true })
  @Matches(TRACK_ID_REGEX, {
    each: true,
    message: "Each queueTrackId must match project format like trk_124",
  })
  queueTrackIds!: string[];
}
