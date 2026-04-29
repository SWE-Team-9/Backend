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

    const [tracks, users, playlists] = await Promise.all([
      // Use raw tsvector query for optimal GIN index performance on tracks
      this.prisma.$queryRaw<
        Array<{
          id: string;
          title: string;
          slug: string;
          description: string | null;
          cover_art_url: string | null;
          uploader_id: string;
        }>
      >`
        SELECT
          t.id,
          t.title,
          t.slug,
          t.description,
          t.cover_art_url,
          t.uploader_id
        FROM tracks t
        WHERE
          t.deleted_at IS NULL
          AND t.visibility = 'PUBLIC'
          AND t.status = 'FINISHED'
          AND t.moderation_state = 'VISIBLE'
          AND to_tsvector('english', COALESCE(t.title, '') || ' ' || COALESCE(t.description, ''))
              @@ plainto_tsquery('english', ${normalized})
        LIMIT 20
      `,
      this.prisma.userProfile.findMany({
        where: {
          visibility: ProfileVisibility.PUBLIC,
          user: {
            deletedAt: null,
          },
          OR: [
            { handle: { search: normalized } },
            { displayName: { search: normalized } },
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
      // Use raw tsvector query for optimal GIN index performance on playlists
      this.prisma.$queryRaw<
        Array<{
          id: string;
          owner_id: string;
          title: string;
          slug: string;
          description: string | null;
          cover_art_url: string | null;
        }>
      >`
        SELECT
          p.id,
          p.owner_id,
          p.title,
          p.slug,
          p.description,
          p.cover_art_url
        FROM playlists p
        WHERE
          p.deleted_at IS NULL
          AND p.visibility = 'PUBLIC'
          AND p.moderation_state = 'VISIBLE'
          AND to_tsvector('english', COALESCE(p.title, '') || ' ' || COALESCE(p.description, ''))
              @@ plainto_tsquery('english', ${normalized})
        LIMIT 20
      `,
    ]);

    // Transform raw query results to match expected API response shape
    const transformedTracks = tracks.map((t) => ({
      id: t.id,
      title: t.title,
      slug: t.slug,
      description: t.description,
      coverArtUrl: t.cover_art_url,
      uploaderId: t.uploader_id,
    }));

    const transformedPlaylists = playlists.map((p) => ({
      id: p.id,
      ownerId: p.owner_id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      coverArtUrl: p.cover_art_url,
    }));

    return {
      query: normalized,
      results: {
        tracks: transformedTracks,
        users,
        playlists: transformedPlaylists,
      },
      totals: {
        tracks: transformedTracks.length,
        users: users.length,
        playlists: transformedPlaylists.length,
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
