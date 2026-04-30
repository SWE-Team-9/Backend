import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PlayerModule } from "../player/player.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { MessagesModule } from "../messages/messages.module";
import { SocialModule } from "../social/social.module";
import { TracksModule } from "../tracks/tracks.module";

import { BffService } from "./bff.service";
import { AppBootstrapController } from "./controllers/app-bootstrap.controller";
import { PageProfileController } from "./controllers/page-profile.controller";
import { PageSettingsController } from "./controllers/page-settings.controller";

@Module({
  imports: [
    AuthModule,
    UsersModule,
    NotificationsModule,
    PlayerModule,
    EntitlementsModule,
    SubscriptionsModule,
    MessagesModule,
    SocialModule,
    TracksModule,
  ],
  controllers: [AppBootstrapController, PageProfileController, PageSettingsController],
  providers: [BffService],
})
export class BffModule {}
