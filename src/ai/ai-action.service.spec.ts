import { Test, TestingModule } from '@nestjs/testing';

import { AiActionService } from './ai-action.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { MessagesService } from '../messages/messages.service';
import { PlayerService } from '../player/player.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { PrismaService } from '../prisma/prisma.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TRACK_ID = '22222222-2222-4222-8222-222222222222';
const PLAYLIST_ID = '33333333-3333-4333-8333-333333333333';
const RECEIVER_ID = '44444444-4444-4444-8444-444444444444';

function makePrismaMock() {
  return {
    playlist: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: PLAYLIST_ID,
        title: 'Gym Beats',
        slug: 'gym-beats',
        visibility: 'PUBLIC',
        coverImageUrl: null,
        coverArtUrl: null,
        genre: null,
        _count: { tracks: 0 },
      }),
    },
    playlistTrack: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    genre: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
    },
    track: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('AiActionService', () => {
  let service: AiActionService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let playlists: Record<string, jest.Mock>;
  let discovery: Record<string, jest.Mock>;
  let messages: Record<string, jest.Mock>;
  let player: Record<string, jest.Mock>;
  let entitlements: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    // Wire $transaction to use the outer prisma mock so call assertions work
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    });

    discovery = {
      search: jest.fn().mockResolvedValue({
        data: {
          tracks: [
            {
              id: TRACK_ID,
              title: 'Test Track',
              slug: 'test-track',
              coverArtUrl: null,
              uploaderId: RECEIVER_ID,
              artistHandle: 'artist',
            },
          ],
        },
      }),
      trending: jest.fn().mockResolvedValue({
        items: [
          {
            id: TRACK_ID,
            title: 'Trending Track',
            slug: 'trending-track',
            coverArtUrl: null,
            uploaderId: RECEIVER_ID,
            uploader: { handle: 'artist', displayName: 'Artist' },
            recentLikes: 5,
          },
        ],
      }),
      getTrendingTracksByGenre: jest.fn().mockResolvedValue({
        tracks: [
          {
            trackId: TRACK_ID,
            title: 'Sha3by Track',
            slug: 'sha3by-track',
            coverArtUrl: null,
            likesCount: 10,
            artist: { id: RECEIVER_ID, handle: 'artist', displayName: 'Artist' },
          },
        ],
      }),
    };

    playlists = {
      create: jest.fn(),
      addTrack: jest.fn().mockResolvedValue({
        message: 'Track added to playlist successfully',
        playlistId: PLAYLIST_ID,
        trackId: TRACK_ID,
        title: 'Test Track',
        coverArtUrl: null,
        artist: { id: RECEIVER_ID, name: 'Artist', handle: 'artist' },
      }),
      getMyPlaylists: jest.fn().mockResolvedValue({
        page: 1,
        limit: 10,
        total: 1,
        playlists: [
          {
            playlistId: PLAYLIST_ID,
            title: 'Gym Beats',
            tracksCount: 0,
          },
        ],
      }),
    };

    messages = {
      sendMessage: jest.fn().mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
      }),
    };

    player = {
      addQueueItem: jest.fn().mockResolvedValue({ queueLength: 3, insertedAt: 2 }),
      loadQueueContext: jest.fn().mockResolvedValue({
        currentTrack: { trackId: TRACK_ID, title: 'Test Track' },
        currentIndex: 0,
        queueLength: 1,
      }),
    };

    entitlements = {
      getUserEntitlements: jest.fn().mockResolvedValue({
        planCode: 'FREE',
        uploadLimit: 3,
        uploadedCount: 1,
        remainingUploads: 2,
        canDownload: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiActionService,
        { provide: DiscoveryService, useValue: discovery },
        { provide: PlaylistsService, useValue: playlists },
        { provide: MessagesService, useValue: messages },
        { provide: PlayerService, useValue: player },
        { provide: EntitlementsService, useValue: entitlements },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AiActionService);
  });

  it('answers FAQ', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'faq_help',
        parameters: { originalMessage: 'how do I upload?' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(result.intent).toBe('faq_help');
    expect(result.actionsTaken).toContain('answered FAQ');
  });

  it('searches tracks through DiscoveryService', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'search_tracks',
        parameters: { query: 'sha3by' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(discovery.search).toHaveBeenCalledWith('sha3by', 'tracks', 1, 8);
    expect(result.actionsTaken[0]).toContain('searched');
  });

  it('creates an empty playlist for create_playlist', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist',
        parameters: { playlistName: 'Gym Beats' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(prisma.playlist.create).toHaveBeenCalled();
    expect(result.actionsTaken).toContain('created playlist');
  });

  it('lists user playlists through PlaylistsService', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'list_my_playlists',
        parameters: {},
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(playlists.getMyPlaylists).toHaveBeenCalledWith(USER_ID, { page: 1, limit: 10 });
    expect(result.intent).toBe('list_my_playlists');
  });

  it('adds current track to owned playlist', async () => {
    prisma.playlist.findMany.mockResolvedValue([{ id: PLAYLIST_ID, title: 'Gym Beats' }]);

    const result = await service.execute(
      USER_ID,
      {
        intent: 'add_track_to_playlist',
        parameters: { trackId: TRACK_ID, playlistName: 'Gym Beats' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(playlists.addTrack).toHaveBeenCalledWith(USER_ID, PLAYLIST_ID, { trackId: TRACK_ID });
    expect(result.actionsTaken).toContain('added track to playlist');
  });

  it('creates playlist from genre and adds found tracks', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist_from_genre',
        parameters: { genre: 'sha3by', limit: 5, playlistName: 'Sha3by Mix' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(discovery.getTrendingTracksByGenre).toHaveBeenCalledWith('sha3by', 5);
    expect(prisma.playlist.create).toHaveBeenCalled();
    expect(prisma.playlistTrack.createMany).toHaveBeenCalled();
    expect(result.actionsTaken).toContain('created playlist');
  });

  it('sends track message when recipient and track exist', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: RECEIVER_ID,
        profile: { displayName: 'Ahmed', handle: 'ahmed', avatarUrl: null },
      },
    ]);

    prisma.track.findFirst.mockResolvedValue({
      id: TRACK_ID,
      title: 'Test Track',
      slug: 'test-track',
      coverArtUrl: null,
      durationMs: 1000,
      uploader: {
        id: RECEIVER_ID,
        profile: { displayName: 'Artist', handle: 'artist', avatarUrl: null },
      },
    });

    const result = await service.execute(
      USER_ID,
      {
        intent: 'share_track_message',
        parameters: { recipient: 'Ahmed', trackId: TRACK_ID },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(messages.sendMessage).toHaveBeenCalled();
    expect(result.actionsTaken).toContain('sent track message');
  });

  it('queues current track using PlayerService.addQueueItem', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'queue_track_or_play_next',
        parameters: { trackId: TRACK_ID, mode: 'NEXT' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(player.addQueueItem).toHaveBeenCalledWith(USER_ID, TRACK_ID, 'NEXT');
    expect(result.actionsTaken).toContain('added track to play next');
  });

  it('loads a new queue if addQueueItem fails because no queue exists', async () => {
    player.addQueueItem.mockRejectedValueOnce(new Error('NO_QUEUE'));

    const result = await service.execute(
      USER_ID,
      {
        intent: 'queue_track_or_play_next',
        parameters: { trackId: TRACK_ID, mode: 'END' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(player.loadQueueContext).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        contextType: 'TRACK',
        startTrackId: TRACK_ID,
      }),
    );
    expect(result.actionsTaken).toContain('loaded queue from current track');
  });

  it('checks profile/subscription entitlements', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'profile_or_subscription_help',
        parameters: {},
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(entitlements.getUserEntitlements).toHaveBeenCalledWith(USER_ID);
    expect(result.actionsTaken).toContain('checked subscription entitlements');
  });

  it('does not claim success when a service fails', async () => {
    discovery.search.mockRejectedValueOnce(new Error('Search failed'));

    const result = await service.execute(
      USER_ID,
      {
        intent: 'search_tracks',
        parameters: { query: 'sha3by' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(result.actionsTaken).toEqual([]);
    expect(result.reply).toContain('could not complete');
  });

  it('requires clarification when intent result asks for it', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist',
        parameters: {},
        confidence: 0.5,
        needsConfirmation: true,
        clarifyingQuestion: 'What should I name the playlist?',
      },
      'mock',
    );

    expect(result.needsConfirmation).toBe(true);
    expect(result.actionsTaken).toEqual([]);
  });
});