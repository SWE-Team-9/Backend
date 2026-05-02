import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { INotificationsGateway, NotificationsService } from "./notifications.service";

@WebSocketGateway({
  namespace: "api/v1/notifications",
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, INotificationsGateway
{
  @WebSocketServer()
  private readonly server!: Server;

  // userId -> Set of socketIds
  private readonly userSocketMap = new Map<string, Set<string>>();
  // socketId -> userId
  private readonly socketUserMap = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
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

      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId)!.add(socket.id);
      this.socketUserMap.set(socket.id, userId);
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

  // ─── Emit to all user's sockets (multi-device) ───────────────────────────────

  emitToUser(userId: string, event: string, payload: unknown): void {
    const sockets = this.userSocketMap.get(userId);
    if (!sockets) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit(event, payload);
    }
  }
}
