import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { StorageService, UploadType } from "../common/storage/storage.service";
import { isSafeExternalUrl } from "../common/utils/security.utils";
import { UpdateExternalLinksDto, UpdateProfileDto } from "./dto/profile.dto";

const PLATFORM_SLUG_TO_ENUM: Record<string, string> = {
  website: "WEBSITE",
  twitter: "X",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  youtube: "YOUTUBE",
  tiktok: "TIKTOK",
  spotify: "OTHER",
  "apple-music": "OTHER",
  bandcamp: "OTHER",
  soundcloud: "OTHER",
  patreon: "OTHER",
  twitch: "OTHER",
  discord: "OTHER",
  linkedin: "OTHER",
  github: "OTHER",
};

const FULL_PROFILE_SELECT = {
  userId: true,
  handle: true,
  displayName: true,
  bio: true,
  location: true,
  avatarUrl: true,
  coverPhotoUrl: true,
  accountType: true,
  visibility: true,
  likesVisible: true,
  websiteUrl: true,
  updatedAt: true,
  user: {
    select: {
      createdAt: true,
      isVerified: true,
    },
  },
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getProfileByHandle(handle: string, requesterId?: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { handle },
      select: FULL_PROFILE_SELECT,
    });

    if (!profile) {
      throw new NotFoundException("Profile not found.");
    }

    const isOwner = requesterId === profile.userId;
    if (profile.visibility === "PRIVATE" && !isOwner) {
      return {
        handle: profile.handle,
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
        account_type: profile.accountType,
        is_private: true,
      };
    }

    const [genres, socialLinks, trackCount] = await Promise.all([
      this.prisma.userFavoriteGenre.findMany({
        where: { userId: profile.userId },
        include: { genre: true },
      }),
      this.prisma.userSocialLink.findMany({
        where: { userId: profile.userId },
        orderBy: { createdAt: "asc" },
      }),
      profile.accountType === "ARTIST"
        ? this.prisma.track.count({
            where: { uploaderId: profile.userId, deletedAt: null },
          })
        : Promise.resolve(0),
    ]);

    return this.formatFullProfile(profile, genres, socialLinks, trackCount);
  }

  async getMyProfile(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: FULL_PROFILE_SELECT,
    });

    if (!profile) {
      throw new NotFoundException("Profile not found.");
    }

    const [genres, socialLinks, trackCount] = await Promise.all([
      this.prisma.userFavoriteGenre.findMany({
        where: { userId },
        include: { genre: true },
      }),
      this.prisma.userSocialLink.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
      profile.accountType === "ARTIST"
        ? this.prisma.track.count({
            where: { uploaderId: userId, deletedAt: null },
          })
        : Promise.resolve(0),
    ]);

    return this.formatFullProfile(profile, genres, socialLinks, trackCount);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Record<string, unknown> = {};

    if (dto.display_name !== undefined) data.displayName = dto.display_name;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.account_type !== undefined) data.accountType = dto.account_type;

    if (dto.website !== undefined) {
      if (dto.website && !isSafeExternalUrl(dto.website)) {
        throw new BadRequestException("Website URL is not allowed.");
      }
      data.websiteUrl = dto.website || null;
    }

    if (dto.is_private !== undefined) {
      data.visibility = dto.is_private ? "PRIVATE" : "PUBLIC";
    }

    if (dto.favorite_genres !== undefined) {
      const genres = await this.resolveGenreSlugs(dto.favorite_genres);

      return this.prisma.$transaction(async (tx: any) => {
        await tx.userFavoriteGenre.deleteMany({ where: { userId } });

        if (genres.length > 0) {
          await tx.userFavoriteGenre.createMany({
            data: genres.map((g: any) => ({ userId, genreId: g.id })),
          });
        }

        return tx.userProfile.update({ where: { userId }, data });
      });
    }

    return this.prisma.userProfile.update({ where: { userId }, data });
  }

  async checkHandleAvailability(handle: string) {
    const existing = await this.prisma.userProfile.findUnique({
      where: { handle },
      select: { userId: true },
    });

    if (existing) {
      return { available: false };
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentlyRetired = await this.prisma.userHandleHistory.findFirst({
      where: {
        handle,
        isCurrent: false,
        retiredAt: { gte: thirtyDaysAgo },
      },
      select: { id: true },
    });

    return { available: !recentlyRetired };
  }

  async updateExternalLinks(userId: string, dto: UpdateExternalLinksDto) {
    for (const link of dto.links) {
      if (!isSafeExternalUrl(link.url)) {
        throw new BadRequestException(
          `URL for platform "${link.platform}" is not allowed.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx: any) => {
      await tx.userSocialLink.deleteMany({ where: { userId } });

      if (dto.links.length === 0) {
        return [];
      }

      await tx.userSocialLink.createMany({
        data: dto.links.map((link) => ({
          userId,
          platform: this.mapPlatformSlug(link.platform),
          url: link.url,
        })),
      });

      return tx.userSocialLink.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });
    });
  }

  async uploadProfileImage(
    userId: string,
    type: UploadType,
    file: Express.Multer.File,
  ) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { avatarUrl: true, coverPhotoUrl: true },
    });

    if (!profile) {
      throw new NotFoundException("Profile not found.");
    }

    const result = await this.storage.upload(file.buffer, {
      userId,
      type,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    const column = type === "avatar" ? "avatarUrl" : "coverPhotoUrl";
    await this.prisma.userProfile.update({
      where: { userId },
      data: { [column]: result.url },
    });

    const oldUrl =
      type === "avatar" ? profile.avatarUrl : profile.coverPhotoUrl;
    if (oldUrl) {
      const oldKey = this.extractKeyFromUrl(oldUrl);
      if (oldKey) {
        this.storage.delete(oldKey).catch((err) => {
          this.logger.warn(`Old ${type} cleanup failed: ${err}`);
        });
      }
    }

    return { url: result.url };
  }

  private async resolveGenreSlugs(slugs: string[]) {
    if (slugs.length === 0) return [];

    const genres = await this.prisma.genre.findMany({
      where: { slug: { in: slugs } },
    });

    if (genres.length !== slugs.length) {
      const found = new Set(genres.map((g: any) => g.slug));
      const invalid = slugs.filter((s) => !found.has(s));
      throw new BadRequestException(
        `Invalid genre slugs: ${invalid.join(", ")}`,
      );
    }

    return genres;
  }

  private mapPlatformSlug(slug: string): string {
    const mapped = PLATFORM_SLUG_TO_ENUM[slug];
    if (!mapped) {
      throw new BadRequestException(`Unknown platform: ${slug}`);
    }
    return mapped;
  }

  private formatFullProfile(
    profile: any,
    genres: any[],
    socialLinks: any[],
    trackCount: number,
  ) {
    return {
      handle: profile.handle,
      display_name: profile.displayName,
      bio: profile.bio,
      location: profile.location,
      avatar_url: profile.avatarUrl,
      cover_photo_url: profile.coverPhotoUrl,
      account_type: profile.accountType,
      visibility: profile.visibility,
      likes_visible: profile.likesVisible,
      website_url: profile.websiteUrl,
      is_private: profile.visibility === "PRIVATE",
      is_verified: profile.user?.isVerified ?? false,
      created_at: profile.user?.createdAt ?? null,
      updated_at: profile.updatedAt,
      favorite_genres: genres.map((fg) => ({
        slug: fg.genre.slug,
        name: fg.genre.name,
      })),
      social_links: socialLinks.map((sl, index) => ({
        platform: sl.platform,
        url: sl.url,
        sort_order: index,
      })),
      track_count: trackCount,
    };
  }

  private extractKeyFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const key = parsed.pathname.replace(/^\//, "");
      return key || null;
    } catch {
      return null;
    }
  }
}
