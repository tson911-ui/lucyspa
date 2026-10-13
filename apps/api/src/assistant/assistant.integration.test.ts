import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSISTANT_LIMITS, type ReportRegistryResponse } from '@lucy-spa/contracts';
import {
  ClaudeClient,
  FakeAnthropic,
  UNSURE_ANSWER,
  runAiRetention,
  type FakeReply,
} from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { AuthError } from '../auth/auth.error.js';
import { AssistantService } from './assistant.service.js';
import type { AssistantReports } from './assistant.tools.js';

/**
 * Claude integration Wave C (CI-S1) against real PostgreSQL and a fake Anthropic server (no test contacts Anthropic): the report assistant.
 * Authority and switches, the tool list cut to the reports the asker may open, tools run with the asker's token, the number check, the
 * money hold and the ledger, the question log with its 30-day text, the audit event without the text, the limits and the failure paths.
 * The report services are stubbed here (they have their own tests); the tool wrappers and projections have unit tests. Fixtures roll back.
 */
const BRANCH = { id: '00000000-0000-4000-8000-0000000000b1', code: 'DN1', name: 'Chi nhánh 1' };

const registry = (ids: string[]): ReportRegistryResponse =>
  ({
    generatedAt: '2026-10-13T00:00:00.000Z',
    branches: [BRANCH],
    reports: ids.map((id) => ({
      id,
      area: 'revenue',
      wave: 'A',
      available: true,
      exportable: false,
      exportReauth: false,
      branchIds: [BRANCH.id],
    })),
  }) as unknown as ReportRegistryResponse;

const PERIOD = {
  from: '2026-10-01',
  to: '2026-10-13',
  previous: { from: '2026-09-18', to: '2026-09-30' },
};
const REVENUE = {
  period: PERIOD,
  totals: { netVnd: '12500000', collectedVnd: '13000000', refundsVnd: '500000', exchangesVnd: '0' },
  previousTotals: { netVnd: '10000000' },
  paidInvoices: { count: 40, totalVnd: '13000000', averageVnd: '325000' },
  visits: 90,
  onlineHeldVnd: '0',
  byBranch: [{ branch: BRANCH, netVnd: '12500000', visits: 90, paidInvoices: 40 }],
  bySide: [],
  byKind: [{ key: 'SERVICE', netVnd: '12500000', shareBp: 10000 }],
  byChannel: [],
  byMethod: [],
};

const usage = { input: 3000, output: 400 };
const toolTurn = (
  input: Record<string, unknown> = { from: '2026-10-01', to: '2026-10-13', branch: null },
  name = 'revenue',
  id = 'toolu_1',
): FakeReply => ({ kind: 'message', text: '', toolUses: [{ id, name, input }], usage });
const answerTurn = (text: string, delayMs?: number): FakeReply => ({
  kind: 'message',
  text,
  usage: { input: 3500, output: 200 },
  ...(delayMs === undefined ? {} : { delayMs }),
});

test(
  'Claude integration Wave C assistant: authority, switches, filtered tools, number check, ledger and hold, question log, limits, failures; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const fake = new FakeAnthropic();
    const baseUrl = await fake.start();
    try {
      await phase6Fixture(async (base) => {
        const { tx, fails } = base;
        const asker = await base.staff([], { globalCodes: ['USE_AI_ASSISTANT'] });
        const other = await base.staff([], { globalCodes: ['USE_AI_ASSISTANT'] });
        const nobody = await base.staff([]);
        const calls: { name: string; token: string | undefined }[] = [];
        let open = ['revenue-overview', 'refunds'];
        const reports = {
          registry: async () => registry(open),
          revenue: async (token: string | undefined) => {
            calls.push({ name: 'revenue', token });
            return REVENUE;
          },
          refunds: async (token: string | undefined) => {
            calls.push({ name: 'refunds', token });
            throw new AuthError('FORBIDDEN');
          },
        } as unknown as AssistantReports;
        const client = new ClaudeClient({ apiKey: 'sk-ant-test-key-never-real', baseUrl });
        const service = new AssistantService(base.adapter, base.throttle, reports).use({
          client,
          now: () => new Date('2026-10-13T05:00:00.000Z'),
        });
        const settings = (assignments: string) =>
          tx.$executeRawUnsafe(
            `UPDATE ai_settings SET ${assignments}, row_version = row_version + 1 WHERE id = 1`,
          );
        const turnOn = () =>
          settings(
            `enabled = true, assistant_enabled = true, assistant_model = 'claude-sonnet-5-5', vnd_per_usd = 26000, monthly_cap_vnd = 3000000, feature_caps_vnd = '{}'::jsonb`,
          );
        const rows = <T>(sql: string, ...values: unknown[]) =>
          tx.$queryRawUnsafe<T[]>(sql, ...values);
        const reset = async () => {
          fake.requests.length = 0;
          fake.fallback = null;
          calls.length = 0;
          open = ['revenue-overview', 'refunds'];
        };
        const questions = (userId: string) =>
          rows<{
            status: string;
            question: string | null;
            answer: string | null;
            tools: { name: string; ok: boolean }[];
            requests: number;
            cost_micro_usd: bigint;
            error_code: string | null;
          }>(
            `SELECT status, question, answer, tools, requests, cost_micro_usd, error_code FROM ai_assistant_questions WHERE user_id = $1::uuid ORDER BY created_at, id`,
            userId,
          );
        const ledger = () =>
          rows<{ outcome: string; cost_micro_usd: bigint }>(
            `SELECT outcome, cost_micro_usd FROM ai_usage_ledger WHERE feature = 'ASSISTANT' ORDER BY occurred_at, id`,
          );
        const holds = async () =>
          Number(
            (
              await rows<{ n: bigint }>(
                `SELECT count(*) AS n FROM ai_reservations WHERE feature = 'ASSISTANT'`,
              )
            )[0]!.n,
          );
        await tx.$executeRawUnsafe(`DELETE FROM ai_reservations WHERE feature = 'ASSISTANT'`);

        await suite.test(
          'authority: only a holder of USE_AI_ASSISTANT; the box says why it cannot be used',
          async () => {
            await reset();
            await fails(() => service.status(undefined), 'AUTHENTICATION_REQUIRED');
            await fails(() => service.status(nobody.token), 'FORBIDDEN');
            await fails(() => service.ask(nobody.token, { question: 'Doanh thu?' }), 'FORBIDDEN');
            // Off by default, then one switch at a time.
            assert.deepEqual(await service.status(asker.token), {
              available: false,
              block: 'AI_OFF',
              leftThisHour: ASSISTANT_LIMITS.perHour,
            });
            await settings('enabled = true');
            assert.equal((await service.status(asker.token)).block, 'ASSISTANT_OFF');
            await settings('assistant_enabled = true');
            assert.equal((await service.status(asker.token)).block, 'NO_RATE');
            await settings('vnd_per_usd = 26000');
            assert.equal((await service.status(asker.token)).available, true);
            await settings('assistant_enabled = false');
            await fails(
              () => service.ask(asker.token, { question: 'Doanh thu?' }),
              'SERVICE_UNAVAILABLE',
            );
            assert.equal(fake.requests.length, 0, 'nothing was called while the box was off');
            assert.equal(await holds(), 0);
          },
        );

        await suite.test(
          'a good answer: tool run with the asker’s token, numbers checked, ledger row, hold released, question logged, audit without the text',
          async () => {
            await reset();
            await turnOn();
            fake.enqueue(
              toolTurn(),
              answerTurn(
                'Từ 2026-10-01 đến 2026-10-13, doanh thu ròng là 12.500.000 đ, tăng 25% so với kỳ trước, gồm 90 lượt đến.',
              ),
            );
            const result = await service.ask(asker.token, {
              question: '  Doanh thu 13 ngày qua thế nào?  ',
            });
            assert.equal(result.status, 'ANSWERED');
            assert.match(result.answer, /12\.500\.000/);
            assert.deepEqual(result.reports, ['revenue-overview']);
            assert.deepEqual(result.periods, [{ from: '2026-10-01', to: '2026-10-13' }]);
            assert.deepEqual(calls, [{ name: 'revenue', token: asker.token }]);
            // What was sent: Sonnet from the settings, only the tools of the open reports, today's date in the user turn, no web.
            const first = fake.requests[0]!.body;
            assert.equal(first['model'], 'claude-sonnet-5-5');
            assert.deepEqual(
              (first['tools'] as { name: string }[]).map((tool) => tool.name).sort(),
              ['refunds', 'revenue'],
            );
            assert.match(JSON.stringify(first['messages']), /2026-10-13/);
            assert.doesNotMatch(JSON.stringify(first['system']), /2026-10-13/);
            const [row] = await questions(asker.id);
            assert.equal(row!.status, 'ANSWERED');
            assert.equal(row!.question, 'Doanh thu 13 ngày qua thế nào?');
            assert.match(row!.answer ?? '', /12\.500\.000/);
            assert.deepEqual(
              row!.tools.map((tool) => [tool.name, tool.ok]),
              [['revenue', true]],
            );
            assert.equal(row!.requests, 2);
            const entries = await ledger();
            assert.equal(entries.length, 1);
            assert.equal(entries[0]!.outcome, 'SUCCEEDED');
            assert.equal(entries[0]!.cost_micro_usd, row!.cost_micro_usd);
            assert.ok(row!.cost_micro_usd > 0n);
            assert.equal(await holds(), 0);
            const events = await tx.auditEvent.findMany({
              where: { action: 'AI_ASSISTANT_QUESTION' },
            });
            assert.equal(events.length, 1);
            const wire = JSON.stringify(events[0]!.after);
            assert.doesNotMatch(
              wire,
              /Doanh thu|12\.500\.000/,
              'the audit event holds the tools and the cost, never the text',
            );
            assert.match(wire, /revenue/);
          },
        );

        await suite.test(
          'a number nobody returned: the answer is the fixed "not sure" sentence, the call is still billed and logged',
          async () => {
            await reset();
            fake.enqueue(toolTurn(), answerTurn('Doanh thu ròng là 12.600.000 đ.'));
            const result = await service.ask(asker.token, { question: 'Doanh thu?' });
            assert.equal(result.status, 'UNSURE');
            assert.equal(result.answer, UNSURE_ANSWER);
            assert.deepEqual(result.reports, ['revenue-overview']);
            const rowsNow = await questions(asker.id);
            const last = rowsNow.at(-1)!;
            assert.equal(last.status, 'UNSURE');
            assert.equal(last.error_code, 'NUMBERS');
            assert.equal(last.answer, UNSURE_ANSWER);
            assert.equal((await ledger()).length, 2);
            // Numbers from thin air with no tool at all are refused the same way; a sentence with no numbers is fine.
            await reset();
            fake.enqueue(answerTurn('Doanh thu tháng này khoảng 30.000.000 đ.'));
            assert.equal(
              (await service.ask(asker.token, { question: 'Doanh thu?' })).status,
              'UNSURE',
            );
            await reset();
            fake.enqueue(answerTurn('Mình chỉ trả lời được các câu hỏi về báo cáo của tiệm.'));
            assert.equal(
              (await service.ask(asker.token, { question: 'Hôm nay trời đẹp không?' })).status,
              'ANSWERED',
            );
          },
        );

        await suite.test(
          'only the reports the asker may open are offered; a tool not offered, bad arguments and a refused report are told to the model, never run wrongly',
          async () => {
            await reset();
            open = ['refunds'];
            fake.enqueue(
              toolTurn(undefined, 'revenue'),
              answerTurn('Mình không có số liệu doanh thu cho bạn.'),
            );
            const result = await service.ask(asker.token, { question: 'Doanh thu?' });
            assert.equal(result.status, 'ANSWERED');
            assert.deepEqual(
              (fake.requests[0]!.body['tools'] as { name: string }[]).map((tool) => tool.name),
              ['refunds'],
            );
            assert.equal(calls.length, 0, 'the revenue report was never read');
            assert.match(
              JSON.stringify(fake.requests[1]!.body['messages']),
              /not available to you/,
            );
            // Bad arguments (a date that does not exist, an unknown branch) and a report the service refuses.
            await reset();
            fake.enqueue(
              toolTurn({ from: '2026-02-31', to: '2026-03-02', branch: null }, 'refunds'),
              answerTurn('Mình chưa lấy được số liệu.'),
            );
            await service.ask(asker.token, { question: 'Hoàn tiền?' });
            assert.match(JSON.stringify(fake.requests[1]!.body['messages']), /Invalid arguments/);
            assert.equal(calls.length, 0);
            await reset();
            fake.enqueue(
              toolTurn({ from: '2026-10-01', to: '2026-10-13', branch: null }, 'refunds'),
              answerTurn('Mình không xem được báo cáo hoàn tiền.'),
            );
            assert.equal(
              (await service.ask(asker.token, { question: 'Hoàn tiền?' })).status,
              'ANSWERED',
            );
            assert.match(
              JSON.stringify(fake.requests[1]!.body['messages']),
              /not available to you/,
            );
            assert.deepEqual(
              calls.map((call) => call.name),
              ['refunds'],
            );
            // A person with no open report at all gets the fixed sentence without any call.
            await reset();
            open = [];
            const none = await service.ask(asker.token, { question: 'Doanh thu?' });
            assert.equal(none.status, 'UNSURE');
            assert.equal(fake.requests.length, 0);
          },
        );

        await suite.test(
          'the question is validated; one question at a time per person; the hour limit; the money cap',
          async () => {
            await reset();
            for (const bad of [
              '',
              '   ',
              'x'.repeat(ASSISTANT_LIMITS.questionMax + 1),
              'có \u0007 lạ',
              12 as unknown as string,
            ]) {
              await fails(
                () => service.ask(asker.token, { question: bad }),
                'VALIDATION_FAILED',
                'question',
              );
            }
            // A second question while one is running (the person is marked busy): refused, and its hold is released.
            const busy = Reflect.get(service, 'busy') as Set<string>;
            busy.add(other.id);
            const holdsBefore = await holds();
            await fails(() => service.ask(other.token, { question: 'Câu hai?' }), 'RATE_LIMITED');
            assert.equal(await holds(), holdsBefore);
            assert.equal(fake.requests.length, 0);
            busy.delete(other.id);
            // The hour limit counts the questions logged in the last hour.
            await tx.$executeRawUnsafe(
              `INSERT INTO ai_assistant_questions (user_id, status, question, model)
             SELECT $1::uuid, 'ANSWERED', 'cũ', 'claude-sonnet-5-5' FROM generate_series(1, $2::int)`,
              asker.id,
              ASSISTANT_LIMITS.perHour,
            );
            await fails(
              () => service.ask(asker.token, { question: 'Thêm một câu?' }),
              'RATE_LIMITED',
            );
            assert.equal((await service.status(asker.token)).leftThisHour, 0);
            // The shop's money cap: nothing is called when the hold is refused.
            await reset();
            await settings(`monthly_cap_vnd = 1000`);
            await fails(
              () => service.ask(other.token, { question: 'Doanh thu?' }),
              'SERVICE_UNAVAILABLE',
            );
            assert.equal(fake.requests.length, 0);
            assert.equal(await holds(), 0);
            await turnOn();
          },
        );

        await suite.test(
          'a failed call (the server errors) bills nothing, releases the hold, logs the question as failed and says the service is unavailable',
          async () => {
            await reset();
            fake.fallback = { kind: 'error', status: 500, type: 'api_error' };
            const ledgerBefore = (await ledger()).length;
            await fails(
              () => service.ask(other.token, { question: 'Doanh thu?' }),
              'SERVICE_UNAVAILABLE',
            );
            assert.equal((await ledger()).length, ledgerBefore);
            assert.equal(await holds(), 0);
            const last = (await questions(other.id)).at(-1)!;
            assert.equal(last.status, 'FAILED');
            assert.equal(last.answer, null);
            assert.equal(last.cost_micro_usd, 0n);
            fake.fallback = null;
            await reset();
            fake.enqueue({
              kind: 'message',
              text: '',
              stopReason: 'refusal',
              usage: { input: 900, output: 5 },
            });
            const refused = await service.ask(other.token, { question: 'Doanh thu?' });
            assert.equal(refused.status, 'UNSURE');
            assert.equal((await ledger()).at(-1)!.outcome, 'REFUSED');
            assert.equal((await questions(other.id)).at(-1)!.status, 'REFUSED');
          },
        );

        await suite.test(
          'at most six tool calls: a seventh ends the question as not sure',
          async () => {
            await reset();
            fake.enqueue(
              ...Array.from({ length: ASSISTANT_LIMITS.toolCalls + 1 }, (_, n) =>
                toolTurn(undefined, 'revenue', `toolu_${n}`),
              ),
            );
            const result = await service.ask(other.token, { question: 'Doanh thu nhiều lần?' });
            assert.equal(result.status, 'UNSURE');
            assert.equal(calls.length, ASSISTANT_LIMITS.toolCalls);
            assert.equal((await questions(other.id)).at(-1)!.error_code, 'TOO_MANY_TOOLS');
          },
        );

        await suite.test(
          'the question and the answer are kept 30 days, then only the text is cleared; the row, the cost and the tools stay; a row is never deleted',
          async () => {
            const [old] = await rows<{ id: string }>(
              `INSERT INTO ai_assistant_questions (user_id, status, question, answer, model, cost_micro_usd, created_at)
             VALUES ($1::uuid, 'ANSWERED', 'cũ', 'trả lời cũ', 'claude-sonnet-5-5', 5000, now() - interval '31 days') RETURNING id`,
              asker.id,
            );
            const cleared = await runAiRetention(tx);
            assert.ok(cleared.assistantTextsCleared >= 1);
            const [after] = await rows<{
              question: string | null;
              answer: string | null;
              purged_at: Date | null;
              cost_micro_usd: bigint;
            }>(
              `SELECT question, answer, purged_at, cost_micro_usd FROM ai_assistant_questions WHERE id = $1::uuid`,
              old!.id,
            );
            assert.equal(after!.question, null);
            assert.equal(after!.answer, null);
            assert.ok(after!.purged_at);
            assert.equal(after!.cost_micro_usd, 5000n);
            // Recent text stays; the rows cannot be deleted or edited in any other way.
            const recent = (await questions(asker.id)).find(
              (row) => row.question === 'Doanh thu 13 ngày qua thế nào?',
            );
            assert.ok(recent, 'today’s question is kept');
          },
        );
      });
    } finally {
      await fake.stop();
    }
  },
);
