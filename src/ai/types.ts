export const ALLOWED_INTENTS = [
  'faq_help',
  'search_tracks',
  'get_trending_tracks',
  'recommend_by_genre',
  'create_playlist',
  'list_my_playlists',
  'add_track_to_playlist',
  'create_playlist_from_genre',
  'create_playlist_from_artist_genre',
  'share_track_message',
  'queue_track_or_play_next',
  'profile_or_subscription_help',
  'unknown',
  'clarification_needed',
] as const;

export type AllowedIntent = (typeof ALLOWED_INTENTS)[number];

export interface AiIntentResult {
  intent: AllowedIntent;
  parameters: Record<string, unknown>;
  replyDraft?: string;
  confidence: number;
  needsConfirmation: boolean;
  clarifyingQuestion?: string;
}

export interface AiResponse {
  reply: string;
  provider: 'mock' | 'n8n' | 'openai' | 'ollama';
  intent: string;
  actionsTaken: string[];
  data?: unknown;
  suggestions?: string[];
  needsConfirmation?: boolean;
}

export interface N8nWebhookPayload {
  message: string;
  context: Record<string, unknown>;
  user: { id: string };
  allowedActions: readonly string[];
  schemaVersion: 1;
}
