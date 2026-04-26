import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { ModerationState } from "@prisma/client";

export class ModerateTrackDto {
  @IsEnum(ModerationState)
  moderationState!: ModerationState;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;
}

export class ModerateCommentDto {
  @IsBoolean()
  isHidden!: boolean;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;
}

export class ModeratePlaylistDto {
  @IsEnum(ModerationState)
  moderationState!: ModerationState;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;
}
