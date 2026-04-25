import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlaylistVisibility, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

import {
  AddTrackToPlaylistDto,
  AddTrackToPlaylistResponseDto,
  CreatePlaylistDto,
  GetPlaylistDetailsResponseDto,
  PlaylistPaginationQueryDto,
  RemoveTrackFromPlaylistResponseDto,
  ReorderPlaylistTracksDto,
  ResolveSecretPlaylistResponseDto,
  UpdatePlaylistDto,
} from './dto';

@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePlaylistDto) {
    const visibility = dto.visibility;
    const secretToken =
      visibility === PlaylistVisibility.SECRET
        ? randomBytes(24).toString('hex')
        : null;

    const track = await this.prisma.track.findFirst({
      where: {
        id: dto.trackId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!track) {
      throw new NotFoundException('Track not found.');
    }

    let playlist:
      | {
          id: string;
          title: string;
          visibility: PlaylistVisibility;
          secretToken: string | null;
        }
      | null = null;

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

          await tx.playlistTrack.create({
            data: {
              playlistId: created.id,
              trackId: track.id,
              position: 0,
            },
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
      throw new ConflictException('Unable to create playlist. Please retry.');
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

    if (error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('slug');
    }

    return typeof target === 'string' && target.includes('slug');
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const baseSlug = this.slugify(title) || 'playlist';

    const baseExists = await this.prisma.playlist.findFirst({
      where: { slug: baseSlug },
      select: { id: true },
    });

    if (!baseExists) {
      return baseSlug;
    }

    for (let i = 0; i < 10; i += 1) {
      const suffix = randomBytes(3).toString('hex');
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
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  async getDetails(playlistId: string): Promise<GetPlaylistDetailsResponseDto> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        description: true,
        visibility: true,
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
            position: 'asc',
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
      throw new NotFoundException('Playlist not found.');
    }

    return {
      playlistId: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      owner: {
        id: playlist.owner.id,
        display_name: playlist.owner.profile?.displayName ?? 'Unknown User',
      },
      tracks: playlist.tracks.map(({ track }) => ({
        trackId: track.id,
        title: track.title,
      })),
    };
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
      throw new NotFoundException('Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException('You can only update your own playlists.');
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
        dto.visibility === 'PRIVATE' ? PlaylistVisibility.SECRET : dto.visibility;

      data.visibility = normalizedVisibility;

      if (normalizedVisibility === PlaylistVisibility.PUBLIC) {
        data.secretToken = null;
      } else if (
        playlist.visibility !== PlaylistVisibility.SECRET ||
        !playlist.secretToken
      ) {
        data.secretToken = randomBytes(24).toString('hex');
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one field must be provided for update.');
    }

    await this.prisma.playlist.update({
      where: { id: playlist.id },
      data,
    });

    return {
      message: 'Playlist updated successfully',
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
      throw new NotFoundException('Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException('You can only delete your own playlists.');
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
      throw new NotFoundException('Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException('You can only modify your own playlists.');
    }

    const track = await this.prisma.track.findFirst({
      where: {
        id: dto.trackId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!track) {
      throw new NotFoundException('Track not found.');
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
      throw new ConflictException('Track already exists in this playlist.');
    }

    const maxPositionRow = await this.prisma.playlistTrack.findFirst({
      where: { playlistId: playlist.id },
      orderBy: { position: 'desc' },
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
      message: 'Track added to playlist successfully',
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
      throw new NotFoundException('Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw new ForbiddenException('You can only modify your own playlists.');
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
      throw new NotFoundException('Track is not in this playlist.');
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
      message: 'Track removed from playlist successfully',
    };
  }

  async reorderTracks(userId: string, playlistId: string, dto: ReorderPlaylistTracksDto) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, deletedAt: null },
      select: { id: true, ownerId: true },
    });
 
    if (!playlist) {
      throw new NotFoundException('Playlist not found.');
    }
 
    // 2. Only the owner may reorder
    if (playlist.ownerId !== userId) {
      throw new ForbiddenException('You can only reorder your own playlists.');
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
        `Track IDs not found in this playlist: ${unknownIds.join(', ')}`,
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
 
    return { message: 'Playlist reordered successfully' };
  }

  getMyPlaylists(_userId: string, query: PlaylistPaginationQueryDto) {
    return {
      message: 'Get my playlists placeholder',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      playlists: [],
    };
  }

  async resolveSecret(secretToken: string): Promise<ResolveSecretPlaylistResponseDto> {
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
      throw new NotFoundException('Secret playlist not found.');
    }

    return {
      playlistId: playlist.id,
      title: playlist.title,
      visibility: 'PRIVATE',
      message: 'Access granted via secret token',
    };
  }

  getEmbedCode(playlistId: string) {
    return {
      message: 'Get playlist embed code placeholder',
      playlistId,
      embedCode: `<iframe src="https://example.com/embed/playlists/${playlistId}"></iframe>`,
    };
  }
}
