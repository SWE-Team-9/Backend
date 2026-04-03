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

  getSuggestions(query: SuggestionsQueryDto) {
    // TODO: Implement suggested users retrieval.
    void query;
    throw new NotImplementedException("TODO: implement getSuggestions");
  }

  blockUser(params: UserIdParamDto) {
    // TODO: Implement blocking workflow and relationship cleanup.
    void params;
    throw new NotImplementedException("TODO: implement blockUser");
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
