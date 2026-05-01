import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CreateCommentDto } from './dto/comment.dto';
import { InteractionsService } from './interactions.service';

@ApiTags('Interactions')
@Controller('interactions')
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Post('tracks/:id/like')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Like a track' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiNoContentResponse({ description: 'Track liked.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Cannot like your own track.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiResponse({ status: 409, description: 'Track not finished or already liked.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  likeTrack(
    @CurrentUser('userId') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ): Promise<void> {
    return this.interactionsService.likeTrack(userId, trackId);
  }

  @Delete('tracks/:id/like')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlike a track' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiNoContentResponse({ description: 'Track unliked.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found or not liked.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  unlikeTrack(
    @CurrentUser('userId') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ): Promise<void> {
    return this.interactionsService.unlikeTrack(userId, trackId);
  }

  @Post('tracks/:id/repost')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Repost a track' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiNoContentResponse({ description: 'Track reposted.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Cannot repost your own track.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiResponse({ status: 409, description: 'Track not finished or already reposted.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  repostTrack(
    @CurrentUser('userId') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ): Promise<void> {
    return this.interactionsService.repostTrack(userId, trackId);
  }

  @Delete('tracks/:id/repost')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove repost from a track' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiNoContentResponse({ description: 'Track unreposted.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found or not reposted.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  unrepostTrack(
    @CurrentUser('userId') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ): Promise<void> {
    return this.interactionsService.unrepostTrack(userId, trackId);
  }

  @Get('me/likes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my liked tracks' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Liked tracks fetched.',
    schema: {
      example: {
        items: [
          {
            interactedAt: '2026-04-04T12:00:00.000Z',
            track: {
              id: 'uuid',
              title: 'Track title',
              slug: 'track-title',
              coverArtUrl: null,
              publishedAt: '2026-04-01T12:00:00.000Z',
              likesCount: 3,
              repostsCount: 1,
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  })
  getMyLikes(@CurrentUser('userId') userId: string, @Query() pagination: PaginationQueryDto) {
    return this.interactionsService.getMyLikedTracks(userId, pagination.page, pagination.limit);
  }

  @Get('me/reposts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my reposted tracks' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Reposted tracks fetched.',
    schema: {
      example: {
        items: [
          {
            interactedAt: '2026-04-04T12:00:00.000Z',
            track: {
              id: 'uuid',
              title: 'Track title',
              slug: 'track-title',
              coverArtUrl: null,
              publishedAt: '2026-04-01T12:00:00.000Z',
              likesCount: 3,
              repostsCount: 1,
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  })
  getMyReposts(@CurrentUser('userId') userId: string, @Query() pagination: PaginationQueryDto) {
    return this.interactionsService.getMyRepostedTracks(userId, pagination.page, pagination.limit);
  }

  @Get('users/:userId/likes')
  @Public()
  @ApiOperation({ summary: 'Get liked tracks of a user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Liked tracks fetched.',
    schema: {
      example: {
        items: [
          {
            interactedAt: '2026-04-04T12:00:00.000Z',
            track: {
              id: 'uuid',
              title: 'Track title',
              slug: 'track-title',
              coverArtUrl: null,
              publishedAt: '2026-04-01T12:00:00.000Z',
              likesCount: 3,
              repostsCount: 1,
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  })
  getUserLikes(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.interactionsService.getLikedTracks(userId, pagination.page, pagination.limit);
  }

  @Get('users/:userId/reposts')
  @Public()
  @ApiOperation({ summary: 'Get reposted tracks of a user' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    description: 'Reposted tracks fetched.',
    schema: {
      example: {
        items: [
          {
            interactedAt: '2026-04-04T12:00:00.000Z',
            track: {
              id: 'uuid',
              title: 'Track title',
              slug: 'track-title',
              coverArtUrl: null,
              publishedAt: '2026-04-01T12:00:00.000Z',
              likesCount: 3,
              repostsCount: 1,
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  })
  getUserReposts(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.interactionsService.getRepostedTracks(userId, pagination.page, pagination.limit);
  }

  @Get('tracks/:id/likers')
  @Public()
  @ApiOperation({ summary: 'Get users who liked a track' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiOkResponse({
    description: 'Likers fetched.',
    schema: {
      example: {
        track: {
          id: 'uuid',
          title: 'Track title',
          slug: 'track-title',
          coverArtUrl: null,
          publishedAt: '2026-04-01T12:00:00.000Z',
          likesCount: 3,
          repostsCount: 1,
        },
        items: [
          {
            interactedAt: '2026-04-04T12:00:00.000Z',
            user: {
              userId: 'uuid',
              displayName: 'Demo User',
              avatarUrl: null,
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  })
  getTrackLikers(
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.interactionsService.getTrackLikers(trackId, pagination.page, pagination.limit);
  }

  @Get('tracks/:id/reposters')
  @Public()
  @ApiOperation({ summary: 'Get users who reposted a track' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiOkResponse({
    description: 'Reposters fetched.',
    schema: {
      example: {
        track: {
          id: 'uuid',
          title: 'Track title',
          slug: 'track-title',
          coverArtUrl: null,
          publishedAt: '2026-04-01T12:00:00.000Z',
          likesCount: 3,
          repostsCount: 1,
        },
        items: [
          {
            interactedAt: '2026-04-04T12:00:00.000Z',
            user: {
              userId: 'uuid',
              displayName: 'Demo User',
              avatarUrl: null,
            },
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    },
  })
  getTrackReposters(
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.interactionsService.getTrackReposters(trackId, pagination.page, pagination.limit);
  }

  @Post('tracks/:id/comments')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a timestamped comment' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiCreatedResponse({
    description: 'Comment created.',
    schema: {
      example: {
        id: 'uuid',
        content: 'Great drop!',
        timestampAt: 42,
        user: {
          userId: 'uuid',
          displayName: 'Demo User',
          avatarUrl: null,
        },
      },
    },
  })
  createComment(
    @CurrentUser('userId') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
    @Body() body: CreateCommentDto,
  ) {
    return this.interactionsService.createComment(userId, trackId, body.content, body.timestampAt);
  }

  @Get('tracks/:id/comments')
  @Public()
  @ApiOperation({ summary: 'Get track comments' })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiOkResponse({
    description: 'Comments fetched.',
    schema: {
      example: [
        {
          id: 'uuid',
          content: 'Great drop!',
          timestampAt: 42,
          user: {
            userId: 'uuid',
            displayName: 'Demo User',
            avatarUrl: null,
          },
        },
      ],
    },
  })
  getTrackComments(@Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string) {
    return this.interactionsService.getTrackComments(trackId);
  }

  @Delete('comments/:commentId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiParam({ name: 'commentId', description: 'Comment ID' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Not the comment owner.' })
  @ApiResponse({ status: 404, description: 'Comment not found.' })
  @ApiOkResponse({
    description: 'Comment deleted.',
    schema: {
      example: { message: 'Comment deleted successfully' },
    },
  })
  @HttpCode(HttpStatus.OK)
  deleteComment(
    @CurrentUser('userId') userId: string,
    @Param('commentId', new ParseUUIDPipe({ version: '4' }))
    commentId: string,
  ) {
    return this.interactionsService.deleteComment(userId, commentId);
  }

  @Get('tracks/:id/status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get interaction status for current user on a track',
  })
  @ApiParam({ name: 'id', description: 'Track ID' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @ApiOkResponse({
    description: 'Interaction status fetched.',
    schema: {
      example: {
        isLiked: true,
        isReposted: false,
      },
    },
  })
  getInteractionStatus(
    @CurrentUser('userId') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) trackId: string,
  ) {
    return this.interactionsService.getInteractionStatus(userId, trackId);
  }
}
