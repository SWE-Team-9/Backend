import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { EntitlementsService } from "./entitlements.service";

@ApiTags("Entitlements")
@ApiBearerAuth()
@Controller("entitlements")
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @ApiOperation({
    summary: "Get the current user's entitlements",
    description:
      "Returns a full snapshot of what the authenticated user is allowed to do: " +
      "upload limit, remaining uploads, premium features (ads, downloads, support level). " +
      "Use this to gate UI features without calling multiple endpoints.",
  })
  @ApiResponse({
    status: 200,
    description: "Entitlements returned.",
    schema: {
      example: {
        planCode: "PRO",
        isPremium: true,
        uploadLimit: 100,
        uploadedCount: 12,
        remainingUploads: 88,
        canUpload: true,
        adsEnabled: false,
        canDownload: true,
        supportLevel: "priority",
        trialEnd: null,
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("me")
  async getMyEntitlements(@CurrentUser("userId") userId: string) {
    return this.entitlementsService.getUserEntitlements(userId);
  }
}
