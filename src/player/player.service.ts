import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { TrackStatus, TrackVisibility } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PlayerService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. GET /player/tracks/:trackId/source
  async getPlaybackSource(userId: string | null, trackId: string) {
    const track = await this.findTrackOrFail(trackId);

    if (track.status === TrackStatus.PROCESSING) {
      throw new ConflictException({
        code: "TRACK_PROCESSING",
        message: "Track is still processing and cannot be played yet.",
      });
    }

    if (track.status !== TrackStatus.FINISHED) {
      throw new NotFoundException({
        code: "TRACK_NOT_AVAILABLE",
        message: "Track is not available for playback.",
      });
    }

    if (
      track.visibility === TrackVisibility.PRIVATE &&
      track.uploaderId !== userId
    ) {
      throw new ForbiddenException({
        code: "TRACK_ACCESS_DENIED",
        message: "This track is private.",
      });
    }

    const streamFile = await this.prisma.trackFile.findFirst({
      where: { trackId, fileRole: "STREAM", isCurrent: true },
      select: { storageKey: true },
    });

    return {
      trackId,
      streamUrl: streamFile?.storageKey ?? null,
      accessState: "PLAYABLE",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  // 2. GET /player/tracks/:trackId/state
  async getPlaybackState(trackId: string) {
    const track = await this.findTrackOrFail(trackId);

    let accessState: string;
    let reason: string | null = null;

    if (track.status === TrackStatus.PROCESSING) {
      accessState = "PROCESSING";
      reason = "Track is still being processed";
    } else if (track.status !== TrackStatus.FINISHED) {
      accessState = "BLOCKED";
      reason = "Track is not available";
    } else if (track.accessLevel === "BLOCKED") {
      accessState = "BLOCKED";
      reason = "Premium subscription required";
    } else if (track.accessLevel === "PREVIEW") {
      accessState = "PREVIEW";
      reason = "Only preview available";
    } else {
      accessState = "PLAYABLE";
    }

    return { trackId, accessState, reason };
  }

  // 3. POST /player/tracks/:trackId/progress
  async registerProgress(
    userId: string,
    trackId: string,
    positionSeconds: number,
    durationSeconds: number,
    isCompleted: boolean,
  ) {
    await this.findTrackOrFail(trackId);

    await this.prisma.playbackProgress.upsert({
      where: { userId_trackId: { userId, trackId } },
      update: { positionSeconds, durationSeconds, isCompleted },
      create: { userId, trackId, positionSeconds, durationSeconds, isCompleted },
    });

    return {
      message: "Playback progress saved successfully",
      trackId,
      positionSeconds,
    };
  }

  // 4. POST /player/tracks/:trackId/play
  async markPlayed(userId: string, trackId: string) {
    await this.findTrackOrFail(trackId);

    await this.prisma.playEvent.create({
      data: {
        userId,
        trackId,
        source: "TRACK",
        deviceType: "WEB",
      },
    });

    const playCount = await this.prisma.playEvent.count({ where: { trackId } });

    return {
      message: "Play event recorded successfully",
      trackId,
      playCount,
    };
  }

  // 5. GET /player/history/recent
  async getRecentlyPlayed(userId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const recentEvents = await this.prisma.playEvent.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      distinct: ["trackId"],
      skip,
      take,
      select: {
        trackId: true,
        startedAt: true,
        track: {
          select: {
            id: true,
            title: true,
            uploader: {
              select: {
                id: true,
                profile: {
                  select: { displayName: true },
                },
              },
            },
          },
        },
      },
    });

    // Count total distinct tracks played by user
    const distinctTracks = await this.prisma.playEvent.findMany({
      where: { userId },
      distinct: ["trackId"],
      select: { trackId: true },
    });
    const total = distinctTracks.length;

    // Get progress for each track
    const trackIds = recentEvents.map((e) => e.trackId);
    const progressRecords = await this.prisma.playbackProgress.findMany({
      where: { userId, trackId: { in: trackIds } },
      select: { trackId: true, positionSeconds: true },
    });
    const progressMap = new Map(
      progressRecords.map((p) => [p.trackId, p.positionSeconds]),
    );

    return {
      page,
      limit: take,
      total,
      tracks: recentEvents.map((event) => ({
        trackId: event.trackId,
        title: event.track.title,
        artist: {
          id: event.track.uploader.id,
          display_name: event.track.uploader.profile?.displayName ?? null,
        },
        lastPlayedAt: event.startedAt,
        lastPositionSeconds: progressMap.get(event.trackId) ?? 0,
      })),
    };
  }

  // 6. GET /player/history
  async getHistory(userId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where = { userId };

    const [total, events] = await this.prisma.$transaction([
      this.prisma.playEvent.count({ where }),
      this.prisma.playEvent.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take,
        select: {
          trackId: true,
          startedAt: true,
          track: {
            select: {
              title: true,
              durationMs: true,
            },
          },
        },
      }),
    ]);

    // Get progress for each track
    const trackIds = [...new Set(events.map((e) => e.trackId))];
    const progressRecords = await this.prisma.playbackProgress.findMany({
      where: { userId, trackId: { in: trackIds } },
      select: {
        trackId: true,
        positionSeconds: true,
        durationSeconds: true,
        isCompleted: true,
      },
    });
    const progressMap = new Map(
      progressRecords.map((p) => [p.trackId, p]),
    );

    return {
      page,
      limit: take,
      total,
      history: events.map((event) => {
        const progress = progressMap.get(event.trackId);
        return {
          trackId: event.trackId,
          title: event.track.title,
          playedAt: event.startedAt,
          positionSeconds: progress?.positionSeconds ?? 0,
          durationSeconds:
            progress?.durationSeconds ??
            (event.track.durationMs
              ? Math.round(event.track.durationMs / 1000)
              : 0),
          isCompleted: progress?.isCompleted ?? false,
        };
      }),
    };
  }

  // 7. DELETE /player/history
  async clearHistory(userId: string) {
    await this.prisma.playEvent.deleteMany({ where: { userId } });
    return { message: "Listening history cleared successfully" };
  }

  // 8. GET /player/tracks/:trackId/resume
  async getResumePosition(userId: string, trackId: string) {
    await this.findTrackOrFail(trackId);

    const progress = await this.prisma.playbackProgress.findUnique({
      where: { userId_trackId: { userId, trackId } },
      select: { positionSeconds: true },
    });

    return {
      trackId,
      resumePositionSeconds: progress?.positionSeconds ?? 0,
    };
  }

  // 9. GET /player/session
  async getSession(userId: string) {
    const session = await this.prisma.playerSession.findUnique({
      where: { userId },
      select: {
        currentTrackId: true,
        positionSeconds: true,
        isPlaying: true,
        volume: true,
        queueTrackIds: true,
        currentTrack: {
          select: { id: true, title: true },
        },
      },
    });

    if (!session) {
      return {
        currentTrack: null,
        positionSeconds: 0,
        isPlaying: false,
        volume: 0.8,
        queue: [],
      };
    }

    let queue: { trackId: string; title: string }[] = [];
    if (session.queueTrackIds.length > 0) {
      const tracks = await this.prisma.track.findMany({
        where: { id: { in: session.queueTrackIds } },
        select: { id: true, title: true },
      });
      const trackMap = new Map(tracks.map((t) => [t.id, t]));
      queue = session.queueTrackIds
        .map((id) => trackMap.get(id))
        .filter((t): t is { id: string; title: string } => t != null)
        .map((t) => ({ trackId: t.id, title: t.title }));
    }

    return {
      currentTrack: session.currentTrack
        ? { trackId: session.currentTrack.id, title: session.currentTrack.title }
        : null,
      positionSeconds: session.positionSeconds,
      isPlaying: session.isPlaying,
      volume: session.volume,
      queue,
    };
  }

  // 10. PUT /player/session
  async updateSession(
    userId: string,
    body: {
      currentTrackId?: string;
      positionSeconds?: number;
      isPlaying?: boolean;
      volume?: number;
      queueTrackIds?: string[];
    },
  ) {
    await this.prisma.playerSession.upsert({
      where: { userId },
      update: {
        ...(body.currentTrackId !== undefined && {
          currentTrackId: body.currentTrackId,
        }),
        ...(body.positionSeconds !== undefined && {
          positionSeconds: body.positionSeconds,
        }),
        ...(body.isPlaying !== undefined && { isPlaying: body.isPlaying }),
        ...(body.volume !== undefined && { volume: body.volume }),
        ...(body.queueTrackIds !== undefined && {
          queueTrackIds: body.queueTrackIds,
        }),
      },
      create: {
        userId,
        currentTrackId: body.currentTrackId ?? null,
        positionSeconds: body.positionSeconds ?? 0,
        isPlaying: body.isPlaying ?? false,
        volume: body.volume ?? 0.8,
        queueTrackIds: body.queueTrackIds ?? [],
      },
    });

    return { message: "Player session updated successfully" };
  }

  // 11. GET /player/tracks/:trackId/preview
  async getTrackPreview(trackId: string) {
    await this.findTrackOrFail(trackId);

    const previewFile = await this.prisma.trackFile.findFirst({
      where: { trackId, fileRole: "PREVIEW", isCurrent: true },
      select: { storageKey: true },
    });

    return {
      trackId,
      previewUrl: previewFile?.storageKey ?? null,
      previewDurationSeconds: 30,
      accessState: "PREVIEW",
    };
  }

  private async findTrackOrFail(trackId: string) {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        uploaderId: true,
        title: true,
        status: true,
        visibility: true,
        accessLevel: true,
        durationMs: true,
      },
    });

    if (!track) {
      throw new NotFoundException({
        code: "TRACK_NOT_FOUND",
        message: "Track not found.",
      });
    }

    return track;
  }
}
