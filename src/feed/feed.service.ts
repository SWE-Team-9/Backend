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
        items: [],
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
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        skip: computedOffset,
        take: limit,
      }),
    ]);

    return {
      items: tracks,
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
