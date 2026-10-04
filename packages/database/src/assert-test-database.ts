import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Safety guard for every integration test entry point (Owner rule, 2026-10-05): integration tests write real rows (most of them
 * inside a rolled-back transaction, some committed), so they refuse to run unless the DATABASE_URL names a scratch or test
 * database on this machine. They must never touch the development or a production database.
 *
 * Allowed: a database whose name contains `scratch`, `validation`, `uxaudit`, `authtest` or `test`. One more case: the CI job runs
 * against the throw-away container database `lucy_spa_dev` that `docker compose up` creates for that job only; it is accepted only
 * when `CI=true` (set by the CI workflow), so on a developer machine `lucy_spa_dev` stays refused.
 *
 * Used as a preload (`node --import ./dist/assert-test-database.js --test ...`) or imported first by an entry script.
 */

const SAFE_NAME = /(scratch|validation|uxaudit|authtest|test)/i;
const CI_CONTAINER_DATABASE = 'lucy_spa_dev';

export interface TestDatabaseVerdict {
  allowed: boolean;
  name: string;
  reason: string;
}

export function judgeTestDatabase(
  databaseUrl: string | undefined,
  ci: boolean,
): TestDatabaseVerdict {
  if (!databaseUrl) return { allowed: false, name: '', reason: 'DATABASE_URL is not set' };
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { allowed: false, name: '', reason: 'DATABASE_URL is not a valid URL' };
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    return { allowed: false, name, reason: 'the database is not on this machine' };
  }
  if (SAFE_NAME.test(name)) return { allowed: true, name, reason: 'scratch or test database' };
  if (ci && name === CI_CONTAINER_DATABASE) {
    return { allowed: true, name, reason: 'the CI job container database' };
  }
  return { allowed: false, name, reason: 'not a scratch or test database name' };
}

export function assertTestDatabase(): TestDatabaseVerdict {
  const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(environmentPath)) {
    try {
      loadEnvFile(environmentPath);
    } catch {
      // an unreadable .env is judged by what the process environment already holds
    }
  }
  const verdict = judgeTestDatabase(process.env['DATABASE_URL'], process.env['CI'] === 'true');
  if (!verdict.allowed) {
    throw new Error(
      `Integration tests refuse to run: ${verdict.reason}${verdict.name ? ` ("${verdict.name}")` : ''}. ` +
        'Point DATABASE_URL at a scratch database (its name must contain scratch, validation, uxaudit, authtest or test).',
    );
  }
  return verdict;
}

assertTestDatabase();
