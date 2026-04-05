import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class PaginationQueryDto {
  // TODO(Module 3): Move common page/limit DTO to shared module after all modules adopt the same contract.
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    minimum: 1,
    description: "Pagination page number.",
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
    description: "Page size.",
  })
  // TODO(Module 3): Confirm global max limit with frontend/cross teams before implementation phase.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
