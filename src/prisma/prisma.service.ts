import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // Strip sslmode from the connection string so the explicit ssl option takes precedence.
    // The pg library now treats sslmode=require as verify-full, which breaks self-signed certs.
    const rawUrl = process.env.DATABASE_URL ?? '';
    const url = new URL(rawUrl);
    url.searchParams.delete('sslmode');
    const connectionString = url.toString();
    const adapter = new PrismaPg({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    super({ adapter });
  }
  async onModuleInit() {
    await this.$connect();
  }
}
