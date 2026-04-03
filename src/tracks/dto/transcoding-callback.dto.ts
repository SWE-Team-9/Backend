import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrackStatus } from '@prisma/client';

export class TranscodingCallbackDto {
  @ApiProperty({ description: 'Track ID', example: 'trk_001' })
  @IsString()
  trackId!: string;

  @ApiProperty({
    description: 'Processing result status',
    enum: ['FINISHED', 'FAILED'],
    example: 'FINISHED',
  })
  @IsEnum({ FINISHED: 'FINISHED', FAILED: 'FAILED' })
  status!: 'FINISHED' | 'FAILED';

  @ApiPropertyOptional({
    description: 'Generated file URLs',
    example: { mp3: 'https://...', wav: 'https://...' },
  })
  @IsOptional()
  fileUrls?: Record<string, string>;
}
