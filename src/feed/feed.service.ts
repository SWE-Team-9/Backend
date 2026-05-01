import { Injectable } from "@nestjs/common";
import { ModerationState, TrackStatus, TrackVisibility } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(userId: string, limit = 20, offset?: number, page = 1) {
    const followRows = await this.prisma.userFollow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = followRows.map((row) => row.followingId);

    if (followingIds.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          offset: offset ?? (page - 1) * limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    const computedOffset = offset ?? (page - 1) * limit;

    const where = {
      uploaderId: { in: followingIds },
      deletedAt: null,
      status: TrackStatus.FINISHED,
      visibility: TrackVisibility.PUBLIC,
      moderationState: ModerationState.VISIBLE,
    };

    const [total, tracks] = await this.prisma.$transaction([
      this.prisma.track.count({ where }),
      this.prisma.track.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          coverArtUrl: true,
          createdAt: true,
          publishedAt: true,
          uploaderId: true,
          status: true,
          visibility: true,
          durationMs: true,
          waveformData: true,
          primaryGenreId: true,
          primaryGenre: {
            select: {
              id: true,
              name: true,
            },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          uploader: {
            select: {
              profile: {
                select: {
                  handle: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
          _count: {
            select: {
              likes: true,
              reposts: true,
            },
          },
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: computedOffset,
        take: limit,
      }),
    ]);

    // Fetch user's likes and reposts for these tracks
    const userLikeMap = new Map<string, boolean>();
    const userRepostMap = new Map<string, boolean>();

    if (tracks.length > 0) {
      const trackIds = tracks.map((t) => t.id);

      const userLikes = await this.prisma.like.findMany({
        where: {
          userId,
          trackId: { in: trackIds },
        },
        select: { trackId: true },
      });

      const userReposts = await this.prisma.repost.findMany({
        where: {
          userId,
          trackId: { in: trackIds },
        },
        select: { trackId: true },
      });

      userLikes.forEach((like) => {
        userLikeMap.set(like.trackId, true);
      });

      userReposts.forEach((repost) => {
        userRepostMap.set(repost.trackId, true);
      });
    }

    // Transform tracks to match frontend expectations
    const transformedTracks = tracks.map((track) => ({
      id: track.id,
      title: track.title,
      slug: track.slug,
      description: track.description,
      coverArtUrl: track.coverArtUrl,
      createdAt: track.createdAt,
      publishedAt: track.publishedAt,
      uploaderId: track.uploaderId,
      uploader: track.uploader,
      status: track.status,
      visibility: track.visibility,
      durationMs: track.durationMs,
      genre: track.primaryGenre?.name || null,
      tags: track.tags.map((t) => t.tag.name),
      waveformData: track.waveformData,
      likesCount: track._count.likes,
      repostsCount: track._count.reposts,
      liked: userLikeMap.get(track.id) ?? false,
      reposted: userRepostMap.get(track.id) ?? false,
    }));

    return {
      data: transformedTracks,
      pagination: {
        page,
        limit,
        offset: computedOffset,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: computedOffset + tracks.length < total,
        hasPreviousPage: computedOffset > 0,
      },
    };
  }
}
