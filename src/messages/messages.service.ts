import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MessageType, TrackVisibility, PlaylistVisibility } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Injected lazily to avoid circular dependency
// MessagesGateway is set via setGateway() from MessagesModule
export interface IMessagesGateway {
  emitNewMessage(conversationId: string, recipientId: string, payload: unknown): void;
  emitMessageDeleted(conversationId: string, messageId: string): void;
  emitConversationRead(conversationId: string, userId: string): void;
  emitUnreadCountUpdated(userId: string, count: number): void;
  emitConversationUpdated(userId: string, conversationId: string): void;
}

@Injectable()
export class MessagesService {
  private gateway?: IMessagesGateway;

  constructor(private readonly prisma: PrismaService) {}

  setGateway(gateway: IMessagesGateway): void {
    this.gateway = gateway;
  }

  // ─── Block check ────────────────────────────────────────────────────────────

  private async checkBlock(userAId: string, userBId: string): Promise<void> {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userAId, blockedId: userBId },
          { blockerId: userBId, blockedId: userAId },
        ],
      },
      select: { blockerId: true },
    });
    if (block) {
      throw new ForbiddenException({
        code: "MESSAGING_BLOCKED",
        message: "Messaging is blocked between these users.",
      });
    }
  }

  private async getBlockFlags(
    userId: string,
    otherUserId: string,
  ): Promise<{ isBlockedByMe: boolean; hasBlockedMe: boolean; canMessage: boolean; blockReason: string | null }> {
    const [blockedByMe, blockedMe] = await Promise.all([
      this.prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: otherUserId } },
        select: { blockerId: true },
      }),
      this.prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId: otherUserId, blockedId: userId } },
        select: { blockerId: true },
      }),
    ]);
    const isBlockedByMe = Boolean(blockedByMe);
    const hasBlockedMe = Boolean(blockedMe);
    return {
      isBlockedByMe,
      hasBlockedMe,
      canMessage: !isBlockedByMe && !hasBlockedMe,
      blockReason: isBlockedByMe ? "You have blocked this user" : hasBlockedMe ? "This user has blocked you" : null,
    };
  }

  // ─── Find or create direct conversation ─────────────────────────────────────

  private async findOrCreateConversation(
    userAId: string,
    userBId: string,
  ): Promise<string> {
    // Find existing DIRECT conversation with exactly these two participants
    const existing = await this.prisma.conversation.findFirst({
      where: {
        kind: "DIRECT",
        participants: {
          every: { userId: { in: [userAId, userBId] } },
        },
        AND: [
          { participants: { some: { userId: userAId } } },
          { participants: { some: { userId: userBId } } },
        ],
      },
      select: { id: true },
    });

    if (existing) return existing.id;

    const created = await this.prisma.conversation.create({
      data: {
        kind: "DIRECT",
        participants: {
          create: [
            { userId: userAId },
            { userId: userBId },
          ],
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  private async unarchiveForBoth(conversationId: string): Promise<void> {
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId },
      data: { isArchived: false },
    });
  }

  // ─── Helpers: map message ────────────────────────────────────────────────────

  private mapMessage(
    msg: {
      id: string;
      senderId: string;
      messageType: MessageType;
      body: string | null;
      createdAt: Date;
      deletedAt: Date | null;
      editedAt: Date | null;
      share: {
        track: {
          id: string;
          title: string;
          uploaderId: string;
          slug: string;
          coverArtUrl: string | null;
          durationMs: number | null;
          waveformData: number[];
          _count: { likes: number; reposts: number; comments: number; playEvents: number };
          uploader: { id: string; profile: { displayName: string; handle: string; avatarUrl: string | null } | null };
        } | null;
        playlist: {
          id: string;
          title: string;
          slug: string;
          coverArtUrl: string | null;
          ownerId: string;
          owner: { id: string; profile: { displayName: string; handle: string; avatarUrl: string | null } | null };
          _count: { tracks: number };
          tracks: {
            track: {
              id: string;
              title: string;
              slug: string;
              coverArtUrl: string | null;
              durationMs: number | null;
              _count: { playEvents: number };
              uploader: { id: string; profile: { displayName: string; handle: string } | null };
            };
          }[];
        } | null;
      } | null;
      conversation: { participants: { userId: string }[] };
    },
    viewerId: string,
  ) {
    if (msg.deletedAt) {
      return {
        id: msg.id,
        senderId: msg.senderId,
        receiverId: msg.conversation.participants.find((p) => p.userId !== msg.senderId)?.userId ?? null,
        type: msg.messageType,
        isDeleted: true,
        createdAt: msg.createdAt,
      };
    }
    const receiverId = msg.conversation.participants.find((p) => p.userId !== msg.senderId)?.userId ?? null;
    const base = {
      id: msg.id,
      senderId: msg.senderId,
      receiverId,
      type: msg.messageType,
      text: msg.body,
      isRead: false,
      isDeleted: false,
      createdAt: msg.createdAt,
    };

    if (msg.messageType === "TRACK_SHARE" && msg.share?.track) {
      const t = msg.share.track;
      return {
        ...base,
        sharedTrack: {
          id: t.id,
          title: t.title,
          slug: t.slug,
          artist: {
            id: t.uploader.id,
            display_name: t.uploader.profile?.displayName ?? null,
            handle: t.uploader.profile?.handle ?? null,
            avatar_url: t.uploader.profile?.avatarUrl ?? null,
          },
          coverArtUrl: t.coverArtUrl,
          durationSeconds: t.durationMs ? Math.round(t.durationMs / 1000) : null,
          waveformData: t.waveformData,
          playCount: t._count.playEvents,
          commentsCount: t._count.comments,
          likesCount: t._count.likes,
          repostsCount: t._count.reposts,
          createdAt: null,
        },
      };
    }

    if (msg.messageType === "PLAYLIST_SHARE" && msg.share?.playlist) {
      const pl = msg.share.playlist;
      return {
        ...base,
        sharedPlaylist: {
          id: pl.id,
          title: pl.title,
          slug: pl.slug,
          owner: {
            id: pl.owner.id,
            display_name: pl.owner.profile?.displayName ?? null,
            handle: pl.owner.profile?.handle ?? null,
            avatar_url: pl.owner.profile?.avatarUrl ?? null,
          },
          coverArtUrl: pl.coverArtUrl,
          tracksCount: pl._count.tracks,
          tracksPreview: pl.tracks.slice(0, 5).map((pt) => ({
            id: pt.track.id,
            title: pt.track.title,
            slug: pt.track.slug,
            artist: {
              id: pt.track.uploader.id,
              display_name: pt.track.uploader.profile?.displayName ?? null,
              handle: pt.track.uploader.profile?.handle ?? null,
            },
            coverArtUrl: pt.track.coverArtUrl,
            durationSeconds: pt.track.durationMs ? Math.round(pt.track.durationMs / 1000) : null,
            playCount: pt.track._count.playEvents,
          })),
        },
      };
    }

    return base;
  }

  private readonly MESSAGE_SELECT = {
    id: true,
    senderId: true,
    messageType: true,
    body: true,
    createdAt: true,
    deletedAt: true,
    editedAt: true,
    conversation: { select: { participants: { select: { userId: true } } } },
    share: {
      select: {
        track: {
          select: {
            id: true,
            title: true,
            slug: true,
            uploaderId: true,
            coverArtUrl: true,
            durationMs: true,
            waveformData: true,
            uploader: {
              select: {
                id: true,
                profile: { select: { displayName: true, handle: true, avatarUrl: true } },
              },
            },
            _count: { select: { likes: true, reposts: true, comments: true, playEvents: true } },
          },
        },
        playlist: {
          select: {
            id: true,
            title: true,
            slug: true,
            ownerId: true,
            coverArtUrl: true,
            owner: {
              select: {
                id: true,
                profile: { select: { displayName: true, handle: true, avatarUrl: true } },
              },
            },
            _count: { select: { tracks: true } },
            tracks: {
              take: 5,
              orderBy: { position: "asc" as const },
              select: {
                track: {
                  select: {
                    id: true,
                    title: true,
                    slug: true,
                    coverArtUrl: true,
                    durationMs: true,
                    _count: { select: { playEvents: true } },
                    uploader: {
                      select: {
                        id: true,
                        profile: { select: { displayName: true, handle: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  } as const;

  // ─── Get conversations ───────────────────────────────────────────────────────

  async getConversations(
    userId: string,
    archived: boolean,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;

    const [total, participants] = await Promise.all([
      this.prisma.conversationParticipant.count({
        where: { userId, isArchived: archived },
      }),
      this.prisma.conversationParticipant.findMany({
        where: { userId, isArchived: archived },
        orderBy: { conversation: { updatedAt: "desc" } },
        skip,
        take: limit,
        select: {
          conversationId: true,
          lastReadMessageId: true,
          lastReadAt: true,
          isArchived: true,
          conversation: {
            select: {
              id: true,
              updatedAt: true,
              participants: {
                where: { userId: { not: userId } },
                take: 1,
                select: {
                  userId: true,
                  user: {
                    select: {
                      id: true,
                      profile: { select: { displayName: true, handle: true, avatarUrl: true } },
                    },
                  },
                },
              },
              messages: {
                where: { deletedAt: null },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  messageType: true,
                  body: true,
                  createdAt: true,
                  senderId: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const conversations = await Promise.all(
      participants.map(async (p) => {
        const other = p.conversation.participants[0];
        const lastMsg = p.conversation.messages[0];

        // Unread count: messages after lastReadAt that weren't sent by me
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: p.conversationId,
            senderId: { not: userId },
            deletedAt: null,
            createdAt: p.lastReadAt ? { gt: p.lastReadAt } : undefined,
          },
        });

        const blockFlags = other
          ? await this.getBlockFlags(userId, other.userId)
          : { isBlockedByMe: false, hasBlockedMe: false, canMessage: true, blockReason: null };

        return {
          conversationId: p.conversationId,
          participant: other
            ? {
                id: other.user.id,
                display_name: other.user.profile?.displayName ?? null,
                handle: other.user.profile?.handle ?? null,
                avatar_url: other.user.profile?.avatarUrl ?? null,
              }
            : null,
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                type: lastMsg.messageType,
                text: lastMsg.body,
                createdAt: lastMsg.createdAt,
              }
            : null,
          unreadCount,
          updatedAt: p.conversation.updatedAt,
          isArchived: p.isArchived,
          ...blockFlags,
        };
      }),
    );

    return { page, limit, total, conversations };
  }

  // ─── Get conversation messages ───────────────────────────────────────────────

  async getConversationMessages(
    userId: string,
    conversationId: string,
    page: number,
    limit: number,
  ) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true, lastReadAt: true },
    });

    if (!participant) {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation not found or you are not a participant.",
      });
    }

    // Other participant
    const other = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: { not: userId } },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            profile: { select: { displayName: true, handle: true, avatarUrl: true } },
          },
        },
      },
    });

    const blockFlags = other ? await this.getBlockFlags(userId, other.userId) : null;

    const skip = (page - 1) * limit;
    const [total, messages] = await Promise.all([
      this.prisma.message.count({ where: { conversationId } }),
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: this.MESSAGE_SELECT,
      }),
    ]);

    return {
      conversationId,
      participant: other
        ? {
            id: other.user.id,
            display_name: other.user.profile?.displayName ?? null,
            handle: other.user.profile?.handle ?? null,
            avatar_url: other.user.profile?.avatarUrl ?? null,
          }
        : null,
      page,
      limit,
      total,
      hasMore: skip + messages.length < total,
      messages: messages.map((m) => this.mapMessage(m as Parameters<typeof this.mapMessage>[0], userId)),
      ...(blockFlags ?? {}),
    };
  }

  // ─── Send message ────────────────────────────────────────────────────────────

  async sendMessage(senderId: string, receiverId: string, text: string) {
    await this.checkBlock(senderId, receiverId);

    const conversationId = await this.findOrCreateConversation(senderId, receiverId);
    await this.unarchiveForBoth(conversationId);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        messageType: "TEXT",
        body: text,
      },
      select: this.MESSAGE_SELECT,
    });

    const unreadCount = await this.getUnreadCount(senderId);
    const mappedMsg = this.mapMessage(message as Parameters<typeof this.mapMessage>[0], senderId);

    this.gateway?.emitNewMessage(conversationId, receiverId, {
      type: "NEW_MESSAGE",
      conversationId,
      message: mappedMsg,
      currentUnreadCount: unreadCount,
    });

    return {
      message: mappedMsg,
      conversationId,
      currentUnreadCount: unreadCount,
    };
  }

  // ─── Share track ─────────────────────────────────────────────────────────────

  async shareTrack(
    senderId: string,
    receiverId: string,
    trackId: string,
    text?: string,
  ) {
    await this.checkBlock(senderId, receiverId);

    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: { id: true, uploaderId: true, visibility: true },
    });

    if (!track) {
      throw new NotFoundException({ code: "TRACK_NOT_FOUND", message: "Track not found." });
    }

    if (track.visibility === TrackVisibility.PRIVATE && track.uploaderId !== senderId) {
      throw new ForbiddenException({
        code: "TRACK_NOT_ACCESSIBLE",
        message: "You cannot share a private track that you do not own.",
      });
    }

    const conversationId = await this.findOrCreateConversation(senderId, receiverId);
    await this.unarchiveForBoth(conversationId);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        messageType: "TRACK_SHARE",
        body: text ?? null,
        share: { create: { trackId } },
      },
      select: this.MESSAGE_SELECT,
    });

    const unreadCount = await this.getUnreadCount(senderId);
    const mappedMsg = this.mapMessage(message as Parameters<typeof this.mapMessage>[0], senderId);

    this.gateway?.emitNewMessage(conversationId, receiverId, {
      type: "NEW_MESSAGE",
      conversationId,
      message: mappedMsg,
      currentUnreadCount: unreadCount,
    });

    return { message: mappedMsg, conversationId, currentUnreadCount: unreadCount };
  }

  // ─── Share playlist ──────────────────────────────────────────────────────────

  async sharePlaylist(
    senderId: string,
    receiverId: string,
    playlistId: string,
    text?: string,
  ) {
    await this.checkBlock(senderId, receiverId);

    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
      select: { id: true, ownerId: true, visibility: true },
    });

    if (!playlist) {
      throw new NotFoundException({ code: "PLAYLIST_NOT_FOUND", message: "Playlist not found." });
    }

    if (playlist.visibility === PlaylistVisibility.SECRET && playlist.ownerId !== senderId) {
      throw new ForbiddenException({
        code: "PLAYLIST_NOT_ACCESSIBLE",
        message: "You cannot share a private playlist that you do not own.",
      });
    }

    const conversationId = await this.findOrCreateConversation(senderId, receiverId);
    await this.unarchiveForBoth(conversationId);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        messageType: "PLAYLIST_SHARE",
        body: text ?? null,
        share: { create: { playlistId } },
      },
      select: this.MESSAGE_SELECT,
    });

    const unreadCount = await this.getUnreadCount(senderId);
    const mappedMsg = this.mapMessage(message as Parameters<typeof this.mapMessage>[0], senderId);

    this.gateway?.emitNewMessage(conversationId, receiverId, {
      type: "NEW_MESSAGE",
      conversationId,
      message: mappedMsg,
      currentUnreadCount: unreadCount,
    });

    return { message: mappedMsg, conversationId, currentUnreadCount: unreadCount };
  }

  // ─── Unread count ────────────────────────────────────────────────────────────

  async getUnreadCount(userId: string): Promise<number> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true, lastReadAt: true },
    });

    let total = 0;
    for (const p of participants) {
      const count = await this.prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          deletedAt: null,
          ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
        },
      });
      total += count;
    }
    return total;
  }

  // ─── Mark as read ────────────────────────────────────────────────────────────

  async markAsRead(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });

    if (!participant) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }

    const lastMessage = await this.prisma.message.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: {
        lastReadMessageId: lastMessage?.id ?? null,
        lastReadAt: lastMessage?.createdAt ?? new Date(),
      },
    });

    const unreadCount = await this.getUnreadCount(userId);
    this.gateway?.emitConversationRead(conversationId, userId);
    this.gateway?.emitUnreadCountUpdated(userId, unreadCount);

    return { message: "Conversation marked as read" };
  }

  // ─── Mark as unread ──────────────────────────────────────────────────────────

  async markAsUnread(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true, lastReadAt: true },
    });

    if (!participant) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }

    // Idempotent: if already unread (no lastReadAt), do nothing
    if (!participant.lastReadAt) {
      const unreadCount = await this.getUnreadCount(userId);
      return { message: "Conversation marked as unread", unreadCount };
    }

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadMessageId: null, lastReadAt: null },
    });

    const unreadCount = await this.getUnreadCount(userId);
    this.gateway?.emitUnreadCountUpdated(userId, unreadCount);

    return { message: "Conversation marked as unread", unreadCount };
  }

  // ─── Archive / Unarchive ─────────────────────────────────────────────────────

  async archiveConversation(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });

    if (!participant) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isArchived: true },
    });

    this.gateway?.emitConversationUpdated(userId, conversationId);
    return { message: "Conversation archived successfully" };
  }

  async unarchiveConversation(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });

    if (!participant) {
      throw new NotFoundException({ code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." });
    }

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { isArchived: false },
    });

    this.gateway?.emitConversationUpdated(userId, conversationId);
    return { message: "Conversation unarchived successfully" };
  }

  // ─── Delete message ──────────────────────────────────────────────────────────

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, conversationId: true, deletedAt: true },
    });

    if (!message) {
      throw new NotFoundException({ code: "MESSAGE_NOT_FOUND", message: "Message not found." });
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException({
        code: "MESSAGE_DELETE_FORBIDDEN",
        message: "You can only delete your own messages.",
      });
    }

    if (!message.deletedAt) {
      await this.prisma.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
      });
    }

    this.gateway?.emitMessageDeleted(message.conversationId, messageId);
    return { message: "Message deleted successfully" };
  }

  // ─── Get or create direct conversation ──────────────────────────────────────

  async getOrCreateDirectConversation(userId: string, receiverId: string) {
    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, deletedAt: true, profile: { select: { displayName: true, handle: true, avatarUrl: true } } },
    });

    if (!receiver || receiver.deletedAt) {
      throw new NotFoundException({ code: "RECEIVER_NOT_FOUND", message: "Receiver not found." });
    }

    const conversationId = await this.findOrCreateConversation(userId, receiverId);

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true, isArchived: true },
    });

    const blockFlags = await this.getBlockFlags(userId, receiverId);

    const lastMessage = await this.prisma.message.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, messageType: true, body: true, createdAt: true },
    });

    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        deletedAt: null,
        ...(participant?.lastReadAt ? { createdAt: { gt: participant.lastReadAt } } : {}),
      },
    });

    return {
      conversationId,
      participant: {
        id: receiver.id,
        display_name: receiver.profile?.displayName ?? null,
        handle: receiver.profile?.handle ?? null,
        avatar_url: receiver.profile?.avatarUrl ?? null,
      },
      lastMessage: lastMessage
        ? { id: lastMessage.id, type: lastMessage.messageType, text: lastMessage.body, createdAt: lastMessage.createdAt }
        : null,
      unreadCount,
      ...blockFlags,
    };
  }
}
