import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";
import { InteractionsController } from "./interactions.controller";
import { InteractionsGateway } from "./interactions.gateway";
import { InteractionsService } from "./interactions.service";
import { TracksController } from "./tracks.controller";
import { TracksService } from "./tracks.service";

@Module({
  imports: [PrismaModule],
  controllers: [InteractionsController, TracksController],
  providers: [InteractionsService, InteractionsGateway, TracksService],
  exports: [InteractionsService, TracksService],
})
export class TracksModule {}