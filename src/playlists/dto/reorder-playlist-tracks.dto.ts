import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderPlaylistTracksDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderedTrackIds!: string[];
}
