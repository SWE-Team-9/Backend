import { Type } from 'class-transformer';
import { IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterProgressDto {
  @ApiProperty({ description: 'Current playback position in seconds', example: 97, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds!: number;

  @ApiProperty({ description: 'Total track duration in seconds', example: 240, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds!: number;

  @ApiProperty({
    description: 'Whether the track finished playing (used to record a completion event)',
    example: false,
  })
  @IsBoolean()
  isCompleted!: boolean;
}
