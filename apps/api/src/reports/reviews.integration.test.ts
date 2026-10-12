import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CustomerReviewService } from '../reviews/customer-reviews.service.js';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-16/P8-17 against real PostgreSQL (design PHASE8_REPORTS.md 4.9, Owner OQ-P8-7): customer reviews and the staff report over them.
 * The paid invoices come from the real services; the customer's calls go through the real customer API service; the database rules are tried
 * directly; extra ratings for the averages are inserted as the table would hold them (triggers lifted for that statement only). Every figure is
 * hand-computed. Fixtures roll back.
 */
test(
  'Phase 8 P8-16/17 customer reviews: prompt, one review per paid invoice, who may be rated, database guards; staff report; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, B, people } = k;
      const reviews = new CustomerReviewService(base.adapter, base.throttle);
      const reports = new ReportsService(base.adapter, base.throttle);
      const exports = new ReportExportService(base.adapter, base.throttle, base.environment);
      const member = await k.member('rv');
      const other = await k.member('xx');
      const ktv = people.ktv.id;
      const today = await k.day();
      const viewer = await base.staff(['VIEW_REVIEWS', 'EXPORT_REPORTS'], { branchId: A.id });
      const elsewhere = await base.staff(['VIEW_REVIEWS'], { branchId: B.id });
      const nobody = await base.staff(['VIEW_REVENUE'], { branchId: A.id });
      const replica = async (sql: string) => {
        await tx.$executeRawUnsafe('SAVEPOINT fixture_row');
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        try {
          await tx.$executeRawUnsafe(sql);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fixture_row');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fixture_row');
          const detail =
            error instanceof Error ? error.message.replace(/\s+/g, ' ') : String(error);
          throw new Error(
            `fixture row failed: ${sql.slice(0, 160).replace(/\s+/g, ' ')} -> ${detail.slice(-300)}`,
            { cause: error },
          );
        } finally {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        }
      };
      const rejects = async (sql: string, pattern: RegExp) => {
        await tx.$executeRawUnsafe('SAVEPOINT guard_try');
        try {
          await tx.$executeRawUnsafe(sql);
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard_try');
          assert.match(String((error as Error).message), pattern);
          return;
        }
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT guard_try');
        assert.fail(`Expected rejection matching ${String(pattern)}`);
      };

      // ----------------------------------------------------------------------------------------------- invoices (real services)
      const paidService = await k.finalize(await k.serviceDraft([k.exact, k.ranged], member.id));
      await k.pay(paidService.id, Number(paidService.totalVnd));
      const unpaidService = await k.finalize(await k.serviceDraft([k.exact], member.id));
      const product = (await k.product('rv', [50_000])).variants[0]!;
      await k.receive(product.id, 3);
      const productSale = await k.finalize(
        await k.addLine(await k.openSale(people.cashier, member.id), product.id, 1),
      );
      await k.pay(productSale.id, Number(productSale.totalVnd));
      const payer = await tx.invoice.findUniqueOrThrow({
        where: { id: paidService.id },
        select: { payerUserId: true, status: true },
      });
      assert.deepEqual([payer.payerUserId, payer.status], [member.id, 'PAID']);

      await suite.test(
        'the prompt: a paid invoice of the customer can be reviewed and names who served; unpaid, product-only and foreign ones behave',
        async () => {
          const prompt = await reviews.prompt(member.token, paidService.id);
          assert.equal(prompt.canReview, true);
          assert.equal(prompt.review, null);
          assert.deepEqual(
            prompt.staff.map((s) => s.employeeUserId),
            [ktv],
          );
          assert.equal(typeof prompt.staff[0]!.name, 'string');
          const productOnly = await reviews.prompt(member.token, productSale.id);
          assert.deepEqual([productOnly.canReview, productOnly.staff], [true, []]);
          const unpaid = await reviews.prompt(member.token, unpaidService.id);
          assert.deepEqual([unpaid.canReview, unpaid.staff], [false, []]);
          // Someone else's invoice, a made-up id and a malformed id are all the same answer.
          await fails(() => reviews.prompt(other.token, paidService.id), 'NOT_FOUND');
          await fails(() => reviews.prompt(member.token, randomUUID()), 'NOT_FOUND');
          await fails(() => reviews.prompt(member.token, 'nope'), 'NOT_FOUND');
          await fails(() => reviews.prompt(undefined, paidService.id), 'AUTHENTICATION_REQUIRED');
        },
      );

      await suite.test(
        'submitting: validation first, then one review per paid invoice; only the people who served can be rated',
        async () => {
          const request = (patch: Record<string, unknown> = {}) =>
            ({
              invoiceId: paidService.id,
              rating: 5,
              comment: null,
              staff: [],
              ...patch,
            }) as never;
          for (const rating of [0, 6, 2.5, '5', null]) {
            await fails(
              () => reviews.submit(member.token, request({ rating })),
              'VALIDATION_FAILED',
              'rating',
            );
          }
          await fails(
            () => reviews.submit(member.token, request({ comment: 'x'.repeat(1001) })),
            'VALIDATION_FAILED',
            'comment',
          );
          await fails(
            () =>
              reviews.submit(
                member.token,
                request({ staff: [{ employeeUserId: people.cashier.id, rating: 5 }] }),
              ),
            'VALIDATION_FAILED',
            'staff',
          );
          await fails(
            () =>
              reviews.submit(
                member.token,
                request({
                  staff: [
                    { employeeUserId: ktv, rating: 4 },
                    { employeeUserId: ktv, rating: 5 },
                  ],
                }),
              ),
            'VALIDATION_FAILED',
            'staff',
          );
          await fails(
            () =>
              reviews.submit(
                member.token,
                request({ staff: [{ employeeUserId: ktv, rating: 7 }] }),
              ),
            'VALIDATION_FAILED',
            'staff',
          );
          await fails(() => reviews.submit(other.token, request()), 'NOT_FOUND');
          await fails(
            () => reviews.submit(member.token, request({ invoiceId: unpaidService.id })),
            'REVIEW_NOT_AVAILABLE',
          );
          assert.equal(
            await tx.customerReview.count(),
            0,
            'nothing was written by the refused attempts',
          );

          const given = await reviews.submit(
            member.token,
            request({ comment: '  Rất hài lòng  ', staff: [{ employeeUserId: ktv, rating: 4 }] }),
          );
          assert.equal(given.rating, 5);
          assert.equal(given.comment, 'Rất hài lòng');
          assert.deepEqual(
            given.staff.map((s) => s.rating),
            [4],
          );
          const after = await reviews.prompt(member.token, paidService.id);
          assert.deepEqual([after.canReview, after.staff], [false, []]);
          assert.equal(after.review?.rating, 5);
          await fails(
            () => reviews.submit(member.token, request({ rating: 1 })),
            'REVIEW_ALREADY_SUBMITTED',
          );
          // A review without a note and without ratings of people is fine (product-only invoice); a blank note is no note.
          const bare = await reviews.submit(
            member.token,
            request({ invoiceId: productSale.id, rating: 3, comment: '   ' }),
          );
          assert.deepEqual([bare.rating, bare.comment, bare.staff], [3, null, []]);
        },
      );

      await suite.test(
        'the database holds the rules too: no change, no delete, a paid invoice of the payer, a person who served',
        async () => {
          const row = await tx.customerReview.findUniqueOrThrow({
            where: { invoiceId: paidService.id },
          });
          await rejects(
            `UPDATE customer_reviews SET rating = 1 WHERE id = '${row.id}'`,
            /never changed or deleted/,
          );
          await rejects(
            `DELETE FROM customer_reviews WHERE id = '${row.id}'`,
            /never changed or deleted/,
          );
          await rejects(
            `UPDATE customer_review_staff_ratings SET rating = 1 WHERE review_id = '${row.id}'`,
            /never changed or deleted/,
          );
          await rejects(
            `DELETE FROM customer_review_staff_ratings WHERE review_id = '${row.id}'`,
            /never changed or deleted/,
          );
          const insert = (invoice: string, customer: string, branch: string, stars = 5) =>
            `INSERT INTO customer_reviews (invoice_id, customer_user_id, branch_id, rating) VALUES ('${invoice}', '${customer}', '${branch}', ${stars})`;
          await rejects(
            insert(unpaidService.id, member.id, A.id),
            /paid invoice of the customer who paid it/,
          );
          await rejects(
            insert(paidService.id, other.id, A.id),
            /duplicate key|paid invoice of the customer/,
          );
          await rejects(insert(randomUUID(), member.id, A.id), /foreign key|paid invoice/);
          await rejects(
            `UPDATE customer_reviews SET rating = 9 WHERE id = '${row.id}'`,
            /never changed or deleted|check constraint/,
          );
          const bare = await tx.customerReview.findUniqueOrThrow({
            where: { invoiceId: productSale.id },
          });
          await rejects(
            `INSERT INTO customer_review_staff_ratings (review_id, employee_user_id, rating) VALUES ('${bare.id}', '${ktv}', 5)`,
            /performed on that invoice/,
          );
        },
      );

      // Ratings for the averages: branch A has 6 more reviews (and the KTV 5 more ratings); branch B has 2.
      const synthetic = async (branch: string, stars: number, staff?: number) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO customer_reviews (id, invoice_id, customer_user_id, branch_id, rating) VALUES ('${id}', '${randomUUID()}', '${member.id}', '${branch}', ${stars})`,
        );
        if (staff !== undefined) {
          await replica(
            `INSERT INTO customer_review_staff_ratings (review_id, employee_user_id, rating) VALUES ('${id}', '${ktv}', ${staff})`,
          );
        }
      };
      for (const [stars, staff] of [
        [5, 5],
        [5, 5],
        [4, 4],
        [4, 4],
        [3, 3],
      ] as const)
        await synthetic(A.id, stars, staff);
      await synthetic(A.id, 1);
      await synthetic(B.id, 5);
      await synthetic(B.id, 3);
      const query = { from: today, to: today };

      await suite.test(
        'the staff report: average and distribution per branch and per person; fewer than 5 ratings is "not enough"',
        async () => {
          const r = await reports.reviews(viewer.token, query);
          // Branch A: the real 5 and 3, and the six above: 5,5,5,4,4,3,3,1 = 30 over 8 -> 3.75
          assert.deepEqual(
            r.byBranch.map((x) => x.branch.id),
            [A.id],
          );
          const a = r.byBranch[0]!;
          assert.equal(a.count, 8);
          assert.deepEqual(a.distribution, [1, 0, 2, 2, 3]);
          assert.equal(a.averageHundredths, 375);
          assert.equal(a.enough, true);
          assert.deepEqual(r.totals, {
            count: 8,
            averageHundredths: 375,
            distribution: [1, 0, 2, 2, 3],
            enough: true,
          });
          // The KTV: 4 (real) + 5,5,4,4,3 = 25 over 6 -> 4.17
          assert.equal(r.staff.length, 1);
          assert.deepEqual(
            [
              r.staff[0]!.userId,
              r.staff[0]!.count,
              r.staff[0]!.averageHundredths,
              r.staff[0]!.enough,
            ],
            [ktv, 6, 417, true],
          );
          assert.deepEqual(r.staff[0]!.distribution, [0, 0, 1, 3, 2]);
          // Paid invoices of customers with an account at branch A today: the service sale and the product sale; the share never shows above 100%.
          assert.equal(r.paidInvoices, 2);
          assert.equal(r.responseBp, 10000);
          // Branch B: two ratings only.
          const b = await reports.reviews(elsewhere.token, query);
          assert.deepEqual(
            [b.byBranch[0]!.count, b.byBranch[0]!.enough, b.byBranch[0]!.averageHundredths],
            [2, false, 400],
          );
          assert.equal(b.staff.length, 0);
          // Another day has nothing.
          const empty = await reports.reviews(viewer.token, {
            from: '2001-01-01',
            to: '2001-01-31',
          });
          assert.deepEqual(
            [empty.totals.count, empty.totals.averageHundredths, empty.responseBp],
            [0, null, 0],
          );
        },
      );

      await suite.test(
        'scope: VIEW_REVIEWS at the branch only; the registry and the file follow',
        async () => {
          await fails(() => reports.reviews(nobody.token, query), 'FORBIDDEN');
          await fails(
            () => reports.reviews(viewer.token, { ...query, branchId: B.id }),
            'FORBIDDEN',
          );
          const entry = (await reports.registry(viewer.token)).reports.find(
            (x) => x.id === 'reviews',
          )!;
          assert.deepEqual(
            [entry.available, entry.exportable, entry.exportReauth, entry.branchIds],
            [true, true, false, [A.id]],
          );
          assert.equal(
            (await reports.registry(nobody.token)).reports.find((x) => x.id === 'reviews')!
              .available,
            false,
          );
          const file = await exports.export(viewer.token, {
            report: 'reviews',
            format: 'csv',
            ...query,
          });
          const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.bytes);
          assert.ok(text.includes('3.75') && text.includes(',8,'));
          const english = await exports.export(viewer.token, {
            report: 'reviews',
            format: 'xlsx',
            locale: 'en',
            ...query,
          });
          assert.ok(english.rows >= 1);
        },
      );
    });
  },
);
