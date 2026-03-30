import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, Min } from "class-validator";

export class RegisterPlaybackProgressDto {
  // TODO(Module 5): Add cross-field rule in implementation: positionSeconds cannot exceed durationSeconds.
  @ApiProperty({ example: 97 })
  @IsInt()
  @Min(0)
  positionSeconds!: number;

  @ApiProperty({ example: 240 })
  @IsInt()
  @Min(1)
  durationSeconds!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  isCompleted!: boolean;
}
