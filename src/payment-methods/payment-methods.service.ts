import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StripeService } from "../stripe/stripe.service";
import { AttachPaymentMethodDto } from "./dto/attach-payment-method.dto";

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  // ── Get or create Stripe customer ────────────────────────────────────────
  // Returns the existing stripeCustomerId for the user, or creates a new one.

  async getOrCreateStripeCustomer(userId: string): Promise<string> {
    const billing = await this.prisma.userBilling.findUnique({
      where: { userId },
    });

    if (billing) return billing.stripeCustomerId;

    // Look up the user's email and display name to pass to Stripe
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        profile: { select: { displayName: true } },
      },
    });

    if (!user) throw new NotFoundException("User not found");

    const customer = await this.stripe.createCustomer({
      email: user.email,
      name: user.profile?.displayName ?? undefined,
      metadata: { userId },
    });

    await this.prisma.userBilling.create({
      data: { userId, stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  // ── Create Setup Intent ───────────────────────────────────────────────────
  // Returns a Stripe clientSecret that the frontend uses with Stripe.js to
  // securely collect card details without the card number touching our servers.

  async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);
    const intent = await this.stripe.createSetupIntent(stripeCustomerId);

    if (!intent.client_secret) {
      throw new BadRequestException("Failed to create Setup Intent");
    }

    return { clientSecret: intent.client_secret };
  }

  // ── Attach (save) a payment method ───────────────────────────────────────
  // Called after the frontend confirms the SetupIntent.
  // Saves the PM metadata in our DB for display without re-fetching from Stripe.

  async attachPaymentMethod(userId: string, dto: AttachPaymentMethodDto): Promise<object> {
    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

    // Check it's not already saved
    const existing = await this.prisma.paymentMethod.findUnique({
      where: { stripePaymentMethodId: dto.stripePaymentMethodId },
    });
    if (existing) {
      throw new ConflictException("This payment method is already saved");
    }

    // Attach to the Stripe customer (idempotent if already attached)
    const pm = await this.stripe.attachPaymentMethod(dto.stripePaymentMethodId, stripeCustomerId);

    if (pm.type !== "card" || !pm.card) {
      throw new BadRequestException("Only card payment methods are supported");
    }

    const isFirstMethod = (await this.prisma.paymentMethod.count({ where: { userId } })) === 0;
    const makeDefault = dto.setAsDefault ?? isFirstMethod;

    // If this will be the default, clear any existing default flag
    if (makeDefault) {
      await this.prisma.paymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      await this.stripe.updateCustomerDefaultPaymentMethod(stripeCustomerId, pm.id);
    }

    const saved = await this.prisma.paymentMethod.create({
      data: {
        userId,
        stripePaymentMethodId: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        cardholderName: pm.billing_details?.name ?? null,
        isDefault: makeDefault,
      },
    });

    return this.formatPaymentMethod(saved);
  }

  // ── List payment methods ──────────────────────────────────────────────────

  async listPaymentMethods(userId: string): Promise<object[]> {
    const methods = await this.prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return methods.map((m) => this.formatPaymentMethod(m));
  }

  // ── Set default ───────────────────────────────────────────────────────────

  async setDefault(userId: string, paymentMethodId: string): Promise<object> {
    const pm = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });
    if (!pm) throw new NotFoundException("Payment method not found");

    const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);

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

    await this.stripe.updateCustomerDefaultPaymentMethod(
      stripeCustomerId,
      pm.stripePaymentMethodId,
    );

    const updated = await this.prisma.paymentMethod.findUniqueOrThrow({
      where: { id: paymentMethodId },
    });

    return this.formatPaymentMethod(updated);
  }

  // ── Delete (detach) a payment method ─────────────────────────────────────
  // Returns { subscriptionScheduledToCancel: true, expiresAt } when removing
  // the last card automatically schedules the subscription to cancel at the end
  // of the current billing period. The user keeps full access until then.

  async deletePaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<{ subscriptionScheduledToCancel?: true; expiresAt?: string }> {
    const pm = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, userId },
    });
    if (!pm) throw new NotFoundException("Payment method not found");

    // If this is the last payment method, check for an active paid subscription.
    // If one exists, allow the deletion but automatically schedule cancellation
    // at the end of the current billing period so the user keeps access until
    // then and is not surprised by an unexpected charge failure.
    let autoCancel: {
      id: string;
      expiresAt: Date;
      stripeSubId: string | null;
    } | null = null;
    const totalMethods = await this.prisma.paymentMethod.count({
      where: { userId },
    });
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

    // Detach from Stripe (ignore error if already detached)
    try {
      await this.stripe.detachPaymentMethod(pm.stripePaymentMethodId);
    } catch (err) {
      this.logger.warn(
        `[PM DELETE] Stripe detach failed for ${pm.stripePaymentMethodId}: ${String(err)}`,
      );
    }

    await this.prisma.paymentMethod.delete({ where: { id: paymentMethodId } });

    // If this was the default, promote the next most recent
    if (pm.isDefault) {
      const next = await this.prisma.paymentMethod.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (next) {
        await this.prisma.paymentMethod.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
        const stripeCustomerId = await this.getOrCreateStripeCustomer(userId);
        await this.stripe
          .updateCustomerDefaultPaymentMethod(stripeCustomerId, next.stripePaymentMethodId)
          .catch(() => {
            /* best effort */
          });
      }
    }

    // Auto-cancel subscription when the last payment method is removed
    if (autoCancel) {
      const now = new Date();
      await this.prisma.userSubscription.update({
        where: { id: autoCancel.id },
        data: { cancelAtPeriodEnd: true, canceledAt: now },
      });

      // Tell Stripe to cancel at period end (only if it's a real sub_xxx ID)
      if (autoCancel.stripeSubId?.startsWith("sub_")) {
        await this.stripe
          .cancelSubscription(autoCancel.stripeSubId, true)
          .catch((err) =>
            this.logger.warn(
              `[PM DELETE] Stripe cancel-at-period-end failed for ${autoCancel.stripeSubId}: ${String(err)}`,
            ),
          );
      }

      this.logger.log(
        `[PM DELETE] Auto-scheduled subscription ${autoCancel.id} to cancel at ${autoCancel.expiresAt.toISOString()} ` +
          `after last payment method removed for user ${userId}`,
      );

      return {
        subscriptionScheduledToCancel: true,
        expiresAt: autoCancel.expiresAt.toISOString(),
      };
    }

    return {};
  }

  // ── Helper ────────────────────────────────────────────────────────────────

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
  }): object {
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
}
