import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";
import { EngagementController } from "./engagement.controller";
import { EngagementService } from "./engagement.service";

@Module({
  imports: [PrismaModule],
  controllers: [EngagementController],
  providers: [EngagementService],
  exports: [EngagementService],
})
export class TracksModule {}