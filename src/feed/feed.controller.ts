import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { FeedQueryDto } from "./dto/feed-query.dto";
import { FeedService } from "./feed.service";

@ApiTags("Feed")
@ApiBearerAuth()
@Controller("feed")
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  @ApiOperation({
    summary: "Chronological activity feed based on followed artists",
  })
  @ApiResponse({ status: 200, description: "Feed returned successfully." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 400, description: "Validation error for query params." })
  getFeed(
    @CurrentUser("userId") userId: string,
    @Query() query: FeedQueryDto,
  ) {
    return this.feedService.getFeed(
      userId,
      query.limit,
      query.offset,
      query.page,
    );
  }
}
