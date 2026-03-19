import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { MailModule } from "../mail/mail.module";

import { AuthService } from "./auth.service";
import { TokenService } from "./services/token.service";
import { CookieService } from "./services/cookie.service";
import { SessionService } from "./services/session.service";
import { RecaptchaService } from "./services/recaptcha.service";

import { JwtCookieStrategy } from "./strategies/jwt-cookie.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";

import { AuthController } from "./controllers/auth.controller";

@Module({
  imports: [
    PassportModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get("security.jwtSecret"),
        signOptions: {
          expiresIn: "15m",
          issuer: config.get("security.jwtIssuer") ?? "spotly-api",
          audience: config.get("security.jwtAudience") ?? "spotly-client",
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    CookieService,
    SessionService,
    RecaptchaService,
    JwtCookieStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
