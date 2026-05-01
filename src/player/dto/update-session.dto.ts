import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum RepeatMode {
  OFF = 'OFF',
  ONE = 'ONE',
  ALL = 'ALL',
}

export class UpdateSessionDto {
  @ApiPropertyOptional({
    description: 'UUID of the track currently loaded in the player',
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID('4')
  currentTrackId?: string;

  @ApiPropertyOptional({
    description: 'Current playback position in seconds',
    example: 97,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds?: number;

  @ApiPropertyOptional({ description: 'Whether the player is currently playing', example: false })
  @IsOptional()
  @IsBoolean()
  isPlaying?: boolean;

  @ApiPropertyOptional({
    description: 'Player volume level (0.0 – 1.0)',
    example: 0.8,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  volume?: number;

  @ApiPropertyOptional({
    description: 'Ordered list of track UUIDs representing the current queue',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'b2c3d4e5-f6a7-8901-bcde-f12345678901'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  queueTrackIds?: string[];

  @ApiPropertyOptional({ description: 'Whether shuffle mode is enabled', example: false })
  @IsOptional()
  @IsBoolean()
  shuffle?: boolean;

  @ApiPropertyOptional({
    description: 'Repeat mode: OFF, ONE (repeat current track), or ALL (repeat queue)',
    enum: RepeatMode,
    example: RepeatMode.OFF,
  })
  @IsOptional()
  @IsEnum(RepeatMode)
  repeatMode?: RepeatMode;
}
