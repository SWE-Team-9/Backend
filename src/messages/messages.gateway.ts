import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { IMessagesGateway, MessagesService } from "./messages.service";

@WebSocketGateway({
  namespace: "api/v1/messages",
})
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect, IMessagesGateway {
  @WebSocketServer()
  private readonly server!: Server;

  // userId -> Set of socketIds
  private readonly userSocketMap = new Map<string, Set<string>>();
  // socketId -> userId
  private readonly socketUserMap = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
  ) {}

  // ─── Connection ──────────────────────────────────────────────────────────────

  private extractToken(socket: Socket): string | null {
    // Cookie-based auth (browser / first-party frontend)
    const cookieHeader = socket.handshake.headers.cookie ?? '';
    const cookiePair = cookieHeader.split(';').find((c) => c.trim().startsWith('access_token='));
    if (cookiePair) {
      return decodeURIComponent(cookiePair.trim().slice('access_token='.length));
    }
    // Bearer token auth (cross-team / mobile — accepts both "Bearer <token>" and raw token)
    const authToken = socket.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken.replace(/^Bearer\s+/i, '');
    }
    return null;
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) throw new Error('No token');

      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>("security.jwtSecret"),
        issuer: this.config.get<string>("security.jwtIssuer") ?? "spotly-api",
        audience: this.config.get<string>("security.jwtAudience") ?? "spotly-client",
      });

      const userId: string = payload.sub;

      // Track socket ↔ user mapping
      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId)!.add(socket.id);
      this.socketUserMap.set(socket.id, userId);

      // Join rooms for all active conversations
      const participations = await this.prisma.conversationParticipant.findMany({
        where: { userId, isArchived: false },
        select: { conversationId: true },
      });
      for (const p of participations) {
        await socket.join(`conversation_${p.conversationId}`);
      }
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    const userId = this.socketUserMap.get(socket.id);
    if (userId) {
      const sockets = this.userSocketMap.get(userId);
      sockets?.delete(socket.id);
      if (!sockets?.size) {
        this.userSocketMap.delete(userId);
      }
      this.socketUserMap.delete(socket.id);
    }
  }

  // ─── Emitters ────────────────────────────────────────────────────────────────

  emitNewMessage(conversationId: string, recipientId: string, payload: unknown): void {
    this.server.to(`conversation_${conversationId}`).emit("new_message", payload);
  }

  emitMessageDeleted(conversationId: string, messageId: string): void {
    this.server
      .to(`conversation_${conversationId}`)
      .emit("message_deleted", { conversationId, messageId });
  }

  emitConversationRead(conversationId: string, userId: string): void {
    this.server
      .to(`conversation_${conversationId}`)
      .emit("conversation_read", { conversationId, userId });
  }

  emitUnreadCountUpdated(userId: string, count: number): void {
    const sockets = this.userSocketMap.get(userId);
    if (!sockets) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit("unread_count_updated", { unreadCount: count });
    }
  }

  emitConversationUpdated(userId: string, conversationId: string): void {
    const sockets = this.userSocketMap.get(userId);
    if (!sockets) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit("conversation_updated", { conversationId });
    }
  }
}
