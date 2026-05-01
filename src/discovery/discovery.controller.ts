import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ResolveQueryDto } from './dto/resolve-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { TrendingQueryDto } from './dto/trending-query.dto';

@ApiTags('Discovery')
@ApiCookieAuth('access_token')
@ApiBearerAuth()
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Full-text search across tracks, users, and playlists',
    description:
      'Returns grouped search results. Use the `type` filter to narrow to a single category. ' +
      'Results are ranked by relevance. Authentication is optional — providing it unlocks ' +
      'personalized ranking in future iterations.',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Search query (max 120 chars)',
    example: 'lofi chill',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['all', 'tracks', 'users', 'playlists'],
    example: 'all',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Grouped search results returned successfully.',
    schema: {
      example: {
        data: {
          tracks: [
            {
              id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              title: 'Lofi Chill Beats Vol.1',
              slug: 'lofi-chill-beats-vol-1',
              description: null,
              coverArtUrl: 'https://cdn.iqa3.tech/covers/lofi-chill.jpg',
              uploaderId: 'usr_123',
            },
          ],
          users: [
            {
              userId: 'usr_789',
              handle: 'chillvibes',
              displayName: 'Chill Vibes',
              avatarUrl: null,
              bio: null,
            },
          ],
          playlists: [
            {
              id: 'pl_456',
              ownerId: 'usr_789',
              title: 'Chill Playlist',
              slug: 'chill-playlist',
              description: null,
              coverArtUrl: null,
            },
          ],
        },
        meta: {
          current_page: 1,
          total_results: 4,
          total_pages: 1,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error for query params.',
  })
  search(@Query() query: SearchQueryDto) {
    return this.discoveryService.search(query.q, query.type, query.page, query.limit);
  }

  @Get('trending')
  @Public()
  @ApiOperation({
    summary: 'Get trending tracks by engagement velocity',
    description:
      'Returns tracks ranked by a velocity score (likes + reposts within a rolling time window). ' +
      'Authentication is optional — providing it may personalize results in future versions.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'windowDays',
    required: false,
    type: Number,
    example: 7,
    description: 'Rolling window in days for engagement calculation',
  })
  @ApiResponse({
    status: 200,
    description: 'Trending tracks returned successfully.',
    schema: {
      example: {
        windowDays: 7,
        items: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Ya Ana',
            slug: 'ya-ana',
            coverArtUrl: 'https://cdn.iqa3.tech/covers/ya-ana.jpg',
            uploaderId: 'usr_123',
            uploader: {
              userId: 'usr_123',
              handle: 'amrdiab',
              displayName: 'Amr Diab',
            },
            recentPlays: 150,
            recentLikes: 85,
            velocityScore: 320.0,
            liked: false,
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error for query params.',
  })
  trending(@Query() query: TrendingQueryDto, @CurrentUser('userId') userId?: string) {
    return this.discoveryService.trending(query.limit, query.windowDays, userId);
  }

  @Get('resolve')
  @Public()
  @ApiOperation({
    summary: 'Resolve a public URL/path into internal resource UUID + type',
    description:
      'Maps a frontend URL (e.g. `/amrdiab/ya-ana`) to the underlying resource ID and type. ' +
      'Useful for deep-linking and share-link resolution.',
  })
  @ApiQuery({
    name: 'url',
    required: true,
    description:
      'The public URL or path to resolve (e.g. /amrdiab/ya-ana or https://iqa3.tech/amrdiab)',
    example: '/amrdiab/ya-ana',
  })
  @ApiResponse({
    status: 200,
    description:
      'Resource resolved successfully. Returns `matched: false` (not a 404) when no resource is found. ' +
      'Shape varies by `resourceType`: USER includes `handle`; TRACK and PLAYLIST include `slug`.',
    schema: {
      oneOf: [
        {
          title: 'Not found',
          example: { matched: false },
        },
        {
          title: 'User resolved',
          example: {
            matched: true,
            resourceType: 'USER',
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            handle: 'amrdiab',
          },
        },
        {
          title: 'Track resolved',
          example: {
            matched: true,
            resourceType: 'TRACK',
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            slug: 'ya-ana',
          },
        },
        {
          title: 'Playlist resolved',
          example: {
            matched: true,
            resourceType: 'PLAYLIST',
            id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
            slug: 'chill-vibes',
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error for query params.',
  })
  resolve(@Query() query: ResolveQueryDto) {
    return this.discoveryService.resolveResource(query.url);
  }
}
