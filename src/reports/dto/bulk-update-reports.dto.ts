import { ReportStatus } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

export class BulkUpdateReportsDto {
  @ApiProperty({
    type: [String],
    description: "Report IDs to update (max 50)",
    example: [
      "c56a4180-65aa-42ec-a945-5fd21dec0538",
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    ],
  })
  @IsArray()
  @IsNotEmpty()
  @IsUUID("4", { each: true })
  @ArrayMaxSize(50, { message: "Cannot update more than 50 reports at once" })
  reportIds!: string[];

  @ApiProperty({ enum: ReportStatus, description: "Status to apply" })
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @ApiPropertyOptional({
    description: "Optional resolution note to attach to linked appeals",
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string;
}
