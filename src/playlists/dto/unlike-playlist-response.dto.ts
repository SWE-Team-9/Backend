import { ApiProperty } from "@nestjs/swagger";

export class UnlikePlaylistResponseDto {
  @ApiProperty({ example: "Playlist unliked successfully" })
  message!: string;
}
