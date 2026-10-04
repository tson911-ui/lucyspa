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

/**
 * Phase 5 P5-7 combo races on separate committed PostgreSQL connections with real production service calls: the same paid event
 * processed by two workers, a payment reversed while the worker is issuing the combo, and a combo edited while its sale is
 * finalized. Requires an explicitly opted-in local scratch/validation database (replica-role cleanup of permanent financial
 * history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 5 P5-7 combo races: one issuance per paid episode, a reversal never leaves a live combo, edits serialize with sales',
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
    const combos = new ComboService(adapter, throttle);
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      sellRole: randomUUID(),
      collectRole: randomUUID(),
      correctRole: randomUUID(),
      defineRole: randomUUID(),
    };
    const userIds: string[] = [];
    const memberIds: string[] = [];
    const sessionIds: string[] = [];
    const comboIds: string[] = [];
    const invoiceIds: string[] = [];
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
            code: `CBR_${run}`,
            name: 'Combo race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `CBR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `CBR_SVC_${run}`,
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
              code: `CBR_${name}_${run}`,
              displayNameVi: name,
              displayNameEn: name,
              permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
            },
          });
        };
        await role(ids.sellRole, 'SELL', ['VIEW_INVOICES', 'MANAGE_INVOICES', 'SELL_COMBOS']);
        await role(ids.collectRole, 'COLLECT', ['VIEW_INVOICES', 'COLLECT_PAYMENTS']);
        await role(ids.correctRole, 'CORRECT', ['VIEW_INVOICES', 'CORRECT_PAYMENTS']);
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
              phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `CBR_${run}_${++serial}`,
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
          // Reversing a payment needs a fresh password confirmation.
          const confirmed = await sessions.rotateAuthenticated(
            issued.token,
            principal,
            { reauthenticated: true },
            tx,
          );
          sessionIds.push(confirmed.session.id);
          return { id, token: confirmed.token };
        });
      const seller = await staff(ids.sellRole);
      const collector = await staff(ids.collectRole);
      const corrector = await staff(ids.correctRole, 'BRANCH', true);
      const definer = await staff(ids.defineRole, 'GLOBAL');
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
            emailCanonical: `cbr-${id}@example.com`,
            emailDelivery: `cbr-${id}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-06-15'), address: 'Fixture' },
            },
          },
        });
        return id;
      };
      const newCombo = async (priceVnd = '200000') => {
        const created = await combos.create(definer.token, {
          serviceId: ids.service,
          nameVi: 'Combo đua',
          nameEn: 'Race combo',
          paidSessions: 2,
          bonusSessions: 1,
          priceVnd,
          active: true,
        });
        comboIds.push(created.id);
        return created;
      };
      const saleOf = async (comboId: string, payer: string) => {
        const opened = (
          await invoices.openComboSale(seller.token, ids.branch, { comboId, payerUserId: payer })
        ).invoice;
        invoiceIds.push(opened.id);
        return opened;
      };
      const finalized = async (comboId: string, payer: string) => {
        const draft = await saleOf(comboId, payer);
        return invoices.finalize(seller.token, draft.id, { expectedVersion: draft.version });
      };
      const pay = (invoice: { id: string; totalVnd: string }) =>
        invoices.recordPayment(collector.token, invoice.id, {
          method: 'CASH',
          amountVnd: invoice.totalVnd,
          tenderedVnd: invoice.totalVnd,
          idempotencyKey: randomUUID(),
        });
      /** Handles every pending loyalty event of the invoice, oldest first, each in its own transaction. */
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
      /** The same work as `drain`, as ONE transaction that takes part in the race latch like a production command. */
      const drainLatched = (invoiceId: string) =>
        withTransaction(async (tx) => {
          const events = await tx.outboxEvent.findMany({
            where: {
              aggregateId: invoiceId,
              eventType: { in: LOYALTY_EVENT_TYPES },
              consumptions: { none: { consumer: 'loyalty' } },
            },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            select: { id: true },
          });
          for (const event of events) await processLoyaltyEvent(tx, event.id);
        });
      const purchasesOf = (invoiceId: string) =>
        database.comboPurchase.findMany({
          where: { invoiceLine: { invoiceId } },
          orderBy: { paidSeq: 'asc' },
          include: { sessions: true },
        });
      const balanceOf = async (userId: string) =>
        (
          await database.loyaltyWalletAccount.findUnique({
            where: { userId_wallet: { userId, wallet: 'SPA' } },
          })
        )?.balancePoints ?? 0;

      await suite.test(
        'the same paid event handled by two workers at once: exactly one combo and one earn',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const payer = await member();
            const invoice = await finalized((await newCombo()).id, payer);
            await pay(invoice);
            const event = await database.outboxEvent.findFirstOrThrow({
              where: { aggregateId: invoice.id, eventType: 'INVOICE_PAID' },
              select: { id: true },
            });
            const work = () =>
              database.$transaction((tx) => processLoyaltyEvent(tx, event.id), { timeout: 30_000 });
            const results = await Promise.all([work(), work()]);
            assert.deepEqual([...results].sort(), ['APPLIED', 'NOT_CLAIMED'], `round ${round}`);
            const purchases = await purchasesOf(invoice.id);
            assert.equal(purchases.length, 1);
            assert.equal(purchases[0]!.sessions.length, 3);
            assert.equal(await balanceOf(payer), 200, 'points earned once');
          }
        },
      );

      await suite.test(
        'a payment reversed while the worker issues the combo: whatever the order, no live combo and no points remain',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const payer = await member();
            const invoice = await finalized((await newCombo()).id, payer);
            const paid = await pay(invoice);
            const results = await race(
              () => drainLatched(invoice.id),
              () =>
                invoices.reversePayment(corrector.token, invoice.id, paid.payment.id, {
                  reason: 'Thu nhầm',
                }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            await drain(invoice.id);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            assert.equal(stored.status, 'PENDING_PAYMENT');
            const purchases = await purchasesOf(invoice.id);
            assert.ok(purchases.length <= 1, 'at most the one issued before the reversal');
            for (const purchase of purchases) {
              assert.ok(purchase.voidedAt, `round ${round}: a reopened sale keeps no live combo`);
              assert.equal(purchase.sessions.length, 3, 'the history stays');
            }
            assert.equal(await balanceOf(payer), 0, `round ${round}: points taken back`);
            // Paying again issues exactly one new combo.
            await pay({ id: invoice.id, totalVnd: invoice.totalVnd });
            await drain(invoice.id);
            const after = await purchasesOf(invoice.id);
            assert.equal(after.filter((purchase) => purchase.voidedAt === null).length, 1);
            assert.equal(after.at(-1)!.paidSeq, 2);
          }
        },
      );

      await suite.test(
        'the Owner changing a combo while its sale is finalized: the sale completes as sold or is told the combo changed, never a mix',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const payer = await member();
            const combo = await newCombo('200000');
            const draft = await saleOf(combo.id, payer);
            const results = await race(
              () => invoices.finalize(seller.token, draft.id, { expectedVersion: draft.version }),
              () =>
                combos.addVersion(definer.token, combo.id, {
                  expectedVersionNo: combo.current.versionNo,
                  nameVi: combo.current.nameVi,
                  nameEn: combo.current.nameEn,
                  paidSessions: combo.current.paidSessions,
                  bonusSessions: combo.current.bonusSessions,
                  priceVnd: '250000',
                  active: true,
                }),
            );
            const [finalizing, saving] = results.map(outcome);
            assert.equal(saving, 'OK', `round ${round}: the save always succeeds`);
            assert.ok(
              ['OK', 'COMBO_CHANGED'].includes(finalizing!),
              `round ${round}: ${finalizing}`,
            );
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
            if (finalizing === 'OK') {
              assert.equal(stored.status, 'PENDING_PAYMENT');
              assert.equal(stored.totalVnd, 200_000n, 'sold at the price it was created with');
            } else {
              assert.equal(stored.status, 'DRAFT');
            }
            const line = await database.invoiceLineCombo.findUniqueOrThrow({
              where: { invoiceId: draft.id },
            });
            assert.equal(line.priceVnd, 200_000n);
          }
        },
      );
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const invoiceRows = (
              await tx.invoice.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((row) => row.id);
            const purchaseRows = (
              await tx.comboPurchase.findMany({
                where: { invoiceLine: { invoiceId: { in: invoiceRows } } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const eventRows = (
              await tx.outboxEvent.findMany({
                where: {
                  OR: [
                    { branchId: ids.branch },
                    { aggregateId: { in: [...invoiceRows, ...purchaseRows] } },
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
                ],
              },
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
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.comboVersion.deleteMany({ where: { comboId: { in: comboIds } } });
            await tx.combo.deleteMany({ where: { id: { in: comboIds } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({
              where: {
                roleId: { in: [ids.sellRole, ids.collectRole, ids.correctRole, ids.defineRole] },
              },
            });
            await tx.role.deleteMany({
              where: {
                id: { in: [ids.sellRole, ids.collectRole, ids.correctRole, ids.defineRole] },
              },
            });
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
