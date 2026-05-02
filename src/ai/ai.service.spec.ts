import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { AiActionService } from './ai-action.service';
import { detectMockIntent } from './providers/mock-ai.provider';

const mockActionService = {
  execute: jest.fn().mockResolvedValue({ reply: 'ok', provider: 'mock', intent: 'test', actionsTaken: [] }),
};

function makeConfig(values: Record<string, string> = {}) {
  return { get: jest.fn((k: string) => values[k] ?? undefined) } as unknown as ConfigService;
}

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    mockActionService.execute.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: makeConfig({ AI_PROVIDER: 'mock' }) },
        { provide: AiActionService, useValue: mockActionService },
      ],
    }).compile();
    service = module.get<AiService>(AiService);
  });

  // Test 1: service should be defined
  it('should be defined', () => expect(service).toBeDefined());

  // Test 14: mock provider requires no external env
  it('mock: works with AI_PROVIDER=mock, no keys', async () => {
    await service.chat('user-1', { message: 'how do I upload?' });
    expect(mockActionService.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ intent: 'faq_help' }),
      'mock',
    );
  });

  // Test 17: n8n fallback when URL missing
  it('n8n: falls back to mock when N8N_AI_WEBHOOK_URL not set', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: makeConfig({ AI_PROVIDER: 'n8n' }) },
        { provide: AiActionService, useValue: mockActionService },
      ],
    }).compile();
    const svc = mod.get<AiService>(AiService);
    await svc.chat('user-1', { message: 'find tracks' });
    expect(mockActionService.execute).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      'mock',
    );
  });
});

describe('detectMockIntent', () => {
  // Test 2: faq_help — upload
  it('faq: upload question → faq_help', () => {
    const r = detectMockIntent('how do I upload a track?');
    expect(r.intent).toBe('faq_help');
  });

  // Test 2b: faq_help — subscription
  it('faq: subscription question → faq_help', () => {
    const r = detectMockIntent('what is the pro plan?');
    expect(r.intent).toBe('faq_help');
  });

  // Test 3: search_tracks
  it('search: find sha3by tracks → search_tracks', () => {
    const r = detectMockIntent('find sha3by tracks');
    expect(r.intent).toBe('search_tracks');
    expect(r.parameters['query']).toBeTruthy();
  });

  // Test 4: recommend_by_genre
  it('recommend: 5 rap songs → recommend_by_genre', () => {
    const r = detectMockIntent('recommend 5 rap songs');
    expect(r.intent).toBe('recommend_by_genre');
    expect(Number(r.parameters['limit'])).toBe(5);
  });

  // Test 5a: create_playlist with name
  it('create playlist: named → create_playlist with name', () => {
    const r = detectMockIntent('create playlist called Gym Beats');
    expect(r.intent).toBe('create_playlist');
    expect(String(r.parameters['playlistName'])).toContain('Gym');
  });

  // Test 5b: create_playlist without name asks clarification
  it('create playlist: no name → asks clarification', () => {
    const r = detectMockIntent('create a playlist');
    expect(r.intent).toBe('create_playlist');
    expect(r.needsConfirmation).toBe(true);
  });

  // Test 6a: add_track_to_playlist without trackId
  it('add track: no trackId → still returns intent', () => {
    const r = detectMockIntent('add this track to Gym Beats', {});
    expect(r.intent).toBe('add_track_to_playlist');
  });

  // Test 6b: add_track_to_playlist with context.trackId
  it('add track: with context.trackId', () => {
    const r = detectMockIntent('add this to Gym Beats', { trackId: 'uuid-1' });
    expect(r.intent).toBe('add_track_to_playlist');
    expect(r.parameters['trackId']).toBe('uuid-1');
  });

  // Test 7: create_playlist_from_genre with limit
  it('playlist from genre: limit 10', () => {
    const r = detectMockIntent('create sha3by playlist with 10 songs');
    expect(r.intent).toBe('create_playlist_from_genre');
    expect(Number(r.parameters['limit'])).toBe(10);
    expect(r.parameters['genre']).toBe('sha3by');
  });

  // Test 8: create_playlist_from_genre "all" capped at 25
  it('playlist from genre: "all" capped at 25', () => {
    const r = detectMockIntent('create a playlist with all sha3by tracks');
    expect(r.intent).toBe('create_playlist_from_genre');
    expect(Number(r.parameters['limit'])).toBeLessThanOrEqual(25);
    expect(r.parameters['allRequested']).toBe(true);
  });

  // Test 9: create_playlist_from_artist_genre
  it('artist+genre playlist', () => {
    const r = detectMockIntent('create playlist with sha3by tracks from artist Ahmed');
    expect(r.intent).toBe('create_playlist_from_artist_genre');
  });

  // Test 10: share_track_message ambiguous recipient
  it('share: no clear recipient → share_track_message intent returned', () => {
    const r = detectMockIntent('send this track to a friend');
    expect(r.intent).toBe('share_track_message');
    // needsConfirmation or clarifyingQuestion indicates ambiguity
    const ambiguous = r.needsConfirmation || !!r.clarifyingQuestion;
    expect(ambiguous).toBe(true);
  });

  // Test 11: queue_track_or_play_next
  it('queue: add to queue', () => {
    const r = detectMockIntent('add to queue');
    expect(r.intent).toBe('queue_track_or_play_next');
  });

  // Test 12a: unsafe — delete account → unknown
  it('unsafe: delete account → unknown', () => {
    const r = detectMockIntent('delete my account');
    expect(r.intent).toBe('unknown');
    expect(r.actionsTaken).toBeUndefined(); // no actions field on intent result
  });

  // Test 12b: unsafe — payment action → unknown
  it('unsafe: payment deletion → unknown', () => {
    const r = detectMockIntent('delete my payment method and cancel billing');
    expect(r.intent).toBe('unknown');
  });

  // Test 13: get_trending_tracks
  it('trending: hot right now → get_trending_tracks', () => {
    const r = detectMockIntent('what is hot right now?');
    expect(r.intent).toBe('get_trending_tracks');
  });

  // Test extra: profile_or_subscription_help
  it('profile: my plan → profile_or_subscription_help', () => {
    const r = detectMockIntent('what is my plan?');
    expect(r.intent).toBe('profile_or_subscription_help');
  });
});

describe('N8nAiProvider', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Test 15: n8n sends correct payload
  it('sends correct payload structure', async () => {
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
      message: 'test',
      context: {},
      user: { id: 'u1' },
      allowedActions: ['faq_help'],
      schemaVersion: 1,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/ai',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-IQA3-AI-SECRET': 'secret' }),
      }),
    );
  });

  // Test 16: n8n rejects unknown intent, falls back to mock
  it('rejects unknown intent from n8n, falls back to mock', async () => {
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
      message: 'find tracks',
      context: {},
      user: { id: 'u1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });
    // Should fall back to mock intent
    expect([
      'search_tracks',
      'faq_help',
      'unknown',
      'get_trending_tracks',
      'recommend_by_genre',
    ]).toContain(result.intent);
  });

  // Test 17: n8n timeout falls back to mock
  it('timeout falls back to mock', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');
    const mockFetch = jest.fn().mockRejectedValue(new Error('AbortError'));
    (global as any).fetch = mockFetch;
    const result = await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'find sha3by tracks',
      context: {},
      user: { id: 'u1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });
    expect(result.intent).toBeTruthy(); // fell back to mock
  });

  // Test 18: low confidence → clarification_needed
  it('low confidence → clarification_needed', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        intent: 'search_tracks',
        parameters: {},
        confidence: 0.2,
        needsConfirmation: false,
        clarifyingQuestion: 'What do you want to find?',
      }),
    });
    (global as any).fetch = mockFetch;
    const result = await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'umm',
      context: {},
      user: { id: 'u1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });
    expect(result.intent).toBe('clarification_needed');
  });

  // Test 19: n8n HTTP error falls back to mock
  it('HTTP error from n8n falls back to mock', async () => {
    const { callN8nWebhook } = await import('./providers/n8n-ai.provider');
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    (global as any).fetch = mockFetch;
    const result = await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'find sha3by',
      context: {},
      user: { id: 'u1' },
      allowedActions: ['search_tracks'],
      schemaVersion: 1,
    });
    expect(result.intent).toBeTruthy();
  });

  // Test 20: no secret — header omitted
  it('omits X-IQA3-AI-SECRET header when secret is undefined', async () => {
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
    await callN8nWebhook('https://n8n.example.com/webhook/ai', undefined, {
      message: 'upload?',
      context: {},
      user: { id: 'u1' },
      allowedActions: ['faq_help'],
      schemaVersion: 1,
    });
    const calledHeaders = (mockFetch.mock.calls[0][1] as any).headers;
    expect(calledHeaders['X-IQA3-AI-SECRET']).toBeUndefined();
  });
});
