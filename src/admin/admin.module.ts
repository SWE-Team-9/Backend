import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { UserEnforcementController } from "./user-enforcement.controller";
import { UserEnforcementService } from "./user-enforcement.service";
import { ContentModerationController } from "./content-moderation.controller";
import { ContentModerationService } from "./content-moderation.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";

@Module({
  imports: [NotificationsModule],
  controllers: [
    UserEnforcementController,
    ContentModerationController,
    AdminUsersController,
  ],
  providers: [
    UserEnforcementService,
    ContentModerationService,
    AdminUsersService,
  ],
})
export class AdminModule {}
