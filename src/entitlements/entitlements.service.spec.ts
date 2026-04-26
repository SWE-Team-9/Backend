/**
 * Module 12 — Premium Subscriptions
 * Unit tests for EntitlementsService
 *
 * EntitlementsService wraps SubscriptionsService into plan-gated capability checks.
 */

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client';

import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EntitlementsService } from './entitlements.service';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = 'user-uuid-ent';
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function makeActiveSub(tier: SubscriptionTier, overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-ent-1',
    userId: USER_ID,
    status: SubscriptionStatus.ACTIVE,
    plan: { tier },
    currentPeriodEnd: FUTURE,
    trialEnd: null,
    ...overrides,
  };
}

const mockSubscriptionsService = {
  getUploadQuota: jest.fn(),
  findActiveSubscription: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('EntitlementsService', () => {
  let service: EntitlementsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementsService,
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
      ],
    }).compile();

    service = module.get<EntitlementsService>(EntitlementsService);
    jest.clearAllMocks();

    // Default: FREE user (no subscription)
    mockSubscriptionsService.getUploadQuota.mockResolvedValue({
      uploadLimit: 3,
      uploadedCount: 0,
    });
    mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getUserEntitlements — plan tier mapping
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getUserEntitlements()', () => {
    it('returns FREE entitlements when no active subscription exists', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 0 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.planCode).toBe('FREE');
      expect(result.isPremium).toBe(false);
      expect(result.adsEnabled).toBe(true);
      expect(result.canDownload).toBe(false);
      expect(result.supportLevel).toBe('community');
      expect(result.uploadLimit).toBe(3);
      expect(result.canUpload).toBe(true);
    });

    it('returns PRO entitlements for an active PRO subscription', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 100, uploadedCount: 5 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.planCode).toBe('PRO');
      expect(result.isPremium).toBe(true);
      expect(result.adsEnabled).toBe(false);
      expect(result.canDownload).toBe(true);
      expect(result.supportLevel).toBe('priority');
      expect(result.uploadLimit).toBe(100);
    });

    it('returns GO_PLUS entitlements for a trialing GO_PLUS subscription', async () => {
      const trialEnd = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, { status: SubscriptionStatus.TRIALING, trialEnd }),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 1000, uploadedCount: 10 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.planCode).toBe('GO_PLUS');
      expect(result.isPremium).toBe(true);
      expect(result.uploadLimit).toBe(1000);
      expect(result.trialEnd).toEqual(trialEnd);
    });

    it('returns premium entitlements for a PAST_DUE subscription (grace period)', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, { status: SubscriptionStatus.PAST_DUE }),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 100, uploadedCount: 5 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.planCode).toBe('PRO');
      expect(result.isPremium).toBe(true);
    });

    it('canUpload=false and remainingUploads=0 when at upload limit', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 3 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.canUpload).toBe(false);
      expect(result.remainingUploads).toBe(0);
    });

    it('canUpload=false and remainingUploads=0 when OVER limit', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 5 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.canUpload).toBe(false);
      expect(result.remainingUploads).toBe(0);
    });

    it('remainingUploads correctly calculated when under limit', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 1 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.remainingUploads).toBe(2);
    });

    it('calls getUploadQuota and findActiveSubscription in parallel', async () => {
      await service.getUserEntitlements(USER_ID);

      expect(mockSubscriptionsService.getUploadQuota).toHaveBeenCalledWith(USER_ID);
      expect(mockSubscriptionsService.findActiveSubscription).toHaveBeenCalledWith(USER_ID);
    });

    it('trialEnd is null for non-trialing subscriptions', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, { trialEnd: null }),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 100, uploadedCount: 0 });

      const result = await service.getUserEntitlements(USER_ID);

      expect(result.trialEnd).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // canUploadTrack()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('canUploadTrack()', () => {
    it('returns true when under upload limit', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 1 });

      expect(await service.canUploadTrack(USER_ID)).toBe(true);
    });

    it('returns false when at upload limit', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 3 });

      expect(await service.canUploadTrack(USER_ID)).toBe(false);
    });

    it('returns false when over upload limit', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 10 });

      expect(await service.canUploadTrack(USER_ID)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // assertCanUploadTrack()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('assertCanUploadTrack()', () => {
    it('resolves without error when upload is allowed', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 2 });

      await expect(service.assertCanUploadTrack(USER_ID)).resolves.toBeUndefined();
    });

    it('throws ForbiddenException(UPLOAD_LIMIT_REACHED) when at limit', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 3 });

      await expect(service.assertCanUploadTrack(USER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('thrown exception includes UPLOAD_LIMIT_REACHED code', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 3 });

      try {
        await service.assertCanUploadTrack(USER_ID);
        fail('should have thrown');
      } catch (err) {
        expect((err as ForbiddenException).getResponse()).toMatchObject({
          code: 'UPLOAD_LIMIT_REACHED',
        });
      }
    });

    it('exception response includes upgradeOptions PRO and GO_PLUS', async () => {
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 3, uploadedCount: 3 });

      try {
        await service.assertCanUploadTrack(USER_ID);
      } catch (err) {
        const response = (err as ForbiddenException).getResponse() as any;
        expect(response.details.upgradeOptions).toContain('PRO');
        expect(response.details.upgradeOptions).toContain('GO_PLUS');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // canDownloadTrack()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('canDownloadTrack()', () => {
    it('returns false for FREE plan (no active subscription)', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);

      expect(await service.canDownloadTrack(USER_ID)).toBe(false);
    });

    it('returns true for PRO plan', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 100, uploadedCount: 0 });

      expect(await service.canDownloadTrack(USER_ID)).toBe(true);
    });

    it('returns true for GO_PLUS plan', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 1000, uploadedCount: 0 });

      expect(await service.canDownloadTrack(USER_ID)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // isPremium()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('isPremium()', () => {
    it('returns false for FREE plan', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(null);

      expect(await service.isPremium(USER_ID)).toBe(false);
    });

    it('returns true for PRO plan', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 100, uploadedCount: 0 });

      expect(await service.isPremium(USER_ID)).toBe(true);
    });

    it('returns true for GO_PLUS plan', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 1000, uploadedCount: 0 });

      expect(await service.isPremium(USER_ID)).toBe(true);
    });

    it('returns true while in grace period (PAST_DUE)', async () => {
      mockSubscriptionsService.findActiveSubscription.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, { status: SubscriptionStatus.PAST_DUE }),
      );
      mockSubscriptionsService.getUploadQuota.mockResolvedValue({ uploadLimit: 100, uploadedCount: 0 });

      expect(await service.isPremium(USER_ID)).toBe(true);
    });
  });
});
