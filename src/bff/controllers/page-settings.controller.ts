import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BffService } from '../bff.service';

@ApiTags('BFF')
@ApiCookieAuth('access_token')
@ApiBearerAuth()
@Controller('pages')
export class PageSettingsController {
  constructor(private readonly bffService: BffService) {}

  /**
   * GET /api/v1/pages/settings
   *
   * Returns all initial data for the settings page in one request:
   * me, profile, subscription, entitlements, notification preferences,
   * and active sessions count.
   *
   * Cache: no-store, private — all user-specific data.
   */
  @ApiOperation({
    summary: 'Settings page aggregate data',
    description:
      'Returns everything needed to render the settings page in a single request. ' +
      'Fields: `me` (account identity), `profile` (editable profile data), ' +
      '`subscription` (current plan + quota), `entitlements` (feature flags), ' +
      '`notificationPreferences` (per-type toggles), and `sessionsSummary` (count of active sessions). ' +
      'All auxiliary fields fall back to null on partial failure; only `me` is hard-required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Settings page payload returned successfully.',
    schema: {
      example: {
        me: {
          id: 'uuid',
          email: 'user@example.com',
          display_name: 'Alice',
          handle: 'alice',
          avatar_url: null,
          is_verified: true,
          account_type: 'ARTIST',
          system_role: 'USER',
          subscription_tier: 'PRO',
        },
        profile: {
          id: 'uuid',
          user_id: 'uuid',
          handle: 'alice',
          display_name: 'Alice',
          bio: 'Producer & DJ',
          location: 'Cairo, Egypt',
          avatarUrl: null,
          coverPhotoUrl: null,
          account_type: 'ARTIST',
          visibility: 'PUBLIC',
          is_private: false,
          likes_visible: true,
          website_url: null,
          is_verified: true,
          created_at: '2025-01-15T10:00:00.000Z',
          updated_at: '2026-04-01T08:00:00.000Z',
          followers_count: 120,
          following_count: 45,
          track_count: 8,
          social_links: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/alice', sort_order: 0 }],
          favorite_genres: [{ slug: 'electronic', name: 'Electronic' }, { slug: 'house', name: 'House' }],
        },
        subscription: {
          userId: 'uuid',
          planCode: 'PRO',
          subscriptionType: 'PRO',
          subscriptionStatus: 'ACTIVE',
          planName: 'Pro',
          isPremium: true,
          adsEnabled: false,
          canDownload: true,
          supportLevel: 'priority',
          uploadLimit: 100,
          uploadLimitDisplay: '100',
          uploadedTracks: 8,
          remainingUploads: 92,
          currentPeriodEnd: '2026-06-01T00:00:00.000Z',
          renewalDate: '2026-06-01T00:00:00.000Z',
          expiresAt: null,
          cancelAtPeriodEnd: false,
          trialStart: null,
          trialEnd: null,
          paymentMethodSummary: 'Visa ending in 4242',
          paymentMethod: null,
          pendingDowngrade: null,
          latestInvoice: null,
        },
        entitlements: {
          planCode: 'PRO',
          isPremium: true,
          uploadLimit: 100,
          uploadedCount: 8,
          remainingUploads: 92,
          canUpload: true,
          adsEnabled: false,
          canDownload: true,
          supportLevel: 'priority',
          trialEnd: null,
        },
        notificationPreferences: {
          likes: true,
          comments: true,
          follows: true,
          reposts: true,
        },
        sessionsSummary: { count: 2 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or expired session — redirect to login.' })
  @HttpCode(HttpStatus.OK)
  @Get('settings')
  async getSettingsPage(
    @CurrentUser('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store, private');
    return this.bffService.getSettingsPageData(userId);
  }
}
