import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DiscoveryService } from "./discovery.service";
import { ResolveQueryDto } from "./dto/resolve-query.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { TrendingQueryDto } from "./dto/trending-query.dto";

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
    return this.discoveryService.search(query.q);
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
  trending(@Query() query: TrendingQueryDto) {
    return this.discoveryService.trending(query.limit, query.windowDays);
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
