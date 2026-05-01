import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../stripe/stripe.service";
import { AttachPaymentMethodDto } from "./dto/attach-payment-method.dto";

interface PaymentMethodResponse {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string | null;
  isDefault: boolean;
  createdAt: string;
}

interface DeletePaymentMethodResponse {
  subscriptionScheduledToCancel?: true;
  expiresAt?: string;
}

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async getOrCreateStripeCustomer(userId: string): Promise<string> {
    const billing = await this.prisma.userBilling.findUnique({
      where: { userId },
    });

    if (billing) return billing.stripeCustomerId;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        profile: { select: { displayName: true } },
      },
    });

    if (!user) throw new NotFoundException("User not found");

    const existingStripeCustomerId = await this.stripe.searchCustomersByUserId(userId);
    const stripeCustomerId =
      existingStripeCustomerId ??
      (
        await this.stripe.createCustomer({
          email: user.email,
          name: user.profile?.displayName ?? undefined,
          metadata: { userId },
        })
      ).id;

    try {
      const createdBilling = await this.prisma.userBilling.create({
        data: { userId, stripeCustomerId },
      });

      return createdBilling.stripeCustomerId;
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        const row = await this.prisma.userBilling.findUnique({ where: { userId } });
        if (row) return row.stripeCustomerId;
      }

      throw err;
    }
  }

  async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);
    const intent = await this.stripe.createSetupIntent(stripeCustomerId);

    if (!intent.client_secret) {
      throw new BadRequestException("Failed to create Setup Intent");
    }

    return { clientSecret: intent.client_secret };
  }

  async attachPaymentMethod(
    userId: string,
    dto: AttachPaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

    const existing = await this.prisma.paymentMethod.findUnique({
      where: { stripePaymentMethodId: dto.stripePaymentMethodId },
    });

    if (existing) {
      throw new ConflictException("This payment method is already saved");
    }

    let pm;
    try {
      pm = await this.stripe.attachPaymentMethod(dto.stripePaymentMethodId, stripeCustomerId);
    } catch (err) {
      this.logger.warn(
        `[PM ATTACH] Stripe attach failed for ${dto.stripePaymentMethodId}: ${String(err)}`,
      );
      throw new BadRequestException("Unable to attach payment method to this customer.");
    }

    if (pm.type !== "card" || !pm.card) {
      throw new BadRequestException("Only card payment methods are supported");
    }

    const currentCustomer =
      typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
    if (currentCustomer && currentCustomer !== stripeCustomerId) {
      throw new BadRequestException("Payment method does not belong to this user");
    }

    const isFirstMethod =
      (await this.prisma.paymentMethod.count({ where: { userId } })) === 0;
    const makeDefault = dto.setAsDefault ?? isFirstMethod;

    // Update Stripe before DB so local DB never claims a default card that Stripe rejected.
    if (makeDefault) {
      await this.stripe.updateCustomerDefaultPaymentMethod(stripeCustomerId, pm.id);
    }

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.paymentMethod.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return tx.paymentMethod.create({
          data: {
            userId,
            stripePaymentMethodId: pm.id,
            brand: pm.card!.brand,
            last4: pm.card!.last4,
            expMonth: pm.card!.exp_month,
            expYear: pm.card!.exp_year,
            cardholderName: pm.billing_details?.name ?? null,
            isDefault: makeDefault,
          },
        });
      });

      return this.formatPaymentMethod(saved);
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictException("This payment method is already saved");
      }

      throw err;
    }
  }

  async listPaymentMethods(userId: string): Promise<PaymentMethodResponse[]> {
    const methods = await this.prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return methods.map((method) => this.formatPaymentMethod(method));
  }

  async setDefault(userId: string, paymentMethodId: string): Promise<PaymentMethodResponse> {
    const pm = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });

    if (!pm) throw new NotFoundException("Payment method not found");

    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

    await this.stripe.updateCustomerDefaultPaymentMethod(
      stripeCustomerId,
      pm.stripePaymentMethodId,
    );

    await this.prisma.$transaction([
      this.prisma.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDefault: true },
      }),
    ]);

    const updated = await this.prisma.paymentMethod.findUniqueOrThrow({
      where: { id: paymentMethodId },
    });

    return this.formatPaymentMethod(updated);
  }

  async deletePaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<DeletePaymentMethodResponse> {
    const pm = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });

    if (!pm) throw new NotFoundException("Payment method not found");

    const totalMethods = await this.prisma.paymentMethod.count({ where: { userId } });

    let autoCancel:
      | {
          id: string;
          expiresAt: Date;
          stripeSubId: string | null;
        }
      | null = null;

    if (totalMethods === 1) {
      const activeSub = await this.prisma.userSubscription.findFirst({
        where: {
          userId,
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
          cancelAtPeriodEnd: false,
          plan: { tier: { not: "FREE" } },
        },
        select: {
          id: true,
          currentPeriodEnd: true,
          stripeSubscriptionId: true,
        },
      });

      if (activeSub) {
        autoCancel = {
          id: activeSub.id,
          expiresAt: activeSub.currentPeriodEnd,
          stripeSubId: activeSub.stripeSubscriptionId,
        };
      }
    }

    const nextDefaultCandidate =
      pm.isDefault && totalMethods > 1
        ? await this.prisma.paymentMethod.findFirst({
            where: { userId, id: { not: paymentMethodId } },
            orderBy: { createdAt: "desc" },
          })
        : null;

    // Schedule Stripe cancellation first. If this fails, do not mutate local DB.
    if (autoCancel?.stripeSubId?.startsWith("sub_")) {
      try {
        await this.stripe.cancelSubscription(autoCancel.stripeSubId, true);
      } catch (err) {
        this.logger.error(
          `[PM DELETE] Stripe cancel-at-period-end failed for ${autoCancel.stripeSubId}: ${String(
            err,
          )}`,
        );

        throw new ServiceUnavailableException(
          "Failed to schedule subscription cancellation in Stripe. Payment method was not removed.",
        );
      }
    }

    // If a different card should become default, update Stripe before local DB.
    if (nextDefaultCandidate) {
      const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

      try {
        await this.stripe.updateCustomerDefaultPaymentMethod(
          stripeCustomerId,
          nextDefaultCandidate.stripePaymentMethodId,
        );
      } catch (err) {
        this.logger.error(
          `[PM DELETE] Failed to promote next default payment method in Stripe: ${String(err)}`,
        );

        throw new ServiceUnavailableException(
          "Failed to update default payment method in Stripe. Payment method was not removed.",
        );
      }
    }

    try {
      await this.stripe.detachPaymentMethod(pm.stripePaymentMethodId);
    } catch (err) {
      if (this.isAlreadyDetachedOrMissingStripePaymentMethodError(err)) {
        this.logger.warn(
          `[PM DELETE] Stripe payment method ${pm.stripePaymentMethodId} was already detached or missing. Removing local record.`,
        );
      } else {
        this.logger.error(
          `[PM DELETE] Stripe detach failed for ${pm.stripePaymentMethodId}: ${String(err)}`,
        );

        throw new ServiceUnavailableException(
          "Failed to detach payment method from Stripe. Local database was not changed.",
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentMethod.delete({ where: { id: paymentMethodId } });

      if (nextDefaultCandidate) {
        await tx.paymentMethod.update({
          where: { id: nextDefaultCandidate.id },
          data: { isDefault: true },
        });
      }

      if (autoCancel) {
        await tx.userSubscription.update({
          where: { id: autoCancel.id },
          data: {
            cancelAtPeriodEnd: true,
            canceledAt: new Date(),
          },
        });
      }
    });

    if (autoCancel) {
      return {
        subscriptionScheduledToCancel: true,
        expiresAt: autoCancel.expiresAt.toISOString(),
      };
    }

    return {};
  }

  private formatPaymentMethod(pm: {
    id: string;
    stripePaymentMethodId: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    cardholderName: string | null;
    isDefault: boolean;
    createdAt: Date;
  }): PaymentMethodResponse {
    return {
      id: pm.id,
      brand: pm.brand,
      last4: pm.last4,
      expMonth: pm.expMonth,
      expYear: pm.expYear,
      cardholderName: pm.cardholderName,
      isDefault: pm.isDefault,
      createdAt: pm.createdAt.toISOString(),
    };
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  }

  private isAlreadyDetachedOrMissingStripePaymentMethodError(err: unknown): boolean {
    const errorLike = err as {
      code?: string;
      raw?: { code?: string; message?: string };
      message?: string;
    };

    const code = errorLike.code ?? errorLike.raw?.code ?? "";
    const message = (errorLike.message ?? errorLike.raw?.message ?? "").toLowerCase();

    return (
      code === "resource_missing" ||
      message.includes("no such paymentmethod") ||
      message.includes("no such payment method") ||
      message.includes("already detached") ||
      message.includes("does not have a payment method")
    );
  }
}
