import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const databasePassword = randomBytes(24).toString('hex');
const redisPassword = randomBytes(24).toString('hex');
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template
  .replace(/^POSTGRES_PASSWORD=$/m, `POSTGRES_PASSWORD=${databasePassword}`)
  .replace(
    /^DATABASE_URL=$/m,
    `DATABASE_URL=postgresql://lucy_dev:${databasePassword}@127.0.0.1:5432/lucy_spa_dev`,
  )
  .replace(/^REDIS_PASSWORD=$/m, `REDIS_PASSWORD=${redisPassword}`)
  .replace(/^REDIS_URL=$/m, `REDIS_URL=redis://:${redisPassword}@127.0.0.1:6379/0`);
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with random local credentials. No credentials were printed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.error('.env already exists; leaving it unchanged.');
  process.exitCode = 1;
}
