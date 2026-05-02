import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiChatDto } from './dto/chat.dto';
import { DiscoveryService } from '../discovery/discovery.service';

export interface AiResponse {
  reply: string;
  provider: 'mock' | 'openai';
  intent: string;
  actionsTaken: string[];
  data?: any;
  suggestions?: string[];
}

// FAQ bank — hardcoded, no DB needed
const FAQ_ANSWERS: Record<string, string> = {
  upload: 'You can upload tracks from the Upload page. FREE users: 3 tracks max. PRO: 100 tracks. GO+: 1000 tracks. Supported formats: MP3, WAV.',
  subscription: 'Plans: FREE (3 uploads, ads, no downloads), PRO ($9.99/mo, 100 uploads, 7-day trial, ad-free, downloads), GO+ ($19.99/mo, 1000 uploads, no trial, ad-free, downloads).',
  free: 'FREE plan: 3 track uploads, ads enabled, no downloads. Upgrade to PRO or GO+ to remove limits.',
  pro: 'PRO plan: $9.99/month, 100 uploads, 7-day free trial (first time only), ad-free, download enabled.',
  goplus: 'GO+ plan: $19.99/month, 1000 uploads, no trial, ad-free, downloads enabled. Best for serious creators.',
  playlist: 'Create playlists from your profile or via the Playlists page. You can add tracks from any track page.',
  private: 'You can set track visibility to private when uploading or from the track edit page.',
  queue: 'Click any track to play it. Use the queue icon to see your queue. Add to queue from any track\'s menu.',
  search: 'Use the search bar at the top to find tracks by title, artist, or genre.',
  likes: 'Like a track by clicking the heart icon. You can see your liked tracks in your library.',
  reposts: 'Repost a track to share it with your followers.',
  comments: 'Leave comments on any track page.',
  report: 'Report inappropriate content using the flag icon on track or profile pages.',
  messages: 'Send messages from a user\'s profile page or from any track page using the share/message option.',
  notifications: 'Notifications appear in the bell icon at the top. You can manage notification preferences in settings.',
  profile: 'Edit your profile from Settings > Profile. You can add a bio, avatar, and cover image.',
  account: 'Manage your account from Settings. You can change email, password, and notification preferences.',
  download: 'PRO and GO+ subscribers can download tracks. FREE users cannot download.',
  ads: 'FREE users see ads every few tracks. PRO and GO+ plans are ad-free.',
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: string;
  private readonly openaiApiKey: string | undefined;
  private readonly openaiModel: string;

  constructor(
    private readonly config: ConfigService,
    private readonly discoveryService: DiscoveryService,
  ) {
    this.provider = this.config.get<string>('AI_PROVIDER') ?? process.env.AI_PROVIDER ?? 'mock';
    this.openaiApiKey = this.config.get<string>('OPENAI_API_KEY') ?? process.env.OPENAI_API_KEY;
    this.openaiModel = this.config.get<string>('OPENAI_MODEL') ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  async chat(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const useOpenAI = this.provider === 'openai' && !!this.openaiApiKey;

    if (useOpenAI) {
      return this.chatOpenAI(userId, dto);
    }
    return this.chatMock(userId, dto);
  }

  // ── Mock mode ─────────────────────────────────────────────────────────────

  private async chatMock(userId: string, dto: AiChatDto): Promise<AiResponse> {
    const msg = dto.message.toLowerCase();
    const context = dto.context;

    const intent = this.detectIntent(msg);

    switch (intent) {
      case 'search_tracks':
        return this.actionSearchTracks(userId, msg);
      case 'get_trending':
        return this.actionGetTrending(userId);
      case 'recommend_by_genre':
        return this.actionRecommendByGenre(userId, msg);
      case 'create_playlist':
        return this.actionCreatePlaylist(userId, msg);
      case 'add_track_to_playlist':
        return this.actionAddTrackToPlaylist(userId, context?.trackId, msg);
      case 'create_playlist_from_genre':
        return this.actionCreatePlaylistFromGenre(userId, msg);
      case 'list_playlists':
        return this.actionListPlaylists(userId);
      case 'faq_help':
        return this.actionFaqHelp(msg);
      default:
        return {
          reply: 'I can help you with: searching tracks, discovering trending music, creating playlists, adding tracks to playlists, or answering questions about uploads, subscriptions, and app features. Try asking me something like "find sha3by tracks" or "create a playlist called Gym".',
          provider: 'mock',
          intent: 'unknown',
          actionsTaken: [],
          suggestions: [
            'find trending tracks',
            'search for [genre] music',
            'create playlist called [name]',
            'show my playlists',
            'how do I upload a track?',
          ],
        };
    }
  }

  private detectIntent(msg: string): string {
    // Destructive / unsafe requests — never act on these
    if (/delete.*(account|track|profile|all)|remove.*(account|all)|wipe|destroy|hack|ban|bypass|inject/.test(msg)) return 'unknown';
    // Search
    if (/search|find|look for|show me|get me/.test(msg) && !/playlist|trending/.test(msg)) return 'search_tracks';
    // Trending
    if (/trending|popular|top tracks|hot right now/.test(msg)) return 'get_trending';
    // Create playlist from genre
    if (
      (/(create|make).*(playlist).*(with|from|of)/.test(msg)) ||
      (/(playlist).*(create|make)/.test(msg) && /genre|rap|pop|sha3by|quran|jazz|rock|rnb|hip.?hop|electronic/.test(msg))
    ) return 'create_playlist_from_genre';
    // Create playlist
    if (/(create|make|new|add).*(playlist)|playlist.*(create|make|new)/.test(msg)) return 'create_playlist';
    // Add to playlist
    if (/(add|put|save).*(playlist|to)/.test(msg) || /playlist.*add/.test(msg)) return 'add_track_to_playlist';
    // List playlists
    if (/(show|list|my|view).*(playlist)|playlist.*(show|list|mine)/.test(msg)) return 'list_playlists';
    // Recommend by genre
    if (/(recommend|suggest|give me).*(song|track|music)/.test(msg) || /[0-9]+.*(track|song)/.test(msg)) return 'recommend_by_genre';
    // FAQ
    if (/upload|subscription|plan|pro|go\+|free plan|download|ad|queue|search|like|repost|comment|report|message|notification|profile|account|password|private/.test(msg)) return 'faq_help';
    return 'unknown';
  }

  // ── Action implementations ─────────────────────────────────────────────────

  private async actionSearchTracks(_userId: string, msg: string): Promise<AiResponse> {
    const queryMatch = msg.match(/(?:search|find|look for|show me|get me)\s+(.+)/i);
    const query = queryMatch?.[1]?.replace(/tracks?|songs?|music/gi, '').trim() ?? msg.trim();

    if (!query || query.length < 2) {
      return {
        reply: 'What would you like to search for? Try: "find sha3by tracks"',
        provider: 'mock',
        intent: 'search_tracks',
        actionsTaken: [],
        suggestions: ['search for sha3by', 'find quran tracks', 'look for jazz music'],
      };
    }

    try {
      // discoveryService.search(q, type, page, limit)
      const results = await this.discoveryService.search(query, 'tracks', 1, 5);
      const tracks = (results.data as any).tracks ?? [];
      const count = tracks.length;

      if (count === 0) {
        return {
          reply: `No tracks found for "${query}". Try a different search term or browse the Discover page.`,
          provider: 'mock',
          intent: 'search_tracks',
          actionsTaken: [`searched for "${query}"`],
          data: { query, results: [] },
          suggestions: ['find trending tracks', `search for popular music`],
        };
      }

      const trackList = tracks
        .slice(0, 5)
        .map((t: any) => `• ${t.title} by @${t.artist_handle}`)
        .join('\n');

      return {
        reply: `Found ${count} tracks for "${query}":\n${trackList}`,
        provider: 'mock',
        intent: 'search_tracks',
        actionsTaken: [`searched for "${query}", found ${count} results`],
        data: { query, results: tracks.slice(0, 5) },
        suggestions: [`create a ${query} playlist`, `recommend ${query} tracks`],
      };
    } catch (err) {
      this.logger.error(`[AI] search_tracks failed: ${err}`);
      return {
        reply: `I couldn't search right now. Try the search bar at the top of the page.`,
        provider: 'mock',
        intent: 'search_tracks',
        actionsTaken: [],
      };
    }
  }

  private async actionGetTrending(_userId: string): Promise<AiResponse> {
    try {
      // Search with a broad term to surface popular tracks
      const results = await this.discoveryService.search('music', 'tracks', 1, 5);
      const tracks = (results.data as any).tracks ?? [];

      if (tracks.length === 0) {
        return {
          reply: 'Check the Discover page for the latest trending tracks!',
          provider: 'mock',
          intent: 'get_trending',
          actionsTaken: ['redirected to discover page'],
          suggestions: ['search for sha3by tracks', 'recommend rap tracks'],
        };
      }

      const trackList = tracks
        .slice(0, 5)
        .map((t: any) => `• ${t.title} by @${t.artist_handle}`)
        .join('\n');

      return {
        reply: `Here are some popular tracks right now:\n${trackList}\n\nVisit the Discover page for the full trending list!`,
        provider: 'mock',
        intent: 'get_trending',
        actionsTaken: ['fetched trending tracks'],
        data: { tracks: tracks.slice(0, 5) },
        suggestions: ['show my playlists', 'recommend rap tracks'],
      };
    } catch (err) {
      this.logger.error(`[AI] get_trending failed: ${err}`);
      return {
        reply: 'I could not fetch trending tracks right now. Try the Discover page.',
        provider: 'mock',
        intent: 'get_trending',
        actionsTaken: [],
      };
    }
  }

  private async actionRecommendByGenre(_userId: string, msg: string): Promise<AiResponse> {
    const genres = ['sha3by', 'quran', 'rap', 'pop', 'jazz', 'rock', 'rnb', 'hip hop', 'electronic', 'classical'];
    const foundGenre = genres.find(g => msg.includes(g)) ?? 'popular';

    try {
      const results = await this.discoveryService.search(foundGenre, 'tracks', 1, 5);
      const tracks = (results.data as any).tracks ?? [];

      if (tracks.length === 0) {
        return {
          reply: `I couldn't find ${foundGenre} tracks right now. Try the search bar!`,
          provider: 'mock',
          intent: 'recommend_by_genre',
          actionsTaken: [`searched genre: ${foundGenre}`],
          data: { genre: foundGenre },
          suggestions: [`create a ${foundGenre} playlist`, 'show trending tracks'],
        };
      }

      const trackList = tracks
        .slice(0, 5)
        .map((t: any) => `• ${t.title} by @${t.artist_handle}`)
        .join('\n');

      return {
        reply: `Here are some ${foundGenre} tracks you might enjoy:\n${trackList}`,
        provider: 'mock',
        intent: 'recommend_by_genre',
        actionsTaken: [`searched genre: ${foundGenre}`],
        data: { genre: foundGenre, tracks: tracks.slice(0, 5) },
        suggestions: [`create a ${foundGenre} playlist`, 'show trending tracks'],
      };
    } catch (err) {
      this.logger.error(`[AI] recommend_by_genre failed: ${err}`);
      return {
        reply: `Looking for ${foundGenre} tracks! Use the search bar or Discover page to browse by genre.`,
        provider: 'mock',
        intent: 'recommend_by_genre',
        actionsTaken: [`searched genre: ${foundGenre}`],
        data: { genre: foundGenre },
        suggestions: [`create a ${foundGenre} playlist`, 'show trending tracks'],
      };
    }
  }

  private async actionCreatePlaylist(_userId: string, msg: string): Promise<AiResponse> {
    const nameMatch =
      msg.match(/(?:called|named|:)\s*["']?([a-zA-Z0-9\s\-_àáâãäåæçèéêëìíîïðñòóôõöùúûüý]+)["']?/i) ??
      msg.match(/playlist\s+["']?([a-zA-Z0-9\s\-_]+)["']?$/i);
    const playlistName = nameMatch?.[1]?.trim();

    if (!playlistName) {
      return {
        reply: 'What would you like to name your playlist? Try: "create playlist called Gym Beats"',
        provider: 'mock',
        intent: 'create_playlist',
        actionsTaken: [],
      };
    }

    return {
      reply: `Ready to create a playlist called "${playlistName}"! Go to the Playlists page to create it, or I can help you find tracks to add.`,
      provider: 'mock',
      intent: 'create_playlist',
      actionsTaken: [`prepared playlist: ${playlistName}`],
      data: { playlistName },
      suggestions: [`add tracks to ${playlistName}`, 'find sha3by tracks'],
    };
  }

  private async actionAddTrackToPlaylist(
    _userId: string,
    trackId: string | undefined,
    msg: string,
  ): Promise<AiResponse> {
    if (!trackId) {
      return {
        reply: 'Please navigate to a track page first, then ask me to add it to a playlist.',
        provider: 'mock',
        intent: 'add_track_to_playlist',
        actionsTaken: [],
        suggestions: ['show my playlists'],
      };
    }

    const playlistMatch = msg.match(/(?:to|in)\s+(?:my\s+)?["']?([a-zA-Z0-9\s\-_]+?)["']?\s*(?:playlist)?$/i);
    const playlistName = playlistMatch?.[1]?.trim();

    if (!playlistName) {
      return {
        reply: 'Which playlist would you like to add this track to? Try: "add to Gym Beats"',
        provider: 'mock',
        intent: 'add_track_to_playlist',
        actionsTaken: [],
        suggestions: ['show my playlists'],
      };
    }

    return {
      reply: `To add this track to "${playlistName}", use the menu on the track and select "Add to playlist".`,
      provider: 'mock',
      intent: 'add_track_to_playlist',
      actionsTaken: [],
      data: { trackId, playlistName },
    };
  }

  private async actionCreatePlaylistFromGenre(_userId: string, msg: string): Promise<AiResponse> {
    const genres = ['sha3by', 'quran', 'rap', 'pop', 'jazz', 'rock', 'rnb', 'hip hop', 'electronic'];
    const genre = genres.find(g => msg.includes(g)) ?? 'mixed';
    const nameMatch = msg.match(/playlist\s+(?:called|named)?\s*["']?([a-zA-Z0-9\s\-_]+)["']?/i);
    const playlistName = nameMatch?.[1]?.trim() ?? `My ${genre} Playlist`;

    return {
      reply: `I'll help you build a ${genre} playlist! Search for "${genre}" tracks using the search bar, then create a playlist from the Playlists page and add your favorites.`,
      provider: 'mock',
      intent: 'create_playlist_from_genre',
      actionsTaken: [`identified genre: ${genre}`],
      data: { genre, suggestedName: playlistName },
      suggestions: [`search for ${genre} tracks`, `create playlist called ${playlistName}`],
    };
  }

  private async actionListPlaylists(_userId: string): Promise<AiResponse> {
    return {
      reply: 'Your playlists are available on the Playlists page. Navigate there to see all your playlists and manage them.',
      provider: 'mock',
      intent: 'list_playlists',
      actionsTaken: ['redirecting to playlists'],
      suggestions: ['create playlist called [name]', 'add track to playlist'],
    };
  }

  private actionFaqHelp(msg: string): AiResponse {
    const matched: string[] = [];

    for (const [keyword, answer] of Object.entries(FAQ_ANSWERS)) {
      if (
        msg.includes(keyword) ||
        (keyword === 'goplus' && (msg.includes('go+') || msg.includes('go plus')))
      ) {
        matched.push(answer);
      }
    }

    if (matched.length > 0) {
      return {
        reply: matched.slice(0, 2).join('\n\n'),
        provider: 'mock',
        intent: 'faq_help',
        actionsTaken: ['answered FAQ'],
        suggestions: ['how do I subscribe?', 'how to create a playlist?', 'how to upload a track?'],
      };
    }

    return {
      reply: 'I can help with: uploads, subscriptions (FREE/PRO/GO+), playlists, private tracks, queue/playback, search, likes, comments, messages, and account settings. What would you like to know?',
      provider: 'mock',
      intent: 'faq_help',
      actionsTaken: [],
    };
  }

  // ── OpenAI mode ────────────────────────────────────────────────────────────

  private async chatOpenAI(userId: string, dto: AiChatDto): Promise<AiResponse> {
    try {
      // Dynamic import to avoid crashing if openai package not installed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = (await import(/* webpackIgnore: true */ 'openai' as any)).default;
      const client = new OpenAI({ apiKey: this.openaiApiKey });

      const tools: any[] = [
        {
          type: 'function',
          function: {
            name: 'search_tracks',
            description: 'Search for tracks by title, artist, or genre',
            parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_trending_tracks',
            description: 'Get currently trending tracks',
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function',
          function: {
            name: 'recommend_by_genre',
            description: 'Recommend tracks by genre',
            parameters: { type: 'object', properties: { genre: { type: 'string' } }, required: ['genre'] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'create_playlist',
            description: 'Create a new playlist',
            parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'list_my_playlists',
            description: 'List user playlists',
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function',
          function: {
            name: 'faq_help',
            description: 'Answer FAQ about the app',
            parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
          },
        },
      ];

      const systemPrompt = `You are a helpful music streaming assistant for a social audio platform. You help users discover music, manage playlists, and understand app features. Only call the provided tools — do not perform any action not listed. Be concise and friendly.`;

      const response = await client.chat.completions.create({
        model: this.openaiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: dto.message },
        ],
        tools,
        tool_choice: 'auto',
        max_tokens: parseInt(process.env.AI_CHAT_MAX_TOKENS ?? '500'),
        temperature: parseFloat(process.env.AI_CHAT_TEMPERATURE ?? '0.7'),
      });

      const choice = response.choices[0];

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
        const toolCall = choice.message.tool_calls[0];
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

        const ALLOWED_TOOLS = new Set([
          'search_tracks',
          'get_trending_tracks',
          'recommend_by_genre',
          'create_playlist',
          'list_my_playlists',
          'faq_help',
        ]);

        if (!ALLOWED_TOOLS.has(toolName)) {
          return {
            reply: `I can't perform "${toolName}". I can help with: searching tracks, playlists, trending music, and app FAQs.`,
            provider: 'openai',
            intent: 'refused',
            actionsTaken: [],
          };
        }

        let result: AiResponse;
        switch (toolName) {
          case 'search_tracks':
            result = await this.actionSearchTracks(userId, toolArgs.query ?? dto.message);
            break;
          case 'get_trending_tracks':
            result = await this.actionGetTrending(userId);
            break;
          case 'recommend_by_genre':
            result = await this.actionRecommendByGenre(userId, toolArgs.genre ?? dto.message);
            break;
          case 'create_playlist':
            result = await this.actionCreatePlaylist(userId, `create playlist called ${toolArgs.name}`);
            break;
          case 'list_my_playlists':
            result = await this.actionListPlaylists(userId);
            break;
          case 'faq_help':
            result = this.actionFaqHelp(toolArgs.topic ?? dto.message);
            break;
          default:
            result = { reply: 'Unsupported action.', provider: 'openai', intent: 'refused', actionsTaken: [] };
        }
        return { ...result, provider: 'openai', intent: toolName };
      }

      // No tool call — direct text response
      const textReply = choice.message.content ?? 'I could not process that request.';
      return { reply: textReply, provider: 'openai', intent: 'direct', actionsTaken: [] };
    } catch (err) {
      this.logger.error(`[AI] OpenAI call failed: ${err}`);
      // Fallback to mock
      return this.chatMock(userId, dto);
    }
  }
}
