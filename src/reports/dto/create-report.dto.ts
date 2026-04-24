import { ReportReason, ReportTargetType } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CreateReportDto {
  @ApiProperty({
    description: "ID of the target entity (track/user/playlist)",
    example: "c56a4180-65aa-42ec-a945-5fd21dec0538",
  })
  @IsUUID("4")
  targetId!: string;

  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.TRACK })
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @ApiProperty({ enum: ReportReason, example: ReportReason.SPAM })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiPropertyOptional({
    description: "Optional details from the reporter",
    maxLength: 2000,
    example: "This content appears to be spam/reupload.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
