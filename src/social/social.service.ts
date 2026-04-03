import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { SuggestionsQueryDto } from "./dto/suggestions-query.dto";
import { UserIdParamDto } from "./dto/user-id-param.dto";

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

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

    const [followingRows, blocksByMe, blocksAgainstMe, myGenres] =
      await this.prisma.$transaction([
        this.prisma.userFollow.findMany({
          where: { followerId: userId },
          select: { followingId: true },
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

    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludedUserIds) },
        deletedAt: null,
      },
      take: Math.max(limit * 3, limit),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
            handle: true,
            avatarUrl: true,
          },
        },
        favoriteGenres: {
          where:
            myGenreIds.length > 0 ? { genreId: { in: myGenreIds } } : undefined,
          select: { genreId: true },
        },
      },
    });

    return {
      suggestions: candidates.slice(0, limit).map((candidate) => ({
        id: candidate.id,
        display_name: candidate.profile?.displayName ?? "",
        handle: candidate.profile?.handle ?? "",
        avatar_url: candidate.profile?.avatarUrl ?? null,
        reason:
          candidate.favoriteGenres.length > 0
            ? "Shared genres"
            : "Suggested for you",
      })),
    };
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

  unblockUser(params: UserIdParamDto) {
    // TODO: Implement unblocking workflow.
    void params;
    throw new NotImplementedException("TODO: implement unblockUser");
  }

  getBlockedUsers(query: PaginationQueryDto) {
    // TODO: Implement paginated blocked users retrieval.
    void query;
    throw new NotImplementedException("TODO: implement getBlockedUsers");
  }
}
