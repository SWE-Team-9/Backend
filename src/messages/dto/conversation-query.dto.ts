import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

export class ConversationQueryDto {
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as Record<string, unknown>).archived;
    return raw === "true" || raw === true;
  })
  @IsBoolean()
  archived?: boolean = false;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
