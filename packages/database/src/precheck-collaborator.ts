import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { collaboratorPrecheck, type CollaboratorPrecheckFinding } from './collaborator-precheck.js';
import { createDatabaseClient } from './index.js';

// Read-only operator pre-check for the COLLABORATOR / manager-invariant deployment
// (employee management follow-up Step 2). It changes nothing. Run it before and after
// `pnpm db:deploy`; any finding must be resolved by the Owner (remove the manager role or
// promote the member; clear the base salary), never by a migration.
const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const client = createDatabaseClient(databaseUrl);
  try {
    const findings = await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return collaboratorPrecheck(tx);
    });
    const print = (title: string, rows: CollaboratorPrecheckFinding[]) => {
      process.stdout.write(`${title}: ${rows.length}\n`);
      for (const row of rows) {
        process.stdout.write(
          `  - ${row.employee_code} ${row.full_name} (${row.classification ?? 'no classification'}): ${row.detail}\n`,
        );
      }
    };
    print('Manager-group roles held by non-OFFICIAL_EMPLOYEE members', findings.managers);
    print('Base salaries on non-OFFICIAL_EMPLOYEE members', findings.salaries);
    if (findings.managers.length + findings.salaries.length > 0) {
      process.stdout.write('Pre-check FAILED: resolve these before relying on the invariant.\n');
      process.exitCode = 1;
    } else {
      process.stdout.write('Pre-check PASSED: no invalid manager roles or base salaries.\n');
    }
  } finally {
    await client.$disconnect();
  }
}

try {
  await main();
} catch {
  // Do not expose URLs, credentials, or database query values through CLI errors.
  process.stderr.write('Pre-check failed to run. Check DATABASE_URL and database readiness.\n');
  process.exitCode = 1;
}
