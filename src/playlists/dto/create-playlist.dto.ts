import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlaylistVisibility } from '@prisma/client';

export class CreatePlaylistDto {
  @ApiProperty({
    description: 'Playlist title',
    example: 'Late Night Drive',
    minLength: 1,
    maxLength: 100,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({
    description: 'Optional playlist description',
    example: 'My favorite chill tracks',
    maxLength: 5000,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({
    description: 'Playlist visibility',
    enum: PlaylistVisibility,
    example: 'PUBLIC',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsEnum(PlaylistVisibility)
  visibility!: PlaylistVisibility;
}
