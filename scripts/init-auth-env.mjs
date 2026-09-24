import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Separate ignored file: never rewrite existing infrastructure credentials.
const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
const content = [
  '# Generated LOCAL authentication keys. Never use these in production.',
  'AUTH_ALLOW_INSECURE_LOCAL_COOKIE=true',
  `AUTH_CSRF_KEYS='${ring()}'`,
  'AUTH_CSRF_ACTIVE_VERSION=1',
  `AUTH_THROTTLE_KEYS='${ring()}'`,
  'AUTH_THROTTLE_ACTIVE_VERSION=1',
  '',
].join('\n');
try {
  await writeFile(new URL('../.env.auth.local', import.meta.url), content, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log('Created ignored .env.auth.local; no keys were printed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env.auth.local already exists; leaving it unchanged.');
}
