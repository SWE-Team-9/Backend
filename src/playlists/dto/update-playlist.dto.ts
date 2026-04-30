import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { PlaylistType } from "@prisma/client";

export class UpdatePlaylistDto {
  @ApiPropertyOptional({
    description: "Playlist title",
    example: "Late Night Drive Vol. 2",
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({
    description: "Optional playlist description",
    example: "My favorite chill tracks",
    maxLength: 5000,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    description: "Playlist visibility",
    enum: ["PUBLIC", "SECRET", "PRIVATE"],
    example: "PRIVATE",
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.toUpperCase().trim() : value,
  )
  @IsIn(["PUBLIC", "SECRET", "PRIVATE"])
  visibility?: "PUBLIC" | "SECRET" | "PRIVATE";

  @ApiPropertyOptional({
    description: "Playlist type",
    enum: PlaylistType,
    example: "ALBUM",
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.toUpperCase().trim() : value,
  )
  @IsEnum(PlaylistType)
  type?: PlaylistType;

  @ApiPropertyOptional({
    description: "Release date for the playlist",
    example: "2026-03-01",
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsDateString()
  releaseDate?: string;

  @ApiPropertyOptional({
    description: "Existing genre identifier from the genres table",
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  genreId?: number;

  @ApiPropertyOptional({
    description: "Simple string tags",
    example: ["chill", "night-drive"],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return value;
    return value
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
      .slice(0, 20);
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
