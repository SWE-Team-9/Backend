import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { MailModule } from "./mail/mail.module";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./common/storage/storage.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import configuration from "./config/configuration";
import { validateEnvironment } from "./config/env.validation";

@Module({
  imports: [
    // ── Config ───────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnvironment,
    }),

    // ── Rate limiting (global) ────────────────────────────────────────────────
    // Default: 100 requests per 60 seconds per IP.
    // Auth routes apply stricter per-route limits via @ThrottlePolicy().
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60 * 1000,
        limit: 100,
      },
    ]),

    // ── Shared infrastructure (global modules) ────────────────────────────────
    PrismaModule, // @Global — PrismaService available everywhere
    StorageModule, // @Global — StorageService available everywhere (Member 5)
    MailModule, // shared — MailService used by AuthModule

    // ── Feature modules ───────────────────────────────────────────────────────
    AuthModule, // Members 1, 2, 3
    UsersModule, // Members 4, 5
  ],
  controllers: [AppController],
  providers: [
    // Guard execution order: throttle → JWT auth → roles
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
