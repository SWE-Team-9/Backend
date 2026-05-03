import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { AiActionService } from './ai-action.service';
import { AiService } from './ai.service';
import { detectMockIntent } from './providers/mock-ai.provider';

const mockActionService = {
  execute: jest.fn().mockResolvedValue({
    reply: 'ok',
    provider: 'mock',
    intent: 'test',
    actionsTaken: [],
  }),
};

function makeConfig(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('AiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function buildService(config: Record<string, string> = {}) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: makeConfig(config) },
        { provide: AiActionService, useValue: mockActionService },
      ],
    }).compile();

    return module.get(AiService);
  }

  it('uses mock provider by default', async () => {
    const service = await buildService();

    await service.chat('user-1', { message: 'how do I upload?' });

    expect(mockActionService.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ intent: 'faq_help' }),
      'mock',
    );
  });

  it('uses mock provider when AI_PROVIDER=mock', async () => {
    const service = await buildService({ AI_PROVIDER: 'mock' });

    await service.chat('user-1', { message: 'find sha3by tracks' });

    expect(mockActionService.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ intent: 'recommend_by_genre' }),
      'mock',
    );
  });

  it('falls back to mock when AI_PROVIDER=n8n but webhook URL is missing', async () => {
    const service = await buildService({ AI_PROVIDER: 'n8n' });

    await service.chat('user-1', { message: 'find sha3by tracks' });

    expect(mockActionService.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ intent: 'recommend_by_genre' }),
      'mock',
    );
  });
});

describe('detectMockIntent', () => {
  it('detects FAQ/help questions', () => {
    expect(detectMockIntent('how do I upload a track?').intent).toBe('faq_help');
    expect(detectMockIntent('what is the pro plan?').intent).toBe('faq_help');
  });

  it('detects track search', () => {
    const result = detectMockIntent('find sha3by tracks');
    expect(result.intent).toBe('recommend_by_genre');
    expect(result.parameters.genre).toBe('sha3by');
  });

  it('detects trending tracks', () => {
    expect(detectMockIntent('show me trending tracks').intent).toBe('get_trending_tracks');
  });

  it('detects genre recommendations with limit', () => {
    const result = detectMockIntent('recommend 5 rap songs');
    expect(result.intent).toBe('recommend_by_genre');
    expect(result.parameters.genre).toBe('rap');
    expect(result.parameters.limit).toBe(5);
  });

  it('detects best rap songs as genre recommendation with limit', () => {
    const result = detectMockIntent('find me the best 5 rap songs');
    expect(result.intent).toBe('recommend_by_genre');
    expect(result.parameters.genre).toBe('rap');
    expect(result.parameters.limit).toBe(5);
  });

  it('parses profile playlist requests without treating profile as a genre', () => {
    const explicit = detectMockIntent('create a playlist with profile mohan tracks');
    expect(explicit.intent).toBe('create_playlist_from_profile');
    expect(explicit.parameters).toEqual(
      expect.objectContaining({ profileName: 'mohan', limit: 10, playlistName: 'Mohan Mix' }),
    );

    const implicit = detectMockIntent('create a playlist with mohan tracks');
    expect(implicit.intent).toBe('create_playlist_from_profile');
    expect(implicit.parameters.profileName).toBe('mohan');
    expect(implicit.parameters.genre).toBeUndefined();
  });

  it('parses profile track searches and artist best requests', () => {
    const search = detectMockIntent('find me mohan tracks');
    expect(search.intent).toBe('search_tracks');
    expect(search.parameters).toEqual(expect.objectContaining({ profileName: 'mohan', limit: 10 }));

    const best = detectMockIntent('best track by user maryam');
    expect(best.intent).toBe('search_tracks');
    expect(best.parameters).toEqual(
      expect.objectContaining({ profileName: 'maryam', mode: 'artist_best', limit: 1 }),
    );
  });

  it('detects plain playlist creation', () => {
    const result = detectMockIntent('create playlist called Gym Beats');
    expect(result.intent).toBe('create_playlist');
    expect(result.parameters.playlistName).toContain('Gym Beats');
  });

  it('asks clarification when creating playlist without a name', () => {
    const result = detectMockIntent('create playlist');
    expect(result.intent).toBe('create_playlist');
    expect(result.needsConfirmation).toBe(true);
  });

  it('asks for a name with pending context when creating a genre playlist without one', () => {
    const result = detectMockIntent('Create a Sha3by playlist');
    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.needsConfirmation).toBe(true);
    expect(result.parameters).toEqual(expect.objectContaining({ genre: 'sha3by', limit: 10 }));
  });

  it('uses pending genre playlist context with a one-word playlist name', () => {
    const result = detectMockIntent('testt', {
      pendingIntent: 'create_playlist_from_genre',
      pendingGenre: 'sha3by',
      pendingLimit: 10,
    });

    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.needsConfirmation).toBe(false);
    expect(result.parameters).toEqual(
      expect.objectContaining({ genre: 'sha3by', limit: 10, playlistName: 'testt' }),
    );
  });

  it('clears pending context when the user cancels', () => {
    const result = detectMockIntent('cancel', {
      pendingIntent: 'create_playlist_from_genre',
      pendingGenre: 'sha3by',
      pendingLimit: 10,
    });

    expect(result.intent).toBe('cancel_pending_action');
    expect(result.needsConfirmation).toBe(false);
  });

  it('detects create playlist from genre with limit', () => {
    const result = detectMockIntent('create sha3by playlist with 10 songs');
    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters.genre).toBe('sha3by');
    expect(result.parameters.limit).toBe(10);
    expect(result.needsConfirmation).toBe(false);
  });

  it('detects create playlist from hip hop phrase with limit', () => {
    const result = detectMockIntent('create me a playlist with the best 7 hip hop songs');
    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters.genre).toBe('hip-hop');
    expect(result.parameters.limit).toBe(7);
  });

  it('detects arbitrary genre phrase without hardcoded alias', () => {
    const result = detectMockIntent('create a playlist with top 6 metal tracks');
    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters.genre).toBe('metal');
    expect(result.parameters.limit).toBe(6);
  });

  it('keeps sha3by and mahraganat as separate genre intents', () => {
    expect(detectMockIntent('create playlist with top 5 sha3by tracks').parameters.genre).toBe(
      'sha3by',
    );
    expect(detectMockIntent('create playlist with top 5 mahragan tracks').parameters.genre).toBe(
      'mahraganat',
    );
  });

  it('keeps rap and hip hop as separate genre intents', () => {
    expect(detectMockIntent('find me the best 5 rap songs').parameters.genre).toBe('rap');
    expect(detectMockIntent('find me the best 5 hip hop songs').parameters.genre).toBe(
      'hip-hop',
    );
  });

  it('normalizes seeded compound genres', () => {
    expect(detectMockIntent('create playlist with top 4 r&b songs').parameters.genre).toBe(
      'r-b-soul',
    );
    expect(detectMockIntent('create playlist with top 4 drum and bass songs').parameters.genre).toBe(
      'drum and bass',
    );
    expect(
      detectMockIntent('create playlist with top 4 folk singer songwriter songs').parameters.genre,
    ).toBe('folk singer songwriter');
  });

  it('parses every genre shape currently present in the Genre table', () => {
    const liveGenreExamples = [
      ['afrobeat', 'afrobeat'],
      ['alternative', 'alternative'],
      ['ambient', 'ambient'],
      ['blues', 'blues'],
      ['classical', 'classical'],
      ['country', 'country'],
      ['dancehall', 'dancehall'],
      ['deep house', 'deep house'],
      ['drum and bass', 'drum and bass'],
      ['electronic', 'electronic'],
      ['experimental', 'experimental'],
      ['folk singer songwriter', 'folk singer songwriter'],
      ['gospel', 'gospel'],
      ['hip hop', 'hip-hop'],
      ['house', 'house'],
      ['indie', 'indie'],
      ['islamic', 'islamic'],
      ['jazz', 'jazz'],
      ['latin', 'latin'],
      ['lo fi', 'lo fi'],
      ['metal', 'metal'],
      ['pop', 'pop'],
      ['punk', 'punk'],
      ['r&b soul', 'r-b-soul'],
      ['reggaeton', 'reggaeton'],
      ['rock', 'rock'],
      ['spoken word', 'spoken word'],
      ['techno', 'techno'],
      ['trance', 'trance'],
      ['trap', 'trap'],
      ['world', 'world'],
    ] as const;

    for (const [phrase, expectedGenre] of liveGenreExamples) {
      const result = detectMockIntent(`find me the best 5 ${phrase} songs`);
      expect(result.intent).toBe('recommend_by_genre');
      expect(result.parameters.genre).toBe(expectedGenre);
      expect(result.parameters.limit).toBe(5);
    }
  });

  it('parses every canonical app genre slug except the None selector', () => {
    const canonicalGenres = [
      'electronic',
      'hip-hop',
      'pop',
      'rock',
      'alternative',
      'ambient',
      'classical',
      'jazz',
      'r-b-soul',
      'metal',
      'folk-singer-songwriter',
      'country',
      'reggaeton',
      'dancehall',
      'drum-bass',
      'house',
      'techno',
      'deep-house',
      'trance',
      'lo-fi',
      'indie',
      'punk',
      'blues',
      'latin',
      'afrobeat',
      'trap',
      'experimental',
      'world',
      'gospel',
      'spoken-word',
      'quran',
      'sha3by',
      'islamic',
    ] as const;

    for (const genre of canonicalGenres) {
      const result = detectMockIntent(`find me the best 5 ${genre} songs`);
      expect(result.intent).toBe('recommend_by_genre');
      expect(result.parameters.genre).toBe(genre);
      expect(result.parameters.limit).toBe(5);
    }
  });

  it('detects quran search as genre recommendation', () => {
    const result = detectMockIntent('search for quran tracks');
    expect(result.intent).toBe('recommend_by_genre');
    expect(result.parameters.genre).toBe('quran');
  });

  it('caps all-genre playlist requests at 25', () => {
    const result = detectMockIntent('create a playlist with all sha3by tracks');
    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters.allRequested).toBe(true);
    expect(Number(result.parameters.limit)).toBeLessThanOrEqual(25);
  });

  it('detects artist + genre playlist', () => {
    const result = detectMockIntent('create playlist with sha3by tracks from artist Ahmed');
    expect(result.intent).toBe('create_playlist_from_artist_genre');
    expect(result.parameters.artist).toBeTruthy();
  });

  it('detects add current track to playlist with context trackId', () => {
    const result = detectMockIntent('add this track to Gym', { trackId: 'track-id' });
    expect(result.intent).toBe('add_track_to_playlist');
    expect(result.parameters.trackId).toBe('track-id');
  });

  it('asks clarification for add to playlist without context trackId', () => {
    const result = detectMockIntent('add this track to Gym');
    expect(result.intent).toBe('add_track_to_playlist');
    expect(result.needsConfirmation).toBe(true);
  });

  it('detects share current track with recipient', () => {
    const result = detectMockIntent('send this track to Ahmed', { trackId: 'track-id' });
    expect(result.intent).toBe('share_track_message');
    expect(result.parameters.recipient).toBeTruthy();
    expect(result.needsConfirmation).toBe(false);
  });

  it('asks clarification for share without recipient or track context', () => {
    const result = detectMockIntent('send this track');
    expect(result.intent).toBe('share_track_message');
    expect(result.needsConfirmation).toBe(true);
  });

  it('detects queue/play next action', () => {
    const result = detectMockIntent('play this next', { trackId: 'track-id' });
    expect(result.intent).toBe('queue_track_or_play_next');
    expect(result.parameters.mode).toBe('NEXT');
  });

  it('detects profile/subscription help', () => {
    const result = detectMockIntent('how many uploads do I have left?');
    expect(result.intent).toBe('profile_or_subscription_help');
  });

  it('refuses unsafe admin/delete/payment intents', () => {
    expect(detectMockIntent('delete my account').intent).toBe('unknown');
    expect(detectMockIntent('delete my payment method').intent).toBe('unknown');
    expect(detectMockIntent('make me admin').intent).toBe('unknown');
  });
});

describe('n8n provider helpers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('sends n8n webhook payload with secret header', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        intent: 'faq_help',
        parameters: {},
        confidence: 0.9,
        needsConfirmation: false,
      }),
    });

    (global as any).fetch = mockFetch;

    await callN8nWebhook('https://n8n.example.com/webhook/ai', 'secret', {
      message: 'upload',
      context: {},
      user: { id: 'user-1' },
      allowedActions: ['faq_help'],
      schemaVersion: 1,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/ai',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-IQA3-AI-SECRET': 'secret',
        }),
      }),
    );
  });

  it('returns safe refusal when n8n returns unknown intent', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        intent: 'DROP_TABLE_users',
        parameters: {},
        confidence: 0.99,
        needsConfirmation: false,
      }),
    });

    (global as any).fetch = mockFetch;

    const result = await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'find sha3by tracks',
      context: {},
      user: { id: 'user-1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });

    expect(result.intent).toBe('unknown');
    expect(result.responseType).toBe('refusal');
  });

  it('returns safe clarification for malformed n8n JSON object', async () => {
    const { validateN8nResponse } = await import('./providers/n8n-ai.provider');

    const result = validateN8nResponse(null, 'create playlist', {});

    expect(result.intent).toBe('clarification_needed');
    expect(result.responseType).toBe('clarification');
    expect(result.needsConfirmation).toBe(true);
  });

  it('preserves valid n8n create playlist from genre intent', async () => {
    const { validateN8nResponse } = await import('./providers/n8n-ai.provider');

    const result = validateN8nResponse(
      {
        intent: 'create_playlist_from_genre',
        parameters: { genre: 'hip hop', limit: 7 },
        confidence: 0.91,
        needsConfirmation: false,
      },
      'create me a playlist with the best 7 hip hop songs',
      {},
    );

    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters).toEqual(expect.objectContaining({ genre: 'hip hop', limit: 7 }));
    expect(result.needsConfirmation).toBe(false);
  });

  it('validates Gemini-style structured output for profile playlist intent', async () => {
    const { validateStructuredAiResponse } = await import('./providers/n8n-ai.provider');

    const result = validateStructuredAiResponse(
      {
        responseType: 'action',
        intent: 'create_playlist_from_profile',
        parameters: { profileName: 'mohan', limit: 10, playlistName: 'Mohan Mix' },
        confidence: 0.94,
        needsConfirmation: false,
      },
      'create a playlist with profile mohan tracks',
      {},
    );

    expect(result.responseType).toBe('action');
    expect(result.intent).toBe('create_playlist_from_profile');
    expect(result.parameters.profileName).toBe('mohan');
  });

  it('Gemini provider posts strict JSON parsing prompt and validates response', async () => {
    const { callGeminiStructuredParser } = await import('./providers/gemini-ai.provider');
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    responseType: 'action',
                    intent: 'search_tracks',
                    parameters: { profileName: 'mohan', limit: 10 },
                    confidence: 0.95,
                    needsConfirmation: false,
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
    (global as any).fetch = mockFetch;

    const result = await callGeminiStructuredParser('test-key', {
      message: 'find me mohan tracks',
      context: {},
      user: { id: 'user-1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('generateContent'), expect.any(Object));
    expect(result.intent).toBe('search_tracks');
    expect(result.parameters.profileName).toBe('mohan');
  });

  it('n8n validation uses pending context for short follow-up replies', async () => {
    const { validateN8nResponse } = await import('./providers/n8n-ai.provider');

    const result = validateN8nResponse(
      {
        intent: 'faq_help',
        parameters: {},
        confidence: 0.99,
        needsConfirmation: false,
      },
      'testt',
      {
        pendingIntent: 'create_playlist_from_genre',
        pendingGenre: 'sha3by',
        pendingLimit: 10,
      },
    );

    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters).toEqual(
      expect.objectContaining({ genre: 'sha3by', limit: 10, playlistName: 'testt' }),
    );
  });

  it('low confidence n8n response becomes clarification_needed', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        intent: 'search_tracks',
        parameters: {},
        confidence: 0.2,
        needsConfirmation: false,
        clarifyingQuestion: 'What do you want to search for?',
      }),
    });

    (global as any).fetch = mockFetch;

    const result = await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'umm',
      context: {},
      user: { id: 'user-1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });

    expect(result.intent).toBe('clarification_needed');
    expect(result.needsConfirmation).toBe(true);
  });

  it('falls back safely when n8n fails', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');

    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network error'));

    const result = await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'find sha3by',
      context: {},
      user: { id: 'user-1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });

    expect(result.intent).toBeTruthy();
  });
});
