import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { PrismaService } from "../prisma/prisma.service";

const mockPrisma = {
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  userNotificationPreference: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  pushDevice: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe("NotificationsService", () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  // 1. getNotifications — filters by type correctly
  it("getNotifications: passes type filter to prisma as eventType", async () => {
    mockPrisma.notification.findMany.mockResolvedValueOnce([]);
    mockPrisma.notification.count.mockResolvedValueOnce(0);
    await service.getNotifications("user-1", { type: "LIKE" as any });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eventType: "LIKE" }),
      }),
    );
  });

  // 2. getNotifications — isRead=true maps to readAt: { not: null }
  it("getNotifications: converts isRead=true to readAt not-null filter", async () => {
    mockPrisma.notification.findMany.mockResolvedValueOnce([]);
    mockPrisma.notification.count.mockResolvedValueOnce(0);
    await service.getNotifications("user-1", { isRead: true });
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ readAt: { not: null } }),
      }),
    );
  });

  // 3. markAsRead — throws 403 when notification belongs to different user
  it("markAsRead: throws 403 when notification does not belong to user", async () => {
    mockPrisma.notification.findUnique.mockResolvedValueOnce({
      id: "notif-1",
      recipientId: "other-user",
    });
    await expect(
      service.markAsRead("user-1", "notif-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  // 4. markAllRead — calls updateMany with readAt:null filter + emits WS
  it("markAllRead: calls updateMany with readAt null filter and emits WS event", async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 3 });
    const mockGateway = { emitToUser: jest.fn() };
    service.setGateway(mockGateway);

    await service.markAllRead("user-1");

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: "user-1", readAt: null },
      }),
    );
    expect(mockGateway.emitToUser).toHaveBeenCalledWith(
      "user-1",
      "unread_count_updated",
      expect.objectContaining({ unreadCount: 0 }),
    );
  });
});
