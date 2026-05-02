import { Injectable, Logger } from '@nestjs/common';
import { AiIntentResult, AiResponse } from './types';
import { DiscoveryService } from '../discovery/discovery.service';
import { PlaylistsService } from '../playlists/playlists.service';

const FAQ_ANSWERS: Record<string, string> = {
  upload: 'You can upload tracks from the Upload page. FREE users: 3 tracks max. PRO: 100 tracks. GO+: 1000 tracks.',
  subscription: 'Plans: FREE (3 uploads, ads, no downloads), PRO ($9.99/mo, 100 uploads, 7-day trial, ad-free, downloads), GO+ ($19.99/mo, 1000 uploads, no trial, ad-free, downloads).',
  free: 'FREE plan: 3 track uploads, ads enabled, no downloads. Upgrade to PRO or GO+ to remove limits.',
  pro: 'PRO plan: $9.99/month, 100 uploads, 7-day trial (first time only), ad-free, downloads.',
  goplus: 'GO+ plan: $19.99/month, 1000 uploads, no trial, ad-free, downloads. Best for serious creators.',
  playlist: 'Create playlists from the Playlists page. Add tracks from any track page.',
  private: 'Set track visibility to private when uploading or from the track edit page.',
  queue: 'Click any track to play it. Use the queue icon to see your queue.',
  search: 'Use the search bar at the top to find tracks by title, artist, or genre.',
  likes: 'Like a track by clicking the heart icon. View liked tracks in your library.',
  reposts: 'Repost a track to share it with your followers.',
  comments: 'Leave comments on any track page.',
  report: 'Report inappropriate content using the flag icon on track or profile pages.',
  messages: 'Send messages from a user profile page or from any track page.',
  notifications: 'Notifications appear in the bell icon. Manage in Settings > Notifications.',
  profile: 'Edit your profile from Settings > Profile.',
  account: 'Manage your account from Settings.',
  download: 'PRO and GO+ subscribers can download tracks. FREE users cannot.',
  ads: 'FREE users see ads every few tracks. PRO and GO+ plans are ad-free.',
};

@Injectable()
export class AiActionService {
  private readonly logger = new Logger(AiActionService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly playlists: PlaylistsService,
  ) {}

  async execute(
    userId: string,
    intentResult: AiIntentResult,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const { intent, parameters, needsConfirmation, clarifyingQuestion } = intentResult;

    if (intent === 'clarification_needed') {
      return {
        reply: clarifyingQuestion ?? 'Could you clarify what you\'d like to do?',
        provider,
        intent,
        actionsTaken: [],
        needsConfirmation: true,
      };
    }

    switch (intent) {
      case 'faq_help': return this.execFaqHelp(parameters, provider);
      case 'search_tracks': return this.execSearchTracks(parameters, provider);
      case 'get_trending_tracks': return this.execGetTrending(provider);
      case 'recommend_by_genre': return this.execRecommendByGenre(parameters, provider);
      case 'create_playlist': return this.execCreatePlaylist(userId, parameters, provider);
      case 'list_my_playlists': return this.execListPlaylists(userId, provider);
      case 'add_track_to_playlist': return this.execAddTrackToPlaylist(userId, parameters, provider);
      case 'create_playlist_from_genre': return this.execCreatePlaylistFromGenre(userId, parameters, provider);
      case 'create_playlist_from_artist_genre': return this.execCreatePlaylistFromArtistGenre(userId, parameters, provider);
      case 'share_track_message': return this.execShareTrack(userId, parameters, needsConfirmation, provider);
      case 'queue_track_or_play_next': return this.execQueueTrack(parameters, provider);
      case 'profile_or_subscription_help': return this.execProfileHelp(userId, provider);
      default:
        return {
          reply: 'I can help with: searching tracks, discovering trending music, creating playlists, and answering app questions. Try: "find sha3by tracks", "create playlist called Gym", or "how do I upload?"',
          provider,
          intent: 'unknown',
          actionsTaken: [],
          suggestions: [
            'find trending tracks',
            'search for sha3by',
            'create playlist called [name]',
            'how do I upload?',
          ],
        };
    }
  }

  private execFaqHelp(
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): AiResponse {
    const msg = String(params['originalMessage'] ?? '').toLowerCase();
    const matched: string[] = [];
    for (const [kw, answer] of Object.entries(FAQ_ANSWERS)) {
      if (msg.includes(kw) || (kw === 'goplus' && (msg.includes('go+') || msg.includes('go plus')))) {
        matched.push(answer);
      }
    }
    const reply =
      matched.length > 0
        ? matched.slice(0, 2).join('\n\n')
        : 'I can help with uploads, subscriptions, playlists, search, and account settings. What would you like to know?';
    return {
      reply,
      provider,
      intent: 'faq_help',
      actionsTaken: ['answered FAQ'],
      suggestions: ['how to subscribe?', 'how to create a playlist?', 'how to upload?'],
    };
  }

  private async execSearchTracks(
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const query = String(params['query'] ?? '').trim();
    if (!query) {
      return {
        reply: 'What would you like to search for? Try: "find sha3by tracks"',
        provider,
        intent: 'search_tracks',
        actionsTaken: [],
      };
    }
    try {
      // discovery.search(q, type, page, limit) — verified from discovery.service.ts
      const results = await this.discovery.search(query, 'tracks', 1, 8);
      const tracks = (results.data as any).tracks ?? [];
      const count = tracks.length;
      if (count === 0) {
        return {
          reply: `No tracks found for "${query}". Try a different search term or browse the Discover page.`,
          provider,
          intent: 'search_tracks',
          actionsTaken: [`searched: "${query}"`],
          data: { query, results: [] },
          suggestions: ['find trending tracks', 'search for popular music'],
        };
      }
      const trackList = tracks
        .slice(0, 5)
        .map((t: any) => `• ${t.title} by @${t.artist_handle}`)
        .join('\n');
      return {
        reply: `Found ${count} tracks for "${query}":\n${trackList}`,
        provider,
        intent: 'search_tracks',
        actionsTaken: [`searched: "${query}", found ${count} results`],
        data: { query, results: tracks.slice(0, 5) },
        suggestions: [`create a ${query} playlist`, `recommend ${query} tracks`],
      };
    } catch (err) {
      this.logger.error(`[AI] search failed: ${err}`);
      return {
        reply: 'Search temporarily unavailable. Try the search bar at the top.',
        provider,
        intent: 'search_tracks',
        actionsTaken: [],
      };
    }
  }

  private async execGetTrending(
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    try {
      const results = await this.discovery.search('music', 'tracks', 1, 5);
      const tracks = (results.data as any).tracks ?? [];
      if (tracks.length === 0) {
        return {
          reply: 'Check the Discover page for trending tracks right now!',
          provider,
          intent: 'get_trending_tracks',
          actionsTaken: ['fetched trending'],
          suggestions: ['create playlist from trending', 'recommend rap tracks'],
        };
      }
      const trackList = tracks
        .slice(0, 5)
        .map((t: any) => `• ${t.title} by @${t.artist_handle}`)
        .join('\n');
      return {
        reply: `Here are some popular tracks right now:\n${trackList}\n\nVisit the Discover page for the full trending list!`,
        provider,
        intent: 'get_trending_tracks',
        actionsTaken: ['fetched trending'],
        data: { tracks: tracks.slice(0, 5) },
        suggestions: ['recommend rap tracks', 'create playlist from trending'],
      };
    } catch (err) {
      this.logger.error(`[AI] trending failed: ${err}`);
      return {
        reply: 'Try the Discover page for trending tracks.',
        provider,
        intent: 'get_trending_tracks',
        actionsTaken: [],
      };
    }
  }

  private async execRecommendByGenre(
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const genre = String(params['genre'] ?? 'popular');
    const limit = Math.min(Number(params['limit'] ?? 5), 25);
    try {
      const results = await this.discovery.search(genre, 'tracks', 1, limit);
      const tracks = (results.data as any).tracks ?? [];
      if (tracks.length === 0) {
        return {
          reply: `Looking for ${limit} ${genre} tracks! Use the search bar or Discover page to browse by genre.`,
          provider,
          intent: 'recommend_by_genre',
          actionsTaken: [`genre search: ${genre}`],
          data: { genre, limit },
          suggestions: [`create a ${genre} playlist`, 'show trending tracks'],
        };
      }
      const trackList = tracks
        .slice(0, limit)
        .map((t: any) => `• ${t.title} by @${t.artist_handle}`)
        .join('\n');
      return {
        reply: `Here are ${tracks.length} ${genre} tracks:\n${trackList}`,
        provider,
        intent: 'recommend_by_genre',
        actionsTaken: [`genre search: ${genre}`],
        data: { genre, limit, tracks: tracks.slice(0, limit) },
        suggestions: [`create a ${genre} playlist`, 'show trending tracks'],
      };
    } catch (err) {
      this.logger.error(`[AI] recommend_by_genre failed: ${err}`);
      return {
        reply: `Looking for ${limit} ${genre} tracks! Use the search bar or Discover page to browse by genre.`,
        provider,
        intent: 'recommend_by_genre',
        actionsTaken: [`genre search: ${genre}`],
        data: { genre, limit },
        suggestions: [`create a ${genre} playlist`, 'show trending tracks'],
      };
    }
  }

  private async execCreatePlaylist(
    _userId: string,
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const playlistName = String(params['playlistName'] ?? '').trim();
    if (!playlistName) {
      return {
        reply: 'What would you like to name your playlist? Try: "create playlist called Gym Beats"',
        provider,
        intent: 'create_playlist',
        actionsTaken: [],
      };
    }
    // Note: PlaylistsService.create() requires trackIds and other fields that we don't have
    // from an AI chat context, so we guide the user to the Playlists page instead.
    return {
      reply: `Playlist "${playlistName}" is ready to create! Go to the Playlists page or say "create sha3by playlist with 10 songs".`,
      provider,
      intent: 'create_playlist',
      actionsTaken: [`prepared: ${playlistName}`],
      data: { playlistName },
      suggestions: [`add tracks to ${playlistName}`],
    };
  }

  private async execListPlaylists(
    _userId: string,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    return {
      reply: 'Your playlists are on the Playlists page. Go there to manage them.',
      provider,
      intent: 'list_my_playlists',
      actionsTaken: [],
      suggestions: ['create playlist called [name]'],
    };
  }

  private async execAddTrackToPlaylist(
    _userId: string,
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const trackId = params['trackId'] as string | undefined;
    const playlistName = params['playlistName'] as string | undefined;
    if (!trackId) {
      return {
        reply: 'Please go to a track page first, then ask me to add it to a playlist.',
        provider,
        intent: 'add_track_to_playlist',
        actionsTaken: [],
        suggestions: ['show my playlists'],
      };
    }
    if (!playlistName) {
      return {
        reply: 'Which playlist? Try: "add to Gym Beats"',
        provider,
        intent: 'add_track_to_playlist',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }
    return {
      reply: `To add this track to "${playlistName}", use the ⋮ menu → "Add to playlist".`,
      provider,
      intent: 'add_track_to_playlist',
      actionsTaken: [],
      data: { trackId, playlistName },
    };
  }

  private async execCreatePlaylistFromGenre(
    _userId: string,
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const genre = String(params['genre'] ?? 'mixed');
    const limit = Math.min(Number(params['limit'] ?? 10), 25);
    const playlistName = String(params['playlistName'] ?? `My ${genre} Playlist`);
    const allRequested = !!params['allRequested'];
    const capNote = allRequested ? ` (capped at ${limit} tracks)` : '';
    return {
      reply: `Building a ${genre} playlist "${playlistName}" with ${limit} tracks${capNote}! Search for "${genre}" tracks and use the Playlists page to create it.`,
      provider,
      intent: 'create_playlist_from_genre',
      actionsTaken: [`genre: ${genre}, limit: ${limit}`],
      data: { genre, limit, playlistName },
      suggestions: [`search for ${genre} tracks`],
    };
  }

  private async execCreatePlaylistFromArtistGenre(
    _userId: string,
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const genre = String(params['genre'] ?? 'mixed');
    const artist = params['artist'] as string | undefined;
    if (!artist) {
      return {
        reply: 'Which artist? Try: "create playlist with sha3by tracks from artist Ahmed"',
        provider,
        intent: 'create_playlist_from_artist_genre',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }
    return {
      reply: `Looking for ${genre} tracks by "${artist}"! Search for the artist on the Discover page, then create a playlist from their tracks.`,
      provider,
      intent: 'create_playlist_from_artist_genre',
      actionsTaken: [`genre: ${genre}, artist: ${artist}`],
      data: { genre, artist },
    };
  }

  private async execShareTrack(
    _userId: string,
    params: Record<string, unknown>,
    needsConfirmation: boolean,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const recipient = params['recipient'] as string | undefined;
    const trackId = params['trackId'] as string | undefined;
    if (!recipient) {
      return {
        reply: 'Who would you like to send this track to?',
        provider,
        intent: 'share_track_message',
        actionsTaken: [],
        needsConfirmation: true,
      };
    }
    if (!trackId) {
      return {
        reply: 'Please navigate to a track page first, then ask me to share it.',
        provider,
        intent: 'share_track_message',
        actionsTaken: [],
      };
    }
    return {
      reply: `To send this track to "${recipient}", use the share button on the track page.`,
      provider,
      intent: 'share_track_message',
      actionsTaken: [],
      data: { recipient, trackId },
    };
  }

  private async execQueueTrack(
    params: Record<string, unknown>,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    const trackId = params['trackId'] as string | undefined;
    if (!trackId) {
      return {
        reply: 'Navigate to a track page first, then ask me to add it to your queue.',
        provider,
        intent: 'queue_track_or_play_next',
        actionsTaken: [],
      };
    }
    return {
      reply: 'Use the ⋮ menu on the track and select "Add to Queue" or "Play Next".',
      provider,
      intent: 'queue_track_or_play_next',
      actionsTaken: [],
      data: { trackId },
    };
  }

  private async execProfileHelp(
    _userId: string,
    provider: 'mock' | 'n8n' | 'openai' | 'ollama',
  ): Promise<AiResponse> {
    return {
      reply: 'Check your subscription and usage from Settings > Subscription. Go there to see your current plan, uploads remaining, and upgrade options.',
      provider,
      intent: 'profile_or_subscription_help',
      actionsTaken: [],
      suggestions: ['what is my plan?', 'how do I upgrade?'],
    };
  }
}
