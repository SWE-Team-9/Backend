import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { BffService } from "../bff.service";

@ApiTags("BFF")
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
      "Returns everything needed to render the settings page: me, profile, " +
      "subscription, entitlements, notification preferences, and session summary.",
  })
  @ApiResponse({ status: 200, description: "Settings page payload." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
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
