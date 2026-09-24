import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './index.js';
import { PermissionCatalogMismatchError, syncPermissionCatalog } from './permission-catalog.js';

// Explicit operator command; the API never mutates the catalog on startup.
const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const client = createDatabaseClient(databaseUrl);
  try {
    const result = await client.$transaction((tx) => syncPermissionCatalog(tx));
    process.stdout.write(
      `Permission catalog synced: ${result.inserted} inserted, ${result.unchanged} already present.\n`,
    );
  } finally {
    await client.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  // Do not expose URLs, credentials, or database query values through CLI errors.
  process.stderr.write(
    error instanceof PermissionCatalogMismatchError
      ? `${error.message}. No rows were changed; review the catalog before retrying.\n`
      : 'Permission catalog sync failed. Check environment configuration and database readiness.\n',
  );
  process.exitCode = 1;
}
