import { IsEnum, IsString } from "class-validator";
import { DevicePlatform } from "@prisma/client";

export class RegisterDeviceDto {
  @IsString()
  deviceToken!: string;

  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}
