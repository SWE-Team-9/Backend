import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import { Public } from "../common/decorators/public.decorator";
import { TracksService } from "./tracks.service";
import { PaginationQueryDto } from "./dto";

/**
 * Handles the GET /users/:userId/tracks endpoint.
 * Mounted at 'users' to match the API spec: GET /api/v1/users/:userId/tracks
 */
@ApiTags("Tracks")
@ApiBearerAuth()
@Controller("users")
export class UserTracksController {
  constructor(private readonly tracksService: TracksService) {}

  // ─── Endpoint 6: GET /users/:userId/tracks — Get artist's tracks ──────
  @ApiOperation({
    summary: "Get a user's tracks (paginated)",
    description:
      "Returns a paginated list of tracks for the specified user. " +
      "Public endpoint — no authentication required. " +
      "Non-owners only see PUBLIC tracks with status FINISHED. " +
      "The track owner sees all their tracks (including PRIVATE and PROCESSING). " +
      "Results are ordered by creation date (newest first).",
  })
  @ApiParam({
    name: "userId",
    description: "User UUID of the artist whose tracks to retrieve",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Page number (default: 1)",
    example: 1,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Items per page (default: 20, max: 100)",
    example: 20,
  })
  @ApiResponse({
    status: 200,
    description: "Paginated list of tracks with artist info.",
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
            trackId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            title: "Ya Ana",
            slug: "ya-ana",
            durationMs: 215000,
            waveformData: [0.1, 0.3, 0.5, 0.7, 0.4],
            visibility: "PUBLIC",
            status: "FINISHED",
            coverArtUrl: "https://example.com/covers/ya-ana.jpg",
            createdAt: "2026-03-06T11:00:00.000Z",
            genre: "Pop",
            artist: {
              id: "usr_456",
              displayName: "Amr Diab",
              handle: "amrdiab",
              avatarUrl: "https://example.com/avatars/amrdiab.jpg",
            },
            likesCount: 12,
            repostsCount: 3,
          },
        ],
      },
    },
  })
  @Get(":userId/tracks")
  @Public()
  async getUserTracks(
    @Param("userId", ParseUUIDPipe) userId: string,
    @Query() query: PaginationQueryDto,
    @Req() req: Request,
  ) {
    const requesterId = (req as any).user?.userId;
    return this.tracksService.getUserTracks(
      userId,
      requesterId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }
}
