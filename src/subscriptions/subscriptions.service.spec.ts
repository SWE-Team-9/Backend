import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FileRole,
  InvoiceStatus,
  SubscriptionStatus,
  SubscriptionTier,
} from "@prisma/client";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import {
  FREE_UPLOAD_LIMIT,
  GRACE_PERIOD_DAYS,
  PLAN_CONFIG,
  SubscriptionsService,
} from "./subscriptions.service";
import { SubscribeDto, SubscriptionTypeEnum } from "./dto/subscribe.dto";
import { CancelSubscriptionDto } from "./dto/cancel-subscription.dto";
import { PlanCodeEnum } from "./dto/checkout.dto";
import { ChangePlanCodeEnum } from "./dto/change-plan.dto";
import { BILLING_PROVIDER } from "../billing/billing-provider.interface";

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

const USER_ID = "user-uuid-1111";
const TRACK_ID = "track-uuid-2222";
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function makeActiveSub(
  tier: SubscriptionTier,
  uploadLimit: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub-uuid-3333",
    userId: USER_ID,
    planId: "plan-uuid-4444",
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    trialStart: null,
    trialEnd: null,
    stripeCustomerId: (overrides.stripeCustomerId as string) ?? "cus_mock_test",
    stripeSubscriptionId:
      (overrides.stripeSubscriptionId as string) ?? "sub_mock_test",
    plan: {
      tier,
      uploadLimit,
      name: "Pro Monthly",
      features: { adFree: true, offlineListening: true },
    },
    ...overrides,
  };
}

function makePlan(
  tier: SubscriptionTier,
  uploadLimit = 100,
  id = "plan-uuid-4444",
) {
  return {
    id,
    code: "pro-monthly",
    name: "Pro Monthly",
    tier,
    priceCents: 999,
    uploadLimit,
    isActive: true,
    features: { adFree: true, offlineListening: true },
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
    title: "Test Track",
    durationMs: 180000,
    coverArtUrl: null,
    files: overrides.files ?? [
      {
        storageKey: "tracks/uuid.mp3",
        fileRole: FileRole.STREAM,
        fileSizeBytes: BigInt(1024),
      },
    ],
    uploader: {
      profile: {
        displayName: overrides.uploaderDisplayName ?? "Test Artist",
        handle: overrides.handle ?? "test-artist",
      },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock Prisma
// ──────────────────────────────────────────────────────────────────────────────

const mockPrisma = {
  track: {
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  userSubscription: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  subscriptionPlan: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  billingInvoice: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn(),
  },
  paymentEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  trialRedemption: {
    findUnique: jest.fn().mockResolvedValue(null), // no prior redemption by default
    create: jest.fn().mockResolvedValue({}),
  },
  offlineDownload: {
    upsert: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({}),
  },
};

const mockBillingProvider = {
  getOrCreateCustomer: jest.fn().mockResolvedValue("cus_mock_test"),
  createCheckoutSession: jest.fn().mockResolvedValue({
    checkoutSessionId: "cs_mock_test",
    checkoutUrl: "https://checkout.mock/cs_mock_test",
    trialDays: 7,
    renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    trialEndsAt: null,
  }),
  createBillingPortalSession: jest.fn().mockResolvedValue({
    portalSessionId: "ps_mock",
    portalUrl: "https://portal.mock",
    capabilities: [],
  }),
  cancelSubscription: jest.fn().mockResolvedValue({ canceled: true }),
  resumeSubscription: jest.fn().mockResolvedValue({ resumed: true }),
  changePlan: jest.fn().mockResolvedValue({ changed: true }),
  retrieveSubscription: jest.fn().mockResolvedValue({}),
  constructWebhookEvent: jest.fn(),
};

const mockMailService = {
  sendPaymentFailedEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentFailedMovedToFreeEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentGracePeriodEmail: jest.fn().mockResolvedValue(undefined),
  sendTrialStartedEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendTrialEndingEmail: jest.fn().mockResolvedValue(undefined),
  sendCancellationConfirmedEmail: jest.fn().mockResolvedValue(undefined),
  sendInvoiceReceiptEmail: jest.fn().mockResolvedValue(undefined),
  sendPlanChangedEmail: jest.fn().mockResolvedValue(undefined),
};

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("SubscriptionsService", () => {
  let service: SubscriptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: BILLING_PROVIDER, useValue: mockBillingProvider },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) => {
              const cfg: Record<string, string> = {
                "storage.provider": "local",
                "storage.localUploadUrl": "http://localhost:3000/uploads",
                "storage.s3Bucket": "",
                "storage.s3Region": "us-east-1",
                "storage.awsAccessKeyId": "",
                "storage.awsSecretAccessKey": "",
              };
              return cfg[key] ?? fallback;
            },
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    jest.clearAllMocks();
    // Default user mock — must have isVerified:true for checkout() to proceed
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "test@example.com",
      isVerified: true,
      profile: { displayName: "Test User" },
    });
    // Defaults so tests only need to override what they specifically test
    mockPrisma.trialRedemption.findUnique.mockResolvedValue(null);
    mockPrisma.trialRedemption.create.mockResolvedValue({});
    mockPrisma.billingInvoice.findFirst.mockResolvedValue(null);
    mockPrisma.billingInvoice.findUnique.mockResolvedValue(null);
    mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-id" });
    mockPrisma.billingInvoice.findMany.mockResolvedValue([]);
    mockPrisma.paymentEvent.findUnique.mockResolvedValue(null);
    mockPrisma.paymentEvent.create.mockResolvedValue({ id: "evt-id" });
    mockPrisma.userSubscription.update.mockResolvedValue({});
    mockPrisma.userSubscription.create.mockResolvedValue({ id: "new-sub-id" });
    mockPrisma.userSubscription.findMany.mockResolvedValue([]);
    mockPrisma.track.findMany.mockResolvedValue([]);
    mockPrisma.track.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.offlineDownload.upsert.mockResolvedValue({});
    mockPrisma.offlineDownload.updateMany.mockResolvedValue({ count: 0 });
    mockBillingProvider.getOrCreateCustomer.mockResolvedValue("cus_mock_test");
    mockBillingProvider.createCheckoutSession.mockResolvedValue({
      checkoutSessionId: "cs_mock_test",
      checkoutUrl: "https://checkout.mock/cs_mock_test",
      planCode: "PRO",
      trialEligible: false,
      trialDays: 7,
      amountDueNowCents: 999,
      renewsAt: FUTURE.toISOString(),
      trialEndsAt: null,
    });
    mockBillingProvider.cancelSubscription.mockResolvedValue(undefined);
    mockBillingProvider.resumeSubscription.mockResolvedValue(undefined);
    mockBillingProvider.changePlan.mockResolvedValue({
      providerSubscriptionId: "sub_mock",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: FUTURE,
      cancelAtPeriodEnd: false,
    });
    mockBillingProvider.createBillingPortalSession.mockResolvedValue({
      portalSessionId: "bps_mock_test",
      portalUrl: "https://mock-portal.example.com/billing",
      capabilities: {
        canUpdatePaymentMethod: true,
        canCancel: true,
        canChangePlan: true,
        canViewReceipts: true,
      },
    });
    mockBillingProvider.constructWebhookEvent.mockImplementation(
      (buf: Buffer) => {
        return JSON.parse(buf.toString());
      },
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // getMySubscription
  // ────────────────────────────────────────────────────────────────────────

  describe("getMySubscription", () => {
    it("returns FREE defaults when the user has no active subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.track.count.mockResolvedValue(1);

      const result = await service.getMySubscription(USER_ID);

      expect(result).toMatchObject({
        userId: USER_ID,
        planCode: "FREE",
        uploadLimit: FREE_UPLOAD_LIMIT,
        uploadedTracks: 1,
        remainingUploads: FREE_UPLOAD_LIMIT - 1,
        currentPeriodEnd: null,
        adsEnabled: true,
        canDownload: false,
        isPremium: false,
      });
    });

    it("returns PRO subscription data when an active PRO subscription exists", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(5);

      const result = await service.getMySubscription(USER_ID);

      expect(result).toMatchObject({
        userId: USER_ID,
        planCode: "PRO",
        uploadLimit: 100,
        uploadedTracks: 5,
        remainingUploads: 95,
        adsEnabled: false,
        canDownload: true,
        isPremium: true,
      });
      expect(result.currentPeriodEnd).not.toBeNull();
    });

    it("returns GO_PLUS subscription data when an active GO_PLUS subscription exists", async () => {
      const sub = makeActiveSub(SubscriptionTier.GO_PLUS, 1000);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(10);

      const result = await service.getMySubscription(USER_ID);

      expect(result).toMatchObject({
        planCode: "GO_PLUS",
        uploadLimit: 1000,
        uploadedTracks: 10,
        remainingUploads: 990,
      });
    });

    it("returns remainingUploads=0 when user is at the limit", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.track.count.mockResolvedValue(FREE_UPLOAD_LIMIT);

      const result = await service.getMySubscription(USER_ID);

      expect(result.remainingUploads).toBe(0);
    });

    it("handles unlimited plan (uploadLimit=-1) by returning remainingUploads=null", async () => {
      const sub = makeActiveSub(SubscriptionTier.GO_PLUS, -1);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(999);

      const result = await service.getMySubscription(USER_ID);

      expect(result.uploadLimit).toBe(-1);
      expect(result.remainingUploads).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getPlans
  // ────────────────────────────────────────────────────────────────────────

  describe("getPlans", () => {
    it("returns all active plans with perks and uploadLimitDisplay", async () => {
      const rawPlans = [
        {
          id: "p1",
          code: "free-monthly",
          name: "Free",
          tier: SubscriptionTier.FREE,
          priceCents: 0,
          billingInterval: "MONTH",
          uploadLimit: 3,
          features: {},
        },
        {
          id: "p2",
          code: "pro-monthly",
          name: "Pro Monthly",
          tier: SubscriptionTier.PRO,
          priceCents: 999,
          billingInterval: "MONTH",
          uploadLimit: 100,
          features: {},
        },
      ];
      mockPrisma.subscriptionPlan.findMany.mockResolvedValue(rawPlans);

      const result = await service.getPlans();

      expect(result).toHaveLength(2);
      expect(result[0].uploadLimitDisplay).toBe("3");
      expect(result[1].canDownload).toBe(true);
      expect(result[1].adsEnabled).toBe(false);
    });

    it("displays 'Unlimited' for plans with uploadLimit=-1", async () => {
      mockPrisma.subscriptionPlan.findMany.mockResolvedValue([
        {
          id: "p1",
          code: "go-plus",
          name: "Go+",
          tier: SubscriptionTier.GO_PLUS,
          priceCents: 1999,
          billingInterval: "MONTH",
          uploadLimit: -1,
          features: {},
        },
      ]);

      const result = await service.getPlans();

      expect(result[0].uploadLimitDisplay).toBe("Unlimited");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // subscribe
  // ────────────────────────────────────────────────────────────────────────

  describe("subscribe", () => {
    const dto: SubscribeDto = {
      subscriptionType: SubscriptionTypeEnum.PRO,
      paymentMethodId: "pm_test_card",
    };

    it("starts a free trial for first-time PRO subscribers", async () => {
      const plan = makePlan(SubscriptionTier.PRO, 100);
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null); // no existing sub — trial eligible
      mockPrisma.userSubscription.create.mockResolvedValue({
        id: "trial-sub-id",
      });
      mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-id" });
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      const result = await service.subscribe(USER_ID, dto);

      // Subscription should be created (not updated)
      expect(mockPrisma.userSubscription.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
      // $0 paid now, but invoice due amount is still the plan price
      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountDueCents: plan.priceCents,
            amountPaidCents: 0,
          }),
        }),
      );
      // Event type should be trial_started, not payment_succeeded
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "customer.subscription.trial_started",
          }),
        }),
      );
      expect(result.planCode).toBe("PRO");
    });

    it("does not start trial if a TrialRedemption already exists (charges normally)", async () => {
      // User has a prior TrialRedemption record — no second trial allowed
      const plan = makePlan(SubscriptionTier.PRO, 100);
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null); // no active sub
      mockPrisma.trialRedemption.findUnique.mockResolvedValueOnce({
        id: "redemption-id",
      }); // already redeemed
      mockPrisma.userSubscription.create.mockResolvedValue({
        id: "new-sub-id",
      });
      mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-id" });
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.subscribe(USER_ID, dto);

      // Normal paid subscription — full price invoice
      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountDueCents: plan.priceCents,
            amountPaidCents: plan.priceCents,
          }),
        }),
      );
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "invoice.payment_succeeded",
          }),
        }),
      );
    });

    it("upgrades an existing active subscription when switching to a different plan", async () => {
      // Use a different plan ID to simulate an upgrade (GO_PLUS → PRO or PRO → different plan)
      const plan = makePlan(SubscriptionTier.PRO, 100, "plan-uuid-NEW");
      const existing = makeActiveSub(SubscriptionTier.GO_PLUS, 50); // planId='plan-uuid-4444'
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);
      mockPrisma.userSubscription.findFirst.mockResolvedValueOnce(existing); // findActiveSubscription
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-id" });
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      const result = await service.subscribe(USER_ID, dto);

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userSubscription.create).not.toHaveBeenCalled();
      expect(result.planCode).toBe("PRO");
    });

    it("throws ConflictException when user subscribes to the same plan they already have", async () => {
      // Same plan ID on both existing sub and queried plan
      const plan = makePlan(SubscriptionTier.PRO, 100); // id='plan-uuid-4444'
      const existing = makeActiveSub(SubscriptionTier.PRO, 100); // planId='plan-uuid-4444'
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);
      mockPrisma.userSubscription.findFirst.mockResolvedValueOnce(existing);

      await expect(service.subscribe(USER_ID, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it("throws BadRequestException when no active plan is found for the requested tier", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(null);

      await expect(service.subscribe(USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.subscribe(USER_ID, dto)).rejects.toMatchObject({
        message: expect.stringContaining("No active plan"),
      });
    });

    it("passes the correct tier to the plan query for GO_PLUS", async () => {
      const plan = makePlan(SubscriptionTier.GO_PLUS, 1000);
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null); // no existing sub
      mockPrisma.userSubscription.create.mockResolvedValue({
        id: "new-sub-id",
      });

      const result = await service.subscribe(USER_ID, {
        subscriptionType: SubscriptionTypeEnum.GO_PLUS,
        paymentMethodId: "pm_test",
      });

      expect(mockPrisma.subscriptionPlan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tier: "GO_PLUS" }),
        }),
      );
      expect(result.planCode).toBe("GO_PLUS");
    });

    it("re-activates a cancelled-but-still-active subscription without charging again", async () => {
      const plan = makePlan(SubscriptionTier.PRO, 100);
      // Existing sub is active but marked as cancel-at-period-end
      const existing = {
        ...makeActiveSub(SubscriptionTier.PRO, 100),
        cancelAtPeriodEnd: true,
      };
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(existing); // findActiveSubscription
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      const result = await service.subscribe(USER_ID, {
        subscriptionType: SubscriptionTypeEnum.PRO,
        paymentMethodId: "pm_test",
      });

      // Should update (un-cancel), NOT create a new sub
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
      expect(mockPrisma.userSubscription.create).not.toHaveBeenCalled();
      expect(result.planCode).toBe("PRO");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // cancelSubscription
  // ────────────────────────────────────────────────────────────────────────

  describe("cancelSubscription", () => {
    const dto: CancelSubscriptionDto = {};

    it("throws ConflictException when user has no active subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(service.cancelSubscription(USER_ID, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it("sets cancelAtPeriodEnd=true and returns accessUntil", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      const result = await service.cancelSubscription(USER_ID, dto);

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancelAtPeriodEnd: true }),
        }),
      );
      expect(result.expiresAt).not.toBeNull();
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "customer.subscription.updated",
          }),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // handleStripeWebhook
  // ────────────────────────────────────────────────────────────────────────

  describe("handleStripeWebhook", () => {
    function makeWebhookEvent(
      type: string,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        id: `evt_mock_${type.replace(/\./g, "_")}`,
        type,
        data: { object: { id: "sub_mock_test", ...overrides } },
      };
    }

    function makeWebhookBuffer(
      type: string,
      overrides: Record<string, unknown> = {},
    ): Buffer {
      return Buffer.from(JSON.stringify(makeWebhookEvent(type, overrides)));
    }

    beforeEach(() => {
      mockPrisma.paymentEvent.findUnique.mockResolvedValue(null); // no duplicate
      mockPrisma.paymentEvent.create.mockResolvedValue({});
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.billingInvoice.findUnique.mockResolvedValue(null);
      mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-id" });
      mockBillingProvider.constructWebhookEvent.mockImplementation(
        (_buf: Buffer) => {
          return JSON.parse(_buf.toString()) as ReturnType<
            typeof makeWebhookEvent
          >;
        },
      );
    });

    it("returns { received: true } for any event", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null); // sub not found is OK

      const result = await service.handleStripeWebhook(
        makeWebhookBuffer("invoice.payment_succeeded"),
        "",
      );

      expect(result).toEqual({ received: true });
    });

    it("marks subscription ACTIVE on invoice.payment_succeeded", async () => {
      const sub = {
        id: "sub-uuid-3333",
        userId: USER_ID,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock_test",
        plan: { name: "Pro", tier: SubscriptionTier.PRO },
      };
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);

      await service.handleStripeWebhook(
        makeWebhookBuffer("invoice.payment_succeeded", {
          invoice: "in_mock_x",
          amount_paid: 999,
          currency: "usd",
        }),
        "",
      );

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
    });

    it("marks subscription PAST_DUE and sends grace period email on invoice.payment_failed", async () => {
      const sub = {
        id: "sub-uuid-3333",
        userId: USER_ID,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock_test",
        plan: { name: "Pro", tier: SubscriptionTier.PRO },
      };
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "user@example.com",
        isVerified: true,
        profile: { displayName: "Test User" },
      });

      await service.handleStripeWebhook(
        makeWebhookBuffer("invoice.payment_failed"),
        "",
      );

      // Status should be PAST_DUE (grace period — user keeps access)
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.PAST_DUE,
          }),
        }),
      );
      // Grace period email should be sent (not the cancel email)
      expect(mockMailService.sendPaymentGracePeriodEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com" }),
      );
    });

    it("marks subscription CANCELED on customer.subscription.deleted", async () => {
      const sub = {
        id: "sub-uuid-3333",
        userId: USER_ID,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock_test",
        plan: { name: "Pro", tier: SubscriptionTier.PRO },
      };
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.findMany.mockResolvedValue([]); // applyPlanLimitToTracks

      await service.handleStripeWebhook(
        makeWebhookBuffer("customer.subscription.deleted"),
        "",
      );

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.CANCELED,
          }),
        }),
      );
    });

    it("is idempotent — skips duplicate events", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue({
        id: "sub-uuid-3333",
        userId: USER_ID,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock_test",
        plan: { name: "Pro", tier: SubscriptionTier.PRO },
      });
      mockPrisma.paymentEvent.findUnique.mockResolvedValue({
        id: "existing-evt",
      }); // already exists

      await service.handleStripeWebhook(
        makeWebhookBuffer("invoice.payment_succeeded"),
        "",
      );

      // Should not create a duplicate PaymentEvent
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getOfflineTrack
  // ────────────────────────────────────────────────────────────────────────

  describe("getOfflineTrack", () => {
    it("throws ForbiddenException (DOWNLOAD_NOT_ALLOWED) when user has no subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(service.getOfflineTrack(USER_ID, TRACK_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ForbiddenException (DOWNLOAD_NOT_ALLOWED) when user has FREE tier subscription", async () => {
      const freeSub = makeActiveSub(SubscriptionTier.FREE, FREE_UPLOAD_LIMIT);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(freeSub);

      await expect(service.getOfflineTrack(USER_ID, TRACK_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns local download URL for PRO users with local storage", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result.downloadUrl).toContain("http://localhost:3000/uploads");
      expect(result.trackId).toBe(TRACK_ID);
      expect(result.title).toBe("Test Track");
      expect(result.artist).toBe("Test Artist");
      expect(result.expiresAt).toBeDefined();
    });

    it("throws NotFoundException when track does not exist", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.findFirst.mockResolvedValue(null);

      await expect(service.getOfflineTrack(USER_ID, TRACK_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when track has no audio files", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack({ files: [] }));

      await expect(service.getOfflineTrack(USER_ID, TRACK_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("prefers STREAM file over ORIGINAL when both are available", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      const files = [
        {
          storageKey: "tracks/original.wav",
          fileRole: FileRole.ORIGINAL,
          fileSizeBytes: BigInt(2048),
        },
        {
          storageKey: "tracks/stream.mp3",
          fileRole: FileRole.STREAM,
          fileSizeBytes: BigInt(1024),
        },
      ];
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack({ files }));

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result.downloadUrl).toContain("tracks/stream.mp3");
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getUploadQuota
  // ────────────────────────────────────────────────────────────────────────

  describe("getUploadQuota", () => {
    it("falls back to FREE_UPLOAD_LIMIT when no subscription exists", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.track.count.mockResolvedValue(1);

      const result = await service.getUploadQuota(USER_ID);

      expect(result).toEqual({
        uploadLimit: FREE_UPLOAD_LIMIT,
        uploadedCount: 1,
      });
    });

    it("returns plan limit when user has an active PRO subscription", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(10);

      const result = await service.getUploadQuota(USER_ID);

      expect(result).toEqual({ uploadLimit: 100, uploadedCount: 10 });
    });

    it("returns plan limit for GO_PLUS subscription", async () => {
      const sub = makeActiveSub(SubscriptionTier.GO_PLUS, 1000);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(50);

      const result = await service.getUploadQuota(USER_ID);

      expect(result).toEqual({ uploadLimit: 1000, uploadedCount: 50 });
    });

    it("returns plan config limit for unlimited plan (uploadLimit=-1 in DB → GO_PLUS config limit)", async () => {
      const sub = makeActiveSub(SubscriptionTier.GO_PLUS, -1);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(999);

      const result = await service.getUploadQuota(USER_ID);

      // GO_PLUS PLAN_CONFIG has uploadLimit=1000
      expect(result.uploadLimit).toBe(1000);
      expect(result.uploadedCount).toBe(999);
    });

    it("calls track.count with the correct userId filter", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.track.count.mockResolvedValue(0);

      await service.getUploadQuota(USER_ID);

      expect(mockPrisma.track.count).toHaveBeenCalledWith({
        where: { uploaderId: USER_ID, deletedAt: null },
      });
    });

    it("FREE boundary: exactly at limit (3/3 uploaded)", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.track.count.mockResolvedValue(FREE_UPLOAD_LIMIT);

      const { uploadLimit, uploadedCount } =
        await service.getUploadQuota(USER_ID);

      expect(uploadedCount).toBe(uploadLimit); // at limit, 0 remaining
    });

    it("PRO boundary: exactly at PRO limit (100/100)", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );
      mockPrisma.track.count.mockResolvedValue(100);

      const { uploadLimit, uploadedCount } =
        await service.getUploadQuota(USER_ID);

      expect(uploadLimit).toBe(100);
      expect(uploadedCount).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PLAN_CONFIG static contract
  // ─────────────────────────────────────────────────────────────────────────

  describe("PLAN_CONFIG static catalog", () => {
    it("exports exactly 3 plans: FREE, PRO, GO_PLUS", () => {
      expect(Object.keys(PLAN_CONFIG)).toEqual(
        expect.arrayContaining(["FREE", "PRO", "GO_PLUS"]),
      );
      expect(Object.keys(PLAN_CONFIG)).toHaveLength(3);
    });

    it("FREE is ad-supported, no downloads, community support, no trial", () => {
      expect(PLAN_CONFIG.FREE).toMatchObject({
        priceCents: 0,
        uploadLimit: 3,
        adsEnabled: true,
        canDownload: false,
        supportLevel: "community",
        trialDays: 0,
      });
    });

    it("PRO is ad-free, allows downloads, priority support, 7-day trial", () => {
      expect(PLAN_CONFIG.PRO).toMatchObject({
        priceCents: 999,
        uploadLimit: 100,
        adsEnabled: false,
        canDownload: true,
        supportLevel: "priority",
        trialDays: 7,
      });
    });

    it("GO_PLUS is ad-free, allows downloads, priority support, 30-day trial", () => {
      expect(PLAN_CONFIG.GO_PLUS).toMatchObject({
        priceCents: 1999,
        uploadLimit: 1000,
        adsEnabled: false,
        canDownload: true,
        supportLevel: "priority",
        trialDays: 30,
      });
    });

    it("FREE_UPLOAD_LIMIT === PLAN_CONFIG.FREE.uploadLimit === 3", () => {
      expect(FREE_UPLOAD_LIMIT).toBe(3);
      expect(FREE_UPLOAD_LIMIT).toBe(PLAN_CONFIG.FREE.uploadLimit);
    });

    it("GRACE_PERIOD_DAYS is 1 (user-specified value)", () => {
      expect(GRACE_PERIOD_DAYS).toBe(1);
    });

    it("GO_PLUS uploadLimit > PRO uploadLimit", () => {
      expect(PLAN_CONFIG.GO_PLUS.uploadLimit).toBeGreaterThan(
        PLAN_CONFIG.PRO.uploadLimit,
      );
    });

    it("GO_PLUS trialDays > PRO trialDays", () => {
      expect(PLAN_CONFIG.GO_PLUS.trialDays).toBeGreaterThan(
        PLAN_CONFIG.PRO.trialDays,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // checkout() — additional cases not covered by subscribe() tests
  // ─────────────────────────────────────────────────────────────────────────

  describe("checkout()", () => {
    beforeEach(() => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.PRO, 100),
      );
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
    });

    it("throws NotFoundException when user does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException(EMAIL_NOT_VERIFIED) for unverified users", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        email: "test@example.com",
        isVerified: false,
        profile: null,
      });
      await expect(
        service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }),
      });
    });

    it("throws BadRequestException for invalid plan code", async () => {
      await expect(
        service.checkout(USER_ID, { planCode: "INVALID" as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when no active plan record in DB", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(null);
      await expect(
        service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO }),
      ).rejects.toThrow(BadRequestException);
    });

    it("charges full price on non-trial subscription", async () => {
      mockPrisma.trialRedemption.findUnique.mockResolvedValue({
        id: "prior-redemption",
      });

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountDueCents: 999,
            amountPaidCents: 999, // full price paid immediately
          }),
        }),
      );
    });

    it("sets amountPaidCents=0 and records trial_started event on trial", async () => {
      // trialRedemption returns null → trial eligible
      mockBillingProvider.createCheckoutSession.mockResolvedValue({
        checkoutSessionId: "cs_trial",
        checkoutUrl: "https://checkout.mock/trial",
        planCode: "PRO",
        trialEligible: true,
        trialDays: 7,
        amountDueNowCents: 0,
        renewsAt: FUTURE.toISOString(),
        trialEndsAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amountPaidCents: 0 }),
        }),
      );
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "customer.subscription.trial_started",
          }),
        }),
      );
    });

    it("creates TrialRedemption record when trial is eligible", async () => {
      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockPrisma.trialRedemption.create).toHaveBeenCalledTimes(1);
    });

    it("skips TrialRedemption creation when prior redemption exists", async () => {
      mockPrisma.trialRedemption.findUnique.mockResolvedValue({ id: "prior" });

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockPrisma.trialRedemption.create).not.toHaveBeenCalled();
    });

    it("passes trialDays=7 to billing provider for first PRO checkout", async () => {
      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockBillingProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ trialDays: 7 }),
      );
    });

    it("passes trialDays=0 to billing provider when trial already used", async () => {
      mockPrisma.trialRedemption.findUnique.mockResolvedValue({ id: "prior" });

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockBillingProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ trialDays: 0 }),
      );
    });

    it("passes trialDays=30 to billing provider for first GO_PLUS checkout", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(
        makePlan(SubscriptionTier.GO_PLUS, 1000),
      );

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.GO_PLUS });

      expect(mockBillingProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ trialDays: 30 }),
      );
    });

    it("invoice currency is USD", async () => {
      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: "USD" }),
        }),
      );
    });

    it("includes checkoutSessionId and checkoutUrl in response", async () => {
      const result = await service.checkout(USER_ID, {
        planCode: PlanCodeEnum.PRO,
      });

      expect(result.checkoutSessionId).toBe("cs_mock_test");
      expect(result.checkoutUrl).toContain("http");
    });

    it("response includes priceCents matching PLAN_CONFIG", async () => {
      const result = await service.checkout(USER_ID, {
        planCode: PlanCodeEnum.PRO,
      });

      expect(result.priceCents).toBe(999);
    });

    it("reactivates cancel-scheduled same-plan sub (resume instead of re-checkout)", async () => {
      const canceledSub = {
        ...makeActiveSub(SubscriptionTier.PRO, 100),
        cancelAtPeriodEnd: true,
      };
      mockPrisma.userSubscription.findFirst.mockResolvedValue(canceledSub);

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockBillingProvider.resumeSubscription).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
      // No new billing session created
      expect(mockBillingProvider.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("throws ConflictException(SUBSCRIPTION_ALREADY_ACTIVE) on duplicate active same-plan", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );

      await expect(
        service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "SUBSCRIPTION_ALREADY_ACTIVE",
        }),
      });
    });

    it("updates (not creates) sub when upgrading to different plan", async () => {
      const goPlusPlan = makePlan(
        SubscriptionTier.GO_PLUS,
        1000,
        "plan-uuid-GOPLUS",
      );
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(goPlusPlan);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.GO_PLUS });

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userSubscription.create).not.toHaveBeenCalled();
    });

    it("passes userId and planId metadata to createCheckoutSession", async () => {
      const plan = makePlan(SubscriptionTier.PRO, 100, "plan-uuid-4444");
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(plan);

      await service.checkout(USER_ID, { planCode: PlanCodeEnum.PRO });

      expect(mockBillingProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            userId: USER_ID,
            planId: "plan-uuid-4444",
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resumeSubscription()
  // ─────────────────────────────────────────────────────────────────────────

  describe("resumeSubscription()", () => {
    it("throws NotFoundException when no active subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      await expect(service.resumeSubscription(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ConflictException(SUBSCRIPTION_NOT_CANCELED) when sub is not set to cancel", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: false }),
      );
      await expect(service.resumeSubscription(USER_ID)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "SUBSCRIPTION_NOT_CANCELED",
        }),
      });
    });

    it("calls billing.resumeSubscription and clears cancelAtPeriodEnd flag", async () => {
      const canceledSub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: true,
      });
      // first call: findActiveSubscription for resumeSubscription
      // second call: findActiveSubscription for getMySubscription (called at end)
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(canceledSub)
        .mockResolvedValueOnce(
          makeActiveSub(SubscriptionTier.PRO, 100, {
            cancelAtPeriodEnd: false,
          }),
        );
      mockPrisma.track.count.mockResolvedValue(0);

      await service.resumeSubscription(USER_ID);

      expect(mockBillingProvider.resumeSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: canceledSub.stripeSubscriptionId,
        }),
      );
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
    });

    it("returns updated subscription state after resuming", async () => {
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(
          makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true }),
        )
        .mockResolvedValueOnce(
          makeActiveSub(SubscriptionTier.PRO, 100, {
            cancelAtPeriodEnd: false,
          }),
        );
      mockPrisma.track.count.mockResolvedValue(0);

      const result = await service.resumeSubscription(USER_ID);

      expect(result.planCode).toBe("PRO");
      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it("logs payment event on resume", async () => {
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(
          makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true }),
        )
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100));
      mockPrisma.track.count.mockResolvedValue(0);

      await service.resumeSubscription(USER_ID);

      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "customer.subscription.updated",
          }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // cancelSubscription() — additional coverage
  // ─────────────────────────────────────────────────────────────────────────

  describe("cancelSubscription() — extended", () => {
    const dto: CancelSubscriptionDto = {};

    it("throws ConflictException(SUBSCRIPTION_ALREADY_CANCELED) when already canceling", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100, { cancelAtPeriodEnd: true }),
      );
      await expect(
        service.cancelSubscription(USER_ID, dto),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "SUBSCRIPTION_ALREADY_CANCELED",
        }),
      });
    });

    it('response message includes "full access" wording', async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );

      const result = await service.cancelSubscription(USER_ID, dto);

      expect(result.message).toContain("full access");
    });

    it("calls billing.cancelSubscription with cancelAtPeriodEnd=true", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);

      await service.cancelSubscription(USER_ID, dto);

      expect(mockBillingProvider.cancelSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ cancelAtPeriodEnd: true }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // changePlan()
  // ─────────────────────────────────────────────────────────────────────────

  describe("changePlan()", () => {
    const proPlan = makePlan(SubscriptionTier.PRO, 100, "plan-uuid-PRO");
    const goPlusPlan = makePlan(
      SubscriptionTier.GO_PLUS,
      1000,
      "plan-uuid-GOPLUS",
    );

    it("throws NotFoundException when no active subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      await expect(
        service.changePlan(USER_ID, { planCode: ChangePlanCodeEnum.GO_PLUS }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException(PLAN_ALREADY_ACTIVE) when changing to current plan", async () => {
      const sub = makeActiveSub(SubscriptionTier.GO_PLUS, 1000);
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(goPlusPlan);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);

      await expect(
        service.changePlan(USER_ID, { planCode: ChangePlanCodeEnum.GO_PLUS }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "PLAN_ALREADY_ACTIVE" }),
      });
    });

    it("throws BadRequestException when planCode is FREE", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );

      await expect(
        service.changePlan(USER_ID, { planCode: "FREE" as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when target plan not found in DB", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.changePlan(USER_ID, { planCode: ChangePlanCodeEnum.GO_PLUS }),
      ).rejects.toThrow(BadRequestException);
    });

    it("PRO → GO_PLUS: updates subscription planId to GO_PLUS plan", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(goPlusPlan);
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100))
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.GO_PLUS, 1000));
      mockPrisma.track.count.mockResolvedValue(0);

      await service.changePlan(USER_ID, {
        planCode: ChangePlanCodeEnum.GO_PLUS,
      });

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planId: goPlusPlan.id }),
        }),
      );
    });

    it("calls billing.changePlan once", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(goPlusPlan);
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100))
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.GO_PLUS, 1000));
      mockPrisma.track.count.mockResolvedValue(0);

      await service.changePlan(USER_ID, {
        planCode: ChangePlanCodeEnum.GO_PLUS,
      });

      expect(mockBillingProvider.changePlan).toHaveBeenCalledTimes(1);
    });

    it("records customer.subscription.updated payment event", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(goPlusPlan);
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100))
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.GO_PLUS, 1000));
      mockPrisma.track.count.mockResolvedValue(0);

      await service.changePlan(USER_ID, {
        planCode: ChangePlanCodeEnum.GO_PLUS,
      });

      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "customer.subscription.updated",
          }),
        }),
      );
    });

    it("GO_PLUS → PRO: hides over-limit tracks (5 tracks, limit=3 → hides 2)", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(proPlan);
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.GO_PLUS, 1000))
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100));
      const tracks = [
        { id: "t1", hiddenByPlanLimit: false },
        { id: "t2", hiddenByPlanLimit: false },
        { id: "t3", hiddenByPlanLimit: false },
        { id: "t4", hiddenByPlanLimit: false },
        { id: "t5", hiddenByPlanLimit: false },
      ];
      mockPrisma.track.findMany.mockResolvedValue(tracks);
      mockPrisma.track.count.mockResolvedValue(5);

      await service.changePlan(USER_ID, { planCode: ChangePlanCodeEnum.PRO });

      // PRO uploadLimit in PLAN_CONFIG = 100, so no tracks should be hidden
      // (5 tracks is within 100 limit)
      expect(mockPrisma.track.updateMany).not.toHaveBeenCalled();
    });

    it("FREE downgrade path: 10 tracks with FREE limit=3 hides 7", async () => {
      // Called via applyPlanLimitToTracks directly (not through changePlan)
      const tracks = Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`,
        hiddenByPlanLimit: false,
      }));
      mockPrisma.track.findMany.mockResolvedValue(tracks);

      await service.applyPlanLimitToTracks(USER_ID, FREE_UPLOAD_LIMIT);

      expect(mockPrisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: tracks.slice(FREE_UPLOAD_LIMIT).map((t) => t.id) },
          },
          data: expect.objectContaining({ hiddenByPlanLimit: true }),
        }),
      );
    });

    it("returns updated subscription plan after change", async () => {
      mockPrisma.subscriptionPlan.findFirst.mockResolvedValue(goPlusPlan);
      mockPrisma.userSubscription.findFirst
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.PRO, 100))
        .mockResolvedValueOnce(makeActiveSub(SubscriptionTier.GO_PLUS, 1000));
      mockPrisma.track.count.mockResolvedValue(0);

      const result = await service.changePlan(USER_ID, {
        planCode: ChangePlanCodeEnum.GO_PLUS,
      });

      expect(result.planCode).toBe("GO_PLUS");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createBillingPortal()
  // ─────────────────────────────────────────────────────────────────────────

  describe("createBillingPortal()", () => {
    it("throws NotFoundException when user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      await expect(service.createBillingPortal(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns portalUrl from billing provider", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.createBillingPortal(USER_ID);

      expect(result.portalUrl).toContain("http");
      expect(result.portalSessionId).toBeTruthy();
    });

    it("returns currentPlanCode=PRO when user has active PRO subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );

      const result = await service.createBillingPortal(USER_ID);

      expect(result.currentPlanCode).toBe("PRO");
    });

    it("returns currentPlanCode=FREE when user has no subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.createBillingPortal(USER_ID);

      expect(result.currentPlanCode).toBe("FREE");
    });

    it("passes returnUrl to billing provider", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      await service.createBillingPortal(USER_ID, {
        returnUrl: "https://app.example.com/return",
      });

      expect(
        mockBillingProvider.createBillingPortalSession,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          returnUrl: "https://app.example.com/return",
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getInvoices()
  // ─────────────────────────────────────────────────────────────────────────

  describe("getInvoices()", () => {
    it("returns empty array when user has no subscriptions", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([]);

      const result = await service.getInvoices(USER_ID);

      expect(result).toEqual([]);
      expect(mockPrisma.billingInvoice.findMany).not.toHaveBeenCalled();
    });

    it("returns mapped invoice list", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([{ id: "sub-1" }]);
      mockPrisma.billingInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          stripeInvoiceId: "in_mock_1",
          amountDueCents: 999,
          amountPaidCents: 999,
          currency: "USD",
          status: "PAID",
          dueAt: new Date("2024-01-15"),
          paidAt: new Date("2024-01-15"),
          createdAt: new Date("2024-01-15"),
          subscription: {
            plan: { name: "Pro Monthly", tier: SubscriptionTier.PRO },
          },
        },
      ]);

      const result = await service.getInvoices(USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "inv-1",
        invoiceId: "in_mock_1",
        amountDueCents: 999,
        amountPaidCents: 999,
        currency: "USD",
        planName: "Pro Monthly",
        planTier: SubscriptionTier.PRO,
      });
    });

    it("formats dueAt and paidAt as ISO strings", async () => {
      const testDate = new Date("2024-03-01T12:00:00Z");
      mockPrisma.userSubscription.findMany.mockResolvedValue([{ id: "sub-1" }]);
      mockPrisma.billingInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          stripeInvoiceId: "in_mock_1",
          amountDueCents: 999,
          amountPaidCents: 999,
          currency: "USD",
          status: "PAID",
          dueAt: testDate,
          paidAt: testDate,
          createdAt: testDate,
          subscription: {
            plan: { name: "Pro Monthly", tier: SubscriptionTier.PRO },
          },
        },
      ]);

      const result = await service.getInvoices(USER_ID);

      expect(result[0].paidAt).toBe(testDate.toISOString());
      expect(result[0].createdAt).toBe(testDate.toISOString());
    });

    it("handles null dueAt and paidAt without crashing", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([{ id: "sub-1" }]);
      mockPrisma.billingInvoice.findMany.mockResolvedValue([
        {
          id: "inv-1",
          stripeInvoiceId: "in_mock_1",
          amountDueCents: 999,
          amountPaidCents: 0,
          currency: "USD",
          status: "OPEN",
          dueAt: null,
          paidAt: null,
          createdAt: new Date(),
          subscription: {
            plan: { name: "Pro Monthly", tier: SubscriptionTier.PRO },
          },
        },
      ]);

      const result = await service.getInvoices(USER_ID);

      expect(result[0].dueAt).toBeNull();
      expect(result[0].paidAt).toBeNull();
    });

    it("scopes subscription query to userId (prevents cross-user data leak)", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([]);

      await service.getInvoices(USER_ID);

      expect(mockPrisma.userSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: USER_ID }),
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // handleStripeWebhook() — extended coverage
  // ─────────────────────────────────────────────────────────────────────────

  describe("handleStripeWebhook() — extended", () => {
    function makeWebhookBuf(
      type: string,
      overrides: Record<string, unknown> = {},
    ): Buffer {
      return Buffer.from(
        JSON.stringify({
          id: `evt_ext_${type.replace(/\./g, "_")}_${Date.now()}`,
          type,
          data: { object: { id: "sub_mock_test", ...overrides } },
        }),
      );
    }

    beforeEach(() => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue({
        id: "sub-uuid-3333",
        userId: USER_ID,
        stripeCustomerId: "cus_mock",
        stripeSubscriptionId: "sub_mock_test",
        plan: { name: "Pro Monthly", tier: SubscriptionTier.PRO },
      });
    });

    it("throws BadRequestException(WEBHOOK_INVALID_SIGNATURE) on bad payload", async () => {
      mockBillingProvider.constructWebhookEvent.mockImplementation(() => {
        throw new Error("WEBHOOK_INVALID_SIGNATURE");
      });

      await expect(
        service.handleStripeWebhook(Buffer.from("bad"), "bad_sig"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "WEBHOOK_INVALID_SIGNATURE",
        }),
      });
    });

    it("invoice.paid marks subscription ACTIVE (alias for payment_succeeded)", async () => {
      await service.handleStripeWebhook(makeWebhookBuf("invoice.paid"), "");

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
    });

    it("checkout.session.completed marks subscription ACTIVE", async () => {
      await service.handleStripeWebhook(
        makeWebhookBuf("checkout.session.completed"),
        "",
      );

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
    });

    it("invoice.payment_failed sets paymentFailureGraceEndsAt to now + GRACE_PERIOD_DAYS", async () => {
      const before = Date.now();
      await service.handleStripeWebhook(
        makeWebhookBuf("invoice.payment_failed"),
        "",
      );
      const after = Date.now();

      const updateCall = mockPrisma.userSubscription.update.mock.calls[0][0];
      const graceEndsAt = (updateCall.data as any).paymentFailureGraceEndsAt;
      expect(graceEndsAt).toBeInstanceOf(Date);
      const expectedMin = before + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      const expectedMax = after + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
      expect(graceEndsAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(graceEndsAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it("invoice.payment_action_required sets status to PAST_DUE", async () => {
      await service.handleStripeWebhook(
        makeWebhookBuf("invoice.payment_action_required"),
        "",
      );

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.PAST_DUE,
          }),
        }),
      );
    });

    it("customer.subscription.updated syncs trialing status", async () => {
      await service.handleStripeWebhook(
        makeWebhookBuf("customer.subscription.updated", {
          status: "trialing",
          cancel_at_period_end: false,
        }),
        "",
      );

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionStatus.TRIALING,
          }),
        }),
      );
    });

    it("customer.subscription.trial_will_end sends trial ending email", async () => {
      mockPrisma.userSubscription.findUnique.mockResolvedValue({
        currentPeriodEnd: FUTURE,
        cancelAtPeriodEnd: false,
        plan: { priceCents: 999, name: "Pro Monthly" },
      });

      await service.handleStripeWebhook(
        makeWebhookBuf("customer.subscription.trial_will_end"),
        "",
      );

      expect(mockMailService.sendTrialEndingEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "test@example.com" }),
      );
    });

    it("customer.subscription.trial_will_end skips email when cancelAtPeriodEnd=true", async () => {
      mockPrisma.userSubscription.findUnique.mockResolvedValue({
        currentPeriodEnd: FUTURE,
        cancelAtPeriodEnd: true, // user already canceled
        plan: { priceCents: 999, name: "Pro Monthly" },
      });

      await service.handleStripeWebhook(
        makeWebhookBuf("customer.subscription.trial_will_end"),
        "",
      );

      expect(mockMailService.sendTrialEndingEmail).not.toHaveBeenCalled();
    });

    it("invoice.payment_succeeded skips duplicate invoice creation", async () => {
      mockPrisma.billingInvoice.findUnique.mockResolvedValue({
        id: "existing-inv",
      });

      await service.handleStripeWebhook(
        makeWebhookBuf("invoice.payment_succeeded", {
          invoice: "in_dupe",
          amount_paid: 999,
        }),
        "",
      );

      expect(mockPrisma.billingInvoice.create).not.toHaveBeenCalled();
    });

    it("customer.subscription.deleted revokes offline downloads", async () => {
      await service.handleStripeWebhook(
        makeWebhookBuf("customer.subscription.deleted"),
        "",
      );

      expect(mockPrisma.offlineDownload.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID } }),
      );
    });

    it("customer.subscription.deleted applies FREE limit to user tracks", async () => {
      const tracks = Array.from({ length: 5 }, (_, i) => ({
        id: `t${i}`,
        hiddenByPlanLimit: false,
      }));
      mockPrisma.track.findMany.mockResolvedValue(tracks);

      await service.handleStripeWebhook(
        makeWebhookBuf("customer.subscription.deleted"),
        "",
      );

      // 5 tracks > FREE_UPLOAD_LIMIT(3) → 2 tracks should be hidden
      expect(mockPrisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hiddenByPlanLimit: true }),
        }),
      );
    });

    it("unknown event type returns { received: true } silently", async () => {
      const result = await service.handleStripeWebhook(
        makeWebhookBuf("completely.unknown.event"),
        "",
      );

      expect(result).toEqual({ received: true });
      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
    });

    it("events with no matching subscription still return { received: true }", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.handleStripeWebhook(
        makeWebhookBuf("invoice.payment_succeeded"),
        "",
      );

      expect(result).toEqual({ received: true });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getOfflineTrack() — extended
  // ─────────────────────────────────────────────────────────────────────────

  describe("getOfflineTrack() — extended", () => {
    it("GO_PLUS users can also download tracks", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.GO_PLUS, 1000),
      );
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result.planCode).toBe("GO_PLUS");
      expect(result.downloadUrl).toBeTruthy();
    });

    it("response includes all required fields", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(result).toMatchObject({
        trackId: TRACK_ID,
        title: "Test Track",
        artist: "Test Artist",
        handle: "test-artist",
        planCode: "PRO",
      });
      expect(result.downloadUrl).toBeTruthy();
      expect(result.expiresAt).toBeTruthy();
      expect(result.expiresInSeconds).toBeGreaterThan(0);
      expect(result.offlineTokenId).toBeTruthy();
      expect(typeof result.durationMs).toBe("number");
    });

    it("expiresAt is in the future", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("upserts OfflineDownload audit record", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack());

      await service.getOfflineTrack(USER_ID, TRACK_ID);

      expect(mockPrisma.offlineDownload.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId_deviceId_trackId: expect.any(Object),
          }),
        }),
      );
    });

    it("does not include stripeCustomerId or AWS credentials in response", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub(SubscriptionTier.PRO, 100),
      );
      mockPrisma.track.findFirst.mockResolvedValue(makeTrack());

      const result = await service.getOfflineTrack(USER_ID, TRACK_ID);
      const json = JSON.stringify(result);

      expect(json).not.toContain("stripeCustomerId");
      expect(json).not.toContain("secretAccessKey");
      expect(json).not.toContain("accessKeyId");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // applyPlanLimitToTracks()
  // ─────────────────────────────────────────────────────────────────────────

  describe("applyPlanLimitToTracks()", () => {
    it("does nothing when user has no tracks", async () => {
      mockPrisma.track.findMany.mockResolvedValue([]);

      await service.applyPlanLimitToTracks(USER_ID, 100);

      expect(mockPrisma.track.updateMany).not.toHaveBeenCalled();
    });

    it("does nothing when all tracks fit within the limit", async () => {
      mockPrisma.track.findMany.mockResolvedValue([
        { id: "t1", hiddenByPlanLimit: false },
        { id: "t2", hiddenByPlanLimit: false },
      ]);

      await service.applyPlanLimitToTracks(USER_ID, 5); // limit=5, only 2 tracks

      expect(mockPrisma.track.updateMany).not.toHaveBeenCalled();
    });

    it("hides over-limit tracks", async () => {
      const tracks = [
        { id: "t1", hiddenByPlanLimit: false },
        { id: "t2", hiddenByPlanLimit: false },
        { id: "t3", hiddenByPlanLimit: false },
        { id: "t4", hiddenByPlanLimit: false },
      ];
      mockPrisma.track.findMany.mockResolvedValue(tracks);

      await service.applyPlanLimitToTracks(USER_ID, 2); // keep 2, hide 2

      expect(mockPrisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["t3", "t4"] } },
          data: expect.objectContaining({ hiddenByPlanLimit: true }),
        }),
      );
    });

    it("restores previously hidden tracks that now fit within the new limit", async () => {
      const tracks = [
        { id: "t1", hiddenByPlanLimit: true },
        { id: "t2", hiddenByPlanLimit: true },
        { id: "t3", hiddenByPlanLimit: false },
      ];
      mockPrisma.track.findMany.mockResolvedValue(tracks);

      await service.applyPlanLimitToTracks(USER_ID, 10); // upgraded: all 3 fit

      expect(mockPrisma.track.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["t1", "t2"] } },
          data: expect.objectContaining({ hiddenByPlanLimit: false }),
        }),
      );
    });

    it("does not re-hide already-hidden over-limit tracks", async () => {
      const tracks = [
        { id: "t1", hiddenByPlanLimit: false }, // within limit
        { id: "t2", hiddenByPlanLimit: true }, // over limit, already hidden
      ];
      mockPrisma.track.findMany.mockResolvedValue(tracks);

      await service.applyPlanLimitToTracks(USER_ID, 1);

      // Only one updateMany call — for tracks to restore (none fit)
      // t2 is already hidden, so no re-hide needed
      const hideCalls = mockPrisma.track.updateMany.mock.calls.filter(
        (c) => (c[0] as any).data.hiddenByPlanLimit === true,
      );
      expect(hideCalls).toHaveLength(0);
    });

    it("queries tracks ordered by createdAt desc (newest kept)", async () => {
      mockPrisma.track.findMany.mockResolvedValue([]);

      await service.applyPlanLimitToTracks(USER_ID, 5);

      expect(mockPrisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // revokeOfflineDownloads()
  // ─────────────────────────────────────────────────────────────────────────

  describe("revokeOfflineDownloads()", () => {
    it("sets expiresAt=epoch for all user downloads", async () => {
      await service.revokeOfflineDownloads(USER_ID);

      expect(mockPrisma.offlineDownload.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        data: { expiresAt: new Date(0) },
      });
    });

    it("scopes update to the correct userId only", async () => {
      await service.revokeOfflineDownloads("other-user-id");

      expect(mockPrisma.offlineDownload.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "other-user-id" } }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // findActiveSubscription()
  // ─────────────────────────────────────────────────────────────────────────

  describe("findActiveSubscription()", () => {
    it("returns null when no active subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.findActiveSubscription(USER_ID);

      expect(result).toBeNull();
    });

    it("queries status IN [ACTIVE, TRIALING, PAST_DUE]", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      await service.findActiveSubscription(USER_ID);

      expect(mockPrisma.userSubscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: expect.arrayContaining([
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.PAST_DUE,
              ]),
            },
          }),
        }),
      );
    });

    it("only returns subscriptions with currentPeriodEnd >= now", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      await service.findActiveSubscription(USER_ID);

      expect(mockPrisma.userSubscription.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            currentPeriodEnd: { gte: expect.any(Date) },
          }),
        }),
      );
    });

    it("does NOT include CANCELED or EXPIRED subscriptions", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);

      await service.findActiveSubscription(USER_ID);

      const call = mockPrisma.userSubscription.findFirst.mock.calls[0][0];
      const statusFilter = call.where.status.in as SubscriptionStatus[];
      expect(statusFilter).not.toContain(SubscriptionStatus.CANCELED);
      expect(statusFilter).not.toContain(SubscriptionStatus.EXPIRED);
    });

    it("returns the found subscription when one exists", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);

      const result = await service.findActiveSubscription(USER_ID);

      expect(result).not.toBeNull();
      expect(result!.plan.tier).toBe(SubscriptionTier.PRO);
    });

    it("PAST_DUE subscription within grace period IS returned (user keeps access)", async () => {
      const pastDueSub = makeActiveSub(SubscriptionTier.PRO, 100, {
        status: SubscriptionStatus.PAST_DUE,
      });
      mockPrisma.userSubscription.findFirst.mockResolvedValue(pastDueSub);

      const result = await service.findActiveSubscription(USER_ID);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(SubscriptionStatus.PAST_DUE);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getMySubscription() — extended edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe("getMySubscription() — extended", () => {
    it("sets renewalDate (not expiresAt) when sub is active and NOT canceling", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: false,
      });
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(0);

      const result = await service.getMySubscription(USER_ID);

      expect(result.renewalDate).not.toBeNull();
      expect(result.expiresAt).toBeNull();
    });

    it("sets expiresAt (not renewalDate) when cancelAtPeriodEnd=true", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, {
        cancelAtPeriodEnd: true,
      });
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(0);

      const result = await service.getMySubscription(USER_ID);

      expect(result.expiresAt).not.toBeNull();
      expect(result.renewalDate).toBeNull();
    });

    it("includes latestInvoice when one exists", async () => {
      const sub = makeActiveSub(SubscriptionTier.PRO, 100);
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(0);
      mockPrisma.billingInvoice.findFirst.mockResolvedValue({
        id: "inv-latest",
        amountPaidCents: 999,
        currency: "USD",
        status: "PAID",
        paidAt: new Date(),
      });

      const result = await service.getMySubscription(USER_ID);

      expect(result.latestInvoice).toMatchObject({
        id: "inv-latest",
        amountPaidCents: 999,
        currency: "USD",
      });
    });

    it("response does not include stripeCustomerId or stripeSubscriptionId", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.track.count.mockResolvedValue(0);

      const result = await service.getMySubscription(USER_ID);
      const json = JSON.stringify(result);

      expect(json).not.toContain("stripeCustomerId");
      expect(json).not.toContain("stripeSubscriptionId");
    });

    it("TRIALING sub returns trialStart and trialEnd", async () => {
      const trialStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const trialEnd = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
      const sub = makeActiveSub(SubscriptionTier.PRO, 100, {
        status: SubscriptionStatus.TRIALING,
        trialStart,
        trialEnd,
      });
      mockPrisma.userSubscription.findFirst.mockResolvedValue(sub);
      mockPrisma.track.count.mockResolvedValue(0);

      const result = await service.getMySubscription(USER_ID);

      expect(result.subscriptionStatus).toBe(SubscriptionStatus.TRIALING);
      expect(result.trialStart).not.toBeNull();
      expect(result.trialEnd).not.toBeNull();
    });
  });
});
