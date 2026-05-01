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

  // 1. moderateTrack - 404 when track not found
  it("moderateTrack: throws 404 when track does not exist", async () => {
    mockPrisma.track.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.moderateTrack("admin-1", "no-track", {
        moderationState: "HIDDEN",
        reason: "test violation reason here",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 2. moderateTrack - 400 NO_STATE_CHANGE when state is unchanged
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

  // 3. moderateTrack - inserts ModerationAction on success
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
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

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

  // 4. moderateTrack - emits notification to uploader
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
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

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

  // 5. moderateComment - 404 when comment not found
  it("moderateComment: throws 404 when comment does not exist", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.moderateComment("admin-1", "comment-1", {
        isHidden: true,
        reason: "Comment violates policy",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 6. moderateComment - 400 NO_STATE_CHANGE when state is unchanged
  it("moderateComment: throws 400 NO_STATE_CHANGE when state is already the same", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce({
      id: "comment-1",
      userId: "user-1",
      trackId: "track-1",
      moderationState: "HIDDEN",
    });

    await expect(
      service.moderateComment("admin-1", "comment-1", {
        isHidden: true,
        reason: "No change needed",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 7. moderateComment - success path and notification
  it("moderateComment: updates comment and emits notification", async () => {
    mockPrisma.comment.findUnique.mockResolvedValueOnce({
      id: "comment-1",
      userId: "user-1",
      trackId: "track-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.comment.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-3",
      actionType: "HIDE_COMMENT",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

    const result = await service.moderateComment("admin-1", "comment-1", {
      isHidden: true,
      reason: "Comment violates policy",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: "admin-1",
          commentId: "comment-1",
          actionType: "HIDE_COMMENT",
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "user-1",
        entityType: "COMMENT",
        eventType: "REPORT_RESOLVED",
      }),
    );
    expect(result.action_type).toBe("HIDE_COMMENT");
  });

  // 8. moderatePlaylist - 404 when playlist not found
  it("moderatePlaylist: throws 404 when playlist does not exist", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.moderatePlaylist("admin-1", "playlist-1", {
        moderationState: "HIDDEN",
        reason: "Playlist violates policy",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  // 9. moderatePlaylist - 400 NO_STATE_CHANGE when state is unchanged
  it("moderatePlaylist: throws 400 NO_STATE_CHANGE when state is already the same", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce({
      id: "playlist-1",
      title: "My Playlist",
      ownerId: "user-1",
      moderationState: "HIDDEN",
    });

    await expect(
      service.moderatePlaylist("admin-1", "playlist-1", {
        moderationState: "HIDDEN",
        reason: "No change needed",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // 10. moderatePlaylist - success path and notification
  it("moderatePlaylist: updates playlist and emits notification", async () => {
    mockPrisma.playlist.findUnique.mockResolvedValueOnce({
      id: "playlist-1",
      title: "My Playlist",
      ownerId: "user-1",
      moderationState: "VISIBLE",
    });
    mockPrisma.playlist.update.mockResolvedValueOnce({});
    mockPrisma.moderationAction.create.mockResolvedValueOnce({
      id: "action-4",
      actionType: "REMOVE_PLAYLIST",
      createdAt: new Date(),
    });
    mockNotificationsService.createNotification.mockResolvedValueOnce(undefined);

    const result = await service.moderatePlaylist("admin-1", "playlist-1", {
      moderationState: "REMOVED",
      reason: "Playlist violates policy",
    });

    expect(mockPrisma.moderationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          adminId: "admin-1",
          playlistId: "playlist-1",
          actionType: "REMOVE_PLAYLIST",
        }),
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: "user-1",
        entityType: "PLAYLIST",
        eventType: "REPORT_RESOLVED",
      }),
    );
    expect(result.action_type).toBe("REMOVE_PLAYLIST");
  });
});
