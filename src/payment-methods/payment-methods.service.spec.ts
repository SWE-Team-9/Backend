import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

const USER_ID = 'user-123';
const CUSTOMER_ID = 'cus_123';
const PM_ID = 'pm_123';
const DB_PM_ID = 'db-pm-123';
const NOW = new Date('2026-05-01T12:00:00.000Z');

const makeDbPaymentMethod = (overrides: Record<string, unknown> = {}) => ({
  id: DB_PM_ID,
  userId: USER_ID,
  stripePaymentMethodId: PM_ID,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  cardholderName: 'Test User',
  isDefault: false,
  createdAt: NOW,
  ...overrides,
});

const makeStripePaymentMethod = (overrides: Record<string, unknown> = {}) => ({
  id: PM_ID,
  type: 'card',
  customer: CUSTOMER_ID,
  card: {
    brand: 'visa',
    last4: '4242',
    exp_month: 12,
    exp_year: 2030,
  },
  billing_details: { name: 'Test User' },
  ...overrides,
});

function makePrismaMock() {
  const txClient = {
    paymentMethod: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockImplementation(async ({ data }) =>
        makeDbPaymentMethod({
          stripePaymentMethodId: data.stripePaymentMethodId,
          brand: data.brand,
          last4: data.last4,
          expMonth: data.expMonth,
          expYear: data.expYear,
          cardholderName: data.cardholderName,
          isDefault: data.isDefault,
        }),
      ),
      update: jest.fn().mockResolvedValue(makeDbPaymentMethod({ isDefault: true })),
      delete: jest.fn().mockResolvedValue(makeDbPaymentMethod()),
    },
    userSubscription: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    userBilling: {
      findUnique: jest.fn().mockResolvedValue({
        userId: USER_ID,
        stripeCustomerId: CUSTOMER_ID,
      }),
      create: jest.fn().mockResolvedValue({
        userId: USER_ID,
        stripeCustomerId: CUSTOMER_ID,
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        email: 'user@example.com',
        profile: { displayName: 'Test User' },
      }),
    },
    paymentMethod: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(makeDbPaymentMethod({ isDefault: true })),
      findFirst: jest.fn().mockResolvedValue(makeDbPaymentMethod()),
      findMany: jest.fn().mockResolvedValue([
        makeDbPaymentMethod({
          id: 'pm-a',
          isDefault: true,
          createdAt: NOW,
        }),
      ]),
      count: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(makeDbPaymentMethod({ isDefault: true })),
      create: jest.fn().mockResolvedValue(makeDbPaymentMethod()),
      delete: jest.fn().mockResolvedValue(makeDbPaymentMethod()),
    },
    userSubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest
      .fn()
      .mockImplementation(
        async (
          arg:
            | Promise<unknown>[]
            | ((transactionClient: typeof txClient) => unknown | Promise<unknown>),
        ) => {
          if (typeof arg === 'function') {
            return arg(txClient);
          }

          return Promise.all(arg);
        },
      ),
    __tx: txClient,
  };

  return prisma;
}

function makeStripeMock() {
  return {
    searchCustomersByUserId: jest.fn().mockResolvedValue(null),
    createCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
    createSetupIntent: jest.fn().mockResolvedValue({ client_secret: 'seti_secret_123' }),
    attachPaymentMethod: jest.fn().mockResolvedValue(makeStripePaymentMethod()),
    updateCustomerDefaultPaymentMethod: jest.fn().mockResolvedValue(undefined),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
    detachPaymentMethod: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let stripe: ReturnType<typeof makeStripeMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaMock();
    stripe = makeStripeMock();
    service = new PaymentMethodsService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
    );
  });

  describe('getOrCreateStripeCustomer', () => {
    it('returns the existing Stripe customer when userBilling exists', async () => {
      await expect(service.getOrCreateStripeCustomer(USER_ID)).resolves.toBe(CUSTOMER_ID);
      expect(stripe.createCustomer).not.toHaveBeenCalled();
    });

    it('creates a Stripe customer and billing row when none exists', async () => {
      prisma.userBilling.findUnique.mockResolvedValueOnce(null);

      await expect(service.getOrCreateStripeCustomer(USER_ID)).resolves.toBe(CUSTOMER_ID);

      expect(stripe.searchCustomersByUserId).toHaveBeenCalledWith(USER_ID);
      expect(stripe.createCustomer).toHaveBeenCalledWith({
        email: 'user@example.com',
        name: 'Test User',
        metadata: { userId: USER_ID },
      });
      expect(prisma.userBilling.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, stripeCustomerId: CUSTOMER_ID },
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.userBilling.findUnique.mockResolvedValueOnce(null);
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.getOrCreateStripeCustomer(USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createSetupIntent', () => {
    it('returns the SetupIntent client secret', async () => {
      await expect(service.createSetupIntent(USER_ID)).resolves.toEqual({
        clientSecret: 'seti_secret_123',
      });
      expect(stripe.createSetupIntent).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    it('throws BadRequestException if Stripe does not return a client secret', async () => {
      stripe.createSetupIntent.mockResolvedValueOnce({ client_secret: null });
      await expect(service.createSetupIntent(USER_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('attachPaymentMethod', () => {
    it('rejects a duplicate saved Stripe payment method', async () => {
      prisma.paymentMethod.findUnique.mockResolvedValueOnce(makeDbPaymentMethod());

      await expect(
        service.attachPaymentMethod(USER_ID, { stripePaymentMethodId: PM_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('saves a first card as default and updates Stripe before DB', async () => {
      prisma.paymentMethod.count.mockResolvedValueOnce(0);

      const result = await service.attachPaymentMethod(USER_ID, {
        stripePaymentMethodId: PM_ID,
      });

      expect(stripe.updateCustomerDefaultPaymentMethod).toHaveBeenCalledWith(CUSTOMER_ID, PM_ID);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(stripe.updateCustomerDefaultPaymentMethod.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
      expect(result).toMatchObject({ brand: 'visa', last4: '4242', isDefault: true });
    });

    it('rejects non-card payment methods', async () => {
      stripe.attachPaymentMethod.mockResolvedValueOnce({ id: PM_ID, type: 'us_bank_account' });

      await expect(
        service.attachPaymentMethod(USER_ID, { stripePaymentMethodId: PM_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cards attached to a different Stripe customer', async () => {
      stripe.attachPaymentMethod.mockResolvedValueOnce(
        makeStripePaymentMethod({ customer: 'cus_other' }),
      );

      await expect(
        service.attachPaymentMethod(USER_ID, { stripePaymentMethodId: PM_ID }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listPaymentMethods', () => {
    it('returns safe display metadata only', async () => {
      const result = await service.listPaymentMethods(USER_ID);

      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      expect(result[0]).toEqual({
        id: 'pm-a',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        cardholderName: 'Test User',
        isDefault: true,
        createdAt: NOW.toISOString(),
      });
      expect(JSON.stringify(result)).not.toContain('stripePaymentMethodId');
    });
  });

  describe('setDefault', () => {
    it('throws NotFoundException when the card does not exist for the user', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValueOnce(null);
      await expect(service.setDefault(USER_ID, DB_PM_ID)).rejects.toThrow(NotFoundException);
    });

    it('updates Stripe before changing local default flags', async () => {
      await service.setDefault(USER_ID, DB_PM_ID);

      expect(stripe.updateCustomerDefaultPaymentMethod).toHaveBeenCalledWith(CUSTOMER_ID, PM_ID);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(stripe.updateCustomerDefaultPaymentMethod.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });
  });

  describe('deletePaymentMethod', () => {
    it('throws NotFoundException when payment method is not found', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValueOnce(null);
      await expect(service.deletePaymentMethod(USER_ID, DB_PM_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes a non-last card without scheduling subscription cancellation', async () => {
      prisma.paymentMethod.count.mockResolvedValueOnce(2);
      prisma.paymentMethod.findFirst
        .mockResolvedValueOnce(makeDbPaymentMethod({ isDefault: false }))
        .mockResolvedValueOnce(null);

      await expect(service.deletePaymentMethod(USER_ID, DB_PM_ID)).resolves.toEqual({});

      expect(stripe.cancelSubscription).not.toHaveBeenCalled();
      expect(stripe.detachPaymentMethod).toHaveBeenCalledWith(PM_ID);
      expect(prisma.__tx.paymentMethod.delete).toHaveBeenCalledWith({ where: { id: DB_PM_ID } });
    });

    it('schedules Stripe cancellation before local DB changes when deleting the last card', async () => {
      const expiresAt = new Date('2026-06-01T00:00:00.000Z');
      prisma.paymentMethod.count.mockResolvedValueOnce(1);
      prisma.userSubscription.findFirst.mockResolvedValueOnce({
        id: 'sub-db-1',
        currentPeriodEnd: expiresAt,
        stripeSubscriptionId: 'sub_stripe_1',
      });

      const result = await service.deletePaymentMethod(USER_ID, DB_PM_ID);

      expect(result).toEqual({
        subscriptionScheduledToCancel: true,
        expiresAt: expiresAt.toISOString(),
      });
      expect(stripe.cancelSubscription).toHaveBeenCalledWith('sub_stripe_1', true);
      expect(stripe.cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
      expect(prisma.__tx.userSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-db-1' },
        data: expect.objectContaining({ cancelAtPeriodEnd: true }),
      });
    });

    it('does not mutate DB if Stripe cancellation fails', async () => {
      prisma.paymentMethod.count.mockResolvedValueOnce(1);
      prisma.userSubscription.findFirst.mockResolvedValueOnce({
        id: 'sub-db-1',
        currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
        stripeSubscriptionId: 'sub_stripe_1',
      });
      stripe.cancelSubscription.mockRejectedValueOnce(new Error('Stripe down'));

      await expect(service.deletePaymentMethod(USER_ID, DB_PM_ID)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(stripe.detachPaymentMethod).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not mutate DB if promoting the next default card fails in Stripe', async () => {
      prisma.paymentMethod.count.mockResolvedValueOnce(2);
      prisma.paymentMethod.findFirst
        .mockResolvedValueOnce(makeDbPaymentMethod({ isDefault: true }))
        .mockResolvedValueOnce(
          makeDbPaymentMethod({ id: 'db-next', stripePaymentMethodId: 'pm_next' }),
        );
      stripe.updateCustomerDefaultPaymentMethod.mockRejectedValueOnce(new Error('Stripe error'));

      await expect(service.deletePaymentMethod(USER_ID, DB_PM_ID)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(stripe.detachPaymentMethod).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
