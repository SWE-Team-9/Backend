import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { BffService } from "../bff.service";

@ApiTags("BFF")
@ApiCookieAuth("access_token")
@ApiBearerAuth()
@Controller("pages")
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
    summary: "Settings page aggregate data",
    description:
      "Returns everything needed to render the settings page in a single request. " +
      "Fields: `me` (account identity), `profile` (editable profile data), " +
      "`subscription` (current plan + quota), `entitlements` (feature flags), " +
      "`notificationPreferences` (per-type toggles), and `sessionsSummary` (count of active sessions). " +
      "All auxiliary fields fall back to null on partial failure; only `me` is hard-required.",
  })
  @ApiResponse({
    status: 200,
    description: "Settings page payload returned successfully.",
    schema: {
      example: {
        me: {
          id: "uuid",
          email: "user@example.com",
          display_name: "Alice",
          handle: "alice",
          avatar_url: null,
          is_verified: true,
          account_type: "ARTIST",
          system_role: "USER",
          subscription_tier: "PRO",
        },
        profile: {
          id: "uuid",
          handle: "alice",
          display_name: "Alice",
          bio: "Producer & DJ",
          avatarUrl: null,
          coverPhotoUrl: null,
          account_type: "ARTIST",
          is_private: false,
          social_links: [],
          favorite_genres: ["electronic", "house"],
        },
        subscription: {
          subscriptionType: "PRO",
          uploadLimit: 100,
          uploadedTracks: 8,
          remainingUploads: 92,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          paymentMethodSummary: null,
          perks: { adFree: true, offlineListening: true },
        },
        entitlements: {
          planCode: "PRO",
          isPremium: true,
          uploadLimit: 100,
          uploadedCount: 8,
          remainingUploads: 92,
          canUpload: true,
          adsEnabled: false,
          canDownload: true,
          supportLevel: "priority",
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
  @ApiResponse({ status: 401, description: "Missing or expired session — redirect to login." })
  @HttpCode(HttpStatus.OK)
  @Get("settings")
  async getSettingsPage(
    @CurrentUser("userId") userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store, private");
    return this.bffService.getSettingsPageData(userId);
  }
}
