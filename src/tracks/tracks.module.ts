import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { InteractionsController } from "./interactions.controller";
import { InteractionsGateway } from "./interactions.gateway";
import { InteractionsService } from "./interactions.service";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";
import { TranscodingService } from "./transcoding.service";
import { UserTracksController } from "./user-tracks.controller";

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [InteractionsController, TracksController, UserTracksController],
  providers: [InteractionsService, InteractionsGateway, TracksService, TranscodingService],
  exports: [InteractionsService, TracksService],
})
export class TracksModule {}
