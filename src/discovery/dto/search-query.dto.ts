import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const SEARCH_TYPES = ["all", "tracks", "users", "playlists"] as const;
type SearchType = (typeof SEARCH_TYPES)[number];

export class SearchQueryDto {
  @ApiProperty({
    description: "Search query text",
    example: "lofi chill",
    maxLength: 120,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({
    description: "Result category filter",
    enum: SEARCH_TYPES,
    default: "all",
  })
  @IsOptional()
  @IsString()
  @IsIn(SEARCH_TYPES)
  type?: SearchType = "all";

  @ApiPropertyOptional({
    description: "Page number",
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Results per page",
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
