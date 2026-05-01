import { ApiProperty } from '@nestjs/swagger';

import { GetPlaylistDetailsResponseDto } from './get-playlist-details-response.dto';

export class UpdatePlaylistResponseDto {
  @ApiProperty({ example: 'Playlist updated successfully' })
  message!: string;

  @ApiProperty({ type: () => GetPlaylistDetailsResponseDto })
  playlist!: GetPlaylistDetailsResponseDto;
}
