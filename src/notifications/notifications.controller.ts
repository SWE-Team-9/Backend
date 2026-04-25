import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NotificationsService } from "./notifications.service";
import { NotificationsQueryDto } from "./dto/notifications-query.dto";
import { NotificationPreferencesDto } from "./dto/notification-preferences.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // GET /api/v1/notifications
  @Get()
  getNotifications(
    @CurrentUser("userId") userId: string,
    @Query() query: NotificationsQueryDto,
  ) {
    return this.notificationsService.getNotifications(userId, query);
  }

  // GET /api/v1/notifications/unread-count
  @Get("unread-count")
  getUnreadCount(@CurrentUser("userId") userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  // GET /api/v1/notifications/preferences
  @Get("preferences")
  getPreferences(@CurrentUser("userId") userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  // PUT /api/v1/notifications/preferences
  @Put("preferences")
  @HttpCode(200)
  updatePreferences(
    @CurrentUser("userId") userId: string,
    @Body() dto: NotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto);
  }

  // PATCH /api/v1/notifications/read-all
  @Patch("read-all")
  @HttpCode(200)
  markAllRead(@CurrentUser("userId") userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  // PATCH /api/v1/notifications/:id/read
  @Patch(":id/read")
  @HttpCode(200)
  markAsRead(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  // DELETE /api/v1/notifications/:id
  @Delete(":id")
  @HttpCode(200)
  deleteNotification(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.deleteNotification(userId, notificationId);
  }

  // POST /api/v1/notifications/push/register
  @Post("push/register")
  registerDevice(
    @CurrentUser("userId") userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(userId, dto);
  }

  // DELETE /api/v1/notifications/push/:deviceId
  @Delete("push/:deviceId")
  @HttpCode(200)
  removeDevice(
    @CurrentUser("userId") userId: string,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
  ) {
    return this.notificationsService.removeDevice(userId, deviceId);
  }
}
