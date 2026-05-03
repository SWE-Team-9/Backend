import { BadRequestException, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SocialService } from './social.service';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { SuggestionsQueryDto } from './dto/suggestions-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Social Graph')
@ApiCookieAuth('access_token')
@Controller('social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  /**
   * Allows the authenticated user to follow another user. Prevents self-follows and enforces block rules.
   */
  @ApiOperation({
    summary: 'Follow user',
    description: 'Allows the authenticated user to follow another user.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Target user ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 201,
    description: 'User followed successfully.',
    schema: {
      example: {
        message: 'User followed successfully',
        targetUserId: 'usr_456',
        followersCount: 128,
        isFollowing: true,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request (e.g. cannot follow yourself).' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Target user has blocked you.' })
  @ApiResponse({ status: 404, description: 'Target user not found.' })
  @ApiResponse({ status: 409, description: 'Already following this user.' })
  @Post('follow/:userId')
  followUser(@CurrentUser('userId') followerId: string, @Param() params: UserIdParamDto) {
    if (!followerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'INVALID_AUTH_CONTEXT',
        message: 'Authenticated user context is missing.',
      });
    }

    return this.socialService.followUser(followerId, params.userId);
  }

  /**
   * Removes a follow relationship between the authenticated user and the target user.
   */
  @ApiOperation({
    summary: 'Unfollow user',
    description:
      'Removes a follow relationship between the authenticated user and the target user.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Target user ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'User unfollowed successfully.',
    schema: {
      example: {
        message: 'User unfollowed successfully',
        targetUserId: 'usr_456',
        isFollowing: false,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request (e.g. cannot unfollow yourself).' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Target user or follow relationship not found.' })
  @Delete('follow/:userId')
  unfollowUser(@CurrentUser('userId') followerId: string, @Param() params: UserIdParamDto) {
    if (!followerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'INVALID_AUTH_CONTEXT',
        message: 'Authenticated user context is missing.',
      });
    }

    return this.socialService.unfollowUser(followerId, params.userId);
  }

  /**
   * Returns paginated list of users who follow a specific user.
   */
  @ApiOperation({
    summary: 'Get followers list',
    description: 'Returns the list of users who follow a specific user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: 'Followers list returned.',
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 84,
        followers: [
          {
            id: 'usr_100',
            display_name: 'Salma Vocals',
            handle: 'salma-vocals',
            avatar_url: 'https://example.com/avatar.jpg',
          },
        ],
      },
    },
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Pagination page number.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Page size (max 100).' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @Get(':userId/followers')
  getFollowers(@Param() params: UserIdParamDto, @Query() query: PaginationQueryDto) {
    return this.socialService.getFollowers(params.userId, query);
  }

  /**
   * Returns paginated list of users followed by a specific user.
   */
  @ApiOperation({
    summary: 'Get following list',
    description: 'Returns the list of users followed by a specific user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  @ApiResponse({
    status: 200,
    description: 'Following list returned.',
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 52,
        following: [
          {
            id: 'usr_222',
            display_name: 'Karim Beats',
            handle: 'karim-beats',
            avatar_url: 'https://example.com/avatar.jpg',
          },
        ],
      },
    },
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Pagination page number.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Page size (max 100).' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @Get(':userId/following')
  getFollowing(@Param() params: UserIdParamDto, @Query() query: PaginationQueryDto) {
    return this.socialService.getFollowing(params.userId, query);
  }

  /**
   * Returns suggested users that the authenticated user may want to follow, excluding already-followed and blocked users.
   */
  @ApiOperation({
    summary: 'Suggested users',
    description: 'Returns suggested users that the authenticated user may want to follow.',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggestions returned.',
    schema: {
      example: {
        suggestions: [
          {
            id: 'usr_301',
            display_name: 'Mazen LoFi',
            handle: 'mazen-lofi',
            avatar_url: 'https://example.com/avatar.jpg',
            reason: 'Shared genres',
          },
        ],
      },
    },
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10, description: 'Maximum number of suggested users (max 50).' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Get('suggestions')
  getSuggestions(@CurrentUser('userId') userId: string, @Query() query: SuggestionsQueryDto) {
    if (!userId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'INVALID_AUTH_CONTEXT',
        message: 'Authenticated user context is missing.',
      });
    }

    return this.socialService.getSuggestions(userId, query);
  }

  /**
   * Blocks a user and prevents direct social interaction. Prevents self-blocks and auto-unfollows if currently following.
   */
  @ApiOperation({
    summary: 'Block user',
    description: 'Blocks a specific user and prevents direct social interaction.',
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID to block',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 201,
    description: 'User blocked successfully.',
    schema: {
      example: {
        message: 'User blocked successfully',
        blockedUserId: 'usr_999',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request (e.g. cannot block yourself).' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Target user not found.' })
  @Post('block/:userId')
  blockUser(@CurrentUser('userId') blockerId: string, @Param() params: UserIdParamDto) {
    if (!blockerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'INVALID_AUTH_CONTEXT',
        message: 'Authenticated user context is missing.',
      });
    }

    return this.socialService.blockUser(blockerId, params.userId);
  }

  /**
   * Removes a user from the authenticated user's blocked list.
   */
  @ApiOperation({
    summary: 'Unblock user',
    description: "Removes a user from the authenticated user's blocked list.",
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID to unblock',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'User unblocked successfully.',
    schema: {
      example: {
        message: 'User unblocked successfully',
        blockedUserId: 'usr_999',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request (e.g. cannot unblock yourself).' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Target user or block relationship not found.' })
  @Delete('block/:userId')
  unblockUser(@CurrentUser('userId') blockerId: string, @Param() params: UserIdParamDto) {
    if (!blockerId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'INVALID_AUTH_CONTEXT',
        message: 'Authenticated user context is missing.',
      });
    }

    return this.socialService.unblockUser(blockerId, params.userId);
  }

  /**
   * Returns paginated list of users blocked by the authenticated user.
   */
  @ApiOperation({
    summary: 'Get blocked users',
    description: "Returns the authenticated user's blocked users list.",
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Pagination page number.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Page size (max 100).' })
  @ApiResponse({
    status: 200,
    description: 'Blocked users returned.',
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 4,
        blockedUsers: [
          {
            id: 'usr_999',
            display_name: 'Blocked User',
            handle: 'blocked-user',
            avatar_url: 'https://example.com/avatar.jpg',
            blockedAt: '2026-03-07T11:00:00Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Missing authenticated user context.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Get('blocked-users')
  getBlockedUsers(@CurrentUser('userId') userId: string, @Query() query: PaginationQueryDto) {
    if (!userId) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'INVALID_AUTH_CONTEXT',
        message: 'Authenticated user context is missing.',
      });
    }

    return this.socialService.getBlockedUsers(userId, query);
  }
}
