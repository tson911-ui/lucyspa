import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { appendLedgerEntry, parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { InvoiceService } from './invoice.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-4 Member Discount races on separate committed PostgreSQL connections with real production service
 * calls. A two-party latch releases only after both transactions hold the shared auth-graph lock; every
 * other lock (users, session, visit, invoice) is taken by production code. Requires an explicitly opted-in
 * local superuser validation database (replica-role cleanup of permanent financial history); cleanup is
 * bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 5 P5-4 member discount races keep one consistent tier snapshot per invoice',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const database = createDatabaseClient(databaseUrl);
    if (!/validation|scratch|uxaudit/.test(new URL(databaseUrl).pathname.slice(1))) {
      suite.skip('committed fixtures run only on a throw-away validation database');
      return;
    }
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_KEYS: ring(),
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
    });
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    let meet: (() => Promise<void>) | null = null;
    const withTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      database.$transaction(
        async (tx) => {
          await takeSharedAuthGraphLock(tx);
          if (meet) await meet();
          return work(tx);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    const loyaltyService = new LoyaltyService(
      {
        withTransaction,
        withExclusiveTransaction: withTransaction,
        resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
          sessions.resolveForMutation(token, tx),
      },
      new AuthThrottleService(environment),
      environment,
    );
    const invoices = new InvoiceService(
      {
        withTransaction,
        withExclusiveTransaction: withTransaction,
        resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
          sessions.resolveForMutation(token, tx),
      },
      new AuthThrottleService(environment),
      environment,
    );
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      role: randomUUID(),
      adjustRole: randomUUID(),
    };
    const userIds: string[] = [];
    const memberIds: string[] = [];
    let installedGoLive = false;
    const sessionIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    const outcome = (result: PromiseSettledResult<unknown>) => {
      if (result.status === 'fulfilled') return 'OK';
      assert.ok(result.reason instanceof AuthError, String(result.reason));
      return result.reason.code;
    };
    const race = async <A, B>(first: () => Promise<A>, second: () => Promise<B>) => {
      let count = 0;
      let release!: () => void;
      let fail!: (error: Error) => void;
      const gate = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      const timer = setTimeout(
        () => fail(new Error('Both race transactions must reach the latch.')),
        10_000,
      );
      meet = async () => {
        if (++count === 2) release();
        await gate;
      };
      try {
        const results = await Promise.allSettled([first(), second()] as const);
        assert.equal(count, 2, 'two independent transactions competed');
        return results;
      } finally {
        clearTimeout(timer);
        meet = null;
      }
    };
    try {
      await database.$transaction(async (tx) => {
        await tx.branch.create({
          data: {
            id: ids.branch,
            code: `IVR_${run}`,
            name: 'Invoice race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `IVR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `IVR_SVC_${run}`,
            categoryId: ids.category,
            nameVi: 'Race',
            nameEn: 'Race',
            priceVnd: 100_000n,
            priceMaxVnd: 150_000n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
          },
        });
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: { code: { in: ['VIEW_INVOICES', 'MANAGE_INVOICES', 'CANCEL_INVOICES'] } },
          select: { id: true },
        });
        assert.equal(permissions.length, 3);
        const adjustPermission = await tx.permission.findUniqueOrThrow({
          where: { code: 'ADJUST_LOYALTY_POINTS' },
          select: { id: true },
        });
        await tx.role.create({
          data: {
            id: ids.adjustRole,
            code: `IVR_ADJ_${run}`,
            displayNameVi: 'Race adjuster',
            displayNameEn: 'Race adjuster',
            permissions: { create: [{ permissionId: adjustPermission.id }] },
          },
        });
        await tx.role.create({
          data: {
            id: ids.role,
            code: `IVR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const staff = (withRole: boolean, adjuster = false) =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const user = await tx.user.create({
            data: {
              id,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Race employee',
              preferredLocale: 'vi',
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: validVnMobile(),
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `IVR_${run}_${++serial}`,
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          await tx.employmentClassificationChange.create({
            data: {
              employeeUserId: id,
              classification: 'OFFICIAL_EMPLOYEE',
              effectiveDate: new Date('2020-01-01'),
            },
          });
          await tx.employeeBranchAssignment.create({
            data: { employeeUserId: id, branchId: ids.branch, grantedByUserId: id },
          });
          if (adjuster) {
            await tx.userRoleAssignment.create({
              data: { userId: id, roleId: ids.adjustRole, scopeKind: 'GLOBAL' },
            });
          }
          if (withRole) {
            await tx.userRoleAssignment.create({
              data: { userId: id, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
            });
          }
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            {
              userId: id,
              passwordHash: user.passwordHash!,
              credentialVersion: user.credentialVersion,
              authzVersion: user.authzVersion,
            },
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          if (!adjuster) return { id, token: issued.token };
          // A manual adjustment needs a fresh password confirmation.
          const fresh = await sessions.rotateAuthenticated(
            issued.token,
            {
              userId: id,
              passwordHash: user.passwordHash!,
              credentialVersion: user.credentialVersion,
              authzVersion: user.authzVersion,
            },
            { reauthenticated: true },
            tx,
          );
          sessionIds.push(fresh.session.id);
          return { id, token: fresh.token };
        });
      const ktv = await staff(false);
      const a = await staff(true);
      const b = await staff(true);
      const adjuster = await staff(false, true);
      if ((await database.loyaltyGoLive.count()) === 0) {
        await database.loyaltyGoLive.create({ data: { activatedByUserId: a.id } });
        installedGoLive = true;
      }
      /** A customer with the given Spa balance (a manual ledger entry), committed. */
      const member = async (points: number) => {
        const id = randomUUID();
        memberIds.push(id);
        await database.user.create({
          data: {
            id,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: 'Race member',
            preferredLocale: 'vi',
            emailCanonical: `mr-${id}@example.com`,
            emailDelivery: `mr-${id}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
            },
          },
        });
        await database.$transaction((tx) =>
          appendLedgerEntry(tx, {
            userId: id,
            wallet: 'SPA',
            kind: 'MANUAL_ADJUSTMENT',
            points,
            idempotencyKey: `MR:${id}:seed`,
            reason: 'Race',
            actorUserId: a.id,
          }),
        );
        return id;
      };
      let slot = 0;
      /** A COMPLETED visit with one performed (DONE) line, committed. */
      const completedVisit = (ownerUserId: string | null = null) =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `IVR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              ownerUserId,
              serviceDate: new Date('2027-03-01T00:00:00.000Z'),
              arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
              createdByUserId: a.id,
              idempotencyKey: randomUUID(),
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'GUEST', displayName: 'Race guest' },
          });
          const line = await tx.visitServiceLine.create({
            data: {
              visitId: visit.id,
              participantId: participant.id,
              sequence: 1,
              serviceId: ids.service,
              employeeUserId: ktv.id,
              assignmentMode: 'ANY',
              plannedStartAt: start,
              plannedEndAt: new Date(start.getTime() + 10 * 60_000),
              durationMinutes: 10,
              bufferMinutes: 0,
              serviceCode: `IVR_SVC_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 100_000n,
              catalogPriceMaxVnd: 150_000n,
              catalogPricingUnit: 'PER_SERVICE',
            },
          });
          const started = new Date('2027-03-01T06:00:00+07:00');
          await tx.visitServiceLine.update({
            where: { id: line.id },
            data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
          });
          await tx.visit.update({
            where: { id: visit.id },
            data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
          });
          const execution = await tx.serviceExecution.create({
            data: {
              visitServiceLineId: line.id,
              employeeUserId: ktv.id,
              startedAt: started,
              expectedEndAt: new Date(started.getTime() + 10 * 60_000),
            },
          });
          await tx.serviceExecution.update({
            where: { id: execution.id },
            data: {
              status: 'ENDED',
              endedAt: new Date(started.getTime() + 10 * 60_000),
              endKind: 'NORMAL',
              endedByUserId: ktv.id,
              rowVersion: { increment: 1 },
            },
          });
          await tx.visitServiceLine.update({
            where: { id: line.id },
            data: { status: 'DONE', rowVersion: { increment: 1 } },
          });
          await tx.visit.update({
            where: { id: visit.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date('2027-03-01T07:00:00+07:00'),
              rowVersion: { increment: 1 },
            },
          });
          return visit.id;
        });
      /** A DRAFT of a new completed visit of the payer with its line priced at 100,000. */
      const openPriced = async (payer: string, token = a.token) => {
        const opened = (await invoices.open(token, await completedVisit(payer))).invoice;
        return invoices.setPrice(token, opened.id, opened.lines[0]!.id, {
          expectedVersion: opened.version,
          unitPriceVnd: '100000',
        });
      };

      await suite.test(
        'two invoices of one payer finalized together: each freezes the tier of the same balance',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const payer = await member(1_000);
            const first = await openPriced(payer);
            const second = await openPriced(payer, b.token);
            const results = await race(
              () => invoices.finalize(a.token, first.id, { expectedVersion: first.version }),
              () => invoices.finalize(b.token, second.id, { expectedVersion: second.version }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK']);
            for (const invoice of [first, second]) {
              const snapshot = await database.invoiceLoyaltySnapshot.findUniqueOrThrow({
                where: { invoiceId: invoice.id },
              });
              assert.deepEqual(
                [
                  snapshot.tier,
                  snapshot.balanceBefore,
                  snapshot.memberDiscountBp,
                  snapshot.winnerSource,
                ],
                ['GOLD', 1_000, 400, 'MEMBER_TIER'],
              );
              const stored = await database.invoice.findUniqueOrThrow({
                where: { id: invoice.id },
              });
              assert.equal(stored.discountTotalVnd, snapshot.memberAmountVnd);
              assert.equal(stored.discountTotalVnd, 4_000n);
              assert.equal(stored.totalVnd, 96_000n);
              assert.equal(stored.calculationVersion, 2);
            }
          }
        },
      );

      await suite.test(
        'finalization racing a balance change: the snapshot is the balance before or after, with its own tier',
        async () => {
          const seen = new Set<string>();
          for (let round = 0; round < 6; round += 1) {
            const payer = await member(450);
            const draft = await openPriced(payer);
            const [finalize, earn] = await Promise.allSettled([
              invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              database.$transaction(
                (tx) =>
                  appendLedgerEntry(tx, {
                    userId: payer,
                    wallet: 'SPA',
                    kind: 'MANUAL_ADJUSTMENT',
                    points: 100,
                    idempotencyKey: `MR:${payer}:earn`,
                    reason: 'Race',
                    // A different actor than the finalizer: the production command frame serializes one actor on its own user row.
                    actorUserId: ktv.id,
                  }),
                { timeout: 30_000, maxWait: 10_000 },
              ),
            ]);
            assert.equal(outcome(finalize), 'OK');
            assert.equal(
              earn.status,
              'fulfilled',
              earn.status === 'rejected' ? String(earn.reason) : '',
            );
            const snapshot = await database.invoiceLoyaltySnapshot.findUniqueOrThrow({
              where: { invoiceId: draft.id },
            });
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
            // Either the tier before the 100 points (none, 450) or after (Silver 3%, 550); never a mix.
            const expected =
              snapshot.balanceBefore === 450
                ? ['NONE', 0, 0n]
                : snapshot.balanceBefore === 550
                  ? ['SILVER', 300, 3_000n]
                  : null;
            assert.ok(expected, `unexpected balance ${snapshot.balanceBefore}`);
            assert.deepEqual(
              [snapshot.tier, snapshot.memberDiscountBp, stored.discountTotalVnd],
              expected,
            );
            seen.add(String(snapshot.balanceBefore));
          }
          assert.ok(seen.size >= 1);
        },
      );

      await suite.test(
        'a manual adjustment racing a finalization of the same payer: no deadlock, a consistent snapshot',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const payer = await member(450);
            const draft = await openPriced(payer);
            const results = await race(
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              () =>
                loyaltyService.adjust(adjuster.token, payer, {
                  wallet: 'SPA',
                  points: -50,
                  reason: 'Race: trừ điểm khi chốt hóa đơn',
                  clientRequestId: randomUUID(),
                }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const snapshot = await database.invoiceLoyaltySnapshot.findUniqueOrThrow({
              where: { invoiceId: draft.id },
            });
            // The finalization read the balance either before (450) or after (400) the deduction; never a mix.
            assert.ok([450, 400].includes(snapshot.balanceBefore), String(snapshot.balanceBefore));
            assert.equal(snapshot.tier, 'NONE');
            const wallet = await database.loyaltyWalletAccount.findUniqueOrThrow({
              where: { userId_wallet: { userId: payer, wallet: 'SPA' } },
            });
            assert.equal(wallet.balancePoints, 400);
          }
        },
      );

      await suite.test(
        'cancellation racing finalization of a member invoice: one terminal outcome, snapshot kept',
        async () => {
          const payer = await member(1_000);
          const draft = await openPriced(payer);
          const results = await race(
            () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
            () =>
              invoices.cancel(b.token, draft.id, {
                expectedVersion: draft.version,
                reason: 'Race',
              }),
          );
          const codes = results.map(outcome);
          assert.equal(codes.filter((code) => code === 'OK').length, 1, codes.join());
          const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
          const snapshots = await database.invoiceLoyaltySnapshot.count({
            where: { invoiceId: draft.id },
          });
          if (codes[0] === 'OK') {
            assert.equal(stored.status, 'PENDING_PAYMENT');
            assert.equal(snapshots, 1);
          } else {
            assert.equal(stored.status, 'CANCELLED');
            assert.equal(snapshots, 0);
          }
        },
      );
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const visits = (
              await tx.visit.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((v) => v.id);
            const invoiceRows = (
              await tx.invoice.findMany({
                where: { visitId: { in: visits } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const lines = (
              await tx.visitServiceLine.findMany({
                where: { visitId: { in: visits } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const executionRows = (
              await tx.serviceExecution.findMany({
                where: { visitServiceLineId: { in: lines } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const ledgerIds = (
              await tx.loyaltyLedgerEntry.findMany({
                where: { userId: { in: memberIds } },
                select: { id: true },
              })
            ).map((v) => v.id);
            await tx.invoiceLoyaltySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.loyaltyLedgerEntry.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.loyaltyWalletAccount.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: ledgerIds } },
                  { aggregateId: { in: [...invoiceRows, ...visits, ...executionRows] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { actorUserId: { in: userIds } },
                  { subjectUserId: { in: memberIds } },
                ],
              },
            });
            await tx.invoiceLineService.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
            await tx.serviceExecution.deleteMany({ where: { id: { in: executionRows } } });
            await tx.visitServiceLine.deleteMany({ where: { id: { in: lines } } });
            await tx.visitParticipant.deleteMany({ where: { visitId: { in: visits } } });
            await tx.visit.deleteMany({ where: { id: { in: visits } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({ where: { roleId: ids.role } });
            await tx.rolePermission.deleteMany({ where: { roleId: ids.adjustRole } });
            await tx.role.deleteMany({ where: { id: { in: [ids.role, ids.adjustRole] } } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.customerProfile.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.user.deleteMany({ where: { id: { in: [...userIds, ...memberIds] } } });
            if (installedGoLive) await tx.loyaltyGoLive.deleteMany({});
            await tx.service.deleteMany({ where: { id: ids.service } });
            await tx.serviceCategory.deleteMany({ where: { id: ids.category } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 30_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
