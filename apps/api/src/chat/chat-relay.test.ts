import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ChatRelay } from './chat-relay.js';
import { CircuitBreaker } from './chat.rules.js';

const SESSION = '3b1f6c52-0a43-4f3e-9d0b-2f6f1c8a9e11';
const INPUT = { sessionId: SESSION, message: 'Giá gội đầu?', locale: 'vi' as const };

/** A tiny stand-in for the n8n webhook: records what it was sent and answers as told. */
async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  work: (
    url: string,
    seen: { headers: IncomingMessage['headers']; body: string }[],
  ) => Promise<void>,
): Promise<void> {
  const seen: { headers: IncomingMessage['headers']; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += String(chunk)));
    request.on('end', () => {
      seen.push({ headers: request.headers, body });
      handler(request, response, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/x`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
};

test('the relay sends the channel, session, message and the header secret, and reads a plain reply and a slot', async () => {
  await withServer(
    (_request, response) =>
      json(response, 200, {
        reply: 'Gội đầu dưỡng sinh **350.000đ**. Xem https://evil.example',
        booking: { branch: 'hai-chau', services: ['goi-dau'], date: '2026-11-05', time: '14:30' },
        extra: 'ignored',
      }),
    async (url, seen) => {
      const relay = new ChatRelay({ url, secret: 'the-shared-secret-123' });
      const result = await relay.send(INPUT);
      assert.deepEqual(result, {
        ok: true,
        reply: 'Gội đầu dưỡng sinh 350.000đ. Xem',
        booking: { branch: 'hai-chau', services: ['goi-dau'], date: '2026-11-05', time: '14:30' },
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0]!.headers['x-lucy-chat-secret'], 'the-shared-secret-123');
      assert.match(String(seen[0]!.headers['content-type']), /application\/json/);
      assert.deepEqual(JSON.parse(seen[0]!.body), {
        channel: 'web',
        sessionId: SESSION,
        message: 'Giá gội đầu?',
        locale: 'vi',
      });
    },
  );
});

test('an answer wrapped in a one-item list is read; a malformed slot is dropped, not fatal', async () => {
  await withServer(
    (_request, response) =>
      json(response, 200, [{ reply: 'Chào bạn!', booking: { branch: 'x', services: [] } }]),
    async (url) => {
      const result = await new ChatRelay({ url, secret: 's'.repeat(20) }).send(INPUT);
      assert.deepEqual(result, { ok: true, reply: 'Chào bạn!', booking: null });
    },
  );
});

test('every failure is one outcome: a status other than 200, bad JSON, no reply, a huge answer, a redirect, a closed port', async () => {
  const cases: [string, (response: ServerResponse) => void][] = [
    ['500', (response) => json(response, 500, { reply: 'x' })],
    ['204', (response) => json(response, 204, '')],
    ['not json', (response) => json(response, 200, 'oops')],
    ['no reply', (response) => json(response, 200, { answer: 'x' })],
    ['empty reply', (response) => json(response, 200, { reply: '<b></b>' })],
    ['reply not text', (response) => json(response, 200, { reply: { text: 'x' } })],
    ['null', (response) => json(response, 200, 'null')],
    ['huge', (response) => json(response, 200, JSON.stringify({ reply: 'x'.repeat(70_000) }))],
    [
      'redirect',
      (response) => {
        response.writeHead(302, { location: 'https://evil.example/steal' });
        response.end();
      },
    ],
  ];
  for (const [label, answer] of cases) {
    await withServer(
      (_request, response) => answer(response),
      async (url) => {
        // A fresh breaker each time so one failure never hides the next case.
        const relay = new ChatRelay({ url, secret: 's'.repeat(20), breaker: new CircuitBreaker() });
        assert.deepEqual(await relay.send(INPUT), { ok: false, reason: 'DOWN' }, label);
      },
    );
  }
  const closed = new ChatRelay({ url: 'http://127.0.0.1:1/webhook/x', secret: 's'.repeat(20) });
  assert.deepEqual(await closed.send(INPUT), { ok: false, reason: 'DOWN' });
});

test('a slow bot is cut at the timeout', async () => {
  await withServer(
    () => undefined,
    async (url) => {
      const relay = new ChatRelay({ url, secret: 's'.repeat(20), timeoutMs: 150 });
      const started = Date.now();
      assert.deepEqual(await relay.send(INPUT), { ok: false, reason: 'DOWN' });
      assert.ok(Date.now() - started < 3_000);
    },
  );
});

test('after five failures the breaker refuses at once (no call), and says when it opens and closes', async () => {
  let calls = 0;
  let clock = 0;
  const states: string[] = [];
  const relay = new ChatRelay({
    url: 'http://127.0.0.1:1/x',
    secret: 's'.repeat(20),
    now: () => clock,
    fetch: async () => {
      calls += 1;
      return { ok: false, status: 500, text: async () => '' };
    },
    onState: (state) => states.push(state),
  });
  for (let n = 0; n < 5; n += 1) assert.equal((await relay.send(INPUT)).ok, false);
  assert.equal(calls, 5);
  assert.equal(relay.open, true);
  assert.deepEqual(states, ['OPEN']);
  assert.equal((await relay.send(INPUT)).ok, false);
  assert.equal(calls, 5, 'no call while open');
  // After the cool-down one probe goes out; success closes it.
  clock = 31_000;
  const good = new ChatRelay({
    url: 'http://127.0.0.1:1/x',
    secret: 's'.repeat(20),
    now: () => clock,
    breaker: (() => {
      const breaker = new CircuitBreaker();
      for (let n = 0; n < 5; n += 1) breaker.failure(0);
      return breaker;
    })(),
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ reply: 'Chào!' }),
    }),
    onState: (state) => states.push(`good-${state}`),
  });
  assert.equal(good.open, true);
  assert.equal((await good.send(INPUT)).ok, true);
  assert.equal(good.open, false);
});
