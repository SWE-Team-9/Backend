import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FeedService } from './feed.service';

@ApiTags('Feed')
@ApiBearerAuth()
@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get()
  @ApiOperation({
    summary: 'Get chronological activity feed',
    description:
      'Returns a paginated chronological feed of public tracks uploaded by artists ' +
      'the authenticated user follows. Items are sorted by publishedAt/createdAt (newest first).',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    example: 0,
    description: 'Explicit item offset (overrides page-based offset if provided).',
  })
  @ApiResponse({
    status: 200,
    description: 'Feed returned successfully.',
    schema: {
      example: {
        data: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Ya Ana',
            slug: 'ya-ana',
            description: 'Official single',
            coverArtUrl: 'https://cdn.iqa3.tech/covers/ya-ana.jpg',
            createdAt: '2026-04-29T10:00:00.000Z',
            publishedAt: '2026-04-30T18:00:00.000Z',
            uploaderId: 'usr_456',
            uploader: {
              profile: {
                handle: 'amrdiab',
                displayName: 'Amr Diab',
                avatarUrl: 'https://cdn.iqa3.tech/avatars/amrdiab.jpg',
              },
            },
            status: 'FINISHED',
            visibility: 'PUBLIC',
            durationMs: 215000,
            genre: 'Pop',
            tags: ['arabic', 'pop'],
            waveformData: null,
            likesCount: 24,
            repostsCount: 6,
            liked: false,
            reposted: false,
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          offset: 0,
          total: 84,
          totalPages: 5,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({
    status: 400,
    description: 'Validation error for query params.',
  })
  getFeed(@CurrentUser('userId') userId: string, @Query() query: FeedQueryDto) {
    return this.feedService.getFeed(userId, query.limit, query.offset, query.page);
  }
}
