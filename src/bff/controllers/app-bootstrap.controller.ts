import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { BffService } from "../bff.service";

@ApiTags("BFF")
@Controller("app")
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
    summary: "Bootstrap app shell data",
    description:
      "Single endpoint that returns everything the authenticated shell needs " +
      "(me, profile, notifications, messages, player session, entitlements, subscription). " +
      "Replaces several parallel requests made after login.",
  })
  @ApiResponse({ status: 200, description: "Bootstrap payload." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @HttpCode(HttpStatus.OK)
  @Get("bootstrap")
  async getBootstrap(
    @CurrentUser("userId") userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store, private");
    return this.bffService.getBootstrap(userId);
  }
}
