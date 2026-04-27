import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [PrismaModule, JwtModule, AuthModule],
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
