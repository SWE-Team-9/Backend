import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // If DATABASE_URL is not provided (e.g. unit tests or CI without DB),
    // avoid constructing a URL or creating the PG adapter which would throw.
    // In those environments we'll fall back to the default Prisma client
    // constructor and skip connecting in onModuleInit.
    const rawUrl = process.env.DATABASE_URL ?? "";
    if (!rawUrl) {
      super();
      return;
    }

    // Strip sslmode from the connection string so the explicit ssl option takes precedence.
    // The pg library now treats sslmode=require as verify-full, which breaks self-signed certs.
    const url = new URL(rawUrl);
    url.searchParams.delete("sslmode");
    const connectionString = url.toString();
    const adapter = new PrismaPg({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    super({ adapter });
  }
  async onModuleInit() {
    // Only connect when a DATABASE_URL is configured. This avoids attempts to
    // open a DB connection during unit tests or CI runs that don't provide one.
    if (process.env.DATABASE_URL) {
      await this.$connect();
    }
  }
}
