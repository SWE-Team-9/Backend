import {
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsDateString,
  ArrayMaxSize,
  Allow,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';

export class CreateTrackDto {
  // Multer extracts the file but the field may still appear in req.body;
  // Allow + Exclude prevent forbidNonWhitelisted from rejecting it.
  @Allow()
  @Exclude()
  audioFile?: any;
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
