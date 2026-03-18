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
      subject: "Verify your Spotly account",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        "Welcome to Spotly. Verify your email by opening this link:",
        verificationUrl,
        "",
        "If you did not create this account, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        "<p>Welcome to Spotly. Verify your email by opening this link:</p>",
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
      subject: "Reset your Spotly password",
      text: [
        `Hi ${params.displayName ?? "there"},`,
        "",
        "You requested to reset your Spotly password.",
        "Open this link to continue:",
        resetUrl,
        "",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: [
        `<p>Hi ${this.escapeHtml(params.displayName ?? "there")},</p>`,
        "<p>You requested to reset your Spotly password.</p>",
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
      subject: "Confirm your Spotly email change",
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
