/**
 * Module 12 - Premium Subscriptions
 * Unit tests for MockStripeBillingProvider
 *
 * MockStripeBillingProvider has no NestJS dependencies - it can be instantiated
 * directly without a test module.  These tests verify the billing abstraction layer
 * behaves correctly and that the webhook parser validates payloads properly.
 */

import { MockStripeBillingProvider } from "./mock-stripe.provider";

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("MockStripeBillingProvider", () => {
  let provider: MockStripeBillingProvider;

  beforeEach(() => {
    provider = new MockStripeBillingProvider();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getOrCreateCustomer()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("getOrCreateCustomer()", () => {
    it("creates and returns a new customer ID", async () => {
      const customerId = await provider.getOrCreateCustomer({
        userId: "user-1",
        email: "user@test.com",
      });

      expect(customerId).toBeDefined();
      expect(typeof customerId).toBe("string");
      expect(customerId.length).toBeGreaterThan(0);
    });

    it("returns the same customer ID on subsequent calls with the same userId", async () => {
      const id1 = await provider.getOrCreateCustomer({
        userId: "user-1",
        email: "a@test.com",
      });
      const id2 = await provider.getOrCreateCustomer({
        userId: "user-1",
        email: "b@test.com",
      });

      expect(id1).toBe(id2);
    });

    it("returns different IDs for different users", async () => {
      const id1 = await provider.getOrCreateCustomer({
        userId: "user-1",
        email: "a@test.com",
      });
      const id2 = await provider.getOrCreateCustomer({
        userId: "user-2",
        email: "b@test.com",
      });

      expect(id1).not.toBe(id2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createCheckoutSession()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("createCheckoutSession()", () => {
    it("returns checkoutSessionId starting with cs_mock_", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 7,
      });

      expect(result.checkoutSessionId).toMatch(/^cs_mock_/);
    });

    it("returns checkoutUrl starting with the mock checkout domain", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 0,
      });

      expect(result.checkoutUrl).toMatch(/^https:\/\/mock-checkout\.example\.com/);
    });

    it("trialEligible=true and amountDueNowCents=0 when trialDays > 0", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 7,
      });

      expect(result.trialEligible).toBe(true);
      expect(result.amountDueNowCents).toBe(0);
    });

    it("trialEligible=false and amountDueNowCents=plan price when trialDays=0", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 0,
      });

      expect(result.trialEligible).toBe(false);
      expect(result.amountDueNowCents).toBe(999); // PRO priceCents from PLAN_CATALOG
    });

    it("GO_PLUS with no trial charges 1999 cents", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "GO_PLUS",
        trialDays: 0,
      });

      expect(result.amountDueNowCents).toBe(1999);
    });

    it("returns trialDays matching what was passed in", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 7,
      });

      expect(result.trialDays).toBe(7);
    });

    it("trialEndsAt is set when trialDays > 0", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 7,
      });

      expect(result.trialEndsAt).toBeDefined();
      const trialEnd = new Date(result.trialEndsAt!);
      const daysFromNow = (trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysFromNow).toBeGreaterThan(6);
      expect(daysFromNow).toBeLessThan(8);
    });

    it("trialEndsAt is undefined when trialDays=0", async () => {
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 0,
      });

      expect(result.trialEndsAt).toBeUndefined();
    });

    it("renewsAt is ~1 month from now for non-trial session", async () => {
      const before = Date.now();
      const result = await provider.createCheckoutSession({
        userId: "user-1",
        planCode: "PRO",
        trialDays: 0,
      });

      const renewsAt = new Date(result.renewsAt);
      const daysFromNow = (renewsAt.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(daysFromNow).toBeGreaterThan(27);
      expect(daysFromNow).toBeLessThan(33);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // createBillingPortalSession()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("createBillingPortalSession()", () => {
    it("returns portalSessionId starting with bps_mock_", async () => {
      const result = await provider.createBillingPortalSession({
        userId: "user-1",
      });

      expect(result.portalSessionId).toMatch(/^bps_mock_/);
    });

    it("returns portalUrl starting with the mock portal domain", async () => {
      const result = await provider.createBillingPortalSession({
        userId: "user-1",
      });

      expect(result.portalUrl).toMatch(/^https:\/\/mock-portal\.example\.com/);
    });

    it("returns capabilities object with all four flags true", async () => {
      const result = await provider.createBillingPortalSession({
        userId: "user-1",
      });

      expect(result.capabilities).toMatchObject({
        canUpdatePaymentMethod: true,
        canCancel: true,
        canChangePlan: true,
        canViewReceipts: true,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // cancelSubscription() / resumeSubscription()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cancelSubscription() / resumeSubscription()", () => {
    async function createSub(): Promise<string> {
      const session = await provider.createCheckoutSession({
        userId: "user-cs",
        planCode: "PRO",
        trialDays: 0,
      });
      // The subId is embedded in checkoutUrl but there's no direct handle.
      // Test via retrieveSubscription by tracking in-memory state changes.
      // We'll use an arbitrary ID that won't be in the map to test graceful handling.
      return `sub_${session.checkoutSessionId}`;
    }

    it("cancelSubscription with cancelAtPeriodEnd=true marks subscription gracefully", async () => {
      // With an unknown subId, it should not throw
      await expect(
        provider.cancelSubscription({
          providerSubscriptionId: "sub-unknown",
          cancelAtPeriodEnd: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("cancelSubscription with cancelAtPeriodEnd=false resolves without error", async () => {
      await expect(
        provider.cancelSubscription({
          providerSubscriptionId: "sub-unknown",
          cancelAtPeriodEnd: false,
        }),
      ).resolves.toBeUndefined();
    });

    it("resumeSubscription resolves without error", async () => {
      await expect(
        provider.resumeSubscription({ providerSubscriptionId: "sub-unknown" }),
      ).resolves.toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // changePlan()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("changePlan()", () => {
    it("returns a ProviderSubscriptionResult with the subscription ID", async () => {
      const result = await provider.changePlan({
        providerSubscriptionId: "sub-1",
        newPlanCode: "GO_PLUS",
      });

      expect(result).toMatchObject({
        providerSubscriptionId: "sub-1",
        cancelAtPeriodEnd: expect.any(Boolean),
        status: expect.any(String),
        currentPeriodEnd: expect.any(Date),
      });
    });

    it("changePlan on unknown subscription returns default active state", async () => {
      const result = await provider.changePlan({
        providerSubscriptionId: "sub-unknown",
        newPlanCode: "GO_PLUS",
      });

      expect(result.status).toBe("active");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // retrieveSubscription()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("retrieveSubscription()", () => {
    it("returns a valid ProviderSubscriptionResult", async () => {
      const result = await provider.retrieveSubscription("sub-1");

      expect(result).toMatchObject({
        providerSubscriptionId: "sub-1",
        status: expect.any(String),
        cancelAtPeriodEnd: expect.any(Boolean),
        currentPeriodEnd: expect.any(Date),
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // constructWebhookEvent()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("constructWebhookEvent()", () => {
    function toBuffer(obj: object): Buffer {
      return Buffer.from(JSON.stringify(obj));
    }

    it("parses a valid webhook event with id and type", () => {
      const event = {
        id: "evt_123",
        type: "checkout.session.completed",
        data: {},
      };
      const result = provider.constructWebhookEvent(toBuffer(event), "sig_abc");

      expect(result).toMatchObject({
        id: "evt_123",
        type: "checkout.session.completed",
      });
    });

    it("throws WEBHOOK_INVALID_SIGNATURE on malformed JSON", () => {
      const raw = Buffer.from("NOT_VALID_JSON");

      expect(() => provider.constructWebhookEvent(raw, "sig")).toThrow("WEBHOOK_INVALID_SIGNATURE");
    });

    it("throws WEBHOOK_INVALID_SIGNATURE when id field is missing", () => {
      const raw = toBuffer({ type: "checkout.session.completed" }); // no id

      expect(() => provider.constructWebhookEvent(raw, "sig")).toThrow("WEBHOOK_INVALID_SIGNATURE");
    });

    it("throws WEBHOOK_INVALID_SIGNATURE when type field is missing", () => {
      const raw = toBuffer({ id: "evt_123" }); // no type

      expect(() => provider.constructWebhookEvent(raw, "sig")).toThrow("WEBHOOK_INVALID_SIGNATURE");
    });

    it("passes through arbitrary data object attached to the event", () => {
      const event = {
        id: "evt_456",
        type: "invoice.payment_failed",
        data: { object: { subscription: "sub_abc", customer: "cus_xyz" } },
      };
      const result = provider.constructWebhookEvent(toBuffer(event), "sig");

      expect(result.data).toEqual(event.data);
    });
  });
});
