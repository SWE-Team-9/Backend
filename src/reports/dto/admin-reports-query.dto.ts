import { ReportStatus, ReportTargetType } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

export class AdminReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: "Filter reports by lifecycle status.",
    example: "PENDING",
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({
    enum: ReportTargetType,
    description: "Filter reports by target entity type.",
    example: "TRACK",
  })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}
