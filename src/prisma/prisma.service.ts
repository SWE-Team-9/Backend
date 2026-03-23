import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const dbUrl = new URL(process.env.DATABASE_URL!);
    dbUrl.searchParams.delete('sslmode');
    const adapter = new PrismaPg({
      connectionString: dbUrl.toString(),
      ssl: { rejectUnauthorized: false },
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
