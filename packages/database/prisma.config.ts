import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const environmentPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/seed.js',
  },
  // Generation and validation do not require a database or a local secret file.
  // Migration commands fail if DATABASE_URL has not been explicitly configured.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
