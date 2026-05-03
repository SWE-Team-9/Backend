import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddQueueItemDto {
  @ApiProperty({
    description: 'Track UUID to add to the queue',
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID(4)
  trackId!: string;

  @ApiProperty({
    enum: ['END', 'NEXT', 'TOP'],
    description:
      '**END** — append to the end of the queue. ' +
      '**NEXT** — insert immediately after the currently playing track. ' +
      '**TOP** — insert at position 0 (the very front of the queue).',
    example: 'NEXT',
  })
  @IsEnum(['END', 'NEXT', 'TOP'])
  mode!: 'END' | 'NEXT' | 'TOP';
}
