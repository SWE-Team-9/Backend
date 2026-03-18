import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { AuthController, AuthSessionController } from "./controllers";
import { AuthService } from "./auth.service";

import { TokenService } from "./services/token.service";
import { CookieService } from "./services/cookie.service";
import { RecaptchaService } from "./services/recaptcha.service";
import { SessionManagementService } from "./services/session-management.service";

import { JwtCookieStrategy } from "./strategies/jwt-cookie.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";

import { MailModule } from "../mail/mail.module";

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: "jwt-cookie" }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>("security.jwtSecret"),
        signOptions: {
          expiresIn:
            configService.get<string>("security.jwtAccessExpiry") ?? "15m",
          issuer:
            configService.get<string>("security.jwtIssuer") ?? "spotly-api",
          audience:
            configService.get<string>("security.jwtAudience") ??
            "spotly-client",
        },
      }),
    }),
    MailModule,
  ],
  controllers: [AuthController, AuthSessionController],
  providers: [
    // ── Member 1 — Backend Lead + Security Owner ──────────────────────────
    TokenService,
    CookieService,
    RecaptchaService,
    JwtCookieStrategy,

    // ── Member 2 — Core Authentication Engineer ───────────────────────────
    AuthService,

    // ── Member 3 — OAuth + Sessions Engineer ─────────────────────────────
    SessionManagementService,
    GoogleStrategy,
  ],
  exports: [
    TokenService,
    CookieService,
    RecaptchaService,
    SessionManagementService,
    PassportModule,
    JwtModule,
  ],
})
export class AuthModule {}
