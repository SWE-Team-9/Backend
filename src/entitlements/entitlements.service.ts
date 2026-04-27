import { ForbiddenException, Injectable } from "@nestjs/common";

import { SubscriptionsService } from "../subscriptions/subscriptions.service";

/**
 * EntitlementsService - single source of truth for "what can this user do?"
 *
 * Consumed by:
 *  - TracksService (upload guard)
 *  - SubscriptionsController (GET /entitlements/me)
 *  - Any future service needing plan-gated features
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  async getUserEntitlements(userId: string) {
    const [quotaResult, sub] = await Promise.all([
      this.subscriptions.getUploadQuota(userId),
      this.subscriptions.findActiveSubscription(userId),
    ]);

    const { uploadLimit, uploadedCount } = quotaResult;
    const isUnlimited = !isFinite(uploadLimit);
    const planCode = sub ? this.planTier(sub.plan.tier) : "FREE";

    return {
      planCode,
      isPremium: planCode !== "FREE",
      uploadLimit: isUnlimited ? -1 : uploadLimit,
      uploadedCount,
      remainingUploads: isUnlimited
        ? null
        : Math.max(0, uploadLimit - uploadedCount),
      canUpload: isUnlimited || uploadedCount < uploadLimit,
      adsEnabled: planCode === "FREE",
      canDownload: planCode !== "FREE",
      supportLevel: planCode === "FREE" ? "community" : "priority",
      trialEnd: (sub as any)?.trialEnd ?? null,
    };
  }

  async canUploadTrack(userId: string): Promise<boolean> {
    const { canUpload } = await this.getUserEntitlements(userId);
    return canUpload;
  }

  async assertCanUploadTrack(userId: string): Promise<void> {
    const { canUpload, uploadLimit, uploadedCount } =
      await this.getUserEntitlements(userId);
    if (!canUpload) {
      throw new ForbiddenException({
        code: "UPLOAD_LIMIT_REACHED",
        message: `You have reached your upload limit of ${uploadLimit} tracks. Upgrade your plan to upload more.`,
        details: {
          uploadLimit,
          uploadedCount,
          upgradeOptions: ["PRO", "GO_PLUS"],
        },
      });
    }
  }

  async canDownloadTrack(userId: string): Promise<boolean> {
    const { canDownload } = await this.getUserEntitlements(userId);
    return canDownload;
  }

  async isPremium(userId: string): Promise<boolean> {
    const { isPremium } = await this.getUserEntitlements(userId);
    return isPremium;
  }

  private planTier(tier: string): "FREE" | "PRO" | "GO_PLUS" {
    if (tier === "PRO") return "PRO";
    if (tier === "GO_PLUS") return "GO_PLUS";
    return "FREE";
  }
}
