import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { UserIdParamDto } from "./dto/user-id-param.dto";
import { TracksService } from "./tracks.service";

@ApiTags("Tracks")
@ApiCookieAuth("access_token")
@Controller("users")
export class UserTracksController {
  constructor(private readonly tracksService: TracksService) {}

  @ApiOperation({
    summary: "Get artist tracks",
    description:
      "Returns artist tracks list with visibility filtering for the current requester.",
  })
  @ApiParam({ name: "userId", example: "usr_456" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        artist: {
          userId: "usr_456",
          name: "Amr Diab",
          avatarUrl: "https://example.com/avatars/amrdiab.jpg",
        },
        page: 1,
        limit: 20,
        totalTracks: 500,
        tracks: [
          {
            trackId: "trk_001",
            title: "Ya Ana",
            status: "FINISHED",
            visibility: "PUBLIC",
            artist: { avatarUrl: "https://example.com/avatars/amrdiab.jpg" },
          },
        ],
      },
    },
  })
  @Public()
  @Get(":userId/tracks")
  getArtistTracks(
    @Param() params: UserIdParamDto,
    @Query() query: PaginationQueryDto,
    @CurrentUser("userId") requesterId?: string,
  ) {
    // TODO(Module 4): endpoint placeholder - no artist tracks listing logic implemented yet.
    return this.tracksService.getArtistTracks(params, query, requesterId);
  }
}
