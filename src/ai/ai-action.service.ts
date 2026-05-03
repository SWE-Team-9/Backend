import { Injectable, Logger } from '@nestjs/common';
import {
  ModerationState,
  PlaylistVisibility,
  Prisma,
  TrackStatus,
  TrackVisibility,
} from '@prisma/client';

import { AiIntentResult, AiResponse } from './types';
import { DiscoveryService } from '../discovery/discovery.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MessagesService } from '../messages/messages.service';
import { PlayerService } from '../player/player.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { PrismaService } from '../prisma/prisma.service';

type AiProvider = 'mock' | 'n8n' | 'openai' | 'ollama';

interface TrackCard {
  trackId: string;
  title: string;
  slug?: string | null;
  coverArtUrl?: string | null;
  durationMs?: number | null;
  likesCount?: number;
  artist?: {
    id?: string;
    displayName?: string | null;
    handle?: string | null;
    avatarUrl?: string | null;
  };
}

@Injectable()
export class AiActionService {
  private readonly logger = new Logger(AiActionService.name);
  private readonly playlistTrackCap = 25;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly playlists: PlaylistsService,
    private readonly messages: MessagesService,
    private readonly player: PlayerService,
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    userId: string,
    intentResult: AiIntentResult,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const { intent, needsConfirmation, clarifyingQuestion } = intentResult;

    if (!userId) {
      return {
        reply: 'Please sign in first so I can help with your library, playlists, messages, and queue.',
        provider,
        intent: 'auth_required',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    if (intent === 'clarification_needed' || needsConfirmation) {
      return {
        reply: clarifyingQuestion ?? 'Could you clarify what you would like me to do?',
        provider,
        intent,
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    try {
      switch (intent) {
        case 'faq_help':
          return this.execFaqHelp(intentResult.parameters, provider);

        case 'search_tracks':
          return await this.execSearchTracks(intentResult.parameters, provider);

        case 'get_trending_tracks':
          return await this.execGetTrending(userId, intentResult.parameters, provider);

        case 'recommend_by_genre':
          return await this.execRecommendByGenre(intentResult.parameters, provider);

        case 'create_playlist':
          return await this.execCreatePlaylist(userId, intentResult.parameters, provider);

        case 'list_my_playlists':
          return await this.execListPlaylists(userId, provider);

        case 'add_track_to_playlist':
          return await this.execAddTrackToPlaylist(userId, intentResult.parameters, provider);

        case 'create_playlist_from_genre':
          return await this.execCreatePlaylistFromGenre(userId, intentResult.parameters, provider);

        case 'create_playlist_from_artist_genre':
          return await this.execCreatePlaylistFromArtistGenre(userId, intentResult.parameters, provider);

        case 'share_track_message':
          return await this.execShareTrack(userId, intentResult.parameters, provider);

        case 'queue_track_or_play_next':
          return await this.execQueueTrack(userId, intentResult.parameters, provider);

        case 'profile_or_subscription_help':
          return await this.execProfileHelp(userId, provider);

        default:
          return this.unknownResponse(provider);
      }
    } catch (error) {
      this.logger.error(
        `[AI] action ${intent} failed`,
        error instanceof Error ? error.stack : String(error),
      );

      return {
        reply:
          'I could not complete that action safely. Nothing was changed. Please try again or use the regular page for this action.',
        provider,
        intent,
        actionsTaken: [],
        suggestions: [
          'Search for tracks',
          'Create a playlist from a genre',
          'Open /library/playlists',
        ],
      };
    }
  }

  private execFaqHelp(params: Record<string, unknown>, provider: AiProvider): AiResponse {
    const topic = this.cleanString(params.topic)?.toLowerCase();
    const originalMessage = this.cleanString(params.originalMessage);
    const query = this.cleanString(params.query);
    const msg = `${topic ?? ''} ${originalMessage ?? ''} ${query ?? ''}`.toLowerCase();

    const answers: string[] = [];

    if (/upload|track limit|formats?/.test(msg)) {
      answers.push(
        'Upload music from /upload. FREE users can upload 3 tracks, PRO users can upload 100, and GO+ users can upload 1000.',
      );
    }

    if (/subscription|plan|free|pro|go\+|go plus|uploads? left/.test(msg)) {
      answers.push(
        'Plans are managed from /subscriptions. FREE has ads and 3 uploads. PRO has 100 uploads and a first-time 7-day trial. GO+ has 1000 uploads and no trial.',
      );
    }

    if (/playlist|set/.test(msg)) {
      answers.push(
        'Playlists live under /library/playlists. I can create a playlist, add the current track, or build one from a genre.',
      );
    }

    if (/search|discover|find/.test(msg)) {
      answers.push(
        'Use /search or /discover to browse. You can also ask me things like “find sha3by tracks” or “show trending tracks.”',
      );
    }

    if (/message|send|share/.test(msg)) {
      answers.push(
        'Messages are available at /messages. If you are on a track page and name a recipient clearly, I can send the track as a message.',
      );
    }

    if (/queue|play next|playback/.test(msg)) {
      answers.push(
        'The queue controls what plays next. If you are on a track page, you can ask me to add it to the queue or play it next.',
      );
    }

    if (/profile|account|settings|setting/.test(msg)) {
      answers.push(
        'Profile and account settings are under /settings. From there, you can manage your profile, account details, notifications, and preferences.',
      );
    }

    const reply =
      answers.length > 0
        ? answers.join('\n\n')
        : 'I can help with uploads, subscriptions, playlists, search, queue, messages, profile settings, likes, reposts, comments, and reports.';

    return {
      reply,
      provider,
      intent: 'faq_help',
      actionsTaken: ['answered FAQ'],
      suggestions: [
        'Create a Sha3by playlist',
        'Find trending tracks',
        'How do I upload music?',
      ],
    };
  }

  private async execSearchTracks(
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const artist = this.cleanString(params.artist);
    const mode = this.cleanString(params.mode);
    const rawQuery = this.cleanString(params.query);
    const limit = this.safeLimit(params.limit, artist && mode === 'artist_best' ? 1 : 8);

    if (artist && mode === 'artist_best') {
      const tracks = await this.findPublicTracks({ artist, limit });

      if (tracks.length === 0) {
        return {
          reply: `No public finished tracks were found for artist/user "${artist}".`,
          provider,
          intent: 'search_tracks',
          actionsTaken: [`searched top tracks by artist/user "${artist}"`],
          data: { artist, tracks: [] },
          suggestions: ['Show trending tracks', 'Try another artist name'],
        };
      }

      return {
        reply: `Found ${tracks.length === 1 ? 'the top track' : `${tracks.length} tracks`} by "${artist}".`,
        provider,
        intent: 'search_tracks',
        actionsTaken: [`searched top tracks by artist/user "${artist}"`],
        data: { artist, tracks },
        suggestions: ['Show trending tracks', 'Search for rap tracks'],
      };
    }

    const query = this.cleanTrackSearchQuery(rawQuery);

    if (!query) {
      return {
        reply: 'What would you like to search for? For example: “find sha3by tracks.”',
        provider,
        intent: 'search_tracks',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    const searchResult = await this.discovery.search(query, 'tracks', 1, limit);
    const rawTracks: any[] = (searchResult as any)?.data?.tracks ?? [];
    const tracks = this.normalizeDiscoveryTracks(rawTracks);

    if (tracks.length === 0) {
      return {
        reply: `No tracks found for “${query}”. Try a different title, artist, or genre.`,
        provider,
        intent: 'search_tracks',
        actionsTaken: [`searched tracks for “${query}”`],
        data: { query, tracks: [] },
        suggestions: ['Show trending tracks', 'Search for rap tracks'],
      };
    }

    return {
      reply: `Found ${tracks.length} track${tracks.length === 1 ? '' : 's'} for “${query}”.`,
      provider,
      intent: 'search_tracks',
      actionsTaken: [`searched tracks for “${query}”`],
      data: { query, tracks },
      suggestions: [
        `Create a playlist from ${query}`,
        'Show trending tracks',
      ],
    };
  }

  private async execGetTrending(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const limit = this.safeLimit(params.limit, 10);
    const mode = this.cleanString(params.mode);

    const trending = await this.discovery.trending(limit, 7, userId);
    let tracks = this.normalizeTrendingTracks((trending as any)?.items ?? []);

    if (tracks.length === 0) {
      tracks = await this.findPublicTracks({ limit });
    }

    if (tracks.length === 0) {
      return {
        reply:
          'No public finished tracks are available right now. Try the Discover page after tracks are published.',
        provider,
        intent: 'get_trending_tracks',
        actionsTaken: ['checked trending tracks', 'checked public finished tracks'],
        data: { tracks: [] },
      };
    }

    return {
      reply:
        mode === 'global_best' || limit === 1
          ? `The top track I found is "${tracks[0].title}".`
          : `Here are ${tracks.length} trending tracks right now.`,
      provider,
      intent: 'get_trending_tracks',
      actionsTaken:
        mode === 'global_best' || limit === 1
          ? ['fetched top public track']
          : ['fetched trending tracks'],
      data: { tracks },
      suggestions: ['Create playlist with top 10 tracks', 'Recommend Sha3by tracks'],
    };
  }

  private async execRecommendByGenre(
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const genre = this.cleanString(params.genre) || 'mixed';
    const limit = this.safeLimit(params.limit, 5);
    const tracks = await this.findPublicTracksByGenre({ genre, limit });

    if (tracks.length === 0) {
      return {
        reply: `I could not find public finished tracks for "${genre}". Try another genre or use /discover.`,
        provider,
        intent: 'recommend_by_genre',
        actionsTaken: [`searched genre "${genre}"`],
        data: { genre, tracks: [] },
      };
    }

    return {
      reply: `Here are ${tracks.length} ${genre} track${tracks.length === 1 ? '' : 's'} I found.`,
      provider,
      intent: 'recommend_by_genre',
      actionsTaken: [`recommended ${tracks.length} ${genre} tracks`],
      data: { genre, tracks },
      suggestions: [`Create a ${genre} playlist`, 'Show trending tracks'],
    };
  }

  private async execCreatePlaylist(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const playlistName = this.cleanString(params.playlistName);
    if (!playlistName) {
      return {
        reply: 'What would you like to name your playlist?',
        provider,
        intent: 'create_playlist',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    const playlist = await this.createPlaylistRecord(userId, {
      title: playlistName,
      trackIds: [],
      genre: null,
    });

    return {
      reply: `Created playlist "${playlist.title}".`,
      provider,
      intent: 'create_playlist',
      actionsTaken: ['created playlist'],
      data: { playlist },
      suggestions: ['Add this track to the playlist', 'Create a playlist from Sha3by tracks'],
    };
  }

  private async execListPlaylists(userId: string, provider: AiProvider): Promise<AiResponse> {
    const result = await this.playlists.getMyPlaylists(userId, { page: 1, limit: 10 });
    const playlists = result.playlists ?? [];

    if (playlists.length === 0) {
      return {
        reply: 'You do not have playlists yet. Ask me to create one.',
        provider,
        intent: 'list_my_playlists',
        actionsTaken: ['checked your playlists'],
        data: { playlists: [] },
        suggestions: ['Create playlist called Gym', 'Create a Sha3by playlist'],
      };
    }

    return {
      reply: `You have ${result.total} playlist${result.total === 1 ? '' : 's'}.`,
      provider,
      intent: 'list_my_playlists',
      actionsTaken: ['listed your playlists'],
      data: { playlists },
      suggestions: ['Create a new playlist', 'Add this track to a playlist'],
    };
  }

  private async execAddTrackToPlaylist(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const trackId = this.cleanString(params.trackId);
    const playlistIdFromParams = this.cleanString(params.playlistId);
    const playlistName = this.cleanString(params.playlistName);

    if (!trackId) {
      return {
        reply: 'Please open a track first, then ask me to add it to a playlist.',
        provider,
        intent: 'add_track_to_playlist',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    const playlist = playlistIdFromParams
      ? await this.findOwnedPlaylistById(userId, playlistIdFromParams)
      : await this.findOwnedPlaylistByName(userId, playlistName);

    if (!playlist) {
      return {
        reply: playlistName
          ? `I could not find one of your playlists named "${playlistName}".`
          : 'Which playlist should I add this track to?',
        provider,
        intent: 'add_track_to_playlist',
        actionsTaken: [],
        needsConfirmation: true,
        suggestions: ['Show my playlists', 'Create playlist called Favorites'],
      };
    }

    const added = await this.playlists.addTrack(userId, playlist.id, { trackId });

    return {
      reply: `Added "${added.title}" to "${playlist.title}".`,
      provider,
      intent: 'add_track_to_playlist',
      actionsTaken: ['added track to playlist'],
      data: {
        playlist: {
          playlistId: playlist.id,
          title: playlist.title,
        },
        track: added,
      },
      suggestions: ['Show my playlists', 'Find similar tracks'],
    };
  }

  private async execCreatePlaylistFromGenre(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const genre = this.cleanString(params.genre) || 'mixed';
    const limit = this.safeLimit(params.limit, 10);
    const allRequested = Boolean(params.allRequested);
    const playlistName =
      this.cleanString(params.playlistName) || `${this.titleCase(genre)} Mix`;

    const tracks = await this.findPublicTracksByGenre({ genre, limit });

    if (tracks.length === 0) {
      return {
        reply: `I could not find public finished tracks for "${genre}", so I did not create the playlist.`,
        provider,
        intent: 'create_playlist_from_genre',
        actionsTaken: [`searched genre "${genre}"`],
        data: { genre, tracks: [] },
        suggestions: ['Try another genre', 'Show trending tracks'],
      };
    }

    const playlist = await this.createPlaylistRecord(userId, {
      title: playlistName,
      trackIds: tracks.map((track) => track.trackId),
      genre: genre === 'mixed' ? null : genre,
    });

    return {
      reply:
        tracks.length < limit
          ? `Created "${playlist.title}" with ${tracks.length} ${genre} track${tracks.length === 1 ? '' : 's'}. I found fewer public finished tracks than the ${limit} requested.`
          : `Created "${playlist.title}" with ${tracks.length} ${genre} track${tracks.length === 1 ? '' : 's'}${allRequested ? `, capped at ${tracks.length}.` : '.'}`,
      provider,
      intent: 'create_playlist_from_genre',
      actionsTaken: [
        'searched tracks by genre',
        'created playlist',
        `added ${tracks.length} tracks`,
      ],
      data: {
        playlist,
        genre,
        tracks,
      },
      suggestions: ['Open the playlist', `Find more ${genre} tracks`],
    };
  }

  private async execCreatePlaylistFromArtistGenre(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const genre = this.cleanString(params.genre) || 'mixed';
    const artist = this.cleanString(params.artist);
    const limit = this.safeLimit(params.limit, 10);
    const playlistName =
      this.cleanString(params.playlistName) ||
      `${this.titleCase(genre)} by ${artist ?? 'Artist'}`;

    if (!artist) {
      return {
        reply: 'Which artist should I use?',
        provider,
        intent: 'create_playlist_from_artist_genre',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    const tracks = await this.findPublicTracksByGenre({ genre, artist, limit });

    if (tracks.length === 0) {
      return {
        reply: `I could not find public finished ${genre} tracks from "${artist}", so I did not create the playlist.`,
        provider,
        intent: 'create_playlist_from_artist_genre',
        actionsTaken: [`searched ${genre} tracks from ${artist}`],
        data: { genre, artist, tracks: [] },
        suggestions: ['Try a different artist', 'Search tracks by artist'],
      };
    }

    const playlist = await this.createPlaylistRecord(userId, {
      title: playlistName,
      trackIds: tracks.map((track) => track.trackId),
      genre: genre === 'mixed' ? null : genre,
    });

    return {
      reply: `Created "${playlist.title}" with ${tracks.length} ${genre} track${tracks.length === 1 ? '' : 's'} from "${artist}".`,
      provider,
      intent: 'create_playlist_from_artist_genre',
      actionsTaken: [
        'searched by artist and genre',
        'created playlist',
        `added ${tracks.length} tracks`,
      ],
      data: { playlist, genre, artist, tracks },
      suggestions: ['Open the playlist', `Find more by ${artist}`],
    };
  }

  private async execShareTrack(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const recipientQuery = this.cleanString(params.recipient);
    const trackId = this.cleanString(params.trackId);

    if (!trackId) {
      return {
        reply: 'Please open a track first, then ask me to send it.',
        provider,
        intent: 'share_track_message',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    if (!recipientQuery) {
      return {
        reply: 'Who would you like to send this track to?',
        provider,
        intent: 'share_track_message',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    const [recipient, track] = await Promise.all([
      this.findUserByHandleOrName(recipientQuery),
      this.findPublicTrackById(trackId),
    ]);

    if (!recipient) {
      return {
        reply: `I could not find a user matching "${recipientQuery}".`,
        provider,
        intent: 'share_track_message',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    if (!track) {
      return {
        reply: 'I could not find this track or it is not available to share.',
        provider,
        intent: 'share_track_message',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    const text = `Check out this track on IQA3: ${track.title}`;
    const message = await this.messages.sendMessage(userId, recipient.id, text);

    return {
      reply: `Sent "${track.title}" to ${recipient.displayName ?? recipient.handle ?? 'the user'}.`,
      provider,
      intent: 'share_track_message',
      actionsTaken: ['sent track message'],
      data: {
        recipient,
        track,
        message,
      },
      suggestions: ['Open messages', 'Share another track'],
    };
  }

  private async execQueueTrack(
    userId: string,
    params: Record<string, unknown>,
    provider: AiProvider,
  ): Promise<AiResponse> {
    const trackId = this.cleanString(params.trackId);
    const rawMode = String(params.mode ?? 'END').toUpperCase();
    const mode = rawMode === 'NEXT' || rawMode === 'TOP' ? rawMode : 'END';

    if (!trackId) {
      return {
        reply: 'Please open a track first, then ask me to add it to your queue.',
        provider,
        intent: 'queue_track_or_play_next',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    try {
      const result = await this.player.addQueueItem(userId, trackId, mode);

      return {
        reply: mode === 'NEXT' ? 'Added this track to play next.' : 'Added this track to your queue.',
        provider,
        intent: 'queue_track_or_play_next',
        actionsTaken: [mode === 'NEXT' ? 'added track to play next' : 'added track to queue'],
        data: result,
        suggestions: ['Show queue', 'Find similar tracks'],
      };
    } catch {
      const loaded = await this.player.loadQueueContext(userId, {
        contextType: 'TRACK',
        startTrackId: trackId,
        shuffle: false,
      });

      return {
        reply: 'Started a new queue from this track.',
        provider,
        intent: 'queue_track_or_play_next',
        actionsTaken: ['loaded queue from current track'],
        data: loaded,
        suggestions: ['Play next track', 'Add another track to queue'],
      };
    }
  }

  private async execProfileHelp(userId: string, provider: AiProvider): Promise<AiResponse> {
    const entitlements = await this.entitlements.getUserEntitlements(userId);

    return {
      reply:
        `Your current plan is ${entitlements.planCode}. ` +
        `You have uploaded ${entitlements.uploadedCount}/${entitlements.uploadLimit < 0 ? 'unlimited' : entitlements.uploadLimit} tracks. ` +
        `Remaining uploads: ${entitlements.remainingUploads ?? 'unlimited'}. ` +
        `${entitlements.canDownload ? 'Downloads are enabled.' : 'Downloads are not available on FREE.'}`,
      provider,
      intent: 'profile_or_subscription_help',
      actionsTaken: ['checked subscription entitlements'],
      data: { entitlements },
      suggestions: ['Open /subscriptions', 'How do I upload music?'],
    };
  }

  private unknownResponse(provider: AiProvider): AiResponse {
    return {
      reply:
        'I can help you search tracks, discover music, create playlists, add tracks to playlists, queue tracks, send track messages, and answer app questions. Try: “create a Sha3by playlist with 5 songs.”',
      provider,
      intent: 'unknown',
      actionsTaken: [],
      suggestions: [
        'Create a Sha3by playlist',
        'Find trending tracks',
        'How do I upload music?',
        'Show my playlists',
      ],
    };
  }

  private async findPublicTracksByGenre(options: {
    genre: string;
    artist?: string;
    limit: number;
  }): Promise<TrackCard[]> {
    return this.findPublicTracks({
      genre: options.genre,
      artist: options.artist,
      limit: options.limit,
    });
  }

  private async findPublicTracks(options: {
    query?: string;
    genre?: string;
    artist?: string;
    limit: number;
  }): Promise<TrackCard[]> {
    const limit = Math.min(Math.max(options.limit, 1), this.playlistTrackCap);

    const andFilters: Prisma.TrackWhereInput[] = [
      {
        deletedAt: null,
        visibility: TrackVisibility.PUBLIC,
        status: TrackStatus.FINISHED,
        moderationState: ModerationState.VISIBLE,
        hiddenByPlanLimit: false,
      },
    ];

    const searchTerms = options.genre
      ? await this.genreSearchTerms(options.genre)
      : options.query
        ? [this.normalizeSearchTerm(options.query)]
        : [];

    const validTerms = searchTerms.filter((term) => term && term !== 'mixed');

    if (validTerms.length > 0) {
      const orFilters: Prisma.TrackWhereInput[] = [];

      for (const term of validTerms) {
        orFilters.push(
          {
            title: {
              contains: term,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: term,
              mode: 'insensitive',
            },
          },
          {
            primaryGenre: {
              is: {
                OR: [
                  {
                    slug: {
                      contains: term,
                      mode: 'insensitive',
                    },
                  },
                  {
                    name: {
                      contains: term,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          } as Prisma.TrackWhereInput,
          {
            tags: {
              some: {
                tag: {
                  OR: [
                    {
                      slug: {
                        contains: term,
                        mode: 'insensitive',
                      },
                    },
                    {
                      name: {
                        contains: term,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          } as Prisma.TrackWhereInput,
        );
      }

      andFilters.push({ OR: orFilters });
    }

    const artist = this.cleanString(options.artist);
    if (artist) {
      andFilters.push({
        uploader: {
          is: {
            profile: {
              is: {
                OR: [
                  {
                    handle: {
                      contains: artist,
                      mode: 'insensitive',
                    },
                  },
                  {
                    displayName: {
                      contains: artist,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          },
        },
      } as Prisma.TrackWhereInput);
    }

    const rows = await this.prisma.track.findMany({
      where: {
        AND: andFilters,
      },
      orderBy: [
        { playEvents: { _count: 'desc' } },
        { likes: { _count: 'desc' } },
        { reposts: { _count: 'desc' } },
        { publishedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        coverArtUrl: true,
        durationMs: true,
        primaryGenre: {
          select: {
            slug: true,
            name: true,
          },
        },
        uploader: {
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
        _count: {
          select: {
            likes: true,
            reposts: true,
            playEvents: true,
          },
        },
      },
    });

    return rows.map((track) => ({
      trackId: track.id,
      title: track.title,
      slug: track.slug,
      coverArtUrl: track.coverArtUrl,
      durationMs: track.durationMs,
      likesCount: track._count.likes,
      artist: {
        id: track.uploader.id,
        displayName: track.uploader.profile?.displayName ?? null,
        handle: track.uploader.profile?.handle ?? null,
        avatarUrl: track.uploader.profile?.avatarUrl ?? null,
      },
    }));
  }

  private async createPlaylistRecord(
    userId: string,
    input: {
      title: string;
      trackIds: string[];
      genre: string | null;
    },
  ) {
    const title = input.title.trim().slice(0, 100);
    const slug = await this.generateUniquePlaylistSlug(title);
    const genreId = input.genre ? await this.resolveGenreId(input.genre) : null;
    const uniqueTrackIds = Array.from(new Set(input.trackIds)).slice(0, this.playlistTrackCap);

    const playlist = await this.prisma.$transaction(async (tx) => {
      const created = await tx.playlist.create({
        data: {
          ownerId: userId,
          title,
          slug,
          visibility: PlaylistVisibility.PUBLIC,
          genreId,
        },
        select: {
          id: true,
          title: true,
          slug: true,
          visibility: true,
          coverImageUrl: true,
          coverArtUrl: true,
          genre: {
            select: {
              slug: true,
            },
          },
          _count: {
            select: {
              tracks: true,
            },
          },
        },
      });

      if (uniqueTrackIds.length > 0) {
        await tx.playlistTrack.createMany({
          data: uniqueTrackIds.map((trackId, position) => ({
            playlistId: created.id,
            trackId,
            position,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    return {
      playlistId: playlist.id,
      title: playlist.title,
      slug: playlist.slug,
      visibility: playlist.visibility,
      coverImageUrl: playlist.coverImageUrl ?? playlist.coverArtUrl ?? null,
      genre: playlist.genre?.slug ?? input.genre,
      tracksCount: uniqueTrackIds.length,
    };
  }

  private async findOwnedPlaylistById(userId: string, playlistId: string) {
    return this.prisma.playlist.findFirst({
      where: {
        id: playlistId,
        ownerId: userId,
        deletedAt: null,
      },
      select: {
        id: true,
        title: true,
      },
    });
  }

  private async findOwnedPlaylistByName(userId: string, playlistName?: string) {
    if (!playlistName) return null;

    const playlists = await this.prisma.playlist.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        title: {
          contains: playlistName,
          mode: 'insensitive',
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 2,
      select: {
        id: true,
        title: true,
      },
    });

    return playlists.length === 1 ? playlists[0] : null;
  }

  private async findUserByHandleOrName(query: string) {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        profile: {
          is: {
            OR: [
              {
                handle: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
              {
                displayName: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
      } as any,
      take: 2,
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
    });

    if (users.length !== 1) return null;

    return {
      id: users[0].id,
      displayName: users[0].profile?.displayName ?? null,
      handle: users[0].profile?.handle ?? null,
      avatarUrl: users[0].profile?.avatarUrl ?? null,
    };
  }

  private async findPublicTrackById(trackId: string): Promise<TrackCard | null> {
    const track = await this.prisma.track.findFirst({
      where: {
        id: trackId,
        deletedAt: null,
        visibility: TrackVisibility.PUBLIC,
        status: TrackStatus.FINISHED,
        moderationState: ModerationState.VISIBLE,
        hiddenByPlanLimit: false,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        coverArtUrl: true,
        durationMs: true,
        uploader: {
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
    });

    if (!track) return null;

    return {
      trackId: track.id,
      title: track.title,
      slug: track.slug,
      coverArtUrl: track.coverArtUrl,
      durationMs: track.durationMs,
      artist: {
        id: track.uploader.id,
        displayName: track.uploader.profile?.displayName ?? null,
        handle: track.uploader.profile?.handle ?? null,
        avatarUrl: track.uploader.profile?.avatarUrl ?? null,
      },
    };
  }

  private async resolveGenreId(slug: string): Promise<number | null> {
    const terms = await this.genreSearchTerms(slug);

    const genre = await this.prisma.genre.findFirst({
      where: {
        OR: terms.flatMap((term) => [
          {
            slug: {
              equals: term,
              mode: 'insensitive' as const,
            },
          },
          {
            name: {
              equals: term,
              mode: 'insensitive' as const,
            },
          },
        ]),
      },
      select: {
        id: true,
      },
    });

    return genre?.id ?? null;
  }

  private async generateUniquePlaylistSlug(title: string): Promise<string> {
    const base = this.slugify(title) || 'playlist';

    const baseExists = await this.prisma.playlist.findFirst({
      where: { slug: base },
      select: { id: true },
    });

    if (!baseExists) return base;

    for (let i = 0; i < 10; i += 1) {
      const candidate = `${base}-${Math.random().toString(16).slice(2, 8)}`;
      const exists = await this.prisma.playlist.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!exists) return candidate;
    }

    return `${base}-${Date.now()}`;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private normalizeDiscoveryTracks(rows: any[]): TrackCard[] {
    return rows.slice(0, 8).map((track) => ({
      trackId: track.trackId ?? track.id,
      title: track.title,
      slug: track.slug ?? null,
      coverArtUrl: track.coverArtUrl ?? null,
      durationMs: typeof track.durationMs === 'number' ? track.durationMs : null,
      artist: {
        id: track.uploaderId,
        handle: track.artistHandle ?? track.artist_handle ?? null,
        displayName: track.artistName ?? track.artistDisplayName ?? null,
      },
    }));
  }

  private normalizeTrendingTracks(rows: any[]): TrackCard[] {
    return rows.slice(0, 10).map((track) => ({
      trackId: track.trackId ?? track.id,
      title: track.title,
      slug: track.slug ?? null,
      coverArtUrl: track.coverArtUrl ?? null,
      likesCount: track.recentLikes ?? track.likesCount ?? 0,
      artist: {
        id: track.uploaderId,
        displayName: track.uploader?.displayName ?? null,
        handle: track.uploader?.handle ?? null,
      },
    }));
  }

  private safeLimit(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.floor(parsed), 1), this.playlistTrackCap);
  }

  private cleanString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private cleanTrackSearchQuery(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;

    const cleaned = this.normalizeSearchTerm(value);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  private normalizeSearchTerm(value: string): string {
    return value
      .toLowerCase()
      .replace(/\b(search|find|show|get|best|top|tracks?|songs?|music|for|me|the|in|all|genres?)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async genreSearchTerms(value: string): Promise<string[]> {
    const normalized = this.normalizeSearchTerm(value);

    const aliases: Record<string, string[]> = {
      sha3by: ['sha3by', 'shaabi', 'shaaby', 'sh3by', 'شعبي'],
      shaabi: ['sha3by', 'shaabi', 'shaaby', 'sh3by', 'شعبي' ],
      shaaby: ['sha3by', 'shaabi', 'shaaby', 'sh3by', 'شعبي' ],
      sh3by: ['sha3by', 'shaabi', 'shaaby', 'sh3by', 'شعبي'],
      شعبي: ['sha3by', 'shaabi', 'shaaby', 'sh3by', 'شعبي'],
      mahraganat: ['mahraganat', 'mahragan', 'مهرجانات'],
      مهرجانات: ['mahraganat', 'mahragan', 'مهرجانات'],
      mahragan: ['mahraganat', 'mahragan', 'مهرجانات'],
      rap: ['rap', 'rab ', 'راب'],
      'hip-hop': ['hip-hop', 'hip hop', 'hiphop'],
      'hip hop': ['hip-hop', 'hip hop', 'hiphop'],
      hiphop: ['hip-hop', 'hip hop', 'hiphop'],
      rnb: ['r-b-soul', 'r&b', 'rnb', 'soul'],
      'r&b': ['r-b-soul', 'r&b', 'rnb', 'soul'],
      'r b': ['r-b-soul', 'r&b', 'rnb', 'soul'],

      quran: ['quran', 'koran', 'quranic', 'قرآن', 'قران', 'tilawa', 'recitation'],
      koran: ['quran', 'koran', 'quranic', 'قرآن', 'قران', 'tilawa', 'recitation'],
      quranic: ['quran', 'koran', 'quranic', 'قرآن', 'قران', 'tilawa', 'recitation'],
      قرآن: ['quran', 'koran', 'quranic', 'قرآن', 'قران', 'tilawa', 'recitation'],
      قران: ['quran', 'koran', 'quranic', 'قرآن', 'قران', 'tilawa', 'recitation'],
    };

    const aliasTerms = [
      ...(aliases[normalized] ?? []),
      ...(normalized === 'شعبي' ? ['sha3by', 'shaabi', 'shaaby', 'sh3by'] : []),
      ...(normalized === 'مهرجانات' ? ['mahraganat', 'mahragan'] : []),
      ...(normalized === 'راب' ? ['rap'] : []),
      ...(normalized === 'قرآن' || normalized === 'قران'
        ? ['quran', 'koran', 'quranic', 'tilawa', 'recitation']
        : []),
      ...(normalized === 'tilawa' || normalized === 'recitation'
        ? ['quran', 'koran', 'quranic', 'قرآن', 'قران']
        : []),
    ];

    const localTerms = Array.from(
      new Set([normalized, ...this.genreTermVariants(normalized), ...aliasTerms]),
    ).filter(Boolean);
    const dbGenres = await this.prisma.genre.findMany({
      where: {
        OR: localTerms.flatMap((term) => [
          { slug: { contains: term, mode: 'insensitive' as const } },
          { name: { contains: term, mode: 'insensitive' as const } },
        ]),
      },
      select: { slug: true, name: true },
      take: 10,
    });

    return Array.from(
      new Set([...localTerms, ...dbGenres.flatMap((genre) => [genre.slug, genre.name])]),
    ).filter(Boolean);
  }

  private genreTermVariants(term: string): string[] {
    const normalized = term.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return [];

    const variants = [
      normalized,
      normalized.replace(/\s+and\s+/g, ' & '),
      normalized.replace(/\s*&\s*/g, ' and '),
      normalized.replace(/\s+/g, '-'),
      normalized.replace(/\s*\/\s*/g, '-'),
      normalized.replace(/[&/]/g, ' '),
      normalized.replace(/[&/]/g, '-').replace(/\s+/g, '-'),
    ];

    return Array.from(new Set(variants.map((value) => value.replace(/\s+/g, ' ').trim())));
  }

  private titleCase(value: string): string {
    return value
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
