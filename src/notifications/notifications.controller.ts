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
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NotificationsService } from "./notifications.service";
import { NotificationsQueryDto } from "./dto/notifications-query.dto";
import { NotificationPreferencesDto } from "./dto/notification-preferences.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";

@ApiTags("Notifications")
@ApiCookieAuth("access_token")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // GET /api/v1/notifications
  @ApiOperation({
    summary: "Get notifications",
    description:
      "Returns a paginated list of notifications for the authenticated user. Each notification includes actor display name, handle, and avatar URL.",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated notifications list.",
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 5,
        notifications: [
          {
            id: "uuid",
            type: "like",
            message: "John liked your track",
            actorId: "uuid",
            actorDisplayName: "John Doe",
            actorHandle: "johndoe",
            actorAvatarUrl: null,
            entityType: "track",
            entityId: "uuid",
            isRead: false,
            createdAt: "2026-04-27T00:00:00.000Z",
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get()
  getNotifications(
    @CurrentUser("userId") userId: string,
    @Query() query: NotificationsQueryDto,
  ) {
    return this.notificationsService.getNotifications(userId, query);
  }

  // GET /api/v1/notifications/unread-count
  @ApiOperation({
    summary: "Get unread notification count",
    description:
      "Returns the number of unread notifications for the authenticated user.",
  })
  @ApiResponse({
    status: 200,
    description: "Unread count.",
    schema: { example: { count: 3 } },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("unread-count")
  getUnreadCount(@CurrentUser("userId") userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  // GET /api/v1/notifications/preferences
  @ApiOperation({
    summary: "Get notification preferences",
    description:
      "Returns the authenticated user's notification preference settings.",
  })
  @ApiResponse({
    status: 200,
    description: "Notification preferences returned.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("preferences")
  getPreferences(@CurrentUser("userId") userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  // PUT /api/v1/notifications/preferences
  @ApiOperation({
    summary: "Update notification preferences",
    description:
      "Updates the authenticated user's notification preference settings.",
  })
  @ApiResponse({ status: 200, description: "Preferences updated." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Put("preferences")
  @HttpCode(200)
  updatePreferences(
    @CurrentUser("userId") userId: string,
    @Body() dto: NotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto);
  }

  // PATCH /api/v1/notifications/read-all
  @ApiOperation({
    summary: "Mark all notifications as read",
    description:
      "Marks every unread notification as read for the authenticated user.",
  })
  @ApiResponse({
    status: 200,
    description: "All notifications marked as read.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Patch("read-all")
  @HttpCode(200)
  markAllRead(@CurrentUser("userId") userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  // PATCH /api/v1/notifications/:id/read
  @ApiOperation({
    summary: "Mark notification as read",
    description: "Marks a single notification as read.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Notification UUID.",
  })
  @ApiResponse({ status: 200, description: "Notification marked as read." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Notification not found." })
  @Patch(":id/read")
  @HttpCode(200)
  markAsRead(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.markAsRead(userId, notificationId);
  }

  // DELETE /api/v1/notifications/:id
  @ApiOperation({
    summary: "Delete notification",
    description:
      "Permanently deletes a notification belonging to the authenticated user.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Notification UUID.",
  })
  @ApiResponse({ status: 200, description: "Notification deleted." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Notification not found." })
  @Delete(":id")
  @HttpCode(200)
  deleteNotification(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) notificationId: string,
  ) {
    return this.notificationsService.deleteNotification(userId, notificationId);
  }

  // POST /api/v1/notifications/push/register
  @ApiOperation({
    summary: "Register push notification device",
    description: "Registers a device token for push notifications (FCM/APNs).",
  })
  @ApiResponse({ status: 201, description: "Device registered." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Post("push/register")
  registerDevice(
    @CurrentUser("userId") userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerDevice(userId, dto);
  }

  // DELETE /api/v1/notifications/push/:deviceId
  @ApiOperation({
    summary: "Remove push notification device",
    description: "Unregisters a device from push notifications.",
  })
  @ApiParam({
    name: "deviceId",
    type: "string",
    format: "uuid",
    description: "Device UUID.",
  })
  @ApiResponse({ status: 200, description: "Device unregistered." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Device not found." })
  @Delete("push/:deviceId")
  @HttpCode(200)
  removeDevice(
    @CurrentUser("userId") userId: string,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
  ) {
    return this.notificationsService.removeDevice(userId, deviceId);
  }
}
