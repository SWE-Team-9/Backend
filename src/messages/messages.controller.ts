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
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ShareTrackDto } from './dto/share-track.dto';
import { SharePlaylistDto } from './dto/share-playlist.dto';
import { ConversationQueryDto } from './dto/conversation-query.dto';
import { ConversationMessagesQueryDto } from './dto/conversation-messages-query.dto';
import { DirectConversationDto } from './dto/direct-conversation.dto';

@ApiTags('Messages')
@ApiCookieAuth('access_token')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // GET /api/v1/messages/conversations
  @ApiOperation({
    summary: 'List conversations',
    description:
      "Returns a paginated list of the user's conversations. Use `archived=true` to fetch archived conversations.",
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'archived', required: false, type: Boolean, example: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated conversations list.',
    schema: {
      example: {
        page: 1,
        limit: 20,
        total: 3,
        conversations: [
          {
            conversationId: 'conv-uuid-1',
            isArchived: false,
            unreadCount: 2,
            lastMessage: {
              id: 'msg-uuid-1',
              type: 'TEXT',
              text: 'Hey, loved your track!',
              createdAt: '2026-04-30T18:00:00.000Z',
            },
            participant: {
              id: 'usr_456',
              display_name: 'Amr Diab',
              handle: 'amrdiab',
              avatar_url: 'https://cdn.iqa3.tech/avatars/amrdiab.jpg',
            },
            updatedAt: '2026-04-30T18:00:00.000Z',
            isBlockedByMe: false,
            hasBlockedMe: false,
            canMessage: true,
            blockReason: null,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Get('conversations')
  getConversations(@CurrentUser('userId') userId: string, @Query() query: ConversationQueryDto) {
    return this.messagesService.getConversations(
      userId,
      query.archived ?? false,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  // POST /api/v1/messages/conversations/direct
  @ApiOperation({
    summary: 'Get or create direct conversation',
    description:
      "Finds an existing direct conversation with another user, or creates one if it doesn't exist.",
  })
  @ApiBody({ type: DirectConversationDto })
  @ApiResponse({
    status: 200,
    description: 'Conversation returned or created.',
    schema: {
      example: {
        conversationId: 'conv-uuid-1',
        participant: { id: 'usr_456', display_name: 'Amr Diab', handle: 'amrdiab', avatar_url: null },
        lastMessage: null,
        unreadCount: 0,
        updatedAt: '2026-04-30T18:00:00.000Z',
        isArchived: false,
        isBlockedByMe: false,
        hasBlockedMe: false,
        canMessage: true,
        blockReason: null,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Receiver user not found.' })
  @Post('conversations/direct')
  @HttpCode(200)
  getOrCreateDirectConversation(
    @CurrentUser('userId') userId: string,
    @Body() dto: DirectConversationDto,
  ) {
    return this.messagesService.getOrCreateDirectConversation(userId, dto.receiverId);
  }

  // GET /api/v1/messages/conversations/:id
  @ApiOperation({
    summary: 'Get conversation messages',
    description: 'Returns a paginated list of messages within a specific conversation.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Conversation UUID.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Paginated messages in conversation.',
    schema: {
      example: {
        conversationId: 'conv-uuid-1',
        participant: {
          id: 'usr_456',
          display_name: 'Amr Diab',
          handle: 'amrdiab',
          avatar_url: null,
        },
        page: 1,
        limit: 20,
        total: 12,
        hasMore: false,
        isBlockedByMe: false,
        hasBlockedMe: false,
        canMessage: true,
        blockReason: null,
        messages: [
          {
            id: 'msg-uuid-1',
            senderId: 'usr_123',
            receiverId: 'usr_456',
            type: 'TEXT',
            text: 'Hey, loved your track!',
            isRead: false,
            isDeleted: false,
            createdAt: '2026-04-30T18:00:00.000Z',
          },
          {
            id: 'msg-uuid-2',
            senderId: 'usr_456',
            receiverId: 'usr_123',
            type: 'TRACK_SHARE',
            text: 'Check this track out!',
            isRead: false,
            isDeleted: false,
            createdAt: '2026-04-30T17:30:00.000Z',
            sharedTrack: {
              id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              title: 'Ya Ana',
              slug: 'ya-ana',
              artist: { id: 'usr_456', display_name: 'Amr Diab', handle: 'amrdiab', avatar_url: null },
              coverArtUrl: 'https://cdn.iqa3.tech/covers/ya-ana.jpg',
              durationSeconds: 210,
              waveformData: [],
              playCount: 0,
              likesCount: 0,
              repostsCount: 0,
              commentsCount: 0,
              liked: false,
              reposted: false,
              createdAt: '2026-04-01T00:00:00.000Z',
            },
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Conversation not found or not a participant.' })
  @Get('conversations/:id')
  getConversationMessages(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
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
    summary: 'Mark conversation as read',
    description: 'Marks all messages in a conversation as read for the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Conversation UUID.',
  })
  @ApiResponse({ status: 200, description: 'Conversation marked as read.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Conversation not found.' })
  @Patch('conversations/:id/read')
  @HttpCode(200)
  markAsRead(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.markAsRead(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/unread
  @ApiOperation({
    summary: 'Mark conversation as unread',
    description: 'Marks a conversation as unread for the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Conversation UUID.',
  })
  @ApiResponse({ status: 200, description: 'Conversation marked as unread.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Conversation not found.' })
  @Patch('conversations/:id/unread')
  @HttpCode(200)
  markAsUnread(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.markAsUnread(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/archive
  @ApiOperation({
    summary: 'Archive conversation',
    description:
      'Archives a conversation so it no longer appears in the default conversation list.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Conversation UUID.',
  })
  @ApiResponse({ status: 200, description: 'Conversation archived.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Conversation not found.' })
  @Patch('conversations/:id/archive')
  @HttpCode(200)
  archiveConversation(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.archiveConversation(userId, conversationId);
  }

  // PATCH /api/v1/messages/conversations/:id/unarchive
  @ApiOperation({
    summary: 'Unarchive conversation',
    description: 'Restores an archived conversation back to the active conversation list.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Conversation UUID.',
  })
  @ApiResponse({ status: 200, description: 'Conversation unarchived.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Conversation not found.' })
  @Patch('conversations/:id/unarchive')
  @HttpCode(200)
  unarchiveConversation(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    return this.messagesService.unarchiveConversation(userId, conversationId);
  }

  // GET /api/v1/messages/unread-count
  @ApiOperation({
    summary: 'Get unread message count',
    description: 'Returns the total number of unread messages across all conversations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread count.',
    schema: { example: { count: 4 } },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @Get('unread-count')
  async getUnreadCount(@CurrentUser('userId') userId: string) {
    const count = await this.messagesService.getUnreadCount(userId);
    return { count };
  }

  // POST /api/v1/messages
  @ApiOperation({
    summary: 'Send a message',
    description: 'Sends a direct text message to another user.',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiResponse({
    status: 201,
    description: 'Message sent.',
    schema: {
      example: {
        message: {
          id: 'msg-uuid-1',
          senderId: 'usr_123',
          receiverId: 'usr_456',
          type: 'TEXT',
          text: 'Hey, loved your track!',
          isRead: false,
          isDeleted: false,
          createdAt: '2026-04-30T18:00:00.000Z',
        },
        conversation: {
          conversationId: 'conv-uuid-1',
          participant: { id: 'usr_456', display_name: 'Amr Diab', handle: 'amrdiab', avatar_url: null },
          lastMessage: { id: 'msg-uuid-1', type: 'TEXT', text: 'Hey, loved your track!', createdAt: '2026-04-30T18:00:00.000Z' },
          unreadCount: 0,
          updatedAt: '2026-04-30T18:00:00.000Z',
          isArchived: false,
          isBlockedByMe: false,
          hasBlockedMe: false,
          canMessage: true,
          blockReason: null,
        },
        currentUnreadCount: 0,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Messaging is blocked between these users.' })
  @Post()
  sendMessage(@CurrentUser('userId') userId: string, @Body() dto: SendMessageDto) {
    return this.messagesService.sendMessage(userId, dto.receiverId, dto.text);
  }

  // POST /api/v1/messages/share/track
  @ApiOperation({
    summary: 'Share a track via message',
    description: 'Sends a track share as a message to another user, with an optional text caption.',
  })
  @ApiBody({ type: ShareTrackDto })
  @ApiResponse({
    status: 201,
    description: 'Track share message sent.',
    schema: {
      example: {
        message: {
          id: 'msg-uuid-3',
          senderId: 'usr_123',
          receiverId: 'usr_456',
          type: 'TRACK_SHARE',
          text: 'Check this out!',
          isRead: false,
          isDeleted: false,
          createdAt: '2026-04-30T18:05:00.000Z',
          sharedTrack: {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            title: 'Ya Ana',
            slug: 'ya-ana',
            artist: { id: 'usr_123', display_name: 'Yahia Dev', handle: 'yahia_dev', avatar_url: null },
            coverArtUrl: 'https://cdn.iqa3.tech/covers/ya-ana.jpg',
            durationSeconds: 210,
            waveformData: [],
            playCount: 0,
            likesCount: 0,
            repostsCount: 0,
            commentsCount: 0,
            liked: false,
            reposted: false,
            createdAt: '2026-04-01T00:00:00.000Z',
          },
        },
        conversation: {
          conversationId: 'conv-uuid-1',
          participant: { id: 'usr_456', display_name: 'Amr Diab', handle: 'amrdiab', avatar_url: null },
          lastMessage: { id: 'msg-uuid-3', type: 'TRACK_SHARE', text: 'Check this out!', createdAt: '2026-04-30T18:05:00.000Z' },
          unreadCount: 0,
          updatedAt: '2026-04-30T18:05:00.000Z',
          isArchived: false,
          isBlockedByMe: false,
          hasBlockedMe: false,
          canMessage: true,
          blockReason: null,
        },
        currentUnreadCount: 0,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Messaging is blocked or track is private and not owned by sender.' })
  @ApiResponse({ status: 404, description: 'Track not found.' })
  @Post('share/track')
  shareTrack(@CurrentUser('userId') userId: string, @Body() dto: ShareTrackDto) {
    return this.messagesService.shareTrack(userId, dto.receiverId, dto.trackId, dto.text);
  }

  // POST /api/v1/messages/share/playlist
  @ApiOperation({
    summary: 'Share a playlist via message',
    description:
      'Sends a playlist share as a message to another user, with an optional text caption.',
  })
  @ApiBody({ type: SharePlaylistDto })
  @ApiResponse({
    status: 201,
    description: 'Playlist share message sent.',
    schema: {
      example: {
        message: {
          id: 'msg-uuid-4',
          senderId: 'usr_123',
          receiverId: 'usr_456',
          type: 'PLAYLIST_SHARE',
          text: "You'll love this set!",
          isRead: false,
          isDeleted: false,
          createdAt: '2026-04-30T18:10:00.000Z',
          sharedPlaylist: {
            id: 'pl_101',
            title: 'Late Night Drive',
            slug: 'late-night-drive',
            owner: { id: 'usr_123', display_name: 'Yahia Dev', handle: 'yahia_dev', avatar_url: null },
            coverArtUrl: null,
            tracksCount: 12,
            tracksPreview: [],
          },
        },
        conversation: {
          conversationId: 'conv-uuid-1',
          participant: { id: 'usr_456', display_name: 'Amr Diab', handle: 'amrdiab', avatar_url: null },
          lastMessage: { id: 'msg-uuid-4', type: 'PLAYLIST_SHARE', text: "You'll love this set!", createdAt: '2026-04-30T18:10:00.000Z' },
          unreadCount: 0,
          updatedAt: '2026-04-30T18:10:00.000Z',
          isArchived: false,
          isBlockedByMe: false,
          hasBlockedMe: false,
          canMessage: true,
          blockReason: null,
        },
        currentUnreadCount: 0,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 403, description: 'Messaging is blocked or playlist is secret and not owned by sender.' })
  @ApiResponse({ status: 404, description: 'Playlist not found.' })
  @Post('share/playlist')
  sharePlaylist(@CurrentUser('userId') userId: string, @Body() dto: SharePlaylistDto) {
    return this.messagesService.sharePlaylist(userId, dto.receiverId, dto.playlistId, dto.text);
  }

  // DELETE /api/v1/messages/:id
  @ApiOperation({
    summary: 'Delete a message',
    description: 'Deletes a message sent by the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Message UUID.',
  })
  @ApiResponse({ status: 200, description: 'Message deleted.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({
    status: 403,
    description: "Cannot delete another user's message.",
  })
  @ApiResponse({ status: 404, description: 'Message not found.' })
  @Delete(':id')
  @HttpCode(200)
  deleteMessage(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) messageId: string,
  ) {
    return this.messagesService.deleteMessage(userId, messageId);
  }
}
