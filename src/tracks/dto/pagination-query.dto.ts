import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class PaginationQueryDto {
  // TODO(Module 4): Move to a shared pagination DTO after all modules align on limits.
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
  // TODO(Module 4): Confirm upper limit with cross-team performance constraints.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
