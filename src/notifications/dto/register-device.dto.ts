import { IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'fcm_token_abc123', description: 'FCM or APNs device token' })
  @IsString()
  deviceToken!: string;

  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.ANDROID, description: 'Device platform' })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}
