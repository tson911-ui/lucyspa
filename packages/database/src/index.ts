import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type { Prisma, Branch, OutboxEvent } from './generated/prisma/client.js';
export { appendOutboxEvent, type AppendOutboxEventInput } from './outbox.js';

export type DatabaseClient = PrismaClient;

/** Create one client per backend process; close it with $disconnect on shutdown. */
export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }

  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    application_name: 'lucy-spa',
  });

  return new PrismaClient({
    adapter,
    errorFormat: 'minimal',
    // Query parameters and connection errors must not be printed automatically.
    log: [],
    transactionOptions: { maxWait: 5_000, timeout: 10_000 },
  });
}
