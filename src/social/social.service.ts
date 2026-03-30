import { Injectable, NotImplementedException } from "@nestjs/common";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { SuggestionsQueryDto } from "./dto/suggestions-query.dto";
import { UserIdParamDto } from "./dto/user-id-param.dto";

@Injectable()
export class SocialService {
  followUser(params: UserIdParamDto) {
    // TODO: Implement follow relationship creation.
    void params;
    throw new NotImplementedException("TODO: implement followUser");
  }

  unfollowUser(params: UserIdParamDto) {
    // TODO: Implement follow relationship removal.
    void params;
    throw new NotImplementedException("TODO: implement unfollowUser");
  }

  getFollowers(params: UserIdParamDto, query: PaginationQueryDto) {
    // TODO: Implement paginated followers list retrieval.
    void params;
    void query;
    throw new NotImplementedException("TODO: implement getFollowers");
  }

  getFollowing(params: UserIdParamDto, query: PaginationQueryDto) {
    // TODO: Implement paginated following list retrieval.
    void params;
    void query;
    throw new NotImplementedException("TODO: implement getFollowing");
  }

  getSuggestions(query: SuggestionsQueryDto) {
    // TODO: Implement suggested users retrieval.
    void query;
    throw new NotImplementedException("TODO: implement getSuggestions");
  }

  blockUser(params: UserIdParamDto) {
    // TODO: Implement blocking workflow and relationship cleanup.
    void params;
    throw new NotImplementedException("TODO: implement blockUser");
  }

  unblockUser(params: UserIdParamDto) {
    // TODO: Implement unblocking workflow.
    void params;
    throw new NotImplementedException("TODO: implement unblockUser");
  }

  getBlockedUsers(query: PaginationQueryDto) {
    // TODO: Implement paginated blocked users retrieval.
    void query;
    throw new NotImplementedException("TODO: implement getBlockedUsers");
  }
}
