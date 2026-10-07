import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Rate limiting of the anonymous, read-only `/api/v1/public/*` routes (Phase 6 P6-7). Pure parts: who the client is, which
 * budget a route draws on, and the Redis key of a window. The counting itself is `PublicRateLimitService`.
 */

export type PublicBudget = 'json' | 'media';

/** One fixed window. A visitor who passes the limit waits at most this long. */
export const PUBLIC_WINDOW_SECONDS = 60;

export interface PublicLimit {
  /** Requests one client address may make per window. */
  perClient: number;
  /** Requests all outside clients together may make per window (a flood from many addresses must not reach the POS). */
  total: number;
}

/**
 * JSON reads (site, services, products, slides, popup, season) and picture files. A page load makes a handful of calls, so 300 a
 * minute per address leaves room for a whole salon on one Wi-Fi; pictures are many per page and cached for a year by browsers.
 * Proposed by Claude in P6-7 (technical reading, pending the Owner).
 */
export const PUBLIC_LIMITS: Record<PublicBudget, PublicLimit> = {
  json: { perClient: 300, total: 6_000 },
  media: { perClient: 1_200, total: 30_000 },
};

export const budgetOf = (path: string): PublicBudget =>
  /^\/api\/v1\/public\/media\//.test(path) ? 'media' : 'json';

export interface ClientIdentity {
  /** A short digest of the address (never the address itself in Redis); `unknown` when no outside address could be read. */
  id: string;
  /** False when the forwarded header held no outside address (every client then shares one budget). */
  known: boolean;
}

function ipv4Octets(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

/** Eight 16-bit groups of an IPv6 address, or null. An IPv4 tail (`::ffff:1.2.3.4`) becomes two groups. */
function ipv6Groups(value: string): number[] | null {
  let text = value.toLowerCase();
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const octets = ipv4Octets(tail[1] ?? '');
    if (!octets) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, -(tail[1]?.length ?? 0))}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  const numbers = groups.map((group) => parseInt(group, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? numbers
    : null;
}

/** Loopback, private, link-local, unspecified: an address that is a proxy hop or a LAN, never a visitor on the Internet. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = ipv4Octets(address) ?? [];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = groups;
  if (
    groups.every((group) => group === 0) ||
    (groups.slice(0, 7).every((g) => g === 0) && g7 === 1)
  ) {
    return true;
  }
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80) return true;
  // IPv4-mapped (::ffff:a.b.c.d): judge the IPv4 address inside.
  if (groups.slice(0, 5).every((g) => g === 0) && g5 === 0xffff) {
    return isPrivateAddress(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
  }
  return false;
}

/** `1.2.3.4`, `1.2.3.4:5678`, `[2001:db8::1]:443`, `2001:db8::1` to the bare address; anything else to null. */
function bareAddress(entry: string): string | null {
  const text = entry.trim();
  const bracket = text.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return isIP(bracket[1] ?? '') === 6 ? (bracket[1] ?? null) : null;
  const withPort = text.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  const candidate = withPort ? (withPort[1] ?? '') : text;
  return isIP(candidate) ? candidate : null;
}

/** An IPv6 visitor holds a whole /64, so the budget belongs to the /64 (an address inside it is not a new visitor). */
function budgetAddress(address: string): string {
  if (isIP(address) !== 6) return address;
  const groups = ipv6Groups(address);
  // An IPv4 visitor written the IPv6 way (`::ffff:203.0.113.9`) is the same visitor as `203.0.113.9`.
  if (groups && groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return groups
    ? `${groups
        .slice(0, 4)
        .map((g) => g.toString(16))
        .join(':')}::/64`
    : address;
}

/**
 * Who made the request, from `X-Forwarded-For`. The header is read from the RIGHT: each proxy appends the address it saw, so the
 * entries to the left of the first one added by our own proxies are whatever the client chose to write. The first outside address
 * from the right is the one our nginx recorded.
 *
 * `null` means the request carried no forwarded header at all: it is the website's own server rendering a page (a direct call to
 * the API from the same machine), not a visitor, and is not counted.
 */
export function clientIdentity(forwardedFor: string | string[] | undefined): ClientIdentity | null {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  if (header === undefined || header.trim() === '') return null;
  const entries = header.split(',').slice(-16);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const address = bareAddress(entries[index] ?? '');
    if (address && !isPrivateAddress(address)) {
      const digest = createHash('sha256').update(budgetAddress(address)).digest('hex').slice(0, 16);
      return { id: digest, known: true };
    }
  }
  return { id: 'unknown', known: false };
}

/** The Redis key of one counter in one window. `scope` is a client digest, `unknown` or `total`. */
export const windowKey = (budget: PublicBudget, scope: string, windowIndex: number): string =>
  `lucy:rl:public:${budget}:${scope}:${windowIndex}`;
