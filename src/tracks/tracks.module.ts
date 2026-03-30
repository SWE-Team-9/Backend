import { Module } from "@nestjs/common";
import { TracksController } from "./tracks.controller";
import { UserTracksController } from "./user-tracks.controller";
import { TracksService } from "./tracks.service";

@Module({
  controllers: [TracksController, UserTracksController],
  providers: [TracksService],
})
export class TracksModule {}
