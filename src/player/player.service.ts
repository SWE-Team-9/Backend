import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrackStatus, TrackVisibility } from '@prisma/client';

import { LoadQueueDto } from './dto/load-queue.dto';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { EntitlementsService } from '../entitlements/entitlements.service';

/** Default TTL for presigned audio stream URLs (1 hour). */
const STREAM_URL_TTL_SECONDS = 3600;

@Injectable()
export class PlayerService {
  private readonly storageProvider: 'local' | 's3';
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
    this.storageProvider = this.config.get<'local' | 's3'>('storage.provider', 'local');
    this.localUploadUrl = this.config.get<string>(
      'storage.localUploadUrl',
      'http://localhost:3000/uploads',
    );
    this.s3Bucket = this.config.get<string>('storage.s3Bucket', '');
    this.s3Region = this.config.get<string>('storage.s3Region', 'us-east-1');
    this.cdnUrl = this.config.get<string>('storage.cdnUrl', '');
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
    if (this.storageProvider === 's3') {
      if (this.cdnUrl) {
        return `${this.cdnUrl.replace(/\/+$/, '')}/${storageKey}`;
      }
      return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${storageKey}`;
    }
    return `${this.localUploadUrl.replace(/\/+$/, '')}/${storageKey}`;
  }

  // 1. GET /player/tracks/:trackId/source
  async getPlaybackSource(userId: string | null, trackId: string) {
    const track = await this.findTrackOrFail(trackId);

    if (track.status === TrackStatus.PROCESSING) {
      throw new ConflictException({
        code: 'TRACK_PROCESSING',
        message: 'Track is still processing and cannot be played yet.',
      });
    }

    if (track.status !== TrackStatus.FINISHED) {
      throw new NotFoundException({
        code: 'TRACK_NOT_AVAILABLE',
        message: 'Track is not available for playback.',
      });
    }

    if (track.visibility === TrackVisibility.PRIVATE && track.uploaderId !== userId) {
      throw new ForbiddenException({
        code: 'TRACK_ACCESS_DENIED',
        message: 'This track is private.',
      });
    }

    // Hard ad gate: when an ad is pending, do not issue any playable source URL.
    // This prevents direct track taps from bypassing the non-skippable ad flow.
    if (userId) {
      const [shouldShowAds, session] = await Promise.all([
        this.userAdsEnabled(userId),
        this.prisma.playerSession.findUnique({
          where: { userId },
          select: { adRequired: true },
        }),
      ]);

      if (shouldShowAds && session?.adRequired) {
        throw new ConflictException({
          code: 'AD_REQUIRED',
          message: 'Complete the required ad before playing another track.',
          ad: this.getNextAd(),
          canSkip: false,
        });
      }
    }

    const streamFile = await this.prisma.trackFile.findFirst({
      where: { trackId, fileRole: 'STREAM', isCurrent: true },
      select: { storageKey: true },
    });

    // Fall back to the ORIGINAL upload when transcoding hasn't produced a STREAM file yet
    const file =
      streamFile ??
      (await this.prisma.trackFile.findFirst({
        where: { trackId, fileRole: 'ORIGINAL', isCurrent: true },
        select: { storageKey: true },
      }));

    return {
      trackId,
      streamUrl: file ? await this.buildStreamUrl(file.storageKey) : null,
      accessState: 'PLAYABLE',
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
      accessState = 'PROCESSING';
      reason = 'Track is still being processed';
    } else if (track.status !== TrackStatus.FINISHED) {
      accessState = 'BLOCKED';
      reason = 'Track is not available';
    } else if (track.accessLevel === 'BLOCKED') {
      accessState = 'BLOCKED';
      reason = 'Premium subscription required';
    } else if (track.accessLevel === 'PREVIEW') {
      accessState = 'PREVIEW';
      reason = 'Only preview available';
    } else {
      accessState = 'PLAYABLE';
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

    // Backfill completionRatio on the most recent PlayEvent for this user+track
    // so that analytics can count completed plays (completionRatio >= 0.90).
    if (durationSeconds > 0) {
      const ratio = positionSeconds / durationSeconds;
      const recentEvent = await this.prisma.playEvent.findFirst({
        where: { userId, trackId },
        orderBy: { startedAt: 'desc' },
        select: { id: true },
      });

      if (recentEvent) {
        await this.prisma.playEvent.update({
          where: { id: recentEvent.id },
          data: { completionRatio: ratio },
        });
      }
    }

    return {
      message: 'Playback progress saved successfully',
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
          code: 'PLAYLIST_NOT_FOUND',
          message: 'Playlist not found.',
        });
      }

      normalizedPlaylistId = playlist.id;
    }

    await this.prisma.playEvent.create({
      data: {
        userId,
        trackId,
        ...(normalizedPlaylistId ? { playlistId: normalizedPlaylistId } : {}),
        source: 'TRACK',
        deviceType: 'WEB',
      },
    });

    const playCount = await this.prisma.playEvent.count({ where: { trackId } });

    return {
      message: 'Play event recorded successfully',
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
      orderBy: { startedAt: 'desc' },
      distinct: ['trackId'],
      skip,
      take,
      select: {
        trackId: true,
        startedAt: true,
        track: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverArtUrl: true,
            durationMs: true,
            waveformData: true,
            _count: { select: { likes: true, reposts: true } },
            uploader: {
              select: {
                id: true,
                profile: {
                  select: { displayName: true, handle: true, avatarUrl: true },
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
      distinct: ['trackId'],
      select: { trackId: true },
    });
    const total = distinctTracks.length;

    // Get progress and social state for each track
    const trackIds = recentEvents.map((e) => e.trackId);
    const [progressRecords, likeRecords, repostRecords] = await Promise.all([
      this.prisma.playbackProgress.findMany({
        where: { userId, trackId: { in: trackIds } },
        select: { trackId: true, positionSeconds: true },
      }),
      this.prisma.like.findMany({
        where: { userId, trackId: { in: trackIds } },
        select: { trackId: true },
      }),
      this.prisma.repost.findMany({
        where: { userId, trackId: { in: trackIds } },
        select: { trackId: true },
      }),
    ]);
    const progressMap = new Map(progressRecords.map((p) => [p.trackId, p.positionSeconds]));
    const likedSet = new Set(likeRecords.map((l) => l.trackId));
    const repostedSet = new Set(repostRecords.map((r) => r.trackId));

    return {
      page,
      limit: take,
      total,
      tracks: recentEvents.map((event) => ({
        trackId: event.trackId,
        title: event.track.title,
        slug: event.track.slug,
        artist: {
          id: event.track.uploader.id,
          display_name: event.track.uploader.profile?.displayName ?? null,
          handle: event.track.uploader.profile?.handle ?? null,
          avatar_url: event.track.uploader.profile?.avatarUrl ?? null,
        },
        coverArtUrl: event.track.coverArtUrl ?? null,
        durationMs: event.track.durationMs ?? 0,
        durationSeconds: event.track.durationMs ? Math.round(event.track.durationMs / 1000) : 0,
        waveformData: event.track.waveformData,
        liked: likedSet.has(event.trackId),
        likesCount: event.track._count.likes,
        reposted: repostedSet.has(event.trackId),
        repostsCount: event.track._count.reposts,
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
        orderBy: { startedAt: 'desc' },
        skip,
        take,
        select: {
          trackId: true,
          startedAt: true,
          track: {
            select: {
              title: true,
              slug: true,
              coverArtUrl: true,
              durationMs: true,
              waveformData: true,
              _count: { select: { likes: true, reposts: true } },
              uploader: {
                select: {
                  id: true,
                  profile: {
                    select: { displayName: true, handle: true, avatarUrl: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    // Get progress and social state for each track
    const trackIds = [...new Set(events.map((e) => e.trackId))];
    const [progressRecords, likeRecords, repostRecords] = await Promise.all([
      this.prisma.playbackProgress.findMany({
        where: { userId, trackId: { in: trackIds } },
        select: {
          trackId: true,
          positionSeconds: true,
          durationSeconds: true,
          isCompleted: true,
        },
      }),
      this.prisma.like.findMany({
        where: { userId, trackId: { in: trackIds } },
        select: { trackId: true },
      }),
      this.prisma.repost.findMany({
        where: { userId, trackId: { in: trackIds } },
        select: { trackId: true },
      }),
    ]);
    const progressMap = new Map(progressRecords.map((p) => [p.trackId, p]));
    const likedSet = new Set(likeRecords.map((l) => l.trackId));
    const repostedSet = new Set(repostRecords.map((r) => r.trackId));

    return {
      page,
      limit: take,
      total,
      history: events.map((event) => {
        const progress = progressMap.get(event.trackId);
        return {
          trackId: event.trackId,
          title: event.track.title,
          slug: event.track.slug,
          artist: {
            id: event.track.uploader.id,
            display_name: event.track.uploader.profile?.displayName ?? null,
            handle: event.track.uploader.profile?.handle ?? null,
            avatar_url: event.track.uploader.profile?.avatarUrl ?? null,
          },
          coverArtUrl: event.track.coverArtUrl ?? null,
          durationMs: event.track.durationMs ?? 0,
          durationSeconds:
            progress?.durationSeconds ??
            (event.track.durationMs ? Math.round(event.track.durationMs / 1000) : 0),
          waveformData: event.track.waveformData,
          liked: likedSet.has(event.trackId),
          likesCount: event.track._count.likes,
          reposted: repostedSet.has(event.trackId),
          repostsCount: event.track._count.reposts,
          playedAt: event.startedAt,
          positionSeconds: progress?.positionSeconds ?? 0,
          isCompleted: progress?.isCompleted ?? false,
        };
      }),
    };
  }

  // 7. DELETE /player/history
  async clearHistory(userId: string) {
    await this.prisma.playEvent.deleteMany({ where: { userId } });
    return { message: 'Listening history cleared successfully' };
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
        repeatMode: 'OFF',
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
        repeatMode: (body.repeatMode as any) ?? 'OFF',
      },
    });

    return { message: 'Player session updated successfully' };
  }

  // 11. GET /player/tracks/:trackId/preview
  async getTrackPreview(trackId: string) {
    await this.findTrackOrFail(trackId);

    const previewFile = await this.prisma.trackFile.findFirst({
      where: { trackId, fileRole: 'PREVIEW', isCurrent: true },
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
      accessState: 'PREVIEW',
    };
  }

  // -- Queue management

  /** Ads injected every N real tracks (MVP: static, no audio URL). */
  private readonly AD_EVERY_N_TRACKS = 3;

  private readonly STATIC_ADS = [
    {
      adId: 'ad_001',
      title: 'Upgrade to IQA3 Premium - No Ads',
      durationSeconds: 15,
      clickUrl: null as string | null,
    },
    {
      adId: 'ad_002',
      title: 'Share your music on IQA3',
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
        track.uploader.profile?.displayName ?? track.uploader.profile?.handle ?? 'Unknown Artist',
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
      case 'TRACK': {
        if (!dto.startTrackId) {
          throw new BadRequestException('startTrackId is required for TRACK context');
        }
        await this.findTrackOrFail(dto.startTrackId);
        trackIds = [dto.startTrackId];
        break;
      }

      case 'PLAYLIST': {
        if (!dto.contextId) {
          throw new BadRequestException('contextId (playlistId) is required for PLAYLIST context');
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
              orderBy: { position: 'asc' },
              select: { trackId: true },
            },
          },
        });
        if (!playlist) {
          throw new NotFoundException({
            code: 'PLAYLIST_NOT_FOUND',
            message: 'Playlist not found.',
          });
        }
        trackIds = playlist.tracks.map((t) => t.trackId);
        break;
      }

      case 'ARTIST': {
        if (!dto.contextId) {
          throw new BadRequestException('contextId (artistUserId) is required for ARTIST context');
        }
        const tracks = await this.prisma.track.findMany({
          where: {
            uploaderId: dto.contextId,
            status: TrackStatus.FINISHED,
            visibility: TrackVisibility.PUBLIC,
            deletedAt: null,
          },
          orderBy: { publishedAt: 'desc' },
          select: { id: true },
          take: 100,
        });
        trackIds = tracks.map((t) => t.id);
        break;
      }

      case 'CONTEXT_IDS': {
        if (!dto.trackIds?.length) {
          throw new BadRequestException('trackIds is required for CONTEXT_IDS context');
        }
        trackIds = dto.trackIds;
        break;
      }
    }

    if (!trackIds.length) {
      throw new BadRequestException('No playable tracks found for the given context');
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

    // Preserve any pending adRequired from the old session so the ad cannot
    // be bypassed by loading a new queue context.
    const oldSession = await this.prisma.playerSession.findUnique({
      where: { userId },
      select: { adRequired: true },
    });
    const preserveAdRequired = oldSession?.adRequired ?? false;

    await this.prisma.playerSession.upsert({
      where: { userId },
      update: {
        queueTrackIds: trackIds,
        currentQueueIndex: startIndex,
        realTracksSinceLastAd: 0,
        adRequired: preserveAdRequired,
        queueContext: { type: dto.contextType, id: dto.contextId ?? null },
        shuffle: dto.shuffle ?? false,
        currentTrackId: trackIds[startIndex],
      },
      create: {
        userId,
        queueTrackIds: trackIds,
        currentQueueIndex: startIndex,
        realTracksSinceLastAd: 0,
        adRequired: false,
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
        code: 'NO_QUEUE',
        message: 'No queue loaded. Call POST /player/queue/load first.',
      });
    }

    const { queueTrackIds, currentQueueIndex, realTracksSinceLastAd, repeatMode } = session;

    // If an ad was already triggered and not yet completed, re-serve it (non-skippable).
    // This blocks any new track from playing until POST /player/queue/ad-complete is called.
    if (shouldShowAds && session.adRequired) {
      return {
        type: 'AD' as const,
        ad: this.getNextAd(),
        canSkip: false,
        currentIndex: currentQueueIndex,
        queueLength: queueTrackIds.length,
        tracksUntilAd: this.AD_EVERY_N_TRACKS,
      };
    }

    // Inject ad every AD_EVERY_N_TRACKS real tracks (FREE plan users only)
    if (
      shouldShowAds &&
      realTracksSinceLastAd > 0 &&
      realTracksSinceLastAd % this.AD_EVERY_N_TRACKS === 0
    ) {
      // Set adRequired so reloading queue / jumping cannot bypass the ad.
      await this.prisma.playerSession.update({
        where: { userId },
        data: { adRequired: true },
      });

      return {
        type: 'AD' as const,
        ad: this.getNextAd(),
        canSkip: false,
        currentIndex: currentQueueIndex,
        queueLength: queueTrackIds.length,
        tracksUntilAd: this.AD_EVERY_N_TRACKS,
      };
    }

    // Advance to next track
    const isLastTrack = currentQueueIndex >= queueTrackIds.length - 1;
    let nextIndex: number;

    if (isLastTrack) {
      if (repeatMode === 'ALL') {
        nextIndex = 0;
      } else {
        // Queue ended (OFF or ONE - user pressed NEXT explicitly, so advance past)
        return {
          type: 'ENDED' as const,
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
        code: 'TRACK_NOT_FOUND',
        message: 'Next track in queue no longer exists.',
      });
    }

    return {
      type: 'TRACK' as const,
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
        code: 'NO_QUEUE',
        message: 'No queue loaded. Call POST /player/queue/load first.',
      });
    }

    const { queueTrackIds, currentQueueIndex, repeatMode } = session;

    let prevIndex: number;
    if (currentQueueIndex <= 0) {
      prevIndex = repeatMode === 'ALL' ? queueTrackIds.length - 1 : 0;
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
        code: 'TRACK_NOT_FOUND',
        message: 'Previous track in queue no longer exists.',
      });
    }

    return {
      type: 'TRACK' as const,
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
        repeatMode: 'OFF',
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
          artist: t.uploader.profile?.displayName ?? t.uploader.profile?.handle ?? 'Unknown Artist',
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
        code: 'NO_QUEUE',
        message: 'No queue loaded. Call POST /player/queue/load first.',
      });
    }

    // Block jump when an ad is pending — ad must be completed first.
    if (shouldShowAds && session.adRequired) {
      return {
        type: 'AD' as const,
        ad: this.getNextAd(),
        canSkip: false,
        currentIndex: session.currentQueueIndex,
        queueLength: session.queueTrackIds.length,
        tracksUntilAd: this.AD_EVERY_N_TRACKS,
      };
    }

    const index = session.queueTrackIds.indexOf(trackId);
    if (index === -1) {
      throw new NotFoundException({
        code: 'TRACK_NOT_IN_QUEUE',
        message: 'Track is not in the current queue.',
      });
    }

    await this.prisma.playerSession.update({
      where: { userId },
      data: {
        currentQueueIndex: index,
        currentTrackId: trackId,
        // Intentionally do NOT reset realTracksSinceLastAd here — jumping does
        // not clear the ad counter (only ad completion does).
      },
    });

    const trackMetadata = await this.buildQueueTrackMetadata(trackId);

    return {
      type: 'TRACK' as const,
      track: trackMetadata,
      currentIndex: index,
      queueLength: session.queueTrackIds.length,
      tracksUntilAd: shouldShowAds ? this.AD_EVERY_N_TRACKS : null,
    };
  }

  // 17. POST /player/queue/ad-complete
  async completeAd(userId: string) {
    const session = await this.prisma.playerSession.findUnique({ where: { userId } });
    if (!session) {
      throw new NotFoundException({ code: 'NO_QUEUE', message: 'No active queue session.' });
    }
    if (!session.adRequired) {
      throw new BadRequestException({
        code: 'NO_AD_PENDING',
        message: 'No ad is currently required for this session.',
      });
    }
    await this.prisma.playerSession.update({
      where: { userId },
      data: { adRequired: false, realTracksSinceLastAd: 0 },
    });
    return { adCompleted: true, message: 'Ad completed. Call POST /player/queue/next to continue.' };
  }

  // 18. POST /player/queue/items
  async addQueueItem(userId: string, trackId: string, mode: 'END' | 'NEXT' | 'TOP') {
    await this.findTrackOrFail(trackId);

    const session = await this.prisma.playerSession.findUnique({ where: { userId } });
    if (!session?.queueTrackIds.length) {
      throw new NotFoundException({ code: 'NO_QUEUE', message: 'No queue loaded.' });
    }

    const ids = [...session.queueTrackIds];
    const currentIndex = session.currentQueueIndex;
    let newCurrentIndex = currentIndex;

    if (mode === 'END') {
      ids.push(trackId);
    } else if (mode === 'TOP') {
      ids.unshift(trackId);
      newCurrentIndex = currentIndex + 1; // playing track shifts right
    } else {
      // NEXT — insert immediately after current
      ids.splice(currentIndex + 1, 0, trackId);
    }

    await this.prisma.playerSession.update({
      where: { userId },
      data: { queueTrackIds: ids, currentQueueIndex: newCurrentIndex },
    });

    const insertedAt = mode === 'END' ? ids.length - 1 : mode === 'TOP' ? 0 : currentIndex + 1;
    return { queueLength: ids.length, insertedAt };
  }

  // 19. PATCH /player/queue/items/:position/move
  async moveQueueItem(userId: string, fromPosition: number, toPosition: number) {
    const session = await this.prisma.playerSession.findUnique({ where: { userId } });
    if (!session?.queueTrackIds.length) {
      throw new NotFoundException({ code: 'NO_QUEUE', message: 'No queue loaded.' });
    }

    const ids = [...session.queueTrackIds];
    const len = ids.length;

    if (fromPosition < 0 || fromPosition >= len) {
      throw new BadRequestException(
        `fromPosition ${fromPosition} is out of range [0, ${len - 1}].`,
      );
    }
    if (toPosition < 0 || toPosition >= len) {
      throw new BadRequestException(
        `toPosition ${toPosition} is out of range [0, ${len - 1}].`,
      );
    }
    if (fromPosition === toPosition) {
      return { queueLength: len };
    }

    const [item] = ids.splice(fromPosition, 1);
    ids.splice(toPosition, 0, item);

    // Adjust the playing cursor
    let newCurrentIndex = session.currentQueueIndex;
    const ci = session.currentQueueIndex;
    if (fromPosition === ci) {
      newCurrentIndex = toPosition;
    } else if (fromPosition < ci && toPosition >= ci) {
      newCurrentIndex = ci - 1;
    } else if (fromPosition > ci && toPosition <= ci) {
      newCurrentIndex = ci + 1;
    }

    await this.prisma.playerSession.update({
      where: { userId },
      data: { queueTrackIds: ids, currentQueueIndex: newCurrentIndex },
    });

    return { queueLength: len };
  }

  // 20. DELETE /player/queue/items/:position
  async removeQueueItem(userId: string, position: number) {
    const session = await this.prisma.playerSession.findUnique({ where: { userId } });
    if (!session?.queueTrackIds.length) {
      throw new NotFoundException({ code: 'NO_QUEUE', message: 'No queue loaded.' });
    }

    const ids = [...session.queueTrackIds];
    const len = ids.length;

    if (position < 0 || position >= len) {
      throw new BadRequestException(`position ${position} is out of range [0, ${len - 1}].`);
    }

    ids.splice(position, 1);

    let newCurrentIndex = session.currentQueueIndex;
    if (position < session.currentQueueIndex) {
      newCurrentIndex = session.currentQueueIndex - 1;
    } else if (position === session.currentQueueIndex && ids.length > 0) {
      newCurrentIndex = Math.min(session.currentQueueIndex, ids.length - 1);
    }

    const updateData: Record<string, unknown> = {
      queueTrackIds: ids,
      currentQueueIndex: ids.length === 0 ? 0 : newCurrentIndex,
    };
    if (ids.length === 0) updateData.currentTrackId = null;

    await this.prisma.playerSession.update({ where: { userId }, data: updateData });
    return { queueLength: ids.length };
  }

  // 21. DELETE /player/queue
  async clearQueue(userId: string) {
    const session = await this.prisma.playerSession.findUnique({ where: { userId } });
    if (!session) {
      throw new NotFoundException({ code: 'NO_QUEUE', message: 'No active queue session.' });
    }
    await this.prisma.playerSession.update({
      where: { userId },
      data: {
        queueTrackIds: [],
        currentQueueIndex: 0,
        realTracksSinceLastAd: 0,
        adRequired: false,
        currentTrackId: null,
      },
    });
    return { message: 'Queue cleared.' };
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
        code: 'TRACK_NOT_FOUND',
        message: 'Track not found.',
      });
    }

    return track;
  }
}
