import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly connectionString: string;

  constructor(@Optional() connectionStringOverride?: string) {
    const connectionString =
      connectionStringOverride ?? process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL não está definida.');
    }

    const adapter = new PrismaPg({ connectionString });

    super({ adapter });
    this.connectionString = connectionString;
  }

  getDatabaseUrl(): string {
    return this.connectionString;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
