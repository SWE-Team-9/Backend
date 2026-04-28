import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlaylistVisibility } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PlaylistsService } from './playlists.service';

function buildPrismaMock() {
  const prismaMock: any = {
    $executeRaw: jest.fn(),
    $transaction: jest
      .fn()
      .mockImplementation((fnOrQueries: any) =>
        typeof fnOrQueries === 'function'
          ? fnOrQueries(prismaMock)
          : Promise.all(fnOrQueries),
      ),
    playlist: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    track: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    playlistTrack: {
      create: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    playlistLike: {
      create: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  return prismaMock;
}

describe('PlaylistsService', () => {
  let service: PlaylistsService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaylistsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PlaylistsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a PUBLIC playlist with initial tracks list', async () => {
      prisma.track.findMany.mockResolvedValue([
        { id: 'trk_123', title: 'Layali' },
        { id: 'trk_456', title: 'Sahar' },
      ]);
      prisma.playlist.findFirst.mockResolvedValue(null);
      prisma.playlist.create.mockResolvedValue({
        id: 'pl_101',
        title: 'Late Night Drive',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      prisma.playlistTrack.createMany.mockResolvedValue({ count: 2 });

      const result = await service.create('usr_1', {
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: PlaylistVisibility.PUBLIC,
        trackIds: ['trk_123', 'trk_456'],
      });

      expect(result).toEqual({
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      expect(prisma.playlistTrack.createMany).toHaveBeenCalledWith({
        data: [
          {
            playlistId: 'pl_101',
            trackId: 'trk_123',
            position: 0,
          },
          {
            playlistId: 'pl_101',
            trackId: 'trk_456',
            position: 1,
          },
        ],
      });
    });

    it('throws when track list is empty', async () => {
      await expect(
        service.create('usr_1', {
          title: 'Playlist',
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: [],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when initial tracks include duplicate IDs', async () => {
      await expect(
        service.create('usr_1', {
          title: 'Playlist',
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ['trk_1', 'trk_1'],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when an initial track does not exist', async () => {
      prisma.track.findMany.mockResolvedValue([{ id: 'trk_123', title: 'Layali' }]);

      await expect(
        service.create('usr_1', {
          title: 'Playlist',
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ['trk_123', 'missing'],
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows initial tracks with same title if IDs are different', async () => {
      prisma.track.findMany.mockResolvedValue([{ id: 'trk_123' }, { id: 'trk_456' }]);
      prisma.playlist.findFirst.mockResolvedValue(null);
      prisma.playlist.create.mockResolvedValue({
        id: 'pl_101',
        title: 'Playlist',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      prisma.playlistTrack.createMany.mockResolvedValue({ count: 2 });

      await expect(
        service.create('usr_1', {
          title: 'Playlist',
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ['trk_123', 'trk_456'],
        } as any),
      ).resolves.toBeTruthy();
    });
  });

  describe('getDetails', () => {
    it('returns playlist details with tracks and hides secretToken for non-owner', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: 'PUBLIC',
        secretToken: 'sec_hidden',
        owner: { id: 'usr_1', profile: { displayName: 'Ahmed Hassan' } },
      });
      prisma.playlistTrack.count.mockResolvedValue(1);
      prisma.playlistTrack.findMany.mockResolvedValue([{ track: { id: 'trk_123', title: 'Layali' } }]);

      const result = await service.getDetails('pl_101', 'usr_2');

      expect(result).toEqual({
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: 'PUBLIC',
        owner: { id: 'usr_1', display_name: 'Ahmed Hassan' },
        tracks: [{ trackId: 'trk_123', title: 'Layali' }],
      });
      expect(result).not.toHaveProperty('secretToken');
    });

    it('returns playlist details with secretToken for owner', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: 'SECRET',
        secretToken: 'sec_owner_visible',
        owner: { id: 'usr_1', profile: { displayName: 'Ahmed Hassan' } },
      });
      prisma.playlistTrack.count.mockResolvedValue(1);
      prisma.playlistTrack.findMany.mockResolvedValue([{ track: { id: 'trk_123', title: 'Layali' } }]);

      const result = await service.findOne('pl_101', 'usr_1');

      expect(result).toEqual({
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: 'SECRET',
        secretToken: 'sec_owner_visible',
        owner: { id: 'usr_1', display_name: 'Ahmed Hassan' },
        tracks: [{ trackId: 'trk_123', title: 'Layali' }],
      });
    });

    it('throws when playlist does not exist', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.getDetails('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates playlist and returns sanitized payload', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      prisma.playlist.update.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        title: 'Vol 2',
        description: null,
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
        owner: { id: 'usr_1', profile: { displayName: 'Ahmed Hassan' } },
        tracks: [],
      });

      const result = await service.update('usr_1', 'pl_101', {
        title: 'Vol 2',
      });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: 'pl_101' },
        data: { title: 'Vol 2' },
        select: expect.any(Object),
      });
      expect(result).toEqual({
        message: 'Playlist updated successfully',
        playlist: {
          playlistId: 'pl_101',
          title: 'Vol 2',
          description: null,
          visibility: PlaylistVisibility.PUBLIC,
          secretToken: null,
          owner: { id: 'usr_1', display_name: 'Ahmed Hassan' },
          tracks: [],
        },
      });
    });

    it('maps PRIVATE to SECRET and generates UUID token if needed', async () => {
      prisma.playlist.findFirst
        .mockResolvedValueOnce({
          id: 'pl_101',
          ownerId: 'usr_1',
          visibility: PlaylistVisibility.PUBLIC,
          secretToken: null,
        })
        .mockResolvedValueOnce(null);
      prisma.playlist.update.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        title: 'Late Night Drive',
        description: null,
        visibility: PlaylistVisibility.SECRET,
        secretToken: 'placeholder',
        owner: { id: 'usr_1', profile: { displayName: 'Ahmed Hassan' } },
        tracks: [],
      });

      await service.update('usr_1', 'pl_101', {
        visibility: 'PRIVATE',
      });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: 'pl_101' },
        data: expect.objectContaining({
          visibility: PlaylistVisibility.SECRET,
          secretToken: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
        }),
        select: expect.any(Object),
      });
    });

    it('throws when playlist missing', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(
        service.update('usr_1', 'missing', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when user is not owner', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'someone-else',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      await expect(
        service.update('usr_1', 'pl_101', { title: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws when no update fields provided', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      await expect(service.update('usr_1', 'pl_101', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('soft deletes playlist for owner', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlist.update.mockResolvedValue({});

      await service.remove('usr_1', 'pl_101');

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: 'pl_101' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('throws when playlist missing', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.remove('usr_1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws when non-owner tries deleting', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_x' });
      await expect(service.remove('usr_1', 'pl_101')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('likePlaylist', () => {
    it('likes a playlist', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101' });
      prisma.playlistLike.findUnique.mockResolvedValue(null);
      prisma.playlistLike.create.mockResolvedValue({});

      const result = await service.likePlaylist('usr_1', 'pl_101');

      expect(prisma.playlistLike.findUnique).toHaveBeenCalledWith({
        where: {
          userId_playlistId: {
            userId: 'usr_1',
            playlistId: 'pl_101',
          },
        },
        select: {
          userId: true,
        },
      });
      expect(prisma.playlistLike.create).toHaveBeenCalledWith({
        data: {
          userId: 'usr_1',
          playlistId: 'pl_101',
        },
      });
      expect(result).toEqual({ message: 'Playlist liked successfully' });
    });

    it('throws conflict when playlist is already liked', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101' });
      prisma.playlistLike.findUnique.mockResolvedValue({ userId: 'usr_1' });

      await expect(service.likePlaylist('usr_1', 'pl_101')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.playlistLike.create).not.toHaveBeenCalled();
    });

    it('throws when playlist is missing', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.likePlaylist('usr_1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('unlikePlaylist', () => {
    it('unlikes a playlist', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101' });
      prisma.playlistLike.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.unlikePlaylist('usr_1', 'pl_101');

      expect(prisma.playlistLike.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'usr_1',
          playlistId: 'pl_101',
        },
      });
      expect(result).toEqual({ message: 'Playlist unliked successfully' });
    });

    it('throws when playlist is missing', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);

      await expect(service.unlikePlaylist('usr_1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('addTrack', () => {
    it('adds track to playlist', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.track.findFirst.mockResolvedValue({ id: 'trk_123' });
      prisma.playlistTrack.aggregate.mockResolvedValue({ _count: { _all: 3 }, _max: { position: 2 } });
      prisma.playlistTrack.create.mockResolvedValue({});

      const result = await service.addTrack('usr_1', 'pl_101', { trackId: 'trk_123' });

      expect(prisma.playlistTrack.create).toHaveBeenCalledWith({
        data: { playlistId: 'pl_101', trackId: 'trk_123', position: 3 },
      });
      expect(result).toEqual({
        message: 'Track added to playlist successfully',
        playlistId: 'pl_101',
        trackId: 'trk_123',
      });
    });

    it('throws conflict when track already exists in playlist', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.track.findFirst.mockResolvedValue({ id: 'trk_123' });
      prisma.playlistTrack.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { position: null } });
      prisma.playlistTrack.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.addTrack('usr_1', 'pl_101', { trackId: 'trk_123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('removeTrack', () => {
    it('removes track and reindexes positions', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlistTrack.findUnique.mockResolvedValue({ position: 1 });
      prisma.playlistTrack.delete.mockResolvedValue({});
      prisma.playlistTrack.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.removeTrack('usr_1', 'pl_101', 'trk_123');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Track removed from playlist successfully' });
    });

    it('throws when track is not in playlist', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlistTrack.findUnique.mockResolvedValue(null);

      await expect(
        service.removeTrack('usr_1', 'pl_101', 'trk_999'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reorderTracks', () => {
    it('reorders tracks successfully', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlistTrack.findMany.mockResolvedValue([
        { trackId: 'trk_8' },
        { trackId: 'trk_3' },
      ]);
      prisma.$executeRaw.mockResolvedValue(2);

      const result = await service.reorderTracks('usr_1', 'pl_101', {
        orderedTrackIds: ['trk_3', 'trk_8'],
      });

      expect(result).toEqual({ message: 'Playlist reordered successfully' });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('throws when orderedTrackIds miss some existing tracks', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlistTrack.findMany.mockResolvedValue([
        { trackId: 'trk_8' },
        { trackId: 'trk_3' },
      ]);

      await expect(
        service.reorderTracks('usr_1', 'pl_101', { orderedTrackIds: ['trk_8'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when unknown track ids are provided', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlistTrack.findMany.mockResolvedValue([{ trackId: 'trk_8' }]);

      await expect(
        service.reorderTracks('usr_1', 'pl_101', { orderedTrackIds: ['trk_x'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getMyPlaylists', () => {
    it('returns paginated playlists with total and tracksCount', async () => {
      prisma.playlist.count.mockResolvedValue(5);
      prisma.playlist.findMany.mockResolvedValue([
        {
          id: 'pl_101',
          title: 'Late Night Drive',
          visibility: 'PUBLIC',
          _count: { tracks: 12 },
        },
      ]);

      const result = await service.getMyPlaylists('usr_1', { page: 1, limit: 20 });

      expect(result).toEqual({
        page: 1,
        limit: 20,
        total: 5,
        playlists: [
          {
            playlistId: 'pl_101',
            title: 'Late Night Drive',
            visibility: 'PUBLIC',
            tracksCount: 12,
          },
        ],
      });
    });
  });

  describe('resolveSecret', () => {
    it('returns private access payload when token is valid', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        title: 'Late Night Drive',
      });

      const result = await service.resolveSecret('sec_token');

      expect(result).toEqual({
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        visibility: 'PRIVATE',
        message: 'Access granted via secret token',
      });
    });

    it('throws when secret token is invalid', async () => {
      prisma.playlist.findFirst.mockResolvedValue(null);
      await expect(service.resolveSecret('bad')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getEmbedCode', () => {
    it('returns embed code for owner', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });

      const result = await service.getEmbedCode('usr_1', 'pl_101');

      expect(result).toEqual({
        playlistId: 'pl_101',
        embedCode: '<iframe src="https://example.com/embed/playlists/pl_101"></iframe>',
      });
    });

    it('throws when requester is not owner', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_2' });

      await expect(service.getEmbedCode('usr_1', 'pl_101')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
