import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationPreferencesDto {
  @ApiPropertyOptional({ example: true, description: 'Receive like notifications' })
  @IsOptional()
  @IsBoolean()
  likes?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Receive comment notifications' })
  @IsOptional()
  @IsBoolean()
  comments?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Receive follow notifications' })
  @IsOptional()
  @IsBoolean()
  follows?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Receive repost notifications' })
  @IsOptional()
  @IsBoolean()
  reposts?: boolean;
}
