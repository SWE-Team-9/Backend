import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async createComment(
    userId: string,
    trackId: string,
    content: string,
    timestampAt: number,
  ): Promise<{
    id: string;
    content: string;
    timestampAt: number;
    user: {
      userId: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
  }> {
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

  async getTrackComments(trackId: string): Promise<
    {
      id: string;
      content: string;
      timestampAt: number;
      user: {
        userId: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
    }[]
  > {
    await this.ensureTrackExists(trackId);

    const comments = await this.prisma.comment.findMany({
      where: {
        trackId,
      },
      orderBy: {
        timestampAt: "asc",
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

  async likeTrack(userId: string, trackId: string): Promise<void> {
    await this.ensureTrackExists(trackId);

    const existingLike = await this.prisma.like.findFirst({
      where: {
        userId,
        trackId,
      },
      select: {
        id: true,
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
        data: {
          userId,
          trackId,
        },
      });
    } catch (error: unknown) {
      this.handlePrismaWriteError(error, "TRACK_ALREADY_LIKED");
    }
  }

  async unlikeTrack(userId: string, trackId: string): Promise<void> {
    await this.ensureTrackExists(trackId);

    const result = await this.prisma.like.deleteMany({
      where: {
        userId,
        trackId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "TRACK_LIKE_NOT_FOUND",
        message: "You have not liked this track.",
      });
    }
  }

  async repostTrack(userId: string, trackId: string): Promise<void> {
    await this.ensureTrackExists(trackId);

    const existingRepost = await this.prisma.repost.findFirst({
      where: {
        userId,
        trackId,
      },
      select: {
        id: true,
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
        data: {
          userId,
          trackId,
        },
      });
    } catch (error: unknown) {
      this.handlePrismaWriteError(error, "TRACK_ALREADY_REPOSTED");
    }
  }

  async unrepostTrack(userId: string, trackId: string): Promise<void> {
    await this.ensureTrackExists(trackId);

    const result = await this.prisma.repost.deleteMany({
      where: {
        userId,
        trackId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "TRACK_REPOST_NOT_FOUND",
        message: "You have not reposted this track.",
      });
    }
  }

  private async ensureTrackExists(trackId: string): Promise<void> {
    const track = await this.prisma.track.findUnique({
      where: {
        id: trackId,
      },
      select: {
        id: true,
      },
    });

    if (!track) {
      throw new NotFoundException({
        code: "TRACK_NOT_FOUND",
        message: "Track not found.",
      });
    }
  }

  private handlePrismaWriteError(
    error: unknown,
    conflictCode: string,
  ): never {
    if (error instanceof PrismaClientKnownRequestError) {
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