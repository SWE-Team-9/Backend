import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class SuggestionsQueryDto {
  // TODO(Module 3): Add optional filters (genre, language, locale) if product scope expands.
  @ApiPropertyOptional({
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 50,
    description: 'Maximum number of suggested users.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // TODO(Module 3): Revisit max value after suggestion scoring performance benchmarks.
  @Max(50)
  limit: number = 10;
}
