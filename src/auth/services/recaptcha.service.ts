import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret = this.configService.get<string>("security.recaptchaSecret") ?? "";
  }

  // Verify a reCAPTCHA token with Google's API
  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    // Skip verification in development if no secret is configured
    if (!this.secret) {
      this.logger.warn("RECAPTCHA_SECRET is not set — skipping CAPTCHA verification.");
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
      const params = new URLSearchParams({
        secret: this.secret,
        response: token,
      });
      if (remoteIp) {
        params.append("remoteip", remoteIp);
      }

      const response = await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        },
      );

      const data = (await response.json()) as { success: boolean };

      if (!data.success) {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            error: "CAPTCHA_FAILED",
            message: "CAPTCHA verification failed. Please try again.",
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
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
