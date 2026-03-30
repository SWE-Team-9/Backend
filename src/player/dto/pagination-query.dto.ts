import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class PaginationQueryDto {
  // TODO(Module 5): Move to shared pagination DTO after module contracts are finalized.
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  // TODO(Module 5): Confirm pagination max limit with frontend/mobile teams.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
