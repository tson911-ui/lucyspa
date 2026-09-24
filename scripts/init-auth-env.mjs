import { randomBytes } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';

// Separate ignored file: never rewrite existing infrastructure credentials.
const file = new URL('../.env.auth.local', import.meta.url);
const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
const pairs = {
  AUTH_CSRF: 'csrf',
  AUTH_THROTTLE: 'throttle',
  AUTH_OTP: 'OTP verifier',
  AUTH_DELIVERY: 'delivery encryption',
};
const lines = (prefix) => [`${prefix}_KEYS='${ring()}'`, `${prefix}_ACTIVE_VERSION=1`];
try {
  await writeFile(
    file,
    [
      '# Generated LOCAL authentication keys. Never use these in production.',
      'AUTH_ALLOW_INSECURE_LOCAL_COOKIE=true',
      ...Object.keys(pairs).flatMap(lines),
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created ignored .env.auth.local; no keys were printed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  // Existing keys are never replaced; only absent independent rings are appended.
  const existing = await readFile(file, 'utf8');
  const missing = Object.keys(pairs).filter(
    (prefix) =>
      !new RegExp(`^${prefix}_KEYS=`, 'm').test(existing) &&
      !new RegExp(`^${prefix}_ACTIVE_VERSION=`, 'm').test(existing),
  );
  if (missing.length === 0) {
    console.log('.env.auth.local already exists; leaving it unchanged.');
  } else {
    const prefix = existing.endsWith('\n') ? '' : '\n';
    await appendFile(file, `${prefix}${missing.flatMap(lines).join('\n')}\n`);
    console.log(
      `Added missing ${missing.map((key) => pairs[key]).join(', ')} keys to .env.auth.local; existing keys unchanged and nothing printed.`,
    );
  }
}
