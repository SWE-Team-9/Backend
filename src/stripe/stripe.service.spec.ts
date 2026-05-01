import { ConfigService } from "@nestjs/config";
import { StripeService } from "./stripe.service";

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeStripeClientMock() {
  return {
    customers: {
      create: jest.fn().mockResolvedValue({ id: "cus_123" }),
      retrieve: jest.fn().mockResolvedValue({ id: "cus_123", deleted: false }),
      update: jest.fn().mockResolvedValue({ id: "cus_123" }),
      search: jest.fn().mockResolvedValue({ data: [{ id: "cus_existing" }] }),
    },
    setupIntents: {
      create: jest.fn().mockResolvedValue({ id: "seti_123", client_secret: "seti_secret" }),
      retrieve: jest.fn().mockResolvedValue({ id: "seti_123" }),
    },
    paymentMethods: {
      retrieve: jest.fn().mockResolvedValue({ id: "pm_123", type: "card", customer: null }),
      attach: jest.fn().mockResolvedValue({ id: "pm_123", type: "card", customer: "cus_123" }),
      detach: jest.fn().mockResolvedValue({ id: "pm_123" }),
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
    subscriptions: {
      create: jest.fn().mockResolvedValue({ id: "sub_123" }),
      update: jest.fn().mockResolvedValue({ id: "sub_123" }),
      cancel: jest.fn().mockResolvedValue({ id: "sub_123" }),
      retrieve: jest.fn().mockResolvedValue({ id: "sub_123" }),
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
    invoices: {
      retrieve: jest.fn().mockResolvedValue({ id: "in_123" }),
      list: jest.fn().mockResolvedValue({ data: [] }),
      pay: jest.fn().mockResolvedValue({ id: "in_123" }),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ id: "cs_123", url: "https://checkout.stripe.com/cs_123" }),
        retrieve: jest.fn().mockResolvedValue({ id: "cs_123" }),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn().mockResolvedValue({ id: "bps_123", url: "https://billing.stripe.com/session" }),
      },
    },
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({ id: "evt_123", type: "invoice.paid", data: { object: {} } }),
    },
  };
}

describe("StripeService", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.BILLING_PROVIDER;
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("throws early when real Stripe mode has no STRIPE_SECRET_KEY", () => {
    expect(() =>
      new StripeService(makeConfig({ BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "" })),
    ).toThrow("STRIPE_SECRET_KEY is required");
  });

  it("initializes in mock mode without a real Stripe secret", () => {
    expect(() => new StripeService(makeConfig({ BILLING_PROVIDER: "mock_stripe" }))).not.toThrow();
  });

  it("delegates createSetupIntent to Stripe with card/off-session settings", async () => {
    const service = new StripeService(makeConfig({ BILLING_PROVIDER: "mock_stripe" }));
    const client = makeStripeClientMock();
    (service as any).stripe = client;

    await expect(service.createSetupIntent("cus_123")).resolves.toEqual({
      id: "seti_123",
      client_secret: "seti_secret",
    });
    expect(client.setupIntents.create).toHaveBeenCalledWith({
      customer: "cus_123",
      payment_method_types: ["card"],
      usage: "off_session",
    });
  });

  it("returns an already-attached payment method when it belongs to the same customer", async () => {
    const service = new StripeService(makeConfig({ BILLING_PROVIDER: "mock_stripe" }));
    const client = makeStripeClientMock();
    client.paymentMethods.retrieve.mockResolvedValueOnce({
      id: "pm_123",
      type: "card",
      customer: "cus_123",
    });
    (service as any).stripe = client;

    await expect(service.attachPaymentMethod("pm_123", "cus_123")).resolves.toMatchObject({
      id: "pm_123",
    });
    expect(client.paymentMethods.attach).not.toHaveBeenCalled();
  });

  it("attaches a payment method that is not attached to any customer", async () => {
    const service = new StripeService(makeConfig({ BILLING_PROVIDER: "mock_stripe" }));
    const client = makeStripeClientMock();
    (service as any).stripe = client;

    await service.attachPaymentMethod("pm_123", "cus_123");

    expect(client.paymentMethods.attach).toHaveBeenCalledWith("pm_123", {
      customer: "cus_123",
    });
  });

  it("rejects a payment method already attached to another customer", async () => {
    const service = new StripeService(makeConfig({ BILLING_PROVIDER: "mock_stripe" }));
    const client = makeStripeClientMock();
    client.paymentMethods.retrieve.mockResolvedValueOnce({
      id: "pm_123",
      type: "card",
      customer: "cus_other",
    });
    (service as any).stripe = client;

    await expect(service.attachPaymentMethod("pm_123", "cus_123")).rejects.toThrow(
      "different Stripe customer",
    );
    expect(client.paymentMethods.attach).not.toHaveBeenCalled();
  });

  it("constructWebhookEvent forwards raw body, signature, and webhook secret", () => {
    const service = new StripeService(makeConfig({ BILLING_PROVIDER: "mock_stripe" }));
    const client = makeStripeClientMock();
    (service as any).stripe = client;

    const raw = Buffer.from("raw-body");
    const event = service.constructWebhookEvent(raw, "sig_123", "whsec_123");

    expect(event.id).toBe("evt_123");
    expect(client.webhooks.constructEvent).toHaveBeenCalledWith(raw, "sig_123", "whsec_123");
  });
});
