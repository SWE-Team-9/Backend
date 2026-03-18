import { Injectable, OnModuleInit } from "@nestjs/common";


const { PrismaClient } = require("@prisma/client");

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
