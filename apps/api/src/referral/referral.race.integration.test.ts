import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  appendLedgerEntry,
  bindReferral,
  parseApiEnvironment,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ReferralService } from './referral.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-5 referral races on separate committed PostgreSQL connections with real production service calls. A two-party latch
 * releases only after both transactions hold the shared auth-graph lock; every other lock (referral, invoice, wallets) is taken
 * by production code. Requires an explicitly opted-in local superuser validation database (replica-role cleanup of permanent
 * financial history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 5 P5-5 referral races: one award, one referrer, wallets without deadlock',
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
    const referrals = new ReferralService(
      adapter,
      new AuthThrottleService(environment),
      environment,
    );
    const invoices = new InvoiceService(adapter, new AuthThrottleService(environment), environment);
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      role: randomUUID(),
    };
    const userIds: string[] = [];
    const memberIds: string[] = [];
    const sessionIds: string[] = [];
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
    /** The consumer on one event, inside its own transaction, behind the latch. */
    const consumeEvent = (eventId: string) =>
      database.$transaction(
        async (tx) => {
          await takeSharedAuthGraphLock(tx);
          if (meet) await meet();
          return processLoyaltyEvent(tx, eventId);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    try {
      await database.$transaction(async (tx) => {
        await tx.branch.create({
          data: {
            id: ids.branch,
            code: `RFR_${run}`,
            name: 'Referral race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `RFR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `RFR_SVC_${run}`,
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
          where: {
            code: {
              in: [
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'COLLECT_PAYMENTS',
                'VIEW_LOYALTY',
                'MANAGE_REFERRALS',
              ],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 5);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `RFR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const principalOf = (user: {
        id: string;
        passwordHash: string | null;
        credentialVersion: number;
        authzVersion: number;
      }) => ({
        userId: user.id,
        passwordHash: user.passwordHash!,
        credentialVersion: user.credentialVersion,
        authzVersion: user.authzVersion,
      });
      /** A fresh (re-authenticated) session of an existing user. */
      const sessionOf = (user: Parameters<typeof principalOf>[0]) =>
        database.$transaction(async (tx) => {
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            principalOf(user),
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          const fresh = await sessions.rotateAuthenticated(
            issued.token,
            principalOf(user),
            { reauthenticated: true },
            tx,
          );
          sessionIds.push(fresh.session.id);
          return fresh.token;
        });
      const staff = async () => {
        const id = randomUUID();
        userIds.push(id);
        const user = await database.$transaction(async (tx) => {
          const created = await tx.user.create({
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
                  employeeCodeCanonical: `RFR_${run}_${++serial}`,
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
            data: { userId: id, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
          });
          return created;
        });
        return { id, token: await sessionOf(user) };
      };
      const ktv = await staff();
      const worker = await staff();
      if ((await database.loyaltyGoLive.count()) === 0) {
        await database.loyaltyGoLive.create({ data: { activatedByUserId: worker.id } });
        installedGoLive = true;
      }
      const ownerRow = await database.user.findFirst({ where: { kind: 'OWNER' } });
      const ownerToken = ownerRow ? await sessionOf(ownerRow) : null;
      const member = async () => {
        const id = randomUUID();
        memberIds.push(id);
        const phone = validVnMobile();
        await database.user.create({
          data: {
            id,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: 'Race member',
            preferredLocale: 'vi',
            emailCanonical: `rfr-${id}@example.com`,
            emailDelivery: `rfr-${id}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: phone,
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
            },
          },
        });
        return { id, phone, typed: `0${phone.slice(3)}` };
      };
      const bound = (referredId: string, referrerId: string) =>
        database.$transaction((tx) =>
          bindReferral(tx, {
            referredUserId: referredId,
            referrerUserId: referrerId,
            via: 'COUNTER',
            actorUserId: worker.id,
            branchId: ids.branch,
          }),
        );
      let slot = 0;
      /** A COMPLETED visit whose one participant is the member (the person who received the service), committed. */
      const completedVisit = (recipientId: string) =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `RFR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              ownerUserId: null,
              serviceDate: new Date('2027-03-01T00:00:00.000Z'),
              arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
              createdByUserId: worker.id,
              idempotencyKey: randomUUID(),
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'MEMBER', customerUserId: recipientId },
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
              serviceCode: `RFR_SVC_${run}`,
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
      /** A finalized, unpaid invoice of a new completed visit of the member (100,000). */
      const finalizedFor = async (recipientId: string) => {
        const opened = (await invoices.open(worker.token, await completedVisit(recipientId)))
          .invoice;
        const priced = await invoices.setPrice(worker.token, opened.id, opened.lines[0]!.id, {
          expectedVersion: opened.version,
          unitPriceVnd: '100000',
        });
        return invoices.finalize(worker.token, priced.id, { expectedVersion: priced.version });
      };
      const payIn = (invoiceId: string) =>
        invoices.recordPayment(worker.token, invoiceId, {
          method: 'CASH',
          amountVnd: '100000',
          tenderedVnd: '100000',
          idempotencyKey: randomUUID(),
        });
      const paidEventOf = async (invoiceId: string) =>
        (
          await database.outboxEvent.findFirstOrThrow({
            where: { aggregateId: invoiceId, eventType: 'INVOICE_PAID' },
            select: { id: true },
          })
        ).id;
      const awardsOf = (userId: string) =>
        database.loyaltyLedgerEntry.findMany({ where: { userId, kind: 'REFERRAL_AWARD' } });
      const balance = async (userId: string, wallet: 'SPA' | 'BEAUTY') =>
        (
          await database.loyaltyWalletAccount.findUnique({
            where: { userId_wallet: { userId, wallet } },
          })
        )?.balancePoints ?? 0;
      // Keep the unused-helper rule quiet for a seed used by other races.
      void appendLedgerEntry;

      await suite.test(
        'two consumers on one paid event: one award, the other finds the event claimed',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const referrer = await member();
            const referred = await member();
            await bound(referred.id, referrer.id);
            const invoice = await finalizedFor(referred.id);
            await payIn(invoice.id);
            const eventId = await paidEventOf(invoice.id);
            const results = await race(
              () => consumeEvent(eventId),
              () => consumeEvent(eventId),
            );
            const outcomes = results
              .map((r) => (r.status === 'fulfilled' ? r.value : 'ERROR'))
              .sort();
            assert.deepEqual(outcomes, ['APPLIED', 'NOT_CLAIMED'], `round ${round}`);
            assert.equal((await awardsOf(referrer.id)).length, 2);
            assert.equal(await balance(referrer.id, 'SPA'), 10);
            assert.equal(await balance(referrer.id, 'BEAUTY'), 10);
            assert.ok(
              (
                await database.referral.findUniqueOrThrow({
                  where: { referredUserId: referred.id },
                })
              ).awardedAt,
            );
          }
        },
      );

      await suite.test(
        'the award racing the Owner correction: the reward and the referrer always agree',
        { skip: ownerToken === null ? 'the validation database has no Owner' : false },
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const first = await member();
            const second = await member();
            const referred = await member();
            await bound(referred.id, first.id);
            const invoice = await finalizedFor(referred.id);
            await payIn(invoice.id);
            const eventId = await paidEventOf(invoice.id);
            const results = await race(
              () => consumeEvent(eventId),
              () =>
                referrals.change(ownerToken!, referred.id, {
                  referrerPhone: second.typed,
                  reason: 'Race',
                }),
            );
            assert.equal(results[0].status, 'fulfilled', `round ${round}: the award never fails`);
            const change = outcome(results[1]);
            assert.ok(['OK', 'REFERRAL_LOCKED', 'CONFLICT'].includes(change), change);
            const row = await database.referral.findUniqueOrThrow({
              where: { referredUserId: referred.id },
            });
            assert.ok(row.awardedAt, 'the first paid visit is rewarded either way');
            const credited = (await awardsOf(first.id)).length + (await awardsOf(second.id)).length;
            assert.equal(credited, 2, 'exactly one referrer is credited, in both wallets');
            const winner = (await awardsOf(row.referrerUserId)).length;
            assert.equal(winner, 2, 'the credited referrer is the one on the referral row');
            const changes = await database.referralChange.count({ where: { referralId: row.id } });
            assert.equal(changes, row.referrerUserId === second.id ? 1 : 0);
            if (change === 'REFERRAL_LOCKED' || change === 'CONFLICT') {
              assert.equal(row.referrerUserId, first.id);
            }
          }
        },
      );

      await suite.test(
        'a counter binding racing the first payment: rewarded only when it was bound before the payment',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const referrer = await member();
            const referred = await member();
            const invoice = await finalizedFor(referred.id);
            const results = await race(
              () =>
                referrals.bind(worker.token, ids.branch, referred.id, {
                  referrerPhone: referrer.typed,
                }),
              () => payIn(invoice.id),
            );
            const bind = outcome(results[0]);
            assert.ok(['OK', 'REFERRAL_NOT_NEW', 'CONFLICT'].includes(bind), bind);
            assert.equal(results[1].status, 'fulfilled', 'the payment is never blocked');
            const eventId = await paidEventOf(invoice.id);
            await consumeEvent(eventId);
            const row = await database.referral.findUnique({
              where: { referredUserId: referred.id },
            });
            const paid = await database.invoice.findUniqueOrThrow({
              where: { id: invoice.id },
              select: { paidAt: true },
            });
            if (!row) {
              assert.notEqual(bind, 'OK');
              assert.equal((await awardsOf(referrer.id)).length, 0);
            } else {
              const before = row.boundAt.getTime() <= paid.paidAt!.getTime();
              assert.equal(
                row.awardedAt !== null,
                before,
                `round ${round}: bound before pay = rewarded`,
              );
              assert.equal((await awardsOf(referrer.id)).length, before ? 2 : 0);
            }
          }
        },
      );

      await suite.test(
        'two referred customers of one referrer paid together: both rewards land, no deadlock',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const referrer = await member();
            const one = await member();
            const two = await member();
            await bound(one.id, referrer.id);
            await bound(two.id, referrer.id);
            const first = await finalizedFor(one.id);
            const second = await finalizedFor(two.id);
            await payIn(first.id);
            await payIn(second.id);
            const events = [await paidEventOf(first.id), await paidEventOf(second.id)];
            const results = await race(
              () => consumeEvent(events[0]!),
              () => consumeEvent(events[1]!),
            );
            assert.deepEqual(
              results.map((r) => (r.status === 'fulfilled' ? r.value : String(r.reason))),
              ['APPLIED', 'APPLIED'],
              `round ${round}`,
            );
            assert.equal(await balance(referrer.id, 'SPA'), 20);
            assert.equal(await balance(referrer.id, 'BEAUTY'), 20);
            assert.equal((await awardsOf(referrer.id)).length, 4);
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
            const referralRows = (
              await tx.referral.findMany({
                where: { referredUserId: { in: memberIds } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const ledgerIds = (
              await tx.loyaltyLedgerEntry.findMany({
                where: { userId: { in: memberIds } },
                select: { id: true },
              })
            ).map((v) => v.id);
            const paymentRows = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((v) => v.id);
            await tx.referralChange.deleteMany({ where: { referralId: { in: referralRows } } });
            await tx.loyaltyLedgerEntry.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.loyaltyWalletAccount.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.referral.deleteMany({ where: { id: { in: referralRows } } });
            await tx.outboxConsumption.deleteMany({
              where: { event: { aggregateId: { in: [...invoiceRows, ...referralRows] } } },
            });
            await tx.invoiceLoyaltySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...ledgerIds, ...referralRows] } },
                  {
                    aggregateId: {
                      in: [...invoiceRows, ...visits, ...executionRows, ...paymentRows],
                    },
                  },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { actorUserId: { in: userIds } },
                  { subjectUserId: { in: memberIds } },
                  { entityId: { in: [...referralRows, ...invoiceRows] } },
                ],
              },
            });
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
            await tx.customerProfile.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.user.deleteMany({ where: { id: { in: [...userIds, ...memberIds] } } });
            if (installedGoLive) await tx.loyaltyGoLive.deleteMany({});
            await tx.service.deleteMany({ where: { id: ids.service } });
            await tx.serviceCategory.deleteMany({ where: { id: ids.category } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 60_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
