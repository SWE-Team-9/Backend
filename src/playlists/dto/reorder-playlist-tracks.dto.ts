import { ArrayNotEmpty, ArrayUnique, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderPlaylistTracksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderedTrackIds!: string[];
}
