import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { MessagesService } from "./messages.service";
import { SendMessageDto } from "./dto/send-message.dto";
import { ShareTrackDto } from "./dto/share-track.dto";
import { SharePlaylistDto } from "./dto/share-playlist.dto";
import { ConversationQueryDto } from "./dto/conversation-query.dto";
import { ConversationMessagesQueryDto } from "./dto/conversation-messages-query.dto";
import { DirectConversationDto } from "./dto/direct-conversation.dto";

@Controller("api/v1/messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // GET /api/v1/messages/conversations
  @Get("conversations")
  getConversations(
    @CurrentUser("userId") userId: string,
    @Query() query: ConversationQueryDto,
  ) {
    return this.messagesService.getConversations(
      userId,
      query.archived ?? false,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  // POST /api/v1/messages/conversations/direct
  @Post("conversations/direct")
  @HttpCode(200)
  getOrCreateDirectConversation(
    @CurrentUser("userId") userId: string,
    @Body() dto: DirectConversationDto,
  ) {
    return this.messagesService.getOrCreateDirectConversation(userId, dto.receiverId);
  }

  // GET /api/v1/messages/conversations/:id
  @Get("conversations/:id")
  getConversationMessages(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
    @Query() query: ConversationMessagesQueryDto,
  ) {
    return this.messagesService.getConversationMessages(
      userId,
      conversationId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  // PATCH /api/v1/messages/conversations/:id/read
  @Patch("conversations/:id/read")
  @HttpCode(200)
  markAsRead(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.markAsRead(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/unread
  @Patch("conversations/:id/unread")
  @HttpCode(200)
  markAsUnread(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.markAsUnread(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/archive
  @Patch("conversations/:id/archive")
  @HttpCode(200)
  archiveConversation(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.archiveConversation(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/unarchive
  @Patch("conversations/:id/unarchive")
  @HttpCode(200)
  unarchiveConversation(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.unarchiveConversation(userId, conversationId);
  }

  // GET /api/v1/messages/unread-count
  @Get("unread-count")
  async getUnreadCount(@CurrentUser("userId") userId: string) {
    const count = await this.messagesService.getUnreadCount(userId);
    return { count };
  }

  // POST /api/v1/messages
  @Post()
  sendMessage(
    @CurrentUser("userId") userId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.sendMessage(userId, dto.receiverId, dto.text);
  }

  // POST /api/v1/messages/share/track
  @Post("share/track")
  shareTrack(
    @CurrentUser("userId") userId: string,
    @Body() dto: ShareTrackDto,
  ) {
    return this.messagesService.shareTrack(userId, dto.receiverId, dto.trackId, dto.text);
  }

  // POST /api/v1/messages/share/playlist
  @Post("share/playlist")
  sharePlaylist(
    @CurrentUser("userId") userId: string,
    @Body() dto: SharePlaylistDto,
  ) {
    return this.messagesService.sharePlaylist(userId, dto.receiverId, dto.playlistId, dto.text);
  }

  // DELETE /api/v1/messages/:id
  @Delete(":id")
  @HttpCode(200)
  deleteMessage(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.deleteMessage(userId, messageId);
  }
}
