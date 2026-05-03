import { Test, TestingModule } from "@nestjs/testing";
import {
  NotificationsListener,
  ReportCreatedEvent,
  TrackLikedEvent,
} from "./notifications.listener";
import { NotificationsService } from "./notifications.service";
import { PrismaService } from "../prisma/prisma.service";

const mockNotificationsService = {
  createNotification: jest.fn(),
};

const mockPrisma = {
  userNotificationPreference: {
    findUnique: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  track: {
    findUnique: jest.fn(),
  },
  comment: {
    findUnique: jest.fn(),
  },
  playlist: {
    findUnique: jest.fn(),
  },
};

describe("NotificationsListener", () => {
  let listener: NotificationsListener;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
    // Override debounce delays to near-zero for testing
    (listener as any).DEBOUNCE_MS = 1;
    (listener as any).REPORT_DEBOUNCE_MS = 1;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // 1. handleTrackLiked - skips notification when prefs.likes = false
  it("handleTrackLiked: skips notification when owner disabled likes preference", async () => {
    mockPrisma.userNotificationPreference.findUnique.mockResolvedValueOnce({
      userId: "owner-1",
      likes: false,
      comments: true,
      follows: true,
      reposts: true,
    });

    const event: TrackLikedEvent = {
      trackId: "track-1",
      actorId: "user-A",
      ownerId: "owner-1",
    };

    await listener.handleTrackLiked(event);
    // Wait for any pending timers (debounce is 1ms)
    await new Promise((r) => setTimeout(r, 20));

    expect(mockNotificationsService.createNotification).not.toHaveBeenCalled();
  });

  it("handleTrackLiked: sends LIKE notification for a normal user like", async () => {
    mockPrisma.userNotificationPreference.findUnique.mockResolvedValueOnce({
      userId: "owner-1",
      likes: true,
      comments: true,
      follows: true,
      reposts: true,
    });
    mockNotificationsService.createNotification.mockResolvedValue(undefined);

    await listener.handleTrackLiked({
      trackId: "track-1",
      actorId: "user-A",
      ownerId: "owner-1",
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "owner-1",
        actorId: "user-A",
        entityType: "TRACK",
        eventType: "LIKE",
        trackId: "track-1",
      }),
    );
  });

  // 2. handleReportCreated - notifies ADMIN and MODERATOR users after debounce
  it("handleReportCreated: notifies all ADMIN and MODERATOR users after timer fires", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "mod-1" }]);
    mockNotificationsService.createNotification.mockResolvedValue(undefined);

    const event: ReportCreatedEvent = {
      reportId: "report-1",
      reporterId: "user-X",
      category: "SPAM",
      targetType: "TRACK",
      targetId: "track-1",
    };

    await listener.handleReportCreated(event);

    // Wait for the 1ms debounce to fire and async handler to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(mockPrisma.user.findMany).toHaveBeenCalled();
    expect(mockNotificationsService.createNotification).toHaveBeenCalledTimes(2);
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "admin-1" }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "mod-1" }),
    );
  });

  it("handleReportCreated: excludes reported track owner from admin/moderator fanout", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({ uploaderId: "mod-owner" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "admin-1" }]);
    mockNotificationsService.createNotification.mockResolvedValue(undefined);

    await listener.handleReportCreated({
      reportId: "report-track-owner",
      reporterId: "reporter-1",
      category: "SPAM",
      targetType: "TRACK",
      targetId: "track-owned-by-mod",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "mod-owner" },
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "admin-1" }),
    );
    expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "mod-owner" }),
    );
  });

  it("handleReportCreated: excludes reported user from admin/moderator fanout", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "admin-1" }]);
    mockNotificationsService.createNotification.mockResolvedValue(undefined);

    await listener.handleReportCreated({
      reportId: "report-user",
      reporterId: "reporter-1",
      category: "HARASSMENT",
      targetType: "USER",
      targetId: "reported-admin",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "reported-admin" },
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "reported-admin" }),
    );
  });

  // 3. Debounce - 5 rapid likes result in one notification with count=5 after timer fires
  it("handleTrackLiked: fires single notification with count=5 after 5 events debounce", async () => {
    // All prefs enabled
    mockPrisma.userNotificationPreference.findUnique.mockResolvedValue({
      userId: "owner-2",
      likes: true,
      comments: true,
      follows: true,
      reposts: true,
    });
    mockNotificationsService.createNotification.mockResolvedValue(undefined);

    const event: TrackLikedEvent = {
      trackId: "track-2",
      actorId: "user-B",
      ownerId: "owner-2",
    };

    // Fire 5 events sequentially
    for (let i = 0; i < 5; i++) {
      await listener.handleTrackLiked({ ...event, actorId: `user-${i}` });
    }

    // No notification yet (debounced - timer resets on each call)
    expect(mockNotificationsService.createNotification).not.toHaveBeenCalled();

    // Wait for the final 1ms debounce to expire and async handler to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(mockNotificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "owner-2",
        metadata: expect.objectContaining({ count: 5 }),
      }),
    );
  });
});
