import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GetPlaylistEmbedCodeParamsDto {
  @IsString()
  @IsNotEmpty()
  playlistId!: string;
}

export class GetPlaylistEmbedCodeQueryDto {
  @ApiPropertyOptional({ enum: ['light', 'dark'], example: 'dark' })
  @IsOptional()
  @IsIn(['light', 'dark'])
  theme?: 'light' | 'dark';

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoplay?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  start?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hideArtwork?: boolean;

  @ApiPropertyOptional({ example: 480 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(1920)
  width?: number;

  @ApiPropertyOptional({ example: 166 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(120)
  @Max(1080)
  height?: number;
}

export class GetPlaylistEmbedCodeResponseDto {
  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: '<iframe src="https://dev.iqa3.tech/embed/playlists/pl_101"></iframe>' })
  embedCode!: string;
}
