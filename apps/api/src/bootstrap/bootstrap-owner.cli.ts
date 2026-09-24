import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '@lucy-spa/database';
import { IdentityValidationError, normalizeEmail, normalizePhone } from '../auth/identity.js';
import { PasswordPolicyError, PasswordService } from '../auth/password.service.js';
import { bootstrapOwner } from './owner-bootstrap.js';

// Protected operator channel (design section 8): identity via flags; the password only
// via a hidden TTY prompt or piped stdin, never a flag, environment variable, file or log.
const environmentPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

class UsageError extends Error {}

function readHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003' || character === '\u0004') {
          return finish(new UsageError('Cancelled.'));
        }
        if (character === '\u007f' || character === '\b') {
          value = [...value].slice(0, -1).join('');
        } else {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    const first = await readHidden('Owner password (input hidden): ');
    const second = await readHidden('Repeat Owner password: ');
    if (first !== second) throw new UsageError('Passwords do not match.');
    return first;
  }
  // Non-interactive: exactly the first stdin line, without its line terminator.
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    data += chunk as string;
    if (data.length > 4_096) throw new UsageError('Password input is too long.');
  }
  return data.split(/\r?\n/, 1)[0] ?? '';
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'full-name': { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      locale: { type: 'string', default: 'vi' },
    },
    strict: true,
    allowPositionals: false,
  });
  const fullName = values['full-name']?.normalize('NFC').trim() ?? '';
  if (!fullName || [...fullName].length > 200 || /\p{Cc}/u.test(fullName)) {
    throw new UsageError('--full-name is required (1-200 characters, no control characters).');
  }
  if (values.locale !== 'vi' && values.locale !== 'en') {
    throw new UsageError('--locale must be vi or en.');
  }
  let email: ReturnType<typeof normalizeEmail>;
  let phone: string | null = null;
  try {
    email = normalizeEmail(values.email ?? '');
    if (values.phone !== undefined) phone = normalizePhone(values.phone).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      throw new UsageError(`--${error.field} is missing or invalid.`);
    }
    throw error;
  }
  const password = await readPassword();
  let passwordHash: string;
  try {
    passwordHash = await new PasswordService().hashForSetting(password);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      throw new UsageError(
        'Password rejected by policy (15-128 characters, not a known common password).',
      );
    }
    throw error;
  }
  // The bootstrap connection must hold EXECUTE on lucy_owner_bootstrap_capability().
  const databaseUrl = process.env['OWNER_BOOTSTRAP_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new UsageError('OWNER_BOOTSTRAP_DATABASE_URL or DATABASE_URL is required.');
  }
  const client = createDatabaseClient(databaseUrl);
  try {
    const outcome = await client.$transaction(
      (tx) =>
        bootstrapOwner(tx, {
          fullName,
          emailCanonical: email.emailCanonical,
          emailDelivery: email.emailDelivery,
          phoneCanonical: phone,
          normalizationVersion: email.normalizationVersion,
          locale: values.locale as 'vi' | 'en',
          passwordHash,
          executionContext: `owner-bootstrap-cli:${userInfo().username}@${hostname()}`,
        }),
      { timeout: 30_000 },
    );
    if (outcome.status === 'CREATED') {
      process.stdout.write('Owner created. Sign in through the WORKFORCE realm by email.\n');
    } else if (outcome.status === 'ALREADY_INITIALIZED') {
      process.stdout.write('Owner already initialized; nothing was changed.\n');
    } else {
      process.stderr.write(
        'Another account already uses that email or phone; nothing was changed.\n',
      );
      process.exitCode = 1;
    }
  } finally {
    await client.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  // Never print passwords, hashes, connection URLs or driver details.
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  const message = String(
    typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : '',
  );
  process.stderr.write(
    error instanceof UsageError
      ? `${error.message}\n`
      : typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')
        ? 'Unknown or invalid option. Use --full-name, --email, optional --phone and --locale; passwords are never accepted as options.\n'
        : code === '42501' || message.includes('42501')
          ? 'The database role lacks the Owner bootstrap privilege; nothing was changed.\n'
          : 'Owner bootstrap failed. Check environment configuration and database readiness.\n',
  );
  process.exitCode = 1;
}
