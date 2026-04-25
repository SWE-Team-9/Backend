import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({
    description: 'Playlist visibility',
    enum: ['PUBLIC', 'SECRET'],
    example: 'PUBLIC',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsString()
  @IsIn(['PUBLIC', 'SECRET'])
  visibility!: string;
}
