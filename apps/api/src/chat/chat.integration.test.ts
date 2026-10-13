import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessageRequest } from '@lucy-spa/contracts';
import { runAiRetention } from '@lucy-spa/server';
import type { Logger } from 'pino';
import type { PrismaService } from '../platform/prisma.service.js';
import { clientIdentity } from '../platform/public-rate-limit.core.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ChatLimiter, type CounterStore } from './chat-limits.js';
import { ChatRelay, type FetchLike } from './chat-relay.js';
import { ChatRequestService } from './chat-requests.service.js';
import { ChatRateLimited, PublicChatService } from './chat.service.js';

/**
 * Claude integration Wave B (CI-B2) against real PostgreSQL: the website chat and its callback inbox. The bot is a fake that answers
 * through `fetch`, the counters a map. Switches off by default; a reply carries a booking link built here; a bot that is down, slow or
 * over the daily cap sends the visitor to the callback form; the abuse limits answer 429 with a wait; a callback request is stored once,
 * tells only the holders of the inbox permission, and is worked forward only. Fixtures roll back.
 */
const SESSION = '3b1f6c52-0a43-4f3e-9d0b-2f6f1c8a9e11';
const VISITOR = clientIdentity('203.0.113.9');

class MapStore implements CounterStore {
  readonly counts = new Map<string, number>();
  down = false;
  async increment(key: string): Promise<number> {
    if (this.down) throw new Error('down');
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

const message = (text: string, session = SESSION): ChatMessageRequest => ({
  sessionId: session,
  message: text,
  locale: 'vi',
});

test(
  'Claude integration Wave B chat: switches, relay, fallbacks, limits, callback requests and the inbox; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const logger = {
        warn: () => undefined,
        info: () => undefined,
        error: () => undefined,
      } as unknown as Logger;
      const environment = { ...base.environment, chatWebhook: null };
      const service = new PublicChatService(environment, logger, { client: tx } as PrismaService);
      const inbox = new ChatRequestService(base.adapter, base.throttle);
      const manager = await base.staff([], { globalCodes: ['MANAGE_CHAT_REQUESTS'] });
      const other = await base.staff([]);
      const rows = <T>(sql: string, ...values: unknown[]) =>
        tx.$queryRawUnsafe<T[]>(sql, ...values);
      const setSettings = (assignments: string) =>
        tx.$executeRawUnsafe(
          `UPDATE ai_settings SET ${assignments}, row_version = row_version + 1 WHERE id = 1`,
        );
      const audit = (action: string) => tx.auditEvent.findMany({ where: { action } });

      // The bot: `answer` decides what the fake webhook says; every call is recorded.
      const calls: { url: string; body: Record<string, unknown>; secret: string | undefined }[] =
        [];
      let answer: () => { status: number; body: unknown } | 'throw' = () => ({
        status: 200,
        body: { reply: 'Gội đầu dưỡng sinh 350.000đ, khoảng 60 phút.' },
      });
      const fetcher: FetchLike = async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>,
          secret: init.headers['x-lucy-chat-secret'],
        });
        const result = answer();
        if (result === 'throw') throw new Error('network');
        return {
          ok: result.status === 200,
          status: result.status,
          text: async () => JSON.stringify(result.body),
        };
      };
      const store = new MapStore();
      const wire = () => {
        store.counts.clear();
        service.use({
          relay: new ChatRelay({
            url: 'http://127.0.0.1:5678/webhook/x',
            secret: 'secret-secret-secret',
            fetch: fetcher,
          }),
          limiter: new ChatLimiter(store),
        });
      };
      wire();
      const requests = () =>
        rows<{ n: bigint }>(`SELECT count(*) AS n FROM chat_callback_requests`).then((r) =>
          Number(r[0]!.n),
        );

      await suite.test(
        'everything is off by default; a filled honeypot and bad input never reach the bot',
        async () => {
          assert.deepEqual(await service.message(message('Giá gội đầu?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'OFF',
          });
          await setSettings(`enabled = true`);
          assert.deepEqual(await service.message(message('Giá gội đầu?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'OFF',
          });
          await setSettings(`chat_enabled = true`);
          assert.equal(calls.length, 0);
          assert.deepEqual(
            await service.message({ ...message('Giá?'), website: 'http://spam.example' }, VISITOR),
            { status: 'FALLBACK', reason: 'OFF' },
          );
          await fails(() => service.message(message(''), VISITOR), 'VALIDATION_FAILED', 'message');
          await fails(
            () => service.message(message('x'.repeat(501)), VISITOR),
            'VALIDATION_FAILED',
            'message',
          );
          await fails(
            () => service.message(message('Giá?', 'not-a-uuid'), VISITOR),
            'VALIDATION_FAILED',
            'sessionId',
          );
          await fails(
            () => service.message({ ...message('Giá?'), locale: 'fr' as never }, VISITOR),
            'VALIDATION_FAILED',
            'locale',
          );
          assert.equal(calls.length, 0, 'nothing was relayed');
        },
      );

      await suite.test(
        'a reply is plain text; the booking link is built here from the slot; the secret and the session travel with it',
        async () => {
          answer = () => ({
            status: 200,
            body: {
              reply:
                'Còn chỗ lúc 14:30 nhé. Đặt tại https://evil.example/book hoặc [đây](https://evil.example)',
              booking: {
                branch: 'hai-chau',
                services: ['goi-dau'],
                date: '2026-11-05',
                time: '14:30',
              },
            },
          });
          const result = await service.message(message('Mai còn chỗ gội đầu không?'), VISITOR);
          assert.deepEqual(result, {
            status: 'REPLY',
            reply: 'Còn chỗ lúc 14:30 nhé. Đặt tại hoặc đây',
            bookingUrl:
              'http://localhost:3000/vi/account/book?branch=hai-chau&services=goi-dau&date=2026-11-05&time=14%3A30',
          });
          assert.equal(calls.length, 1);
          assert.equal(calls[0]!.secret, 'secret-secret-secret');
          assert.deepEqual(calls[0]!.body, {
            channel: 'web',
            sessionId: SESSION,
            message: 'Mai còn chỗ gội đầu không?',
            locale: 'vi',
          });
          // A reply without a slot has no link; a malformed slot is no slot.
          answer = () => ({ status: 200, body: { reply: 'Chào bạn!', booking: { branch: 'x' } } });
          assert.deepEqual(
            await service.message(
              message('Xin chào', 'aaaaaaaa-0a43-4f3e-9d0b-2f6f1c8a9e11'),
              VISITOR,
            ),
            {
              status: 'REPLY',
              reply: 'Chào bạn!',
              bookingUrl: null,
            },
          );
          // The chat stores nothing of its own.
          assert.equal(await requests(), 0);
        },
      );

      await suite.test(
        'a bot that is down sends the visitor to the callback form; five failures stop the calls; no webhook means the form at once',
        async () => {
          wire();
          answer = () => ({ status: 500, body: {} });
          const before = calls.length;
          for (let n = 0; n < 5; n += 1) {
            assert.deepEqual(
              await service.message(
                message('Giá?', `bbbbbbb${n}-0a43-4f3e-9d0b-2f6f1c8a9e11`),
                clientIdentity(`198.51.100.${n + 1}`),
              ),
              { status: 'FALLBACK', reason: 'N8N_DOWN' },
            );
          }
          assert.equal(calls.length - before, 5);
          // The breaker is open: no call goes out.
          assert.deepEqual(
            await service.message(
              message('Giá?', 'ccccccc1-0a43-4f3e-9d0b-2f6f1c8a9e11'),
              clientIdentity('198.51.100.50'),
            ),
            {
              status: 'FALLBACK',
              reason: 'N8N_DOWN',
            },
          );
          assert.equal(calls.length - before, 5);
          // Network errors are the same outcome.
          wire();
          answer = () => 'throw';
          assert.deepEqual(await service.message(message('Giá?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'N8N_DOWN',
          });
          service.use({ relay: null });
          const quiet = calls.length;
          assert.deepEqual(await service.message(message('Giá?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'N8N_DOWN',
          });
          assert.equal(calls.length, quiet);
          wire();
          answer = () => ({ status: 200, body: { reply: 'Chào!' } });
        },
      );

      await suite.test(
        'the daily cap and the master switch: past the cap or with AI off the visitor gets the form; counters down means the bot is off',
        async () => {
          wire();
          await setSettings(`chat_daily_cap = 2`);
          for (let n = 0; n < 2; n += 1) {
            assert.equal(
              (
                await service.message(
                  message('Giá?', `dddddd${n}0-0a43-4f3e-9d0b-2f6f1c8a9e11`),
                  clientIdentity(`198.51.100.${n + 100}`),
                )
              ).status,
              'REPLY',
            );
          }
          assert.deepEqual(
            await service.message(
              message('Giá?', 'dddddd99-0a43-4f3e-9d0b-2f6f1c8a9e11'),
              clientIdentity('198.51.100.120'),
            ),
            {
              status: 'FALLBACK',
              reason: 'CAP_REACHED',
            },
          );
          await setSettings(`chat_daily_cap = 0`);
          wire();
          assert.deepEqual(await service.message(message('Giá?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'CAP_REACHED',
          });
          await setSettings(`chat_daily_cap = 300`);
          wire();
          store.down = true;
          assert.deepEqual(await service.message(message('Giá?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'OFF',
          });
          store.down = false;
          await setSettings(`enabled = false`);
          assert.deepEqual(await service.message(message('Giá?'), VISITOR), {
            status: 'FALLBACK',
            reason: 'OFF',
          });
          await setSettings(`enabled = true`);
        },
      );

      await suite.test(
        'too many messages from one address wait, with the seconds to wait',
        async () => {
          wire();
          const address = clientIdentity('192.0.2.77');
          for (let n = 0; n < 8; n += 1) {
            assert.equal(
              (
                await service.message(
                  message('Giá?', `eeeeeeee-0a43-4f3e-9d0b-2f6f1c8a9e${String(10 + n)}`),
                  address,
                )
              ).status,
              'REPLY',
            );
          }
          await assert.rejects(
            () => service.message(message('Giá?', 'eeeeeeee-0a43-4f3e-9d0b-2f6f1c8a9e99'), address),
            (error: unknown) =>
              error instanceof ChatRateLimited &&
              error.retryAfterSeconds >= 1 &&
              error.retryAfterSeconds <= 60,
          );
          // Requests that carry no readable address share one budget (they are not unlimited).
          wire();
          for (let n = 0; n < 8; n += 1) {
            await service.message(
              message('Giá?', `ffffffff-0a43-4f3e-9d0b-2f6f1c8a9e${String(10 + n)}`),
              null,
            );
          }
          await assert.rejects(
            () => service.message(message('Giá?', 'ffffffff-0a43-4f3e-9d0b-2f6f1c8a9e99'), null),
            ChatRateLimited,
          );
        },
      );

      await suite.test(
        'a callback request: consent, a real phone, cleaned text; stored once; the inbox holders are told, nobody else',
        async () => {
          wire();
          const branch = await base.branch('chat');
          const body = {
            phone: '0905 123 456',
            name: '  Lan   Anh ',
            note: 'Gọi sau 5 giờ chiều',
            branchCode: branch.code,
            locale: 'vi' as const,
            consent: true,
            reason: 'N8N_DOWN' as const,
          };
          await fails(
            () => service.callback({ ...body, consent: false }, VISITOR),
            'VALIDATION_FAILED',
            'consent',
          );
          await fails(
            () => service.callback({ ...body, phone: '12345' }, VISITOR),
            'VALIDATION_FAILED',
            'phone',
          );
          await fails(
            () => service.callback({ ...body, phone: 'abc' }, VISITOR),
            'VALIDATION_FAILED',
            'phone',
          );
          await fails(
            () => service.callback({ ...body, name: 'x'.repeat(81) }, VISITOR),
            'VALIDATION_FAILED',
            'name',
          );
          await fails(
            () => service.callback({ ...body, note: 'x'.repeat(501) }, VISITOR),
            'VALIDATION_FAILED',
            'note',
          );
          await fails(
            () => service.callback({ ...body, reason: 'SPAM' as never }, VISITOR),
            'VALIDATION_FAILED',
            'reason',
          );
          await fails(
            () => service.callback({ ...body, locale: 'xx' as never }, VISITOR),
            'VALIDATION_FAILED',
            'locale',
          );
          assert.equal(await requests(), 0);
          // A script that fills the hidden field is thanked and nothing is stored.
          assert.deepEqual(await service.callback({ ...body, website: 'x' }, VISITOR), {
            status: 'RECEIVED',
          });
          assert.equal(await requests(), 0);

          assert.deepEqual(await service.callback(body, VISITOR), { status: 'RECEIVED' });
          const [stored] = await rows<Record<string, unknown>>(
            `SELECT * FROM chat_callback_requests`,
          );
          assert.equal(stored!['phone'], '+84905123456');
          assert.equal(stored!['name'], 'Lan Anh');
          assert.equal(stored!['status'], 'NEW');
          assert.equal(stored!['reason'], 'N8N_DOWN');
          assert.equal(stored!['preferred_branch_id'], branch.id);
          // The same number again within minutes is the same request.
          assert.deepEqual(await service.callback({ ...body, phone: '+84905123456' }, VISITOR), {
            status: 'RECEIVED',
          });
          assert.equal(await requests(), 1);
          // An unknown branch code is ignored, not an error.
          assert.deepEqual(
            await service.callback(
              {
                phone: '0906 111 222',
                branchCode: 'khong-co',
                locale: 'vi' as const,
                consent: true,
                reason: 'N8N_DOWN' as const,
              },
              VISITOR,
            ),
            { status: 'RECEIVED' },
          );
          assert.equal(await requests(), 2);
          const [second] = await rows<Record<string, unknown>>(
            `SELECT * FROM chat_callback_requests WHERE phone = '+84906111222'`,
          );
          assert.equal(second!['preferred_branch_id'], null);
          assert.equal(second!['note'], null);
          // The holder of the permission was told (once per request), the other employee was not.
          const told = await tx.notification.findMany({ where: { type: 'CHAT_CALLBACK_REQUEST' } });
          assert.equal(told.filter((entry) => entry.recipientUserId === manager.id).length, 2);
          assert.equal(told.filter((entry) => entry.recipientUserId === other.id).length, 0);
          assert.ok(
            told.every(
              (entry) => entry.entityType === 'ChatCallbackRequest' && entry.branchId === null,
            ),
          );
          assert.ok(
            !JSON.stringify(told).includes('905123456'),
            'no phone number in a notification',
          );
        },
      );

      await suite.test(
        'callback requests are limited per address, never by a dead counter',
        async () => {
          wire();
          const address = clientIdentity('192.0.2.200');
          const good = (n: number) => ({
            phone: `09061${String(10000 + n)}`,
            locale: 'vi' as const,
            consent: true,
            reason: 'VISITOR' as const,
          });
          for (let n = 0; n < 5; n += 1) await service.callback(good(n), address);
          await assert.rejects(() => service.callback(good(5), address), ChatRateLimited);
          wire();
          store.down = true;
          assert.deepEqual(await service.callback(good(6), clientIdentity('192.0.2.201')), {
            status: 'RECEIVED',
          });
          store.down = false;
        },
      );

      await suite.test(
        'retention: a closed request loses its phone, name and note 90 days after it was closed, and only then',
        async () => {
          const make = async (phone: string, closedDaysAgo: number | null) => {
            const [row] = await rows<{ id: string }>(
              `INSERT INTO chat_callback_requests (reason, phone, name, note) VALUES ('VISITOR', $1, 'Khách', 'Ghi chú') RETURNING id`,
              phone,
            );
            if (closedDaysAgo !== null) {
              await tx.$executeRawUnsafe(
                `UPDATE chat_callback_requests SET status = 'CLOSED', closed_at = clock_timestamp() - make_interval(days => ${closedDaysAgo}),
                        row_version = row_version + 1 WHERE id = '${row!.id}'`,
              );
            }
            return row!.id;
          };
          const old = await make('+84907000001', 91);
          const recent = await make('+84907000002', 89);
          const open = await make('+84907000003', null);
          const result = await runAiRetention(tx);
          assert.ok(result.callbackRequestsCleared >= 1);
          const state = async (id: string) =>
            (
              await rows<{
                phone: string | null;
                name: string | null;
                note: string | null;
                purged: boolean;
                status: string;
              }>(
                `SELECT phone, name, note, purged_at IS NOT NULL AS purged, status FROM chat_callback_requests WHERE id = $1::uuid`,
                id,
              )
            )[0]!;
          assert.deepEqual(await state(old), {
            phone: null,
            name: null,
            note: null,
            purged: true,
            status: 'CLOSED',
          });
          assert.deepEqual(await state(recent), {
            phone: '+84907000002',
            name: 'Khách',
            note: 'Ghi chú',
            purged: false,
            status: 'CLOSED',
          });
          assert.equal((await state(open)).phone, '+84907000003');
          // A second pass changes nothing.
          assert.equal((await runAiRetention(tx)).callbackRequestsCleared, 0);
          await tx.$executeRawUnsafe(
            `DELETE FROM chat_callback_requests WHERE id IN ('${old}', '${recent}', '${open}')`,
          );
        },
      );

      await suite.test(
        'the inbox: only its holders; counts; forward only; a stale version conflicts; the audit keeps no phone',
        async () => {
          await fails(() => inbox.list(undefined, {}), 'AUTHENTICATION_REQUIRED');
          await fails(() => inbox.list(other.token, {}), 'FORBIDDEN');
          const list = await inbox.list(manager.token, {});
          assert.equal(list.total, list.counts.NEW + list.counts.CALLED + list.counts.CLOSED);
          assert.ok(list.counts.NEW >= 7);
          const target = list.items.find((entry) => entry.phone === '+84905123456')!;
          assert.equal(target.name, 'Lan Anh');
          assert.equal(target.status, 'NEW');
          assert.ok(target.preferredBranchName);
          await fails(
            () => inbox.list(manager.token, { status: 'DONE' }),
            'VALIDATION_FAILED',
            'status',
          );
          assert.ok((await inbox.list(manager.token, { status: 'CLOSED' })).items.length === 0);

          await fails(
            () =>
              inbox.setStatus(other.token, target.id, {
                expectedRowVersion: target.rowVersion,
                status: 'CALLED',
              }),
            'FORBIDDEN',
          );
          const called = await inbox.setStatus(manager.token, target.id, {
            expectedRowVersion: target.rowVersion,
            status: 'CALLED',
          });
          assert.equal(called.status, 'CALLED');
          assert.equal(called.rowVersion, target.rowVersion + 1);
          assert.ok(called.handledByName);
          // A stale version, a repeat and a backwards move are conflicts.
          await fails(
            () =>
              inbox.setStatus(manager.token, target.id, {
                expectedRowVersion: target.rowVersion,
                status: 'CLOSED',
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              inbox.setStatus(manager.token, target.id, {
                expectedRowVersion: called.rowVersion,
                status: 'CALLED',
              }),
            'CONFLICT',
          );
          const closed = await inbox.setStatus(manager.token, target.id, {
            expectedRowVersion: called.rowVersion,
            status: 'CLOSED',
          });
          assert.equal(closed.status, 'CLOSED');
          assert.ok(closed.closedAt);
          await fails(
            () =>
              inbox.setStatus(manager.token, target.id, {
                expectedRowVersion: closed.rowVersion,
                status: 'CALLED',
              }),
            'CONFLICT',
          );
          await fails(
            () =>
              inbox.setStatus(manager.token, 'not-an-id', {
                expectedRowVersion: 1,
                status: 'CALLED',
              }),
            'NOT_FOUND',
          );
          await fails(
            () =>
              inbox.setStatus(manager.token, target.id, {
                expectedRowVersion: 0,
                status: 'CALLED',
              }),
            'VALIDATION_FAILED',
            'expectedRowVersion',
          );
          // A NEW request may be closed directly.
          const another = (await inbox.list(manager.token, { status: 'NEW' })).items[0]!;
          assert.equal(
            (
              await inbox.setStatus(manager.token, another.id, {
                expectedRowVersion: another.rowVersion,
                status: 'CLOSED',
              })
            ).status,
            'CLOSED',
          );
          const events = await audit('CHAT_REQUEST_UPDATED');
          assert.equal(events.length, 3);
          assert.ok(!JSON.stringify(events).includes('90512'), 'the audit keeps no phone number');
          assert.deepEqual(
            events.map((event) => (event.after as Record<string, unknown>)['status']).sort(),
            ['CALLED', 'CLOSED', 'CLOSED'],
          );
        },
      );
    });
  },
);
