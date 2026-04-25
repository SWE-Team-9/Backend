import { Injectable } from '@nestjs/common';
import { PlaylistVisibility } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

import {
  AddTrackToPlaylistDto,
  CreatePlaylistDto,
  PlaylistPaginationQueryDto,
  ReorderPlaylistTracksDto,
  UpdatePlaylistDto,
} from './dto';

@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreatePlaylistDto) {
    const visibility = dto.visibility as PlaylistVisibility;
    const slug = await this.generateUniqueSlug(dto.title);
    const secretToken =
      visibility === PlaylistVisibility.SECRET
        ? randomBytes(24).toString('hex')
        : null;

    const playlist = await this.prisma.playlist.create({
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

    return {
      playlistId: playlist.id,
      title: playlist.title,
      visibility: playlist.visibility,
      secretToken: playlist.secretToken,
    };
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

  getDetails(playlistId: string) {
    return {
      message: 'Get playlist details placeholder',
      playlistId,
    };
  }

  update(_userId: string, playlistId: string, dto: UpdatePlaylistDto) {
    return {
      message: 'Update playlist placeholder',
      playlistId,
      payload: dto,
    };
  }

  remove(_userId: string, playlistId: string) {
    return {
      message: 'Delete playlist placeholder',
      playlistId,
    };
  }

  addTrack(_userId: string, playlistId: string, dto: AddTrackToPlaylistDto) {
    return {
      message: 'Add track to playlist placeholder',
      playlistId,
      trackId: dto.trackId,
    };
  }

  removeTrack(_userId: string, playlistId: string, trackId: string) {
    return {
      message: 'Remove track from playlist placeholder',
      playlistId,
      trackId,
    };
  }

  reorderTracks(_userId: string, playlistId: string, dto: ReorderPlaylistTracksDto) {
    return {
      message: 'Reorder playlist tracks placeholder',
      playlistId,
      orderedTrackIds: dto.orderedTrackIds,
    };
  }

  getMyPlaylists(_userId: string, query: PlaylistPaginationQueryDto) {
    return {
      message: 'Get my playlists placeholder',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      playlists: [],
    };
  }

  resolveSecret(secretToken: string) {
    return {
      message: 'Resolve secret playlist placeholder',
      secretToken,
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
