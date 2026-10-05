import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { LOYALTY_EVENT_TYPES, parseApiEnvironment, processLoyaltyEvent } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import { ComboService } from './combo.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-8 combo-use races on separate committed PostgreSQL connections with real production service calls (design 16): two
 * invoices finalized for the last session of one combo, the sale of a combo reversed while a use is finalized, a mistaken use
 * restored while its invoice is cancelled, and the same re-payment event handled by two workers. Requires an explicitly opted-in
 * local scratch/validation database (replica-role cleanup of permanent financial history); cleanup is bounded to this
 * invocation's exact UUIDs.
 */
test(
  'Phase 5 P5-8 combo use races: one session per use, a reversal never loses a use, a restoration never doubles a release',
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
    const adapter = {
      withTransaction,
      withExclusiveTransaction: withTransaction,
      resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
        sessions.resolveForMutation(token, tx),
    };
    const throttle = new AuthThrottleService(environment);
    const invoices = new InvoiceService(adapter, throttle, environment);
    const combos = new ComboService(adapter, throttle, environment);
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      useRole: randomUUID(),
      sellRole: randomUUID(),
      collectRole: randomUUID(),
      correctRole: randomUUID(),
      cancelRole: randomUUID(),
      restoreRole: randomUUID(),
      defineRole: randomUUID(),
    };
    const roleIds = Object.entries(ids)
      .filter(([key]) => key.endsWith('Role'))
      .map(([, value]) => value);
    const userIds: string[] = [];
    const memberIds: string[] = [];
    const sessionIds: string[] = [];
    const comboIds: string[] = [];
    let installedGoLive = false;
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
            code: `CUR_${run}`,
            name: 'Combo use race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `CUR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `CUR_SVC_${run}`,
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
        const role = async (id: string, name: string, codes: string[]) => {
          const permissions = await tx.permission.findMany({
            where: { code: { in: codes as never[] } },
            select: { id: true },
          });
          await tx.role.create({
            data: {
              id,
              code: `CUR_${name}_${run}`,
              displayNameVi: name,
              displayNameEn: name,
              permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
            },
          });
        };
        await role(ids.useRole, 'USE', [
          'VIEW_INVOICES',
          'MANAGE_INVOICES',
          'CONSUME_COMBO_SESSIONS',
        ]);
        await role(ids.sellRole, 'SELL', ['VIEW_INVOICES', 'MANAGE_INVOICES', 'SELL_COMBOS']);
        await role(ids.collectRole, 'COLLECT', ['VIEW_INVOICES', 'COLLECT_PAYMENTS']);
        await role(ids.correctRole, 'CORRECT', ['VIEW_INVOICES', 'CORRECT_PAYMENTS']);
        await role(ids.cancelRole, 'CANCEL', ['VIEW_INVOICES', 'CANCEL_INVOICES']);
        await role(ids.restoreRole, 'RESTORE', ['RESTORE_COMBO_SESSIONS']);
        await role(ids.defineRole, 'DEFINE', ['MANAGE_COMBOS']);
      });
      const staff = (roleId: string, scope: 'BRANCH' | 'GLOBAL' = 'BRANCH', fresh = false) =>
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
                  employeeCodeCanonical: `CUR_${run}_${++serial}`,
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
          await tx.userRoleAssignment.create({
            data:
              scope === 'GLOBAL'
                ? { userId: id, roleId, scopeKind: 'GLOBAL', branchId: null }
                : { userId: id, roleId, scopeKind: 'BRANCH', branchId: ids.branch },
          });
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
          if (!fresh) return { id, token: issued.token };
          const confirmed = await sessions.rotateAuthenticated(
            issued.token,
            principal,
            { reauthenticated: true },
            tx,
          );
          sessionIds.push(confirmed.session.id);
          return { id, token: confirmed.token };
        });
      const user = await staff(ids.useRole);
      const user2 = await staff(ids.useRole);
      const seller = await staff(ids.sellRole);
      const collector = await staff(ids.collectRole);
      const corrector = await staff(ids.correctRole, 'BRANCH', true);
      const canceller = await staff(ids.cancelRole, 'BRANCH', true);
      const restorer = await staff(ids.restoreRole, 'GLOBAL', true);
      const definer = await staff(ids.defineRole, 'GLOBAL');
      const ktv = await staff(ids.useRole);
      if ((await database.loyaltyGoLive.count()) === 0) {
        await database.loyaltyGoLive.create({ data: { activatedByUserId: seller.id } });
        installedGoLive = true;
      }
      const member = async () => {
        const id = randomUUID();
        memberIds.push(id);
        await database.user.create({
          data: {
            id,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: 'Race member',
            preferredLocale: 'vi',
            emailCanonical: `cur-${id}@example.com`,
            emailDelivery: `cur-${id}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-06-15'), address: 'Fixture' },
            },
          },
        });
        return id;
      };
      let slot = 0;
      const completedVisit = (recipient: string) =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `CUR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              ownerUserId: null,
              serviceDate: new Date('2027-03-01T00:00:00.000Z'),
              arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
              createdByUserId: seller.id,
              idempotencyKey: randomUUID(),
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'MEMBER', customerUserId: recipient },
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
              serviceCode: `CUR_SVC_${run}`,
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
      const newCombo = async (paid = 1, bonus = 1) => {
        const created = await combos.create(definer.token, {
          serviceId: ids.service,
          nameVi: 'Combo đua',
          nameEn: 'Race combo',
          paidSessions: paid,
          bonusSessions: bonus,
          priceVnd: '200000',
          active: true,
        });
        comboIds.push(created.id);
        return created;
      };
      const drain = async (invoiceId: string) => {
        const events = await database.outboxEvent.findMany({
          where: {
            aggregateId: invoiceId,
            eventType: { in: LOYALTY_EVENT_TYPES },
            consumptions: { none: { consumer: 'loyalty' } },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        for (const event of events) {
          await database.$transaction((tx) => processLoyaltyEvent(tx, event.id), {
            timeout: 30_000,
          });
        }
      };
      /** A sold, paid and issued combo of the owner. */
      const issued = async (owner: string, paid = 1, bonus = 1) => {
        const combo = await newCombo(paid, bonus);
        const draft = (
          await invoices.openComboSale(seller.token, ids.branch, {
            comboId: combo.id,
            payerUserId: owner,
          })
        ).invoice;
        const pending = await invoices.finalize(seller.token, draft.id, {
          expectedVersion: draft.version,
        });
        const payment = await invoices.recordPayment(collector.token, pending.id, {
          method: 'CASH',
          amountVnd: pending.totalVnd,
          tenderedVnd: pending.totalVnd,
          idempotencyKey: randomUUID(),
        });
        await drain(pending.id);
        const purchase = await database.comboPurchase.findFirstOrThrow({
          where: { invoiceLine: { invoiceId: pending.id } },
          include: { sessions: true },
        });
        return { sale: pending, paymentId: payment.payment.id, purchase };
      };
      /** A completed visit's draft with the combo chosen for its only line. */
      const chosenDraft = async (recipient: string, purchaseId: string, by = user) => {
        const opened = (await invoices.open(by.token, await completedVisit(recipient))).invoice;
        return invoices.comboUse(by.token, opened.id, opened.lines[0]!.id, {
          expectedVersion: opened.version,
          purchaseId,
          usedBy: 'OWNER',
        });
      };
      const activeUses = (purchaseId: string) =>
        database.comboSessionConsumption.findMany({
          where: { session: { purchaseId }, release: null, restoration: null },
          select: { id: true, sessionId: true, invoiceLine: { select: { invoiceId: true } } },
        });

      await suite.test(
        'two invoices finalized for the last session of one combo: exactly one takes it, never two on one session',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const owner = await member();
            const { purchase } = await issued(owner, 1, 0);
            assert.equal(purchase.sessions.length, 1);
            const a = await chosenDraft(owner, purchase.id, user);
            const b = await chosenDraft(owner, purchase.id, user2);
            const results = await race(
              () => invoices.finalize(user.token, a.id, { expectedVersion: a.version }),
              () => invoices.finalize(user2.token, b.id, { expectedVersion: b.version }),
            );
            const outcomes = results.map(outcome).sort();
            assert.deepEqual(outcomes, ['COMBO_NO_SESSION_LEFT', 'OK'], `round ${round}`);
            const uses = await activeUses(purchase.id);
            assert.equal(uses.length, 1, 'one session, one use');
            const loser = [a, b].find((draft) => draft.id !== uses[0]!.invoiceLine.invoiceId)!;
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: loser.id } });
            assert.equal(stored.status, 'DRAFT', 'the loser stays a draft with its choice');
          }
        },
      );

      await suite.test(
        'the sale reversed while a use is finalized: the use is taken (combo frozen) or refused, never a use on a reversed sale',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const owner = await member();
            const { sale, paymentId, purchase } = await issued(owner, 2, 1);
            const draft = await chosenDraft(owner, purchase.id);
            const results = await race(
              () => invoices.finalize(user.token, draft.id, { expectedVersion: draft.version }),
              () =>
                invoices.reversePayment(corrector.token, sale.id, paymentId, {
                  reason: 'Thu nhầm',
                }),
            );
            const [finalizing, reversing] = results.map(outcome);
            assert.equal(reversing, 'OK', `round ${round}`);
            assert.ok(
              ['OK', 'COMBO_NOT_USABLE'].includes(finalizing!),
              `round ${round}: ${finalizing}`,
            );
            await drain(sale.id);
            const stored = await database.comboPurchase.findUniqueOrThrow({
              where: { id: purchase.id },
            });
            const uses = await activeUses(purchase.id);
            if (finalizing === 'OK') {
              assert.equal(uses.length, 1, 'the use stands as history');
              assert.equal(stored.voidedAt, null, 'a combo with a use is frozen, not revoked');
            } else {
              assert.equal(uses.length, 0, 'a refused use wrote nothing');
              assert.ok(stored.voidedAt, 'an unused combo of a reversed sale is revoked');
              assert.equal(
                (await database.invoice.findUniqueOrThrow({ where: { id: draft.id } })).status,
                'DRAFT',
              );
            }
            // The sale is reversed either way: nothing can be used now.
            const another = await chosenDraft(owner, purchase.id).catch((error: unknown) => error);
            assert.ok(another instanceof AuthError && another.code === 'COMBO_NOT_USABLE');
          }
        },
      );

      await suite.test(
        'a mistaken use restored while its invoice is cancelled: one offset or one release, never both',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const owner = await member();
            const { purchase } = await issued(owner, 2, 0);
            const draft = await chosenDraft(owner, purchase.id);
            const done = await invoices.finalize(user.token, draft.id, {
              expectedVersion: draft.version,
            });
            assert.equal(done.status, 'PAID');
            const use = await database.comboSessionConsumption.findFirstOrThrow({
              where: { invoiceLine: { invoiceId: done.id } },
            });
            const results = await race(
              () => combos.restore(restorer.token, use.id, { reason: 'Nhầm' }),
              () =>
                invoices.cancel(canceller.token, done.id, {
                  expectedVersion: done.version,
                  reason: 'Hủy',
                }),
            );
            const [restoring, cancelling] = results.map(outcome);
            assert.equal(cancelling, 'OK', `round ${round}`);
            assert.ok(
              ['OK', 'COMBO_USE_NOT_RESTORABLE'].includes(restoring!),
              `round ${round}: ${restoring}`,
            );
            const [releases, restorations] = await Promise.all([
              database.comboSessionRelease.count({ where: { consumptionId: use.id } }),
              database.comboSessionRestoration.count({ where: { consumptionId: use.id } }),
            ]);
            assert.equal(releases + restorations, 1, `round ${round}: exactly one way back`);
            assert.equal(restoring === 'OK' ? restorations : releases, 1);
            assert.equal((await activeUses(purchase.id)).length, 0, 'the session is free again');
          }
        },
      );

      await suite.test(
        'the re-payment event of a frozen combo handled by two workers at once: exactly one reopening, no second combo',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const owner = await member();
            const { sale, paymentId, purchase } = await issued(owner, 2, 1);
            const draft = await chosenDraft(owner, purchase.id);
            await invoices.finalize(user.token, draft.id, { expectedVersion: draft.version });
            await invoices.reversePayment(corrector.token, sale.id, paymentId, {
              reason: 'Thu nhầm',
            });
            await drain(sale.id);
            await invoices.recordPayment(collector.token, sale.id, {
              method: 'CASH',
              amountVnd: sale.totalVnd,
              tenderedVnd: sale.totalVnd,
              idempotencyKey: randomUUID(),
            });
            const event = await database.outboxEvent.findFirstOrThrow({
              where: {
                aggregateId: sale.id,
                eventType: 'INVOICE_PAID',
                consumptions: { none: { consumer: 'loyalty' } },
              },
              select: { id: true },
            });
            const work = () =>
              database.$transaction((tx) => processLoyaltyEvent(tx, event.id), { timeout: 30_000 });
            const results = await Promise.all([work(), work()]);
            assert.deepEqual([...results].sort(), ['APPLIED', 'NOT_CLAIMED'], `round ${round}`);
            const all = await database.comboPurchase.findMany({
              where: { invoiceLine: { invoiceId: sale.id } },
              include: { reopenings: true },
            });
            assert.equal(all.length, 1, 'no second combo');
            assert.equal(all[0]!.reopenings.length, 1, 'one reopening');
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
            ).map((row) => row.id);
            const invoiceRows = (
              await tx.invoice.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((row) => row.id);
            const lines = (
              await tx.visitServiceLine.findMany({
                where: { visitId: { in: visits } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const executionRows = (
              await tx.serviceExecution.findMany({
                where: { visitServiceLineId: { in: lines } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const purchaseRows = (
              await tx.comboPurchase.findMany({
                where: { invoiceLine: { invoiceId: { in: invoiceRows } } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const consumptionRows = (
              await tx.comboSessionConsumption.findMany({
                where: { session: { purchaseId: { in: purchaseRows } } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const eventRows = (
              await tx.outboxEvent.findMany({
                where: {
                  OR: [
                    { branchId: ids.branch },
                    {
                      aggregateId: {
                        in: [...invoiceRows, ...purchaseRows, ...visits, ...executionRows],
                      },
                    },
                  ],
                },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.$executeRaw`DELETE FROM outbox_consumptions WHERE event_id = ANY(${eventRows}::uuid[])`;
            await tx.outboxEvent.deleteMany({ where: { id: { in: eventRows } } });
            await tx.auditEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { actorUserId: { in: userIds } },
                  { subjectUserId: { in: [...memberIds, ...userIds] } },
                  { entityType: 'Combo', entityId: { in: comboIds } },
                  { entityType: 'ComboSessionConsumption', entityId: { in: consumptionRows } },
                ],
              },
            });
            await tx.comboSessionRelease.deleteMany({
              where: { consumptionId: { in: consumptionRows } },
            });
            await tx.comboSessionRestoration.deleteMany({
              where: { consumptionId: { in: consumptionRows } },
            });
            await tx.comboSessionConsumption.deleteMany({ where: { id: { in: consumptionRows } } });
            await tx.invoiceLineComboUsage.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.comboPurchaseReopening.deleteMany({
              where: { purchaseId: { in: purchaseRows } },
            });
            await tx.comboSession.deleteMany({ where: { purchaseId: { in: purchaseRows } } });
            await tx.comboPurchase.deleteMany({ where: { id: { in: purchaseRows } } });
            await tx.$executeRaw`DELETE FROM payment_corrections WHERE payment_id IN (SELECT id FROM payments WHERE invoice_id = ANY(${invoiceRows}::uuid[]))`;
            await tx.$executeRaw`DELETE FROM payments WHERE invoice_id = ANY(${invoiceRows}::uuid[])`;
            await tx.invoiceLoyaltySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.$executeRaw`DELETE FROM loyalty_ledger_entries WHERE user_id = ANY(${memberIds}::uuid[])`;
            await tx.$executeRaw`DELETE FROM loyalty_wallets WHERE user_id = ANY(${memberIds}::uuid[])`;
            await tx.invoiceLineCombo.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineService.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.comboVersion.deleteMany({ where: { comboId: { in: comboIds } } });
            await tx.combo.deleteMany({ where: { id: { in: comboIds } } });
            await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
            await tx.serviceExecution.deleteMany({ where: { id: { in: executionRows } } });
            await tx.visitServiceLine.deleteMany({ where: { id: { in: lines } } });
            await tx.visitParticipant.deleteMany({ where: { visitId: { in: visits } } });
            await tx.visit.deleteMany({ where: { id: { in: visits } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
            await tx.role.deleteMany({ where: { id: { in: roleIds } } });
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
        assert.equal(await database.combo.count({ where: { id: { in: comboIds } } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
