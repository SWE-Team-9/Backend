import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import { Public } from "../common/decorators/public.decorator";
import { TracksService } from "./tracks.service";

@ApiTags("Tracks")
@Controller("tracks")
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Get(":id")
  @Public()
  @ApiOperation({ summary: "Get track by id" })
  @ApiParam({ name: "id", description: "Track ID" })
  @ApiOkResponse({
    description: "Track fetched successfully.",
    schema: {
      example: {
        id: "uuid",
        title: "Track title",
        slug: "track-title",
        description: null,
        coverArtUrl: null,
        durationMs: 240000,
        status: "FINISHED",
        publishedAt: "2026-04-01T12:00:00.000Z",
        likesCount: 12,
        repostsCount: 3,
      },
    },
  })
  getTrackById(
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ) {
    return this.tracksService.getTrackById(trackId);
  }
}
