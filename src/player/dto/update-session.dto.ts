import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export enum RepeatMode {
  OFF = "OFF",
  ONE = "ONE",
  ALL = "ALL",
}

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

  @IsOptional()
  @IsBoolean()
  shuffle?: boolean;

  @IsOptional()
  @IsEnum(RepeatMode)
  repeatMode?: RepeatMode;
}
