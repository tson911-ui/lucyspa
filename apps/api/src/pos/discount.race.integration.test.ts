import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';

/**
 * Phase 4 Step 6 races (discounts, vouchers, redemption and release) on separate committed PostgreSQL
 * connections with real production service calls. A two-party latch releases only after both transactions hold the shared auth-graph lock; every
 * other lock (users, session, visit, invoice) is taken by production code. Requires an explicitly opted-in
 * local superuser validation database (replica-role cleanup of permanent financial history); cleanup is
 * bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 4 Step 6 PostgreSQL races keep usage limits and releases exact',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const database = createDatabaseClient(databaseUrl);
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
    };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const discountIds: string[] = [];
    const voucherIds: string[] = [];
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
            code: `IVD_${run}`,
            name: 'Discount race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `IVD_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `IVD_SVC_${run}`,
            categoryId: ids.category,
            nameVi: 'Race',
            nameEn: 'Race',
            priceVnd: 200_000n,
            priceMaxVnd: 200_000n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
          },
        });
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: {
            code: {
              in: ['VIEW_INVOICES', 'MANAGE_INVOICES', 'CANCEL_INVOICES', 'APPLY_DISCOUNTS'],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 4);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `IVD_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const staff = (withRole: boolean) =>
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
              phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `IVD_${run}_${++serial}`,
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
          if (withRole) {
            await tx.userRoleAssignment.create({
              data: { userId: id, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
            });
          }
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const principal = {
            userId: id,
            passwordHash: user.passwordHash!,
            credentialVersion: user.credentialVersion,
            authzVersion: user.authzVersion,
          };
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            principal,
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          // Cancelling a finalized invoice needs fresh re-authentication.
          const fresh = await sessions.rotateAuthenticated(
            issued.token,
            principal,
            { reauthenticated: true },
            tx,
          );
          sessionIds.push(fresh.session.id);
          return { id, token: fresh.token };
        });
      const ktv = await staff(false);
      const a = await staff(true);
      const b = await staff(true);
      const member = (label: string) =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const email = `ivd-${label}-${run.toLowerCase()}@example.com`;
          await tx.user.create({
            data: {
              id,
              kind: 'CUSTOMER',
              status: 'ACTIVE',
              fullName: `Khách ${label}`,
              preferredLocale: 'vi',
              emailCanonical: email,
              emailDelivery: email,
              emailVerifiedAt: new Date(),
              phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              customerProfile: {
                create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
              },
            },
          });
          return id;
        });
      const m1 = await member('m1');
      const m2 = await member('m2');
      let programSerial = 0;
      /** A committed, currently valid program (and optionally one voucher code) created directly. */
      const program = (options: {
        requiresCode?: boolean;
        percentBp?: number;
        fixed?: bigint;
        usageLimitTotal?: number;
        usageLimitPerCustomer?: number;
        voucherCode?: string;
      }) =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          discountIds.push(id);
          const created = await tx.discount.create({
            data: {
              id,
              code: `R${run}${++programSerial}`,
              nameVi: 'Race',
              nameEn: 'Race',
              requiresCode: options.requiresCode ?? false,
            },
          });
          await tx.discountVersion.create({
            data: {
              discountId: id,
              versionNo: 1,
              kind: options.fixed === undefined ? 'PERCENT' : 'FIXED_AMOUNT',
              percentBp: options.fixed === undefined ? (options.percentBp ?? 1000) : null,
              fixedAmountVnd: options.fixed ?? null,
              validFrom: new Date(Date.now() - 86_400_000),
              validUntil: new Date(Date.now() + 30 * 86_400_000),
              scopeMode: 'ALL_SERVICES',
              usageLimitTotal: options.usageLimitTotal ?? null,
              usageLimitPerCustomer: options.usageLimitPerCustomer ?? null,
              createdByUserId: a.id,
            },
          });
          if (options.voucherCode) {
            const voucher = await tx.voucher.create({
              data: { discountId: id, code: options.voucherCode, createdByUserId: a.id },
            });
            voucherIds.push(voucher.id);
          }
          return { id, code: created.code };
        });
      /** A pause keeps a finished scenario's program out of the next scenario's evaluations. */
      const retire = (id: string) =>
        database.discount.update({
          where: { id },
          data: { isActive: false, rowVersion: { increment: 1 } },
          select: { id: true },
        });
      const activeRedemptions = (discountId: string) =>
        database.discountRedemption.count({ where: { discountId, release: null } });
      const open = async (visitId: string, actor = a) =>
        (await invoices.open(actor.token, visitId)).invoice;
      let slot = 0;
      /** A COMPLETED visit with one performed (DONE) line, committed. */
      const completedVisit = (ownerUserId?: string) =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `IVD-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              ownerUserId: ownerUserId ?? null,
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
              serviceCode: `IVD_SVC_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 200_000n,
              catalogPriceMaxVnd: 200_000n,
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
      const auditCount = (invoiceId: string, action: string) =>
        database.auditEvent.count({ where: { entityId: invoiceId, action } });
      const eventCount = (invoiceId: string, eventType: string) =>
        database.outboxEvent.count({ where: { aggregateId: invoiceId, eventType } });

      const byAmount = (x: bigint, y: bigint) => (x < y ? -1 : x > y ? 1 : 0);

      await suite.test(
        'the last usage of a total-limited promotion goes to exactly one of two concurrent finalizations',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const promo = await program({ usageLimitTotal: 1 });
            try {
              const d1 = await open(await completedVisit(m1), a);
              const d2 = await open(await completedVisit(m2), b);
              assert.equal(d1.discountTotalVnd, '20000');
              assert.equal(d2.discountTotalVnd, '20000');
              const results = await race(
                () => invoices.finalize(a.token, d1.id, { expectedVersion: d1.version }),
                () => invoices.finalize(b.token, d2.id, { expectedVersion: d2.version }),
              );
              assert.deepEqual(results.map(outcome), ['OK', 'OK']);
              const redemptions = await database.discountRedemption.findMany({
                where: { discountId: promo.id },
              });
              assert.equal(redemptions.length, 1, 'the limit is never exceeded');
              const rows = await database.invoice.findMany({
                where: { id: { in: [d1.id, d2.id] } },
              });
              assert.deepEqual(rows.map((row) => row.discountTotalVnd).sort(byAmount), [
                0n,
                20_000n,
              ]);
              for (const row of rows) {
                assert.equal(row.status, 'PENDING_PAYMENT');
                assert.equal(row.totalVnd, row.subtotalVnd - row.discountTotalVnd);
                assert.equal(
                  redemptions[0]!.invoiceId === row.id,
                  row.discountTotalVnd === 20_000n,
                );
              }
              assert.equal(await activeRedemptions(promo.id), 1);
            } finally {
              await retire(promo.id);
            }
          }
        },
      );

      await suite.test(
        'per-customer limit: one member, two invoices finalized at once, one redemption',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const promo = await program({ usageLimitPerCustomer: 1 });
            try {
              const d1 = await open(await completedVisit(m1), a);
              const d2 = await open(await completedVisit(m1), b);
              const results = await race(
                () => invoices.finalize(a.token, d1.id, { expectedVersion: d1.version }),
                () => invoices.finalize(b.token, d2.id, { expectedVersion: d2.version }),
              );
              assert.deepEqual(results.map(outcome), ['OK', 'OK']);
              assert.equal(await activeRedemptions(promo.id), 1);
              const rows = await database.invoice.findMany({
                where: { id: { in: [d1.id, d2.id] } },
              });
              assert.deepEqual(rows.map((row) => row.discountTotalVnd).sort(byAmount), [
                0n,
                20_000n,
              ]);
            } finally {
              await retire(promo.id);
            }
          }
        },
      );

      await suite.test(
        'concurrent cancellations of one finalized invoice release its redemption exactly once',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const promo = await program({ usageLimitTotal: 5 });
            try {
              const draft = await open(await completedVisit(m1), a);
              const done = await invoices.finalize(a.token, draft.id, {
                expectedVersion: draft.version,
              });
              assert.equal(await activeRedemptions(promo.id), 1);
              const results = await race(
                () =>
                  invoices.cancel(a.token, done.id, {
                    expectedVersion: done.version,
                    reason: 'Hủy A',
                  }),
                () =>
                  invoices.cancel(b.token, done.id, {
                    expectedVersion: done.version,
                    reason: 'Hủy B',
                  }),
              );
              const codes = results.map(outcome).sort();
              assert.deepEqual(codes, ['INVOICE_STATE_INVALID', 'OK']);
              const releases = await database.discountRedemptionRelease.findMany({
                where: { redemption: { invoiceId: done.id } },
              });
              assert.equal(releases.length, 1, 'capacity returns exactly once');
              assert.equal(releases[0]!.cause, 'INVOICE_CANCELLED_UNPAID');
              assert.equal(await activeRedemptions(promo.id), 0);
              assert.equal(await auditCount(done.id, 'INVOICE_CANCELLED'), 1);
              assert.equal(await auditCount(done.id, 'DISCOUNT_REDEMPTION_RELEASED'), 1);
              assert.equal(await eventCount(done.id, 'INVOICE_CANCELLED'), 1);
              assert.equal(
                await database.discountRedemption.count({ where: { invoiceId: done.id } }),
                1,
                'the redemption row itself is never removed',
              );
            } finally {
              await retire(promo.id);
            }
          }
        },
      );

      await suite.test(
        'a release racing the next finalization never leaves the usage half-released',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const promo = await program({ usageLimitTotal: 1 });
            try {
              const first = await open(await completedVisit(m1), a);
              const finalized = await invoices.finalize(a.token, first.id, {
                expectedVersion: first.version,
              });
              const waiting = await open(await completedVisit(m2), b);
              assert.equal(waiting.discountTotalVnd, '0', 'the last usage is taken');
              const results = await race(
                () =>
                  invoices.cancel(a.token, finalized.id, {
                    expectedVersion: finalized.version,
                    reason: 'Hủy',
                  }),
                () => invoices.finalize(b.token, waiting.id, { expectedVersion: waiting.version }),
              );
              assert.deepEqual(results.map(outcome), ['OK', 'OK']);
              const stored = await database.invoice.findUniqueOrThrow({
                where: { id: waiting.id },
              });
              const redemption = await database.discountRedemption.findUnique({
                where: { invoiceId: waiting.id },
              });
              // Either the release committed first (B got the usage) or B counted it as still taken.
              assert.equal(redemption !== null, stored.discountTotalVnd === 20_000n);
              assert.equal(await activeRedemptions(promo.id), redemption ? 1 : 0);
              assert.equal(
                await database.discountRedemptionRelease.count({
                  where: { redemption: { invoiceId: finalized.id } },
                }),
                1,
              );
              assert.equal(
                (await database.invoice.findUniqueOrThrow({ where: { id: finalized.id } })).status,
                'CANCELLED',
              );
            } finally {
              await retire(promo.id);
            }
          }
        },
      );

      await suite.test(
        'supplying a voucher racing the finalization: exactly one wins, never a half-applied benefit',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const code = `RV${run}${round}`;
            const promo = await program({
              requiresCode: true,
              fixed: 50_000n,
              voucherCode: code,
            });
            try {
              const draft = await open(await completedVisit(m1), a);
              const results = await race(
                () =>
                  invoices.supplyVoucher(b.token, draft.id, {
                    expectedVersion: draft.version,
                    code,
                  }),
                () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              );
              const [supply, finalize] = results.map(outcome);
              assert.equal([supply, finalize].filter((entry) => entry === 'OK').length, 1);
              const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
              const entries = await database.invoiceVoucherEntry.count({
                where: { invoiceId: draft.id },
              });
              const applications = await database.invoiceDiscountApplication.count({
                where: { invoiceId: draft.id },
              });
              if (finalize === 'OK') {
                assert.equal(stored.status, 'PENDING_PAYMENT');
                assert.equal(entries, 0, 'the code missed the finalization');
                assert.equal(applications, 0);
                assert.equal(stored.discountTotalVnd, 0n);
              } else {
                assert.equal(stored.status, 'DRAFT');
                assert.equal(entries, 1);
                assert.equal(applications, 0, 'a draft redeems nothing');
                assert.equal(stored.discountTotalVnd, 50_000n);
              }
              assert.equal(await activeRedemptions(promo.id), 0);
            } finally {
              await retire(promo.id);
            }
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
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...invoiceRows, ...visits, ...executionRows] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.discountRedemptionRelease.deleteMany({
              where: { redemption: { discountId: { in: discountIds } } },
            });
            await tx.discountRedemption.deleteMany({ where: { discountId: { in: discountIds } } });
            await tx.invoiceDiscountApplication.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceVoucherEntry.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.voucher.deleteMany({ where: { id: { in: voucherIds } } });
            await tx.discountVersion.deleteMany({ where: { discountId: { in: discountIds } } });
            await tx.discount.deleteMany({ where: { id: { in: discountIds } } });
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
            await tx.role.deleteMany({ where: { id: ids.role } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.service.deleteMany({ where: { id: ids.service } });
            await tx.serviceCategory.deleteMany({ where: { id: ids.category } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 30_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(await database.discount.count({ where: { id: { in: discountIds } } }), 0);
        assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
