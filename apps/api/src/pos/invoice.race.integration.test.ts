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
 * Phase 4 Step 5 races on separate committed PostgreSQL connections with real production service
 * calls. A two-party latch releases only after both transactions hold the shared auth-graph lock; every
 * other lock (users, session, visit, invoice) is taken by production code. Requires an explicitly opted-in
 * local superuser validation database (replica-role cleanup of permanent financial history); cleanup is
 * bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 4 Step 5 PostgreSQL races keep one authoritative invoice outcome',
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
          return { id, token: issued.token };
        });
      const ktv = await staff(false);
      const a = await staff(true);
      const b = await staff(true);
      let slot = 0;
      /** A COMPLETED visit with one performed (DONE) line, committed. */
      const completedVisit = () =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `IVR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
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
      const auditCount = (invoiceId: string, action: string) =>
        database.auditEvent.count({ where: { entityId: invoiceId, action } });
      const eventCount = (invoiceId: string, eventType: string) =>
        database.outboxEvent.count({ where: { aggregateId: invoiceId, eventType } });

      await suite.test('two creations for one completed visit: exactly one invoice', async () => {
        for (let round = 0; round < 3; round += 1) {
          const visitId = await completedVisit();
          const results = await race(
            () => invoices.open(a.token, visitId),
            () => invoices.open(b.token, visitId),
          );
          assert.deepEqual(results.map(outcome), ['OK', 'OK']);
          const opened = results.map(
            (r) =>
              (r as PromiseFulfilledResult<{ invoice: { id: string }; created: boolean }>).value,
          );
          assert.equal(opened[0]!.invoice.id, opened[1]!.invoice.id);
          assert.equal(opened.filter((o) => o.created).length, 1, 'only one of them created it');
          assert.equal(await database.invoice.count({ where: { visitId } }), 1);
          assert.equal(await auditCount(opened[0]!.invoice.id, 'INVOICE_CREATED'), 1);
          assert.equal(
            await database.invoiceLineService.count({
              where: { invoiceId: opened[0]!.invoice.id },
            }),
            1,
          );
        }
      });

      await suite.test(
        'double finalization: one financial outcome, one audit, one event',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const visitId = await completedVisit();
            const { invoice } = await invoices.open(a.token, visitId);
            const priced = await invoices.setPrice(a.token, invoice.id, invoice.lines[0]!.id, {
              expectedVersion: invoice.version,
              unitPriceVnd: '120000',
            });
            const results = await race(
              () => invoices.finalize(a.token, invoice.id, { expectedVersion: priced.version }),
              () => invoices.finalize(a.token, invoice.id, { expectedVersion: priced.version }),
            );
            const codes = results.map(outcome);
            assert.ok(codes.includes('OK'), codes.join());
            assert.ok(
              codes.every((code) => ['OK', 'CONFLICT', 'INVOICE_STATE_INVALID'].includes(code)),
              codes.join(),
            );
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            assert.equal(stored.status, 'PENDING_PAYMENT');
            assert.equal(stored.totalVnd, 120_000n);
            assert.equal(stored.rowVersion, priced.version + 1);
            assert.equal(await auditCount(invoice.id, 'INVOICE_FINALIZED'), 1);
            assert.equal(await eventCount(invoice.id, 'INVOICE_FINALIZED'), 1);
          }
        },
      );

      await suite.test(
        'price change racing finalization: totals always equal the frozen lines',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const visitId = await completedVisit();
            const { invoice } = await invoices.open(a.token, visitId);
            const lineId = invoice.lines[0]!.id;
            const priced = await invoices.setPrice(a.token, invoice.id, lineId, {
              expectedVersion: invoice.version,
              unitPriceVnd: '110000',
            });
            const results = await race(
              () =>
                invoices.setPrice(a.token, invoice.id, lineId, {
                  expectedVersion: priced.version,
                  unitPriceVnd: '140000',
                }),
              () => invoices.finalize(b.token, invoice.id, { expectedVersion: priced.version }),
            );
            const [price, finalize] = results.map(outcome);
            const stored = await database.invoice.findUniqueOrThrow({
              where: { id: invoice.id },
              include: { lines: true },
            });
            const line = stored.lines[0]!;
            // Both carry the same expectedVersion, so exactly one wins; the stored totals equal the winning line.
            assert.equal([price, finalize].filter((code) => code === 'OK').length, 1);
            if (finalize === 'OK') {
              assert.equal(stored.status, 'PENDING_PAYMENT');
              assert.equal(line.unitPriceVnd, 110_000n);
              assert.equal(stored.totalVnd, 110_000n);
              assert.equal(stored.rowVersion, priced.version + 1);
            } else {
              assert.equal(stored.status, 'DRAFT');
              assert.equal(line.unitPriceVnd, 140_000n);
              assert.equal(stored.totalVnd, 140_000n);
            }
            assert.equal(stored.subtotalVnd, line.grossVnd);
          }
        },
      );

      await suite.test(
        'cancellation racing finalization: one terminal outcome, consistent audit',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const visitId = await completedVisit();
            const { invoice } = await invoices.open(a.token, visitId);
            const priced = await invoices.setPrice(a.token, invoice.id, invoice.lines[0]!.id, {
              expectedVersion: invoice.version,
              unitPriceVnd: '100000',
            });
            const results = await race(
              () =>
                invoices.cancel(b.token, invoice.id, {
                  expectedVersion: priced.version,
                  reason: 'Khách hủy',
                }),
              () => invoices.finalize(a.token, invoice.id, { expectedVersion: priced.version }),
            );
            const [cancel, finalize] = results.map(outcome);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            if (cancel === 'OK') {
              assert.equal(stored.status, 'CANCELLED');
              assert.notEqual(finalize, 'OK', `${cancel}/${finalize}`);
              assert.equal(await auditCount(invoice.id, 'INVOICE_CANCELLED'), 1);
              assert.equal(await auditCount(invoice.id, 'INVOICE_FINALIZED'), 0);
            } else {
              assert.equal(finalize, 'OK');
              assert.equal(stored.status, 'PENDING_PAYMENT');
              assert.ok(
                ['CONFLICT', 'INVOICE_STATE_INVALID', 'REAUTHENTICATION_REQUIRED'].includes(
                  cancel!,
                ),
                cancel,
              );
              assert.equal(await auditCount(invoice.id, 'INVOICE_CANCELLED'), 0);
              assert.equal(await auditCount(invoice.id, 'INVOICE_FINALIZED'), 1);
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
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
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
