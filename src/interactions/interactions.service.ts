import { Injectable, NotImplementedException } from "@nestjs/common";
import { AddTimestampedCommentDto } from "./dto/add-timestamped-comment.dto";
import { CommentIdParamDto } from "./dto/comment-id-param.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { TrackIdParamDto } from "./dto/track-id-param.dto";

@Injectable()
export class InteractionsService {
  likeTrack(userId: string, params: TrackIdParamDto) {
    // TODO(Module 6): Persist like relation and update likes count.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement likeTrack");
  }

  unlikeTrack(userId: string, params: TrackIdParamDto) {
    // TODO(Module 6): Remove like relation and update likes count.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement unlikeTrack");
  }

  repostTrack(userId: string, params: TrackIdParamDto) {
    // TODO(Module 6): Persist repost relation and update repost count.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement repostTrack");
  }

  removeRepost(userId: string, params: TrackIdParamDto) {
    // TODO(Module 6): Remove repost relation and update repost count.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement removeRepost");
  }

  addTimestampedComment(userId: string, params: TrackIdParamDto, dto: AddTimestampedCommentDto) {
    // TODO(Module 6): Persist timestamped comment for the track timeline.
    void userId;
    void params;
    void dto;
    throw new NotImplementedException("TODO: implement addTimestampedComment");
  }

  getTrackComments(params: TrackIdParamDto, query: PaginationQueryDto) {
    // TODO(Module 6): Return paginated track comments with timestamps.
    void params;
    void query;
    throw new NotImplementedException("TODO: implement getTrackComments");
  }

  deleteComment(userId: string, params: CommentIdParamDto) {
    // TODO(Module 6): Delete comment when requester is owner or admin.
    void userId;
    void params;
    throw new NotImplementedException("TODO: implement deleteComment");
  }

  getTrackLikers(params: TrackIdParamDto) {
    // TODO(Module 6): Return users who liked a track.
    void params;
    throw new NotImplementedException("TODO: implement getTrackLikers");
  }

  getTrackReposters(params: TrackIdParamDto) {
    // TODO(Module 6): Return users who reposted a track.
    void params;
    throw new NotImplementedException("TODO: implement getTrackReposters");
  }
}
