import { Test, TestingModule } from "@nestjs/testing";
import {
  InvoiceStatus,
  SubscriptionStatus,
  SubscriptionTier,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import {
  FREE_UPLOAD_LIMIT,
  GRACE_PERIOD_DAYS,
  SubscriptionsService,
} from "./subscriptions.service";
import { TrialSchedulerService } from "./trial-scheduler.service";

// ──────────────────────────────────────────────────────────────────────────────
// Shared test constants
// ──────────────────────────────────────────────────────────────────────────────

const SUB_ID = "sub-trial-123";
const USER_EMAIL = "trial@example.com";
const PLAN_NAME = "Pro";
const PLAN_PRICE = 999;

// ──────────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────────

const mockPrisma = {
  userSubscription: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  billingInvoice: {
    create: jest.fn(),
  },
  paymentEvent: {
    create: jest.fn(),
  },
};

const mockMailService = {
  sendTrialEndingEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentFailedMovedToFreeEmail: jest.fn().mockResolvedValue(undefined),
};

const mockSubscriptionsService = {
  revokeOfflineDownloads: jest.fn().mockResolvedValue(undefined),
  applyPlanLimitToTracks: jest.fn().mockResolvedValue(undefined),
};

// ──────────────────────────────────────────────────────────────────────────────
// Helper builders
// ──────────────────────────────────────────────────────────────────────────────

function makeTrialSub(
  overrides: Partial<{
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    payments: { id: string }[];
    stripeCustomerId: string;
  }> = {},
) {
  return {
    id: SUB_ID,
    stripeCustomerId: "cus_mock_abc",
    currentPeriodEnd: new Date(Date.now() + 48 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    user: {
      email: USER_EMAIL,
      profile: { displayName: "Trial User" },
    },
    plan: { name: PLAN_NAME, priceCents: PLAN_PRICE, tier: "PRO" },
    payments: [],
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Suite
// ──────────────────────────────────────────────────────────────────────────────

describe("TrialSchedulerService", () => {
  let service: TrialSchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrialSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
      ],
    }).compile();

    service = module.get<TrialSchedulerService>(TrialSchedulerService);
  });

  // ────────────────────────────────────────────────────────────────────────
  // sendTrialEndingWarnings
  // ────────────────────────────────────────────────────────────────────────

  describe("sendTrialEndingWarnings", () => {
    it("sends email and records PaymentEvent when no warning has been sent yet", async () => {
      const sub = makeTrialSub();
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.sendTrialEndingWarnings();

      expect(mockMailService.sendTrialEndingEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: USER_EMAIL,
          planName: PLAN_NAME,
          priceCents: PLAN_PRICE,
        }),
      );
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "trial.renewal_warning" }),
        }),
      );
    });

    it("skips subscription when a trial.renewal_warning event already exists", async () => {
      const sub = makeTrialSub({ payments: [{ id: "evt-already-sent" }] });
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);

      await service.sendTrialEndingWarnings();

      expect(mockMailService.sendTrialEndingEmail).not.toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it("does nothing when no trials are in the 48h warning window", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([]);

      await service.sendTrialEndingWarnings();

      expect(mockMailService.sendTrialEndingEmail).not.toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it("still records the PaymentEvent even if email delivery fails", async () => {
      const sub = makeTrialSub();
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockMailService.sendTrialEndingEmail.mockRejectedValueOnce(
        new Error("SMTP error"),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.sendTrialEndingWarnings();

      // Email was attempted (fire-and-forget)
      expect(mockMailService.sendTrialEndingEmail).toHaveBeenCalledTimes(1);
      // Idempotency flag still written
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "trial.renewal_warning" }),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // autoRenewExpiredTrials
  // ────────────────────────────────────────────────────────────────────────

  describe("autoRenewExpiredTrials", () => {
    function makeExpiredTrialSub(overrides: object = {}) {
      return {
        id: SUB_ID,
        stripeCustomerId: "cus_mock_abc",
        plan: { name: PLAN_NAME, priceCents: PLAN_PRICE, tier: "PRO" },
        ...overrides,
      };
    }

    it("converts an expired trial to ACTIVE and creates a paid invoice", async () => {
      const sub = makeExpiredTrialSub();
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-renew" });
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.autoRenewExpiredTrials();

      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountDueCents: PLAN_PRICE,
            amountPaidCents: PLAN_PRICE,
            status: InvoiceStatus.PAID,
          }),
        }),
      );
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SUB_ID },
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
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

    it("does nothing when there are no expired trials", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([]);

      await service.autoRenewExpiredTrials();

      expect(mockPrisma.billingInvoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
    });

    it("continues processing remaining subs when one renewal fails", async () => {
      const sub1 = makeExpiredTrialSub({ id: "sub-1" });
      const sub2 = makeExpiredTrialSub({ id: "sub-2" });
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub1, sub2]);
      // First invoice creation throws, second succeeds
      mockPrisma.billingInvoice.create
        .mockRejectedValueOnce(new Error("DB error"))
        .mockResolvedValueOnce({ id: "inv-2" });
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.autoRenewExpiredTrials();

      // update was only called for the successful sub
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // autoRenewActiveSubscriptions
  // ────────────────────────────────────────────────────────────────────────

  describe("autoRenewActiveSubscriptions", () => {
    function makeExpiredActiveSub(overrides: object = {}) {
      return {
        id: SUB_ID,
        stripeCustomerId: "cus_mock_abc",
        plan: { name: PLAN_NAME, priceCents: PLAN_PRICE, tier: "PRO" },
        ...overrides,
      };
    }

    it("renews an ACTIVE subscription whose period has expired", async () => {
      const sub = makeExpiredActiveSub();
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.billingInvoice.create.mockResolvedValue({ id: "inv-renewal" });
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.autoRenewActiveSubscriptions();

      expect(mockPrisma.billingInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountDueCents: PLAN_PRICE,
            amountPaidCents: PLAN_PRICE,
            status: InvoiceStatus.PAID,
          }),
        }),
      );
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SUB_ID },
          data: expect.objectContaining({
            currentPeriodStart: expect.any(Date),
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

    it("does nothing when there are no expired ACTIVE subscriptions", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([]);

      await service.autoRenewActiveSubscriptions();

      expect(mockPrisma.billingInvoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
    });

    it("continues processing remaining subs when one renewal fails", async () => {
      const sub1 = makeExpiredActiveSub({ id: "active-sub-1" });
      const sub2 = makeExpiredActiveSub({ id: "active-sub-2" });
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub1, sub2]);
      mockPrisma.billingInvoice.create
        .mockRejectedValueOnce(new Error("DB error"))
        .mockResolvedValueOnce({ id: "inv-2" });
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.autoRenewActiveSubscriptions();

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // cancelExpiredGracePeriodSubscriptions - BUG FIX VERIFICATION
  // The query MUST use paymentFailureGraceEndsAt, NOT updatedAt
  // ────────────────────────────────────────────────────────────────────────
  describe("cancelExpiredGracePeriodSubscriptions", () => {
    function makeGraceSub(overrides: object = {}) {
      return {
        id: "grace-sub-1",
        user: { email: USER_EMAIL, profile: { displayName: "Grace User" } },
        plan: { name: PLAN_NAME },
        ...overrides,
      };
    }

    it("cancels a PAST_DUE sub whose grace period has elapsed", async () => {
      const sub = makeGraceSub();
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});
      mockMailService.sendPaymentFailedMovedToFreeEmail.mockResolvedValue(
        undefined,
      );

      await service.cancelExpiredGracePeriodSubscriptions();

      expect(mockPrisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "grace-sub-1" },
          data: expect.objectContaining({
            status: SubscriptionStatus.CANCELED,
            endedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "subscription.grace_period_expired",
          }),
        }),
      );
    });

    it("sends moved-to-free email after grace period expires", async () => {
      const sub = makeGraceSub();
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});
      mockMailService.sendPaymentFailedMovedToFreeEmail.mockResolvedValue(
        undefined,
      );

      await service.cancelExpiredGracePeriodSubscriptions();

      // Give the fire-and-forget promise a tick to settle
      await Promise.resolve();

      expect(
        mockMailService.sendPaymentFailedMovedToFreeEmail,
      ).toHaveBeenCalledWith(expect.objectContaining({ to: USER_EMAIL }));
    });

    it("does nothing when no PAST_DUE subs have exceeded grace period", async () => {
      mockPrisma.userSubscription.findMany.mockResolvedValue([]);

      await service.cancelExpiredGracePeriodSubscriptions();

      expect(mockPrisma.userSubscription.update).not.toHaveBeenCalled();
    });

    it("BUG FIX: queries by paymentFailureGraceEndsAt, NOT updatedAt", async () => {
      await service.cancelExpiredGracePeriodSubscriptions();

      const call = mockPrisma.userSubscription.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty("paymentFailureGraceEndsAt");
      expect(call.where).not.toHaveProperty("updatedAt");
    });

    it("queries PAST_DUE status with paymentFailureGraceEndsAt < now", async () => {
      await service.cancelExpiredGracePeriodSubscriptions();

      expect(mockPrisma.userSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: SubscriptionStatus.PAST_DUE,
            paymentFailureGraceEndsAt: { lt: expect.any(Date) },
          }),
        }),
      );
    });

    it("calls revokeOfflineDownloads for the affected user", async () => {
      const sub = makeGraceSub({ userId: "user-abc" });
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.cancelExpiredGracePeriodSubscriptions();

      expect(
        mockSubscriptionsService.revokeOfflineDownloads,
      ).toHaveBeenCalledWith("user-abc");
    });

    it("calls applyPlanLimitToTracks with FREE_UPLOAD_LIMIT (3)", async () => {
      const sub = makeGraceSub({ userId: "user-abc" });
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.userSubscription.update.mockResolvedValue({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.cancelExpiredGracePeriodSubscriptions();

      expect(
        mockSubscriptionsService.applyPlanLimitToTracks,
      ).toHaveBeenCalledWith("user-abc", FREE_UPLOAD_LIMIT);
    });

    it("GRACE_PERIOD_DAYS is 1 as required", () => {
      expect(GRACE_PERIOD_DAYS).toBe(1);
    });

    it("continues processing remaining subs when one cancellation fails", async () => {
      const sub1 = makeGraceSub({ id: "grace-sub-1" });
      const sub2 = makeGraceSub({ id: "grace-sub-2" });
      mockPrisma.userSubscription.findMany.mockResolvedValue([sub1, sub2]);
      mockPrisma.userSubscription.update
        .mockRejectedValueOnce(new Error("DB error"))
        .mockResolvedValueOnce({});
      mockPrisma.paymentEvent.create.mockResolvedValue({});

      await service.cancelExpiredGracePeriodSubscriptions();

      // Only the second sub should have been cancelled
      expect(mockPrisma.userSubscription.update).toHaveBeenCalledTimes(2);
    });
  });
});
