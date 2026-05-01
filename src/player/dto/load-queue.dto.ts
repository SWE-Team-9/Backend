import { IsArray, IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type QueueContextType = 'TRACK' | 'PLAYLIST' | 'ARTIST' | 'CONTEXT_IDS';

export class LoadQueueDto {
  @ApiProperty({
    description:
      'What to populate the queue from. ' +
      'TRACK = single track, PLAYLIST = full playlist, ARTIST = artist discography, ' +
      'CONTEXT_IDS = explicit list of track UUIDs supplied in `trackIds`.',
    enum: ['TRACK', 'PLAYLIST', 'ARTIST', 'CONTEXT_IDS'],
    example: 'PLAYLIST',
  })
  @IsEnum(['TRACK', 'PLAYLIST', 'ARTIST', 'CONTEXT_IDS'])
  contextType!: QueueContextType;

  @ApiPropertyOptional({
    description:
      'UUID of the context entity. ' +
      'Required for PLAYLIST and ARTIST context types. ' +
      'For PLAYLIST: playlist UUID. For ARTIST: user UUID. ' +
      'Not used for TRACK or CONTEXT_IDS (use startTrackId / trackIds instead).',
    format: 'uuid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID('4')
  contextId?: string;

  @ApiPropertyOptional({
    description:
      'Track UUID to begin playback from. ' +
      'The queue is loaded from the start but playback starts at this track. ' +
      'Defaults to the first track in the queue.',
    format: 'uuid',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @IsUUID('4')
  startTrackId?: string;

  @ApiPropertyOptional({
    description: 'Shuffle the queue server-side before persisting. Defaults to false.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  shuffle?: boolean;

  @ApiPropertyOptional({
    description: 'Explicit ordered list of track UUIDs. Required when contextType is CONTEXT_IDS.',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'b2c3d4e5-f6a7-8901-bcde-f12345678901'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  trackIds?: string[];
}
