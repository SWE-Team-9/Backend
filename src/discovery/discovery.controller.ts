import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiOkResponse } from "@nestjs/swagger";
import { DiscoveryService } from "./discovery.service";
import { ResolveQueryDto } from "./dto/resolve-query.dto";
import { DiscoveryResolveResponseDto, DiscoverySearchResponseDto } from "./dto/discovery-response.dto";
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
  @ApiOkResponse({
    description: "Grouped search results returned successfully.",
    type: DiscoverySearchResponseDto,
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
  @ApiOkResponse({
    description: "Resource resolution completed.",
    type: DiscoveryResolveResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Validation error for query params.",
  })
  resolve(@Query() query: ResolveQueryDto) {
    return this.discoveryService.resolveResource(query.url);
  }
}
