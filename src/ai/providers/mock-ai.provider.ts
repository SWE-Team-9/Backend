import { AiIntentResult } from '../types';

export const FAQ_ANSWERS: Record<string, string> = {
  upload:
    'You can upload tracks from /upload. FREE users can upload 3 tracks, PRO users can upload 100 tracks, and GO+ users can upload 1000 tracks. Supported upload formats depend on the upload module, usually MP3/WAV-style audio.',
  subscription:
    'Plans: FREE has 3 uploads, ads, and no downloads. PRO has 100 uploads, a 7-day trial for first-time PRO subscribers, no ads, and downloads. GO+ has 1000 uploads, no trial, no ads, and downloads.',
  free:
    'FREE plan: 3 track uploads, ads enabled, no downloads. You can upgrade from /subscriptions.',
  pro:
    'PRO plan: 100 uploads, 7-day trial for first-time PRO subscribers, ad-free listening, and downloads.',
  goplus:
    'GO+ plan: 1000 uploads, no trial, ad-free listening, and downloads.',
  playlist:
    'You can create and manage playlists from /library/playlists. I can also create playlists for you when you give me a name, genre, or track context.',
  private:
    'Private tracks are not public/searchable. You can set visibility while uploading or editing a track.',
  queue:
    'The queue controls what plays next. I can add the current track to the end of your queue or play it next if a queue is already loaded.',
  search:
    'Use /search or ask me to search tracks by title, artist, or genre.',
  likes:
    'Like a track by clicking the heart icon. Liked tracks appear in your library.',
  reposts:
    'Reposts share tracks to your profile/feed.',
  comments:
    'You can leave comments on track pages, including timestamped comments if supported.',
  report:
    'Use the report/flag option on tracks, comments, or profiles to report inappropriate content.',
  messages:
    'Use /messages to chat with users. I can send a track message if you are on a track page and clearly tell me who to send it to.',
  notifications:
    'Notifications appear in the bell icon. Notification settings are managed from /settings.',
  profile:
    'Edit your profile from /settings or your profile page. You can update your bio, avatar, cover, links, and favorite genres if supported.',
  account:
    'Manage your account from /settings.',
  download:
    'Downloads/offline listening are available for PRO and GO+ users. FREE users cannot download.',
  ads:
    'FREE users see ads. PRO and GO+ are ad-free.',
};

const UNSAFE_PATTERNS =
  /delete\s+(my\s+)?(account|track|playlist|all)|admin|inject|drop\s+table|exec\s*\(|password|credit\s*card|payment|billing|ban|suspend|make\s+me\s+admin/i;

const GENRE_WORDS = [
  'sha3by',
  'shaabi',
  'quran',
  'rap',
  'pop',
  'jazz',
  'rock',
  'rnb',
  'r&b',
  'hip hop',
  'hip-hop',
  'electronic',
  'classical',
  'arabic',
  'country',
  'folk',
];

export function detectMockIntent(
  message: string,
  context?: Record<string, unknown>,
): AiIntentResult {
  const msg = message.toLowerCase().trim();
  const original = message.trim();

  if (UNSAFE_PATTERNS.test(msg)) {
    return {
      intent: 'unknown',
      parameters: { originalMessage: original },
      confidence: 1,
      needsConfirmation: false,
    };
  }

  if (/(my plan|my subscription|uploads? left|how many uploads?|what plan|my account|my profile)/i.test(msg)) {
    return {
      intent: 'profile_or_subscription_help',
      parameters: {},
      confidence: 0.9,
      needsConfirmation: false,
    };
  }

  if (/(how|what|where|why|explain|help|can i|do i).*(upload|playlist|private|queue|search|like|repost|comment|report|message|notification|profile|account|download|ads?|free|pro|go\+|go plus|subscription|plan)/i.test(msg)) {
    return {
      intent: 'faq_help',
      parameters: { originalMessage: original },
      confidence: 0.85,
      needsConfirmation: false,
    };
  }

  if (/trending|popular|hot right now|top tracks|top songs|what.s hot/i.test(msg)) {
    return {
      intent: 'get_trending_tracks',
      parameters: { limit: extractLimit(msg, 10) },
      confidence: 0.9,
      needsConfirmation: false,
    };
  }

  if (/(create|make).*(playlist).*(from|with|by|of).*artist|artist.*(playlist|tracks)/i.test(msg)) {
    const genre = extractGenre(msg);
    const artist = extractArtist(original);
    const limit = extractLimit(msg, 10);
    return {
      intent: 'create_playlist_from_artist_genre',
      parameters: {
        genre,
        artist,
        limit,
        playlistName:
          extractPlaylistName(original) ??
          `${capitalize(genre)} by ${artist ?? 'Artist'}`,
      },
      confidence: artist ? 0.88 : 0.55,
      needsConfirmation: !artist,
      clarifyingQuestion: artist ? undefined : 'Which artist should I use?',
    };
  }

  if (
    /(create|make).*(playlist).*(all|top|\d+|with|from|of)/i.test(msg) &&
    /tracks?|songs?|genre|sha3by|shaabi|quran|rap|pop|jazz|rock|rnb|hip.?hop|electronic|arabic/i.test(msg)
  ) {
    const genre = extractGenre(msg);
    const allRequested = /\ball\b/i.test(msg);
    const limit = allRequested ? 25 : extractLimit(msg, 10);
    return {
      intent: 'create_playlist_from_genre',
      parameters: {
        genre,
        limit,
        allRequested,
        playlistName:
          extractPlaylistName(original) ??
          `${capitalize(genre)} Mix`,
      },
      confidence: 0.9,
      needsConfirmation: false,
    };
  }

  if (/(create|make|new).*(playlist)|playlist.*(create|make|new)/i.test(msg)) {
    const playlistName = extractPlaylistName(original);
    if (!playlistName) {
      return {
        intent: 'create_playlist',
        parameters: {},
        confidence: 0.65,
        needsConfirmation: true,
        clarifyingQuestion: 'What would you like to name the playlist?',
      };
    }

    return {
      intent: 'create_playlist',
      parameters: { playlistName },
      confidence: 0.9,
      needsConfirmation: false,
    };
  }

  if (/(add|put|save).*(to|in).*(playlist)|playlist.*add|(add|put|save).*(this\s+(track|song))|this\s+(track|song).*(add|put|save)/i.test(msg)) {
    const playlistName = extractPlaylistNameAfterTo(original);
    const trackId = context?.trackId as string | undefined;

    return {
      intent: 'add_track_to_playlist',
      parameters: {
        trackId,
        playlistId: context?.playlistId,
        playlistName,
      },
      confidence: trackId ? 0.88 : 0.65,
      needsConfirmation: !trackId || (!playlistName && !context?.playlistId),
      clarifyingQuestion: !trackId
        ? 'Please open a track first, then ask me to add it to a playlist.'
        : 'Which playlist should I add this track to?',
    };
  }

  if (/(show|list|view).*(my\s+)?playlists?|my playlists?/i.test(msg)) {
    return {
      intent: 'list_my_playlists',
      parameters: {},
      confidence: 0.9,
      needsConfirmation: false,
    };
  }

  if (/(send|share).*(track|song|this)|track.*(send|share)/i.test(msg)) {
    const recipient = extractRecipient(original);
    return {
      intent: 'share_track_message',
      parameters: {
        recipient,
        trackId: context?.trackId,
      },
      confidence: recipient ? 0.85 : 0.55,
      needsConfirmation: !recipient || !context?.trackId,
      clarifyingQuestion: !context?.trackId
        ? 'Please open a track first, then ask me to send it.'
        : 'Who would you like to send this track to?',
    };
  }

  if (/(play.*next|add.*queue|add.*next|queue.*add|queue.*this)/i.test(msg)) {
    return {
      intent: 'queue_track_or_play_next',
      parameters: {
        trackId: context?.trackId,
        mode: /next/i.test(msg) ? 'NEXT' : 'END',
      },
      confidence: context?.trackId ? 0.86 : 0.55,
      needsConfirmation: !context?.trackId,
      clarifyingQuestion: 'Please open a track first, then ask me to queue it.',
    };
  }

  if (/(recommend|suggest|give me).*(song|track|music)|\b[0-9]+\b.*(track|song)/i.test(msg)) {
    return {
      intent: 'recommend_by_genre',
      parameters: {
        genre: extractGenre(msg),
        limit: extractLimit(msg, 5),
      },
      confidence: 0.82,
      needsConfirmation: false,
    };
  }

  if (/search|find|look for|show me|get me/i.test(msg) && !/playlist/i.test(msg)) {
    const query =
      msg.match(/(?:search|find|look for|show me|get me)\s+(.+)/i)?.[1]
        ?.replace(/tracks?|songs?|music/gi, '')
        .trim() || original;

    return {
      intent: 'search_tracks',
      parameters: { query },
      confidence: 0.85,
      needsConfirmation: false,
    };
  }

  if (/upload|subscription|plan|pro|go\+|go plus|free|download|ad\b|queue|search|like\b|repost|comment|report|message|notification|profile|account|private/i.test(msg)) {
    return {
      intent: 'faq_help',
      parameters: { originalMessage: original },
      confidence: 0.8,
      needsConfirmation: false,
    };
  }

  return {
    intent: 'unknown',
    parameters: { originalMessage: original },
    confidence: 0,
    needsConfirmation: false,
  };
}

function extractGenre(msg: string): string {
  const normalized = msg.toLowerCase();
  const found = GENRE_WORDS.find((genre) => normalized.includes(genre));
  if (!found) return 'mixed';
  if (found === 'shaabi') return 'sha3by';
  if (found === 'hip hop') return 'hip-hop';
  if (found === 'r&b') return 'rnb';
  return found;
}

function extractLimit(msg: string, fallback: number): number {
  const raw = Number(msg.match(/\b(\d{1,2})\b/)?.[1] ?? fallback);
  return Math.min(Math.max(Number.isFinite(raw) ? raw : fallback, 1), 25);
}

function extractPlaylistName(msg: string): string | undefined {
  const match =
    msg.match(/(?:called|named|name it|:)\s*["']?([a-zA-Z0-9\s؀-ۿ\-_]{2,60})["']?/i) ??
    msg.match(/playlist\s+["']?([a-zA-Z0-9\s؀-ۿ\-_]{2,60})["']?\s*$/i);

  return cleanName(match?.[1]);
}

function extractPlaylistNameAfterTo(msg: string): string | undefined {
  const match = msg.match(/(?:to|in)\s+(?:my\s+)?["']?([a-zA-Z0-9\s؀-ۿ\-_]{2,60})["']?\s*(?:playlist)?$/i);
  return cleanName(match?.[1]);
}

function extractArtist(msg: string): string | undefined {
  const match =
    msg.match(/artist\s+["']?([a-zA-Z0-9_؀-ۿ\s\-]{2,60})["']?/i) ??
    msg.match(/(?:from|by)\s+["']?([a-zA-Z0-9_؀-ۿ\s\-]{2,60})["']?/i);

  return cleanName(match?.[1]);
}

function extractRecipient(msg: string): string | undefined {
  const match = msg.match(/(?:to|with)\s+["']?([a-zA-Z0-9_؀-ۿ\s\-]{2,60})["']?/i);
  return cleanName(match?.[1]?.replace(/\b(track|song|this)\b/gi, ''));
}

function cleanName(value?: string): string | undefined {
  const cleaned = value?.trim().replace(/\s+/g, ' ');
  return cleaned && cleaned.length >= 2 ? cleaned : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}