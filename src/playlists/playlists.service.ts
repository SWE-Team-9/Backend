import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PlaylistVisibility, Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { instanceToPlain, plainToInstance } from "class-transformer";
import { randomUUID } from "crypto";

import { PrismaService } from "../prisma/prisma.service";

import {
  AddTrackToPlaylistDto,
  AddTrackToPlaylistResponseDto,
  CreatePlaylistDto,
  GetPlaylistEmbedCodeResponseDto,
  GetPlaylistDetailsResponseDto,
  PlaylistPaginationQueryDto,
  RemoveTrackFromPlaylistResponseDto,
  ReorderPlaylistTracksDto,
  ResolveSecretPlaylistResponseDto,
  UpdatePlaylistDto,
} from "./dto";
import { PlaylistEntity } from "./entities/playlist.entity";

@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePlaylistDto) {
    const visibility = dto.visibility;
    const secretToken =
      visibility === PlaylistVisibility.SECRET
        ? randomBytes(24).toString("hex")
        : null;

    if (!dto.trackIds || dto.trackIds.length === 0) {
      throw new BadRequestException(
        "Playlist must start with at least one track.",
      );
    }

    const uniqueTrackIds = Array.from(new Set(dto.trackIds));
    if (uniqueTrackIds.length !== dto.trackIds.length) {
      throw new BadRequestException(
        "trackIds must not contain duplicate values.",
      );
    }

    const tracks = await this.prisma.track.findMany({
      where: {
        id: { in: uniqueTrackIds },
        deletedAt: null,
      },
      select: { id: true, title: true },
    });

    if (tracks.length !== uniqueTrackIds.length) {
      const foundIds = new Set(tracks.map((track) => track.id));
      const missingIds = uniqueTrackIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Track not found: ${missingIds.join(", ")}`);
    }

    const normalizedTitles = tracks.map((track) =>
      track.title.trim().toLowerCase(),
    );
    if (new Set(normalizedTitles).size !== normalizedTitles.length) {
      throw new ConflictException(
        "Playlist cannot contain duplicate track names.",
      );
    }

    let playlist: {
      id: string;
      title: string;
      visibility: PlaylistVisibility;
      secretToken: string | null;
    } | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = await this.generateUniqueSlug(dto.title);

      try {
        playlist = await this.prisma.$transaction(async (tx) => {
          const created = await tx.playlist.create({
            data: {
              ownerId: userId,
              title: dto.title,
              description: dto.description ?? null,
              visibility,
              secretToken,
              slug,
            },
            select: {
              id: true,
              title: true,
              visibility: true,
              secretToken: true,
            },
          });

          await tx.playlistTrack.createMany({
            data: uniqueTrackIds.map((trackId, index) => ({
              playlistId: created.id,
              trackId,
              position: index,
            })),
          });

          return created;
        });

        break;
      } catch (error) {
        if (this.isSlugUniqueViolation(error) && attempt < 2) {
          continue;
        }

        throw error;
      }
    }

    if (!playlist) {
      throw new ConflictException("Unable to create playlist. Please retry.");
    }

    return {
      playlistId: playlist.id,
      title: playlist.title,
      visibility: playlist.visibility,
      secretToken: playlist.secretToken,
    };
  }

  private isSlugUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== "P2002") {
      return false;
    }

    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes("slug");
    }

    return typeof target === "string" && target.includes("slug");
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const baseSlug = this.slugify(title) || "playlist";

    const baseExists = await this.prisma.playlist.findFirst({
      where: { slug: baseSlug },
      select: { id: true },
    });

    if (!baseExists) {
      return baseSlug;
    }

    for (let i = 0; i < 10; i += 1) {
      const suffix = randomBytes(3).toString("hex");
      const candidate = `${baseSlug}-${suffix}`;
      const exists = await this.prisma.playlist.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!exists) {
        return candidate;
      }
    }

    return `${baseSlug}-${Date.now()}`;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  private async generateUniqueSecretToken(
    excludePlaylistId?: string,
  ): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const candidate = randomUUID();
      const existing = await this.prisma.playlist.findFirst({
        where: {
          secretToken: candidate,
          ...(excludePlaylistId ? { id: { not: excludePlaylistId } } : {}),
        },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new ConflictException("Failed to generate a unique secret token.");
  }

  private sanitizePlaylistOutput(
    playlist: {
      id: string;
      title: string;
      description: string | null;
      visibility: PlaylistVisibility;
      secretToken: string | null;
      ownerId: string;
      owner: { id: string; profile: { displayName: string } | null };
      tracks: Array<{ track: { id: string; title: string } }>;
    },
    requesterUserId?: string,
  ): GetPlaylistDetailsResponseDto {
    const entity = plainToInstance(
      PlaylistEntity,
      {
        playlistId: playlist.id,
        title: playlist.title,
        description: playlist.description,
        visibility: playlist.visibility,
        secretToken: playlist.secretToken,
        owner: {
          id: playlist.owner.id,
          display_name: playlist.owner.profile?.displayName ?? "Unknown User",
        },
        tracks: playlist.tracks.map(({ track }) => ({
          trackId: track.id,
          title: track.title,
        })),
      },
      { excludeExtraneousValues: true },
    );

    const groups = requesterUserId === playlist.ownerId ? ["owner"] : [];
    const plain = instanceToPlain(entity, {
      groups,
    }) as GetPlaylistDetailsResponseDto & {
      secretToken?: string | null;
    };

    if (requesterUserId === playlist.ownerId) {
      plain.secretToken = playlist.secretToken;
    } else {
      delete plain.secretToken;
    }

    return plain;
  }

  async findOne(
    playlistId: string,
    requesterUserId?: string,
  ): Promise<GetPlaylistDetailsResponseDto> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerId: true,
        title: true,
        description: true,
        visibility: true,
        secretToken: true,
        owner: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        tracks: {
          where: {
            track: {
              deletedAt: null,
            },
          },
          orderBy: {
            position: "asc",
          },
          select: {
            track: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    return this.sanitizePlaylistOutput(playlist, requesterUserId);
  }

  async getDetails(
    playlistId: string,
    requesterUserId?: string,
  ): Promise<GetPlaylistDetailsResponseDto> {
    return this.findOne(playlistId, requesterUserId);
  }

  async update(userId: string, playlistId: string, dto: UpdatePlaylistDto) {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerId: true,
        visibility: true,
        secretToken: true,
      },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException("You can only update your own playlists.");
    }

    const data: Prisma.PlaylistUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title;
    }

    if (dto.description !== undefined) {
      data.description = dto.description;
    }

    if (dto.visibility !== undefined) {
      const normalizedVisibility =
        dto.visibility === "PRIVATE"
          ? PlaylistVisibility.SECRET
          : dto.visibility;

      data.visibility = normalizedVisibility;

      if (normalizedVisibility === PlaylistVisibility.PUBLIC) {
        data.secretToken = null;
      } else if (
        playlist.visibility !== PlaylistVisibility.SECRET ||
        !playlist.secretToken
      ) {
        data.secretToken = await this.generateUniqueSecretToken(playlist.id);
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        "At least one field must be provided for update.",
      );
    }

    const updated = await this.prisma.playlist.update({
      where: { id: playlist.id },
      data,
      select: {
        id: true,
        ownerId: true,
        title: true,
        description: true,
        visibility: true,
        secretToken: true,
        owner: {
          select: {
            id: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        tracks: {
          where: {
            track: {
              deletedAt: null,
            },
          },
          orderBy: {
            position: "asc",
          },
          select: {
            track: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    return {
      message: "Playlist updated successfully",
      playlist: this.sanitizePlaylistOutput(updated, userId),
    };
  }

  async remove(userId: string, playlistId: string): Promise<void> {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException("You can only delete your own playlists.");
    }

    await this.prisma.playlist.delete({
      where: { id: playlist.id },
    });
  }

  async addTrack(
    userId: string,
    playlistId: string,
    dto: AddTrackToPlaylistDto,
  ): Promise<AddTrackToPlaylistResponseDto> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException("You can only modify your own playlists.");
    }

    const track = await this.prisma.track.findFirst({
      where: {
        id: dto.trackId,
        deletedAt: null,
      },
      select: { id: true, title: true },
    });

    if (!track) {
      throw new NotFoundException("Track not found.");
    }

    const existingLink = await this.prisma.playlistTrack.findUnique({
      where: {
        playlistId_trackId: {
          playlistId: playlist.id,
          trackId: track.id,
        },
      },
      select: { playlistId: true },
    });

    if (existingLink) {
      throw new ConflictException("Track already exists in this playlist.");
    }

    const duplicateTrackTitle = await this.prisma.playlistTrack.findFirst({
      where: {
        playlistId: playlist.id,
        trackId: {
          not: track.id,
        },
        track: {
          deletedAt: null,
          title: {
            equals: track.title,
            mode: "insensitive",
          },
        },
      },
      select: { trackId: true },
    });

    if (duplicateTrackTitle) {
      throw new ConflictException(
        "A track with the same title already exists in this playlist.",
      );
    }

    const maxPositionRow = await this.prisma.playlistTrack.findFirst({
      where: { playlistId: playlist.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    await this.prisma.playlistTrack.create({
      data: {
        playlistId: playlist.id,
        trackId: track.id,
        position: (maxPositionRow?.position ?? -1) + 1,
      },
    });

    return {
      message: "Track added to playlist successfully",
      playlistId: playlist.id,
      trackId: track.id,
    };
  }

  async removeTrack(
    userId: string,
    playlistId: string,
    trackId: string,
  ): Promise<RemoveTrackFromPlaylistResponseDto> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException("You can only modify your own playlists.");
    }

    const playlistTrack = await this.prisma.playlistTrack.findUnique({
      where: {
        playlistId_trackId: {
          playlistId: playlist.id,
          trackId,
        },
      },
      select: {
        position: true,
      },
    });

    if (!playlistTrack) {
      throw new NotFoundException("Track is not in this playlist.");
    }

    await this.prisma.$transaction([
      this.prisma.playlistTrack.delete({
        where: {
          playlistId_trackId: {
            playlistId: playlist.id,
            trackId,
          },
        },
      }),
      this.prisma.playlistTrack.updateMany({
        where: {
          playlistId: playlist.id,
          position: {
            gt: playlistTrack.position,
          },
        },
        data: {
          position: {
            decrement: 1,
          },
        },
      }),
    ]);

    return {
      message: "Track removed from playlist successfully",
    };
  }

  async reorderTracks(
    userId: string,
    playlistId: string,
    dto: ReorderPlaylistTracksDto,
  ) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, deletedAt: null },
      select: { id: true, ownerId: true },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    // 2. Only the owner may reorder
    if (playlist.ownerId !== userId) {
      throw new ForbiddenException("You can only reorder your own playlists.");
    }

    // 3. Load all existing track entries for this playlist
    const existing = await this.prisma.playlistTrack.findMany({
      where: { playlistId: playlist.id },
      select: { trackId: true },
    });

    const existingIds = new Set(existing.map((r) => r.trackId));

    // 4. Reject any IDs not in this playlist
    const unknownIds = dto.orderedTrackIds.filter((id) => !existingIds.has(id));
    if (unknownIds.length > 0) {
      throw new NotFoundException(
        `Track IDs not found in this playlist: ${unknownIds.join(", ")}`,
      );
    }

    // 5. Require full coverage — every track must be represented
    if (dto.orderedTrackIds.length !== existingIds.size) {
      throw new BadRequestException(
        `orderedTrackIds must include all ${existingIds.size} tracks currently in the playlist.`,
      );
    }

    // 6. Atomic position update — single transaction, one UPDATE per track
    await this.prisma.$transaction(
      dto.orderedTrackIds.map((trackId, index) =>
        this.prisma.playlistTrack.update({
          where: { playlistId_trackId: { playlistId: playlist.id, trackId } },
          data: { position: index },
        }),
      ),
    );

    return { message: "Playlist reordered successfully" };
  }

  async getMyPlaylists(userId: string, query: PlaylistPaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PlaylistWhereInput = {
      ownerId: userId,
      deletedAt: null,
    };

    const [total, playlists] = await this.prisma.$transaction([
      this.prisma.playlist.count({ where }),
      this.prisma.playlist.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          visibility: true,
          _count: {
            select: {
              tracks: true,
            },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      playlists: playlists.map((playlist) => ({
        playlistId: playlist.id,
        title: playlist.title,
        visibility: playlist.visibility,
        tracksCount: playlist._count.tracks,
      })),
    };
  }

  async resolveSecret(
    secretToken: string,
  ): Promise<ResolveSecretPlaylistResponseDto> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        secretToken,
        visibility: PlaylistVisibility.SECRET,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!playlist) {
      throw new NotFoundException("Secret playlist not found.");
    }

    return {
      playlistId: playlist.id,
      title: playlist.title,
      visibility: "PRIVATE",
      message: "Access granted via secret token",
    };
  }

  async getEmbedCode(
    userId: string,
    playlistId: string,
  ): Promise<GetPlaylistEmbedCodeResponseDto> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!playlist) {
      throw new NotFoundException("Playlist not found.");
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException(
        "You can only access embed code for your own playlists.",
      );
    }

    return {
      playlistId: playlist.id,
      embedCode: `<iframe src="https://example.com/embed/playlists/${playlist.id}"></iframe>`,
    };
  }
}
