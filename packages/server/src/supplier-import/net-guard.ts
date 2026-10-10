import { isIP } from 'node:net';

/**
 * Phase 9 P9-3: which network addresses the importer may connect to. A supplier site is on the public internet; anything private,
 * loopback, link-local, shared (carrier-grade NAT), reserved, multicast or documentation is refused. The check runs on the address the
 * connection is really made to (see `http-client.ts`), so a name that resolves to a private address, or changes its answer between
 * two lookups (DNS rebinding), never reaches the network.
 */

function parseIpv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function blockedIpv4(bytes: readonly number[]): boolean {
  const [a, b, c] = bytes as [number, number, number, number];
  return (
    a === 0 || // this network
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // shared address space (CGNAT)
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay (deprecated)
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 text form into eight 16-bit groups, or null when it is not valid. */
function parseIpv6(text: string): number[] | null {
  let value = text;
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  // An embedded IPv4 tail (::ffff:1.2.3.4) is two groups.
  const lastColon = value.lastIndexOf(':');
  if (lastColon >= 0 && value.includes('.', lastColon)) {
    const v4 = parseIpv4(value.slice(lastColon + 1));
    if (!v4) return null;
    const high = ((v4[0] as number) << 8) | (v4[1] as number);
    const low = ((v4[2] as number) << 8) | (v4[3] as number);
    value = `${value.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parse = (side: string): number[] | null => {
    if (side === '') return [];
    const groups = side.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = parse(halves[0] as string);
  const tail = halves.length === 2 ? parse(halves[1] as string) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

function blockedIpv6(groups: readonly number[]): boolean {
  const first = groups[0] as number;
  const second = groups[1] as number;
  // Only global unicast (2000::/3) can be a public host. This refuses ::, ::1, ::ffff:0:0/96 (mapped IPv4), 64:ff9b::/96
  // (NAT64), fc00::/7 (unique local), fe80::/10 (link-local), ff00::/8 (multicast) and everything else outside it.
  if ((first & 0xe000) !== 0x2000) return true;
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  if (first === 0x2001 && second < 0x0200) return true; // IETF protocol assignments (Teredo, benchmarking, ORCHID, ...)
  if (first === 0x2002) {
    // 6to4 embeds an IPv4 address; judge that one.
    return blockedIpv4([
      (second >> 8) & 0xff,
      second & 0xff,
      ((groups[2] as number) >> 8) & 0xff,
      (groups[2] as number) & 0xff,
    ]);
  }
  if (first === 0x3fff && second < 0x1000) return true; // documentation
  return false;
}

/** True when the importer must not connect to this address. Anything that is not a valid IP address counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const bytes = parseIpv4(address);
    return bytes === null || blockedIpv4(bytes);
  }
  if (version === 6) {
    const groups = parseIpv6(address);
    return groups === null || blockedIpv6(groups);
  }
  return true;
}
