import { Module } from "@nestjs/common";

import { PlaylistsController } from "./playlists.controller";
import { PlaylistsService } from "./playlists.service";
import { StorageModule } from "../common/storage/storage.module";

@Module({
  imports: [StorageModule],
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
