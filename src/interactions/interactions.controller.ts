import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AddTimestampedCommentDto } from "./dto/add-timestamped-comment.dto";
import { CommentIdParamDto } from "./dto/comment-id-param.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { TrackIdParamDto } from "./dto/track-id-param.dto";
import { InteractionsService } from "./interactions.service";

@ApiTags("Interactions")
@ApiCookieAuth("access_token")
@Controller("interactions")
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @ApiOperation({ summary: "Like track", description: "Likes a track and updates likes count." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        message: "Track liked successfully",
        trackId: "trk_123",
        likesCount: 251,
        liked: true,
      },
    },
  })
  @Post("tracks/:trackId/like")
  @HttpCode(HttpStatus.CREATED)
  likeTrack(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no like logic implemented yet.
    return this.interactionsService.likeTrack(userId, params);
  }

  @ApiOperation({ summary: "Unlike track", description: "Removes a like from a track." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        message: "Track unliked successfully",
        trackId: "trk_123",
        likesCount: 250,
        liked: false,
      },
    },
  })
  @Delete("tracks/:trackId/like")
  unlikeTrack(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no unlike logic implemented yet.
    return this.interactionsService.unlikeTrack(userId, params);
  }

  @ApiOperation({ summary: "Repost track", description: "Reposts a track to user activity feed." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        message: "Track reposted successfully",
        trackId: "trk_123",
        repostsCount: 70,
        reposted: true,
      },
    },
  })
  @Post("tracks/:trackId/repost")
  @HttpCode(HttpStatus.CREATED)
  repostTrack(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no repost logic implemented yet.
    return this.interactionsService.repostTrack(userId, params);
  }

  @ApiOperation({ summary: "Remove repost", description: "Removes reposted track from user feed." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        message: "Repost removed successfully",
        trackId: "trk_123",
        reposted: false,
      },
    },
  })
  @Delete("tracks/:trackId/repost")
  removeRepost(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no remove-repost logic implemented yet.
    return this.interactionsService.removeRepost(userId, params);
  }

  @ApiOperation({
    summary: "Add timestamped comment",
    description: "Adds comment at specific timestamp on track timeline.",
  })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiBody({ type: AddTimestampedCommentDto })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        commentId: "cmt_123",
        trackId: "trk_123",
        text: "This drop is amazing",
        timestampSeconds: 74,
        createdAt: "2026-03-07T17:00:00Z",
      },
    },
  })
  @Post("tracks/:trackId/comments")
  @HttpCode(HttpStatus.CREATED)
  addTimestampedComment(
    @CurrentUser("userId") userId: string,
    @Param() params: TrackIdParamDto,
    @Body() dto: AddTimestampedCommentDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no comment creation logic implemented yet.
    return this.interactionsService.addTimestampedComment(userId, params, dto);
  }

  @ApiOperation({ summary: "Get track comments", description: "Returns paginated comments with timestamps." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({ status: 200, description: "Comments list returned." })
  @Get("tracks/:trackId/comments")
  getTrackComments(
    @Param() params: TrackIdParamDto,
    @Query() query: PaginationQueryDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no comments read logic implemented yet.
    return this.interactionsService.getTrackComments(params, query);
  }

  @ApiOperation({ summary: "Delete comment", description: "Deletes comment if requester is owner or admin." })
  @ApiParam({ name: "commentId", example: "cmt_123" })
  @ApiResponse({
    status: 200,
    schema: { example: { message: "Comment deleted successfully" } },
  })
  @Delete("comments/:commentId")
  deleteComment(
    @CurrentUser("userId") userId: string,
    @Param() params: CommentIdParamDto,
  ) {
    // TODO(Module 6): endpoint placeholder - no delete-comment logic implemented yet.
    return this.interactionsService.deleteComment(userId, params);
  }

  @ApiOperation({ summary: "Get track likers", description: "Returns users who liked a track." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        total: 251,
        users: [
          {
            id: "usr_12",
            display_name: "Ali Beats",
            handle: "ali-beats",
          },
        ],
      },
    },
  })
  @Get("tracks/:trackId/likers")
  getTrackLikers(@Param() params: TrackIdParamDto) {
    // TODO(Module 6): endpoint placeholder - no likers-list logic implemented yet.
    return this.interactionsService.getTrackLikers(params);
  }

  @ApiOperation({ summary: "Get track reposters", description: "Returns users who reposted a track." })
  @ApiParam({ name: "trackId", example: "trk_123" })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        total: 70,
        users: [
          {
            id: "usr_20",
            display_name: "Sara LoFi",
            handle: "sara-lofi",
          },
        ],
      },
    },
  })
  @Get("tracks/:trackId/reposters")
  getTrackReposters(@Param() params: TrackIdParamDto) {
    // TODO(Module 6): endpoint placeholder - no reposters-list logic implemented yet.
    return this.interactionsService.getTrackReposters(params);
  }
}
