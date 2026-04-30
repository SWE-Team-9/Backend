import { ApiProperty } from "@nestjs/swagger";

export class LikePlaylistResponseDto {
  @ApiProperty({ example: "Playlist liked successfully" })
  message!: string;
}
