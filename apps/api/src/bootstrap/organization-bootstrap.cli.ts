import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabaseClient } from '@lucy-spa/database';
import { UsageError } from './operator-prompt.js';
import {
  runOrganizationBootstrap,
  type OrganizationBootstrapReport,
} from './organization-bootstrap.js';

// Legacy organization bootstrap (operator channel). Default is a DRY RUN that changes nothing.
//   --apply  create the derived appointments (one transaction, idempotent)
//   --check  exit 1 while appointments are still pending or manual review remains (deploy gate)
//   --json   machine-readable report
const environmentPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

function print(report: OrganizationBootstrapReport): void {
  const line = (text: string) => process.stdout.write(`${text}\n`);
  line(`Organization bootstrap ${report.mode} (business date ${report.businessDate})`);
  line(
    `Employees examined: ${report.employeesExamined}; without management authority: ${report.withoutManagementAuthority}`,
  );
  line(
    `\nAppointments ${report.mode === 'APPLY' ? 'created' : 'to create'}: ${report.appointments.length}`,
  );
  for (const entry of report.appointments) {
    line(
      `  ${entry.employeeCode}  ${entry.level}  branch ${entry.branchId}  because ${[...new Set(entry.causes.map((cause) => `${cause.permission}${cause.roleCode ? ` via role ${cause.roleCode}` : ' via ALLOW override'}`))].join(', ')}`,
    );
  }
  line(`\nRequires Owner decision (nothing is guessed): ${report.manualReview.length}`);
  for (const entry of report.manualReview)
    line(`  ${entry.employeeCode}  ${entry.reason}: ${entry.detail}`);
  line(`\nSkipped: ${report.skipped.length}`);
  for (const entry of report.skipped)
    line(
      `  ${entry.employeeCode}  ${entry.reason}${entry.branchId ? ` (branch ${entry.branchId})` : ''}: ${entry.detail}`,
    );
  line(`\nCreated rows: ${report.created}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean' }, check: { type: 'boolean' }, json: { type: 'boolean' } },
    strict: true,
    allowPositionals: false,
  });
  if (values.apply && values.check)
    throw new UsageError('Use either --apply or --check, not both.');
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new UsageError('DATABASE_URL is required.');
  const client = createDatabaseClient(databaseUrl);
  try {
    const outcome = await client.$transaction(
      (tx) =>
        runOrganizationBootstrap(tx, {
          apply: values.apply === true,
          executionContext: `organization-bootstrap-cli:${userInfo().username}@${hostname()}`,
        }),
      { timeout: 120_000 },
    );
    if (outcome.status === 'NO_OWNER') {
      process.stderr.write(
        'Exactly one Owner is required (use owner:bootstrap); nothing was changed.\n',
      );
      process.exitCode = 1;
      return;
    }
    if (values.json) process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
    else print(outcome.report);
    if (
      values.check &&
      (outcome.report.appointments.length > 0 || outcome.report.manualReview.length > 0)
    )
      process.exitCode = 1;
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
        ? 'Unknown option. Use --apply, --check and/or --json.\n'
        : 'Organization bootstrap failed; nothing was changed. Check environment configuration and database readiness.\n',
  );
  process.exitCode = 1;
}
