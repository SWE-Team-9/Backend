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

import { StorageService } from '../common/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

import {
  AddTrackToPlaylistDto,
  AddTrackToPlaylistResponseDto,
  CreatePlaylistDto,
  CreatePlaylistResponseDto,
  GetPlaylistDetailsResponseDto,
  GetPlaylistEditResponseDto,
  GetPlaylistEmbedCodeQueryDto,
  GetPlaylistEmbedCodeResponseDto,
  GetRecentPlaylistsResponseDto,
  GetTopPlaylistsResponseDto,
  PlaylistPaginationQueryDto,
  PlaylistTracksQueryDto,
  RemoveTrackFromPlaylistResponseDto,
  ReorderPlaylistTracksDto,
  ResolveSecretPlaylistResponseDto,
  PlaylistItemDto,
  GetPlaylistLikedResponseDto,
  UpdatePlaylistDto,
  UploadPlaylistCoverResponseDto,
} from './dto';

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

  async create(userId: string, dto: CreatePlaylistDto): Promise<CreatePlaylistResponseDto> {
    const { visibility } = dto;
    const secretToken =
      visibility === PlaylistVisibility.SECRET ? randomBytes(24).toString('hex') : null;
    const owner = await this.prisma.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        profile: {
          select: {
            displayName: true,
          },
        },
      },
    });

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
    let genreId: number | null = null;

    if (dto.genre) {
      const genre = await this.prisma.genre.findUnique({
        where: { slug: dto.genre },
        select: { id: true },
      });

      if (!genre) {
        throw this.badRequest('INVALID_GENRE', 'Genre not found.');
      }

      genreId = genre.id;
    }

    let playlist: {
      id: string;
      title: string;
      visibility: PlaylistVisibility;
      secretToken: string | null;
      createdAt: Date | string;
      releaseDate?: Date | string | null;
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
              genreId,
            },
            select: {
              id: true,
              title: true,
              createdAt: true,
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
      coverImageUrl: null,
      genre: dto.genre ?? null,
      releaseDate: playlist.createdAt ? new Date(playlist.createdAt).toISOString() : null,
      tracksCount: uniqueTrackIds.length,
      likesCount: 0,
      isLiked: false,
      owner: {
        id: owner?.id ?? userId,
        displayName: owner?.profile?.displayName ?? 'Unknown User',
      },
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

    throw this.conflict(
      'SECRET_TOKEN_GENERATION_FAILED',
      'Failed to generate a unique secret token.',
    );
  }

  private sanitizePlaylistOutput(
    playlist: {
      id: string;
      title: string;
      description: string | null;
      visibility: PlaylistVisibility;
      secretToken: string | null;
      ownerId: string;
      coverImageUrl?: string | null;
      coverArtUrl?: string | null;
      likesCount?: number;
      genre: { slug: string } | null;
      createdAt?: Date | string | null;
      releaseDate?: Date | string | null;
      owner: { id: string; profile: { displayName: string } | null };
      tracks: Array<{
        track: {
          id: string;
          title: string;
          coverArtUrl: string | null;
          durationMs: number | null;
          _count?: { likes: number; reposts: number };
          uploader: {
            id: string;
            profile: { displayName: string | null; handle: string | null } | null;
          };
        };
      }>;
    },
    requesterUserId?: string,
    isLiked = false,
  ): GetPlaylistDetailsResponseDto {
    return {
      playlistId: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
      likesCount: playlist.likesCount ?? 0,
      isLiked,
      releaseDate: (playlist.releaseDate ?? playlist.createdAt)
        ? new Date((playlist.releaseDate ?? playlist.createdAt)!).toISOString()
        : null,
      ...(requesterUserId === playlist.ownerId && playlist.secretToken
        ? { secretToken: playlist.secretToken }
        : {}),
      genre: playlist.genre?.slug ?? null,
      owner: {
        id: playlist.owner.id,
        displayName: playlist.owner.profile?.displayName ?? 'Unknown User',
      },
      tracks: playlist.tracks.map(({ track }) => {
        const uploaderProfile = track.uploader.profile;
        return {
          trackId: track.id,
          title: track.title,
          coverArtUrl: track.coverArtUrl,
          durationMs: track.durationMs ?? null,
          likesCount: track._count?.likes ?? 0,
          repostsCount: track._count?.reposts ?? 0,
          artist: {
            id: track.uploader.id,
            name: uploaderProfile?.displayName ?? uploaderProfile?.handle ?? 'Unknown User',
            handle: uploaderProfile?.handle ?? null,
          },
        };
      }),
    };
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
          coverImageUrl: true,
          coverArtUrl: true,
          likesCount: true,
          createdAt: true,
          releaseDate: true,
          genre: {
            select: {
              slug: true,
            },
          },
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
              coverArtUrl: true,
              durationMs: true,
              _count: { select: { likes: true, reposts: true } },
              uploader: {
                select: {
                  id: true,
                  profile: {
                    select: {
                      displayName: true,
                      handle: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    if (!playlist) {
      throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
    }

    let isLiked = false;
    if (requesterUserId) {
      const like = await this.prisma.playlistLike.findUnique({
        where: { userId_playlistId: { userId: requesterUserId, playlistId } },
        select: { userId: true },
      });
      isLiked = !!like;
    }

    return this.sanitizePlaylistOutput(
      {
        ...playlist,
        tracks: trackRows,
      },
      requesterUserId,
      isLiked,
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
      releaseDate: playlist.releaseDate ? new Date(playlist.releaseDate).toISOString() : null,
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
      } else if (playlist.visibility !== PlaylistVisibility.SECRET || !playlist.secretToken) {
        data.secretToken = await this.generateUniqueSecretToken(playlist.id);
      }
    }

    if (dto.releaseDate !== undefined) {
      data.releaseDate = new Date(dto.releaseDate);
    }

    if (dto.genre !== undefined) {
      if (dto.genre === null) {
        data.genreId = null;
      } else {
        const genre = await this.prisma.genre.findFirst({
          where: {
            slug: dto.genre,
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
      throw this.badRequest(
        'PLAYLIST_UPDATE_EMPTY',
        'At least one field must be provided for update.',
      );
    }

    await this.prisma.playlist.update({
      where: { id: playlist.id },
      data: data as any,
    });

    this.logAudit('playlist.update', userId, playlist.id, {
      changedFields: Object.keys(data),
    });

    return {
      message: 'Playlist updated successfully',
      playlist: await this.findOne(playlist.id, userId),
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

    const updated = (await this.prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        coverImageUrl: uploaded.url,
        coverArtUrl: uploaded.url,
      } as any,
      select: {
        coverImageUrl: true,
      } as any,
    })) as any;

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
        visibility: true,
        coverImageUrl: true,
        coverArtUrl: true,
        likesCount: true,
        genre: {
          select: {
            slug: true,
          },
        },
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
        _count: {
          select: {
            tracks: true,
          },
        },
      },
    });

    // Get liked playlists by current user
    const likedPlaylists = await this.prisma.playlistLike.findMany({
      where: {
        userId,
        playlistId: {
          in: playlistIds,
        },
      },
      select: {
        playlistId: true,
      },
    });
    const likedPlaylistIds = new Set(likedPlaylists.map((like) => like.playlistId));

    const playlistMap = new Map(playlists.map((playlist) => [playlist.id, playlist]));

    return {
      playlists: playlistIds
        .map((playlistId) => playlistMap.get(playlistId))
        .filter((playlist): playlist is NonNullable<typeof playlist> => Boolean(playlist))
        .map((playlist) => ({
          playlistId: playlist.id,
          title: playlist.title,
          visibility: playlist.visibility,
          coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
          likesCount: playlist.likesCount,
          isLiked: likedPlaylistIds.has(playlist.id),
          genre: playlist.genre?.slug ?? null,
          tracksCount: playlist._count.tracks,
          owner: {
            id: playlist.owner.id,
            displayName: playlist.owner.profile?.displayName ?? 'Unknown User',
          },
        })),
    };
  }

  async getTopPlaylists(userId?: string): Promise<GetTopPlaylistsResponseDto> {
    const noGenreLabel = 'No Genre';

    const playlists = await this.prisma.playlist.findMany({
      where: {
        visibility: PlaylistVisibility.PUBLIC,
        deletedAt: null,
      },
      orderBy: [{ likesCount: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        visibility: true,
        coverImageUrl: true,
        coverArtUrl: true,
        likesCount: true,
        genre: {
          select: {
            slug: true,
          },
        },
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
        _count: {
          select: {
            tracks: true,
          },
        },
      },
    });

    // Get liked playlists by current user if authenticated
    let likedPlaylistIds = new Set<string>();
    if (userId) {
      const likedPlaylists = await this.prisma.playlistLike.findMany({
        where: {
          userId,
          playlistId: {
            in: playlists.map((p) => p.id),
          },
        },
        select: {
          playlistId: true,
        },
      });
      likedPlaylistIds = new Set(likedPlaylists.map((like) => like.playlistId));
    }

    const groupedGenres = new Map<
      string,
      {
        genre: string;
        playlists: PlaylistItemDto[];
      }
    >();

    for (const playlist of playlists) {
      const genreName = playlist.genre?.slug ?? noGenreLabel;
      const groupedGenre = groupedGenres.get(genreName) ?? {
        genre: genreName,
        playlists: [] as PlaylistItemDto[],
      };

      if (groupedGenre.playlists.length < 10) {
        const playlistItem: PlaylistItemDto = {
          playlistId: playlist.id,
          title: playlist.title,
          visibility: playlist.visibility,
          coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
          likesCount: playlist.likesCount,
          isLiked: likedPlaylistIds.has(playlist.id),
          genre: playlist.genre?.slug ?? null,
          tracksCount: playlist._count.tracks,
          owner: {
            id: playlist.owner.id,
            displayName: playlist.owner.profile?.displayName ?? 'Unknown User',
          },
        };

        groupedGenre.playlists.push(playlistItem);
      }

      groupedGenres.set(genreName, groupedGenre);
    }

    const orderedGenres = [...groupedGenres.values()]
      .filter((group) => group.genre !== noGenreLabel)
      .sort((left, right) => left.genre.localeCompare(right.genre));

    const noGenreGroup = groupedGenres.get(noGenreLabel);
    if (noGenreGroup) {
      orderedGenres.push(noGenreGroup);
    }

    return {
      genres: orderedGenres,
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
          ownerId: true,
        },
      });

      if (!playlist) {
        throw this.notFound('PLAYLIST_NOT_FOUND', 'Playlist not found.');
      }

      // Prevent user from liking their own playlist
      if (playlist.ownerId === userId) {
        throw this.forbidden('CANNOT_LIKE_OWN_PLAYLIST', 'You cannot like your own playlist.');
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

        await tx.playlist.update({
          where: { id: playlist.id },
          data: {
            likesCount: {
              increment: 1,
            },
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
    if (!file?.buffer) {
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

  async getMeLikedPlaylists(
    userId: string,
    query: PlaylistPaginationQueryDto,
  ): Promise<GetPlaylistLikedResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      userId,
    };

    const [total, playlistLikes] = await this.prisma.$transaction([
      this.prisma.playlistLike.count({ where }),
      this.prisma.playlistLike.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          playlist: {
            select: {
              id: true,
              title: true,
              visibility: true,
              coverImageUrl: true,
              coverArtUrl: true,
              likesCount: true,
              genre: {
                select: {
                  slug: true,
                },
              },
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
              _count: {
                select: {
                  tracks: true,
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
      playlists: playlistLikes.map((like) => {
        const playlist = like.playlist;
        return {
          playlistId: playlist.id,
          title: playlist.title,
          visibility: playlist.visibility,
          coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
          likesCount: playlist.likesCount,
          isLiked: true, // User has already liked this playlist
          genre: playlist.genre?.slug ?? null,
          tracksCount: playlist._count.tracks,
          owner: {
            id: playlist.owner.id,
            displayName: playlist.owner.profile?.displayName ?? 'Unknown User',
          },
        };
      }),
    };
  }

  async play(userId: string, playlistId: string): Promise<{ message: string }> {
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

    // Record the playback event. PlayEvent requires a trackId, so use the
    // first track in the playlist (if any) as the tracked item for this play.
    const firstTrack = await this.prisma.playlistTrack.findFirst({
      where: { playlistId: playlist.id },
      orderBy: { position: 'asc' },
      select: { trackId: true },
    });

    if (firstTrack) {
      await this.prisma.playEvent.create({
        data: {
          userId,
          trackId: firstTrack.trackId,
          playlistId: playlist.id,
          source: 'PLAYLIST',
          deviceType: 'WEB',
          startedAt: new Date(),
        },
      });
    }

    this.logAudit('playlist.play', userId, playlist.id);

    return {
      message: 'Playback recorded successfully',
    };
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

    const removed = await this.prisma.playlistLike.deleteMany({
      where: {
        userId,
        playlistId: playlist.id,
      },
    });

    if (removed.count > 0) {
      await this.prisma.playlist.update({
        where: { id: playlist.id },
        data: {
          likesCount: {
            decrement: removed.count,
          },
        },
      });
    }

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
        select: {
          id: true,
          coverArtUrl: true,
          uploader: {
            select: {
              id: true,
              profile: {
                select: {
                  handle: true,
                  displayName: true,
                },
              },
            },
          },
        },
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
          throw this.conflict(
            'TRACK_ALREADY_IN_PLAYLIST',
            'Track already exists in this playlist.',
          );
        }
        throw error;
      }

      return {
        playlistId: playlist.id,
        trackId: track.id,
        coverArtUrl: track.coverArtUrl ?? null,
        artist: {
          id: track.uploader.id,
          name:
            track.uploader.profile?.displayName ??
            track.uploader.profile?.handle ??
            'Unknown Artist',
          handle: track.uploader.profile?.handle ?? null,
        },
      };
    });

    this.logAudit('playlist.track.add', userId, result.playlistId, {
      trackId: result.trackId,
    });

    return {
      message: 'Track added to playlist successfully',
      playlistId: result.playlistId,
      trackId: result.trackId,
      coverArtUrl: result.coverArtUrl,
      artist: result.artist,
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
    const orderedTrackIds = this.validateTrackIdArray(dto.orderedTrackIds, 'orderedTrackIds', true);

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
          coverImageUrl: true,
          coverArtUrl: true,
          likesCount: true,
          genre: {
            select: {
              slug: true,
            },
          },
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
          _count: {
            select: {
              tracks: true,
              likes: true,
            },
          },
        },
      }),
    ]);

    // Get liked playlists by current user
    const likedPlaylists = await this.prisma.playlistLike.findMany({
      where: {
        userId,
      },
      select: {
        playlistId: true,
      },
    });
    const likedPlaylistIds = new Set(likedPlaylists.map((like) => like.playlistId));

    return {
      page,
      limit,
      total,
      playlists: playlists.map((playlist) => ({
        playlistId: playlist.id,
        title: playlist.title,
        visibility: playlist.visibility,
        coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
        likesCount: playlist.likesCount,
        isLiked: likedPlaylistIds.has(playlist.id),
        genre: playlist.genre?.slug ?? null,
        tracksCount: playlist._count.tracks,
        owner: {
          id: playlist.owner.id,
          displayName: playlist.owner.profile?.displayName ?? 'Unknown User',
        },
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
      throw this.badRequest(
        'DUPLICATE_TRACK_IDS',
        `${fieldName} must not contain duplicate values.`,
      );
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