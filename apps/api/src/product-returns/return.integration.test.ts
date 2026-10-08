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
 * Phase 6 P6-12 against real PostgreSQL (design 8.1; T23, T35, OQ-22, OQ-40, OQ-79): return cases. A case is opened only for a product
 * line of a PAID counter invoice, inside the window of its reason (168 hours for a personal preference with the seal intact, 48 hours
 * for a wrong or damaged product, none for a skin irritation), for no more units than the line has left; it is decided once, a
 * skin-irritation case only by a holder of REFUND_PRODUCTS; evidence photos are private and only the Owner removes one; and none of
 * it moves money or stock. Every fixture rolls back.
 */
test(
  'Phase 6 P6-12 product return cases: eligibility, windows, decisions, private evidence; no money or stock moves; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-returns-'));
    try {
      await phase6Fixture(async (base) => {
        const k = await productSaleKit(base);
        const { tx, fails } = base;
        const { A, B, invoices, people } = k;
        const storage = new LocalDiskMediaStorage(folder);
        const returns = new ProductReturnService(
          base.adapter,
          base.throttle,
          storage,
          pino({ level: 'silent' }),
        );
        const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
        const senior = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
        const both = await base.staff(['MANAGE_PRODUCT_RETURNS', 'REFUND_PRODUCTS'], {
          branchId: A.id,
        });
        const otherBranchClerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: B.id });
        const owner = people.owner;

        /** A paid counter sale of `quantity` units of a fresh product; returns the ids a case needs. */
        let saleNo = 0;
        const sale = async (quantity = 2, price = 100_000, payer: string | null = null) => {
          saleNo += 1;
          const product = await k.product(`ret${saleNo}`, [price]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, quantity + 5);
          const invoice = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, payer), variant.id, quantity),
          );
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          const view = await invoices.get(people.cashier.token, invoice.id);
          return {
            invoiceId: invoice.id,
            code: invoice.code,
            lineId: view.productLines[0]!.id,
            variantId: variant.id,
            paymentId: paid.payment.id,
          };
        };
        /** Moves the paid time of an invoice into the past (the test-only way to age a sale). */
        const aged = async (invoiceId: string, interval: string) => {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE invoices SET created_at = LEAST(created_at, clock_timestamp() - interval '${interval}'), finalized_at = LEAST(finalized_at, clock_timestamp() - interval '${interval}'), paid_at = clock_timestamp() - interval '${interval}' WHERE id = '${invoiceId}'`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        };
        const open = (
          actor: { token: string },
          line: { lineId: string },
          overrides: Partial<{
            reason: 'PERSONAL_PREFERENCE' | 'WRONG_OR_DAMAGED' | 'SKIN_IRRITATION';
            requestedOutcome: 'EXCHANGE' | 'REFUND';
            quantity: number;
            sealIntact: boolean | null;
            notes: string | null;
            clientRequestId: string;
            branchId: string;
          }> = {},
        ) =>
          k.ok(() =>
            returns.open(actor.token, {
              branchId: A.id,
              invoiceLineId: line.lineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'EXCHANGE',
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
        const upload = async (actor: { token: string }, caseId: string, color: string) =>
          k.ok(async () =>
            returns.uploadPhoto(actor.token, caseId, {
              buffer: await png(color),
              originalname: 'anh.png',
            }),
          );
        const show = (value: unknown) =>
          JSON.stringify(value, (_key, item) =>
            typeof item === 'bigint' ? item.toString() : item,
          );
        /** What a case must never touch: money, stock, points. */
        const footprint = async () => ({
          payments: await tx.payment.count({ where: { invoice: { branchId: A.id } } }),
          movements: await tx.stockMovement.count({ where: { branchId: A.id } }),
          reservations: await tx.stockReservation.count({ where: { branchId: A.id } }),
          levels: show(
            await tx.stockLevel.findMany({
              where: { branchId: A.id },
              orderBy: { variantId: 'asc' },
              select: { variantId: true, onHand: true, reserved: true },
            }),
          ),
          loyalty: await tx.loyaltyLedgerEntry.count(),
          invoices: show(
            await tx.invoice.findMany({
              where: { branchId: A.id },
              orderBy: { id: 'asc' },
              select: { id: true, status: true, totalVnd: true, paidSeq: true, rowVersion: true },
            }),
          ),
        });
        const eventKinds = async (caseId: string) =>
          (
            await tx.productReturnEvent.findMany({
              where: { caseId },
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              select: { kind: true },
            })
          ).map((event) => event.kind);

        await suite.test('nobody can do anything without a return permission', async () => {
          const s = await sale();
          const view = (actor: { token: string }) => returns.context(actor.token);
          assert.deepEqual((await view(people.cashier)).branches, []);
          assert.deepEqual((await view(people.nobody)).branches, []);
          await fails(() => returns.lookup(people.cashier.token, A.id, s.code), 'FORBIDDEN');
          await fails(() => open(people.cashier, s), 'FORBIDDEN');
          await fails(() => open(people.ktv, s), 'FORBIDDEN');
          await fails(() => returns.list(people.cashier.token, { branchId: A.id }), 'FORBIDDEN');
          // The permission is per branch: a clerk of another branch can do nothing here.
          await fails(() => open(otherBranchClerk, s), 'FORBIDDEN');
          await fails(() => returns.lookup(otherBranchClerk.token, A.id, s.code), 'FORBIDDEN');
          assert.equal(await tx.productReturnCase.count({ where: { invoiceLineId: s.lineId } }), 0);
        });

        await suite.test(
          'the context lists the branches and the powers of each person',
          async () => {
            const c = await returns.context(clerk.token);
            assert.deepEqual(
              c.branches.map((b) => [b.id, b.manage, b.decide]),
              [[A.id, true, false]],
            );
            assert.equal(c.owner, false);
            const s = await returns.context(senior.token);
            assert.deepEqual(
              s.branches.map((b) => [b.id, b.manage, b.decide]),
              [[A.id, false, true]],
            );
            const o = await returns.context(owner.token);
            assert.equal(o.owner, true);
            assert.ok(o.branches.some((b) => b.id === A.id && b.manage && b.decide));
          },
        );

        await suite.test(
          'lookup finds the product lines of a paid invoice and says what can still be returned',
          async () => {
            const s = await sale(3);
            const found = await returns.lookup(clerk.token, A.id, s.code.toLowerCase());
            assert.equal(found.invoice.code, s.code);
            assert.equal(found.invoice.customerName, null);
            assert.equal(found.lines.length, 1);
            const line = found.lines[0]!;
            assert.equal(line.lineId, s.lineId);
            assert.equal(line.quantity, 3);
            assert.equal(line.availableQuantity, 3);
            assert.equal(line.reasons.PERSONAL_PREFERENCE.open, true);
            assert.equal(line.reasons.WRONG_OR_DAMAGED.open, true);
            assert.equal(line.reasons.SKIN_IRRITATION.endsAt, null);
            const c = await open(clerk, s, { quantity: 2 });
            const after = (await returns.lookup(clerk.token, A.id, s.code)).lines[0]!;
            assert.equal(after.claimedQuantity, 2);
            assert.equal(after.availableQuantity, 1);
            assert.equal(c.status, 'OPEN');
            await fails(() => returns.lookup(clerk.token, A.id, 'KHONG-CO'), 'NOT_FOUND');
            // An invoice of another branch is not found at this one.
            await fails(() => returns.lookup(otherBranchClerk.token, B.id, s.code), 'NOT_FOUND');
            // A guest payer shows no name; a member shows the name only (never a phone number).
            const member = await k.customer('ret');
            const mine = await sale(1, 50_000, member.id);
            const shown = await returns.lookup(clerk.token, A.id, mine.code);
            assert.equal(shown.invoice.customerName, member.fullName);
            assert.ok(!JSON.stringify(shown).includes('phone'));
          },
        );

        await suite.test(
          'only a PAID counter invoice and only a product line can be returned',
          async () => {
            const product = await k.product('unpaid', [70_000]);
            await k.receive(product.variants[0]!.id, 4);
            const draft = await k.addLine(await k.openSale(), product.variants[0]!.id, 1);
            const finalized = await k.finalize(draft);
            const lineId = (await invoices.get(people.cashier.token, finalized.id)).productLines[0]!
              .id;
            await fails(
              () => returns.lookup(clerk.token, A.id, finalized.code),
              'RETURN_NOT_ELIGIBLE',
            );
            await fails(() => open(clerk, { lineId }), 'RETURN_NOT_ELIGIBLE');
            // A service line has no return case (PRD 29).
            const serviceInvoice = await k.serviceDraft();
            const serviceLine = serviceInvoice.lines[0]!;
            await fails(() => open(clerk, { lineId: serviceLine.id }), 'RETURN_NOT_ELIGIBLE');
            await fails(() => open(clerk, { lineId: randomUUID() }), 'NOT_FOUND');
            assert.equal(await tx.productReturnCase.count({ where: { invoiceLineId: lineId } }), 0);
          },
        );

        await suite.test(
          'opening a case: the facts, the window, the history, the audit, and nothing else moves',
          async () => {
            const s = await sale(2);
            const before = await footprint();
            const c = await open(clerk, s, {
              quantity: 1,
              requestedOutcome: 'REFUND',
              notes: '  Không hợp da  ',
            });
            assert.match(c.code, /^TH\d{6}$/);
            assert.equal(c.status, 'OPEN');
            assert.equal(c.reason, 'PERSONAL_PREFERENCE');
            assert.equal(c.requestedOutcome, 'REFUND');
            assert.equal(c.decidedOutcome, null);
            assert.equal(c.quantity, 1);
            assert.equal(c.line.soldQuantity, 2);
            assert.equal(c.notes, 'Không hợp da');
            assert.equal(c.sealIntact, true);
            assert.equal(c.invoice.code, s.code);
            // The window runs from the paid time (the hand-over of an in-stock counter sale): 168 hours.
            const paidAt = new Date(c.invoice.paidAt).getTime();
            assert.equal(new Date(c.handoverAt).getTime(), paidAt);
            assert.equal(new Date(c.windowEndsAt!).getTime() - paidAt, 168 * 3_600_000);
            assert.deepEqual(await eventKinds(c.id), ['OPENED']);
            assert.deepEqual(c.can, {
              note: true,
              addPhoto: true,
              decide: true,
              cancel: true,
              removePhoto: false,
              refunds: false,
            });
            assert.equal(
              await tx.auditEvent.count({
                where: { entityId: c.id, action: 'PRODUCT_RETURN_OPENED' },
              }),
              1,
            );
            assert.deepEqual(
              await footprint(),
              before,
              'a case moves no money, no stock and no points',
            );
            // The units still sold stay sold: the invoice is still PAID.
            assert.equal((await invoices.get(people.cashier.token, s.invoiceId)).status, 'PAID');
          },
        );

        await suite.test(
          'a repeat of the same request returns the case it opened; a different request is a different case',
          async () => {
            const s = await sale(3);
            const id = randomUUID();
            const first = await open(clerk, s, { clientRequestId: id });
            const again = await open(clerk, s, { clientRequestId: id });
            assert.equal(again.id, first.id);
            assert.equal(
              await tx.productReturnCase.count({ where: { invoiceLineId: s.lineId } }),
              1,
            );
            const second = await open(clerk, s, { clientRequestId: randomUUID() });
            assert.notEqual(second.id, first.id);
            assert.notEqual(second.code, first.code);
          },
        );

        await suite.test(
          'personal preference: the seal must be intact; 7 days (168 hours) from hand-over, no more',
          async () => {
            const s = await sale(5);
            await fails(
              () => open(clerk, s, { sealIntact: false }),
              'RETURN_SEAL_REQUIRED',
              'sealIntact',
            );
            await fails(
              () => open(clerk, s, { sealIntact: null }),
              'RETURN_SEAL_REQUIRED',
              'sealIntact',
            );
            // 167 hours 59 minutes after hand-over: inside.
            await aged(s.invoiceId, '167 hours 59 minutes');
            const inside = await open(clerk, s);
            assert.equal(inside.status, 'OPEN');
            // One minute past the 168 hours: over. Without a written reason nobody gets past it, the Owner included (the Owner's
            // exception, with a reason, is tested in return.exception.integration.test.ts).
            await aged(s.invoiceId, '168 hours 1 minute');
            await fails(() => open(clerk, s), 'RETURN_WINDOW_EXPIRED', 'reason');
            await fails(() => open(owner, s), 'RETURN_WINDOW_EXPIRED', 'reason');
            await fails(
              () => open(both, s, { reason: 'PERSONAL_PREFERENCE' }),
              'RETURN_WINDOW_EXPIRED',
            );
            const lookup = (await returns.lookup(clerk.token, A.id, s.code)).lines[0]!;
            assert.equal(lookup.reasons.PERSONAL_PREFERENCE.open, false);
            assert.equal(lookup.reasons.WRONG_OR_DAMAGED.open, false);
            assert.equal(lookup.reasons.SKIN_IRRITATION.open, true);
          },
        );

        await suite.test(
          'wrong or damaged: 48 hours from hand-over; the seal need not be intact',
          async () => {
            const s = await sale(5);
            await aged(s.invoiceId, '47 hours 59 minutes');
            const inside = await open(clerk, s, {
              reason: 'WRONG_OR_DAMAGED',
              sealIntact: false,
              notes: 'Nắp bị nứt',
            });
            assert.equal(inside.reason, 'WRONG_OR_DAMAGED');
            assert.equal(inside.sealIntact, false);
            assert.equal(
              new Date(inside.windowEndsAt!).getTime() - new Date(inside.handoverAt).getTime(),
              48 * 3_600_000,
            );
            await aged(s.invoiceId, '48 hours 1 minute');
            await fails(
              () => open(clerk, s, { reason: 'WRONG_OR_DAMAGED' }),
              'RETURN_WINDOW_EXPIRED',
            );
            await fails(
              () => open(owner, s, { reason: 'WRONG_OR_DAMAGED' }),
              'RETURN_WINDOW_EXPIRED',
            );
            // The same sale is still inside the 7 days of a personal preference.
            const preference = await open(clerk, s);
            assert.equal(preference.reason, 'PERSONAL_PREFERENCE');
          },
        );

        await suite.test('skin irritation has no window and records notes only', async () => {
          const s = await sale(2);
          await aged(s.invoiceId, '400 days');
          const c = await open(clerk, s, {
            reason: 'SKIN_IRRITATION',
            sealIntact: null,
            notes: 'Khách kể bị đỏ da sau hai ngày dùng',
          });
          assert.equal(c.windowEndsAt, null);
          assert.equal(c.reason, 'SKIN_IRRITATION');
          assert.equal(c.sealIntact, null);
          // A personal preference on the same old sale is refused.
          await fails(() => open(clerk, s), 'RETURN_WINDOW_EXPIRED');
        });

        await suite.test(
          'the units claimed on a line never exceed the units sold; declined and cancelled cases free their units',
          async () => {
            const s = await sale(3);
            const a = await open(clerk, s, { quantity: 2 });
            await fails(
              () => open(clerk, s, { quantity: 2 }),
              'RETURN_QUANTITY_EXCEEDED',
              'quantity',
            );
            const b = await open(clerk, s, { quantity: 1 });
            await fails(() => open(clerk, s, { quantity: 1 }), 'RETURN_QUANTITY_EXCEEDED');
            await fails(() => open(clerk, s, { quantity: 4 }), 'RETURN_QUANTITY_EXCEEDED');
            await k.ok(() =>
              returns.cancel(clerk.token, a.id, {
                expectedRowVersion: a.rowVersion,
                note: 'Mở nhầm',
              }),
            );
            const c = await open(clerk, s, { quantity: 2 });
            assert.equal(c.quantity, 2);
            await k.ok(() =>
              returns.decline(clerk.token, b.id, {
                expectedRowVersion: b.rowVersion,
                note: 'Quá hạn niêm phong',
              }),
            );
            await open(clerk, s, { quantity: 1 });
            await fails(() => open(clerk, s, { quantity: 1 }), 'RETURN_QUANTITY_EXCEEDED');
            await fails(() => open(clerk, s, { quantity: 0 }), 'VALIDATION_FAILED', 'quantity');
          },
        );

        await suite.test(
          'input is validated exactly: reason, outcome, notes, ids, stray keys',
          async () => {
            const s = await sale(5);
            const raw = (patch: Record<string, unknown>) =>
              returns.open(clerk.token, {
                branchId: A.id,
                invoiceLineId: s.lineId,
                reason: 'PERSONAL_PREFERENCE',
                requestedOutcome: 'EXCHANGE',
                quantity: 1,
                sealIntact: true,
                notes: null,
                clientRequestId: randomUUID(),
                ...patch,
              } as never);
            await fails(() => raw({ reason: 'BORED' }), 'VALIDATION_FAILED', 'reason');
            await fails(
              () => raw({ requestedOutcome: 'GIFT' }),
              'VALIDATION_FAILED',
              'requestedOutcome',
            );
            await fails(() => raw({ quantity: 1.5 }), 'VALIDATION_FAILED', 'quantity');
            await fails(() => raw({ sealIntact: 'yes' }), 'VALIDATION_FAILED', 'sealIntact');
            await fails(() => raw({ notes: 'x'.repeat(1001) }), 'VALIDATION_FAILED', 'notes');
            await fails(() => raw({ notes: 'a\u0000b' }), 'VALIDATION_FAILED', 'notes');
            await fails(
              () => raw({ clientRequestId: 'not-a-uuid' }),
              'VALIDATION_FAILED',
              'clientRequestId',
            );
            await fails(() => raw({ invoiceLineId: 'nope' }), 'VALIDATION_FAILED', 'invoiceLineId');
            await fails(() => raw({ price: 1 }), 'VALIDATION_FAILED');
            const blank = await raw({ notes: '   ' });
            assert.equal(blank.notes, null);
            const multi = await raw({ notes: 'dòng một\ndòng hai' });
            assert.equal(multi.notes, 'dòng một\ndòng hai');
          },
        );

        await suite.test(
          'notes are appended to the history while the case is open or accepted; never edited',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s);
            const noted = await k.ok(() =>
              returns.addNote(clerk.token, c.id, { note: 'Đã gọi khách' }),
            );
            assert.deepEqual(await eventKinds(c.id), ['OPENED', 'NOTE_ADDED']);
            assert.equal(noted.events.at(-1)!.note, 'Đã gọi khách');
            assert.equal(noted.rowVersion, c.rowVersion, 'a note does not change the case');
            await fails(
              () => returns.addNote(clerk.token, c.id, { note: '  ' }),
              'VALIDATION_FAILED',
              'note',
            );
            await fails(() => returns.addNote(senior.token, c.id, { note: 'x' }), 'FORBIDDEN');
            await fails(
              () => returns.addNote(otherBranchClerk.token, c.id, { note: 'x' }),
              'FORBIDDEN',
            );
            await k.ok(() =>
              returns.cancel(clerk.token, c.id, {
                expectedRowVersion: c.rowVersion,
                note: 'Khách rút lại',
              }),
            );
            await fails(
              () => returns.addNote(clerk.token, c.id, { note: 'muộn' }),
              'RETURN_CLOSED',
            );
          },
        );

        await suite.test(
          'deciding: a rule-based reason by either permission, once, with the version; closed cases are final',
          async () => {
            const s = await sale(4);
            const before = await footprint();
            const c = await open(clerk, s, { quantity: 1 });
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion + 1,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'CONFLICT',
            );
            await fails(
              () =>
                returns.accept(people.cashier.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'FORBIDDEN',
            );
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'GIFT' as never,
                  note: null,
                }),
              'VALIDATION_FAILED',
              'outcome',
            );
            const accepted = await k.ok(() =>
              returns.accept(clerk.token, c.id, {
                expectedRowVersion: c.rowVersion,
                outcome: 'REFUND',
                note: 'Đủ điều kiện',
              }),
            );
            assert.equal(accepted.status, 'ACCEPTED');
            // The remedy is the one decided, not the one asked for.
            assert.equal(accepted.requestedOutcome, 'EXCHANGE');
            assert.equal(accepted.decidedOutcome, 'REFUND');
            assert.equal(accepted.rowVersion, c.rowVersion + 1);
            assert.ok(accepted.closedAt);
            assert.equal(accepted.closingNote, 'Đủ điều kiện');
            assert.deepEqual(await eventKinds(c.id), ['OPENED', 'ACCEPTED']);
            assert.equal(accepted.can.decide, false);
            assert.equal(accepted.can.note, true, 'an accepted case still takes notes');
            // Once.
            await fails(
              () =>
                returns.decline(clerk.token, c.id, {
                  expectedRowVersion: accepted.rowVersion,
                  note: 'đổi ý',
                }),
              'RETURN_CLOSED',
            );
            await fails(
              () =>
                returns.cancel(clerk.token, c.id, {
                  expectedRowVersion: accepted.rowVersion,
                  note: 'đổi ý',
                }),
              'RETURN_CLOSED',
            );
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: accepted.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'RETURN_CLOSED',
            );
            // A holder of REFUND_PRODUCTS alone may also decide a rule-based reason, but not open or cancel.
            const second = await open(clerk, s, { quantity: 1 });
            const byRefund = await k.ok(() =>
              returns.accept(senior.token, second.id, {
                expectedRowVersion: second.rowVersion,
                outcome: 'EXCHANGE',
                note: null,
              }),
            );
            assert.equal(byRefund.status, 'ACCEPTED');
            assert.equal(byRefund.closingNote, null);
            const third = await open(clerk, s, { quantity: 1 });
            await fails(
              () =>
                returns.cancel(senior.token, third.id, {
                  expectedRowVersion: third.rowVersion,
                  note: 'x',
                }),
              'FORBIDDEN',
            );
            await fails(() => open(senior, s), 'FORBIDDEN');
            assert.deepEqual(
              await footprint(),
              before,
              'deciding a case moves no money, no stock and no points',
            );
          },
        );

        await suite.test(
          'a decline and a cancellation need a reason; a decision keeps who and when',
          async () => {
            const s = await sale(3);
            const c = await open(clerk, s);
            await fails(
              () =>
                returns.decline(clerk.token, c.id, { expectedRowVersion: c.rowVersion, note: '' }),
              'VALIDATION_FAILED',
              'note',
            );
            await fails(
              () =>
                returns.cancel(clerk.token, c.id, { expectedRowVersion: c.rowVersion, note: ' ' }),
              'VALIDATION_FAILED',
              'note',
            );
            const declined = await k.ok(() =>
              returns.decline(both.token, c.id, {
                expectedRowVersion: c.rowVersion,
                note: 'Hộp đã mở',
              }),
            );
            assert.equal(declined.status, 'DECLINED');
            assert.equal(declined.closingNote, 'Hộp đã mở');
            assert.equal(declined.decidedOutcome, null);
            const row = await tx.productReturnCase.findUniqueOrThrow({ where: { id: c.id } });
            assert.equal(row.closedByUserId, both.id);
            assert.ok(row.closedAt);
            assert.equal(
              await tx.auditEvent.count({
                where: { entityId: c.id, action: 'PRODUCT_RETURN_DECLINED' },
              }),
              1,
            );
          },
        );

        await suite.test(
          'skin irritation is decided by a holder of REFUND_PRODUCTS (the Owner or a senior manager), not by the clerk',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s, {
              reason: 'SKIN_IRRITATION',
              sealIntact: null,
              notes: 'Khách kể bị ngứa',
            });
            assert.equal(c.can.decide, false, 'the clerk is not offered the decision');
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'FORBIDDEN',
            );
            await fails(
              () =>
                returns.decline(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  note: 'không',
                }),
              'FORBIDDEN',
            );
            const asSenior = await returns.get(senior.token, c.id);
            assert.equal(asSenior.can.decide, true);
            assert.equal(asSenior.can.cancel, false);
            const accepted = await k.ok(() =>
              returns.accept(senior.token, c.id, {
                expectedRowVersion: c.rowVersion,
                outcome: 'EXCHANGE',
                note: 'Đổi sang loại dịu nhẹ',
              }),
            );
            assert.equal(accepted.status, 'ACCEPTED');
            // The Owner decides too.
            const o = await open(clerk, s, {
              reason: 'SKIN_IRRITATION',
              sealIntact: null,
              quantity: 1,
            });
            const declined = await k.ok(() =>
              returns.decline(owner.token, o.id, {
                expectedRowVersion: o.rowVersion,
                note: 'Không đủ căn cứ',
              }),
            );
            assert.equal(declined.status, 'DECLINED');
            // The record holds notes and photos only: no medical field exists on a case.
            const columns = await tx.$queryRaw<
              { column_name: string }[]
            >`SELECT column_name FROM information_schema.columns WHERE table_name = 'product_return_cases'`;
            for (const { column_name } of columns) {
              assert.doesNotMatch(column_name, /diagnos|medical|allerg|symptom|condition/i);
            }
          },
        );

        await suite.test(
          'a wrong or damaged product is accepted only with a photo taken within its 48 hours that is still present',
          async () => {
            const s = await sale(3);
            const c = await open(clerk, s, {
              reason: 'WRONG_OR_DAMAGED',
              sealIntact: false,
              quantity: 1,
            });
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'RETURN_PHOTO_REQUIRED',
            );
            const withPhoto = await upload(clerk, c.id, '#cc3333');
            assert.equal(withPhoto.photos.length, 1);
            // The Owner removes it on the customer's request: the requirement is unmet again.
            const removed = await k.ok(() =>
              returns.removePhoto(owner.token, c.id, withPhoto.photos[0]!.id, {
                note: 'Khách yêu cầu xóa ảnh',
              }),
            );
            assert.ok(removed.photos[0]!.removedAt);
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'RETURN_PHOTO_REQUIRED',
            );
            await upload(clerk, c.id, '#33cc33');
            const accepted = await k.ok(() =>
              returns.accept(clerk.token, c.id, {
                expectedRowVersion: c.rowVersion,
                outcome: 'EXCHANGE',
                note: null,
              }),
            );
            assert.equal(accepted.status, 'ACCEPTED');
            // A photo uploaded AFTER the 48 hours does not count (the claim must come with its photo inside the window).
            const late = await open(clerk, s, {
              reason: 'WRONG_OR_DAMAGED',
              sealIntact: false,
              quantity: 1,
            });
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(
              `UPDATE product_return_cases SET window_ends_at = clock_timestamp() - interval '1 minute', handover_at = clock_timestamp() - interval '48 hours 1 minute' WHERE id = '${late.id}'`,
            );
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
            await upload(clerk, late.id, '#3333cc');
            await fails(
              () =>
                returns.accept(clerk.token, late.id, {
                  expectedRowVersion: late.rowVersion,
                  outcome: 'REFUND',
                  note: null,
                }),
              'RETURN_PHOTO_REQUIRED',
            );
            // Declining needs no photo.
            const declined = await k.ok(() =>
              returns.decline(clerk.token, late.id, {
                expectedRowVersion: late.rowVersion,
                note: 'Ảnh gửi quá hạn',
              }),
            );
            assert.equal(declined.status, 'DECLINED');
          },
        );

        await suite.test(
          'accepting needs the invoice to be paid still: a reversed payment ends the claim',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s, { quantity: 1 });
            const reversed = await k.ok(() =>
              invoices.reversePayment(people.boss.token, s.invoiceId, s.paymentId, {
                reason: 'Nhập nhầm',
              }),
            );
            assert.equal(reversed.invoice.status, 'PENDING_PAYMENT');
            await fails(
              () =>
                returns.accept(clerk.token, c.id, {
                  expectedRowVersion: c.rowVersion,
                  outcome: 'EXCHANGE',
                  note: null,
                }),
              'RETURN_NOT_ELIGIBLE',
            );
            await fails(() => open(clerk, s, { quantity: 1 }), 'RETURN_NOT_ELIGIBLE');
            // The case itself is history: it can still be declined or cancelled.
            const cancelled = await k.ok(() =>
              returns.cancel(clerk.token, c.id, {
                expectedRowVersion: c.rowVersion,
                note: 'Hóa đơn đã đảo thanh toán',
              }),
            );
            assert.equal(cancelled.status, 'CANCELLED');
          },
        );

        await suite.test(
          'the list: 20 per page, newest first, filters, search, scoped to the branch and the permission',
          async () => {
            const s = await sale(30);
            const ids: string[] = [];
            for (let i = 0; i < 23; i += 1) {
              ids.push(
                (
                  await open(clerk, s, {
                    quantity: 1,
                    reason: i % 2 === 0 ? 'PERSONAL_PREFERENCE' : 'SKIN_IRRITATION',
                    sealIntact: i % 2 === 0 ? true : null,
                  })
                ).id,
              );
            }
            const page1 = await returns.list(clerk.token, { branchId: A.id, q: s.code });
            assert.equal(page1.total, 23);
            assert.equal(page1.pageSize, 20);
            assert.equal(page1.items.length, 20);
            assert.equal(page1.items[0]!.id, ids.at(-1), 'newest first');
            const page2 = await returns.list(clerk.token, { branchId: A.id, q: s.code, page: 2 });
            assert.equal(page2.items.length, 3);
            const skin = await returns.list(senior.token, {
              branchId: A.id,
              q: s.code,
              reason: 'SKIN_IRRITATION',
            });
            assert.equal(skin.total, 11);
            const none = await returns.list(clerk.token, {
              branchId: A.id,
              q: s.code,
              status: 'ACCEPTED',
            });
            assert.equal(none.total, 0);
            await fails(
              () => returns.list(clerk.token, { branchId: A.id, status: 'WEIRD' }),
              'VALIDATION_FAILED',
              'status',
            );
            await fails(
              () => returns.list(clerk.token, { branchId: A.id, reason: 'WEIRD' }),
              'VALIDATION_FAILED',
              'reason',
            );
            await fails(
              () => returns.list(otherBranchClerk.token, { branchId: A.id }),
              'FORBIDDEN',
            );
            const bySku = await returns.list(clerk.token, {
              branchId: A.id,
              q: page1.items[0]!.sku,
            });
            assert.equal(bySku.total, 23);
            assert.equal(page1.items[0]!.photoCount, 0);
          },
        );

        await suite.test(
          'a new case tells the holders of REFUND_PRODUCTS at the branch, never the opener and nobody elsewhere',
          async () => {
            const other = await base.staff(['REFUND_PRODUCTS'], { branchId: B.id });
            const s = await sale(2);
            const asBoth = await open(both, s, { quantity: 1 });
            const rows = await tx.notification.findMany({
              where: { type: 'PRODUCT_RETURN_OPENED', entityId: asBoth.id },
              select: {
                recipientUserId: true,
                branchId: true,
                entityType: true,
                contextCode: true,
                params: true,
              },
            });
            const recipients = rows.map((row) => row.recipientUserId);
            assert.ok(recipients.includes(senior.id), 'the senior is told');
            assert.ok(!recipients.includes(both.id), 'the opener is not told about their own case');
            assert.ok(!recipients.includes(other.id), 'a holder at another branch is not told');
            assert.ok(
              !recipients.includes(clerk.id),
              'a clerk without the refund permission is not told',
            );
            for (const row of rows) {
              assert.equal(row.branchId, A.id);
              assert.equal(row.entityType, 'ProductReturnCase');
              assert.equal(row.contextCode, asBoth.code);
              assert.deepEqual(
                row.params,
                { reason: 'PERSONAL_PREFERENCE' },
                'only the reason: no name, no notes',
              );
            }
            const again = await open(clerk, s, { quantity: 1, notes: 'Bí mật của khách' });
            const clerkRows = await tx.notification.findMany({
              where: { type: 'PRODUCT_RETURN_OPENED', entityId: again.id },
              select: { params: true },
            });
            assert.ok(clerkRows.length >= 1);
            assert.ok(!JSON.stringify(clerkRows).includes('Bí mật'));
          },
        );

        await suite.test(
          'the history of a case cannot be edited or deleted, and its facts never change (database guards)',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s, { quantity: 1 });
            const raw = async (sql: string) => {
              await tx.$executeRawUnsafe('SAVEPOINT guard');
              try {
                await tx.$executeRawUnsafe(sql);
              } catch (error) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
                return error;
              }
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
              return null;
            };
            const refuses = async (sql: string) =>
              assert.ok(await raw(sql), `must be refused: ${sql}`);
            await refuses(`DELETE FROM product_return_cases WHERE id = '${c.id}'`);
            await refuses(
              `UPDATE product_return_cases SET quantity = 2, row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_cases SET reason = 'SKIN_IRRITATION', row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_cases SET notes = 'đổi lịch sử', row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_cases SET window_ends_at = window_ends_at + interval '30 days', row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_cases SET handover_at = handover_at + interval '1 day', row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_cases SET opened_at = opened_at + interval '1 day', row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_cases SET status = 'ACCEPTED', row_version = row_version + 1 WHERE id = '${c.id}'`,
            );
            await refuses(
              `UPDATE product_return_events SET note = 'sửa' WHERE case_id = '${c.id}'`,
            );
            await refuses(`DELETE FROM product_return_events WHERE case_id = '${c.id}'`);
            // A case claiming a window shorter or longer than its reason allows is refused by the CHECK.
            await refuses(
              `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity, seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id)
             SELECT 'TH-X', branch_id, invoice_id, invoice_line_id, 'PERSONAL_PREFERENCE', 'REFUND', 1, true, handover_at, paid_seq, handover_at + interval '30 days', opened_by_user_id, gen_random_uuid() FROM product_return_cases WHERE id = '${c.id}'`,
            );
            await refuses(
              `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity, seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id)
             SELECT 'TH-Y', branch_id, invoice_id, invoice_line_id, 'PERSONAL_PREFERENCE', 'REFUND', 1, false, handover_at, paid_seq, handover_at + interval '168 hours', opened_by_user_id, gen_random_uuid() FROM product_return_cases WHERE id = '${c.id}'`,
            );
            // A case cannot claim a time of hand-over other than the invoice's paid time.
            await refuses(
              `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity, seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id)
             SELECT 'TH-Z', branch_id, invoice_id, invoice_line_id, 'SKIN_IRRITATION', 'REFUND', 1, NULL, handover_at + interval '3 days', paid_seq, NULL, opened_by_user_id, gen_random_uuid() FROM product_return_cases WHERE id = '${c.id}'`,
            );
            const intact = await tx.productReturnCase.findUniqueOrThrow({ where: { id: c.id } });
            assert.equal(intact.quantity, 1);
            assert.equal(intact.notes, 'Khách đổi ý');
          },
        );

        await suite.test(
          'evidence photos are private: stored apart, no media row, streamed only to a permitted viewer, never the original',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s, {
              reason: 'WRONG_OR_DAMAGED',
              sealIntact: false,
              quantity: 1,
            });
            const mediaBefore = await tx.mediaAsset.count();
            const withPhoto = await upload(clerk, c.id, '#aa5522');
            assert.equal(
              await tx.mediaAsset.count(),
              mediaBefore,
              'a photo never enters the website media library',
            );
            const photo = withPhoto.photos[0]!;
            assert.equal(photo.removedAt, null);
            assert.deepEqual(await eventKinds(c.id), ['OPENED', 'PHOTO_ADDED']);
            const row = await tx.productReturnPhoto.findUniqueOrThrow({ where: { id: photo.id } });
            // The row holds opaque keys only; the website's storage folder is not the evidence folder.
            for (const key of [row.originalKey, row.thumbKey, row.mdKey, row.lgKey]) {
              assert.match(key, /^\d{4}\/\d{2}\/[0-9a-f-]{36}/);
              assert.equal(await tx.mediaVariant.count({ where: { storageKey: key } }), 0);
              assert.equal(await tx.mediaAsset.count({ where: { storageKey: key } }), 0);
            }
            for (const kind of ['THUMB', 'MD', 'LG'] as const) {
              for (const viewer of [clerk, senior, both, owner]) {
                const { stream, bytes } = await returns.photo(viewer.token, c.id, photo.id, kind);
                stream.destroy();
                assert.ok(bytes > 0);
              }
            }
            // Not the cashier, not another branch, not someone with no permission, not an unknown id.
            for (const outsider of [people.cashier, otherBranchClerk, people.nobody, people.ktv]) {
              await fails(() => returns.photo(outsider.token, c.id, photo.id, 'MD'), 'NOT_FOUND');
            }
            await fails(() => returns.photo(clerk.token, c.id, randomUUID(), 'MD'), 'NOT_FOUND');
            await fails(
              () => returns.photo(clerk.token, randomUUID(), photo.id, 'MD'),
              'NOT_FOUND',
            );
            await fails(() => returns.photo(clerk.token, 'nope', photo.id, 'MD'), 'NOT_FOUND');
            await fails(
              () => returns.photo(undefined, c.id, photo.id, 'MD'),
              'AUTHENTICATION_REQUIRED',
            );
            // The stored renditions carry no EXIF/GPS and are WebP.
            const { stream } = await returns.photo(clerk.token, c.id, photo.id, 'LG');
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk as Buffer);
            const meta = await sharp(Buffer.concat(chunks)).metadata();
            assert.equal(meta.format, 'webp');
            assert.equal(meta.exif, undefined);
          },
        );

        await suite.test(
          'uploads: a repeat of the same picture is one photo; at most eight; only while open; wrong files refused',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s);
            const one = await upload(clerk, c.id, '#101010');
            const same = await upload(clerk, c.id, '#101010');
            assert.equal(same.photos.length, 1, 'the same bytes are not stored twice');
            assert.equal(await tx.productReturnPhoto.count({ where: { caseId: c.id } }), 1);
            for (let i = 1; i < 8; i += 1) {
              await upload(clerk, c.id, `#${(i * 30).toString(16).padStart(2, '0')}2040`);
            }
            const full = await returns.get(clerk.token, c.id);
            assert.equal(full.photos.length, 8);
            assert.equal(full.can.addPhoto, false);
            await fails(() => upload(clerk, c.id, '#ff00ff'), 'RETURN_PHOTO_LIMIT');
            // Authority and file checks.
            await fails(() => upload(senior, c.id, '#00ffff'), 'FORBIDDEN');
            await fails(() => upload(otherBranchClerk, c.id, '#00ffff'), 'FORBIDDEN');
            const small = await open(clerk, s);
            await fails(
              () =>
                returns.uploadPhoto(clerk.token, small.id, {
                  buffer: Buffer.from('<svg/>'),
                  originalname: 'a.svg',
                }),
              'MEDIA_TYPE_UNSUPPORTED',
            );
            await fails(
              () =>
                returns.uploadPhoto(clerk.token, small.id, {
                  buffer: Buffer.alloc(0),
                  originalname: 'a.png',
                }),
              'MEDIA_INVALID_IMAGE',
            );
            await fails(
              () => returns.uploadPhoto(clerk.token, small.id, undefined),
              'VALIDATION_FAILED',
              'file',
            );
            // A closed case takes no more evidence.
            await k.ok(() =>
              returns.cancel(clerk.token, small.id, {
                expectedRowVersion: small.rowVersion,
                note: 'x',
              }),
            );
            await fails(() => upload(clerk, small.id, '#0f0f0f'), 'RETURN_CLOSED');
            assert.equal(one.photos.length, 1);
          },
        );

        await suite.test(
          'removing a photo (OQ-79): the Owner only, with the customer’s request, the picture is deleted and a tombstone stays',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s);
            const withPhoto = await upload(clerk, c.id, '#445566');
            const photo = withPhoto.photos[0]!;
            const keys = await tx.productReturnPhoto.findUniqueOrThrow({ where: { id: photo.id } });
            for (const key of [keys.originalKey, keys.thumbKey, keys.mdKey, keys.lgKey]) {
              const found = await storage.get(key);
              found.stream.destroy();
            }
            await fails(
              () => returns.removePhoto(clerk.token, c.id, photo.id, { note: 'Khách yêu cầu' }),
              'FORBIDDEN',
            );
            await fails(
              () => returns.removePhoto(both.token, c.id, photo.id, { note: 'Khách yêu cầu' }),
              'FORBIDDEN',
            );
            await fails(
              () => returns.removePhoto(senior.token, c.id, photo.id, { note: 'Khách yêu cầu' }),
              'FORBIDDEN',
            );
            await fails(
              () => returns.removePhoto(owner.token, c.id, photo.id, { note: '  ' }),
              'VALIDATION_FAILED',
              'note',
            );
            await fails(
              () => returns.removePhoto(owner.token, c.id, randomUUID(), { note: 'Khách yêu cầu' }),
              'NOT_FOUND',
            );
            const done = await k.ok(() =>
              returns.removePhoto(owner.token, c.id, photo.id, {
                note: 'Khách yêu cầu xóa ảnh ngày 08/10',
              }),
            );
            const tomb = done.photos[0]!;
            assert.ok(tomb.removedAt);
            assert.equal(tomb.removalNote, 'Khách yêu cầu xóa ảnh ngày 08/10');
            assert.equal(tomb.id, photo.id, 'the record stays');
            assert.deepEqual(await eventKinds(c.id), ['OPENED', 'PHOTO_ADDED', 'PHOTO_REMOVED']);
            assert.equal(
              await tx.auditEvent.count({
                where: { entityId: c.id, action: 'PRODUCT_RETURN_PHOTO_REMOVED' },
              }),
              1,
            );
            // The bytes are gone from storage and nobody, the Owner included, can view the photo again.
            for (const key of [keys.originalKey, keys.thumbKey, keys.mdKey, keys.lgKey]) {
              await assert.rejects(storage.get(key));
            }
            await fails(() => returns.photo(owner.token, c.id, photo.id, 'MD'), 'NOT_FOUND');
            await fails(
              () => returns.removePhoto(owner.token, c.id, photo.id, { note: 'lần hai' }),
              'RETURN_PHOTO_GONE',
            );
            assert.equal(done.can.removePhoto, false, 'nothing left to remove');
            // The same picture can be added again later (the old one no longer counts).
            const again = await upload(clerk, c.id, '#445566');
            assert.equal(again.photos.filter((p) => p.removedAt === null).length, 1);
          },
        );

        await suite.test(
          'a photo removal is possible after the case is closed (the customer may ask any time)',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s);
            const withPhoto = await upload(clerk, c.id, '#778899');
            await k.ok(() =>
              returns.decline(clerk.token, c.id, {
                expectedRowVersion: c.rowVersion,
                note: 'Không đủ điều kiện',
              }),
            );
            const done = await k.ok(() =>
              returns.removePhoto(owner.token, c.id, withPhoto.photos[0]!.id, {
                note: 'Khách yêu cầu',
              }),
            );
            assert.ok(done.photos[0]!.removedAt);
            assert.equal(done.status, 'DECLINED');
          },
        );

        await suite.test(
          'a case is never visible across branches, and ids that are not ids are just not found',
          async () => {
            const s = await sale(2);
            const c = await open(clerk, s);
            await fails(() => returns.get(otherBranchClerk.token, c.id), 'FORBIDDEN');
            await fails(() => returns.get(people.cashier.token, c.id), 'FORBIDDEN');
            await fails(() => returns.get(clerk.token, 'not-an-id'), 'NOT_FOUND');
            await fails(() => returns.get(clerk.token, randomUUID()), 'NOT_FOUND');
            const viewed = await returns.get(senior.token, c.id);
            assert.equal(viewed.id, c.id);
            assert.equal(viewed.can.note, false);
            assert.equal(viewed.can.addPhoto, false);
            assert.equal(viewed.can.cancel, false);
          },
        );

        await suite.test(
          'grants: the two return permissions are held by nobody until the Owner grants them',
          async () => {
            const holders = await tx.rolePermission.findMany({
              where: {
                permission: { code: { in: ['MANAGE_PRODUCT_RETURNS', 'REFUND_PRODUCTS'] } },
                role: { code: { not: { startsWith: 'P6_R' } } },
              },
              select: { roleId: true },
            });
            assert.deepEqual(holders, [], 'no seeded role carries a return permission');
            assert.equal(
              await tx.userPermissionOverride.count({
                where: {
                  permission: { code: { in: ['MANAGE_PRODUCT_RETURNS', 'REFUND_PRODUCTS'] } },
                },
              }),
              0,
            );
          },
        );

        await suite.test(
          'the whole fixture reconciles and the money and stock are exactly as the sales left them',
          async () => {
            await k.settle();
            await k.reconcile();
            const orphan = await tx.$queryRaw<
              { n: bigint }[]
            >`SELECT count(*)::bigint AS n FROM product_return_events e LEFT JOIN product_return_cases c ON c.id = e.case_id WHERE c.id IS NULL`;
            assert.equal(orphan[0]!.n, 0n);
            const open_ = await tx.productReturnCase.findMany({
              where: { status: { in: ['OPEN', 'ACCEPTED'] } },
              select: { invoiceLineId: true, quantity: true },
            });
            const claimed = new Map<string, number>();
            for (const row of open_)
              claimed.set(row.invoiceLineId, (claimed.get(row.invoiceLineId) ?? 0) + row.quantity);
            for (const [lineId, quantity] of claimed) {
              const line = await tx.invoiceLine.findUniqueOrThrow({
                where: { id: lineId },
                select: { quantity: true },
              });
              assert.ok(
                quantity <= line.quantity!,
                `claimed ${quantity} of ${line.quantity} on ${lineId}`,
              );
            }
          },
        );
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
