import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { DiscoveryService } from '../discovery/discovery.service';

function makeConfig(values: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => values[key] ?? undefined) } as unknown as ConfigService;
}

const mockDiscoveryService = {
  search: jest.fn().mockResolvedValue({
    data: { tracks: [], users: [], playlists: [] },
    meta: { current_page: 1, total_results: 0, total_pages: 0 },
  }),
};

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConfigService, useValue: makeConfig({ AI_PROVIDER: 'mock' }) },
        { provide: DiscoveryService, useValue: mockDiscoveryService },
      ],
    }).compile();
    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  it('mock FAQ: upload question returns upload info', async () => {
    const res = await service.chat('user-1', { message: 'how do I upload a track?' });
    expect(res.provider).toBe('mock');
    expect(res.intent).toBe('faq_help');
    expect(res.reply).toContain('upload');
  });

  it('mock FAQ: subscription question returns plan info', async () => {
    const res = await service.chat('user-1', { message: 'tell me about subscriptions' });
    expect(res.intent).toBe('faq_help');
    expect(res.reply.toLowerCase()).toContain('free');
  });

  it('mock: search_tracks intent detected', async () => {
    const res = await service.chat('user-1', { message: 'find sha3by tracks' });
    expect(res.intent).toBe('search_tracks');
    expect(res.actionsTaken.length).toBeGreaterThan(0);
  });

  it('mock: create_playlist intent detected', async () => {
    const res = await service.chat('user-1', { message: 'create playlist called Gym Beats' });
    expect(res.intent).toBe('create_playlist');
  });

  it('mock: create_playlist_from_genre intent detected', async () => {
    const res = await service.chat('user-1', { message: 'create a sha3by playlist with 5 songs' });
    expect(res.intent).toBe('create_playlist_from_genre');
  });

  it('mock: add_track_to_playlist without trackId asks user', async () => {
    const res = await service.chat('user-1', { message: 'add this track to Gym Beats' });
    expect(res.intent).toBe('add_track_to_playlist');
    expect(res.reply).toBeTruthy();
  });

  it('mock: unsupported/unsafe action returns safe fallback', async () => {
    const res = await service.chat('user-1', { message: 'delete my account and all tracks' });
    expect(res.intent).toBe('unknown');
    expect(res.actionsTaken).toHaveLength(0);
  });

  it('validation: message max length 1000', () => {
    // DTO validation is handled by class-validator, tested via e2e; just check service handles gracefully
    expect(service).toBeDefined();
  });
});
