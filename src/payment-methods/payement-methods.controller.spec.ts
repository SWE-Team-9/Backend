import { PaymentMethodsController } from "./payment-methods.controller";
import { PaymentMethodsService } from "./payment-methods.service";

const USER = { id: "user-123" };
const PM_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("PaymentMethodsController", () => {
  let controller: PaymentMethodsController;
  let service: jest.Mocked<PaymentMethodsService>;

  beforeEach(() => {
    service = {
      createSetupIntent: jest.fn().mockResolvedValue({ clientSecret: "seti_secret" }),
      attachPaymentMethod: jest.fn().mockResolvedValue({ id: PM_ID, brand: "visa" }),
      listPaymentMethods: jest.fn().mockResolvedValue([{ id: PM_ID }]),
      setDefault: jest.fn().mockResolvedValue({ id: PM_ID, isDefault: true }),
      deletePaymentMethod: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<PaymentMethodsService>;

    controller = new PaymentMethodsController(service);
  });

  it("delegates setup-intent creation to the service", async () => {
    await expect(controller.createSetupIntent(USER)).resolves.toEqual({
      clientSecret: "seti_secret",
    });
    expect(service.createSetupIntent).toHaveBeenCalledWith(USER.id);
  });

  it("delegates payment method attachment to the service", async () => {
    const dto = { stripePaymentMethodId: "pm_123", setAsDefault: true };

    await expect(controller.attachPaymentMethod(USER, dto)).resolves.toEqual({
      id: PM_ID,
      brand: "visa",
    });
    expect(service.attachPaymentMethod).toHaveBeenCalledWith(USER.id, dto);
  });

  it("delegates list payment methods to the service", async () => {
    await expect(controller.listPaymentMethods(USER)).resolves.toEqual([{ id: PM_ID }]);
    expect(service.listPaymentMethods).toHaveBeenCalledWith(USER.id);
  });

  it("delegates set default to the service", async () => {
    await expect(controller.setDefault(USER, PM_ID)).resolves.toEqual({
      id: PM_ID,
      isDefault: true,
    });
    expect(service.setDefault).toHaveBeenCalledWith(USER.id, PM_ID);
  });

  it("delegates delete payment method to the service", async () => {
    await expect(controller.deletePaymentMethod(USER, PM_ID)).resolves.toEqual({});
    expect(service.deletePaymentMethod).toHaveBeenCalledWith(USER.id, PM_ID);
  });
});
