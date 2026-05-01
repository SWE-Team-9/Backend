import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { DiscoveryService } from "./discovery.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ResolveQueryDto } from "./dto/resolve-query.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { TrendingQueryDto } from "./dto/trending-query.dto";
import { TrendingGenreQueryDto } from "./dto/trending-genre-query.dto";

@ApiTags("Discovery")
@Controller("discovery")
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get("search")
  @ApiOperation({
    summary: "Full-text search across tracks, users, and playlists",
  })
  @ApiResponse({
    status: 200,
    description: "Grouped search results returned successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Validation error for query params.",
  })
  search(@Query() query: SearchQueryDto) {
    return this.discoveryService.search(
      query.q,
      query.type,
      query.page,
      query.limit,
    );
  }

  @Get("trending")
  @ApiOperation({ summary: "Get trending tracks by engagement velocity" })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiQuery({ name: "windowDays", required: false, example: 7 })
  @ApiResponse({
    status: 200,
    description: "Trending tracks returned successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Validation error for query params.",
  })
  trending(
    @Query() query: TrendingQueryDto,
    @CurrentUser("userId") userId?: string,
  ) {
    return this.discoveryService.trending(query.limit, query.windowDays, userId);
  }

  @Get("trending/genres/:genreSlug/tracks")
  @ApiOperation({
    summary: "Get trending tracks for a specific genre",
    description:
      "Returns trending public finished tracks for the exact genre slug. " +
      "No fallback tracks are returned. " +
      "Tracks are sorted by total likes count descending.",
  })
  @ApiParam({
    name: "genreSlug",
    description: 'Exact genre slug (e.g. "electronic", "hip-hop")',
    example: "electronic",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Max tracks to return (1–5, default 5)",
    example: 5,
  })
  @ApiOkResponse({
    description:
      "Trending tracks for the genre. Returns tracks: [] when the genre exists but has no matching tracks.",
    schema: {
      example: {
        genre: { slug: "electronic", name: "Electronic" },
        limit: 5,
        total: 1,
        tracks: [
          {
            trackId: "00000000-0000-0000-0000-000000000001",
            title: "Example Track",
            slug: "example-track",
            artist: {
              id: "00000000-0000-0000-0000-000000000002",
              displayName: "Example Artist",
              handle: "example-artist",
              avatarUrl: null,
            },
            genre: { slug: "electronic", name: "Electronic" },
            coverArtUrl: null,
            durationMs: 210000,
            waveformData: [],
            likesCount: 42,
            repostsCount: 7,
            createdAt: "2026-01-01T00:00:00.000Z",
            publishedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({
    description: "Genre slug does not exist in the database.",
    schema: {
      example: {
        statusCode: 404,
        error: "Not Found",
        message: 'Genre "wrong-slug" not found.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid limit value.",
  })
  getTrendingTracksByGenre(
    @Param("genreSlug") genreSlug: string,
    @Query() query: TrendingGenreQueryDto,
  ) {
    return this.discoveryService.getTrendingTracksByGenre(
      genreSlug,
      query.limit ?? 5,
    );
  }

  @Get("resolve")
  @ApiOperation({
    summary: "Resolve a public URL/path into internal resource UUID + type",
  })
  @ApiResponse({ status: 200, description: "Resource resolution completed." })
  @ApiResponse({
    status: 400,
    description: "Validation error for query params.",
  })
  resolve(@Query() query: ResolveQueryDto) {
    return this.discoveryService.resolveResource(query.url);
  }
}
