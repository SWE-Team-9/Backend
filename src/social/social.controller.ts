import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { SocialService } from "./social.service";
import { UserIdParamDto } from "./dto/user-id-param.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { SuggestionsQueryDto } from "./dto/suggestions-query.dto";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@ApiTags("Social Graph")
@ApiCookieAuth("access_token")
@Controller("social")
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @ApiOperation({
    summary: "Follow user",
    description:
      "Allows the authenticated user to follow another user.",
  })
  @ApiParam({ name: "userId", description: "Target user ID", example: "usr_456" })
  @ApiResponse({
    status: 201,
    description: "User followed successfully.",
    schema: {
      example: {
        message: "User followed successfully",
        targetUserId: "usr_456",
        followersCount: 128,
        isFollowing: true,
      },
    },
  })
  @Post("follow/:userId")
  followUser(
    @CurrentUser("userId") followerId: string,
    @Param() params: UserIdParamDto,
  ) {
    if (!followerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_AUTH_CONTEXT",
        message: "Authenticated user context is missing.",
      });
    }

    return this.socialService.followUser(followerId, params.userId);
  }

  @ApiOperation({
    summary: "Unfollow user",
    description:
      "Removes a follow relationship between the authenticated user and the target user.",
  })
  @ApiParam({ name: "userId", description: "Target user ID", example: "usr_456" })
  @ApiResponse({
    status: 200,
    description: "User unfollowed successfully.",
    schema: {
      example: {
        message: "User unfollowed successfully",
        targetUserId: "usr_456",
        isFollowing: false,
      },
    },
  })
  @Delete("follow/:userId")
  unfollowUser(
    @CurrentUser("userId") followerId: string,
    @Param() params: UserIdParamDto,
  ) {
    if (!followerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_AUTH_CONTEXT",
        message: "Authenticated user context is missing.",
      });
    }

    return this.socialService.unfollowUser(followerId, params.userId);
  }

  @ApiOperation({
    summary: "Get followers list",
    description: "Returns the list of users who follow a specific user.",
  })
  @ApiParam({ name: "userId", description: "User ID", example: "usr_456" })
  @ApiResponse({
    status: 200,
    description: "Followers list returned.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 84,
        followers: [
          {
            id: "usr_100",
            display_name: "Salma Vocals",
            handle: "salma-vocals",
            avatar_url: "https://example.com/avatar.jpg",
          },
        ],
      },
    },
  })
  @Get(":userId/followers")
  getFollowers(
    @Param() params: UserIdParamDto,
    @Query() query: PaginationQueryDto,
  ) {
    return this.socialService.getFollowers(params.userId, query);
  }

  @ApiOperation({
    summary: "Get following list",
    description: "Returns the list of users followed by a specific user.",
  })
  @ApiParam({ name: "userId", description: "User ID", example: "usr_456" })
  @ApiResponse({
    status: 200,
    description: "Following list returned.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 52,
        following: [
          {
            id: "usr_222",
            display_name: "Karim Beats",
            handle: "karim-beats",
            avatar_url: "https://example.com/avatar.jpg",
          },
        ],
      },
    },
  })
  @Get(":userId/following")
  getFollowing(
    @Param() params: UserIdParamDto,
    @Query() query: PaginationQueryDto,
  ) {
    return this.socialService.getFollowing(params.userId, query);
  }

  @ApiOperation({
    summary: "Suggested users",
    description:
      "Returns suggested users that the authenticated user may want to follow.",
  })
  @ApiResponse({
    status: 200,
    description: "Suggestions returned.",
    schema: {
      example: {
        suggestions: [
          {
            id: "usr_301",
            display_name: "Mazen LoFi",
            handle: "mazen-lofi",
            avatar_url: "https://example.com/avatar.jpg",
            reason: "Shared genres",
          },
        ],
      },
    },
  })
  @Get("suggestions")
  getSuggestions(
    @CurrentUser("userId") userId: string,
    @Query() query: SuggestionsQueryDto,
  ) {
    if (!userId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_AUTH_CONTEXT",
        message: "Authenticated user context is missing.",
      });
    }

    return this.socialService.getSuggestions(userId, query);
  }

  @ApiOperation({
    summary: "Block user",
    description: "Blocks a specific user and prevents direct social interaction.",
  })
  @ApiParam({ name: "userId", description: "User ID to block", example: "usr_999" })
  @ApiResponse({
    status: 201,
    description: "User blocked successfully.",
    schema: {
      example: {
        message: "User blocked successfully",
        blockedUserId: "usr_999",
      },
    },
  })
  @Post("block/:userId")
  blockUser(
    @CurrentUser("userId") blockerId: string,
    @Param() params: UserIdParamDto,
  ) {
    if (!blockerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "INVALID_AUTH_CONTEXT",
        message: "Authenticated user context is missing.",
      });
    }

    return this.socialService.blockUser(blockerId, params.userId);
  }

  @ApiOperation({
    summary: "Unblock user",
    description: "Removes a user from the authenticated user's blocked list.",
  })
  @ApiParam({ name: "userId", description: "User ID to unblock", example: "usr_999" })
  @ApiResponse({
    status: 200,
    description: "User unblocked successfully.",
    schema: {
      example: {
        message: "User unblocked successfully",
        blockedUserId: "usr_999",
      },
    },
  })
  @Delete("block/:userId")
  unblockUser(@Param() params: UserIdParamDto) {
    // TODO: Implement unblocking workflow.
    return this.socialService.unblockUser(params);
  }

  @ApiOperation({
    summary: "Get blocked users",
    description: "Returns the authenticated user's blocked users list.",
  })
  @ApiResponse({
    status: 200,
    description: "Blocked users returned.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 4,
        blockedUsers: [
          {
            id: "usr_999",
            display_name: "Blocked User",
            handle: "blocked-user",
            avatar_url: "https://example.com/avatar.jpg",
            blockedAt: "2026-03-07T11:00:00Z",
          },
        ],
      },
    },
  })
  @Get("blocked-users")
  getBlockedUsers(@Query() query: PaginationQueryDto) {
    // TODO: Implement paginated blocked users retrieval.
    return this.socialService.getBlockedUsers(query);
  }
}
