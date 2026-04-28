import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { AccountStatus, SystemRole } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class AdminUsersQueryDto {
  @ApiPropertyOptional({ description: "Page number.", minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page.",
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: "Filter by account status.",
    enum: AccountStatus,
  })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({
    description: "Filter by system role.",
    enum: SystemRole,
  })
  @IsOptional()
  @IsEnum(SystemRole)
  role?: SystemRole;

  @ApiPropertyOptional({
    description: "Search by email, display name, or handle.",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: "Field to sort by.",
    enum: ["created_at", "last_login_at", "display_name"],
    default: "created_at",
  })
  @IsOptional()
  @IsString()
  sortBy?: "created_at" | "last_login_at" | "display_name" = "created_at";

  @ApiPropertyOptional({
    description: "Sort direction.",
    enum: ["asc", "desc"],
    default: "desc",
  })
  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc" = "desc";
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: "Page number.", minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page.",
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: "Filter by moderation action type." })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({ description: "Filter by admin user UUID.", format: "uuid" })
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiPropertyOptional({ description: "Filter by target user UUID.", format: "uuid" })
  @IsOptional()
  @IsString()
  targetUserId?: string;

  @ApiPropertyOptional({
    description: "Filter actions on or after this date (ISO 8601).",
    example: "2025-01-01",
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: "Filter actions on or before this date (ISO 8601).",
    example: "2025-12-31",
  })
  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class DailyStatsQueryDto {
  @ApiPropertyOptional({
    description: "Start date (ISO 8601).",
    example: "2025-01-01",
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: "End date (ISO 8601).",
    example: "2025-01-31",
  })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: "Granularity of metrics.",
    enum: ["daily", "weekly", "monthly"],
    default: "daily",
  })
  @IsOptional()
  @IsEnum(["daily", "weekly", "monthly"])
  granularity?: "daily" | "weekly" | "monthly" = "daily";
}

export class MostReportedQueryDto {
  @ApiPropertyOptional({
    description: "Time period for the query.",
    enum: ["last_7_days", "last_30_days", "last_90_days", "all_time"],
    default: "last_30_days",
  })
  @IsOptional()
  @IsString()
  period?: "last_7_days" | "last_30_days" | "last_90_days" | "all_time" =
    "last_30_days";

  @ApiPropertyOptional({
    description: "Maximum number of results per category.",
    minimum: 1,
    maximum: 50,
    default: 10,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
