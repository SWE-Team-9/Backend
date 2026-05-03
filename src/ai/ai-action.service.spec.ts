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
      findMany: jest.fn().mockResolvedValue([]),
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

  it('searches tracks through public indexed fields', async () => {
    prisma.track.findMany.mockResolvedValue([
      {
        id: TRACK_ID,
        title: 'Sha3by Track',
        slug: 'sha3by-track',
        coverArtUrl: null,
        durationMs: 180000,
        primaryGenre: { slug: 'sha3by', name: 'Sha3by' },
        uploader: {
          id: RECEIVER_ID,
          profile: { displayName: 'Artist', handle: 'artist', avatarUrl: null },
        },
        _count: { likes: 2, reposts: 1, playEvents: 5 },
      },
    ]);

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

    expect(discovery.search).not.toHaveBeenCalled();
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              deletedAt: null,
              visibility: 'PUBLIC',
              status: 'FINISHED',
              moderationState: 'VISIBLE',
              hiddenByPlanLimit: false,
            }),
          ]),
        }),
      }),
    );
    expect(result.actionsTaken[0]).toContain('searched');
  });

  it('does not execute n8n refusal responses', async () => {
    const result = await service.execute(
      USER_ID,
      {
        responseType: 'refusal',
        intent: 'create_playlist',
        parameters: { playlistName: 'Bad Idea' },
        replyDraft: 'I cannot help with that.',
        confidence: 1,
        needsConfirmation: false,
      },
      'n8n',
    );

    expect(result.intent).toBe('unknown');
    expect(result.actionsTaken).toEqual([]);
    expect(prisma.playlist.create).not.toHaveBeenCalled();
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
    prisma.genre.findMany.mockResolvedValue([{ id: 1, slug: 'sha3by', name: 'Sha3by' }]);
    prisma.track.findMany.mockResolvedValue([
      {
        id: TRACK_ID,
        title: 'Sha3by Track',
        slug: 'sha3by-track',
        coverArtUrl: null,
        durationMs: 180000,
        primaryGenre: { slug: 'sha3by', name: 'Sha3by' },
        uploader: {
          id: RECEIVER_ID,
          profile: { displayName: 'Artist', handle: 'artist', avatarUrl: null },
        },
        _count: { likes: 10, reposts: 2, playEvents: 30 },
      },
    ]);

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

    expect(discovery.getTrendingTracksByGenre).not.toHaveBeenCalled();
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              deletedAt: null,
              visibility: 'PUBLIC',
              status: 'FINISHED',
              moderationState: 'VISIBLE',
              hiddenByPlanLimit: false,
            }),
          ]),
        }),
      }),
    );
    expect(prisma.playlist.create).toHaveBeenCalled();
    expect(prisma.playlistTrack.createMany).toHaveBeenCalled();
    expect(result.actionsTaken).toContain('created playlist');
  });

  it('looks up real DB genres beyond hardcoded aliases', async () => {
    prisma.genre.findMany.mockResolvedValue([{ id: 9, slug: 'metal', name: 'Metal' }]);
    prisma.track.findMany.mockResolvedValue([
      {
        id: TRACK_ID,
        title: 'Metal Track',
        slug: 'metal-track',
        coverArtUrl: null,
        durationMs: 200000,
        primaryGenre: { slug: 'metal', name: 'Metal' },
        uploader: {
          id: RECEIVER_ID,
          profile: { displayName: 'Maryam', handle: 'maryam', avatarUrl: null },
        },
        _count: { likes: 4, reposts: 1, playEvents: 12 },
      },
    ]);

    const result = await service.execute(
      USER_ID,
      {
        intent: 'recommend_by_genre',
        parameters: { genre: 'metal', limit: 5 },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(prisma.genre.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
    expect(result.reply).toContain('metal');
    expect((result.data as any).tracks).toHaveLength(1);
  });

  it('broadens sha3by search to shaabi and mahraganat tags', async () => {
    prisma.genre.findMany.mockResolvedValue([]);
    prisma.track.findMany.mockResolvedValue([
      {
        id: TRACK_ID,
        title: 'Tagged Mahragan Track',
        slug: 'tagged-mahragan-track',
        coverArtUrl: null,
        durationMs: 180000,
        primaryGenre: { slug: 'electronic', name: 'Electronic' },
        uploader: {
          id: RECEIVER_ID,
          profile: { displayName: 'Artist', handle: 'artist', avatarUrl: null },
        },
        _count: { likes: 5, reposts: 1, playEvents: 20 },
      },
    ]);

    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist_from_genre',
        parameters: { genre: 'sha3by', limit: 5, playlistName: 'testt' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    const terms = prisma.genre.findMany.mock.calls[0][0].where.OR.map(
      (filter: any) => filter.slug?.contains ?? filter.name?.contains,
    );
    expect(terms).toEqual(expect.arrayContaining(['sha3by', 'shaabi', 'mahraganat']));
    expect(prisma.playlist.create).toHaveBeenCalled();
    expect(result.actionsTaken).toContain('created playlist');
  });

  it('creates playlist from profile using uploader handle/displayName', async () => {
    prisma.track.findMany.mockResolvedValue([
      {
        id: TRACK_ID,
        title: 'Mohan Track',
        slug: 'mohan-track',
        coverArtUrl: null,
        durationMs: 180000,
        primaryGenre: { slug: 'pop', name: 'Pop' },
        uploader: {
          id: RECEIVER_ID,
          profile: { displayName: 'Mohan', handle: 'mohan', avatarUrl: null },
        },
        _count: { likes: 7, reposts: 2, playEvents: 40 },
      },
    ]);

    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist_from_profile',
        parameters: { profileName: 'mohan', limit: 10, playlistName: 'Mohan Mix' },
        confidence: 0.95,
        needsConfirmation: false,
      },
      'gemini',
    );

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              uploader: expect.objectContaining({
                is: expect.objectContaining({
                  profile: expect.objectContaining({
                    is: expect.objectContaining({ OR: expect.any(Array) }),
                  }),
                }),
              }),
            }),
          ]),
        }),
      }),
    );
    expect(prisma.playlist.create).toHaveBeenCalled();
    expect(result.intent).toBe('create_playlist_from_profile');
    expect(prisma.playlist.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Mohan Mix' }),
      }),
    );
  });

  it('does not create empty profile playlist when no matching public tracks exist', async () => {
    prisma.track.findMany.mockResolvedValue([]);

    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist_from_profile',
        parameters: { profileName: 'mohan', limit: 10, playlistName: 'Mohan Mix' },
        confidence: 0.95,
        needsConfirmation: false,
      },
      'gemini',
    );

    expect(prisma.playlist.create).not.toHaveBeenCalled();
    expect(result.reply).toContain('did not create');
  });

  it('does not merge distinct genre aliases in DB lookup terms', async () => {
    prisma.genre.findMany.mockResolvedValue([]);
    prisma.track.findMany.mockResolvedValue([]);

    await service.execute(
      USER_ID,
      {
        intent: 'recommend_by_genre',
        parameters: { genre: 'hip hop', limit: 5 },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    const hipHopTerms = prisma.genre.findMany.mock.calls[0][0].where.OR.map(
      (filter: any) => filter.slug?.contains ?? filter.name?.contains,
    );
    expect(hipHopTerms).toEqual(expect.arrayContaining(['hip hop', 'hip-hop', 'hiphop']));
    expect(hipHopTerms).not.toContain('rap');

    prisma.genre.findMany.mockClear();
    await service.execute(
      USER_ID,
      {
        intent: 'recommend_by_genre',
        parameters: { genre: 'mahraganat', limit: 5 },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    const mahraganTerms = prisma.genre.findMany.mock.calls[0][0].where.OR.map(
      (filter: any) => filter.slug?.contains ?? filter.name?.contains,
    );
    expect(mahraganTerms).toEqual(expect.arrayContaining(['mahraganat', 'mahragan']));
    expect(mahraganTerms).not.toContain('sha3by');
  });

  it('adds variants for seeded compound genres when querying Genre table', async () => {
    prisma.genre.findMany.mockResolvedValue([{ id: 11, slug: 'drum-bass', name: 'Drum & Bass' }]);
    prisma.track.findMany.mockResolvedValue([]);

    await service.execute(
      USER_ID,
      {
        intent: 'recommend_by_genre',
        parameters: { genre: 'drum and bass', limit: 5 },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    const terms = prisma.genre.findMany.mock.calls[0][0].where.OR.map(
      (filter: any) => filter.slug?.contains ?? filter.name?.contains,
    );
    expect(terms).toEqual(expect.arrayContaining(['drum and bass', 'drum & bass', 'drum-and-bass']));
  });

  it('refuses to create an empty playlist when genre has no public finished tracks', async () => {
    prisma.genre.findMany.mockResolvedValue([{ id: 1, slug: 'quran', name: 'Quran' }]);
    prisma.track.findMany.mockResolvedValue([]);

    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist_from_genre',
        parameters: { genre: 'quran', limit: 7, playlistName: 'Quran Mix' },
        confidence: 0.9,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(prisma.playlist.create).not.toHaveBeenCalled();
    expect(prisma.playlistTrack.createMany).not.toHaveBeenCalled();
    expect(result.reply).toContain('did not create the playlist');
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
    prisma.track.findMany.mockRejectedValueOnce(new Error('Search failed'));

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

  it('returns pending context when a genre playlist needs a name', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'create_playlist_from_genre',
        parameters: { genre: 'sha3by', limit: 10 },
        confidence: 0.9,
        needsConfirmation: true,
        clarifyingQuestion: 'What would you like to name the playlist?',
      },
      'mock',
    );

    expect(result.needsConfirmation).toBe(true);
    expect(result.pendingContext).toEqual({
      pendingIntent: 'create_playlist_from_genre',
      pendingGenre: 'sha3by',
      pendingLimit: 10,
    });
    expect(prisma.playlist.create).not.toHaveBeenCalled();
  });

  it('cancels a pending action without changing data', async () => {
    const result = await service.execute(
      USER_ID,
      {
        intent: 'cancel_pending_action',
        parameters: {},
        confidence: 1,
        needsConfirmation: false,
      },
      'mock',
    );

    expect(result.pendingContext).toBeNull();
    expect(result.actionsTaken).toEqual([]);
    expect(prisma.playlist.create).not.toHaveBeenCalled();
  });
});
