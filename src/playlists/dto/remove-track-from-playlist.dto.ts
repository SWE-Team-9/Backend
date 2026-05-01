import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveTrackFromPlaylistParamsDto {
  @IsString()
  @IsNotEmpty()
  playlistId!: string;

  @IsString()
  @IsNotEmpty()
  trackId!: string;
}

export class RemoveTrackFromPlaylistResponseDto {
  @ApiProperty({ example: 'Track removed from playlist successfully' })
  message!: string;
}
