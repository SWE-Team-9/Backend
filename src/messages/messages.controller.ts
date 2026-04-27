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
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { MessagesService } from "./messages.service";
import { SendMessageDto } from "./dto/send-message.dto";
import { ShareTrackDto } from "./dto/share-track.dto";
import { SharePlaylistDto } from "./dto/share-playlist.dto";
import { ConversationQueryDto } from "./dto/conversation-query.dto";
import { ConversationMessagesQueryDto } from "./dto/conversation-messages-query.dto";
import { DirectConversationDto } from "./dto/direct-conversation.dto";

@ApiTags("Messages")
@ApiCookieAuth("access_token")
@Controller("messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // GET /api/v1/messages/conversations
  @ApiOperation({
    summary: "List conversations",
    description:
      "Returns a paginated list of the user's conversations. Use `archived=true` to fetch archived conversations.",
  })
  @ApiResponse({ status: 200, description: "Paginated conversations list." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
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
  @ApiOperation({
    summary: "Get or create direct conversation",
    description:
      "Finds an existing direct conversation with another user, or creates one if it doesn't exist.",
  })
  @ApiResponse({
    status: 200,
    description: "Conversation returned or created.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Receiver user not found." })
  @Post("conversations/direct")
  @HttpCode(200)
  getOrCreateDirectConversation(
    @CurrentUser("userId") userId: string,
    @Body() dto: DirectConversationDto,
  ) {
    return this.messagesService.getOrCreateDirectConversation(
      userId,
      dto.receiverId,
    );
  }

  // GET /api/v1/messages/conversations/:id
  @ApiOperation({
    summary: "Get conversation messages",
    description:
      "Returns a paginated list of messages within a specific conversation.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Conversation UUID.",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated messages in conversation.",
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "User is not a participant in this conversation.",
  })
  @ApiResponse({ status: 404, description: "Conversation not found." })
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
  @ApiOperation({
    summary: "Mark conversation as read",
    description:
      "Marks all messages in a conversation as read for the authenticated user.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Conversation UUID.",
  })
  @ApiResponse({ status: 200, description: "Conversation marked as read." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Conversation not found." })
  @Patch("conversations/:id/read")
  @HttpCode(200)
  markAsRead(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.markAsRead(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/unread
  @ApiOperation({
    summary: "Mark conversation as unread",
    description: "Marks a conversation as unread for the authenticated user.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Conversation UUID.",
  })
  @ApiResponse({ status: 200, description: "Conversation marked as unread." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Conversation not found." })
  @Patch("conversations/:id/unread")
  @HttpCode(200)
  markAsUnread(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.markAsUnread(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/archive
  @ApiOperation({
    summary: "Archive conversation",
    description:
      "Archives a conversation so it no longer appears in the default conversation list.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Conversation UUID.",
  })
  @ApiResponse({ status: 200, description: "Conversation archived." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Conversation not found." })
  @Patch("conversations/:id/archive")
  @HttpCode(200)
  archiveConversation(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.archiveConversation(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/unarchive
  @ApiOperation({
    summary: "Unarchive conversation",
    description:
      "Restores an archived conversation back to the active conversation list.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Conversation UUID.",
  })
  @ApiResponse({ status: 200, description: "Conversation unarchived." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Conversation not found." })
  @Patch("conversations/:id/unarchive")
  @HttpCode(200)
  unarchiveConversation(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.unarchiveConversation(userId, conversationId);
  }

  // GET /api/v1/messages/unread-count
  @ApiOperation({
    summary: "Get unread message count",
    description:
      "Returns the total number of unread messages across all conversations.",
  })
  @ApiResponse({
    status: 200,
    description: "Unread count.",
    schema: { example: { count: 4 } },
  })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @Get("unread-count")
  async getUnreadCount(@CurrentUser("userId") userId: string) {
    const count = await this.messagesService.getUnreadCount(userId);
    return { count };
  }

  // POST /api/v1/messages
  @ApiOperation({
    summary: "Send a message",
    description: "Sends a direct text message to another user.",
  })
  @ApiResponse({ status: 201, description: "Message sent." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Receiver not found." })
  @Post()
  sendMessage(
    @CurrentUser("userId") userId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.sendMessage(userId, dto.receiverId, dto.text);
  }

  // POST /api/v1/messages/share/track
  @ApiOperation({
    summary: "Share a track via message",
    description:
      "Sends a track share as a message to another user, with an optional text caption.",
  })
  @ApiResponse({ status: 201, description: "Track share message sent." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Receiver or track not found." })
  @Post("share/track")
  shareTrack(
    @CurrentUser("userId") userId: string,
    @Body() dto: ShareTrackDto,
  ) {
    return this.messagesService.shareTrack(
      userId,
      dto.receiverId,
      dto.trackId,
      dto.text,
    );
  }

  // POST /api/v1/messages/share/playlist
  @ApiOperation({
    summary: "Share a playlist via message",
    description:
      "Sends a playlist share as a message to another user, with an optional text caption.",
  })
  @ApiResponse({ status: 201, description: "Playlist share message sent." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({ status: 404, description: "Receiver or playlist not found." })
  @Post("share/playlist")
  sharePlaylist(
    @CurrentUser("userId") userId: string,
    @Body() dto: SharePlaylistDto,
  ) {
    return this.messagesService.sharePlaylist(
      userId,
      dto.receiverId,
      dto.playlistId,
      dto.text,
    );
  }

  // DELETE /api/v1/messages/:id
  @ApiOperation({
    summary: "Delete a message",
    description: "Deletes a message sent by the authenticated user.",
  })
  @ApiParam({
    name: "id",
    type: "string",
    format: "uuid",
    description: "Message UUID.",
  })
  @ApiResponse({ status: 200, description: "Message deleted." })
  @ApiResponse({ status: 401, description: "Not authenticated." })
  @ApiResponse({
    status: 403,
    description: "Cannot delete another user's message.",
  })
  @ApiResponse({ status: 404, description: "Message not found." })
  @Delete(":id")
  @HttpCode(200)
  deleteMessage(
    @CurrentUser("userId") userId: string,
    @Param("id", ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.deleteMessage(userId, messageId);
  }
}
