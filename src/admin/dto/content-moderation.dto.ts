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
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ModerateTrackDto {
  @ApiProperty({
    description: "Target moderation state for the track.",
    enum: ModerationState,
    example: "HIDDEN",
  })
  @IsEnum(ModerationState)
  moderationState!: ModerationState;

  @ApiProperty({
    description: "Reason for the moderation action.",
    minLength: 10,
    maxLength: 2000,
    example: "Track contains copyright-infringing material.",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: "Optional linked moderation report UUID.",
    format: "uuid",
  })
  @IsOptional()
  @IsUUID()
  reportId?: string;
}

export class ModerateCommentDto {
  @ApiProperty({
    description: "Whether to hide the comment.",
    example: true,
  })
  @IsBoolean()
  isHidden!: boolean;

  @ApiProperty({
    description: "Reason for the moderation action.",
    minLength: 10,
    maxLength: 2000,
    example: "Comment contains hate speech.",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: "Optional linked moderation report UUID.",
    format: "uuid",
  })
  @IsOptional()
  @IsUUID()
  reportId?: string;
}

export class ModeratePlaylistDto {
  @ApiProperty({
    description: "Target moderation state for the playlist.",
    enum: ModerationState,
    example: "HIDDEN",
  })
  @IsEnum(ModerationState)
  moderationState!: ModerationState;

  @ApiProperty({
    description: "Reason for the moderation action.",
    minLength: 10,
    maxLength: 2000,
    example: "Playlist promotes harmful content.",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description: "Optional linked moderation report UUID.",
    format: "uuid",
  })
  @IsOptional()
  @IsUUID()
  reportId?: string;
}
