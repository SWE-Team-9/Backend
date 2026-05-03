import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class MoveQueueItemDto {
  @ApiProperty({
    description: 'Target 0-based index to move the track to.',
    minimum: 0,
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  toPosition!: number;
}
