import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);
  private static readonly VERIFY_TIMEOUT_MS = 8000;

  // Standard reCAPTCHA v2/v3 secret keys (one per platform)
  private readonly secrets: string[];

  // reCAPTCHA Enterprise config (shared across Enterprise platforms)
  private readonly enterpriseApiKey: string | undefined;
  private readonly enterpriseProjectId: string | undefined;
  // Site keys per platform — add more here as new platforms join
  private readonly enterpriseSiteKeys: string[];

  constructor(private readonly configService: ConfigService) {
    this.secrets = [
      this.configService.get<string>("security.recaptchaSecret"),
      this.configService.get<string>("security.recaptchaSecretCrossWeb"),
    ].filter((s): s is string => Boolean(s));

    this.enterpriseApiKey = this.configService.get<string>("security.recaptchaEnterpriseApiKey");
    this.enterpriseProjectId = this.configService.get<string>("security.recaptchaEnterpriseProjectId");
    this.enterpriseSiteKeys = [
      this.configService.get<string>("security.recaptchaEnterpriseAndroidSiteKey"),
      this.configService.get<string>("security.recaptchaEnterpriseWebSiteKey"),
    ].filter((k): k is string => Boolean(k));
  }

  private get hasAnyConfig(): boolean {
    return (
      this.secrets.length > 0 ||
      Boolean(this.enterpriseApiKey && this.enterpriseProjectId && this.enterpriseSiteKeys.length > 0)
    );
  }

  // Verify a reCAPTCHA token.
  // CAPTCHA verification is currently DISABLED to support cross-platform
  // clients and automated testing bots. The frontend may still send
  // captcha_token — it is simply ignored.
  // To re-enable, remove the early return below and restore the original logic.
  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    this.logger.warn("CAPTCHA verification is DISABLED — all requests are allowed through.");
    return;
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RecaptchaService.VERIFY_TIMEOUT_MS);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
