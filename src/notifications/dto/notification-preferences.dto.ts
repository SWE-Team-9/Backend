import { IsBoolean, IsOptional } from "class-validator";

export class NotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  likes?: boolean;

  @IsOptional()
  @IsBoolean()
  comments?: boolean;

  @IsOptional()
  @IsBoolean()
  follows?: boolean;

  @IsOptional()
  @IsBoolean()
  reposts?: boolean;
}
