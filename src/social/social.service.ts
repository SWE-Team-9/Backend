import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

  async blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ message: string; blockedUserId: string }> {
    if (blockerId === blockedId) {
      throw new ForbiddenException({
        code: "CANNOT_BLOCK_SELF",
        message: "You cannot block yourself.",
      });
    }

    await this.ensureUserExists(blockedId);

    const existing = await this.prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });

    if (existing) {
      throw new ConflictException({
        code: "USER_ALREADY_BLOCKED",
        message: "User is already blocked.",
      });
    }

    // Remove any follow relationship in both directions and create the block
    await this.prisma.$transaction([
      this.prisma.userFollow.deleteMany({
        where: { followerId: blockerId, followingId: blockedId },
      }),
      this.prisma.userFollow.deleteMany({
        where: { followerId: blockedId, followingId: blockerId },
      }),
      this.prisma.userBlock.create({
        data: { blockerId, blockedId },
      }),
    ]);

    return {
      message: "User blocked successfully",
      blockedUserId: blockedId,
    };
  }

  async unblockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ message: string; blockedUserId: string }> {
    const result = await this.prisma.userBlock.deleteMany({
      where: { blockerId, blockedId },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: "USER_BLOCK_NOT_FOUND",
        message: "User is not blocked.",
      });
    }

    return {
      message: "User unblocked successfully",
      blockedUserId: blockedId,
    };
  }

  async getBlockedUsers(userId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;

    const where = { blockerId: userId };

    const [total, blocks] = await this.prisma.$transaction([
      this.prisma.userBlock.count({ where }),
      this.prisma.userBlock.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          createdAt: true,
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
      limit: take,
      total,
      blockedUsers: blocks.map((block) => ({
        id: block.blocked.id,
        display_name: block.blocked.profile?.displayName ?? null,
        handle: block.blocked.profile?.handle ?? null,
        avatar_url: block.blocked.profile?.avatarUrl ?? null,
        blockedAt: block.createdAt,
      })),
    };
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "User not found.",
      });
    }
  }
}
