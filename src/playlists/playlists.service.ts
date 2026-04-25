import { Injectable } from '@nestjs/common';

import {
  AddTrackToPlaylistDto,
  CreatePlaylistDto,
  PlaylistPaginationQueryDto,
  ReorderPlaylistTracksDto,
  UpdatePlaylistDto,
} from './dto';

@Injectable()
export class PlaylistsService {
  create(_userId: string, dto: CreatePlaylistDto) {
    return {
      message: 'Create playlist placeholder',
      payload: dto,
      tracks: [],
      tracksCount: 0,
    };
  }

  getDetails(playlistId: string) {
    return {
      message: 'Get playlist details placeholder',
      playlistId,
    };
  }

  update(_userId: string, playlistId: string, dto: UpdatePlaylistDto) {
    return {
      message: 'Update playlist placeholder',
      playlistId,
      payload: dto,
    };
  }

  remove(_userId: string, playlistId: string) {
    return {
      message: 'Delete playlist placeholder',
      playlistId,
    };
  }

  addTrack(_userId: string, playlistId: string, dto: AddTrackToPlaylistDto) {
    return {
      message: 'Add track to playlist placeholder',
      playlistId,
      trackId: dto.trackId,
    };
  }

  removeTrack(_userId: string, playlistId: string, trackId: string) {
    return {
      message: 'Remove track from playlist placeholder',
      playlistId,
      trackId,
    };
  }

  reorderTracks(_userId: string, playlistId: string, dto: ReorderPlaylistTracksDto) {
    return {
      message: 'Reorder playlist tracks placeholder',
      playlistId,
      orderedTrackIds: dto.orderedTrackIds,
    };
  }

  getMyPlaylists(_userId: string, query: PlaylistPaginationQueryDto) {
    return {
      message: 'Get my playlists placeholder',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      playlists: [],
    };
  }

  resolveSecret(secretToken: string) {
    return {
      message: 'Resolve secret playlist placeholder',
      secretToken,
    };
  }

  getEmbedCode(playlistId: string) {
    return {
      message: 'Get playlist embed code placeholder',
      playlistId,
      embedCode: `<iframe src="https://example.com/embed/playlists/${playlistId}"></iframe>`,
    };
  }
}
