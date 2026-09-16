import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

async function seed(): Promise<void> {
  const code = process.env['DEV_SEED_BRANCH_CODE']?.trim();
  const name = process.env['DEV_SEED_BRANCH_NAME']?.trim();
  if (!code && !name) {
    process.stdout.write('Seed skipped: no development branch requested.\n');
    return;
  }
  if (process.env['NODE_ENV'] !== 'development') {
    throw new Error('Development branch seeding requires NODE_ENV=development.');
  }
  if (!code || !name) {
    throw new Error('Set both DEV_SEED_BRANCH_CODE and DEV_SEED_BRANCH_NAME.');
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for development branch seeding.');
  }
  const client = createDatabaseClient(databaseUrl);
  try {
    // A repeated seed never changes an existing branch's identity/configuration.
    await client.branch.createMany({ data: [{ code, name }], skipDuplicates: true });
    process.stdout.write('Development branch seed completed. Existing branches were preserved.\n');
  } finally {
    await client.$disconnect();
  }
}

try {
  await seed();
} catch {
  // Do not expose URLs, credentials, or database query values through CLI errors.
  process.stderr.write(
    'Development seed failed. Check environment configuration and database readiness.\n',
  );
  process.exitCode = 1;
}
