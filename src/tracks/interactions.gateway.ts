import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server } from "socket.io";

type TrackInteractionEvent = {
  type: "LIKE" | "REPOST" | "COMMENT";
  userId: string;
  trackId: string;
  createdAt: string;
  commentId?: string;
  timestampAt?: number;
};

@WebSocketGateway()
export class InteractionsGateway {
  @WebSocketServer()
  private readonly server!: Server;

  emitTrackInteraction(trackId: string, payload: TrackInteractionEvent): void {
    this.server.to(`track_${trackId}`).emit("trackInteraction", payload);
  }
}
