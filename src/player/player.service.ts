import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TrackStatus, TrackVisibility } from "@prisma/client";

import { LoadQueueDto } from "./dto/load-queue.dto";

import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../common/storage/storage.service";
import { EntitlementsService } from "../entitlements/entitlements.service";

/** Default TTL for presigned audio stream URLs (1 hour). */
const STREAM_URL_TTL_SECONDS = 3600;

@Injectable()
export class PlayerService {
  private readonly storageProvider: "local" | "s3";
  private readonly localUploadUrl: string;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly cdnUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storageService: StorageService,
    private readonly entitlements: EntitlementsService,
  ) {
    this.storageProvider = this.config.get<"local" | "s3">("storage.provider", "local");
    this.localUploadUrl = this.config.get<string>(
      "storage.localUploadUrl",
      "http://localhost:3000/uploads",
    );
    this.s3Bucket = this.config.get<string>("storage.s3Bucket", "");
    this.s3Region = this.config.get<string>("storage.s3Region", "us-east-1");
    this.cdnUrl = this.config.get<string>("storage.cdnUrl", "");
  }

  /**
   * Build a stream URL for a stored audio file.
   *
   * For S3: generates a short-lived presigned GET URL (STREAM_URL_TTL_SECONDS).
   * This means clients cannot cache or share the URL beyond the TTL - the only
   * way to get a fresh URL is to call this endpoint again with a valid token.
   *
   * For local storage: returns a plain URL under /uploads/tracks/ which is
   * protected by the JWT auth middleware registered in main.ts.
   */
  private async buildStreamUrl(storageKey: string): Promise<string> {
    if (this.storageService.isS3) {
      return this.storageService.getPresignedUrl(storageKey, STREAM_URL_TTL_SECONDS);
    }
    return this.buildFileUrl(storageKey);
  }

  /** Convert a storage key like `tracks/abc.mp3` into a full URL. */
  private buildFileUrl(storageKey: string): string {
    if (this.storageProvider === "s3") {
      if (this.cdnUrl) {
        return `${this.cdnUrl.replace(/\/+$/, "")}/${storageKey}`;
      }
      return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${storageKey}`;
    }
    return `${this.localUploadUrl.replace(/\/+$/, "")}/${storageKey}`;
  }

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

    if (track.visibility === TrackVisibility.PRIVATE && track.uploaderId !== userId) {
      throw new ForbiddenException({
        code: "TRACK_ACCESS_DENIED",
        message: "This track is private.",
      });
    }

    const streamFile = await this.prisma.trackFile.findFirst({
      where: { trackId, fileRole: "STREAM", isCurrent: true },
      select: { storageKey: true },
    });

    // Fall back to the ORIGINAL upload when transcoding hasn't produced a STREAM file yet
    const file =
      streamFile ??
      (await this.prisma.trackFile.findFirst({
        where: { trackId, fileRole: "ORIGINAL", isCurrent: true },
        select: { storageKey: true },
      }));

    return {
      trackId,
      streamUrl: file ? await this.buildStreamUrl(file.storageKey) : null,
      accessState: "PLAYABLE",
      // For S3, expiresAt reflects the presigned URL TTL (real server-side expiry).
      // For local storage, the /uploads/tracks auth middleware re-validates the
      // access token on every request so there is no fixed expiry to advertise.
      expiresAt: new Date(Date.now() + STREAM_URL_TTL_SECONDS * 1000).toISOString(),
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
      create: {
        userId,
        trackId,
        positionSeconds,
        durationSeconds,
        isCompleted,
      },
    });

    return {
      message: "Playback progress saved successfully",
      trackId,
      positionSeconds,
    };
  }

  // 4. POST /player/tracks/:trackId/play
  async markPlayed(userId: string, trackId: string, playlistId?: string) {
    await this.findTrackOrFail(trackId);

    let normalizedPlaylistId: string | null = null;
    if (playlistId) {
      const playlist = await this.prisma.playlist.findFirst({
        where: {
          id: playlistId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!playlist) {
        throw new NotFoundException({
          code: "PLAYLIST_NOT_FOUND",
          message: "Playlist not found.",
        });
      }

      normalizedPlaylistId = playlist.id;
    }

    await this.prisma.playEvent.create({
      data: {
        userId,
        trackId,
        ...(normalizedPlaylistId ? { playlistId: normalizedPlaylistId } : {}),
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
    const progressMap = new Map(progressRecords.map((p) => [p.trackId, p.positionSeconds]));

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
    const progressMap = new Map(progressRecords.map((p) => [p.trackId, p]));

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
            (event.track.durationMs ? Math.round(event.track.durationMs / 1000) : 0),
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
        shuffle: true,
        repeatMode: true,
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
        shuffle: false,
        repeatMode: "OFF",
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
        ? {
            trackId: session.currentTrack.id,
            title: session.currentTrack.title,
          }
        : null,
      positionSeconds: session.positionSeconds,
      isPlaying: session.isPlaying,
      volume: session.volume,
      queue,
      shuffle: session.shuffle,
      repeatMode: session.repeatMode,
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
      shuffle?: boolean;
      repeatMode?: string;
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
        ...(body.shuffle !== undefined && { shuffle: body.shuffle }),
        ...(body.repeatMode !== undefined && {
          repeatMode: body.repeatMode as any,
        }),
      },
      create: {
        userId,
        currentTrackId: body.currentTrackId ?? null,
        positionSeconds: body.positionSeconds ?? 0,
        isPlaying: body.isPlaying ?? false,
        volume: body.volume ?? 0.8,
        queueTrackIds: body.queueTrackIds ?? [],
        shuffle: body.shuffle ?? false,
        repeatMode: (body.repeatMode as any) ?? "OFF",
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

    // Preview clips are @Public() - they're intentionally accessible to unauthenticated
    // users (free-tier 30-second previews). Return a proper URL, not the raw storage key.
    // For local storage, /uploads/previews/ is served as a public static route.
    // For S3, use a public CDN/S3 URL (not presigned) since these are meant for all users.
    return {
      trackId,
      previewUrl: previewFile ? this.buildFileUrl(previewFile.storageKey) : null,
      previewDurationSeconds: 30,
      accessState: "PREVIEW",
    };
  }

  // -- Queue management

  /** Ads injected every N real tracks (MVP: static, no audio URL). */
  private readonly AD_EVERY_N_TRACKS = 3;

  private readonly STATIC_ADS = [
    {
      adId: "ad_001",
      title: "Upgrade to IQA3 Premium - No Ads",
      durationSeconds: 15,
      clickUrl: null as string | null,
    },
    {
      adId: "ad_002",
      title: "Share your music on IQA3",
      durationSeconds: 15,
      clickUrl: null as string | null,
    },
  ] as const;

  private getNextAd() {
    return this.STATIC_ADS[Math.floor(Math.random() * this.STATIC_ADS.length)];
  }

  /** Returns true when the user is on the FREE plan and should receive ads. */
  private async userAdsEnabled(userId: string): Promise<boolean> {
    const { adsEnabled } = await this.entitlements.getUserEntitlements(userId);
    return adsEnabled;
  }

  /** Lightweight track metadata used in queue/next/prev responses. */
  private async buildQueueTrackMetadata(trackId: string) {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        durationMs: true,
        coverArtUrl: true,
        uploader: {
          select: {
            id: true,
            profile: {
              select: { displayName: true, handle: true, avatarUrl: true },
            },
          },
        },
        primaryGenre: { select: { name: true } },
      },
    });

    if (!track) return null;

    return {
      trackId: track.id,
      title: track.title,
      artist:
        track.uploader.profile?.displayName ?? track.uploader.profile?.handle ?? "Unknown Artist",
      artistId: track.uploader.id,
      artistHandle: track.uploader.profile?.handle ?? null,
      artistAvatarUrl: track.uploader.profile?.avatarUrl ?? null,
      cover: track.coverArtUrl ?? null,
      duration: track.durationMs ? Math.round(track.durationMs / 1000) : null,
      genre: track.primaryGenre?.name ?? null,
    };
  }

  // 12. POST /player/queue/load
  async loadQueueContext(userId: string, dto: LoadQueueDto) {
    let trackIds: string[] = [];

    switch (dto.contextType) {
      case "TRACK": {
        if (!dto.startTrackId) {
          throw new BadRequestException("startTrackId is required for TRACK context");
        }
        await this.findTrackOrFail(dto.startTrackId);
        trackIds = [dto.startTrackId];
        break;
      }

      case "PLAYLIST": {
        if (!dto.contextId) {
          throw new BadRequestException("contextId (playlistId) is required for PLAYLIST context");
        }
        const playlist = await this.prisma.playlist.findFirst({
          where: { id: dto.contextId, deletedAt: null },
          select: {
            tracks: {
              where: {
                track: {
                  status: TrackStatus.FINISHED,
                  visibility: TrackVisibility.PUBLIC,
                  deletedAt: null,
                },
              },
              orderBy: { position: "asc" },
              select: { trackId: true },
            },
          },
        });
        if (!playlist) {
          throw new NotFoundException({
            code: "PLAYLIST_NOT_FOUND",
            message: "Playlist not found.",
          });
        }
        trackIds = playlist.tracks.map((t) => t.trackId);
        break;
      }

      case "ARTIST": {
        if (!dto.contextId) {
          throw new BadRequestException("contextId (artistUserId) is required for ARTIST context");
        }
        const tracks = await this.prisma.track.findMany({
          where: {
            uploaderId: dto.contextId,
            status: TrackStatus.FINISHED,
            visibility: TrackVisibility.PUBLIC,
            deletedAt: null,
          },
          orderBy: { publishedAt: "desc" },
          select: { id: true },
          take: 100,
        });
        trackIds = tracks.map((t) => t.id);
        break;
      }

      case "CONTEXT_IDS": {
        if (!dto.trackIds?.length) {
          throw new BadRequestException("trackIds is required for CONTEXT_IDS context");
        }
        trackIds = dto.trackIds;
        break;
      }
    }

    if (!trackIds.length) {
      throw new BadRequestException("No playable tracks found for the given context");
    }

    // Server-side shuffle
    if (dto.shuffle) {
      for (let i = trackIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [trackIds[i], trackIds[j]] = [trackIds[j], trackIds[i]];
      }
    }

    // Determine start index
    let startIndex = 0;
    if (dto.startTrackId) {
      const idx = trackIds.indexOf(dto.startTrackId);
      if (idx >= 0) startIndex = idx;
    }

    await this.prisma.playerSession.upsert({
      where: { userId },
      update: {
        queueTrackIds: trackIds,
        currentQueueIndex: startIndex,
        realTracksSinceLastAd: 0,
        queueContext: { type: dto.contextType, id: dto.contextId ?? null },
        shuffle: dto.shuffle ?? false,
        currentTrackId: trackIds[startIndex],
      },
      create: {
        userId,
        queueTrackIds: trackIds,
        currentQueueIndex: startIndex,
        realTracksSinceLastAd: 0,
        queueContext: { type: dto.contextType, id: dto.contextId ?? null },
        shuffle: dto.shuffle ?? false,
        currentTrackId: trackIds[startIndex],
      },
    });

    const [startTrack, shouldShowAds] = await Promise.all([
      this.buildQueueTrackMetadata(trackIds[startIndex]),
      this.userAdsEnabled(userId),
    ]);

    return {
      currentTrack: startTrack,
      currentIndex: startIndex,
      queueLength: trackIds.length,
      tracksUntilAd: shouldShowAds ? this.AD_EVERY_N_TRACKS : null,
    };
  }

  // 13. POST /player/queue/next
  async getNextTrackInQueue(userId: string) {
    const [session, shouldShowAds] = await Promise.all([
      this.prisma.playerSession.findUnique({ where: { userId } }),
      this.userAdsEnabled(userId),
    ]);

    if (!session?.queueTrackIds.length) {
      throw new NotFoundException({
        code: "NO_QUEUE",
        message: "No queue loaded. Call POST /player/queue/load first.",
      });
    }

    const { queueTrackIds, currentQueueIndex, realTracksSinceLastAd, repeatMode } = session;

    // Inject ad every AD_EVERY_N_TRACKS real tracks (FREE plan users only)
    if (
      shouldShowAds &&
      realTracksSinceLastAd > 0 &&
      realTracksSinceLastAd % this.AD_EVERY_N_TRACKS === 0
    ) {
      await this.prisma.playerSession.update({
        where: { userId },
        data: { realTracksSinceLastAd: 0 },
      });

      return {
        type: "AD" as const,
        ad: this.getNextAd(),
        currentIndex: currentQueueIndex,
        queueLength: queueTrackIds.length,
        tracksUntilAd: this.AD_EVERY_N_TRACKS,
      };
    }

    // Advance to next track
    const isLastTrack = currentQueueIndex >= queueTrackIds.length - 1;
    let nextIndex: number;

    if (isLastTrack) {
      if (repeatMode === "ALL") {
        nextIndex = 0;
      } else {
        // Queue ended (OFF or ONE - user pressed NEXT explicitly, so advance past)
        return {
          type: "ENDED" as const,
          currentIndex: currentQueueIndex,
          queueLength: queueTrackIds.length,
        };
      }
    } else {
      nextIndex = currentQueueIndex + 1;
    }

    // PRO/GO_PLUS users: keep counter at 0 (ads never fire)
    const newRealTracksSinceLastAd = shouldShowAds ? realTracksSinceLastAd + 1 : 0;
    const nextTrackId = queueTrackIds[nextIndex];

    await this.prisma.playerSession.update({
      where: { userId },
      data: {
        currentQueueIndex: nextIndex,
        currentTrackId: nextTrackId,
        realTracksSinceLastAd: newRealTracksSinceLastAd,
      },
    });

    const trackMetadata = await this.buildQueueTrackMetadata(nextTrackId);
    if (!trackMetadata) {
      throw new NotFoundException({
        code: "TRACK_NOT_FOUND",
        message: "Next track in queue no longer exists.",
      });
    }

    return {
      type: "TRACK" as const,
      track: trackMetadata,
      currentIndex: nextIndex,
      queueLength: queueTrackIds.length,
      tracksUntilAd: shouldShowAds ? this.AD_EVERY_N_TRACKS - newRealTracksSinceLastAd : null,
    };
  }

  // 14. POST /player/queue/previous
  async getPreviousTrackInQueue(userId: string) {
    const session = await this.prisma.playerSession.findUnique({
      where: { userId },
    });

    if (!session?.queueTrackIds.length) {
      throw new NotFoundException({
        code: "NO_QUEUE",
        message: "No queue loaded. Call POST /player/queue/load first.",
      });
    }

    const { queueTrackIds, currentQueueIndex, repeatMode } = session;

    let prevIndex: number;
    if (currentQueueIndex <= 0) {
      prevIndex = repeatMode === "ALL" ? queueTrackIds.length - 1 : 0;
    } else {
      prevIndex = currentQueueIndex - 1;
    }

    const prevTrackId = queueTrackIds[prevIndex];

    await this.prisma.playerSession.update({
      where: { userId },
      data: { currentQueueIndex: prevIndex, currentTrackId: prevTrackId },
    });

    const trackMetadata = await this.buildQueueTrackMetadata(prevTrackId);
    if (!trackMetadata) {
      throw new NotFoundException({
        code: "TRACK_NOT_FOUND",
        message: "Previous track in queue no longer exists.",
      });
    }

    return {
      type: "TRACK" as const,
      track: trackMetadata,
      currentIndex: prevIndex,
      queueLength: queueTrackIds.length,
    };
  }

  // 15. GET /player/queue
  async getQueueState(userId: string) {
    const [session, shouldShowAds] = await Promise.all([
      this.prisma.playerSession.findUnique({ where: { userId } }),
      this.userAdsEnabled(userId),
    ]);

    if (!session?.queueTrackIds.length) {
      return {
        queue: [],
        currentIndex: 0,
        queueLength: 0,
        tracksUntilAd: shouldShowAds ? this.AD_EVERY_N_TRACKS : null,
        shuffle: false,
        repeatMode: "OFF",
      };
    }

    // Cap display at 100 to avoid huge responses
    const displayIds = session.queueTrackIds.slice(0, 100);

    const tracks = await this.prisma.track.findMany({
      where: { id: { in: displayIds } },
      select: {
        id: true,
        title: true,
        durationMs: true,
        coverArtUrl: true,
        uploader: {
          select: {
            id: true,
            profile: {
              select: { displayName: true, handle: true, avatarUrl: true },
            },
          },
        },
        primaryGenre: { select: { name: true } },
      },
    });

    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    const queue = displayIds
      .map((id) => {
        const t = trackMap.get(id);
        if (!t) return null;
        return {
          trackId: t.id,
          title: t.title,
          artist: t.uploader.profile?.displayName ?? t.uploader.profile?.handle ?? "Unknown Artist",
          artistId: t.uploader.id,
          artistHandle: t.uploader.profile?.handle ?? null,
          artistAvatarUrl: t.uploader.profile?.avatarUrl ?? null,
          cover: t.coverArtUrl ?? null,
          duration: t.durationMs ? Math.round(t.durationMs / 1000) : null,
          genre: t.primaryGenre?.name ?? null,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    return {
      queue,
      currentIndex: session.currentQueueIndex,
      queueLength: session.queueTrackIds.length,
      tracksUntilAd: shouldShowAds
        ? this.AD_EVERY_N_TRACKS - (session.realTracksSinceLastAd % this.AD_EVERY_N_TRACKS)
        : null,
      shuffle: session.shuffle,
      repeatMode: session.repeatMode,
    };
  }

  // 16. POST /player/queue/jump
  async jumpToTrackInQueue(userId: string, trackId: string) {
    const [session, shouldShowAds] = await Promise.all([
      this.prisma.playerSession.findUnique({ where: { userId } }),
      this.userAdsEnabled(userId),
    ]);

    if (!session?.queueTrackIds.length) {
      throw new NotFoundException({
        code: "NO_QUEUE",
        message: "No queue loaded. Call POST /player/queue/load first.",
      });
    }

    const index = session.queueTrackIds.indexOf(trackId);
    if (index === -1) {
      throw new NotFoundException({
        code: "TRACK_NOT_IN_QUEUE",
        message: "Track is not in the current queue.",
      });
    }

    await this.prisma.playerSession.update({
      where: { userId },
      data: {
        currentQueueIndex: index,
        currentTrackId: trackId,
        realTracksSinceLastAd: 0,
      },
    });

    const trackMetadata = await this.buildQueueTrackMetadata(trackId);

    return {
      type: "TRACK" as const,
      track: trackMetadata,
      currentIndex: index,
      queueLength: session.queueTrackIds.length,
      tracksUntilAd: shouldShowAds ? this.AD_EVERY_N_TRACKS : null,
    };
  }

  // -- Private helpers

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
