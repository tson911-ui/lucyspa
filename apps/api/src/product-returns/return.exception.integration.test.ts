import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LocalDiskMediaStorage } from '@lucy-spa/server';
import { pino } from 'pino';
import sharp from 'sharp';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { ProductReturnService } from './return.service.js';

/**
 * Phase 6 P6-12 follow-up (Owner, 2026-10-08) against real PostgreSQL: "the Owner (only the Owner) may approve a return outside the time
 * window as an exception, with a mandatory written reason, recorded in the case history and audit log". The rule of P6-12 that no one
 * could open a case after its window changes for the Owner alone; for everyone else, and for the Owner without a reason, it stands.
 * Every fixture rolls back.
 */
test(
  'Phase 6 P6-12 window exception: only the Owner, a written reason, in the history and the audit log; everyone else is still refused',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-return-exception-'));
    try {
      await phase6Fixture(async (base) => {
        const k = await productSaleKit(base);
        const { tx, fails } = base;
        const { A, invoices, people } = k;
        const returns = new ProductReturnService(
          base.adapter,
          base.throttle,
          new LocalDiskMediaStorage(folder),
          pino({ level: 'silent' }),
        );
        const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
        const senior = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
        const both = await base.staff(['MANAGE_PRODUCT_RETURNS', 'REFUND_PRODUCTS'], {
          branchId: A.id,
        });
        const owner = people.owner;

        let saleNo = 0;
        const sale = async (quantity = 3) => {
          saleNo += 1;
          const product = await k.product(`rex${saleNo}`, [100_000]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, quantity + 5);
          const invoice = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity),
          );
          await k.pay(invoice.id, Number(invoice.totalVnd));
          const view = await invoices.get(people.cashier.token, invoice.id);
          return { invoiceId: invoice.id, code: invoice.code, lineId: view.productLines[0]!.id };
        };
        const aged = async (invoiceId: string, interval: string) => {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE invoices SET created_at = LEAST(created_at, clock_timestamp() - interval '${interval}'), finalized_at = LEAST(finalized_at, clock_timestamp() - interval '${interval}'), paid_at = clock_timestamp() - interval '${interval}' WHERE id = '${invoiceId}'`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        };
        type Reason = 'PERSONAL_PREFERENCE' | 'WRONG_OR_DAMAGED' | 'SKIN_IRRITATION';
        const open = (
          actor: { token: string },
          line: { lineId: string },
          overrides: Partial<{
            reason: Reason;
            quantity: number;
            sealIntact: boolean | null;
            windowExceptionReason: string | null;
          }> = {},
        ) =>
          k.ok(() =>
            returns.open(actor.token, {
              branchId: A.id,
              invoiceLineId: line.lineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'REFUND',
              quantity: 1,
              sealIntact: true,
              notes: 'Khách đổi ý',
              clientRequestId: randomUUID(),
              ...overrides,
            }),
          );
        const png = (color: string) =>
          sharp({ create: { width: 24, height: 16, channels: 3, background: color } })
            .png()
            .toBuffer();
        const eventKinds = async (caseId: string) =>
          (
            await tx.productReturnEvent.findMany({
              where: { caseId },
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              select: { kind: true },
            })
          ).map((event) => event.kind);
        const REASON = 'Khách ở xa, về nước muộn một tuần; Chủ đồng ý nhận lại';

        await suite.test(
          'the Owner opens a personal-preference case after the 168 hours with a reason: it is on the case, in its history and in the audit log',
          async () => {
            const s = await sale();
            await aged(s.invoiceId, '168 hours 1 minute');
            const lookup = (await returns.lookup(owner.token, A.id, s.code)).lines[0]!;
            assert.equal(
              lookup.reasons.PERSONAL_PREFERENCE.open,
              false,
              'the window is still over',
            );
            const c = await open(owner, s, { windowExceptionReason: `  ${REASON}  ` });
            assert.equal(c.status, 'OPEN');
            assert.equal(c.windowException?.reason, REASON);
            assert.equal(c.windowException?.byName, c.openedByName);
            assert.ok(c.windowException?.at);
            // The window itself is unchanged: the exception records that it was over, it does not move it.
            assert.equal(
              new Date(c.windowEndsAt!).getTime() - new Date(c.handoverAt).getTime(),
              168 * 3_600_000,
            );
            assert.ok(
              new Date(c.windowException!.at).getTime() > new Date(c.windowEndsAt!).getTime(),
            );
            assert.deepEqual(await eventKinds(c.id), ['OPENED', 'WINDOW_EXCEPTION']);
            const event = c.events.find((entry) => entry.kind === 'WINDOW_EXCEPTION')!;
            assert.equal(event.note, REASON);
            const audit = await tx.auditEvent.findMany({
              where: { entityId: c.id, action: 'PRODUCT_RETURN_WINDOW_EXCEPTION' },
            });
            assert.equal(audit.length, 1);
            assert.equal(audit[0]!.reason, REASON);
            assert.equal(audit[0]!.dataClassification, 'FINANCIAL');
            assert.equal(audit[0]!.actorUserId, owner.id);
            // Every other rule still holds: the seal must be intact, the units are counted.
            await fails(
              () => open(owner, s, { sealIntact: false, windowExceptionReason: REASON }),
              'RETURN_SEAL_REQUIRED',
              'sealIntact',
            );
            await fails(
              () => open(owner, s, { quantity: 3, windowExceptionReason: REASON }),
              'RETURN_QUANTITY_EXCEEDED',
              'quantity',
            );
            const again = await returns.get(owner.token, c.id);
            assert.equal(again.windowException?.reason, REASON);
          },
        );

        await suite.test(
          'wrong or damaged after 48 hours is the same exception, and it can be accepted with a photo taken now',
          async () => {
            const s = await sale();
            await aged(s.invoiceId, '49 hours');
            const c = await open(owner, s, {
              reason: 'WRONG_OR_DAMAGED',
              sealIntact: false,
              windowExceptionReason: REASON,
            });
            assert.equal(c.windowException?.reason, REASON);
            // Without a photo it cannot be accepted, exactly as before.
            await fails(
              () =>
                returns.accept(owner.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'REFUND',
                  note: null,
                }),
              'RETURN_PHOTO_REQUIRED',
            );
            // A photo is dated now, long after the window: under an exception it counts (a normal case would refuse it).
            const withPhoto = await k.ok(async () =>
              returns.uploadPhoto(clerk.token, c.id, {
                buffer: await png('#336699'),
                originalname: 'anh.png',
              }),
            );
            const accepted = await k.ok(() =>
              returns.accept(owner.token, c.id, {
                expectedRowVersion: withPhoto.rowVersion,
                outcome: 'REFUND',
                note: 'Chủ đồng ý ngoại lệ',
              }),
            );
            assert.equal(accepted.status, 'ACCEPTED');
            assert.equal(accepted.decidedOutcome, 'REFUND');
            // The Owner removes the photo on a customer request: the requirement is unmet again for a new case.
            const s2 = await sale();
            await aged(s2.invoiceId, '49 hours');
            const c2 = await open(owner, s2, {
              reason: 'WRONG_OR_DAMAGED',
              sealIntact: false,
              windowExceptionReason: REASON,
            });
            const p2 = await k.ok(async () =>
              returns.uploadPhoto(clerk.token, c2.id, {
                buffer: await png('#996633'),
                originalname: 'anh.png',
              }),
            );
            await k.ok(() =>
              returns.removePhoto(owner.token, c2.id, p2.photos[0]!.id, { note: 'Khách yêu cầu' }),
            );
            const latest = await returns.get(owner.token, c2.id);
            await fails(
              () =>
                returns.accept(owner.token, c2.id, {
                  expectedRowVersion: latest.rowVersion,
                  outcome: 'REFUND',
                  note: null,
                }),
              'RETURN_PHOTO_REQUIRED',
            );
          },
        );

        await suite.test(
          'nobody but the Owner can use the exception, and the Owner needs a reason; no reason is accepted where none is needed',
          async () => {
            const s = await sale();
            await aged(s.invoiceId, '400 hours');
            const before = await tx.productReturnCase.count({ where: { invoiceLineId: s.lineId } });
            for (const actor of [clerk, senior, both]) {
              await fails(() => open(actor, s, { windowExceptionReason: REASON }), 'FORBIDDEN');
            }
            // Without a reason the window is still final for everybody, the Owner included.
            await fails(() => open(clerk, s), 'RETURN_WINDOW_EXPIRED', 'reason');
            await fails(() => open(both, s), 'RETURN_WINDOW_EXPIRED', 'reason');
            await fails(() => open(owner, s), 'RETURN_WINDOW_EXPIRED', 'reason');
            // A blank reason is not a reason.
            for (const blank of ['', '   ', '\n']) {
              await fails(
                () => open(owner, s, { windowExceptionReason: blank }),
                'VALIDATION_FAILED',
                'windowExceptionReason',
              );
            }
            assert.equal(
              await tx.productReturnCase.count({ where: { invoiceLineId: s.lineId } }),
              before,
            );
            // A reason where the window is open (or there is none) is refused: the record never claims an exception that was not one.
            const fresh = await sale();
            await fails(
              () => open(owner, fresh, { windowExceptionReason: REASON }),
              'VALIDATION_FAILED',
              'windowExceptionReason',
            );
            await fails(
              () =>
                open(owner, s, {
                  reason: 'SKIN_IRRITATION',
                  sealIntact: null,
                  windowExceptionReason: REASON,
                }),
              'VALIDATION_FAILED',
              'windowExceptionReason',
            );
            assert.equal(
              await tx.productReturnCase.count({ where: { invoiceLineId: fresh.lineId } }),
              0,
            );
          },
        );

        await suite.test(
          'the exception is idempotent: the same request returns the same case and writes one history line and one audit row',
          async () => {
            const s = await sale();
            await aged(s.invoiceId, '200 hours');
            const clientRequestId = randomUUID();
            const request = {
              branchId: A.id,
              invoiceLineId: s.lineId,
              reason: 'PERSONAL_PREFERENCE' as const,
              requestedOutcome: 'REFUND' as const,
              quantity: 1,
              sealIntact: true,
              notes: null,
              clientRequestId,
              windowExceptionReason: REASON,
            };
            const first = await k.ok(() => returns.open(owner.token, request));
            const second = await k.ok(() => returns.open(owner.token, request));
            assert.equal(second.id, first.id);
            assert.deepEqual(await eventKinds(first.id), ['OPENED', 'WINDOW_EXCEPTION']);
            assert.equal(
              await tx.auditEvent.count({
                where: { entityId: first.id, action: 'PRODUCT_RETURN_WINDOW_EXCEPTION' },
              }),
              1,
            );
          },
        );

        await suite.test(
          'the database is the backstop: only the Owner account, only after the window, and always with its history line',
          async () => {
            const s = await sale();
            await aged(s.invoiceId, '300 hours');
            const c = await open(owner, s, { windowExceptionReason: REASON });
            const raw = async (sql: string, settle = false) => {
              await tx.$executeRawUnsafe('SAVEPOINT guard');
              try {
                await tx.$executeRawUnsafe(sql);
                if (settle) await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
              } catch (error) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
                return error;
              }
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
              return null;
            };
            const refuses = async (sql: string, why: RegExp, settle = false) => {
              const error = await raw(sql, settle);
              assert.ok(error, `must be refused: ${sql}`);
              assert.match(String((error as Error).message), why);
            };
            const insert = (opener: string, reason: string, windowEnd: string, extra: string) =>
              `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity, seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id, window_exception_by_user_id, window_exception_reason)
               SELECT 'TH-E${randomUUID().slice(0, 6)}', branch_id, invoice_id, invoice_line_id, '${reason}', 'REFUND', 1, true, handover_at, paid_seq, ${windowEnd}, '${opener}', gen_random_uuid() ${extra} FROM product_return_cases WHERE id = '${c.id}'`;
            const week = "handover_at + interval '168 hours'";
            const grant = (id: string) => `, '${id}', 'lý do'`;
            // A clerk as the grantor: refused (not the Owner account).
            await refuses(
              insert(clerk.id, 'PERSONAL_PREFERENCE', week, grant(clerk.id)),
              /Only the Owner may approve a return outside its window/,
            );
            // The grantor must also be the opener.
            await refuses(
              insert(clerk.id, 'PERSONAL_PREFERENCE', week, grant(owner.id)),
              /product_return_cases_window_exception/,
            );
            // A blank reason is refused by the CHECK.
            await refuses(
              insert(owner.id, 'PERSONAL_PREFERENCE', week, `, '${owner.id}', '   '`),
              /product_return_cases_window_exception/,
            );
            // A skin-irritation case has no window, so there is nothing to make an exception to.
            await refuses(
              insert(owner.id, 'SKIN_IRRITATION', 'NULL', grant(owner.id)),
              /An exception is only for a return after its window/,
            );
            // The Owner's insert is accepted only with its WINDOW_EXCEPTION history line by commit.
            await refuses(
              insert(owner.id, 'PERSONAL_PREFERENCE', week, grant(owner.id)),
              /A return window exception is recorded in the case history/,
              true,
            );
            // The exception columns are facts like the rest, and a second exception event is refused.
            await refuses(
              `UPDATE product_return_cases SET window_exception_reason = 'khác', row_version = row_version + 1 WHERE id = '${c.id}'`,
              /The facts of a return case never change/,
            );
            await refuses(
              `UPDATE product_return_cases SET window_exception_reason = NULL, window_exception_by_user_id = NULL, window_exception_at = NULL, row_version = row_version + 1 WHERE id = '${c.id}'`,
              /The facts of a return case never change/,
            );
            await refuses(
              `INSERT INTO product_return_events (case_id, kind, actor_user_id, note) VALUES ('${c.id}', 'WINDOW_EXCEPTION', '${owner.id}', 'lần hai')`,
              /product_return_events_exception_key/,
            );
            // A case without an exception cannot get an exception event.
            const inside = await sale();
            const normal = await open(clerk, inside);
            await refuses(
              `INSERT INTO product_return_events (case_id, kind, actor_user_id, note) VALUES ('${normal.id}', 'WINDOW_EXCEPTION', '${owner.id}', 'lý do')`,
              /The event does not match the state of the return case/,
            );
          },
        );
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
