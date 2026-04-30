import { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { Server, ServerOptions } from "socket.io";

/**
 * Shared Socket.IO adapter.
 *
 * NestJS's default IoAdapter calls `new Server(httpServer, options)` once per
 * @WebSocketGateway, so three gateways = three separate socket.io servers all
 * attached to the same underlying HTTP server.  Multiple servers fighting over
 * the same `upgrade` events means only the first one bound works; the others
 * silently reject every connection.
 *
 * This adapter creates ONE socket.io Server the first time any gateway asks for
 * it and returns the cached instance for every subsequent call.  Each gateway
 * gets its own namespace (via `server.of(namespace)`) on the same server so
 * routing works correctly.
 */
export class SocketIoAdapter extends IoAdapter {
  private sharedServer: Server | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    if (this.sharedServer) {
      return this.sharedServer;
    }

    this.sharedServer = super.createIOServer(port, {
      ...options,
      cors: {
        origin: true, // mirrors the request Origin back (supports all dev origins)
        credentials: true,
      },
    }) as Server;

    return this.sharedServer;
  }
}
