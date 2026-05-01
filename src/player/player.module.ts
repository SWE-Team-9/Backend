import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { PlayerController } from "./player.controller";
import { PlayerService } from "./player.service";

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [PlayerController],
  providers: [PlayerService],
  exports: [PlayerService],
})
export class PlayerModule {}
