import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isBlockedAddress } from './net-guard.js';

/**
 * Phase 9 P9-3: the only way the importer talks to a supplier site (worker only; the API never fetches third-party URLs).
 *
 * - https only, to the hosts of the source's own configured address, default port, no credentials. Every redirect is checked again.
 * - The address the socket connects to is checked (`createGuardedLookup`, plus the connected socket), so private, loopback and
 *   link-local targets and DNS rebinding never get through. There is no switch that turns the guard off; tests inject a transport.
 * - At most one request per second (more when robots.txt asks), an identifying User-Agent with a contact address, 15 s total timeout
 *   and a byte cap enforced on the decoded stream, not on the Content-Length header.
 */

/** Owner decision 2026-10-10: the importer identifies itself with the shop's support address and site, nothing personal. */
export const IMPORTER_USER_AGENT = 'LucySpaCatalogBot/1.0 (+https://lucyspa.vn; hotro@lucyspa.vn)';
export const IMPORTER_ROBOTS_TOKEN = 'LucySpaCatalogBot';

export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15_000;
export const MIN_INTERVAL_MS = 1000;
const MAX_REDIRECTS = 3;

export type HttpFailureCode =
  | 'BAD_URL'
  | 'HOST_NOT_ALLOWED'
  | 'BLOCKED_ADDRESS'
  | 'REDIRECT_LIMIT'
  | 'REDIRECT_INVALID'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_ENCODING'
  | 'NETWORK';

export class HttpFetchError extends Error {
  constructor(
    readonly code: HttpFailureCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HttpFetchError';
  }
}

export interface GetOptions {
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
}

export interface HttpResponse {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: Buffer;
  /** The address the body came from, after redirects. */
  url: string;
}

export interface HttpClient {
  get(url: string, options?: GetOptions): Promise<HttpResponse>;
  /** Requests sent so far (every redirect hop counts). */
  requestCount(): number;
  /** Raises the wait between requests (robots.txt Crawl-delay); it never goes below one second. */
  setMinInterval(ms: number): void;
}

export interface TransportRequest {
  url: URL;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** One request, no redirects followed. Replaceable in tests; the default one is `httpsTransport`. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

type LookupAddress = { address: string; family: number };
export type Resolve = (
  hostname: string,
  options: { all: true; verbatim: boolean },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A `lookup` for `https.request` that refuses the connection when ANY address of the name is not public, and otherwise hands the
 * connection exactly the addresses it checked.
 */
export function createGuardedLookup(resolve: Resolve = dnsLookup as unknown as Resolve) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ): void => {
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error);
        return;
      }
      if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
        callback(new HttpFetchError('BLOCKED_ADDRESS'));
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const [first] = addresses as [LookupAddress];
      callback(null, first.address, first.family);
    });
  };
}

function lowerHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * Reads a response body into memory: decodes gzip, deflate and brotli, and stops with TOO_LARGE as soon as the DECODED size passes
 * the cap (a compression bomb or a lying Content-Length cannot get through).
 */
export function readBody(
  response: Readable,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolveBody, reject) => {
    const declared = Number(headers['content-length']);
    const encoding = (headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    if (encoding === 'identity' && Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      reject(new HttpFetchError('TOO_LARGE'));
      return;
    }
    let source: Readable = response;
    if (encoding === 'gzip' || encoding === 'x-gzip') source = response.pipe(createGunzip());
    else if (encoding === 'deflate') source = response.pipe(createInflate());
    else if (encoding === 'br') source = response.pipe(createBrotliDecompress());
    else if (encoding !== 'identity' && encoding !== '') {
      response.destroy();
      reject(new HttpFetchError('UNSUPPORTED_ENCODING'));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const stop = (action: () => void) => {
      if (done) return;
      done = true;
      action();
    };
    source.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        stop(() => {
          source.destroy();
          response.destroy();
          reject(new HttpFetchError('TOO_LARGE'));
        });
        return;
      }
      chunks.push(chunk);
    });
    source.on('end', () => stop(() => resolveBody(Buffer.concat(chunks))));
    source.on('error', (error) => stop(() => reject(error)));
    response.on('error', (error) => stop(() => reject(error)));
  });
}

/** The real transport: one https request through the guarded lookup, body read with a hard byte cap. */
export function httpsTransport(resolve?: Resolve): Transport {
  const lookup = createGuardedLookup(resolve);
  return (request) =>
    new Promise<TransportResponse>((resolveResponse, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        action();
      };
      const fail = (error: unknown) =>
        finish(() => {
          req.destroy();
          reject(
            error instanceof HttpFetchError
              ? error
              : new HttpFetchError('NETWORK', error instanceof Error ? error.name : undefined),
          );
        });
      const deadline = setTimeout(() => fail(new HttpFetchError('TIMEOUT')), request.timeoutMs);
      const req = httpsRequest(
        request.url,
        {
          method: 'GET',
          headers: request.headers,
          lookup: lookup as never,
          agent: false,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const headers = lowerHeaders(res.headers);
          if (status >= 300 && status < 400) {
            res.resume();
            finish(() => resolveResponse({ status, headers, body: Buffer.alloc(0) }));
            return;
          }
          readBody(res, headers, request.maxBytes).then(
            (body) => finish(() => resolveResponse({ status, headers, body })),
            fail,
          );
          res.on('error', fail);
        },
      );
      req.on('socket', (socket) => {
        // Defence in depth next to the lookup: whatever the socket really connected to must be public.
        socket.once('connect', () => {
          const remote = socket.remoteAddress;
          if (remote === undefined || isBlockedAddress(remote)) {
            fail(new HttpFetchError('BLOCKED_ADDRESS'));
          }
        });
      });
      req.on('error', fail);
      req.end();
    });
}

export interface GuardedClientOptions {
  /** Host names the client may talk to: the host of the source's configured address. */
  allowedHosts: readonly string[];
  userAgent?: string;
  transport?: Transport;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function allowedUrl(raw: string, allowed: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpFetchError('BAD_URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0
  ) {
    throw new HttpFetchError('BAD_URL');
  }
  if (!allowed.has(url.hostname.toLowerCase())) throw new HttpFetchError('HOST_NOT_ALLOWED');
  return url;
}

export function createGuardedHttpClient(options: GuardedClientOptions): HttpClient {
  const allowed = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  const transport = options.transport ?? httpsTransport();
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const userAgent = options.userAgent ?? IMPORTER_USER_AGENT;
  let interval = Math.max(MIN_INTERVAL_MS, options.minIntervalMs ?? MIN_INTERVAL_MS);
  let lastStart: number | null = null;
  let requests = 0;

  async function throttled(): Promise<void> {
    if (lastStart !== null) {
      const wait = lastStart + interval - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
    requests += 1;
  }

  return {
    requestCount: () => requests,
    setMinInterval(ms) {
      interval = Math.max(MIN_INTERVAL_MS, ms);
    },
    async get(rawUrl, getOptions = {}) {
      let url = allowedUrl(rawUrl, allowed);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        await throttled();
        const response = await transport({
          url,
          headers: {
            'user-agent': userAgent,
            accept: getOptions.accept ?? '*/*',
            'accept-encoding': 'gzip, deflate, br',
          },
          timeoutMs: getOptions.timeoutMs ?? REQUEST_TIMEOUT_MS,
          maxBytes: getOptions.maxBytes ?? PAGE_MAX_BYTES,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          return { ...response, url: url.toString() };
        }
        const location = response.headers['location'];
        if (!location) throw new HttpFetchError('REDIRECT_INVALID');
        let next: URL;
        try {
          next = allowedUrl(new URL(location, url).toString(), allowed);
        } catch (error) {
          if (error instanceof HttpFetchError && error.code === 'BAD_URL') {
            throw new HttpFetchError('REDIRECT_INVALID');
          }
          throw error;
        }
        url = next;
      }
      throw new HttpFetchError('REDIRECT_LIMIT');
    },
  };
}
