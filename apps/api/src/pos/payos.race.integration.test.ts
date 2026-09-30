import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  createPayosSimulator,
  parseApiEnvironment,
  reconcilePendingPayments,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';
import { PayosWebhookService } from './payos.webhook.js';

/**
 * Phase 4 Step 8 PayOS races (simulated provider) on separate committed PostgreSQL connections with real
 * production service calls. A two-party latch releases only after both transactions hold the shared auth-graph lock; every
 * other lock (users, session, visit, invoice) is taken by production code. Requires an explicitly opted-in
 * local superuser validation database (replica-role cleanup of permanent financial history); cleanup is
 * bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 4 Step 8 PostgreSQL races keep PayOS confirmations, cash and the invoice status consistent',
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
    const simulator = createPayosSimulator();
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
      simulator.provider,
    );
    const webhook = new PayosWebhookService(
      {
        client: {
          $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            database.$transaction(
              async (tx) => {
                if (meet) await meet();
                return work(tx);
              },
              { timeout: 30_000, maxWait: 10_000 },
            ),
        },
      } as never,
      simulator.provider,
      null,
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
      // Only the first two transactions to arrive are latched (a command may open a second one later).
      meet = async () => {
        if (count < 2 && ++count === 2) release();
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
            code: `PYR_${run}`,
            name: 'Payment race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `PYR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `PYR_SVC_${run}`,
            categoryId: ids.category,
            nameVi: 'Race',
            nameEn: 'Race',
            priceVnd: 100_000n,
            priceMaxVnd: 100_000n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
          },
        });
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: {
            code: {
              in: [
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'CANCEL_INVOICES',
                'COLLECT_PAYMENTS',
                'CORRECT_PAYMENTS',
              ],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 5);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `PYR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const staff = (withRole: boolean, reauthenticated = false) =>
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
                  employeeCodeCanonical: `PYR_${run}_${++serial}`,
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
          if (!reauthenticated) return { id, token: issued.token };
          // A password confirmation rotates the authenticated session (fresh re-authentication).
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
      let slot = 0;
      /** A COMPLETED visit with one performed (DONE) line, committed. */
      const completedVisit = () =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `PYR-${run}-${++serial}`,
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
              serviceCode: `PYR_SVC_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 100_000n,
              catalogPriceMaxVnd: 100_000n,
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

      const pay = (
        actor: { token: string },
        invoiceId: string,
        amount: number,
        idempotencyKey: string = randomUUID(),
      ) =>
        invoices.recordPayment(actor.token, invoiceId, {
          method: 'CASH',
          amountVnd: String(amount),
          tenderedVnd: String(amount),
          idempotencyKey,
        });
      /** A finalized invoice of 100,000 VND awaiting payment (the exact-price line is priced at creation). */
      const pending = async () => {
        const visitId = await completedVisit();
        const { invoice } = await invoices.open(a.token, visitId);
        const finalized = await invoices.finalize(a.token, invoice.id, {
          expectedVersion: invoice.version,
        });
        assert.equal(finalized.status, 'PENDING_PAYMENT');
        assert.equal(finalized.totalVnd, '100000');
        return finalized;
      };
      const effective = async (invoiceId: string) => {
        const payments = await database.payment.findMany({
          where: { invoiceId, correction: null, status: 'SUCCEEDED' },
        });
        return payments.reduce((sum, payment) => sum + payment.amountVnd, 0n);
      };

      const payos = (actor: { token: string }, invoiceId: string, amount: number) =>
        invoices.createPayos(actor.token, invoiceId, {
          amountVnd: String(amount),
          idempotencyKey: randomUUID(),
        });
      const orderOf = async (paymentId: string) =>
        Number(
          (await database.payment.findUniqueOrThrow({ where: { id: paymentId } }))
            .providerOrderCode,
        );
      const deliver = (body: unknown) => webhook.receive(body);
      const succeededOf = (invoiceId: string) =>
        database.payment.findMany({
          where: { invoiceId, status: 'SUCCEEDED' },
          orderBy: { collectedAt: 'asc' },
        });

      await suite.test(
        'the same PayOS notification delivered twice at once: one credit, one audit, one event, one inbox row',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const invoice = await pending();
            const made = await payos(a, invoice.id, 100_000);
            const orderCode = await orderOf(made.payment.id);
            const body = simulator.pay(orderCode);
            const results = await race(
              () => deliver(body),
              () => deliver(body),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK']);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            assert.equal(stored.status, 'PAID');
            assert.equal(stored.paidSeq, 1);
            assert.equal((await succeededOf(invoice.id)).length, 1);
            assert.equal(await auditCount(invoice.id, 'PAYMENT_PROVIDER_CONFIRMED'), 1);
            assert.equal(await auditCount(invoice.id, 'INVOICE_PAID'), 1);
            assert.equal(await eventCount(invoice.id, 'INVOICE_PAID'), 1);
            assert.equal(
              await database.outboxEvent.count({
                where: { aggregateId: made.payment.id, eventType: 'PAYMENT_SUCCEEDED' },
              }),
              1,
            );
            assert.equal(
              await database.paymentProviderEvent.count({
                where: { orderCode: BigInt(orderCode) },
              }),
              1,
            );
          }
        },
      );

      await suite.test(
        'a notification racing a staff cancel of a request the customer already paid: credited exactly once',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const invoice = await pending();
            const made = await payos(a, invoice.id, 100_000);
            const orderCode = await orderOf(made.payment.id);
            const body = simulator.pay(orderCode);
            const results = await race(
              () => deliver(body),
              () => invoices.cancelPayos(b.token, invoice.id, made.payment.id),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK']);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            assert.equal(stored.status, 'PAID');
            assert.equal(stored.paidSeq, 1);
            const succeeded = await succeededOf(invoice.id);
            assert.equal(succeeded.length, 1, 'never credited twice');
            assert.equal(succeeded[0]!.lateOfPaymentId, null);
            assert.equal(await auditCount(invoice.id, 'PAYMENT_PROVIDER_CONFIRMED'), 1);
            assert.equal(await eventCount(invoice.id, 'INVOICE_PAID'), 1);
            assert.equal(await effective(invoice.id), 100_000n);
          }
        },
      );

      await suite.test(
        'a notification racing cash for the rest of the balance: both applied, or cash refused; never overpaid',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const invoice = await pending();
            const made = await payos(a, invoice.id, 60_000);
            const orderCode = await orderOf(made.payment.id);
            const body = simulator.pay(orderCode);
            // Even rounds: cash takes exactly the rest (40,000). Odd rounds: cash asks for more than the rest.
            const cash = round % 2 === 0 ? 40_000 : 50_000;
            const results = await race(
              () => deliver(body),
              () => pay(b, invoice.id, cash),
            );
            const [confirmation, cashOutcome] = results.map(outcome);
            assert.equal(confirmation, 'OK');
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            const paid = await effective(invoice.id);
            assert.ok(paid <= 100_000n, `never overpaid: ${paid}`);
            if (cash === 40_000) {
              assert.equal(cashOutcome, 'OK');
              assert.equal(paid, 100_000n);
              assert.equal(stored.status, 'PAID');
              assert.equal(stored.paidSeq, 1);
              assert.equal(await eventCount(invoice.id, 'INVOICE_PAID'), 1);
              assert.equal(await auditCount(invoice.id, 'INVOICE_PAID'), 1);
            } else {
              assert.ok(
                ['PAYMENT_PROVIDER_PENDING', 'PAYMENT_AMOUNT_INVALID'].includes(cashOutcome!),
                String(cashOutcome),
              );
              assert.equal(paid, 60_000n);
              assert.equal(stored.status, 'PENDING_PAYMENT');
            }
          }
        },
      );

      await suite.test(
        'two staff creating a PayOS request at once: exactly one request, one provider call',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const invoice = await pending();
            const before = simulator.calls.filter(
              (call) => call === 'POST /v2/payment-requests',
            ).length;
            const results = await race(
              () => payos(a, invoice.id, 100_000),
              () => payos(b, invoice.id, 100_000),
            );
            assert.deepEqual(results.map(outcome).sort(), ['OK', 'PAYMENT_PROVIDER_PENDING']);
            assert.equal(
              await database.payment.count({ where: { invoiceId: invoice.id, status: 'PENDING' } }),
              1,
            );
            assert.equal(
              simulator.calls.filter((call) => call === 'POST /v2/payment-requests').length -
                before,
              1,
            );
          }
        },
      );

      await suite.test(
        'a notification and the worker sweep settling the same request at once: credited once',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const invoice = await pending();
            const made = await payos(a, invoice.id, 100_000);
            const orderCode = await orderOf(made.payment.id);
            const body = simulator.pay(orderCode);
            const later = new Date(Date.now() + 10 * 60_000);
            const [notification, swept] = await Promise.allSettled([
              deliver(body),
              reconcilePendingPayments(database, simulator.provider, { now: later }),
            ]);
            assert.equal(outcome(notification), 'OK');
            assert.equal(swept.status, 'fulfilled');
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            assert.equal(stored.status, 'PAID');
            assert.equal(stored.paidSeq, 1);
            assert.equal((await succeededOf(invoice.id)).length, 1);
            assert.equal(await auditCount(invoice.id, 'PAYMENT_PROVIDER_CONFIRMED'), 1);
            assert.equal(await eventCount(invoice.id, 'INVOICE_PAID'), 1);
            assert.equal(await effective(invoice.id), 100_000n);
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
            const paymentRows = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const orderCodes = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows }, providerOrderCode: { not: null } },
                select: { providerOrderCode: true },
              })
            ).map((v) => v.providerOrderCode!);
            await tx.paymentAnomaly.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.paymentProviderEvent.deleteMany({ where: { orderCode: { in: orderCodes } } });
            await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentCorrection.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.payment.deleteMany({ where: { id: { in: paymentRows } } });
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
