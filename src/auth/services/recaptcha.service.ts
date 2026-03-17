import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type RecaptchaResponse = {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
};

@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);

  constructor(private readonly configService: ConfigService) {}

  async verifyToken(
    token: string,
    remoteIp?: string,
  ): Promise<RecaptchaResponse> {
    const secret = this.configService.get<string>("security.recaptchaSecret");

    // Dev-mode bypass: if no secret is configured, skip CAPTCHA verification
    // and log a warning so the team knows it is disabled.
    if (!secret) {
      this.logger.warn(
        "RECAPTCHA_SECRET is not configured — CAPTCHA verification is DISABLED. " +
          "This is only acceptable in local development.",
      );
      return { success: true };
    }

    if (!token || token.trim() === "") {
      throw new UnauthorizedException({
        code: "CAPTCHA_TOKEN_MISSING",
        message: "A CAPTCHA token is required.",
      });
    }

    const body = new URLSearchParams({ secret, response: token });

    if (remoteIp) {
      body.append("remoteip", remoteIp);
    }

    let result: Response;

    try {
      result = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "CAPTCHA_UNAVAILABLE",
        message: "Unable to reach the CAPTCHA verification service.",
      });
    }

    if (!result.ok) {
      throw new ServiceUnavailableException({
        code: "CAPTCHA_UNAVAILABLE",
        message: "Unable to verify CAPTCHA token at this time.",
      });
    }

    const data = (await result.json()) as RecaptchaResponse;

    if (!data.success) {
      throw new UnauthorizedException({
        code: "CAPTCHA_FAILED",
        message: "CAPTCHA verification failed. Please try again.",
      });
    }

    return data;
  }
}
