import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../prisma/prisma.service";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { SuggestionsQueryDto } from "./dto/suggestions-query.dto";
import { UserIdParamDto } from "./dto/user-id-param.dto";

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "CANNOT_FOLLOW_SELF",
        message: "You cannot follow yourself.",
      });
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true, deletedAt: true },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Target user not found.",
      });
    }

    const targetBlockedRequester = await this.prisma.userBlock.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: followingId,
          blockedId: followerId,
        },
      },
      select: { blockerId: true },
    });

    if (targetBlockedRequester) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "FOLLOW_BLOCKED",
        message: "You cannot follow this user.",
      });
    }

    try {
      await this.prisma.userFollow.create({
        data: {
          followerId,
          followingId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          statusCode: 409,
          error: "ALREADY_FOLLOWING",
          message: "You are already following this user.",
        });
      }
      throw error;
    }

    const followersCount = await this.prisma.userFollow.count({
      where: { followingId },
    });

    this.eventEmitter.emit("user.followed", {
      followerId,
      followingId,
    });

    return {
      message: "User followed successfully",
      targetUserId: followingId,
      followersCount,
      isFollowing: true,
    };
  }

  async unfollowUser(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "CANNOT_UNFOLLOW_SELF",
        message: "You cannot unfollow yourself.",
      });
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true, deletedAt: true },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Target user not found.",
      });
    }

    const relation = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
      select: { followerId: true },
    });

    if (!relation) {
      throw new NotFoundException({
        statusCode: 404,
        error: "FOLLOW_RELATION_NOT_FOUND",
        message: "Follow relationship does not exist.",
      });
    }

    await this.prisma.userFollow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });

    return {
      message: "User unfollowed successfully",
      targetUserId: followingId,
      isFollowing: false,
    };
  }

  async getFollowers(userId: string, query: PaginationQueryDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Target user not found.",
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userFollow.count({ where: { followingId: userId } }),
      this.prisma.userFollow.findMany({
        where: { followingId: userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          follower: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                  handle: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      followers: rows.map((row) => ({
        id: row.follower.id,
        display_name: row.follower.profile?.displayName ?? "",
        handle: row.follower.profile?.handle ?? "",
        avatar_url: row.follower.profile?.avatarUrl ?? null,
      })),
    };
  }

  async getFollowing(userId: string, query: PaginationQueryDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Target user not found.",
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userFollow.count({ where: { followerId: userId } }),
      this.prisma.userFollow.findMany({
        where: { followerId: userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          following: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                  handle: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      following: rows.map((row) => ({
        id: row.following.id,
        display_name: row.following.profile?.displayName ?? "",
        handle: row.following.profile?.handle ?? "",
        avatar_url: row.following.profile?.avatarUrl ?? null,
      })),
    };
  }

  async getSuggestions(userId: string, query: SuggestionsQueryDto) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!currentUser || currentUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Authenticated user not found.",
      });
    }

    const limit = query.limit ?? 10;
    if (limit <= 0) {
      return { suggestions: [] };
    }

    const [followingRows, followerRows, blocksByMe, blocksAgainstMe, myGenres] =
      await this.prisma.$transaction([
        this.prisma.userFollow.findMany({
          where: { followerId: userId },
          select: { followingId: true },
        }),
        this.prisma.userFollow.findMany({
          where: { followingId: userId },
          select: { followerId: true },
        }),
        this.prisma.userBlock.findMany({
          where: { blockerId: userId },
          select: { blockedId: true },
        }),
        this.prisma.userBlock.findMany({
          where: { blockedId: userId },
          select: { blockerId: true },
        }),
        this.prisma.userFavoriteGenre.findMany({
          where: { userId },
          select: { genreId: true },
        }),
      ]);

    const excludedUserIds = new Set<string>([userId]);
    for (const row of followingRows) excludedUserIds.add(row.followingId);
    for (const row of blocksByMe) excludedUserIds.add(row.blockedId);
    for (const row of blocksAgainstMe) excludedUserIds.add(row.blockerId);

    const myGenreIds = myGenres.map((g) => g.genreId);
    const myFollowingIds = followingRows.map((row) => row.followingId);
    const myFollowerIds = followerRows.map((row) => row.followerId);

    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludedUserIds) },
        deletedAt: null,
      },
      take: Math.max(limit * 5, limit),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        lastLoginAt: true,
        profile: {
          select: {
            displayName: true,
            handle: true,
            avatarUrl: true,
          },
        },
        favoriteGenres: {
          select: { genreId: true },
        },
        _count: {
          select: {
            tracks: true,
            likes: true,
            reposts: true,
            comments: true,
          },
        },
      },
    });

    if (candidates.length === 0) {
      return { suggestions: [] };
    }

    const candidateIds = candidates.map((candidate) => candidate.id);

    const sharedFollowingPromise =
      myFollowingIds.length > 0
        ? this.prisma.userFollow.findMany({
            where: {
              followerId: { in: candidateIds },
              followingId: { in: myFollowingIds },
            },
            select: { followerId: true },
          })
        : Promise.resolve([] as { followerId: string }[]);

    const sharedFollowerPromise =
      myFollowerIds.length > 0
        ? this.prisma.userFollow.findMany({
            where: {
              followingId: { in: candidateIds },
              followerId: { in: myFollowerIds },
            },
            select: { followingId: true },
          })
        : Promise.resolve([] as { followingId: string }[]);

    const [sharedFollowingEdges, sharedFollowerEdges] = await Promise.all([
      sharedFollowingPromise,
      sharedFollowerPromise,
    ]);

    const sharedFollowingCountByUser = new Map<string, number>();
    for (const edge of sharedFollowingEdges) {
      sharedFollowingCountByUser.set(
        edge.followerId,
        (sharedFollowingCountByUser.get(edge.followerId) ?? 0) + 1,
      );
    }

    const sharedFollowerCountByUser = new Map<string, number>();
    for (const edge of sharedFollowerEdges) {
      sharedFollowerCountByUser.set(
        edge.followingId,
        (sharedFollowerCountByUser.get(edge.followingId) ?? 0) + 1,
      );
    }

    const now = Date.now();
    const myGenreSet = new Set(myGenreIds);
    let maxGraphRaw = 0;
    let maxEngagementRaw = 0;

    const rawCandidates = candidates.map((candidate) => {
      const candidateGenreSet = new Set<number>();
      let sharedGenresCount = 0;

      for (const genre of candidate.favoriteGenres) {
        candidateGenreSet.add(genre.genreId);
        if (myGenreSet.has(genre.genreId)) {
          sharedGenresCount += 1;
        }
      }

      const tasteScore =
        myGenreIds.length > 0
          ? this.normalizeScore(sharedGenresCount, myGenreIds.length)
          : 0;

      const graphRaw =
        (sharedFollowingCountByUser.get(candidate.id) ?? 0) +
        (sharedFollowerCountByUser.get(candidate.id) ?? 0);

      const engagementRaw =
        (candidate._count?.tracks ?? 0) +
        (candidate._count?.likes ?? 0) +
        (candidate._count?.reposts ?? 0) +
        (candidate._count?.comments ?? 0);

      if (graphRaw > maxGraphRaw) {
        maxGraphRaw = graphRaw;
      }
      if (engagementRaw > maxEngagementRaw) {
        maxEngagementRaw = engagementRaw;
      }

      const activityRecency = this.recencyScore(
        candidate.lastLoginAt ?? candidate.createdAt,
        now,
        30,
      );
      const freshnessScore = this.recencyScore(candidate.createdAt, now, 90);

      return {
        ...candidate,
        candidateGenreSet,
        sharedGenresCount,
        tasteScore,
        graphRaw,
        engagementRaw,
        activityRecency,
        freshnessScore,
      };
    });

    const scoredCandidates = rawCandidates.map((candidate) => {
      const graphScore = this.normalizeScore(candidate.graphRaw, maxGraphRaw);
      const engagementScore = this.normalizeScore(
        candidate.engagementRaw,
        maxEngagementRaw,
      );
      const activityScore = 0.6 * engagementScore + 0.4 * candidate.activityRecency;

      const baseScore =
        0.4 * candidate.tasteScore +
        0.3 * graphScore +
        0.15 * activityScore +
        0.1 * candidate.freshnessScore;

      return {
        ...candidate,
        graphScore,
        activityScore,
        baseScore,
      };
    });

    const selected: typeof scoredCandidates = [];
    const selectedGenreSets: Set<number>[] = [];
    const remaining = [...scoredCandidates];

    while (selected.length < limit && remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < remaining.length; index++) {
        const candidate = remaining[index];
        const diversityScore = this.computeDiversityScore(
          candidate.candidateGenreSet,
          selectedGenreSets,
        );
        const finalScore = candidate.baseScore + 0.05 * diversityScore;

        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestIndex = index;
        }
      }

      const chosen = remaining.splice(bestIndex, 1)[0];
      selected.push(chosen);
      selectedGenreSets.push(chosen.candidateGenreSet);
    }

    return {
      suggestions: selected.map((candidate) => ({
        id: candidate.id,
        display_name: candidate.profile?.displayName ?? "",
        handle: candidate.profile?.handle ?? "",
        avatar_url: candidate.profile?.avatarUrl ?? null,
        reason:
          candidate.sharedGenresCount > 0
            ? "Shared genres"
            : "Suggested for you",
      })),
    };
  }

  private normalizeScore(value: number, maxValue: number): number {
    if (maxValue <= 0) {
      return 0;
    }

    return Math.min(value / maxValue, 1);
  }

  private recencyScore(date: Date, nowMs: number, halfLifeDays: number): number {
    const ageMs = Math.max(nowMs - date.getTime(), 0);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.exp(-ageDays / halfLifeDays);
  }

  private computeDiversityScore(
    candidateGenres: Set<number>,
    selectedGenreSets: Set<number>[],
  ): number {
    if (selectedGenreSets.length === 0) {
      return 1;
    }

    let maxSimilarity = 0;

    for (const selectedGenres of selectedGenreSets) {
      const similarity = this.genreJaccardSimilarity(candidateGenres, selectedGenres);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }

    return 1 - maxSimilarity;
  }

  private genreJaccardSimilarity(left: Set<number>, right: Set<number>): number {
    if (left.size === 0 && right.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const value of left) {
      if (right.has(value)) {
        intersection += 1;
      }
    }

    const union = left.size + right.size - intersection;
    if (union === 0) {
      return 0;
    }

    return intersection / union;
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "CANNOT_BLOCK_SELF",
        message: "You cannot block yourself.",
      });
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true, deletedAt: true },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Target user not found.",
      });
    }

    await this.prisma.$transaction([
      this.prisma.userBlock.upsert({
        where: {
          blockerId_blockedId: {
            blockerId,
            blockedId,
          },
        },
        create: {
          blockerId,
          blockedId,
        },
        update: {},
      }),
      this.prisma.userFollow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      }),
    ]);

    return {
      message: "User blocked successfully",
      blockedUserId: blockedId,
    };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException({
        statusCode: 400,
        error: "CANNOT_UNBLOCK_SELF",
        message: "You cannot unblock yourself.",
      });
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true, deletedAt: true },
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Target user not found.",
      });
    }

    const relation = await this.prisma.userBlock.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
      select: { blockerId: true },
    });

    if (!relation) {
      throw new NotFoundException({
        statusCode: 404,
        error: "BLOCK_RELATION_NOT_FOUND",
        message: "User is not currently blocked.",
      });
    }

    await this.prisma.userBlock.delete({
      where: {
        blockerId_blockedId: {
          blockerId,
          blockedId,
        },
      },
    });

    return {
      message: "User unblocked successfully",
      blockedUserId: blockedId,
    };
  }

  async getBlockedUsers(userId: string, query: PaginationQueryDto) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    if (!currentUser || currentUser.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        error: "USER_NOT_FOUND",
        message: "Authenticated user not found.",
      });
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userBlock.count({ where: { blockerId: userId } }),
      this.prisma.userBlock.findMany({
        where: { blockerId: userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          blocked: {
            select: {
              id: true,
              profile: {
                select: {
                  displayName: true,
                  handle: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      blockedUsers: rows.map((row) => ({
        id: row.blocked.id,
        display_name: row.blocked.profile?.displayName ?? "",
        handle: row.blocked.profile?.handle ?? "",
        avatar_url: row.blocked.profile?.avatarUrl ?? null,
        blockedAt: row.createdAt,
      })),
    };
  }
}
