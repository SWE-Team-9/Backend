import { Test, TestingModule } from "@nestjs/testing";
import { PaymentMethodsController } from "./payment-methods.controller";
import { PaymentMethodsService } from "./payment-methods.service";

const USER = { id: "user-123" };
const DB_PM_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const mockCard = {
  id: DB_PM_ID,
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2030,
  cardholderName: "Test User",
  isDefault: true,
  createdAt: "2026-05-01T12:00:00.000Z",
};

function makeServiceMock() {
  return {
    createSetupIntent: jest.fn().mockResolvedValue({ clientSecret: "seti_secret_123" }),
    attachPaymentMethod: jest.fn().mockResolvedValue(mockCard),
    listPaymentMethods: jest.fn().mockResolvedValue([mockCard]),
    setDefault: jest.fn().mockResolvedValue(mockCard),
    deletePaymentMethod: jest.fn().mockResolvedValue({}),
  };
}

describe("PaymentMethodsController", () => {
  let controller: PaymentMethodsController;
  let service: ReturnType<typeof makeServiceMock>;

  beforeEach(async () => {
    service = makeServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentMethodsController],
      providers: [{ provide: PaymentMethodsService, useValue: service }],
    }).compile();

    controller = module.get<PaymentMethodsController>(PaymentMethodsController);
  });

  describe("createSetupIntent", () => {
    it("delegates to service.createSetupIntent and returns clientSecret", async () => {
      const result = await controller.createSetupIntent(USER);

      expect(service.createSetupIntent).toHaveBeenCalledWith(USER.id);
      expect(result).toEqual({ clientSecret: "seti_secret_123" });
    });
  });

  describe("attachPaymentMethod", () => {
    it("delegates to service.attachPaymentMethod and returns card object", async () => {
      const dto = { stripePaymentMethodId: "pm_123" };

      const result = await controller.attachPaymentMethod(USER, dto as any);

      expect(service.attachPaymentMethod).toHaveBeenCalledWith(USER.id, dto);
      expect(result).toMatchObject({ brand: "visa", last4: "4242" });
    });
  });

  describe("listPaymentMethods", () => {
    it("delegates to service.listPaymentMethods and returns array", async () => {
      const result = await controller.listPaymentMethods(USER);

      expect(service.listPaymentMethods).toHaveBeenCalledWith(USER.id);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ isDefault: true });
    });
  });

  describe("setDefault", () => {
    it("delegates to service.setDefault with userId and paymentMethodId", async () => {
      const result = await controller.setDefault(USER, DB_PM_ID);

      expect(service.setDefault).toHaveBeenCalledWith(USER.id, DB_PM_ID);
      expect(result).toMatchObject({ isDefault: true });
    });
  });

  describe("deletePaymentMethod", () => {
    it("delegates to service.deletePaymentMethod and returns empty body for normal case", async () => {
      const result = await controller.deletePaymentMethod(USER, DB_PM_ID);

      expect(service.deletePaymentMethod).toHaveBeenCalledWith(USER.id, DB_PM_ID);
      expect(result).toEqual({});
    });

    it("returns subscriptionScheduledToCancel when last card is deleted", async () => {
      const expiresAt = "2026-06-01T00:00:00.000Z";
      service.deletePaymentMethod.mockResolvedValueOnce({
        subscriptionScheduledToCancel: true,
        expiresAt,
      });

      const result = await controller.deletePaymentMethod(USER, DB_PM_ID);

      expect(result).toEqual({ subscriptionScheduledToCancel: true, expiresAt });
    });
  });
});
