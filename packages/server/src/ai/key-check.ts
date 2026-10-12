import { AiCallError, type ClaudeClient } from './claude-client.js';
import type { AiDatabase } from './spend.js';

/**
 * Claude integration Wave A (CI-X3): the worker side of "Kiểm tra kết nối". The API only records that a check was asked for
 * (`ai_settings.check_requested_at`); the worker, which holds the key, answers with a free call that lists one model and writes the result
 * (`last_check_at`, `last_check_status`). The key is never read here: the client already holds it, and an error carries a code only.
 */

export type KeyCheckStatus =
  'OK' | 'KEY_MISSING' | 'AUTH_FAILED' | 'UNREACHABLE' | 'LIMIT_REACHED' | 'ERROR';

function statusOf(error: unknown): KeyCheckStatus {
  if (!(error instanceof AiCallError)) return 'ERROR';
  switch (error.code) {
    case 'KEY_MISSING':
      return 'KEY_MISSING';
    case 'AUTH_FAILED':
      return 'AUTH_FAILED';
    case 'SPEND_LIMIT':
      return 'LIMIT_REACHED';
    case 'UNREACHABLE':
    case 'TIMEOUT':
    case 'SERVER':
    case 'RATE_LIMITED':
      return 'UNREACHABLE';
    default:
      return 'ERROR';
  }
}

/** Answers a pending check. Returns the status written, or null when nothing was asked. */
export async function processKeyCheck(
  database: AiDatabase,
  client: ClaudeClient,
): Promise<KeyCheckStatus | null> {
  const pending = await database.$queryRaw<{ pending: boolean }[]>`
    SELECT (check_requested_at IS NOT NULL AND (last_check_at IS NULL OR last_check_at < check_requested_at)) AS pending
      FROM ai_settings WHERE id = 1`;
  if (pending[0]?.pending !== true) return null;
  let status: KeyCheckStatus = 'OK';
  try {
    await client.checkConnection();
  } catch (error) {
    status = statusOf(error);
  }
  // The version moves by one, as every update of the settings row must (a screen that is open then refetches before its next command).
  await database.$executeRaw`
    UPDATE ai_settings
       SET last_check_at = clock_timestamp(), last_check_status = ${status}, row_version = row_version + 1
     WHERE id = 1`;
  return status;
}
