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
      expect.objectContaining({ intent: 'search_tracks' }),
      'mock',
    );
  });

  it('falls back to mock when AI_PROVIDER=n8n but webhook URL is missing', async () => {
    const service = await buildService({ AI_PROVIDER: 'n8n' });

    await service.chat('user-1', { message: 'find sha3by tracks' });

    expect(mockActionService.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ intent: 'search_tracks' }),
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
    expect(result.intent).toBe('search_tracks');
    expect(result.parameters.query).toBeTruthy();
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

  it('detects create playlist from genre with limit', () => {
    const result = detectMockIntent('create sha3by playlist with 10 songs');
    expect(result.intent).toBe('create_playlist_from_genre');
    expect(result.parameters.genre).toBe('sha3by');
    expect(result.parameters.limit).toBe(10);
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

  it('falls back safely when n8n returns unknown intent', async () => {
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

    expect(result.intent).toBe('search_tracks');
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