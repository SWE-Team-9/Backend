import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsDateString,
  ArrayMaxSize,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
//
export class CreateTrackDto {
  @ApiProperty({ description: 'Track title', example: 'Ya Ana', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({ description: 'Genre name (must match existing genre)', example: 'Pop' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  genre?: string;

  @ApiPropertyOptional({
    description: 'Array of tag strings',
    example: ['pop', 'arabic'],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.map(String);
    // Multipart sends a single tag as a plain string — wrap it in an array
    if (typeof value === 'string') return [value];
    return value;
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[];

  @ApiPropertyOptional({ description: 'Release date (ISO 8601)', example: '2026-03-01' })
  @IsOptional()
  @IsDateString()
  releaseDate?: string;

  @ApiPropertyOptional({ description: 'Track description', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}
