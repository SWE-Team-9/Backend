import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ModerationActionType, ModerationState, ReportTargetType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  ModerateCommentDto,
  ModeratePlaylistDto,
  ModerateTrackDto,
} from "./dto/content-moderation.dto";

function stateToActionType(state: ModerationState): ModerationActionType {
  switch (state) {
    case "HIDDEN":
      return "HIDE_TRACK";
    case "REMOVED":
      return "REMOVE_TRACK";
    case "VISIBLE":
      return "RESTORE_CONTENT";
  }
}

function commentActionType(isHidden: boolean): ModerationActionType {
  return isHidden ? "HIDE_COMMENT" : "RESTORE_CONTENT";
}

function playlistStateToActionType(state: ModerationState): ModerationActionType {
  switch (state) {
    case "HIDDEN":
      return "HIDE_PLAYLIST";
    case "REMOVED":
      return "REMOVE_PLAYLIST";
    case "VISIBLE":
      return "RESTORE_CONTENT";
  }
}

@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async createNotificationSafely(payload: any): Promise<void> {
    try {
      await this.notificationsService.createNotification(payload);
    } catch (error) {
      this.logger.error(
        `Non-fatal notification failure during content moderation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  
  private async resolveModerationReportId(
    reportId?: string,
  ): Promise<string | undefined> {
    if (!reportId) {
      return undefined;
    }
    
    const report = await this.prisma.moderationReport.findUnique({
      where: { id: reportId },
      select: { id: true },
    });
    
    return report?.id;
  }

  // ─── Moderate track ──────────────────────────────────────────────────────────

  async moderateTrack(adminId: string, trackId: string, dto: ModerateTrackDto) {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        uploaderId: true,
        moderationState: true,
      },
    });

    if (!track) {
      throw new NotFoundException({
        code: "TRACK_NOT_FOUND",
        message: "Track not found.",
      });
    }

    if (track.moderationState === dto.moderationState && dto.moderationState !== "REMOVED") {
      throw new BadRequestException({
        code: "NO_STATE_CHANGE",
        message: "Track is already in this moderation state.",
      });
    }

    const previousState = track.moderationState;
    const actionType = stateToActionType(dto.moderationState);
    const moderationReportId = await this.resolveModerationReportId(dto.reportId);

    const action = await this.prisma.$transaction(async (tx) => {
      if (dto.moderationState === "REMOVED") {
        const createdAction = await tx.moderationAction.create({
          data: {
            adminId,
            targetUserId: track.uploaderId,
            actionType,
            notes: dto.reason,
            reportId: moderationReportId,
          },
        });

        await tx.report.updateMany({
          where: {
            targetType: ReportTargetType.TRACK,
            targetId: trackId,
            status: { in: ["PENDING", "UNDER_REVIEW"] },
          },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedBy: adminId,
          },
        });

        await tx.moderationReport.updateMany({
          where: {
            trackId,
            status: { in: ["PENDING", "UNDER_REVIEW"] },
          },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
          },
        });

        await tx.track.delete({ where: { id: trackId } });
        return createdAction;
      }

      await tx.track.update({
        where: { id: trackId },
        data: { moderationState: dto.moderationState },
      });

      return tx.moderationAction.create({
        data: {
          adminId,
          trackId,
          targetUserId: track.uploaderId,
          actionType,
          notes: dto.reason,
          reportId: moderationReportId,
        },
      });
    });

    return {
      action_id: action.id,
      action_type: actionType,
      track: {
        id: track.id,
        title: track.title,
        previous_state: previousState,
        new_state: dto.moderationState,
      },
      admin_id: adminId,
      notes: dto.reason,
      created_at: action.createdAt,
    };
  }

  // ─── Moderate comment ────────────────────────────────────────────────────────

  async moderateComment(adminId: string, commentId: string, dto: ModerateCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, trackId: true, moderationState: true },
    });

    if (!comment) {
      throw new NotFoundException({
        code: "COMMENT_NOT_FOUND",
        message: "Comment not found.",
      });
    }

    const newState: ModerationState = dto.isHidden ? "HIDDEN" : "VISIBLE";

    if (comment.moderationState === newState) {
      throw new BadRequestException({
        code: "NO_STATE_CHANGE",
        message: "Comment is already in this state.",
      });
    }

    const actionType = commentActionType(dto.isHidden);

    await this.prisma.comment.update({
      where: { id: commentId },
      data: { moderationState: newState },
    });

    const moderationReportId = await this.resolveModerationReportId(dto.reportId);
    
    const action = await this.prisma.moderationAction.create({
      data: {
        adminId,
        commentId,
        targetUserId: comment.userId,
        actionType,
        notes: dto.reason,
        reportId: moderationReportId,
      },
    });

    await this.createNotificationSafely({
      recipientId: comment.userId,
      actorId: adminId,
      entityType: "COMMENT",
      eventType: "REPORT_RESOLVED",
      commentId,
      metadata: { actionType, reason: dto.reason },
    });

    return {
      action_id: action.id,
      action_type: actionType,
      comment: {
        id: comment.id,
        track_id: comment.trackId,
        is_hidden: dto.isHidden,
      },
      admin_id: adminId,
      notes: dto.reason,
      created_at: action.createdAt,
    };
  }

  // ─── Moderate playlist ───────────────────────────────────────────────────────

  async moderatePlaylist(adminId: string, playlistId: string, dto: ModeratePlaylistDto) {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
      select: { id: true, title: true, ownerId: true, moderationState: true },
    });

    if (!playlist) {
      throw new NotFoundException({
        code: "PLAYLIST_NOT_FOUND",
        message: "Playlist not found.",
      });
    }

    if (playlist.moderationState === dto.moderationState) {
      throw new BadRequestException({
        code: "NO_STATE_CHANGE",
        message: "Playlist is already in this moderation state.",
      });
    }

    const previousState = playlist.moderationState;
    const actionType = playlistStateToActionType(dto.moderationState);

    await this.prisma.playlist.update({
      where: { id: playlistId },
      data: { moderationState: dto.moderationState },
    });

    const moderationReportId = await this.resolveModerationReportId(dto.reportId);
    
    const action = await this.prisma.moderationAction.create({
      data: {
        adminId,
        playlistId,
        targetUserId: playlist.ownerId,
        actionType,
        notes: dto.reason,
        reportId: moderationReportId,
      },
    });

    await this.createNotificationSafely({
      recipientId: playlist.ownerId,
      actorId: adminId,
      entityType: "PLAYLIST",
      eventType: "REPORT_RESOLVED",
      playlistId,
      metadata: { actionType, reason: dto.reason },
    });

    return {
      action_id: action.id,
      action_type: actionType,
      playlist: {
        id: playlist.id,
        title: playlist.title,
        previous_state: previousState,
        new_state: dto.moderationState,
      },
      admin_id: adminId,
      notes: dto.reason,
      created_at: action.createdAt,
    };
  }
}
