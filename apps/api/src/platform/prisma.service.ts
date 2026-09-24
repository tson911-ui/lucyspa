import { createDatabaseClient, type DatabaseClient } from '@lucy-spa/database';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { API_ENVIRONMENT, type ApiEnvironment } from './tokens.js';

/** One Prisma pool shared by health checks and all API domain services. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: DatabaseClient;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.client = createDatabaseClient(environment.databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
