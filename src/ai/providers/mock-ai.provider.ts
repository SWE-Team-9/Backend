import { AllowedIntent, AiIntentResult } from '../types';

export const FAQ_ANSWERS: Record<string, string> = {
  upload: 'You can upload tracks from the Upload page. FREE users: 3 tracks max. PRO: 100 tracks. GO+: 1000 tracks. Supported formats: MP3, WAV, FLAC.',
  subscription: 'Plans: FREE (3 uploads, ads, no downloads), PRO ($9.99/mo, 100 uploads, 7-day trial, ad-free, downloads), GO+ ($19.99/mo, 1000 uploads, no trial, ad-free, downloads).',
  free: 'FREE plan: 3 track uploads, ads enabled, no downloads. Upgrade to PRO or GO+ to remove limits.',
  pro: 'PRO plan: $9.99/month, 100 uploads, 7-day free trial (first time only), ad-free, downloads enabled.',
  goplus: 'GO+ plan: $19.99/month, 1000 uploads, no trial, ad-free, downloads enabled. Best for serious creators.',
  playlist: 'Create playlists from the Playlists page. You can add tracks from any track page.',
  private: 'Set track visibility to private when uploading or from the track edit page.',
  queue: 'Click any track to play it. Use the queue icon to see your queue. Add to queue from any track menu.',
  search: 'Use the search bar at the top to find tracks by title, artist, or genre.',
  likes: 'Like a track by clicking the heart icon. View liked tracks in your library.',
  reposts: 'Repost a track to share it with your followers.',
  comments: 'Leave comments on any track page.',
  report: 'Report inappropriate content using the flag icon on track or profile pages.',
  messages: 'Send messages from a user profile page or from any track page using the share/message option.',
  notifications: 'Notifications appear in the bell icon at the top. Manage in Settings > Notifications.',
  profile: 'Edit your profile from Settings > Profile. Add bio, avatar, and cover image.',
  account: 'Manage your account from Settings. Change email, password, and notification preferences.',
  download: 'PRO and GO+ subscribers can download tracks. FREE users cannot.',
  ads: 'FREE users see ads every few tracks. PRO and GO+ plans are ad-free.',
};

const UNSAFE_PATTERNS = /delete\s+(my\s+)?(account|track|playlist|all)|admin|inject|drop\s+table|exec\s*\(|password|credit\s*card|payment\s+method\s+delete/i;

export function detectMockIntent(message: string, context?: Record<string, unknown>): AiIntentResult {
  const msg = message.toLowerCase();
  const original = message;

  if (UNSAFE_PATTERNS.test(msg)) {
    return { intent: 'unknown', parameters: {}, confidence: 1, needsConfirmation: false };
  }

  // Trending
  if (/trending|popular|top tracks|hot right now|what.s hot/.test(msg)) {
    return { intent: 'get_trending_tracks', parameters: {}, confidence: 0.9, needsConfirmation: false };
  }

  // Create playlist from genre+artist
  if (/(create|make).*(playlist).*(from|with|by|of).*artist|artist.*(playlist|tracks)/.test(msg)) {
    const genre = extractGenre(msg);
    const artistMatch = msg.match(/(?:from|by|of|artist)\s+([a-zA-Z0-9\s؀-ۿ]+?)(?:\s|$)/i);
    const artist = artistMatch?.[1]?.trim();
    return { intent: 'create_playlist_from_artist_genre', parameters: { genre, artist }, confidence: 0.85, needsConfirmation: false };
  }

  // Create playlist from genre (with count or "all")
  if (
    ((/(create|make).*(playlist).*(with|from|of|all)/.test(msg) || /playlist.*(all|from|genre|sha3by|quran|rap|pop|jazz|rock|rnb|hip.?hop|electronic)/.test(msg)) &&
      /sha3by|quran|rap|pop|jazz|rock|rnb|hip.?hop|electronic|genre/.test(msg))
  ) {
    const genre = extractGenre(msg);
    const limitMatch = msg.match(/(\d+)\s*(?:tracks?|songs?)/);
    const allRequested = /\ball\b/.test(msg);
    const limit = allRequested ? 25 : Math.min(parseInt(limitMatch?.[1] ?? '10'), 25);
    const playlistName = extractPlaylistName(original) ?? `My ${genre} Playlist`;
    return { intent: 'create_playlist_from_genre', parameters: { genre, limit, playlistName, allRequested }, confidence: 0.9, needsConfirmation: false };
  }

  // Create playlist (plain)
  if (/(create|make|new).*(playlist)|playlist.*(create|make|new)/.test(msg)) {
    const playlistName = extractPlaylistName(original);
    if (!playlistName) return { intent: 'create_playlist', parameters: {}, confidence: 0.6, needsConfirmation: true, clarifyingQuestion: 'What would you like to name your playlist?' };
    return { intent: 'create_playlist', parameters: { playlistName }, confidence: 0.9, needsConfirmation: false };
  }

  // Add to playlist — matches "add ... to playlist", "add ... to [name]", "add ... in playlist"
  if (/(add|put|save).*(to|in).*(playlist)|playlist.*add|(add|put|save)\s+.{0,30}\s(to|in)\s+\S/.test(msg)) {
    const trackId = (context?.trackId as string | undefined);
    const playlistName = msg.match(/(?:to|in)\s+(?:my\s+)?["']?([a-zA-Z0-9\s\-_]+?)["']?\s*(?:playlist)?$/i)?.[1]?.trim();
    return { intent: 'add_track_to_playlist', parameters: { trackId, playlistName }, confidence: 0.85, needsConfirmation: !trackId };
  }

  // List playlists
  if (/(show|list|my|view).*(playlist)|playlist.*(show|list|mine)/.test(msg)) {
    return { intent: 'list_my_playlists', parameters: {}, confidence: 0.9, needsConfirmation: false };
  }

  // Share track
  if (/(send|share).*(track|song|this)|track.*(send|share)/.test(msg)) {
    const recipientMatch = msg.match(/(?:to|with)\s+([a-zA-Z0-9_؀-ۿ\s]+?)(?:\s|$)/i);
    const recipient = recipientMatch?.[1]?.trim();
    if (!recipient) return { intent: 'share_track_message', parameters: {}, confidence: 0.5, needsConfirmation: true, clarifyingQuestion: 'Who would you like to send this track to?' };
    return { intent: 'share_track_message', parameters: { recipient, trackId: context?.trackId }, confidence: 0.85, needsConfirmation: true };
  }

  // Queue/play next
  if (/(play.*(next|now)|add.*(queue|next)|queue.*(add|play))/.test(msg)) {
    return { intent: 'queue_track_or_play_next', parameters: { trackId: context?.trackId }, confidence: 0.85, needsConfirmation: false };
  }

  // Profile/subscription help
  if (/(my plan|my subscription|uploads? left|how many uploads?|what plan|my account|my profile)/.test(msg)) {
    return { intent: 'profile_or_subscription_help', parameters: {}, confidence: 0.9, needsConfirmation: false };
  }

  // Recommend by genre (explicit count) — require standalone number, not a digit embedded in a word
  if (/(recommend|suggest|give me).*(song|track|music)|\b[0-9]+\b.*(track|song)/.test(msg)) {
    const genre = extractGenre(msg);
    const limitMatch = msg.match(/\b(\d+)\b/);
    const limit = Math.min(parseInt(limitMatch?.[1] ?? '5'), 25);
    return { intent: 'recommend_by_genre', parameters: { genre, limit }, confidence: 0.8, needsConfirmation: false };
  }

  // Search tracks
  if (/search|find|look for|show me|get me/.test(msg) && !/playlist|trending/.test(msg)) {
    const queryMatch = msg.match(/(?:search|find|look for|show me|get me)\s+(.+)/i);
    const query = queryMatch?.[1]?.replace(/tracks?|songs?|music/gi, '').trim() ?? msg.trim();
    return { intent: 'search_tracks', parameters: { query }, confidence: 0.85, needsConfirmation: false };
  }

  // FAQ
  if (/upload|subscription|plan|pro|go\+|go plus|free plan|download|ad\b|queue|search|like\b|repost|comment|report|message|notification|profile|account|password|private/.test(msg)) {
    return { intent: 'faq_help', parameters: { originalMessage: message }, confidence: 0.8, needsConfirmation: false };
  }

  return { intent: 'unknown', parameters: {}, confidence: 0, needsConfirmation: false };
}

function extractGenre(msg: string): string {
  const genres = ['sha3by', 'quran', 'rap', 'pop', 'jazz', 'rock', 'rnb', 'r&b', 'hip hop', 'hip-hop', 'electronic', 'classical', 'arabic', 'country', 'folk'];
  return genres.find(g => msg.includes(g)) ?? 'mixed';
}

function extractPlaylistName(msg: string): string | undefined {
  const match =
    msg.match(/(?:called|named|:)\s*["']?([a-zA-Z0-9\s؀-ۿ\-_]{2,40})["']?/i) ??
    msg.match(/playlist\s+["']?([a-zA-Z0-9\s؀-ۿ\-_]{2,40})["']?\s*$/i);
  return match?.[1]?.trim();
}
