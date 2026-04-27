import { IsArray, IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ReorderPlaylistTracksDto {
  @ApiProperty({
    description: "Track IDs in the exact desired order",
    example: ["trk_8", "trk_3", "trk_10", "trk_2"],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderedTrackIds!: string[];
}
