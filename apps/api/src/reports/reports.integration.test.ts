import 'reflect-metadata';
import { REPORT_DEFINITIONS } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-2 against real PostgreSQL (design PHASE8_REPORTS.md sections 3.3, 7, P8-T1, P8-T8): who may open which report at which
 * branch, that a report cannot write, that a branch filter can only narrow, and that the production frame is one READ ONLY
 * REPEATABLE READ snapshot. Fixtures roll back.
 */
test(
  'Phase 8 P8-2 report frame: scope by permission and branch, read-only by the database, timeout, real snapshot',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const { tx, fails } = base;
      const refused = (code: string, field?: string) => (error: unknown) =>
        error instanceof AuthError &&
        error.code === code &&
        (field === undefined || error.message.includes(field));
      const reports = new ReportsService(base.adapter, base.throttle);
      const here = await base.branch('P8 A');
      const there = await base.branch('P8 B');
      const revenueHere = await base.staff(['VIEW_REVENUE'], { branchId: here.id });
      const exporter = await base.staff(['VIEW_REVENUE', 'EXPORT_REPORTS'], { branchId: here.id });
      const stockOnly = await base.staff(['VIEW_INVENTORY'], { branchId: there.id });
      const nobody = await base.staff(['VIEW_INVOICES'], { branchId: here.id });
      const profitOwner = await base.staff(['VIEW_REVENUE'], {
        branchId: here.id,
        globalCodes: ['VIEW_PROFIT'],
      });

      await suite.test('a missing or customer session is refused', async () => {
        await fails(() => reports.registry(undefined), 'AUTHENTICATION_REQUIRED');
        await fails(() => reports.registry('not-a-session'), 'AUTHENTICATION_REQUIRED');
      });

      await suite.test(
        'the registry lists a report only for the branches where the permission holds',
        async () => {
          const mine = await reports.registry(revenueHere.token);
          const overview = mine.reports.find((entry) => entry.id === 'revenue-overview');
          assert.deepEqual(overview?.branchIds, [here.id]);
          assert.equal(overview?.available, true);
          assert.equal(overview?.exportable, false); // no EXPORT_REPORTS
          assert.ok(mine.branches.every((branch) => branch.id === here.id));
          // Stock reports are not open to a revenue-only person.
          assert.equal(
            mine.reports.find((entry) => entry.id === 'stock-best-sellers')?.available,
            false,
          );

          const exports = await reports.registry(exporter.token);
          assert.equal(
            exports.reports.find((entry) => entry.id === 'revenue-overview')?.exportable,
            true,
          );
          assert.equal(
            exports.reports.find((entry) => entry.id === 'stock-best-sellers')?.exportable,
            false,
          );

          const stock = await reports.registry(stockOnly.token);
          assert.deepEqual(
            stock.reports.find((entry) => entry.id === 'stock-best-sellers')?.branchIds,
            [there.id],
          );
          assert.equal(
            stock.reports.find((entry) => entry.id === 'revenue-overview')?.available,
            false,
          );

          // A report needing two permissions is open only where both hold.
          const nothing = await reports.registry(nobody.token);
          assert.ok(nothing.reports.every((entry) => !entry.available));

          // The Owner sees every report on every active branch.
          const owner = await reports.registry(base.ownerToken);
          const active = await tx.branch.findMany({
            where: { isActive: true },
            select: { id: true },
          });
          assert.equal(owner.reports.length, REPORT_DEFINITIONS.length);
          for (const entry of owner.reports) {
            assert.deepEqual([...entry.branchIds].sort(), active.map((b) => b.id).sort(), entry.id);
          }
          // A global-only permission is held everywhere by whoever has it globally.
          const profit = (await reports.registry(profitOwner.token)).reports.find(
            (entry) => entry.id === 'profit',
          );
          assert.equal(profit?.available, true);
          assert.equal(profit?.exportReauth, true);
        },
      );

      await suite.test('scope: a branch filter can only narrow the covered set', async () => {
        await reports.run(revenueHere.token, 'report', async (context) => {
          assert.deepEqual(
            context.scope(['VIEW_REVENUE']).map((b) => b.id),
            [here.id],
          );
          assert.deepEqual(
            context.scope(['VIEW_REVENUE'], here.id).map((b) => b.id),
            [here.id],
          );
          assert.deepEqual(
            context.scope(['VIEW_REVENUE'], '').map((b) => b.id),
            [here.id],
          );
          for (const outside of [there.id, '00000000-0000-4000-8000-000000000000']) {
            assert.throws(() => context.scope(['VIEW_REVENUE'], outside), refused('FORBIDDEN'));
          }
          assert.throws(
            () => context.scope(['VIEW_REVENUE'], 'not-a-uuid'),
            refused('VALIDATION_FAILED', 'branchId'),
          );
          // The person holds VIEW_REVENUE but not VIEW_INVENTORY: no branch at all.
          assert.throws(() => context.scope(['VIEW_INVENTORY']), refused('FORBIDDEN'));
          assert.throws(
            () => context.scope(['VIEW_REVENUE', 'VIEW_INVENTORY']),
            refused('FORBIDDEN'),
          );
        });
      });

      await suite.test(
        'read-only: the database refuses any write made inside a report',
        async () => {
          const before = await tx.branch.count();
          await fails(
            () =>
              reports.run(base.ownerToken, 'report', (context) =>
                context.tx.branch.create({
                  data: { code: `RO${base.run}`, name: 'must not exist' },
                }),
              ),
            'SERVICE_UNAVAILABLE',
          );
          assert.equal(await tx.branch.count(), before);
          // The fixture's own transaction is writable again afterwards.
          const probe = await tx.branch.create({
            data: { code: `OK${base.run}`, name: 'writable again' },
          });
          assert.ok(probe.id);
        },
      );

      await suite.test(
        'a statement over its time limit becomes REPORT_TIMEOUT, not a hung request',
        async () => {
          await fails(
            () =>
              reports.run(base.ownerToken, 'dashboard', async (context) => {
                await context.tx.$executeRawUnsafe('SET LOCAL statement_timeout = 50');
                await context.tx.$queryRawUnsafe('SELECT pg_sleep(2)');
              }),
            'REPORT_TIMEOUT',
          );
        },
      );

      await suite.test(
        'the production frame is one READ ONLY REPEATABLE READ snapshot with a statement timeout',
        async () => {
          const sessions = new SessionService(
            { client: base.database } as PrismaService,
            base.environment,
          );
          const seen = await sessions.withReadOnlyTransaction(
            async (client) => {
              const [settings] = await client.$queryRaw<
                { readOnly: string; isolation: string; timeout: string }[]
              >`SELECT current_setting('transaction_read_only') AS "readOnly",
                     current_setting('transaction_isolation') AS isolation,
                     current_setting('statement_timeout') AS timeout`;
              await assert.rejects(
                client.$executeRawUnsafe(`CREATE TEMP TABLE should_not_exist (id int)`),
                /read-only transaction/i,
              );
              return settings;
            },
            { statementTimeoutMs: 7000 },
          );
          assert.equal(seen?.readOnly, 'on');
          assert.equal(seen?.isolation, 'repeatable read');
          assert.equal(seen?.timeout, '7s');
        },
      );
    });
  },
);
