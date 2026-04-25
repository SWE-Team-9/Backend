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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
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

    it('throws when initial tracks contain duplicate names', async () => {
      prisma.track.findMany.mockResolvedValue([
        { id: 'trk_123', title: 'Layali' },
        { id: 'trk_456', title: 'layali' },
      ]);

      await expect(
        service.create('usr_1', {
          title: 'Playlist',
          visibility: PlaylistVisibility.PUBLIC,
          trackIds: ['trk_123', 'trk_456'],
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getDetails', () => {
    it('returns playlist details with tracks', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: 'PUBLIC',
        owner: { id: 'usr_1', profile: { displayName: 'Ahmed Hassan' } },
        tracks: [{ track: { id: 'trk_123', title: 'Layali' } }],
      });

      const result = await service.getDetails('pl_101');

      expect(result).toEqual({
        playlistId: 'pl_101',
        title: 'Late Night Drive',
        description: 'chill tracks',
        visibility: 'PUBLIC',
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
    it('updates playlist and returns success message', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      prisma.playlist.update.mockResolvedValue({});

      const result = await service.update('usr_1', 'pl_101', {
        title: 'Vol 2',
      });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: 'pl_101' },
        data: { title: 'Vol 2' },
      });
      expect(result).toEqual({ message: 'Playlist updated successfully' });
    });

    it('maps PRIVATE to SECRET and generates token if needed', async () => {
      prisma.playlist.findFirst.mockResolvedValue({
        id: 'pl_101',
        ownerId: 'usr_1',
        visibility: PlaylistVisibility.PUBLIC,
        secretToken: null,
      });
      prisma.playlist.update.mockResolvedValue({});

      await service.update('usr_1', 'pl_101', {
        visibility: 'PRIVATE',
      });

      expect(prisma.playlist.update).toHaveBeenCalledWith({
        where: { id: 'pl_101' },
        data: expect.objectContaining({
          visibility: PlaylistVisibility.SECRET,
          secretToken: expect.any(String),
        }),
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
    it('deletes playlist for owner', async () => {
      prisma.playlist.findUnique.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.playlist.delete.mockResolvedValue({});

      await service.remove('usr_1', 'pl_101');

      expect(prisma.playlist.delete).toHaveBeenCalledWith({ where: { id: 'pl_101' } });
    });

    it('throws when playlist missing', async () => {
      prisma.playlist.findUnique.mockResolvedValue(null);
      await expect(service.remove('usr_1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws when non-owner tries deleting', async () => {
      prisma.playlist.findUnique.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_x' });
      await expect(service.remove('usr_1', 'pl_101')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('addTrack', () => {
    it('adds track to playlist', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.track.findFirst.mockResolvedValue({ id: 'trk_123', title: 'Layali' });
      prisma.playlistTrack.findUnique.mockResolvedValue(null);
      prisma.playlistTrack.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ position: 2 });
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
      prisma.track.findFirst.mockResolvedValue({ id: 'trk_123', title: 'Layali' });
      prisma.playlistTrack.findUnique.mockResolvedValue({ playlistId: 'pl_101' });

      await expect(
        service.addTrack('usr_1', 'pl_101', { trackId: 'trk_123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws conflict when another track with same title already exists', async () => {
      prisma.playlist.findFirst.mockResolvedValue({ id: 'pl_101', ownerId: 'usr_1' });
      prisma.track.findFirst.mockResolvedValue({ id: 'trk_123', title: 'Layali' });
      prisma.playlistTrack.findUnique.mockResolvedValue(null);
      prisma.playlistTrack.findFirst.mockResolvedValue({ trackId: 'trk_other' });

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
      prisma.playlistTrack.update.mockResolvedValue({});

      const result = await service.reorderTracks('usr_1', 'pl_101', {
        orderedTrackIds: ['trk_3', 'trk_8'],
      });

      expect(result).toEqual({ message: 'Playlist reordered successfully' });
      expect(prisma.playlistTrack.update).toHaveBeenCalledTimes(2);
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
