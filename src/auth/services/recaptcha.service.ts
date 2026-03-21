import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);

  // Standard reCAPTCHA v2/v3 secret keys (one per platform)
  private readonly secrets: string[];

  // reCAPTCHA Enterprise config (for Android team who ended up on Enterprise)
  private readonly enterpriseApiKey: string | undefined;
  private readonly enterpriseProjectId: string | undefined;
  private readonly enterpriseAndroidSiteKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.secrets = [
      this.configService.get<string>("security.recaptchaSecret"),
    ].filter((s): s is string => Boolean(s));

    this.enterpriseApiKey = this.configService.get<string>("security.recaptchaEnterpriseApiKey");
    this.enterpriseProjectId = this.configService.get<string>("security.recaptchaEnterpriseProjectId");
    this.enterpriseAndroidSiteKey = this.configService.get<string>("security.recaptchaEnterpriseAndroidSiteKey");
  }

  private get hasAnyConfig(): boolean {
    return (
      this.secrets.length > 0 ||
      Boolean(this.enterpriseApiKey && this.enterpriseProjectId && this.enterpriseAndroidSiteKey)
    );
  }

  // Verify a reCAPTCHA token.
  // Tries standard secret keys first, then Enterprise API.
  // Token passes if any method succeeds.
  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    // Skip verification in development if nothing is configured
    if (!this.hasAnyConfig) {
      this.logger.warn("No RECAPTCHA config found — skipping CAPTCHA verification.");
      return;
    }

    if (!token) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: "CAPTCHA_TOKEN_MISSING",
          message: "CAPTCHA token is required.",
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      // ── Standard reCAPTCHA v2/v3 ───────────────────────────────────────────────
      for (const secret of this.secrets) {
        const params = new URLSearchParams({ secret, response: token });
        if (remoteIp) params.append("remoteip", remoteIp);

        const response = await fetch(
          "https://www.google.com/recaptcha/api/siteverify",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
          },
        );

        const data = (await response.json()) as { success: boolean; "error-codes"?: string[] };
        if (data.success) return; // token is valid — done
        if (data["error-codes"]?.length) {
          this.logger.debug(`CAPTCHA standard rejected: ${data["error-codes"].join(", ")}`);
        }
      }

      // ── reCAPTCHA Enterprise (Android) ─────────────────────────────────────────
      // Enterprise uses a different API: POST to Cloud with an API key.
      // The response contains tokenProperties.valid and a risk score (0.0–1.0).
      if (this.enterpriseApiKey && this.enterpriseProjectId && this.enterpriseAndroidSiteKey) {
        const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${this.enterpriseProjectId}/assessments?key=${this.enterpriseApiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: { token, siteKey: this.enterpriseAndroidSiteKey },
          }),
        });

        const data = (await response.json()) as {
          tokenProperties?: { valid: boolean; invalidReason?: string };
          riskAnalysis?: { score: number };
        };

        if (data.tokenProperties?.valid) {
          const score = data.riskAnalysis?.score ?? 0;
          // Score 0.0 = likely bot, 1.0 = likely human. Threshold: 0.5
          if (score >= 0.5) return;
          this.logger.debug(`CAPTCHA Enterprise: token valid but score too low (${score})`);
        } else {
          this.logger.debug(`CAPTCHA Enterprise rejected: ${data.tokenProperties?.invalidReason ?? "unknown"}`);
        }
      }

      // Nothing accepted the token
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: "CAPTCHA_FAILED",
          message: "CAPTCHA verification failed. Please try again.",
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } catch (error) {
      // If it's already our HttpException, re-throw it
      if (error instanceof HttpException) throw error;

      this.logger.error("CAPTCHA verification request failed", error);
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: "CAPTCHA_UNAVAILABLE",
          message: "CAPTCHA service is temporarily unavailable.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
