import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TrackStatus } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";

import { PrismaService } from "../prisma/prisma.service";
import { InteractionsGateway } from "./interactions.gateway";

type PaginationResult = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type TrackSummary = {
  id: string;
  title: string;
  slug: string;
  coverArtUrl: string | null;
  publishedAt: Date | null;
  likesCount: number;
  repostsCount: number;
};

type UserProfileSummary = {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type TrackListItem = {
  track: TrackSummary;
  interactedAt: Date;
};

type TrackUserListItem = {
  user: UserProfileSummary;
  interactedAt: Date;
};

type CommentResponse = {
  id: string;
  content: string;
  timestampAt: number;
  user: UserProfileSummary;
};

type TrackUserListResponse = {
  track: TrackSummary;
  items: TrackUserListItem[];
  pagination: PaginationResult;
};

type MeTrackListResponse = {
  items: TrackListItem[];
  pagination: PaginationResult;
};

@Injectable()
export class InteractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interactionsGateway: InteractionsGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async likeTrack(userId: string, trackId: string): Promise<void> {
    const track = await this.ensureTrackExists(trackId);
    this.assertTrackIsFinished(track.status, "like this track");
    this.assertNotOwnTrack(userId, track.uploaderId, "like this track");

    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_trackId: {
          userId,
          trackId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (existingLike) {
      throw new ConflictException({
        code: "TRACK_ALREADY_LIKED",
        message: "You already liked this track.",
      });
    }

    try {
      await this.prisma.like.create({
        data: { userId, trackId },
      });

      this.interactionsGateway.emitTrackInteraction(trackId, {
        type: "LIKE",
        userId,
        trackId,
        createdAt: new Date().toISOString(),
      });
      this.eventEmitter.emit("track.liked", {
        trackId,
        actorId: userId,
        ownerId: track.uploaderId,
      });
    } catch (error: unknown) {
      this.handlePrismaWriteError(error, "TRACK_ALREADY_LIKED");
    }
  }

  async unlikeTrack(userId: string, trackId: string): Promise<void> {
    await this.ensureTrackExists(trackId);

    const result = await this.prisma.like.deleteMany({
      where: { userId, trackId },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "TRACK_LIKE_NOT_FOUND",
        message: "You have not liked this track.",
      });
    }
  }

  async repostTrack(userId: string, trackId: string): Promise<void> {
    const track = await this.ensureTrackExists(trackId);
    this.assertTrackIsFinished(track.status, "repost this track");
    this.assertNotOwnTrack(userId, track.uploaderId, "repost this track");

    const existingRepost = await this.prisma.repost.findUnique({
      where: {
        userId_trackId: {
          userId,
          trackId,
        },
      },
      select: {
        userId: true,
      },
    });

    if (existingRepost) {
      throw new ConflictException({
        code: "TRACK_ALREADY_REPOSTED",
        message: "You already reposted this track.",
      });
    }

    try {
      await this.prisma.repost.create({
        data: { userId, trackId },
      });

      this.interactionsGateway.emitTrackInteraction(trackId, {
        type: "REPOST",
        userId,
        trackId,
        createdAt: new Date().toISOString(),
      });
      this.eventEmitter.emit("track.reposted", {
        trackId,
        actorId: userId,
        ownerId: track.uploaderId,
      });
    } catch (error: unknown) {
      this.handlePrismaWriteError(error, "TRACK_ALREADY_REPOSTED");
    }
  }

  async getInteractionStatus(
    userId: string,
    trackId: string,
  ): Promise<{ isLiked: boolean; isReposted: boolean }> {
    await this.ensureTrackExists(trackId);

    const [like, repost] = await this.prisma.$transaction([
      this.prisma.like.findUnique({
        where: {
          userId_trackId: {
            userId,
            trackId,
          },
        },
        select: {
          userId: true,
        },
      }),
      this.prisma.repost.findUnique({
        where: {
          userId_trackId: {
            userId,
            trackId,
          },
        },
        select: {
          userId: true,
        },
      }),
    ]);

    return {
      isLiked: Boolean(like),
      isReposted: Boolean(repost),
    };
  }

  async unrepostTrack(userId: string, trackId: string): Promise<void> {
    await this.ensureTrackExists(trackId);

    const result = await this.prisma.repost.deleteMany({
      where: { userId, trackId },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "TRACK_REPOST_NOT_FOUND",
        message: "You have not reposted this track.",
      });
    }
  }

  async getMyLikedTracks(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<MeTrackListResponse> {
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where = {
      userId,
      track: { status: TrackStatus.FINISHED },
    };

    const [total, likes] = await this.prisma.$transaction([
      this.prisma.like.count({ where }),
      this.prisma.like.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
        select: {
          createdAt: true,
          track: {
            select: {
              id: true,
              title: true,
              slug: true,
              coverArtUrl: true,
              publishedAt: true,
              _count: {
                select: {
                  likes: true,
                  reposts: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: likes.map((like) => ({
        interactedAt: like.createdAt,
        track: {
          id: like.track.id,
          title: like.track.title,
          slug: like.track.slug,
          coverArtUrl: like.track.coverArtUrl,
          publishedAt: like.track.publishedAt,
          likesCount: like.track._count.likes,
          repostsCount: like.track._count.reposts,
        },
      })),
      pagination: this.buildPagination(total, normalizedPage, normalizedLimit),
    };
  }

  async getMyRepostedTracks(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<MeTrackListResponse> {
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where = {
      userId,
      track: { status: TrackStatus.FINISHED },
    };

    const [total, reposts] = await this.prisma.$transaction([
      this.prisma.repost.count({ where }),
      this.prisma.repost.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
        select: {
          createdAt: true,
          track: {
            select: {
              id: true,
              title: true,
              slug: true,
              coverArtUrl: true,
              publishedAt: true,
              _count: {
                select: {
                  likes: true,
                  reposts: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: reposts.map((repost) => ({
        interactedAt: repost.createdAt,
        track: {
          id: repost.track.id,
          title: repost.track.title,
          slug: repost.track.slug,
          coverArtUrl: repost.track.coverArtUrl,
          publishedAt: repost.track.publishedAt,
          likesCount: repost.track._count.likes,
          repostsCount: repost.track._count.reposts,
        },
      })),
      pagination: this.buildPagination(total, normalizedPage, normalizedLimit),
    };
  }

  async getLikedTracks(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<MeTrackListResponse> {
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where = {
      userId,
      track: { status: TrackStatus.FINISHED },
    };

    const [total, likes] = await this.prisma.$transaction([
      this.prisma.like.count({ where }),
      this.prisma.like.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
        select: {
          createdAt: true,
          track: {
            select: {
              id: true,
              title: true,
              slug: true,
              coverArtUrl: true,
              publishedAt: true,
              _count: {
                select: {
                  likes: true,
                  reposts: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: likes.map((like) => ({
        interactedAt: like.createdAt,
        track: {
          id: like.track.id,
          title: like.track.title,
          slug: like.track.slug,
          coverArtUrl: like.track.coverArtUrl,
          publishedAt: like.track.publishedAt,
          likesCount: like.track._count.likes,
          repostsCount: like.track._count.reposts,
        },
      })),
      pagination: this.buildPagination(total, normalizedPage, normalizedLimit),
    };
  }

  async getRepostedTracks(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<MeTrackListResponse> {
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where = {
      userId,
      track: { status: TrackStatus.FINISHED },
    };

    const [total, reposts] = await this.prisma.$transaction([
      this.prisma.repost.count({ where }),
      this.prisma.repost.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
        select: {
          createdAt: true,
          track: {
            select: {
              id: true,
              title: true,
              slug: true,
              coverArtUrl: true,
              publishedAt: true,
              _count: {
                select: {
                  likes: true,
                  reposts: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: reposts.map((repost) => ({
        interactedAt: repost.createdAt,
        track: {
          id: repost.track.id,
          title: repost.track.title,
          slug: repost.track.slug,
          coverArtUrl: repost.track.coverArtUrl,
          publishedAt: repost.track.publishedAt,
          likesCount: repost.track._count.likes,
          repostsCount: repost.track._count.reposts,
        },
      })),
      pagination: this.buildPagination(total, normalizedPage, normalizedLimit),
    };
  }

  async getTrackLikers(
    trackId: string,
    page = 1,
    limit = 20,
  ): Promise<TrackUserListResponse> {
    const track = await this.ensureTrackExists(trackId);
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where = { trackId };

    const [total, likes] = await this.prisma.$transaction([
      this.prisma.like.count({ where }),
      this.prisma.like.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
        select: {
          createdAt: true,
          user: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      track: this.mapTrackSummary(track),
      items: likes.map((like) => ({
        interactedAt: like.createdAt,
        user: {
          userId: like.user.id,
          displayName: like.user.profile?.displayName ?? null,
          avatarUrl: like.user.profile?.avatarUrl ?? null,
        },
      })),
      pagination: this.buildPagination(total, normalizedPage, normalizedLimit),
    };
  }

  async getTrackReposters(
    trackId: string,
    page = 1,
    limit = 20,
  ): Promise<TrackUserListResponse> {
    const track = await this.ensureTrackExists(trackId);
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const skip = (normalizedPage - 1) * normalizedLimit;

    const where = { trackId };

    const [total, reposts] = await this.prisma.$transaction([
      this.prisma.repost.count({ where }),
      this.prisma.repost.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
        select: {
          createdAt: true,
          user: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      track: this.mapTrackSummary(track),
      items: reposts.map((repost) => ({
        interactedAt: repost.createdAt,
        user: {
          userId: repost.user.id,
          displayName: repost.user.profile?.displayName ?? null,
          avatarUrl: repost.user.profile?.avatarUrl ?? null,
        },
      })),
      pagination: this.buildPagination(total, normalizedPage, normalizedLimit),
    };
  }

  async createComment(
    userId: string,
    trackId: string,
    content: string,
    timestampAt: number,
  ): Promise<CommentResponse> {
    if (timestampAt < 0) {
      throw new BadRequestException({
        code: "INVALID_COMMENT_TIMESTAMP",
        message: "timestampAt must be greater than or equal to 0.",
      });
    }

    await this.ensureTrackExists(trackId);

    const comment = await this.prisma.comment.create({
      data: {
        userId,
        trackId,
        content,
        timestampAt,
      },
      select: {
        id: true,
        content: true,
        timestampAt: true,
        user: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    this.interactionsGateway.emitTrackInteraction(trackId, {
      type: "COMMENT",
      userId,
      trackId,
      createdAt: new Date().toISOString(),
      commentId: comment.id,
      timestampAt: comment.timestampAt,
    });

    // Fetch uploader for notification event
    const trackRecord = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: { uploaderId: true },
    });
    if (trackRecord) {
      this.eventEmitter.emit("track.commented", {
        trackId,
        actorId: userId,
        ownerId: trackRecord.uploaderId,
        commentId: comment.id,
      });
    }

    return {
      id: comment.id,
      content: comment.content,
      timestampAt: comment.timestampAt,
      user: {
        userId: comment.user.id,
        displayName: comment.user.profile?.displayName ?? null,
        avatarUrl: comment.user.profile?.avatarUrl ?? null,
      },
    };
  }

  async deleteComment(
    userId: string,
    commentId: string,
  ): Promise<{ message: string }> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true },
    });

    if (!comment) {
      throw new NotFoundException({
        code: "COMMENT_NOT_FOUND",
        message: "Comment not found.",
      });
    }

    if (comment.userId !== userId) {
      throw new ForbiddenException({
        code: "COMMENT_NOT_OWNED",
        message: "You can only delete your own comments.",
      });
    }

    await this.prisma.comment.delete({ where: { id: commentId } });

    return { message: "Comment deleted successfully" };
  }

  async getTrackComments(trackId: string): Promise<CommentResponse[]> {
    await this.ensureTrackExists(trackId);

    const comments = await this.prisma.comment.findMany({
      where: { trackId },
      orderBy: { timestampAt: "asc" },
      select: {
        id: true,
        content: true,
        timestampAt: true,
        user: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      timestampAt: comment.timestampAt,
      user: {
        userId: comment.user.id,
        displayName: comment.user.profile?.displayName ?? null,
        avatarUrl: comment.user.profile?.avatarUrl ?? null,
      },
    }));
  }

  private normalizePage(page: number): number {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException({
        code: "INVALID_PAGE",
        message: "page must be a positive integer.",
      });
    }

    return page;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException({
        code: "INVALID_LIMIT",
        message: "limit must be a positive integer.",
      });
    }

    return Math.min(limit, 100);
  }

  private buildPagination(
    total: number,
    page: number,
    limit: number,
  ): PaginationResult {
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  private mapTrackSummary(track: {
    id: string;
    title: string;
    slug: string;
    coverArtUrl: string | null;
    publishedAt: Date | null;
    _count: { likes: number; reposts: number };
  }): TrackSummary {
    return {
      id: track.id,
      title: track.title,
      slug: track.slug,
      coverArtUrl: track.coverArtUrl,
      publishedAt: track.publishedAt,
      likesCount: track._count.likes,
      repostsCount: track._count.reposts,
    };
  }

  private async ensureTrackExists(trackId: string): Promise<{
    id: string;
    uploaderId: string;
    status: TrackStatus;
    title: string;
    slug: string;
    coverArtUrl: string | null;
    publishedAt: Date | null;
    _count: { likes: number; reposts: number };
  }> {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        uploaderId: true,
        status: true,
        title: true,
        slug: true,
        coverArtUrl: true,
        publishedAt: true,
        _count: {
          select: {
            likes: true,
            reposts: true,
          },
        },
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

  private assertTrackIsFinished(status: TrackStatus, action: string): void {
    if (status !== TrackStatus.FINISHED) {
      throw new ConflictException({
        code: "TRACK_NOT_FINISHED",
        message: `You can only ${action} after the track is finished.`,
      });
    }
  }

  private assertNotOwnTrack(
    userId: string,
    uploaderId: string,
    action: string,
  ): void {
    if (userId === uploaderId) {
      throw new ForbiddenException({
        code: "TRACK_OWNED_BY_USER",
        message: `You cannot ${action} your own track.`,
      });
    }
  }

  private handlePrismaWriteError(
    error: unknown,
    conflictCode: string,
  ): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new ConflictException({
          code: conflictCode,
          message: "You already performed this action on the track.",
        });
      }
    }

    throw error;
  }
}
