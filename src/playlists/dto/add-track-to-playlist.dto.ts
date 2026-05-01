import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddTrackToPlaylistDto {
  @ApiProperty({
    description: 'Track identifier',
    example: 'trk_123',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  trackId!: string;
}

export class AddTrackToPlaylistResponseDto {
  @ApiProperty({ example: 'Track added to playlist successfully' })
  message!: string;

  @ApiProperty({ example: 'pl_101' })
  playlistId!: string;

  @ApiProperty({ example: 'trk_123' })
  trackId!: string;

  @ApiProperty({ example: 'https://example.com/cover.jpg', nullable: true })
  coverArtUrl!: string | null;

  @ApiProperty({
    example: {
      id: 'usr_1',
      name: 'Artist Name',
    },
  })
  artist!: {
    id: string;
    name: string;
  };
}
