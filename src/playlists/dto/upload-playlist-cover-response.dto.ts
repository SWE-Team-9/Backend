import { ApiProperty } from '@nestjs/swagger';

export class UploadPlaylistCoverResponseDto {
  @ApiProperty({ example: 'Playlist cover uploaded successfully' })
  message!: string;

  @ApiProperty({ example: 'https://cdn.example.com/playlists/pl_101/cover.jpg', nullable: true })
  coverImageUrl!: string | null;
}