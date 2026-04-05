import { Type } from "class-transformer";
import { IsBoolean, IsInt, Min } from "class-validator";

export class RegisterProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds!: number;

  @IsBoolean()
  isCompleted!: boolean;
}
