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

  unfollowUser(params: UserIdParamDto) {
    // TODO: Implement follow relationship removal.
    void params;
    throw new NotImplementedException("TODO: implement unfollowUser");
  }

  getFollowers(params: UserIdParamDto, query: PaginationQueryDto) {
    // TODO: Implement paginated followers list retrieval.
    void params;
    void query;
    throw new NotImplementedException("TODO: implement getFollowers");
  }

  getFollowing(params: UserIdParamDto, query: PaginationQueryDto) {
    // TODO: Implement paginated following list retrieval.
    void params;
    void query;
    throw new NotImplementedException("TODO: implement getFollowing");
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
