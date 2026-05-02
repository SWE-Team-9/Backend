import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FileRole, InvoiceStatus, SubscriptionStatus, SubscriptionTier } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { BILLING_PROVIDER } from '../billing/billing-provider.interface';
import {
  FREE_UPLOAD_LIMIT,
  GRACE_PERIOD_DAYS,
  PLAN_CONFIG,
  SubscriptionsService,
} from './subscriptions.service';
import { PlanCodeEnum } from './dto/checkout.dto';
import { ChangePlanCodeEnum } from './dto/change-plan.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';

const USER_ID = 'user-uuid-1111';
const TRACK_ID = 'track-uuid-2222';
const NOW = new Date('2026-05-01T12:00:00.000Z');
const FUTURE = new Date('2026-05-31T12:00:00.000Z');
const PAST = new Date('2026-04-01T12:00:00.000Z');

function makePlan(
  tier: SubscriptionTier,
  uploadLimit = tier === SubscriptionTier.GO_PLUS
    ? 1000
    : tier === SubscriptionTier.PRO
      ? 100
      : FREE_UPLOAD_LIMIT,
  id = `plan-${String(tier).toLowerCase()}`,
) {
  return {
    id,
    code:
      tier === SubscriptionTier.GO_PLUS
        ? 'go-plus-monthly'
        : tier === SubscriptionTier.PRO
          ? 'pro-monthly'
          : 'free',
    name:
      tier === SubscriptionTier.GO_PLUS
        ? 'Go+ Monthly'
        : tier === SubscriptionTier.PRO
          ? 'Pro Monthly'
          : 'Free',
    tier,
    priceCents: tier === SubscriptionTier.GO_PLUS ? 1999 : tier === SubscriptionTier.PRO ? 999 : 0,
    billingInterval: tier === SubscriptionTier.FREE ? null : 'MONTH',
    uploadLimit,
    isActive: true,
    stripePriceId:
      tier === SubscriptionTier.GO_PLUS
        ? 'price_go_plus'
        : tier === SubscriptionTier.PRO
          ? 'price_pro'
          : null,
    features: {
      adFree: tier !== SubscriptionTier.FREE,
      offlineListening: tier !== SubscriptionTier.FREE,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeActiveSub(
  tier: SubscriptionTier,
  uploadLimit = tier === SubscriptionTier.GO_PLUS ? 1000 : 100,
  overrides: Record<string, unknown> = {},
) {
  const plan = makePlan(tier, uploadLimit, 'plan-current');

  return {
    id: 'sub-uuid-3333',
    userId: USER_ID,
    planId: plan.id,
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: NOW,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    trialStart: null,
    trialEnd: null,
    paymentFailureGraceEndsAt: null,
    stripeCustomerId: 'cus_mock_test',
    stripeSubscriptionId: 'sub_mock_test',
    paymentMethod: null,
    createdAt: NOW,
    updatedAt: NOW,
    plan,
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'test@example.com',
    isVerified: true,
    profile: { displayName: 'Test User' },
    ...overrides,
  };
}

function makeTrack(
  overrides: Partial<{
    files: { storageKey: string; fileRole: FileRole; fileSizeBytes?: bigint }[];
    uploaderDisplayName: string | null;
    handle?: string | null;
  }> = {},
) {
  return {
    id: TRACK_ID,
    title: 'Test Track',
    durationMs: 180000,
    coverArtUrl: null,
    files: overrides.files ?? [
      {
        storageKey: 'tracks/stream.mp3',
        fileRole: FileRole.STREAM,
        fileSizeBytes: BigInt(1024),
      },
    ],
    uploader: {
      profile: {
        displayName: overrides.uploaderDisplayName ?? 'Test Artist',
        handle: overrides.handle ?? 'test-artist',
      },
    },
  };
}

function makePrismaMock() {
  const prisma: any = {
    track: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(makeUser()),
    },
    userSubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'new-sub-id' }),
      update: jest.fn().mockResolvedValue({ id: 'updated-sub-id' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    subscriptionPlan: {
      findFirst: jest.fn().mockResolvedValue(makePlan(SubscriptionTier.PRO, 100, 'plan-pro')),
      findMany: jest
        .fn()
        .mockResolvedValue([
          makePlan(SubscriptionTier.FREE, FREE_UPLOAD_LIMIT, 'plan-free'),
          makePlan(SubscriptionTier.PRO, 100, 'plan-pro'),
          makePlan(SubscriptionTier.GO_PLUS, 1000, 'plan-go-plus'),
        ]),
    },
    billingInvoice: {
      create: jest.fn().mockResolvedValue({ id: 'invoice-id' }),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'invoice-id' }),
      upsert: jest.fn().mockResolvedValue({ id: 'invoice-id' }),
    },
    paymentEvent: {
      create: jest.fn().mockResolvedValue({ id: 'event-id' }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    trialRedemption: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'trial-redemption-id' }),
    },
    offlineDownload: {
      upsert: jest.fn().mockResolvedValue({ id: 'download-id' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }

      if (typeof arg === 'function') {
        return (arg as (txClient: typeof prisma) => unknown | Promise<unknown>)(prisma);
      }

      return arg;
    }),
  };

  return prisma;
}

function makeBillingProviderMock() {
  return {
    getOrCreateCustomer: jest.fn().mockResolvedValue('cus_mock_test'),
    createCheckoutSession: jest.fn().mockResolvedValue({
      checkoutSessionId: 'cs_mock_test',
      checkoutUrl: 'https://mock-checkout.example.com/pay?session=cs_mock_test',
      planCode: 'PRO',
      trialEligible: true,
      trialDays: 7,
      amountDueNowCents: 0,
      renewsAt: FUTURE.toISOString(),
      trialEndsAt: new Date('2026-05-08T12:00:00.000Z').toISOString(),
    }),
    createBillingPortalSession: jest.fn().mockResolvedValue({
      portalSessionId: 'bps_mock_test',
      portalUrl: 'https://mock-portal.example.com/billing',
      capabilities: {
        canUpdatePaymentMethod: true,
        canCancel: true,
        canChangePlan: true,
        canViewReceipts: true,
        canViewPaymentMethods: true,
        canAddPaymentMethod: true,
        canRemovePaymentMethod: true,
        canSetDefaultPaymentMethod: true,
      },
    }),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    resumeSubscription: jest.fn().mockResolvedValue(undefined),
    changePlan: jest.fn().mockResolvedValue({
      providerSubscriptionId: 'sub_mock_test',
      providerCustomerId: 'cus_mock_test',
      status: 'active',
      currentPeriodStart: NOW,
      currentPeriodEnd: FUTURE,
      cancelAtPeriodEnd: false,
    }),
    retrieveSubscription: jest.fn().mockResolvedValue({
      providerSubscriptionId: 'sub_mock_test',
      providerCustomerId: 'cus_mock_test',
      status: 'active',
      currentPeriodStart: NOW,
      currentPeriodEnd: FUTURE,
      cancelAtPeriodEnd: false,
    }),
    constructWebhookEvent: jest.fn((rawBody: Buffer) => JSON.parse(rawBody.toString())),
  };
}

function makeMailMock() {
  return {
    sendPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
    sendPaymentFailedMovedToFreeEmail: jest.fn().mockResolvedValue(undefined),
    sendPaymentGracePeriodEmail: jest.fn().mockResolvedValue(undefined),
    sendTrialStartedEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendTrialEndingEmail: jest.fn().mockResolvedValue(undefined),
    sendCancellationConfirmedEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionResumedEmail: jest.fn().mockResolvedValue(undefined),
    sendInvoiceReceiptEmail: jest.fn().mockResolvedValue(undefined),
    sendPlanChangedEmail: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let billing: ReturnType<typeof makeBillingProviderMock>;
  let mail: ReturnType<typeof makeMailMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    billing = makeBillingProviderMock();
    mail = makeMailMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: BILLING_PROVIDER, useValue: billing },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              const cfg: Record<string, unknown> = {
                'billing.provider': 'mock_stripe',
                BILLING_PROVIDER: 'mock_stripe',
                'storage.provider': 'local',
                'storage.localUploadUrl': 'http://localhost:3000/uploads',
                'storage.s3Bucket': '',
                'storage.s3Region': 'us-east-1',
                'storage.awsAccessKeyId': '',
                'storage.awsSecretAccessKey': '',
              };
              return cfg[key] ?? fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
    jest.clearAllMocks();
  });

  describe('PLAN_CONFIG contract', () => {
    it('keeps exactly FREE, PRO, and GO_PLUS plans', () => {
      expect(Object.keys(PLAN_CONFIG).sort()).toEqual(['FREE', 'GO_PLUS', 'PRO']);
    });

    it('keeps PRO as the only free-trial plan', () => {
      expect(PLAN_CONFIG.FREE.trialDays).toBe(0);
      expect(PLAN_CONFIG.PRO.trialDays).toBe(7);
      expect(PLAN_CONFIG.GO_PLUS.trialDays).toBe(0);
    });

    it('keeps expected upload limits and grace period', () => {
      expect(FREE_UPLOAD_LIMIT).toBe(3);
      expect(PLAN_CONFIG.PRO.uploadLimit).toBe(100);
      expect(PLAN_CONFIG.GO_PLUS.uploadLimit).toBe(1000);
      expect(GRACE_PERIOD_DAYS).toBe(1);
    });
  });

  describe('getPlans()', () => {
    it('returns active plans with display fields and feature flags', async () => {
      const result = await service.getPlans();

      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );

      expect(result).toHaveLength(3);
      expect(result.find((p: any) => p.tier === 'FREE')?.uploadLimitDisplay).toBe('3');
      expect(result.find((p: any) => p.tier === 'PRO')?.canDownload).toBe(true);
      expect(result.find((p: any) => p.tier === 'GO_PLUS')?.adsEnabled).toBe(false);
      expect(result.find((p: any) => p.tier === 'GO_PLUS')?.trialDays).toBe(0);
    });
  });

  describe('getMySubscription()', () => {
    it('returns FREE defaults when there is no active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      prisma.track.count.mockResolvedValue(1);

      const result = await service.getMySubscription(USER_ID);

      expect(result).toMatchObject({
        userId: USER_ID,
        planCode: 'FREE',
        uploadLimit: FREE_UPLOAD_LIMIT,
        uploadedTracks: 1,
        remainingUploads: FREE_UPLOAD_LIMIT - 1,
        currentPeriodEnd: null,
        adsEnabled: true,
        canDownload: false,
        isPremium: false,
        canResume: false,
      });
    });

    it('returns PRO subscription details for active PRO user', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.track.count.mockResolvedValue(5);

      const result = await service.getMySubscription(USER_ID);

      expect(result).toMatchObject({
        userId: USER_ID,
        planCode: 'PRO',
        uploadLimit: 100,
        uploadedTracks: 5,
        remainingUploads: 95,
        adsEnabled: false,
        canDownload: true,
        isPremium: true,
        canResume: false,
      });
      expect(result.renewalDate).not.toBeNull();
      expect(result.expiresAt).toBeNull();
    });

    it('uses expiresAt instead of renewalDate when cancelAtPeriodEnd=true', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true }),
      );
      prisma.track.count.mockResolvedValue(0);

      const result = await service.getMySubscription(USER_ID);

      expect(result.expiresAt).not.toBeNull();
      expect(result.renewalDate).toBeNull();
      expect(result.canResume).toBe(true);
      expect(result.resumeBlockedReason).toBeNull();
      expect(result.resumeBlockedMessage).toBeNull();
    });

    it('allows resume state for active canceling subscriptions with historical checkout session id', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, {
          cancelAtPeriodEnd: true,
          stripeSubscriptionId: 'cs_test_pending',
        }),
      );
      prisma.track.count.mockResolvedValue(0);

      const result = await service.getMySubscription(USER_ID);

      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(result.canResume).toBe(true);
      expect(result.resumeBlockedReason).toBeNull();
      expect(result.resumeBlockedMessage).toBeNull();
    });

    it('returns remainingUploads=null when DB plan limit is unlimited', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, -1),
      );
      prisma.track.count.mockResolvedValue(999);

      const result = await service.getMySubscription(USER_ID);

      expect(result.uploadLimit).toBe(-1);
      expect(result.remainingUploads).toBeNull();
    });

    it('does not expose stale trial fields for active GO_PLUS subscriptions', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, 1000, {
          status: SubscriptionStatus.ACTIVE,
          trialStart: new Date('2026-04-28T00:05:31.680Z'),
          trialEnd: new Date('2026-05-28T12:46:38.461Z'),
        }),
      );
      prisma.track.count.mockResolvedValue(1);

      const result = await service.getMySubscription(USER_ID);

      expect(result.planCode).toBe('GO_PLUS');
      expect(result.trialStart).toBeNull();
      expect(result.trialEnd).toBeNull();
      expect(result.renewalDate).toBe(FUTURE.toISOString());
      expect(result.canResume).toBe(false);
    });

    it('does not leak provider IDs in response', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, {
          stripeCustomerId: 'cus_secret',
          stripeSubscriptionId: 'sub_secret',
        }),
      );

      const result = await service.getMySubscription(USER_ID);
      const json = JSON.stringify(result);

      expect(json).not.toContain('cus_secret');
      expect(json).not.toContain('sub_secret');
    });
  });

  describe('checkout()', () => {
    beforeEach(() => {
      prisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.PRO, 100, 'plan-pro'),
      );
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      prisma.trialRedemption.findUnique.mockResolvedValue(null);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws EMAIL_NOT_VERIFIED for unverified users', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ isVerified: false }));

      await expect(service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO })).rejects.toMatchObject(
        {
          response: expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
        },
      );
    });

    it('throws BadRequestException when no active target plan exists', async () => {
      prisma.subscriptionPlan.findFirst.mockResolvedValue(null);

      await expect(service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('passes trialDays=7 for first-time PRO checkout', async () => {
      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(billing.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          planCode: 'PRO',
          trialDays: 7,
          metadata: expect.objectContaining({
            userId: USER_ID,
            planId: 'plan-pro',
            stripePriceId: 'price_pro',
          }),
        }),
      );
      expect(prisma.trialRedemption.create).toHaveBeenCalledTimes(1);
    });

    it('passes trialDays=0 for PRO when trial was already redeemed', async () => {
      prisma.trialRedemption.findUnique.mockResolvedValue({ id: 'prior-redemption' });
      billing.createCheckoutSession.mockResolvedValue({
        checkoutSessionId: 'cs_paid',
        checkoutUrl: 'https://mock-checkout.example.com/pay?session=cs_paid',
        planCode: 'PRO',
        trialEligible: false,
        trialDays: 0,
        amountDueNowCents: 999,
        renewsAt: FUTURE.toISOString(),
      });

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(billing.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ trialDays: 0 }),
      );
      expect(prisma.trialRedemption.create).not.toHaveBeenCalled();
    });

    it('passes trialDays=0 for GO_PLUS because GO_PLUS has no trial', async () => {
      prisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.GO_PLUS, 1000, 'plan-go-plus'),
      );

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.GO_PLUS });

      expect(billing.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          planCode: 'GO_PLUS',
          trialDays: 0,
        }),
      );
    });

    it('reactivates a same-plan subscription already scheduled to cancel', async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true });
      prisma.userSubscription.findFirst.mockResolvedValue(sub);
      prisma.subscriptionPlan.findFirst.mockResolvedValue(sub.plan);

      const result: any = await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(billing.resumeSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: sub.stripeSubscriptionId,
        }),
      );
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sub.id },
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
      expect(billing.createCheckoutSession).not.toHaveBeenCalled();
      expect(result.planCode).toBe('PRO');
    });

    it('throws SUBSCRIPTION_ALREADY_ACTIVE for duplicate active same-plan checkout', async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: false });
      prisma.userSubscription.findFirst.mockResolvedValue(sub);
      prisma.subscriptionPlan.findFirst.mockResolvedValue(sub.plan);

      await expect(service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO })).rejects.toMatchObject(
        {
          response: expect.objectContaining({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' }),
        },
      );
    });

    it('schedules plan change instead of creating immediate checkout when switching plan', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.GO_PLUS, 1000, 'plan-go-plus'),
      );

      const result: any = await service.checkout(USER_ID, { planCode: PlanCodeEnum.GO_PLUS });

      expect(result.scheduled).toBe(true);
      expect(result.currentPlan).toBe('PRO');
      expect(result.newPlan).toBe('GO_PLUS');
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: true,
            paymentMethod: expect.objectContaining({
              pendingDowngrade: expect.objectContaining({
                planCode: 'GO_PLUS',
                planId: 'plan-go-plus',
              }),
            }),
          }),
        }),
      );
      expect(billing.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription()', () => {
    const dto: CancelSubscriptionDto = {};

    it('throws ConflictException when there is no active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(service.cancelSubscription(USER_ID, dto)).rejects.toThrow(ConflictException);
    });

    it('schedules cancellation at period end and clears pendingDowngrade', async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, {
        paymentMethod: {
          brand: 'visa',
          last4: '4242',
          pendingDowngrade: {
            planCode: 'GO_PLUS',
            planId: 'plan-go-plus',
            planName: 'Go+',
            effectiveAt: FUTURE.toISOString(),
          },
        },
      });
      prisma.userSubscription.findFirst.mockResolvedValue(sub);

      const result = await service.cancelSubscription(USER_ID, dto);

      expect(billing.cancelSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: sub.stripeSubscriptionId,
          cancelAtPeriodEnd: true,
        }),
      );
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sub.id },
          data: expect.objectContaining({
            cancelAtPeriodEnd: true,
            paymentMethod: expect.not.objectContaining({
              pendingDowngrade: expect.anything(),
            }),
          }),
        }),
      );
      expect(result.expiresAt).toBeDefined();
      expect(result.message).toContain('full access');
    });

    it('sends cancellation email with period-end access date', async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      prisma.userSubscription.findFirst.mockResolvedValue(sub);

      await service.cancelSubscription(USER_ID, dto);
      await Promise.resolve();
      await Promise.resolve();

      expect(mail.sendCancellationConfirmedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          planName: sub.plan.name,
          expiresAt: sub.currentPeriodEnd,
        }),
      );
    });

    it('is idempotent if cancellation is already scheduled', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true }),
      );

      const result = await service.cancelSubscription(USER_ID, dto);

      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(result.expiresAt).toBe(FUTURE.toISOString());
      expect(billing.cancelSubscription).not.toHaveBeenCalled();
      expect(mail.sendCancellationConfirmedEmail).not.toHaveBeenCalled();
    });
  });

  describe('cancelPendingPlanChange()', () => {
    it('throws NotFoundException when there is no active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(service.cancelPendingPlanChange(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NO_PENDING_PLAN_CHANGE when no scheduled plan switch exists', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));

      await expect(service.cancelPendingPlanChange(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NO_PENDING_PLAN_CHANGE' }),
      });
    });

    it('clears pending plan change and keeps full subscription active', async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: true,
        paymentMethod: {
          brand: 'visa',
          last4: '4242',
          pendingDowngrade: {
            planCode: 'GO_PLUS',
            planId: 'plan-go-plus',
            planName: 'Go+',
            effectiveAt: FUTURE.toISOString(),
          },
        },
      });

      prisma.userSubscription.findFirst
        .mockResolvedValueOnce(sub)
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100, {
          cancelAtPeriodEnd: false,
          paymentMethod: { brand: 'visa', last4: '4242' },
        }));
      prisma.track.count.mockResolvedValue(0);

      const result = await service.cancelPendingPlanChange(USER_ID);

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sub.id },
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
            paymentMethod: expect.not.objectContaining({
              pendingDowngrade: expect.anything(),
            }),
          }),
        }),
      );
      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(result.pendingDowngrade).toBeNull();
    });
  });

  describe('resumeSubscription()', () => {
    it('throws NotFoundException when no active subscription exists', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(service.resumeSubscription(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('returns current subscription when already not scheduled to cancel', async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: false });
      prisma.userSubscription.findFirst.mockResolvedValue(sub);
      prisma.track.count.mockResolvedValue(0);

      const result = await service.resumeSubscription(USER_ID);

      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(result.planCode).toBe('PRO');
      expect(billing.resumeSubscription).not.toHaveBeenCalled();
    });

    it('calls billing.resumeSubscription and clears cancellation fields', async () => {
      const canceledSub = makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true });

      prisma.userSubscription.findFirst
        .mockResolvedValueOnce(canceledSub)
        .mockResolvedValueOnce(
          makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: false }),
        );
      prisma.track.count.mockResolvedValue(0);

      const result = await service.resumeSubscription(USER_ID);

      expect(billing.resumeSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: canceledSub.stripeSubscriptionId,
        }),
      );
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: canceledSub.id },
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
      expect(result.planCode).toBe('PRO');
      await Promise.resolve();
      await Promise.resolve();
      expect(mail.sendSubscriptionResumedEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          planName: canceledSub.plan.name,
          renewalDate: canceledSub.currentPeriodEnd,
        }),
      );
    });

    it('resumes active subscription with cancelAtPeriodEnd=true and historical checkoutSessionId', async () => {
      const canceledSub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: 'cs_test_123',
      });

      prisma.userSubscription.findFirst
        .mockResolvedValueOnce(canceledSub)
        .mockResolvedValueOnce(
          makeActiveSub(SubscriptionTier.PRO, 100, {
            cancelAtPeriodEnd: false,
            stripeSubscriptionId: 'cs_test_123',
          }),
        );
      prisma.track.count.mockResolvedValue(0);

      const result = await service.resumeSubscription(USER_ID);

      expect(billing.resumeSubscription).toHaveBeenCalledWith({
        providerSubscriptionId: 'cs_test_123',
      });
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: canceledSub.id },
          data: expect.objectContaining({ cancelAtPeriodEnd: false, canceledAt: null }),
        }),
      );
      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it('throws CHECKOUT_SESSION_PENDING for incomplete checkout without finalized provider subscription', async () => {
      prisma.userSubscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...makeActiveSub(SubscriptionTier.PRO, 100, {
            status: SubscriptionStatus.INCOMPLETE,
            cancelAtPeriodEnd: false,
            stripeSubscriptionId: 'cs_test_123',
          }),
        });

      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CHECKOUT_SESSION_PENDING' }),
      });
      expect(billing.resumeSubscription).not.toHaveBeenCalled();
    });

    it('throws SUBSCRIPTION_PERIOD_ENDED when canceling subscription period is past', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: PAST,
        }),
      );

      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SUBSCRIPTION_PERIOD_ENDED' }),
      });
      expect(billing.resumeSubscription).not.toHaveBeenCalled();
    });

    it('throws SUBSCRIPTION_PROVIDER_ID_MISSING when provider subscription id is absent', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, {
          cancelAtPeriodEnd: true,
          stripeSubscriptionId: null,
        }),
      );

      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SUBSCRIPTION_PROVIDER_ID_MISSING' }),
      });
      expect(billing.resumeSubscription).not.toHaveBeenCalled();
    });

    it('throws INVALID_PROVIDER_SUBSCRIPTION_ID for malformed Stripe id in real Stripe mode', async () => {
      const configGet = (service as any).config.get as jest.Mock;
      configGet.mockImplementation((key: string, fallback?: unknown) => {
        if (key === 'billing.provider' || key === 'BILLING_PROVIDER') return 'stripe';
        const cfg: Record<string, unknown> = {
          'storage.provider': 'local',
          'storage.localUploadUrl': 'http://localhost:3000/uploads',
          'storage.s3Bucket': '',
          'storage.s3Region': 'us-east-1',
          'storage.awsAccessKeyId': '',
          'storage.awsSecretAccessKey': '',
        };
        return cfg[key] ?? fallback;
      });

      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, {
          cancelAtPeriodEnd: true,
          stripeSubscriptionId: 'bad_id_123',
        }),
      );

      await expect(service.resumeSubscription(USER_ID)).rejects.toThrow(BadRequestException);
      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_PROVIDER_SUBSCRIPTION_ID' }),
      });
      expect(billing.resumeSubscription).not.toHaveBeenCalled();
    });
    it('maps provider missing-subscription error to ConflictException instead of 500', async () => {
      const canceledSub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: 'sub_missing_123',
      });
      prisma.userSubscription.findFirst.mockResolvedValue(canceledSub);
      billing.resumeSubscription.mockRejectedValue(new Error('No such subscription: sub_missing_123'));

      await expect(service.resumeSubscription(USER_ID)).rejects.toThrow(ConflictException);
      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PROVIDER_SUBSCRIPTION_NOT_FOUND' }),
      });
    });

    it('maps unexpected provider errors to BadGatewayException instead of 500', async () => {
      const canceledSub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: true,
      });
      prisma.userSubscription.findFirst.mockResolvedValue(canceledSub);
      billing.resumeSubscription.mockRejectedValue(new Error('Stripe timeout'));

      await expect(service.resumeSubscription(USER_ID)).rejects.toThrow(BadGatewayException);
      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BILLING_PROVIDER_RESUME_FAILED' }),
      });
    });
  });

  describe('changePlan()', () => {
    it('throws NotFoundException when no active subscription exists', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(
        service.changePlan(USER_ID, { planCode: ChangePlanCodeEnum.GO_PLUS }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws PLAN_ALREADY_ACTIVE when changing to current plan', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, 1000),
      );
      prisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.GO_PLUS, 1000, 'plan-go-plus'),
      );

      await expect(
        service.changePlan(USER_ID, { planCode: ChangePlanCodeEnum.GO_PLUS }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PLAN_ALREADY_ACTIVE' }),
      });
    });

    it('throws BadRequestException for FREE as a change-plan target', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));

      await expect(service.changePlan(USER_ID, { planCode: 'FREE' as any })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('schedules PRO -> GO_PLUS change without immediate billing provider change', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.GO_PLUS, 1000, 'plan-go-plus'),
      );

      const result: any = await service.changePlan(USER_ID, {
        planCode: ChangePlanCodeEnum.GO_PLUS,
      });

      expect(result.scheduled).toBe(true);
      expect(result.currentPlan).toBe('PRO');
      expect(result.newPlan).toBe('GO_PLUS');
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: true,
            paymentMethod: expect.objectContaining({
              pendingDowngrade: expect.objectContaining({
                planCode: 'GO_PLUS',
                planId: 'plan-go-plus',
              }),
            }),
          }),
        }),
      );
      expect(billing.changePlan).not.toHaveBeenCalled();
    });

    it('schedules GO_PLUS -> PRO and does not hide tracks immediately', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, 1000),
      );
      prisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.PRO, 100, 'plan-pro'),
      );

      const result: any = await service.changePlan(USER_ID, {
        planCode: ChangePlanCodeEnum.PRO,
      });

      expect(result.scheduled).toBe(true);
      expect(result.newPlan).toBe('PRO');
      expect(prisma.track.updateMany).not.toHaveBeenCalled();
      expect(billing.changePlan).not.toHaveBeenCalled();
    });
  });

  describe('handleStripeWebhook()', () => {
    function makeWebhookBuffer(type: string, overrides: Record<string, unknown> = {}): Buffer {
      return Buffer.from(
        JSON.stringify({
          id: `evt_${type.replace(/\./g, '_')}`,
          type,
          data: {
            object: {
              id: 'sub_mock_test',
              subscription: 'sub_mock_test',
              customer: 'cus_mock_test',
              ...overrides,
            },
          },
        }),
      );
    }

    beforeEach(() => {
      prisma.paymentEvent.findUnique.mockResolvedValue(null);
      prisma.userSubscription.findFirst.mockResolvedValue({
        ...makeActiveSub(SubscriptionTier.PRO, 100),
        stripeCustomerId: 'cus_mock_test',
        stripeSubscriptionId: 'sub_mock_test',
      });
      prisma.user.findUnique.mockResolvedValue(makeUser());
    });

    it('returns { received: true } for unknown events', async () => {
      const result = await service.handleStripeWebhook(makeWebhookBuffer('unknown.event'), '');

      expect(result).toEqual({ received: true });
    });

    it('skips duplicate webhook events', async () => {
      prisma.paymentEvent.findUnique.mockResolvedValue({ id: 'existing-event' });

      await service.handleStripeWebhook(makeWebhookBuffer('invoice.payment_succeeded'), '');

      expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
      expect(prisma.userSubscription.update).not.toHaveBeenCalled();
    });

    it('marks subscription ACTIVE on invoice.payment_succeeded', async () => {
      await service.handleStripeWebhook(
        makeWebhookBuffer('invoice.payment_succeeded', {
          invoice: 'in_mock_1',
          amount_paid: 999,
          currency: 'usd',
        }),
        '',
      );

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
    });

    it('marks subscription ACTIVE on invoice.paid', async () => {
      await service.handleStripeWebhook(makeWebhookBuffer('invoice.paid'), '');

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
    });

    it('checkout.session.completed links providerSubscriptionId and clears pending checkout', async () => {
      prisma.userSubscription.findFirst.mockResolvedValueOnce({
        ...makeActiveSub(SubscriptionTier.PRO, 100, {
          status: SubscriptionStatus.INCOMPLETE,
          stripeSubscriptionId: 'cs_test_pending',
        }),
        stripeCustomerId: 'cus_mock_test',
      });

      await service.handleStripeWebhook(
        makeWebhookBuffer('checkout.session.completed', {
          id: 'cs_test_pending',
          customer: 'cus_test_finalized',
          subscription: 'sub_test_finalized',
          metadata: { trialEligible: 'false', trialDays: '0' },
        }),
        '',
      );

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stripeSubscriptionId: 'sub_test_finalized',
            stripeCustomerId: 'cus_test_finalized',
            status: SubscriptionStatus.ACTIVE,
            cancelAtPeriodEnd: false,
            paymentFailureAt: null,
            paymentFailureGraceEndsAt: null,
          }),
        }),
      );
    });

    it('customer.subscription.updated syncs cancellation, plan, and period fields', async () => {
      prisma.subscriptionPlan.findFirst.mockResolvedValueOnce({
        ...makePlan(SubscriptionTier.GO_PLUS, 1000, 'plan-go-plus'),
        stripePriceId: 'price_go_plus',
      });

      await service.handleStripeWebhook(
        makeWebhookBuffer('customer.subscription.updated', {
          id: 'sub_mock_test',
          status: 'active',
          cancel_at_period_end: true,
          current_period_start: 1770000000,
          current_period_end: 1772600000,
          canceled_at: 1769999000,
          items: { data: [{ price: { id: 'price_go_plus' } }] },
        }),
        '',
      );

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.ACTIVE,
            cancelAtPeriodEnd: true,
            currentPeriodStart: new Date(1770000000 * 1000),
            currentPeriodEnd: new Date(1772600000 * 1000),
            canceledAt: new Date(1769999000 * 1000),
            planId: 'plan-go-plus',
            trialStart: null,
            trialEnd: null,
          }),
        }),
      );
    });

    it('checkout.session.expired marks only pending checkout sessions expired', async () => {
      prisma.userSubscription.findFirst.mockResolvedValueOnce({
        ...makeActiveSub(SubscriptionTier.PRO, 100, {
          status: SubscriptionStatus.INCOMPLETE,
          stripeSubscriptionId: 'cs_test_expired',
        }),
        stripeCustomerId: 'cus_mock_test',
      });

      await service.handleStripeWebhook(
        makeWebhookBuffer('checkout.session.expired', {
          id: 'cs_test_expired',
          subscription: undefined,
        }),
        '',
      );

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.INCOMPLETE_EXPIRED,
            endedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('marks subscription PAST_DUE and sends grace email on invoice.payment_failed', async () => {
      await service.handleStripeWebhook(makeWebhookBuffer('invoice.payment_failed'), '');

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.PAST_DUE,
            paymentFailureGraceEndsAt: expect.any(Date),
          }),
        }),
      );
      expect(mail.sendPaymentGracePeriodEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com' }),
      );
    });

    it('marks subscription CANCELED and revokes access on customer.subscription.deleted', async () => {
      await service.handleStripeWebhook(makeWebhookBuffer('customer.subscription.deleted'), '');

      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
        }),
      );
      expect(prisma.offlineDownload.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID } }),
      );
    });

    it('throws BadRequestException with WEBHOOK_INVALID_SIGNATURE on invalid webhook', async () => {
      billing.constructWebhookEvent.mockImplementation(() => {
        throw new Error('WEBHOOK_INVALID_SIGNATURE');
      });

      await expect(
        service.handleStripeWebhook(Buffer.from('bad payload'), 'bad-signature'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'WEBHOOK_INVALID_SIGNATURE' }),
      });
    });
  });

  describe('getOfflineTrack()', () => {
    it('throws DOWNLOAD_NOT_ALLOWED for FREE/no-subscription user', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(service.getOfflineTrack(USER_ID, TRACK_ID)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DOWNLOAD_NOT_ALLOWED' }),
      });
    });

    it('returns local download URL for PRO users', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result).toMatchObject({
        trackId: TRACK_ID,
        title: 'Test Track',
        artist: 'Test Artist',
        handle: 'test-artist',
        planCode: 'PRO',
      });
      expect(result.downloadUrl).toContain('http://localhost:3000/uploads');
      expect(result.expiresAt).toBeDefined();
      expect(prisma.offlineDownload.upsert).toHaveBeenCalled();
    });

    it('allows GO_PLUS users to download', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, 1000),
      );
      prisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result.planCode).toBe('GO_PLUS');
      expect(result.downloadUrl).toBeTruthy();
    });

    it('throws NotFoundException when track does not exist', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.track.findFirst.mockResolvedValue(null);

      await expect(service.getOfflineTrack(USER_ID, TRACK_ID)).rejects.toThrow(NotFoundException);
    });

    it('prefers STREAM file over ORIGINAL file', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.track.findFirst.mockResolvedValue(
        makeTrack({
          files: [
            {
              storageKey: 'tracks/original.wav',
              fileRole: FileRole.ORIGINAL,
              fileSizeBytes: BigInt(2048),
            },
            {
              storageKey: 'tracks/stream.mp3',
              fileRole: FileRole.STREAM,
              fileSizeBytes: BigInt(1024),
            },
          ],
        }),
      );

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result.downloadUrl).toContain('tracks/stream.mp3');
    });
  });

  describe('getUploadQuota()', () => {
    it('falls back to FREE upload limit when user has no subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      prisma.track.count.mockResolvedValue(1);

      await expect(service.getUploadQuota(USER_ID)).resolves.toEqual({
        uploadLimit: FREE_UPLOAD_LIMIT,
        uploadedCount: 1,
      });
    });

    it('returns active plan limit for PRO subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));
      prisma.track.count.mockResolvedValue(10);

      await expect(service.getUploadQuota(USER_ID)).resolves.toEqual({
        uploadLimit: 100,
        uploadedCount: 10,
      });
    });

    it('maps unlimited GO_PLUS DB value to PLAN_CONFIG limit for upload guard', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, -1),
      );
      prisma.track.count.mockResolvedValue(999);

      const result = await service.getUploadQuota(USER_ID);

      expect(result.uploadLimit).toBe(PLAN_CONFIG.GO_PLUS.uploadLimit);
      expect(result.uploadedCount).toBe(999);
    });
  });

  describe('applyPlanLimitToTracks()', () => {
    it('does nothing when user has no tracks', async () => {
      prisma.track.findMany.mockResolvedValue([]);

      await service.applyPlanLimitToTracks(USER_ID, 100);

      expect(prisma.track.updateMany).not.toHaveBeenCalled();
    });

    it('hides over-limit tracks', async () => {
      prisma.track.findMany.mockResolvedValue([
        { id: 't1', hiddenByPlanLimit: false },
        { id: 't2', hiddenByPlanLimit: false },
        { id: 't3', hiddenByPlanLimit: false },
        { id: 't4', hiddenByPlanLimit: false },
      ]);

      await service.applyPlanLimitToTracks(USER_ID, 2);

      expect(prisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['t3', 't4'] } },
          data: expect.objectContaining({ hiddenByPlanLimit: true }),
        }),
      );
    });

    it('restores hidden tracks when they now fit within upgraded limit', async () => {
      prisma.track.findMany.mockResolvedValue([
        { id: 't1', hiddenByPlanLimit: true },
        { id: 't2', hiddenByPlanLimit: true },
        { id: 't3', hiddenByPlanLimit: false },
      ]);

      await service.applyPlanLimitToTracks(USER_ID, 10);

      expect(prisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['t1', 't2'] } },
          data: expect.objectContaining({ hiddenByPlanLimit: false }),
        }),
      );
    });
  });

  describe('revokeOfflineDownloads()', () => {
    it('expires all user offline downloads immediately', async () => {
      await service.revokeOfflineDownloads(USER_ID);

      expect(prisma.offlineDownload.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        data: { expiresAt: new Date(0) },
      });
    });
  });

  describe('createBillingPortal()', () => {
    it('throws NotFoundException when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createBillingPortal(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('returns provider portal URL and FREE current plan when user has no subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.createBillingPortal(USER_ID);

      expect(result.portalUrl).toContain('http');
      expect(result.currentPlanCode).toBe('FREE');
      expect(billing.createBillingPortalSession).toHaveBeenCalled();
    });

    it('returns PRO current plan when user has active PRO subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub(SubscriptionTier.PRO, 100));

      const result = await service.createBillingPortal(USER_ID);

      expect(result.currentPlanCode).toBe('PRO');
    });
  });

  describe('getInvoices()', () => {
    it('returns [] when user has no subscriptions', async () => {
      prisma.userSubscription.findMany.mockResolvedValue([]);

      const result = await service.getInvoices(USER_ID);

      expect(result).toEqual([]);
      expect(prisma.billingInvoice.findMany).not.toHaveBeenCalled();
    });

    it('returns mapped invoice list scoped to user subscriptions', async () => {
      const paidAt = new Date('2026-05-01T10:00:00.000Z');
      prisma.userSubscription.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      prisma.billingInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          stripeInvoiceId: 'in_mock_1',
          amountDueCents: 999,
          amountPaidCents: 999,
          currency: 'USD',
          status: InvoiceStatus.PAID,
          dueAt: paidAt,
          paidAt,
          createdAt: paidAt,
          subscription: {
            plan: { name: 'Pro Monthly', tier: SubscriptionTier.PRO },
          },
        },
      ]);

      const result = await service.getInvoices(USER_ID);

      expect(prisma.userSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: USER_ID }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'inv-1',
        invoiceId: 'in_mock_1',
        amountDueCents: 999,
        amountPaidCents: 999,
        currency: 'USD',
        planName: 'Pro Monthly',
        planTier: SubscriptionTier.PRO,
      });
      expect(result[0].paidAt).toBe(paidAt.toISOString());
    });
  });
});
