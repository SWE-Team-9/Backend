import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SocialPlatform, ProfileVisibility, AccountType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService, UploadType } from '../common/storage/storage.service';
import { isSafeExternalUrl } from '../common/utils/security.utils';
import { UpdateProfileDto } from './dto/profile.dto';
import { UpdateExternalLinksDto } from './dto/profile.dto';

const PLATFORM_SLUG_TO_ENUM: Record<string, SocialPlatform> = {
  website: SocialPlatform.WEBSITE,
  twitter: SocialPlatform.TWITTER,
  instagram: SocialPlatform.INSTAGRAM,
  facebook: SocialPlatform.FACEBOOK,
  youtube: SocialPlatform.YOUTUBE,
  tiktok: SocialPlatform.TIKTOK,
  spotify: SocialPlatform.SPOTIFY,
  'apple-music': SocialPlatform.APPLE_MUSIC,
  bandcamp: SocialPlatform.BANDCAMP,
  soundcloud: SocialPlatform.SOUNDCLOUD,
  patreon: SocialPlatform.PATREON,
  twitch: SocialPlatform.TWITCH,
  discord: SocialPlatform.DISCORD,
  linkedin: SocialPlatform.LINKEDIN,
  github: SocialPlatform.GITHUB,
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

  // Returns a reduced shape for PRIVATE profiles the caller doesn't own:
  // { handle, display_name, avatar_url, account_type, is_private: true }.
  async getProfileByHandle(handle: string, requesterId?: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { handle },
      select: {
        ...FULL_PROFILE_SELECT,
        userId: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found.');
    }

    // Always let the owner see their full profile
    const isOwner = requesterId === profile.userId;

    if (profile.visibility === ProfileVisibility.PRIVATE && !isOwner) {
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
        orderBy: { sortOrder: 'asc' },
      }),
      profile.accountType === AccountType.ARTIST
        ? this.prisma.track.count({
            where: { uploaderId: profile.userId, deletedAt: null },
          })
        : Promise.resolve(0),
    ]);

    return this.formatFullProfile(profile, genres, socialLinks, trackCount);
  }

  // No privacy gating - always returns the full shape.
  async getMyProfile(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: FULL_PROFILE_SELECT,
    });

    if (!profile) {
      throw new NotFoundException('Profile not found.');
    }

    const [genres, socialLinks, trackCount] = await Promise.all([
      this.prisma.userFavoriteGenre.findMany({
        where: { userId },
        include: { genre: true },
      }),
      this.prisma.userSocialLink.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.track.count({
        where: { uploaderId: userId, deletedAt: null },
      }),
    ]);

    return this.formatFullProfile(profile, genres, socialLinks, trackCount);
  }

  // Partial update - only fields present in the dto are written.
  // Passing website: '' clears the stored URL to null.
  // If favorite_genres is present the genre swap runs inside a transaction.
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    // Build the flat update payload - only set keys that were provided
    const data: Record<string, unknown> = {};

    if (dto.display_name !== undefined) data.displayName = dto.display_name;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.account_type !== undefined) data.accountType = dto.account_type;

    if (dto.website !== undefined) {
      if (dto.website && !isSafeExternalUrl(dto.website)) {
        throw new BadRequestException('Website URL is not allowed.');
      }
      data.websiteUrl = dto.website || null;
    }

    if (dto.is_private !== undefined) {
      data.visibility = dto.is_private
        ? ProfileVisibility.PRIVATE
        : ProfileVisibility.PUBLIC;
    }

    // Genre swap needs a transaction - lookup genres by slug first
    if (dto.favorite_genres !== undefined) {
      const genres = await this.resolveGenreSlugs(dto.favorite_genres);

      return this.prisma.$transaction(async (tx) => {
        await tx.userFavoriteGenre.deleteMany({ where: { userId } });

        if (genres.length > 0) {
          await tx.userFavoriteGenre.createMany({
            data: genres.map((g) => ({ userId, genreId: g.id })),
          });
        }

        return tx.userProfile.update({ where: { userId }, data });
      });
    }

    return this.prisma.userProfile.update({ where: { userId }, data });
  }

  // Returns { available: boolean }. Blocks live handles and those retired within the last 30 days.
  async checkHandleAvailability(handle: string) {
    const existing = await this.prisma.userProfile.findUnique({
      where: { handle },
      select: { userId: true },
    });

    if (existing) {
      return { available: false };
    }

    // Also block handles retired within the last 30 days to prevent
    // impersonation after a handle change.
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

  // All URLs are SSRF-checked before the transaction opens.
  // No incremental merging - existing rows are dropped and re-inserted in full.
  async updateExternalLinks(userId: string, dto: UpdateExternalLinksDto) {
    for (const link of dto.links) {
      if (!isSafeExternalUrl(link.url)) {
        throw new BadRequestException(
          `URL for platform "${link.platform}" is not allowed.`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.userSocialLink.deleteMany({ where: { userId } });

      if (dto.links.length === 0) return [];

      const records = dto.links.map((link, idx) => ({
        userId,
        platform: this.mapPlatformSlug(link.platform),
        url: link.url,
        sortOrder: link.sort_order ?? idx,
      }));

      await tx.userSocialLink.createMany({ data: records });

      return tx.userSocialLink.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  // Old asset deletion is fire-and-forget; a cleanup failure does not affect the response.
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
      throw new NotFoundException('Profile not found.');
    }

    const result = await this.storage.upload(file.buffer, {
      userId,
      type,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    const column = type === 'avatar' ? 'avatarUrl' : 'coverPhotoUrl';
    await this.prisma.userProfile.update({
      where: { userId },
      data: { [column]: result.url },
    });

    // Best-effort cleanup of the old image
    const oldUrl = type === 'avatar' ? profile.avatarUrl : profile.coverPhotoUrl;
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

  // Resolve an array of genre slugs to Genre records; throws on invalid slug.
  private async resolveGenreSlugs(slugs: string[]) {
    if (slugs.length === 0) return [];

    const genres = await this.prisma.genre.findMany({
      where: { slug: { in: slugs } },
    });

    if (genres.length !== slugs.length) {
      const found = new Set(genres.map((g) => g.slug));
      const invalid = slugs.filter((s) => !found.has(s));
      throw new BadRequestException(
        `Invalid genre slugs: ${invalid.join(', ')}`,
      );
    }

    return genres;
  }

  private mapPlatformSlug(slug: string): SocialPlatform {
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
      is_private: profile.visibility === ProfileVisibility.PRIVATE,
      is_verified: profile.user?.isVerified ?? false,
      created_at: profile.user?.createdAt ?? null,
      updated_at: profile.updatedAt,
      favorite_genres: genres.map((fg) => ({
        slug: fg.genre.slug,
        name: fg.genre.name,
      })),
      social_links: socialLinks.map((sl) => ({
        platform: sl.platform,
        url: sl.url,
        sort_order: sl.sortOrder,
      })),
      // track_count is 0 for non-ARTIST accounts.
      track_count: trackCount,
    };
  }

  // Strips the URL origin; the remaining path is the storage key.
  private extractKeyFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const key = parsed.pathname.replace(/^\//, '');
      return key || null;
    } catch {
      return null;
    }
  }
}
