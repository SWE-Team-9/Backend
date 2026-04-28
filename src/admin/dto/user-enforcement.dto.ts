import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class WarnUserDto {
  @ApiProperty({
    description: "Reason for the warning.",
    minLength: 10,
    maxLength: 2000,
    example: "Posting misleading content repeatedly.",
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

  @ApiProperty({
    description: "Admin's current password for re-authentication.",
    example: "CurrentP@ssw0rd",
  })
  @IsString()
  currentPassword!: string;
}

export class SuspendUserDto {
  @ApiProperty({
    description: "Number of days to suspend the user (1–365).",
    minimum: 1,
    maximum: 365,
    example: 7,
  })
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays!: number;

  @ApiProperty({
    description: "Reason for the suspension.",
    minLength: 10,
    maxLength: 2000,
    example: "Repeated violations of community guidelines.",
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

  @ApiProperty({
    description: "Admin's current password for re-authentication.",
    example: "CurrentP@ssw0rd",
  })
  @IsString()
  currentPassword!: string;
}

export class BanUserDto {
  @ApiProperty({
    description: "Reason for the permanent ban.",
    minLength: 10,
    maxLength: 2000,
    example: "Severe and repeated abuse of the platform.",
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

  @ApiProperty({
    description: "Admin's current password for re-authentication.",
    example: "CurrentP@ssw0rd",
  })
  @IsString()
  currentPassword!: string;
}

export class RestoreUserDto {
  @ApiProperty({
    description: "Reason for restoring the user's account.",
    minLength: 10,
    maxLength: 2000,
    example: "Appeal accepted. Suspension was applied in error.",
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({
    description:
      "If true, restore all admin-hidden tracks and playlists belonging to the user.",
    default: false,
  })
  @IsOptional()
  restoreContent?: boolean = false;
}
