import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  createGuardedHttpClient,
  createGuardedLookup,
  HttpFetchError,
  httpsTransport,
  IMPORTER_USER_AGENT,
  readBody,
  type Resolve,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './http-client.js';

const ok = (body = 'ok', headers: Record<string, string> = {}): TransportResponse => ({
  status: 200,
  headers,
  body: Buffer.from(body),
});

function harness(responses: TransportResponse[], hosts = ['shop.example']) {
  const calls: TransportRequest[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const transport: Transport = async (request) => {
    calls.push(request);
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    return next;
  };
  const client = createGuardedHttpClient({
    allowedHosts: hosts,
    transport,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { client, calls, sleeps, tick: (ms: number) => (clock += ms) };
}

test('requests carry the identifying User-Agent with the shop contact and nothing personal', async () => {
  const { client, calls } = harness([ok()]);
  await client.get('https://shop.example/robots.txt');
  assert.equal(calls[0]?.headers['user-agent'], IMPORTER_USER_AGENT);
  assert.match(
    IMPORTER_USER_AGENT,
    /^LucySpaCatalogBot\/1\.0 \(\+https:\/\/lucyspa\.vn; hotro@lucyspa\.vn\)$/,
  );
  assert.doesNotMatch(IMPORTER_USER_AGENT, /gmail/i);
});

test('at most one request per second per client, redirect hops included', async () => {
  const { client, sleeps, tick } = harness([
    { status: 301, headers: { location: '/b' }, body: Buffer.alloc(0) },
    ok('b'),
    ok('c'),
  ]);
  const res = await client.get('https://shop.example/a');
  assert.equal(res.url, 'https://shop.example/b');
  assert.equal(client.requestCount(), 2);
  assert.deepEqual(sleeps, [1000]);
  tick(400);
  await client.get('https://shop.example/c');
  assert.deepEqual(sleeps, [1000, 600]);
  client.setMinInterval(5000);
  tick(0);
});

test('a Crawl-delay can slow the client down but never below one second', async () => {
  const { client, sleeps } = harness([ok(), ok(), ok()]);
  client.setMinInterval(100);
  await client.get('https://shop.example/1');
  await client.get('https://shop.example/2');
  client.setMinInterval(3000);
  await client.get('https://shop.example/3');
  assert.deepEqual(sleeps, [1000, 3000]);
});

test('only https, the default port, no credentials, no address literal and only allowed hosts', async () => {
  const { client, calls } = harness([ok()]);
  const cases: [string, string][] = [
    ['http://shop.example/', 'BAD_URL'],
    ['https://user:pw@shop.example/', 'BAD_URL'],
    ['https://shop.example:8443/', 'BAD_URL'],
    ['https://127.0.0.1/', 'BAD_URL'],
    ['https://[::1]/', 'BAD_URL'],
    ['https://169.254.169.254/latest/meta-data', 'BAD_URL'],
    ['https://other.example/', 'HOST_NOT_ALLOWED'],
    ['https://shop.example.evil.test/', 'HOST_NOT_ALLOWED'],
    ['not a url', 'BAD_URL'],
  ];
  for (const [url, code] of cases) {
    await assert.rejects(
      client.get(url),
      (error) => error instanceof HttpFetchError && error.code === code,
      url,
    );
  }
  assert.equal(calls.length, 0);
});

test('a redirect to another host, to http, to an address or without a target is refused', async () => {
  for (const location of [
    'https://evil.example/',
    'http://shop.example/x',
    'https://10.0.0.5/x',
    undefined,
  ]) {
    const { client } = harness([
      { status: 302, headers: location ? { location } : {}, body: Buffer.alloc(0) },
    ]);
    await assert.rejects(client.get('https://shop.example/a'), (error) => {
      assert.ok(error instanceof HttpFetchError);
      assert.ok(['HOST_NOT_ALLOWED', 'REDIRECT_INVALID'].includes(error.code), error.code);
      return true;
    });
  }
});

test('more than three redirects stop with REDIRECT_LIMIT', async () => {
  const hop = { status: 302, headers: { location: '/next' }, body: Buffer.alloc(0) };
  const { client } = harness([hop, hop, hop, hop, ok()]);
  await assert.rejects(
    client.get('https://shop.example/a'),
    (error) => error instanceof HttpFetchError && error.code === 'REDIRECT_LIMIT',
  );
});

const resolverTo =
  (...addresses: string[]): Resolve =>
  (_host, _options, callback) =>
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );

test('the guarded lookup refuses a name with ANY non-public answer (rebinding, mixed answers)', async () => {
  for (const addresses of [
    ['10.0.0.8'],
    ['127.0.0.1'],
    ['93.184.216.34', '169.254.169.254'],
    ['::1'],
    ['::ffff:10.0.0.1'],
    [],
  ]) {
    const lookup = createGuardedLookup(resolverTo(...addresses));
    const error = await new Promise<unknown>((resolve) =>
      lookup('shop.example', {}, (e: unknown) => resolve(e)),
    );
    assert.ok(
      error instanceof HttpFetchError && error.code === 'BLOCKED_ADDRESS',
      addresses.join(','),
    );
  }
});

test('the guarded lookup hands the connection only addresses it checked, in both call styles', async () => {
  const lookup = createGuardedLookup(resolverTo('93.184.216.34', '2606:4700:4700::1111'));
  const single = await new Promise<unknown[]>((resolve) =>
    lookup('shop.example', {}, (...args: unknown[]) => resolve(args)),
  );
  assert.deepEqual(single, [null, '93.184.216.34', 4]);
  const all = await new Promise<unknown[]>((resolve) =>
    lookup('shop.example', { all: true }, (...args: unknown[]) => resolve(args)),
  );
  assert.deepEqual(all, [
    null,
    [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
  ]);
});

test('the real transport never connects when the name resolves to a private address', async () => {
  const transport = httpsTransport(resolverTo('192.168.0.10'));
  await assert.rejects(
    transport({
      url: new URL('https://shop.example/x'),
      headers: {},
      timeoutMs: 2000,
      maxBytes: 1000,
    }),
    (error) => error instanceof HttpFetchError && error.code === 'BLOCKED_ADDRESS',
  );
  // And localhost, resolved by the real resolver, is refused too.
  await assert.rejects(
    httpsTransport()({
      url: new URL('https://localhost/x'),
      headers: {},
      timeoutMs: 2000,
      maxBytes: 1000,
    }),
    (error) => error instanceof HttpFetchError && error.code === 'BLOCKED_ADDRESS',
  );
});

test('the body cap counts decoded bytes and ignores a lying Content-Length', async () => {
  const stream = (data: Buffer | string) => Readable.from([Buffer.from(data)]);
  assert.equal((await readBody(stream('hello'), {}, 10)).toString(), 'hello');
  await assert.rejects(
    readBody(stream('x'.repeat(20)), {}, 10),
    (error) => error instanceof HttpFetchError && error.code === 'TOO_LARGE',
  );
  await assert.rejects(
    readBody(stream('hi'), { 'content-length': '999999' }, 10),
    (error) => error instanceof HttpFetchError && error.code === 'TOO_LARGE',
  );
  // A small gzip body that inflates past the cap is a compression bomb.
  const bomb = gzipSync(Buffer.alloc(1_000_000));
  assert.ok(bomb.length < 5000);
  await assert.rejects(
    readBody(stream(bomb), { 'content-encoding': 'gzip' }, 100_000),
    (error) => error instanceof HttpFetchError && error.code === 'TOO_LARGE',
  );
  assert.equal(
    (
      await readBody(stream(gzipSync('plain text')), { 'content-encoding': 'gzip' }, 100)
    ).toString(),
    'plain text',
  );
  await assert.rejects(
    readBody(stream('x'), { 'content-encoding': 'compress' }, 100),
    (error) => error instanceof HttpFetchError && error.code === 'UNSUPPORTED_ENCODING',
  );
});
