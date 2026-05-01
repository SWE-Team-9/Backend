import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ShareTrackDto {
  @ApiProperty({ description: 'UUID of the recipient user', format: 'uuid', example: 'usr_456' })
  @IsUUID()
  receiverId!: string;

  @ApiProperty({ description: 'UUID of the track to share', format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  trackId!: string;

  @ApiPropertyOptional({ description: 'Optional caption', maxLength: 2000, example: 'Check this out!' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
