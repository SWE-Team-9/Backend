import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type MailTransporter = {
  sendMail: (options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
};

const nodemailer = require("nodemailer") as {
  createTransport: (options: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    tls?: { rejectUnauthorized: boolean };
  }) => MailTransporter;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: MailTransporter | null = null;
  private warnedMissingConfig = false;

  constructor(private readonly configService: ConfigService) {}

  async sendVerificationEmail(params: {
    to: string;
    displayName?: string;
    token: string;
  }): Promise<void> {
    const verificationUrl = this.buildUrl("verify-email", params.token);

    await this.sendMail({
      to: params.to,
      subject: "Verify your IQA3 account",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        "Welcome to IQA3. Verify your email by opening this link:",
        verificationUrl,
        "",
        "If you did not create this account, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        "<p>Welcome to IQA3. Verify your email by opening this link:</p>",
        `<p><a href="${this.escapeHtml(verificationUrl)}">${this.escapeHtml(verificationUrl)}</a></p>`,
        "<p>If you did not create this account, you can ignore this email.</p>",
      ].join(""),
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    displayName?: string;
    token: string;
  }): Promise<void> {
    const resetUrl = this.buildUrl("reset-password", params.token);

    await this.sendMail({
      to: params.to,
      subject: "Reset your IQA3 password",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        "You requested to reset your IQA3 password.",
        "Open this link to continue:",
        resetUrl,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        "<p>You requested to reset your IQA3 password.</p>",
        "<p>Open this link to continue:</p>",
        `<p><a href="${this.escapeHtml(resetUrl)}">${this.escapeHtml(resetUrl)}</a></p>`,
        "<p>If you did not request this, you can ignore this email.</p>",
      ].join(""),
    });
  }

  async sendEmailChangeVerificationEmail(params: {
    to: string;
    displayName?: string;
    token: string;
    newEmail: string;
  }): Promise<void> {
    const confirmUrl = this.buildUrl("confirm-email-change", params.token);

    await this.sendMail({
      to: params.to,
      subject: "Confirm your IQA3 email change",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `You requested to change your account email to ${params.newEmail}.`,
        "Confirm this change by opening this link:",
        confirmUrl,
        "",
        "If you did not request this change, ignore this message.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>You requested to change your account email to <strong>${this.escapeHtml(params.newEmail)}</strong>.</p>`,
        "<p>Confirm this change by opening this link:</p>",
        `<p><a href=\"${this.escapeHtml(confirmUrl)}\">${this.escapeHtml(confirmUrl)}</a></p>`,
        "<p>If you did not request this change, ignore this message.</p>",
      ].join(""),
    });
  }

  async sendPaymentFailedEmail(params: {
    to: string;
    displayName?: string;
  }): Promise<void> {
    await this.sendMail({
      to: params.to,
      subject: "Your IQA3 subscription payment failed",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        "We were unable to process your subscription payment.",
        "Please update your payment method to keep enjoying your premium plan.",
        "",
        "If you have any questions, please contact our support team.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        "<p>We were unable to process your subscription payment.</p>",
        "<p>Please update your payment method to keep enjoying your premium plan.</p>",
        "<p>If you have any questions, please contact our support team.</p>",
      ].join(""),
    });
  }

  async sendTrialEndingEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
    priceCents: number;
    trialEndsAt: Date;
  }): Promise<void> {
    const priceDisplay = `$${(params.priceCents / 100).toFixed(2)}/month`;
    const endsOn = params.trialEndsAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    await this.sendMail({
      to: params.to,
      subject: "Your IQA3 free trial ends soon",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `Your free trial for ${params.planName} ends on ${endsOn}.`,
        `After that, you will be automatically charged ${priceDisplay}.`,
        "",
        "No action is needed - your subscription will renew automatically.",
        "If you'd like to cancel before your trial ends, go to Settings > Subscription in the app.",
        "",
        "Thanks for being part of IQA3!",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>Your free trial for <strong>${this.escapeHtml(params.planName)}</strong> ends on <strong>${this.escapeHtml(endsOn)}</strong>.</p>`,
        `<p>After that, you will be automatically charged <strong>${this.escapeHtml(priceDisplay)}</strong>.</p>`,
        "<p>No action is needed - your subscription will renew automatically.</p>",
        "<p>If you'd like to cancel before your trial ends, go to <strong>Settings &gt; Subscription</strong> in the app.</p>",
        "<p>Thanks for being part of IQA3!</p>",
      ].join(""),
    });
  }

  async sendTrialStartedEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
    priceCents: number;
    trialEndsAt: Date;
  }): Promise<void> {
    const priceDisplay = `$${(params.priceCents / 100).toFixed(2)}/month`;
    const endsOn = params.trialEndsAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    await this.sendMail({
      to: params.to,
      subject: `Your free ${params.planName} trial has started!`,
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `Welcome to your free ${params.planName} trial!`,
        `You have full access until ${endsOn} - completely free.`,
        "",
        `After your trial ends, you will be automatically charged ${priceDisplay}.`,
        "We will send you a reminder email approximately 48 hours before that happens.",
        "",
        "To cancel at any time before the trial ends, go to Settings > Subscription in the app.",
        "",
        "Enjoy IQA3!",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>Welcome to your free <strong>${this.escapeHtml(params.planName)}</strong> trial!</p>`,
        `<p>You have full access until <strong>${this.escapeHtml(endsOn)}</strong> - completely free.</p>`,
        `<p>After your trial ends, you will be automatically charged <strong>${this.escapeHtml(priceDisplay)}</strong>.</p>`,
        "<p>We will send you a reminder email approximately 48 hours before that happens.</p>",
        "<p>To cancel at any time before the trial ends, go to <strong>Settings &gt; Subscription</strong> in the app.</p>",
        "<p>Enjoy IQA3!</p>",
      ].join(""),
    });
  }

  async sendSubscriptionConfirmationEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
    priceCents: number;
    currentPeriodEnd: Date;
  }): Promise<void> {
    const priceDisplay = `$${(params.priceCents / 100).toFixed(2)}/month`;
    const renewsOn = params.currentPeriodEnd.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    await this.sendMail({
      to: params.to,
      subject: `You're subscribed to ${params.planName}!`,
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `You are now subscribed to ${params.planName}.`,
        `Your subscription renews on ${renewsOn} for ${priceDisplay}.`,
        "",
        "You now have access to all premium features.",
        "To manage or cancel your subscription, go to Settings > Subscription in the app.",
        "",
        "Thanks for subscribing to IQA3!",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>You are now subscribed to <strong>${this.escapeHtml(params.planName)}</strong>.</p>`,
        `<p>Your subscription renews on <strong>${this.escapeHtml(renewsOn)}</strong> for <strong>${this.escapeHtml(priceDisplay)}</strong>.</p>`,
        "<p>You now have access to all premium features.</p>",
        "<p>To manage or cancel your subscription, go to <strong>Settings &gt; Subscription</strong> in the app.</p>",
        "<p>Thanks for subscribing to IQA3!</p>",
      ].join(""),
    });
  }

  async sendPaymentGracePeriodEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
    gracePeriodDays: number;
  }): Promise<void> {
    await this.sendMail({
      to: params.to,
      subject: "Action required: IQA3 payment failed",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `We were unable to process your payment for ${params.planName}.`,
        `You have ${params.gracePeriodDays} day${params.gracePeriodDays !== 1 ? "s" : ""} to update your payment method before your subscription is cancelled.`,
        "",
        "During this period, you retain full access to your subscription.",
        "To update your payment method, go to Settings > Subscription in the app.",
        "",
        "If you do not update your payment method in time, your subscription will be cancelled and you will be moved to the Free plan.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>We were unable to process your payment for <strong>${this.escapeHtml(params.planName)}</strong>.</p>`,
        `<p>You have <strong>${params.gracePeriodDays} day${params.gracePeriodDays !== 1 ? "s" : ""}</strong> to update your payment method before your subscription is cancelled.</p>`,
        "<p>During this period, you retain full access to your subscription.</p>",
        "<p>To update your payment method, go to <strong>Settings &gt; Subscription</strong> in the app.</p>",
        "<p>If you do not update your payment method in time, your subscription will be cancelled and you will be moved to the Free plan.</p>",
      ].join(""),
    });
  }

  async sendPaymentFailedMovedToFreeEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
  }): Promise<void> {
    await this.sendMail({
      to: params.to,
      subject: "Your IQA3 payment failed - subscription paused",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `We were unable to process your payment for ${params.planName}.`,
        "Your subscription has been paused and you have been moved to the Free plan.",
        "",
        "To restore your access, please update your payment method and re-subscribe.",
        "Go to Settings > Subscription in the app.",
        "",
        "If you need help, please contact our support team.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>We were unable to process your payment for <strong>${this.escapeHtml(params.planName)}</strong>.</p>`,
        "<p>Your subscription has been paused and you have been moved to the <strong>Free plan</strong>.</p>",
        "<p>To restore your access, please update your payment method and re-subscribe via <strong>Settings &gt; Subscription</strong> in the app.</p>",
        "<p>If you need help, please contact our support team.</p>",
      ].join(""),
    });
  }

  async sendCancellationConfirmedEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
    expiresAt: Date;
  }): Promise<void> {
    const expiresStr = params.expiresAt.toISOString().slice(0, 10);
    await this.sendMail({
      to: params.to,
      subject: "Your IQA3 subscription has been cancelled",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `Your ${params.planName} subscription has been cancelled.`,
        `You will retain full access to your premium features until ${expiresStr}.`,
        "",
        "After that date, your account will revert to the Free plan.",
        "You can re-subscribe at any time from Settings > Subscription.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>Your <strong>${this.escapeHtml(params.planName)}</strong> subscription has been cancelled.</p>`,
        `<p>You will retain full access to your premium features until <strong>${expiresStr}</strong>.</p>`,
        "<p>After that date, your account will revert to the <strong>Free plan</strong>.</p>",
        "<p>You can re-subscribe at any time from <strong>Settings &gt; Subscription</strong>.</p>",
      ].join(""),
    });
  }

  async sendInvoiceReceiptEmail(params: {
    to: string;
    displayName?: string;
    planName: string;
    amountPaidCents: number;
    paidAt: Date;
    invoiceId: string;
  }): Promise<void> {
    const amountDisplay = `$${(params.amountPaidCents / 100).toFixed(2)}`;
    const paidAtStr = params.paidAt.toISOString().slice(0, 10);
    await this.sendMail({
      to: params.to,
      subject: `IQA3 invoice: ${amountDisplay} for ${params.planName}`,
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `We've charged ${amountDisplay} for your ${params.planName} subscription.`,
        `Date: ${paidAtStr}`,
        `Invoice: ${params.invoiceId}`,
        "",
        "Thank you for being a subscriber!",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>We've charged <strong>${amountDisplay}</strong> for your <strong>${this.escapeHtml(params.planName)}</strong> subscription.</p>`,
        `<p>Date: ${paidAtStr}<br/>Invoice ID: ${this.escapeHtml(params.invoiceId)}</p>`,
        "<p>Thank you for being a subscriber!</p>",
      ].join(""),
    });
  }

  async sendPlanChangedEmail(params: {
    to: string;
    displayName?: string;
    oldPlanName: string;
    newPlanName: string;
    effectiveDate: Date;
  }): Promise<void> {
    const effectiveDateStr = params.effectiveDate.toISOString().slice(0, 10);
    await this.sendMail({
      to: params.to,
      subject: `Your IQA3 plan has changed to ${params.newPlanName}`,
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `Your subscription has been changed from ${params.oldPlanName} to ${params.newPlanName}.`,
        `Effective: ${effectiveDateStr}`,
        "",
        "Your new plan features are available immediately.",
        "Manage your subscription in Settings > Subscription.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>Your subscription has been changed from <strong>${this.escapeHtml(params.oldPlanName)}</strong> to <strong>${this.escapeHtml(params.newPlanName)}</strong>.</p>`,
        `<p>Effective: ${effectiveDateStr}</p>`,
        "<p>Your new plan features are available immediately.</p>",
        "<p>Manage your subscription in <strong>Settings &gt; Subscription</strong>.</p>",
      ].join(""),
    });
  }

  async sendPaymentMethodUpdatedEmail(params: {
    to: string;
    displayName?: string;
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
  }): Promise<void> {
    const brandDisplay =
      params.brand.charAt(0).toUpperCase() +
      params.brand.slice(1).toLowerCase();
    const expiryDisplay = `${String(params.expiryMonth).padStart(2, "0")}/${params.expiryYear}`;
    const cardDisplay = `${brandDisplay} ending in ${params.last4}`;

    await this.sendMail({
      to: params.to,
      subject: "Your IQA3 payment method has been updated",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        `Your default payment method has been updated to: ${cardDisplay} (expires ${expiryDisplay}).`,
        "",
        "If you did not make this change, please contact support immediately.",
        "",
        "You can manage your payment methods in Settings > Subscription > Payment Methods.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        `<p>Your default payment method has been updated to: <strong>${this.escapeHtml(cardDisplay)}</strong> (expires ${this.escapeHtml(expiryDisplay)}).</p>`,
        "<p>If you did not make this change, please contact support immediately.</p>",
        "<p>You can manage your payment methods in <strong>Settings &gt; Subscription &gt; Payment Methods</strong>.</p>",
      ].join(""),
    });
  }

  private async sendMail(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      return;
    }

    try {
      const fromAddress =
        this.configService.get<string>("mail.from") ??
        "Spotly <noreply@spotly.app>";

      await transporter.sendMail({
        from: fromAddress,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "MAIL_DELIVERY_FAILED",
        message: "Unable to send email at this time.",
      });
    }
  }

  private getTransporter(): MailTransporter | null {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.configService.get<string>("mail.host") ?? "";
    const port = this.configService.get<number>("mail.port") ?? 2525;
    const secure = this.configService.get<boolean>("mail.secure", false);
    const user = this.configService.get<string>("mail.user") ?? "";
    const pass = this.configService.get<string>("mail.pass") ?? "";

    const hasConfig =
      host.trim() !== "" && user.trim() !== "" && pass.trim() !== "";
    if (!hasConfig) {
      if (!this.warnedMissingConfig) {
        this.warnedMissingConfig = true;
        this.logger.warn(
          "Mail credentials are not configured. Email delivery is disabled in this environment.",
        );
      }
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      // Allow self-signed / intermediate certs in dev environments.
      // Gmail's cert chain can be rejected by some Node.js TLS stacks.
      tls: { rejectUnauthorized: false },
    });

    return this.transporter;
  }

  private buildUrl(
    path: "verify-email" | "reset-password" | "confirm-email-change",
    token: string,
  ): string {
    const clientUrl =
      this.configService.get<string>("app.clientUrl") ??
      "http://localhost:5173";
    const base = clientUrl.replace(/\/+$/, "");
    const encodedToken = encodeURIComponent(token);
    return `${base}/${path}?token=${encodedToken}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
