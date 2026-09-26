import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '@lucy-spa/database';
import { IdentityValidationError, normalizeEmail } from '../auth/identity.js';
import { PasswordPolicyError, PasswordService } from '../auth/password.service.js';
import { readNewPassword, UsageError } from './operator-prompt.js';
import { resetOwnerPassword } from './owner-password-reset.js';

// Last-resort Owner recovery for someone with authorized server access (design section 8
// operator channel). The Owner is confirmed by --email; the password only via a hidden
// prompt (twice) or two stdin lines, never a flag, environment variable, file or log.
const environmentPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  let email: ReturnType<typeof normalizeEmail>;
  try {
    email = normalizeEmail(values.email ?? '');
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      throw new UsageError('--email (the current Owner email) is missing or invalid.');
    }
    throw error;
  }
  const password = await readNewPassword('New Owner', true);
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
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new UsageError('DATABASE_URL is required.');
  const client = createDatabaseClient(databaseUrl);
  try {
    const outcome = await client.$transaction(
      (tx) =>
        resetOwnerPassword(tx, {
          confirmEmailCanonical: email.emailCanonical,
          passwordHash,
          executionContext: `owner-reset-cli:${userInfo().username}@${hostname()}`,
        }),
      { timeout: 30_000 },
    );
    if (outcome.status === 'RESET') {
      process.stdout.write(
        `Owner password reset; ${outcome.revokedSessions} session(s) signed out. ` +
          'Sign in through the workforce login by email, then verify the recovery email.\n',
      );
    } else {
      process.stderr.write(
        outcome.status === 'NO_OWNER'
          ? 'No Owner exists; nothing was changed (use owner:bootstrap).\n'
          : outcome.status === 'AMBIGUOUS'
            ? 'More than one Owner found; nothing was changed.\n'
            : 'That email is not the Owner email; nothing was changed.\n',
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
  process.stderr.write(
    error instanceof UsageError
      ? `${error.message}\n`
      : typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')
        ? 'Unknown or invalid option. Use --email; passwords are never accepted as options.\n'
        : 'Owner password reset failed. Check environment configuration and database readiness.\n',
  );
  process.exitCode = 1;
}
