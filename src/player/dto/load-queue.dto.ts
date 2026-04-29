import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
} from "class-validator";

export type QueueContextType = "TRACK" | "PLAYLIST" | "ARTIST" | "CONTEXT_IDS";

export class LoadQueueDto {
  @IsEnum(["TRACK", "PLAYLIST", "ARTIST", "CONTEXT_IDS"])
  contextType!: QueueContextType;

  /**
   * For PLAYLIST context: the playlist ID.
   * For ARTIST context: the artist's user ID.
   */
  @IsOptional()
  @IsUUID("4")
  contextId?: string;

  /**
   * The track to start playback from within the loaded queue.
   * If omitted the queue starts from the beginning.
   */
  @IsOptional()
  @IsUUID("4")
  startTrackId?: string;

  /** Pre-shuffle the queue on the server before persisting it. */
  @IsOptional()
  @IsBoolean()
  shuffle?: boolean;

  /** Explicit list of track IDs (required when contextType is CONTEXT_IDS). */
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  trackIds?: string[];
}
