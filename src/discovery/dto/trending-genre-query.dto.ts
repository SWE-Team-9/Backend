import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class TrendingGenreQueryDto {
  @ApiPropertyOptional({
    description: "Maximum number of tracks to return (1–5)",
    example: 5,
    minimum: 1,
    maximum: 5,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  limit?: number = 5;
}
