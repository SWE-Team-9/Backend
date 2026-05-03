import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlaylistType } from '@prisma/client';

@ValidatorConstraint({ name: 'isValidVisibility', async: false })
class IsValidVisibilityConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    if (value === undefined) return true; // optional field
    if (typeof value !== 'string') return false;
    const normalized = value.toLowerCase().trim();
    if (normalized === 'private') return false; // explicitly reject 'private'
    return normalized === 'public' || normalized === 'secret';
  }

  defaultMessage(args: ValidationArguments) {
    return 'visibility must be one of the following values: PUBLIC, SECRET. "PRIVATE" is not allowed.';
  }
}

export class UpdatePlaylistDto {
  @ApiPropertyOptional({
    description: 'Playlist title',
    example: 'Late Night Drive Vol. 2',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

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

  @ApiPropertyOptional({
    description: 'Playlist visibility',
    enum: ['PUBLIC', 'SECRET'],
    example: 'SECRET',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Validate(IsValidVisibilityConstraint)
  visibility?: 'public' | 'secret';

  @ApiPropertyOptional({
    description: 'Playlist type',
    enum: PlaylistType,
    example: 'ALBUM',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsEnum(PlaylistType)
  type?: PlaylistType;

  @ApiPropertyOptional({
    description: 'Release date for the playlist',
    example: '2026-03-01',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsDateString()
  releaseDate?: string;

  @ApiPropertyOptional({
    description: 'Genre slug (must exist in predefined genres)',
    example: 'electronic',
  })
  @IsOptional()
  @IsString()
  genre?: string;

  @ApiPropertyOptional({
    description: 'Simple string tags',
    example: ['chill', 'night-drive'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return value;
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : item))
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .slice(0, 20);
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
