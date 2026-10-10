import type { SupplierSourceGap, SupplierSourceStatus } from '@lucy-spa/contracts';
import { isIP } from 'node:net';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 9 P9-2 (P9-T9): the pure rules of a supplier source: what a source address may look like and what still stops a source
 * from being enabled. The database repeats the gate as constraints; these functions give the precise answer first.
 */

export interface GateFacts {
  isEnabled: boolean;
  status: SupplierSourceStatus;
  permissionGivenBy: string | null;
  permissionMethod: string | null;
  permissionDate: Date | null;
  permitsText: boolean;
  permitsImages: boolean;
  permissionConfirmedAt: Date | null;
}

/** What still stops a source from being enabled, in the order a person fixes it. Empty for a source that is enabled. */
export function sourceGaps(facts: GateFacts): SupplierSourceGap[] {
  if (facts.isEnabled) return [];
  const gaps: SupplierSourceGap[] = [];
  if (!facts.permissionGivenBy || !facts.permissionMethod || !facts.permissionDate) {
    gaps.push('PERMISSION_RECORD');
  }
  if (!facts.permitsText && !facts.permitsImages) gaps.push('PERMISSION_COVERAGE');
  if (facts.permissionConfirmedAt === null) gaps.push('PERMISSION_CONFIRMATION');
  // From P9-3 a person must also have confirmed a successful Test Source of the current address: the status is then READY.
  if (facts.status !== 'READY') gaps.push('TEST_REQUIRED');
  return gaps;
}

/**
 * The address a source is read from: https only, a real host name (no address literal, no port, no credentials), no query and no
 * fragment. It is stored as the origin plus the path with a closing slash. Fetch-time checks (P9-3) still refuse private addresses
 * after the name is resolved; this only keeps an obviously wrong address out of the configuration.
 */
export function normalizeSourceUrl(value: unknown, field = 'baseUrl'): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text.length === 0 || text.length > 500 || /[\s\p{Cc}]/u.test(text)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    isIP(host.replace(/^\[|\]$/g, '')) !== 0 ||
    !host.includes('.') ||
    host.endsWith('.') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const normalized = `${url.origin}${path}`;
  if (normalized.length > 500) throw new AuthError('VALIDATION_FAILED', field);
  return normalized;
}

/** Today's date in the shop's time zone (`YYYY-MM-DD`): the day a permission may be dated at the latest. */
export function shopToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
