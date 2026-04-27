import { Injectable } from "@nestjs/common";
import {
  ModerationState,
  PlaylistVisibility,
  ProfileVisibility,
  ReportTargetType,
  TrackStatus,
  TrackVisibility,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string) {
    const normalized = q.trim();
    const tsQuery = this.toTsQuery(normalized);

    const [tracks, users, playlists] = await Promise.all([
      this.prisma.track.findMany({
        where: {
          deletedAt: null,
          visibility: TrackVisibility.PUBLIC,
          status: TrackStatus.FINISHED,
          moderationState: ModerationState.VISIBLE,
          OR: [
            { title: { search: tsQuery } },
            { description: { search: tsQuery } },
          ],
        },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          coverArtUrl: true,
          uploaderId: true,
          uploader: {
            select: {
              profile: {
                select: {
                  handle: true,
                  displayName: true,
                },
              },
            },
          },
        },
        take: 20,
      }),
      this.prisma.userProfile.findMany({
        where: {
          visibility: ProfileVisibility.PUBLIC,
          user: {
            deletedAt: null,
          },
          OR: [
            { handle: { search: tsQuery } },
            { displayName: { search: tsQuery } },
          ],
        },
        select: {
          userId: true,
          handle: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
        },
        take: 20,
      }),
      this.prisma.playlist.findMany({
        where: {
          deletedAt: null,
          visibility: PlaylistVisibility.PUBLIC,
          moderationState: ModerationState.VISIBLE,
          OR: [
            { title: { search: tsQuery } },
            { description: { search: tsQuery } },
          ],
        },
        select: {
          id: true,
          ownerId: true,
          title: true,
          slug: true,
          description: true,
          coverArtUrl: true,
          owner: {
            select: {
              profile: {
                select: {
                  handle: true,
                  displayName: true,
                },
              },
            },
          },
        },
        take: 20,
      }),
    ]);

    return {
      query: normalized,
      results: {
        tracks,
        users,
        playlists,
      },
      totals: {
        tracks: tracks.length,
        users: users.length,
        playlists: playlists.length,
      },
    };
  }

  async trending(limit = 20, windowDays = 7) {
    const rawRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        slug: string;
        cover_art_url: string | null;
        uploader_id: string;
        recent_plays: bigint;
        recent_likes: bigint;
        velocity_score: number;
      }>
    >`
      SELECT
        t.id,
        t.title,
        t.slug,
        t.cover_art_url,
        t.uploader_id,
        COUNT(pe.id)::bigint AS recent_plays,
        COUNT(l.id)::bigint AS recent_likes,
        (COUNT(pe.id) + (COUNT(l.id) * 2))::float AS velocity_score
      FROM tracks t
      LEFT JOIN play_events pe
        ON pe.track_id = t.id
       AND pe.started_at >= NOW() - (${windowDays}::text || ' days')::interval
      LEFT JOIN track_likes l
        ON l.track_id = t.id
       AND l.created_at >= NOW() - (${windowDays}::text || ' days')::interval
      WHERE t.deleted_at IS NULL
        AND t.visibility = 'PUBLIC'
        AND t.status = 'FINISHED'
        AND t.moderation_state = 'VISIBLE'
      GROUP BY t.id
      ORDER BY velocity_score DESC, t.created_at DESC
      LIMIT ${limit}
    `;

    const uploaderIds = Array.from(
      new Set(rawRows.map((row) => row.uploader_id)),
    );

    const uploaderProfiles = uploaderIds.length
      ? await this.prisma.userProfile.findMany({
          where: { userId: { in: uploaderIds } },
          select: {
            userId: true,
            handle: true,
            displayName: true,
          },
        })
      : [];

    const profileMap = new Map(
      uploaderProfiles.map((profile) => [profile.userId, profile]),
    );

    return {
      windowDays,
      items: rawRows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        coverArtUrl: row.cover_art_url,
        uploaderId: row.uploader_id,
        uploader: profileMap.get(row.uploader_id) ?? null,
        recentPlays: Number(row.recent_plays),
        recentLikes: Number(row.recent_likes),
        velocityScore: row.velocity_score,
      })),
    };
  }

  async resolveResource(url: string) {
    const path = this.normalizeUrlToPath(url);
    const segments = path.split("/").filter(Boolean);

    if (segments.length === 0) {
      return { matched: false };
    }

    const handle = segments[0];

    if (segments.length === 1) {
      const userProfile = await this.prisma.userProfile.findFirst({
        where: { handle },
        select: { userId: true, handle: true },
      });

      if (!userProfile) {
        return { matched: false };
      }

      return {
        matched: true,
        resourceType: ReportTargetType.USER,
        id: userProfile.userId,
        handle: userProfile.handle,
      };
    }

    const maybeSets = segments[1]?.toLowerCase();
    if (maybeSets === "sets" && segments.length >= 3) {
      const playlistSlug = segments[2];

      const playlist = await this.prisma.playlist.findFirst({
        where: {
          slug: playlistSlug,
          owner: {
            profile: {
              handle,
            },
          },
        },
        select: {
          id: true,
          slug: true,
        },
      });

      if (!playlist) {
        return { matched: false };
      }

      return {
        matched: true,
        resourceType: ReportTargetType.PLAYLIST,
        id: playlist.id,
        slug: playlist.slug,
      };
    }

    const slug = segments[1];

    const track = await this.prisma.track.findFirst({
      where: {
        slug,
        uploader: {
          profile: {
            handle,
          },
        },
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (track) {
      return {
        matched: true,
        resourceType: ReportTargetType.TRACK,
        id: track.id,
        slug: track.slug,
      };
    }

    const playlist = await this.prisma.playlist.findFirst({
      where: {
        slug,
        owner: {
          profile: {
            handle,
          },
        },
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (playlist) {
      return {
        matched: true,
        resourceType: ReportTargetType.PLAYLIST,
        id: playlist.id,
        slug: playlist.slug,
      };
    }

    return { matched: false };
  }

  private toTsQuery(q: string): string {
    return q
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .join(" & ");
  }

  private normalizeUrlToPath(input: string): string {
    const trimmed = input.trim();

    try {
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        const parsed = new URL(trimmed);
        return parsed.pathname;
      }
    } catch {
      // Fallback to raw path parsing below.
    }

    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
}
