import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class RecaptchaService {
  constructor(private readonly configService: ConfigService) {}

  // CAPTCHA disabled for testing deployment
  async verify(_token?: string, _remoteIp?: string): Promise<void> {
    return;
  }
}
