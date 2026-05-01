import { GetPlaylistDetailsResponseDto } from './get-playlist-details-response.dto';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResolveSecretPlaylistParamsDto {
  @IsString()
  @IsNotEmpty()
  secretToken!: string;
}

export class ResolveSecretPlaylistResponseDto extends GetPlaylistDetailsResponseDto {}
