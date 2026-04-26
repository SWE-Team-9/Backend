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

export class WarnUserDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;

  @IsString()
  currentPassword!: string;
}

export class SuspendUserDto {
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;

  @IsString()
  currentPassword!: string;
}

export class BanUserDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  reportId?: string;

  @IsString()
  currentPassword!: string;
}

export class RestoreUserDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  restoreContent?: boolean = false;
}
