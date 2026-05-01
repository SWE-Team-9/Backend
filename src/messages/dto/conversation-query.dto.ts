import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ConversationQueryDto {
  @ApiPropertyOptional({ description: 'Return archived conversations', type: Boolean, example: false, default: false })
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as Record<string, unknown>).archived;
    return raw === 'true' || raw === true;
  })
  @IsBoolean()
  archived?: boolean = false;

  @ApiPropertyOptional({ description: 'Page number', type: Number, example: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page (max 100)', type: Number, example: 20, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
