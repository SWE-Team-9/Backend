import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PlaylistType, PlaylistVisibility, Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { instanceToPlain, plainToInstance } from 'class-transformer';

import { StorageService } from '../common/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

import {
  AddTrackToPlaylistDto,
  AddTrackToPlaylistResponseDto,
  CreatePlaylistDto,
  GetPlaylistEditResponseDto,
  GetPlaylistEmbedCodeQueryDto,
  GetPlaylistEmbedCodeResponseDto,
  GetPlaylistDetailsResponseDto,
  GetRecentPlaylistsResponseDto,
  PlaylistPaginationQueryDto,
  PlaylistTracksQueryDto,
  RemoveTrackFromPlaylistResponseDto,
  ReorderPlaylistTracksDto,
  ResolveSecretPlaylistResponseDto,
  UpdatePlaylistDto,
  UploadPlaylistCoverResponseDto,
} from './dto';
import { PlaylistEntity } from './entities/playlist.entity';

@Injectable()
export class PlaylistsService {
  private readonly logger = new Logger(PlaylistsService.name);
  private readonly maxPlaylistTracks = 5000;
  private readonly defaultTrackLimit = 100;
  private readonly maxTrackLimit = 200;
  private readonly maxCoverUploadBytes = 5 * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async create(userId: string, dto: CreatePlaylistDto) {
    const visibility = dto.visibility;
    const secretToken =
      visibility === PlaylistVisibility.SECRET
        ? randomBytes(24).toString('hex')
        : null;

    const uniqueTrackIds = this.validateTrackIdArray(dto.trackIds, 'trackIds', true);

    const tracks = await this.prisma.track.findMany({
      where: {
        id: { in: uniqueTrackIds },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (tracks.length !== uniqueTrackIds.length) {
      const foundIds = new Set(tracks.map((track) => track.id));
      const missingIds = uniqueTrackIds.filter((id) => !foundIds.has(id));
      throw this.notFound('TRACK_NOT_FOUND', `Track not found: ${missingIds.join(', ')}`);
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
      throw this.conflict('PLAYLIST_CREATE_FAILED', 'Unable to create playlist. Please retry.');
    }

    this.logAudit('playlist.create', userId, playlist.id, {
      tracksCount: uniqueTrackIds.length,
      visibility: playlist.visibility,
    });

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

  private async generateUniqueSecretToken(excludePlaylistId?: string): Promise<string> {
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

    throw this.conflict('SECRET_TOKEN_GENERATION_FAILED', 'Failed to generate a unique secret token.');
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
          display_name: playlist.owner.profile?.displayName ?? 'Unknown User',
        },
        tracks: playlist.tracks.map(({ track }) => ({
          trackId: track.id,
          title: track.title,
        })),
      },
      { excludeExtraneousValues: true },
    );

    const groups = requesterUserId === playlist.ownerId ? ['owner'] : [];
    const plain = instanceToPlain(entity, { groups }) as GetPlaylistDetailsResponseDto & {
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
    tracksQuery: PlaylistTracksQueryDto = {},
  ): Promise<GetPlaylistDetailsResponseDto> {
    const shouldPaginate = tracksQuery.limit !== undefined || tracksQuery.offset !== undefined;
    const tracksLimit = shouldPaginate
      ? Math.min(tracksQuery.limit ?? this.defaultTrackLimit, this.maxTrackLimit)
      : undefined;
    const tracksOffset = shouldPaginate ? (tracksQuery.offset ?? 0) : undefined;

    const [playlist, trackRows] = await this.prisma.$transaction([
      this.prisma.playlist.findFirst({
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
        },
      }),
      this.prisma.playlistTrack.findMany({
        where: {
          playlistId,
          track: {
            deletedAt: null,
          },
        },
        orderBy: {
          position: 'asc',
        },
        ...(tracksOffset !== undefined ? { skip: tracksOffset } : {}),
        ...(tracksLimit !== undefined ? { take: tracksLimit } : {}),
        select: {
          track: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
    ]);

    if (!playlist) {
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    return this.sanitizePlaylistOutput(
      {
        ...playlist,
        tracks: trackRows,
      },
      requesterUserId,
    );
  }

  async getDetails(
    playlistId: string,
    requesterUserId?: string,
    tracksQuery: PlaylistTracksQueryDto = {},
  ): Promise<GetPlaylistDetailsResponseDto> {
    return this.findOne(playlistId, requesterUserId, tracksQuery);
  }

  async getEditDetails(userId: string, playlistId: string): Promise<GetPlaylistEditResponseDto> {
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
        slug: true,
        coverImageUrl: true,
        coverArtUrl: true,
        type: true,
        releaseDate: true,
        genreId: true,
        tags: true,
      },
    });

    if (!playlist) {
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only edit your own playlists.');
    }

    return {
      playlistId: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      slug: playlist.slug,
      coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
      type: playlist.type,
      releaseDate: playlist.releaseDate ? new Date(playlist.releaseDate as Date).toISOString() : null,
      genreId: playlist.genreId,
      tags: playlist.tags ?? [],
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
        genreId: true,
      },
    });

    if (!playlist) {
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only update your own playlists.');
    }

    const data: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      data.title = dto.title;
    }

    if (dto.description !== undefined) {
      data.description = dto.description;
    }

    if (dto.type !== undefined) {
      data.type = dto.type;
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
        data.secretToken = await this.generateUniqueSecretToken(playlist.id);
      }
    }

    if (dto.releaseDate !== undefined) {
      data.releaseDate = new Date(dto.releaseDate);
    }

    if (dto.genreId !== undefined) {
      if (dto.genreId === null) {
        data.genreId = null;
      } else {
        const genre = await this.prisma.genre.findFirst({
          where: {
            id: dto.genreId,
          },
          select: {
            id: true,
          },
        });

        if (!genre) {
          throw this.notFound('GENRE_NOT_FOUND', 'Genre not found.');
        }

        data.genreId = genre.id;
      }
    }

    if (dto.tags !== undefined) {
      data.tags = Array.from(new Set(dto.tags.map((tag) => tag.trim()).filter(Boolean)));
    }

    if (Object.keys(data).length === 0) {
      throw this.badRequest('PLAYLIST_UPDATE_EMPTY', 'At least one field must be provided for update.');
    }

    const updated = await this.prisma.playlist.update({
      where: { id: playlist.id },
      data: data as any,
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
      } as any,
    }) as any;

    this.logAudit('playlist.update', userId, playlist.id, {
      changedFields: Object.keys(data),
      visibility: updated.visibility,
    });

    return {
      message: 'Playlist updated successfully',
      playlist: this.sanitizePlaylistOutput(updated, userId),
    };
  }

  async uploadCover(
    userId: string,
    playlistId: string,
    file: Express.Multer.File,
  ): Promise<UploadPlaylistCoverResponseDto> {
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
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only edit your own playlists.');
    }

    this.validateCoverUpload(file);

    const uploaded = await this.storageService.upload(file.buffer, {
      userId,
      type: 'cover',
      mimeType: file.mimetype,
      originalName: file.originalname,
    });

    const updated = await this.prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        coverImageUrl: uploaded.url,
        coverArtUrl: uploaded.url,
      } as any,
      select: {
        coverImageUrl: true,
      } as any,
    }) as any;

    this.logAudit('playlist.cover.upload', userId, playlist.id, {
      coverImageUrl: updated.coverImageUrl,
    });

    return {
      message: 'Playlist cover uploaded successfully',
      coverImageUrl: updated.coverImageUrl,
    };
  }

  async remove(userId: string, playlistId: string): Promise<void> {
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
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only delete your own playlists.');
    }

    await this.prisma.playlist.update({
      where: { id: playlist.id },
      data: { deletedAt: new Date() },
    });

    this.logAudit('playlist.delete', userId, playlist.id);
  }

  async getRecentPlaylists(userId: string, limit = 10): Promise<GetRecentPlaylistsResponseDto> {
    const take = Math.min(Math.max(limit ?? 10, 1), 50);

    const recentPlaylists = await this.prisma.playEvent.groupBy({
      by: ['playlistId'],
      where: {
        userId,
        playlistId: {
          not: null,
        },
        
      },
      _max: {
        startedAt: true,
      },
      orderBy: {
        _max: {
          startedAt: 'desc',
        },
      },
      take,
    });

    const playlistIds = recentPlaylists
      .map((entry) => entry.playlistId)
      .filter((playlistId): playlistId is string => Boolean(playlistId));

    if (playlistIds.length === 0) {
      return { playlists: [] };
    }

    const playlists = await this.prisma.playlist.findMany({
      where: {
        id: {
          in: playlistIds,
        },
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
        coverImageUrl: true,
        coverArtUrl: true,
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
      },
    });

    const playlistMap = new Map(playlists.map((playlist) => [playlist.id, playlist]));

    return {
      playlists: playlistIds
        .map((playlistId) => playlistMap.get(playlistId))
        .filter((playlist): playlist is NonNullable<typeof playlist> => Boolean(playlist))
        .map((playlist) => ({
          playlistId: playlist.id,
          title: playlist.title,
          coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
          owner: {
            id: playlist.owner.id,
            display_name: playlist.owner.profile?.displayName ?? 'Unknown User',
          },
        })),
    };
  }

  async likePlaylist(userId: string, playlistId: string): Promise<{ message: string }> {
    const playlistIdResult = await this.prisma.$transaction(async (tx) => {
      const playlist = await tx.playlist.findFirst({
        where: {
          id: playlistId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!playlist) {
        throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
      }

      const existingLike = await tx.playlistLike.findUnique({
        where: {
          userId_playlistId: {
            userId,
            playlistId: playlist.id,
          },
        },
        select: {
          userId: true,
        },
      });

      if (existingLike) {
        throw this.conflict('PLAYLIST_ALREADY_LIKED', 'Playlist already liked.');
      }

      try {
        await tx.playlistLike.create({
          data: {
            userId,
            playlistId: playlist.id,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw this.conflict('PLAYLIST_ALREADY_LIKED', 'Playlist already liked.');
        }

        throw error;
      }

      return playlist.id;
    });

    this.logAudit('playlist.like', userId, playlistIdResult);

    return {
      message: 'Playlist liked successfully',
    };
  }

  private validateCoverUpload(file: Express.Multer.File): void {
    if (!file || !file.buffer) {
      throw this.badRequest('PLAYLIST_COVER_REQUIRED', 'Cover image file is required.');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw this.badRequest(
        'INVALID_COVER_MIME_TYPE',
        'Only image uploads are allowed for playlist covers.',
      );
    }

    if (file.size > this.maxCoverUploadBytes) {
      throw this.badRequest(
        'PLAYLIST_COVER_TOO_LARGE',
        'Playlist cover image must be 5 MB or smaller.',
      );
    }
  }

  async unlikePlaylist(userId: string, playlistId: string): Promise<{ message: string }> {
    const playlist = await this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!playlist) {
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    await this.prisma.playlistLike.deleteMany({
      where: {
        userId,
        playlistId: playlist.id,
      },
    });

    this.logAudit('playlist.unlike', userId, playlist.id);

    return {
      message: 'Playlist unliked successfully',
    };
  }

  async addTrack(
    userId: string,
    playlistId: string,
    dto: AddTrackToPlaylistDto,
  ): Promise<AddTrackToPlaylistResponseDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const playlist = await tx.playlist.findFirst({
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
        throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
      }

      if (playlist.ownerId !== userId) {
        throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only modify your own playlists.');
      }

      const track = await tx.track.findFirst({
        where: {
          id: dto.trackId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!track) {
        throw this.notFound('TRACK_NOT_FOUND', 'Track not found.');
      }

      const stats = await tx.playlistTrack.aggregate({
        where: { playlistId: playlist.id },
        _count: { _all: true },
        _max: { position: true },
      });

      if ((stats._count._all ?? 0) >= this.maxPlaylistTracks) {
        throw this.conflict(
          'PLAYLIST_MAX_TRACKS_REACHED',
          `Playlist cannot exceed ${this.maxPlaylistTracks} tracks.`,
        );
      }

      try {
        await tx.playlistTrack.create({
          data: {
            playlistId: playlist.id,
            trackId: track.id,
            position: (stats._max.position ?? -1) + 1,
          },
        });
      } catch (error) {
        if (
          (error instanceof Prisma.PrismaClientKnownRequestError ||
            typeof (error as { code?: string })?.code === 'string') &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw this.conflict('TRACK_ALREADY_IN_PLAYLIST', 'Track already exists in this playlist.');
        }
        throw error;
      }

      return {
        playlistId: playlist.id,
        trackId: track.id,
      };
    });

    this.logAudit('playlist.track.add', userId, result.playlistId, {
      trackId: result.trackId,
    });

    return {
      message: 'Track added to playlist successfully',
      playlistId: result.playlistId,
      trackId: result.trackId,
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
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only modify your own playlists.');
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
      throw this.notFound('PLAYLIST_TRACK_NOT_FOUND', 'Track is not in this playlist.');
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

    this.logAudit('playlist.track.remove', userId, playlist.id, { trackId });

    return {
      message: 'Track removed from playlist successfully',
    };
  }

  async reorderTracks(userId: string, playlistId: string, dto: ReorderPlaylistTracksDto) {
    const orderedTrackIds = this.validateTrackIdArray(
      dto.orderedTrackIds,
      'orderedTrackIds',
      true,
    );

    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, deletedAt: null },
      select: { id: true, ownerId: true },
    });

    if (!playlist) {
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden('PLAYLIST_OWNER_REQUIRED', 'You can only reorder your own playlists.');
    }

    const existing = await this.prisma.playlistTrack.findMany({
      where: { playlistId: playlist.id },
      select: { trackId: true },
    });

    const existingIds = new Set(existing.map((row) => row.trackId));

    const unknownIds = orderedTrackIds.filter((id) => !existingIds.has(id));
    if (unknownIds.length > 0) {
      throw this.notFound(
        'PLAYLIST_TRACK_NOT_FOUND',
        `Track IDs not found in this playlist: ${unknownIds.join(', ')}`,
      );
    }

    if (orderedTrackIds.length !== existingIds.size) {
      throw this.badRequest(
        'PLAYLIST_REORDER_INCOMPLETE',
        `orderedTrackIds must include all ${existingIds.size} tracks currently in the playlist.`,
      );
    }

    try {
      // Build CASE WHEN statement for position updates
      const caseStatements = orderedTrackIds
        .map((trackId, index) => `WHEN '${trackId}' THEN ${index}`)
        .join(' ');

      await this.prisma.$executeRaw(
        Prisma.sql`
          UPDATE "playlist_tracks"
          SET "position" = CASE "track_id"
            ${Prisma.raw(caseStatements)}
            ELSE "position"
          END
          WHERE "playlist_id" = ${playlist.id}::uuid
        `,
      );
    } catch (error) {
      this.logger.error('Reorder failed:', error);
      throw this.badRequest(
        'PLAYLIST_REORDER_FAILED',
        'Failed to reorder tracks. Please ensure all track IDs are valid.',
      );
    }

    this.logAudit('playlist.tracks.reorder', userId, playlist.id, {
      tracksCount: orderedTrackIds.length,
    });

    return { message: 'Playlist reordered successfully' };
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
          createdAt: 'desc',
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
      throw this.notFound('PLAYLIST_SECRET_NOT_FOUND', 'Secret playlist not found.');
    }

    return {
      playlistId: playlist.id,
      title: playlist.title,
      visibility: 'PRIVATE',
      message: 'Access granted via secret token',
    };
  }

  async getEmbedCode(
    userId: string,
    playlistId: string,
    query: GetPlaylistEmbedCodeQueryDto = {},
  ): Promise<GetPlaylistEmbedCodeResponseDto> {
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
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    if (playlist.ownerId !== userId) {
      throw this.forbidden(
        'PLAYLIST_OWNER_REQUIRED',
        'You can only access embed code for your own playlists.',
      );
    }

    const embedBaseUrl = this.resolveEmbedBaseUrl();
    const embedUrl = new URL(`${embedBaseUrl.replace(/\/+$/, '')}/${playlist.id}`);

    if (playlist.visibility === PlaylistVisibility.SECRET && playlist.secretToken) {
      embedUrl.searchParams.set('token', playlist.secretToken);
    }

    if (query.theme) {
      embedUrl.searchParams.set('theme', query.theme);
    }
    if (query.autoplay !== undefined) {
      embedUrl.searchParams.set('autoplay', String(query.autoplay));
    }
    if (query.start !== undefined) {
      embedUrl.searchParams.set('start', String(query.start));
    }
    if (query.hideArtwork !== undefined) {
      embedUrl.searchParams.set('hideArtwork', String(query.hideArtwork));
    }

    const embedCode = `<iframe src="${embedUrl.toString()}"></iframe>`;

    return {
      playlistId: playlist.id,
      embedCode,
    };
  }

  private resolveEmbedBaseUrl(): string {
    const explicitBaseUrl = process.env.PLAYLIST_EMBED_BASE_URL?.trim();
    if (explicitBaseUrl) {
      return explicitBaseUrl;
    }

    return 'https://example.com/embed/playlists';
  }

  private validateTrackIdArray(
    trackIds: string[],
    fieldName: string,
    requireNonEmpty: boolean,
  ): string[] {
    if (!Array.isArray(trackIds)) {
      throw this.badRequest('INVALID_TRACK_IDS', `${fieldName} must be an array of track IDs.`);
    }

    if (requireNonEmpty && trackIds.length === 0) {
      throw this.badRequest('EMPTY_TRACK_IDS', 'Playlist must start with at least one track.');
    }

    if (trackIds.length > this.maxPlaylistTracks) {
      throw this.badRequest(
        'TRACK_IDS_TOO_LARGE',
        `${fieldName} cannot contain more than ${this.maxPlaylistTracks} IDs.`,
      );
    }

    const uniqueTrackIds = Array.from(new Set(trackIds));
    if (uniqueTrackIds.length !== trackIds.length) {
      throw this.badRequest('DUPLICATE_TRACK_IDS', `${fieldName} must not contain duplicate values.`);
    }

    return uniqueTrackIds;
  }

  private logAudit(
    action: string,
    userId: string,
    playlistId: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'playlist.audit',
        action,
        userId,
        playlistId,
        ...(metadata ?? {}),
      }),
    );
  }

  private badRequest(error: string, message: string): BadRequestException {
    return new BadRequestException(message);
  }

  private conflict(error: string, message: string): ConflictException {
    return new ConflictException(message);
  }

  private forbidden(error: string, message: string): ForbiddenException {
    return new ForbiddenException(message);
  }

  private notFound(error: string, message: string): NotFoundException {
    return new NotFoundException(message);
  }
}
