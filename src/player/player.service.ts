import { Injectable, NotImplementedException } from "@nestjs/common";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { RegisterPlaybackProgressDto } from "./dto/register-playback-progress.dto";
import { TrackIdParamDto } from "./dto/track-id-param.dto";
import { UpdateQueueSessionDto } from "./dto/update-queue-session.dto";

@Injectable()
export class PlayerService {
  getPlaybackSource(userId: string, params: TrackIdParamDto) {
    // TODO(Module 5): Resolve stream URL and access state for requester.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement getPlaybackSource");
  }

  getPlaybackState(userId: string, params: TrackIdParamDto) {
    // TODO(Module 5): Resolve PLAYABLE/PREVIEW/BLOCKED state for requester.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement getPlaybackState");
  }

  registerPlaybackProgress(userId: string, params: TrackIdParamDto, dto: RegisterPlaybackProgressDto) {
    // TODO(Module 5): Persist playback progress for history and resume support.
    void userId;
    void params;
    void dto;
    throw new NotImplementedException("TODO: implement registerPlaybackProgress");
  }

  markTrackAsPlayed(userId: string, params: TrackIdParamDto) {
    // TODO(Module 5): Record play event and update recently played list.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement markTrackAsPlayed");
  }

  getRecentlyPlayed(userId: string, query: PaginationQueryDto) {
    // TODO(Module 5): Return recently played tracks in reverse chronological order.
    void userId;
    void query;
    throw new NotImplementedException("TODO: implement getRecentlyPlayed");
  }

  getListeningHistory(userId: string, query: PaginationQueryDto) {
    // TODO(Module 5): Return listening history with progress snapshots.
    void userId;
    void query;
    throw new NotImplementedException("TODO: implement getListeningHistory");
  }

  clearListeningHistory(userId: string) {
    // TODO(Module 5): Clear all listening history for current user.
    void userId;
    throw new NotImplementedException("TODO: implement clearListeningHistory");
  }

  getResumePosition(userId: string, params: TrackIdParamDto) {
    // TODO(Module 5): Return last known resume position for user/track pair.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement getResumePosition");
  }

  getQueueSession(userId: string) {
    // TODO(Module 5): Return persistent player session (current track, queue, position, volume).
    void userId;
    throw new NotImplementedException("TODO: implement getQueueSession");
  }

  updateQueueSession(userId: string, dto: UpdateQueueSessionDto) {
    // TODO(Module 5): Update persistent player session state.
    void userId;
    void dto;
    throw new NotImplementedException("TODO: implement updateQueueSession");
  }

  getTrackPreviewSource(userId: string, params: TrackIdParamDto) {
    // TODO(Module 5): Return preview source for PREVIEW access state.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement getTrackPreviewSource");
  }
}
