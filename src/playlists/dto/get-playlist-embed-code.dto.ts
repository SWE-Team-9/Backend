import { IsNotEmpty, IsString } from 'class-validator';

export class GetPlaylistEmbedCodeParamsDto {
  @IsString()
  @IsNotEmpty()
  playlistId!: string;
}

export class GetPlaylistEmbedCodeResponseDto {
  playlistId!: string;
  embedCode!: string;
}
