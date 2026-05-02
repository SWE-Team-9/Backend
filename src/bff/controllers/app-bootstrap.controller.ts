import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BffService } from '../bff.service';

@ApiTags('BFF')
@ApiCookieAuth('access_token')
@ApiBearerAuth()
@Controller('app')
export class AppBootstrapController {
  constructor(private readonly bffService: BffService) {}

  /**
   * GET /api/v1/app/bootstrap
   *
   * Returns all data the authenticated app shell needs in one round-trip:
   * current user, profile summary, notification unread count + latest,
   * message unread count, player session, entitlements, and subscription.
   *
   * Cache: private, no-store — all fields are user-specific.
   */
  @ApiOperation({
    summary: 'App shell bootstrap',
    description:
      'Returns everything the authenticated shell needs in a single round-trip, ' +
      'eliminating several parallel requests made after login. ' +
      'Fields: `me` (identity), `profile` (summary), `notifications` (unread count + latest 10), ' +
      '`messages` (unread count), `player` (restored session), `entitlements`, `subscription`. ' +
      'Auxiliary fields fall back to null / empty on partial service failure; only `me` is hard-required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Bootstrap payload returned successfully.',
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
          account_status: 'ACTIVE',
          subscription_tier: 'PRO',
          created_at: '2025-01-15T10:00:00.000Z',
        },
        profile: {
          id: 'uuid',
          handle: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
          coverUrl: null,
          accountType: 'ARTIST',
          followersCount: 120,
          followingCount: 45,
          tracksCount: 8,
        },
        notifications: { unreadCount: 3, latest: [] },
        messages: { unreadCount: 1 },
        player: { session: null },
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
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or expired session — redirect to login.' })
  @HttpCode(HttpStatus.OK)
  @Get('bootstrap')
  async getBootstrap(
    @CurrentUser('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store, private');
    return this.bffService.getBootstrap(userId);
  }
}
