import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Sign a short-lived access token (15 min by default)
  signAccessToken(userId: string, role: string): string {
    const payload = { sub: userId, role };
    return this.jwtService.sign(payload);
  }

  // Create an opaque refresh token (random bytes, not a JWT)
  createRefreshToken(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(48).toString("hex");
    const hash = this.hashToken(raw);
    return { raw, hash };
  }

  // Hash a token using SHA-256 for safe database storage
  hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
