import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JumpToTrackDto {
  @ApiProperty({
    description: 'UUID of the track to jump to. Must already be present in the current queue.',
    format: 'uuid',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsUUID('4')
  trackId!: string;
}
