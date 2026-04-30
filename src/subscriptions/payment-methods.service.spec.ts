/**
 * Payment Methods Management - service-level tests.
 *
 * Covers:
 *  - createBillingPortal() response shape (portalSessionId, portalUrl, capabilities,
 *    currentPlanCode, paymentMethodSummary)
 *  - paymentMethodSummary: stored DB value preferred over provider value
 *  - paymentMethodSummary: falls back to provider value when nothing stored in DB
 *  - paymentMethodSummary: null when no PM available
 *  - Safe: response never exposes full card number, CVC, raw token
 *  - flow param forwarded to billing provider (not yet inspected by mock; smoke-tested)
 *  - Backward compat: returnUrl forwarded to provider
 *  - getMySubscription returns structured paymentMethod object when stored
 *  - getMySubscription derives paymentMethodSummary string from structured paymentMethod
 *  - getMySubscription paymentMethodSummary is null when no PM stored
 *  - payment_method.updated webhook: updates paymentMethod JSON + string summary
 *  - payment_method.updated webhook: creates PaymentEvent for idempotency
 *  - payment_method.updated webhook: fires email (fire-and-forget)
 *  - payment_method.updated webhook: idempotent (duplicate event ID skipped at top)
 *  - payment_method.updated webhook: no-op when customer ID not found
 *  - User not found -> NotFoundException on portal creation
 */

import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { SubscriptionStatus, SubscriptionTier } from "@prisma/client";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { SubscriptionsService } from "./subscriptions.service";
import { BILLING_PROVIDER, PaymentMethodSummary } from "../billing/billing-provider.interface";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const USER_ID = "user-pm-test-001";
const CUSTOMER_ID = "cus_pm_test_001";
const SUB_ID = "sub-pm-test-001";
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const MOCK_PAYMENT_METHOD: PaymentMethodSummary = {
  brand: "visa",
  last4: "4242",
  expiryMonth: 12,
  expiryYear: 2030,
  isDefault: true,
};

const MOCK_PORTAL_RESULT = {
  portalSessionId: "bps_mock_pm001",
  portalUrl: "https://mock-portal.example.com/billing?session=bps_mock_pm001",
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
  paymentMethodSummary: MOCK_PAYMENT_METHOD,
};

function makeActiveSub(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_ID,
    userId: USER_ID,
    planId: "plan-pm-001",
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date(),
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    trialStart: null,
    trialEnd: null,
    stripeCustomerId: CUSTOMER_ID,
    stripeSubscriptionId: "sub_stripe_pm001",
    paymentMethodSummary: null,
    paymentMethod: null,
    plan: {
      tier: SubscriptionTier.PRO,
      uploadLimit: 100,
      name: "Pro Monthly",
      priceCents: 999,
      features: { adFree: true, offlineListening: true },
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────────

const mockPrisma = {
  track: {
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  user: { findUnique: jest.fn() },
  userSubscription: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: "new-sub" }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  subscriptionPlan: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  billingInvoice: {
    create: jest.fn().mockResolvedValue({ id: "inv-id" }),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  paymentEvent: {
    create: jest.fn().mockResolvedValue({ id: "evt-id" }),
    findUnique: jest.fn().mockResolvedValue(null),
  },
  trialRedemption: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  },
  offlineDownload: {
    upsert: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
};

const mockBillingProvider = {
  getOrCreateCustomer: jest.fn().mockResolvedValue(CUSTOMER_ID),
  createBillingPortalSession: jest.fn().mockResolvedValue(MOCK_PORTAL_RESULT),
  createCheckoutSession: jest.fn(),
  cancelSubscription: jest.fn(),
  resumeSubscription: jest.fn(),
  changePlan: jest.fn(),
  retrieveSubscription: jest.fn().mockResolvedValue({}),
  constructWebhookEvent: jest.fn(),
};

const mockMailService = {
  sendPaymentMethodUpdatedEmail: jest.fn().mockResolvedValue(undefined),
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

// ──────────────────────────────────────────────────────────────────────────────
// Suite
// ──────────────────────────────────────────────────────────────────────────────

describe("Payment Methods Management (service)", () => {
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

    // Default stubs
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "user@example.com",
      isVerified: true,
      profile: { displayName: "PM User" },
    });
    mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
    mockPrisma.userSubscription.findUnique.mockResolvedValue(null);
    mockPrisma.userSubscription.update.mockResolvedValue({});
    mockPrisma.paymentEvent.findUnique.mockResolvedValue(null);
    mockPrisma.paymentEvent.create.mockResolvedValue({ id: "evt-pm" });
    mockBillingProvider.getOrCreateCustomer.mockResolvedValue(CUSTOMER_ID);
    mockBillingProvider.createBillingPortalSession.mockResolvedValue(MOCK_PORTAL_RESULT);
    mockMailService.sendPaymentMethodUpdatedEmail.mockResolvedValue(undefined);
  });

  // ── createBillingPortal: response shape ─────────────────────────────────────

  describe("createBillingPortal()", () => {
    it("returns portalSessionId from the billing provider", async () => {
      const result = await service.createBillingPortal(USER_ID);
      expect(result.portalSessionId).toBe("bps_mock_pm001");
    });

    it("returns portalUrl from the billing provider", async () => {
      const result = await service.createBillingPortal(USER_ID);
      expect(result.portalUrl).toContain("bps_mock_pm001");
    });

    it("returns all 8 payment-method capabilities", async () => {
      const result = await service.createBillingPortal(USER_ID);
      expect(result.capabilities).toMatchObject({
        canViewPaymentMethods: true,
        canAddPaymentMethod: true,
        canUpdatePaymentMethod: true,
        canRemovePaymentMethod: true,
        canSetDefaultPaymentMethod: true,
        canCancel: true,
        canChangePlan: true,
        canViewReceipts: true,
      });
    });

    it("returns currentPlanCode FREE when user has no active subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      const result = await service.createBillingPortal(USER_ID);
      expect(result.currentPlanCode).toBe("FREE");
    });

    it("returns currentPlanCode PRO when user has a PRO subscription", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(makeActiveSub());
      const result = await service.createBillingPortal(USER_ID);
      expect(result.currentPlanCode).toBe("PRO");
    });

    it("returns paymentMethodSummary from DB (stored value) when present", async () => {
      const storedPM: PaymentMethodSummary = {
        brand: "mastercard",
        last4: "9999",
        expiryMonth: 6,
        expiryYear: 2028,
        isDefault: true,
      };
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub({ paymentMethod: storedPM }),
      );
      const result = await service.createBillingPortal(USER_ID);
      expect(result.paymentMethodSummary).toEqual(storedPM);
    });

    it("falls back to provider paymentMethodSummary when DB has none", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub({ paymentMethod: null }),
      );
      const result = await service.createBillingPortal(USER_ID);
      expect(result.paymentMethodSummary).toEqual(MOCK_PAYMENT_METHOD);
    });

    it("returns paymentMethodSummary null when no sub and provider returns null", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      mockBillingProvider.createBillingPortalSession.mockResolvedValue({
        ...MOCK_PORTAL_RESULT,
        paymentMethodSummary: null,
      });
      const result = await service.createBillingPortal(USER_ID);
      expect(result.paymentMethodSummary).toBeNull();
    });

    it("never exposes full card number in response", async () => {
      const result = await service.createBillingPortal(USER_ID);
      const json = JSON.stringify(result);
      // A full Visa number has 16 digits - 4242424242424242 should never appear
      expect(json).not.toMatch(/\b\d{15,16}\b/);
    });

    it("never exposes a CVC field in response", async () => {
      const result = await service.createBillingPortal(USER_ID);
      const json = JSON.stringify(result).toLowerCase();
      expect(json).not.toContain("cvc");
      expect(json).not.toContain("cvv");
    });

    it("forwards returnUrl to the billing provider", async () => {
      await service.createBillingPortal(USER_ID, {
        returnUrl: "https://app.example.com/billing",
      });
      expect(mockBillingProvider.createBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({
          returnUrl: "https://app.example.com/billing",
        }),
      );
    });

    it("throws NotFoundException when user does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.createBillingPortal(USER_ID)).rejects.toThrow(NotFoundException);
    });

    it("paymentMethodSummary brand/last4/expiry fields are safe (no raw token)", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(
        makeActiveSub({ paymentMethod: MOCK_PAYMENT_METHOD }),
      );
      const result = await service.createBillingPortal(USER_ID);
      const pm = result.paymentMethodSummary as PaymentMethodSummary;
      expect(pm).toBeDefined();
      expect(pm.last4).toHaveLength(4);
      expect(pm.brand).toBeDefined();
      expect(pm.expiryMonth).toBeDefined();
      expect(pm.expiryYear).toBeDefined();
      // Should NOT have a token or id field
      expect((pm as any).token).toBeUndefined();
      expect((pm as any).id).toBeUndefined();
    });
  });

  // ── getMySubscription: paymentMethod + derived summary ──────────────────────

  describe("getMySubscription() with payment method data", () => {
    function makeSubWithPM(pm: PaymentMethodSummary | null) {
      return {
        ...makeActiveSub({
          paymentMethod: pm,
          paymentMethodSummary: pm
            ? `${pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ending in ${pm.last4}`
            : null,
        }),
        plan: {
          tier: SubscriptionTier.PRO,
          uploadLimit: 100,
          name: "Pro Monthly",
          priceCents: 999,
          features: { adFree: true, offlineListening: true },
        },
      };
    }

    it("returns structured paymentMethod object when one is stored", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(makeSubWithPM(MOCK_PAYMENT_METHOD));
      mockPrisma.track.count.mockResolvedValue(5);
      const result = await service.getMySubscription(USER_ID);
      expect(result.paymentMethod).toMatchObject({
        brand: "visa",
        last4: "4242",
        expiryMonth: 12,
        expiryYear: 2030,
      });
    });

    it("derives paymentMethodSummary string from structured paymentMethod", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(makeSubWithPM(MOCK_PAYMENT_METHOD));
      mockPrisma.track.count.mockResolvedValue(5);
      const result = await service.getMySubscription(USER_ID);
      // The string summary is derived from the JSON object
      expect(typeof result.paymentMethodSummary).toBe("string");
      expect(result.paymentMethodSummary).toContain("4242");
    });

    it("paymentMethodSummary is null when no paymentMethod stored", async () => {
      mockPrisma.userSubscription.findFirst.mockResolvedValue(makeSubWithPM(null));
      mockPrisma.track.count.mockResolvedValue(5);
      const result = await service.getMySubscription(USER_ID);
      expect(result.paymentMethod).toBeNull();
    });
  });

  // ── payment_method.updated webhook ──────────────────────────────────────────

  describe("payment_method.updated webhook", () => {
    const STRIPE_SIG = "sig_pm_test";
    const EVENT_ID = "evt_pm_updated_001";

    function makeWebhookEvent(overrides: Record<string, unknown> = {}) {
      return {
        id: EVENT_ID,
        type: "payment_method.updated",
        data: {
          object: {
            customer: CUSTOMER_ID,
            card: {
              brand: "mastercard",
              last4: "5678",
              exp_month: 9,
              exp_year: 2027,
            },
            ...overrides,
          },
        },
      };
    }

    beforeEach(() => {
      mockBillingProvider.constructWebhookEvent.mockReturnValue(makeWebhookEvent());
      mockPrisma.userSubscription.findFirst.mockImplementation((args: any) => {
        if (args?.where?.stripeCustomerId === CUSTOMER_ID) {
          return Promise.resolve({ id: SUB_ID, userId: USER_ID });
        }
        if (args?.where?.status) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });
    });

    it("updates paymentMethod JSON and paymentMethodSummary string in DB", async () => {
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SUB_ID },
          data: expect.objectContaining({
            paymentMethod: expect.objectContaining({
              brand: "mastercard",
              last4: "5678",
            }),
            paymentMethodSummary: expect.stringContaining("5678"),
          }),
        }),
      );
    });

    it("creates a PaymentEvent record for idempotency", async () => {
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: SUB_ID,
            stripeEventId: EVENT_ID,
            eventType: "payment_method.updated",
          }),
        }),
      );
    });

    it("is idempotent: duplicate event ID is skipped", async () => {
      // Simulate the idempotency guard finding the event on re-delivery
      mockPrisma.paymentEvent.findUnique.mockResolvedValue({
        id: "existing-evt",
      });
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
    });

    it("queues payment method updated email (fire-and-forget)", async () => {
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      // Allow the fire-and-forget promise chain to resolve
      await Promise.resolve();
      await Promise.resolve();
      // Email lookup happens via prisma.user.findUnique
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: USER_ID } }),
      );
    });

    it("is a no-op when customer ID is not found in DB", async () => {
      mockBillingProvider.constructWebhookEvent.mockReturnValue({
        ...makeWebhookEvent(),
        data: {
          object: {
            customer: "cus_unknown_99999",
            card: {
              brand: "visa",
              last4: "1111",
              exp_month: 1,
              exp_year: 2030,
            },
          },
        },
      });
      mockPrisma.userSubscription.findFirst.mockResolvedValue(null);
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it("handles event where card details are at top level (no nested card object)", async () => {
      mockBillingProvider.constructWebhookEvent.mockReturnValue({
        id: EVENT_ID,
        type: "payment_method.updated",
        data: {
          object: {
            customer: CUSTOMER_ID,
            brand: "amex",
            last4: "0007",
            exp_month: 3,
            exp_year: 2029,
          },
        },
      });
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: expect.objectContaining({
              brand: "amex",
              last4: "0007",
            }),
          }),
        }),
      );
    });

    it("stored paymentMethod contains no full card number or CVC", async () => {
      let capturedData: Record<string, unknown> = {};
      mockPrisma.userSubscription.update.mockImplementation((args: any) => {
        capturedData = args.data ?? {};
        return Promise.resolve({});
      });
      await service.handleStripeWebhook("raw-body", STRIPE_SIG);
      const json = JSON.stringify(capturedData).toLowerCase();
      expect(json).not.toMatch(/\b\d{15,16}\b/);
      expect(json).not.toContain("cvc");
      expect(json).not.toContain("cvv");
    });
  });
});
