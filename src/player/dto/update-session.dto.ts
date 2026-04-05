import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class UpdateSessionDto {
  @IsOptional()
  @IsUUID("4")
  currentTrackId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds?: number;

  @IsOptional()
  @IsBoolean()
  isPlaying?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  volume?: number;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  queueTrackIds?: string[];
}
