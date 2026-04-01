import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateCommentDto } from "./dto/comment.dto";
import { EngagementService } from "./engagement.service";

@Controller("tracks")
export class EngagementController {
  constructor(private readonly engagementService: EngagementService) {}

  @Post(":id/like")
  @HttpCode(HttpStatus.NO_CONTENT)
  likeTrack(
    @CurrentUser("userId") userId: string,
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ): Promise<void> {
    return this.engagementService.likeTrack(userId, trackId);
  }

  @Delete(":id/like")
  @HttpCode(HttpStatus.NO_CONTENT)
  unlikeTrack(
    @CurrentUser("userId") userId: string,
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ): Promise<void> {
    return this.engagementService.unlikeTrack(userId, trackId);
  }

  @Post(":id/repost")
  @HttpCode(HttpStatus.NO_CONTENT)
  repostTrack(
    @CurrentUser("userId") userId: string,
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ): Promise<void> {
    return this.engagementService.repostTrack(userId, trackId);
  }

  @Delete(":id/repost")
  @HttpCode(HttpStatus.NO_CONTENT)
  unrepostTrack(
    @CurrentUser("userId") userId: string,
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ): Promise<void> {
    return this.engagementService.unrepostTrack(userId, trackId);
  }

  @Post(":id/comments")
  createComment(
    @CurrentUser("userId") userId: string,
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
    @Body() body: CreateCommentDto,
  ): Promise<{
    id: string;
    content: string;
    timestampAt: number;
    user: {
      userId: string;
      displayName: string | null;
      avatarUrl: string | null;
    };
  }> {
    return this.engagementService.createComment(
      userId,
      trackId,
      body.content,
      body.timestampAt,
    );
  }

  @Get(":id/comments")
  getTrackComments(
    @Param("id", new ParseUUIDPipe({ version: "4" })) trackId: string,
  ): Promise<
    {
      id: string;
      content: string;
      timestampAt: number;
      user: {
        userId: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
    }[]
  > {
    return this.engagementService.getTrackComments(trackId);
  }
}