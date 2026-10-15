import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '@lucy-spa/database';
import { authTransactionRunner } from '@lucy-spa/server';
import { UsageError } from '../bootstrap/operator-prompt.js';
import { parsePolicyFile, runPolicyImport } from './policy-pages.js';

// One-time import of the Owner's eight policy pages (docs/policies.md) as published information pages (redesign group 1).
// Default is a DRY RUN that writes nothing. Safe to run again: a page whose address exists is skipped and never changed.
//   --apply         create the missing pages (one transaction: all of them or none)
//   --file=PATH     another policies file (default: docs/policies.md of this checkout)
//   --as=EMAIL      the sign-in email of the user who owns the new pages (default: the only Owner user)
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const environmentPath = `${root}.env`;
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean' },
      file: { type: 'string' },
      as: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new UsageError('DATABASE_URL is required.');
  const file = values.file ?? `${root}docs/policies.md`;
  if (!existsSync(file)) throw new UsageError(`The policies file was not found: ${file}`);
  const pages = parsePolicyFile(readFileSync(file, 'utf8'));
  const apply = values.apply === true;
  const client = createDatabaseClient(databaseUrl);
  const line = (text: string) => process.stdout.write(`${text}\n`);
  try {
    // The database name only (never the address or credentials), so the run says where it looked.
    line(`database=${new URL(databaseUrl).pathname.slice(1)} mode=${apply ? 'apply' : 'dry-run'}`);
    const run = await authTransactionRunner(client).withTransaction((tx) =>
      runPolicyImport(tx, { apply, pages, actorEmail: values.as }),
    );
    if (run.status === 'NO_ACTOR') {
      process.stderr.write(`${run.reason} Nothing was changed.\n`);
      process.exitCode = 1;
      return;
    }
    for (const outcome of run.outcomes) {
      line(
        `${outcome.status.padEnd(12)} ${outcome.slug}${outcome.status === 'blocked' ? ` (${outcome.reason})` : ''}`,
      );
    }
    const count = (status: string) => run.outcomes.filter((o) => o.status === status).length;
    line(
      `created=${count('created')} wouldCreate=${count('would-create')} exists=${count('exists')} blocked=${count('blocked')}`,
    );
    if (count('blocked') > 0) process.exitCode = 2;
  } finally {
    await client.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  process.stderr.write(
    error instanceof UsageError
      ? `${error.message}\n`
      : typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')
        ? 'Unknown option. Use --apply, --file=PATH and/or --as=EMAIL.\n'
        : `Policy import failed; nothing was changed. ${error instanceof Error ? error.message : ''}\n`,
  );
  process.exitCode = 1;
}
