import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ClaudeClient, FakeAnthropic, runAiRetention, type FakeReply } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { BriefService } from './brief.service.js';

/**
 * Claude integration Wave D (CI-S2 and CI-S3) against real PostgreSQL and a fake Anthropic server: the customer summary and the product
 * talking points for the staff member serving a visit. The relationship is the rule (the assigned person, the permission at the branch, the
 * visit open and not earlier than two hours before the start), the facts come from code, the model sees an anonymous "khách" and notes without
 * contacts, results are checked and cached until 7 days after the service, every view is audited, and everything is off by default.
 */
const DAY = 86_400_000;
const answer = (summary: string): FakeReply => ({
  kind: 'message',
  text: JSON.stringify({ summary }),
  usage: { input: 900, output: 80 },
});
const picks = (...entries: { product_id: string; line: string }[]): FakeReply => ({
  kind: 'message',
  text: JSON.stringify({ picks: entries }),
  usage: { input: 1200, output: 120 },
});

test(
  'Claude integration Wave D brief: access, off by default, facts, notes summary, talking points, cache, audit, retention; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const fake = new FakeAnthropic();
    const baseUrl = await fake.start();
    try {
      await phase6Fixture(async (base) => {
        const { tx, fails, run } = base;
        // The sale kit brings two branches and the receipt workflow (stock changes only through a movement).
        const sale = await productSaleKit(base);
        const branch = sale.A;
        const otherBranch = sale.B;
        const ktv = await base.staff(['VIEW_CUSTOMER_BRIEF'], { branchId: branch.id });
        const colleague = await base.staff(['VIEW_CUSTOMER_BRIEF'], { branchId: branch.id });
        const noRight = await base.staff([], { branchId: branch.id, member: [branch.id] });
        const wrongBranch = await base.staff(['VIEW_CUSTOMER_BRIEF'], { branchId: otherBranch.id });
        const client = new ClaudeClient({ apiKey: 'sk-ant-test-key-never-real', baseUrl });
        const service = new BriefService(base.adapter, base.throttle).use({ client });
        const settings = (assignments: string) =>
          tx.$executeRawUnsafe(
            `UPDATE ai_settings SET ${assignments}, row_version = row_version + 1 WHERE id = 1`,
          );
        const rows = <T>(sql: string, ...values: unknown[]) =>
          tx.$queryRawUnsafe<T[]>(sql, ...values);
        const audit = () =>
          tx.auditEvent.findMany({
            where: { action: 'CUSTOMER_BRIEF_VIEWED', actorUserId: ktv.id },
          });

        const category = await tx.serviceCategory.create({
          data: { code: `BR_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
        });
        const makeService = (key: string) =>
          tx.service.create({
            data: {
              code: `BR_${key}_${run}`,
              categoryId: category.id,
              nameVi: `Dịch vụ ${key}`,
              nameEn: `Service ${key}`,
              priceVnd: 200_000n,
              priceMaxVnd: 200_000n,
              pricingUnit: 'PER_SERVICE',
              maxQuantity: 1,
              durationMinutes: 60,
              estimatedMinMinutes: 60,
              estimatedMaxMinutes: 60,
            },
          });
        const massage = await makeService('MASSAGE');
        const hair = await makeService('GOIDAU');
        const customer = await tx.user.create({
          data: {
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: `Nguyễn Thị Khách ${run}`,
            preferredLocale: 'vi',
            emailCanonical: `brief-${run.toLowerCase()}@example.com`,
            emailDelivery: `brief-${run.toLowerCase()}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: '+84905123456',
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
            },
          },
        });

        let visitNo = 0;
        /** A visit of the customer (or a guest) with one line per service for the person; `done` makes it a completed one. */
        const visit = async (options: {
          when: Date;
          services: { id: string; code: string; nameVi: string; nameEn: string }[];
          by: string;
          done: boolean;
          note?: string | null;
          guest?: boolean;
          plannedStart?: Date;
        }) => {
          visitNo += 1;
          const day = new Date(
            Date.UTC(
              options.when.getUTCFullYear(),
              options.when.getUTCMonth(),
              options.when.getUTCDate(),
            ),
          );
          const created = await tx.visit.create({
            data: {
              code: `VS-BR-${run}-${visitNo}`,
              branchId: branch.id,
              origin: 'WALK_IN',
              serviceDate: day,
              arrivedAt: options.when,
              createdByUserId: ktv.id,
              idempotencyKey: randomUUID(),
            },
          });
          const participant = await tx.visitParticipant.create({
            data: options.guest
              ? { visitId: created.id, kind: 'GUEST', displayName: 'Khách lẻ' }
              : {
                  visitId: created.id,
                  kind: 'MEMBER',
                  customerUserId: customer.id,
                  note: options.note ?? null,
                },
          });
          const lines: string[] = [];
          for (const [index, svc] of options.services.entries()) {
            const start = new Date(
              (options.plannedStart ?? options.when).getTime() + index * 60 * 60_000,
            );
            const line = await tx.visitServiceLine.create({
              data: {
                visitId: created.id,
                participantId: participant.id,
                sequence: index + 1,
                serviceId: svc.id,
                employeeUserId: options.by,
                assignmentMode: 'ANY',
                plannedStartAt: start,
                plannedEndAt: new Date(start.getTime() + 60 * 60_000),
                durationMinutes: 60,
                bufferMinutes: 0,
                serviceCode: svc.code,
                serviceNameVi: svc.nameVi,
                serviceNameEn: svc.nameEn,
                catalogPriceMinVnd: 200_000n,
                catalogPriceMaxVnd: 200_000n,
                catalogPricingUnit: 'PER_SERVICE',
                maxQuantitySnapshot: 1,
              },
            });
            lines.push(line.id);
          }
          if (options.done) {
            for (const id of lines) {
              await tx.visitServiceLine.update({
                where: { id },
                data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
              });
              await tx.visitServiceLine.update({
                where: { id },
                data: { status: 'DONE', rowVersion: { increment: 1 } },
              });
            }
            await tx.visit.update({
              where: { id: created.id },
              data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
            });
            await tx.visit.update({
              where: { id: created.id },
              data: {
                status: 'COMPLETED',
                completedAt: options.when,
                rowVersion: { increment: 1 },
              },
            });
          }
          return { visitId: created.id, participantId: participant.id, lineId: lines[0]! };
        };

        const now = new Date();
        // History: two completed visits at this branch (30 and 14 days ago), notes on the first, served by the colleague.
        await visit({
          when: new Date(now.getTime() - 30 * DAY),
          services: [massage, hair],
          by: colleague.id,
          done: true,
          note: 'Khách thích massage nhẹ, hay đau vai. Gọi 0905 123 456 khi có ưu đãi.',
        });
        await visit({
          when: new Date(now.getTime() - 14 * DAY),
          services: [massage],
          by: colleague.id,
          done: true,
        });
        // Today's visit: open, the ktv serves the customer.
        const current = await visit({
          when: new Date(now.getTime() - 20 * 60_000),
          services: [massage],
          by: ktv.id,
          done: false,
        });

        await suite.test(
          'the relationship is the rule: only the assigned person, with the permission at the branch, while the visit is open',
          async () => {
            await fails(() => service.brief(undefined, current.lineId), 'AUTHENTICATION_REQUIRED');
            await fails(() => service.brief(colleague.token, current.lineId), 'NOT_FOUND');
            await fails(() => service.brief(ktv.token, 'not-an-id'), 'NOT_FOUND');
            await fails(() => service.brief(ktv.token, randomUUID()), 'NOT_FOUND');
            const unassigned = await visit({
              when: new Date(now.getTime() - 10 * 60_000),
              services: [massage],
              by: noRight.id,
              done: false,
            });
            await fails(() => service.brief(noRight.token, unassigned.lineId), 'FORBIDDEN');
            const other = await visit({
              when: new Date(now.getTime() - 10 * 60_000),
              services: [massage],
              by: wrongBranch.id,
              done: false,
            });
            await fails(() => service.brief(wrongBranch.token, other.lineId), 'FORBIDDEN');
            // Too early (more than two hours before the planned start) and after the visit.
            const early = await visit({
              when: new Date(now.getTime() - 10 * 60_000),
              plannedStart: new Date(now.getTime() + 3 * 3_600_000),
              services: [massage],
              by: ktv.id,
              done: false,
            });
            await fails(() => service.brief(ktv.token, early.lineId), 'FORBIDDEN');
            const finished = await visit({
              when: new Date(now.getTime() - 5 * DAY),
              services: [massage],
              by: ktv.id,
              done: true,
              guest: true,
            });
            await fails(() => service.brief(ktv.token, finished.lineId), 'FORBIDDEN');
            assert.equal((await audit()).length, 0, 'a refused view writes no view event');
          },
        );

        await suite.test(
          'off by default: nothing is shown or called; the view is still audited',
          async () => {
            const result = await service.brief(ktv.token, current.lineId);
            assert.deepEqual(result, {
              available: false,
              block: 'AI_OFF',
              facts: null,
              summary: null,
              summaryStatus: 'NONE',
            });
            assert.equal((await service.suggestions(ktv.token, current.lineId)).available, false);
            assert.equal(fake.requests.length, 0);
            assert.equal((await audit()).length, 2);
            await settings(
              `enabled = true, brief_enabled = true, brief_model = 'claude-sonnet-5-5', vnd_per_usd = 26000, monthly_cap_vnd = 3000000, feature_caps_vnd = '{}'::jsonb`,
            );
          },
        );

        await suite.test(
          'the facts come from code: usual services, visits, last visit, last staff member, the gap between visits',
          async () => {
            fake.enqueue(answer('Khách thích massage nhẹ và hay đau vai.'));
            const result = await service.brief(ktv.token, current.lineId);
            assert.equal(result.available, true);
            const facts = result.facts!;
            assert.equal(facts.known, true);
            assert.equal(facts.visits, 2);
            assert.equal(facts.usualServices[0]!.name, 'Dịch vụ MASSAGE');
            assert.equal(facts.usualServices[0]!.times, 2);
            assert.equal(
              facts.lastKtvName,
              (await tx.user.findUniqueOrThrow({ where: { id: colleague.id } })).fullName,
            );
            assert.equal(facts.averageGapDays, 16);
            assert.equal(facts.notes, 1);
            assert.equal(
              facts.lastVisitDate,
              new Date(now.getTime() - 14 * DAY).toISOString().slice(0, 10),
            );
            assert.ok(
              !JSON.stringify(result).includes(customer.fullName),
              'the customer’s name is never in the brief',
            );
          },
        );

        await suite.test(
          'the summary: the model sees an anonymous "khách" and notes without contacts; the checked result is cached and billed once',
          async () => {
            const sent = JSON.stringify(fake.requests[0]!.body);
            assert.match(sent, /Customer: khách/);
            assert.match(sent, /massage nhẹ/);
            assert.doesNotMatch(sent, /0905|Nguyễn Thị|@example/);
            const [ledger] = await rows<{ n: bigint }>(
              `SELECT count(*) AS n FROM ai_usage_ledger WHERE feature = 'BRIEF' AND outcome = 'SUCCEEDED'`,
            );
            assert.equal(ledger!.n >= 1n, true);
            const [cached] = await rows<{ payload: { summary: string }; expires_at: Date }>(
              `SELECT payload, expires_at FROM ai_customer_briefs WHERE visit_id = $1::uuid AND kind = 'BRIEF'`,
              current.visitId,
            );
            assert.equal(cached!.payload.summary, 'Khách thích massage nhẹ và hay đau vai.');
            assert.ok(cached!.expires_at.getTime() > now.getTime() + 7 * DAY);
            const before = fake.requests.length;
            const again = await service.brief(ktv.token, current.lineId);
            assert.equal(again.summary, 'Khách thích massage nhẹ và hay đau vai.');
            assert.equal(again.summaryStatus, 'READY');
            assert.equal(
              fake.requests.length,
              before,
              'the cached summary is served without a call',
            );
            // A new note changes the input, so the summary is made again.
            await visit({
              when: new Date(now.getTime() - 3 * DAY),
              services: [massage],
              by: colleague.id,
              done: true,
              note: 'Hôm nay muốn nước ấm hơn.',
            });
            fake.enqueue(answer('Khách thích massage nhẹ, hay đau vai và muốn nước ấm.'));
            const refreshed = await service.brief(ktv.token, current.lineId);
            assert.match(refreshed.summary ?? '', /nước ấm/);
            assert.equal(fake.requests.length, before + 1);
          },
        );

        await suite.test(
          'a summary that adds something is dropped and never cached; a failed call shows the facts only',
          async () => {
            await visit({
              when: new Date(now.getTime() - 2 * DAY),
              services: [massage],
              by: colleague.id,
              done: true,
              note: 'Thích nhạc nhẹ.',
            });
            fake.enqueue(answer('Khách bị eczema và đã đến 9 lần.'));
            const dropped = await service.brief(ktv.token, current.lineId);
            assert.equal(dropped.summary, null);
            assert.equal(dropped.summaryStatus, 'UNAVAILABLE');
            assert.ok(dropped.facts!.visits >= 2, 'the facts are still shown');
            fake.fallback = { kind: 'error', status: 500, type: 'api_error' };
            await visit({
              when: new Date(now.getTime() - 1 * DAY),
              services: [massage],
              by: colleague.id,
              done: true,
              note: 'Thích hương lavender.',
            });
            const failed = await service.brief(ktv.token, current.lineId);
            assert.equal(failed.summaryStatus, 'UNAVAILABLE');
            fake.fallback = null;
            const [holds] = await rows<{ n: bigint }>(
              `SELECT count(*) AS n FROM ai_reservations WHERE feature = 'BRIEF'`,
            );
            assert.equal(holds!.n, 0n, 'no hold is left behind');
          },
        );

        await suite.test(
          'talking points: only candidates chosen by code can be picked; an unchecked line is dropped; the result is cached',
          async () => {
            const none = await service.suggestions(ktv.token, current.lineId);
            assert.deepEqual(none, { available: true, block: null, items: [], status: 'NONE' });
            /** A published product with one priced variant and an approved description. */
            const publish = async (
              label: string,
              nameVi: string,
              sections: Record<string, string>,
            ) => {
              const product = await sale.product(label, [350_000]);
              await tx.product.update({
                where: { id: product.id },
                data: { nameVi, descriptionSectionsVi: sections, rowVersion: { increment: 1 } },
              });
              return product;
            };
            const created = await publish('brief1', 'Kem dưỡng ẩm thử', {
              benefits: 'Cấp nước cho da khô.',
              suitableFor: 'Da khô.',
            });
            await sale.receive(created.variants[0]!.id, 5, branch.id);
            await publish('brief2', 'Sản phẩm chưa có hàng', { benefits: 'Làm sáng da.' });
            fake.enqueue(
              picks(
                { product_id: created.id, line: 'Cấp nước cho da khô, hợp sau bước làm sạch.' },
                { product_id: randomUUID(), line: 'Sản phẩm không có trong danh sách.' },
              ),
            );
            const before = fake.requests.length;
            const result = await service.suggestions(ktv.token, current.lineId);
            assert.equal(result.status, 'READY');
            assert.deepEqual(result.items, [
              {
                productId: created.id,
                name: 'Kem dưỡng ẩm thử',
                line: 'Cấp nước cho da khô, hợp sau bước làm sạch.',
              },
            ]);
            const sent = JSON.stringify(fake.requests[before]!.body);
            assert.match(sent, new RegExp(created.id));
            assert.doesNotMatch(
              sent,
              /Sản phẩm chưa có hàng/,
              'a product with no stock at the branch is not a candidate',
            );
            assert.doesNotMatch(sent, /Nguyễn Thị|0905/);
            const again = await service.suggestions(ktv.token, current.lineId);
            assert.equal(again.items.length, 1);
            assert.equal(
              fake.requests.length,
              before + 1,
              'the cached points are served without a call',
            );
            // A line with a price in it is dropped (the number is not in the product's description).
            await tx.$executeRawUnsafe(
              `DELETE FROM ai_customer_briefs WHERE visit_id = $1::uuid`,
              current.visitId,
            );
            fake.enqueue(
              picks({ product_id: created.id, line: 'Chỉ 299.000 đ hôm nay, giảm 20%.' }),
            );
            const priced = await service.suggestions(ktv.token, current.lineId);
            assert.deepEqual(priced.items, []);
            assert.equal(priced.status, 'NONE');
          },
        );

        await suite.test(
          'every view is audited, a cached result is kept until 7 days after the service and then deleted by the worker',
          async () => {
            const events = await audit();
            assert.ok(events.length >= 6);
            for (const event of events) {
              const wire = JSON.stringify(event.after);
              assert.doesNotMatch(wire, /massage|eczema|Kem/, 'an event holds no content');
            }
            await tx.$executeRawUnsafe(
              `UPDATE ai_customer_briefs SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day' WHERE visit_id = $1::uuid`,
              current.visitId,
            );
            const cleared = await runAiRetention(tx);
            assert.ok(cleared.briefsDeleted >= 1);
            const [left] = await rows<{ n: bigint }>(
              `SELECT count(*) AS n FROM ai_customer_briefs WHERE visit_id = $1::uuid`,
              current.visitId,
            );
            assert.equal(left!.n, 0n);
          },
        );
      });
    } finally {
      await fake.stop();
    }
  },
);
