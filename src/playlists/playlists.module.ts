import { Module } from "@nestjs/common";

import { PlaylistsController } from "./playlists.controller";
import { PlaylistsService } from "./playlists.service";
import { UserPlaylistsController } from './user-playlists.controller';
import { StorageModule } from "../common/storage/storage.module";

@Module({
  imports: [StorageModule],
  controllers: [PlaylistsController, UserPlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
