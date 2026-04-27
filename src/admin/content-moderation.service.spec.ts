import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ContentModerationService } from "./content-moderation.service";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const mockPrisma = {
  track: { findUnique: jest.fn(), update: jest.fn() },
  comment: { findUnique: jest.fn(), update: jest.fn() },
  playlist: { findUnique: jest.fn(), update: jest.fn() },
  moderationAction: { create: jest.fn() },
};

const mockNotificationsService = {
  createNotification: jest.fn(),
};

describe("ContentModerationService", () => {
  let service: ContentModerationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentModerationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<ContentModerationService>(ContentModerationService);
    jest.clearAllMocks();
  });

  // 1. moderateTrack — 404 when track not found
  it("moderateTrack: throws 404 when track does not exist", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.moderateTrack("admin-1", "no-track", {
        moderationState: "HIDDEN",
        reason: "test violation reason here",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 2. moderateTrack — 400 NO_STATE_CHANGE when state is unchanged
  it("moderateTrack: throws 400 NO_STATE_CHANGE when state is already the same", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-1",
      title: "My Track",
      uploaderId: "user-1",
      moderationState: "HIDDEN",
    });
    await expect(
      service.moderateTrack("admin-1", "track-1", {
        moderationState: "HIDDEN",
        reason: "test reason no change",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 3. moderateTrack — inserts ModerationAction on success
  it("moderateTrack: inserts ModerationAction when state changes", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-1",
      title: "My Track",
      uploaderId: "user-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.track.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-1",
      actionType: "HIDE_TRACK",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(
      undefined,
    );

    const result = await service.moderateTrack("admin-1", "track-1", {
      moderationState: "HIDDEN",
      reason: "This content violates community guidelines.",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: "admin-1",
          trackId: "track-1",
          actionType: "HIDE_TRACK",
        }),
      }),
    );
    expect(result.action_type).toBe("HIDE_TRACK");
  });

  // 4. moderateTrack — emits notification to uploader
  it("moderateTrack: emits REPORT_RESOLVED notification to track uploader", async () => {
    const uploaderId = "uploader-X";
    mockPrisma.track.findUnique.mockResolvedValueOnce({
      id: "track-2",
      title: "Other Track",
      uploaderId,
      moderationState: "VISIBLE",
    });
    mockPrisma.track.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-2",
      actionType: "REMOVE_TRACK",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(
      undefined,
    );

    await service.moderateTrack("admin-1", "track-2", {
      moderationState: "REMOVED",
      reason: "Serious policy violation requiring removal.",
    });

    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: uploaderId,
        eventType: "REPORT_RESOLVED",
        entityType: "TRACK",
      }),
    );
  });
});
