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
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-6 birthday gift races on separate committed PostgreSQL connections with real production service calls. A
 * two-party latch releases only after both transactions hold the shared auth-graph lock; every other lock (users, session,
 * visit, invoice, the birthday configuration row, the payer and the wallet) is taken by production code. Requires an explicitly
 * opted-in local superuser validation database (replica-role cleanup of permanent financial history); cleanup is bounded to
 * this invocation's exact UUIDs.
 */
test(
  'Phase 5 P5-6 birthday gift races: one use per customer per birthday, saves serialize with finalizations',
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
    if ((await database.birthdayRewardConfig.count()) > 0) {
      suite.skip('the database already has a birthday configuration (a singleton)');
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
    const invoices = new InvoiceService(adapter, new AuthThrottleService(environment), environment);
    const loyalty = new LoyaltyService(adapter, new AuthThrottleService(environment), environment);
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
    let configId: string | null = null;
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
            code: `BDR_${run}`,
            name: 'Birthday race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `BDR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `BDR_SVC_${run}`,
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
        await tx.role.create({
          data: {
            id: ids.role,
            code: `BDR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const today = (
        await database.$queryRaw<{ today: string }[]>`
          SELECT lucy_branch_local_date(${ids.branch}::uuid, clock_timestamp())::text AS today`
      )[0]!.today;
      const staff = (fresh = false) =>
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
                  employeeCodeCanonical: `BDR_${run}_${++serial}`,
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
          if (!fresh) return { id, token: issued.token };
          // Cancelling a finalized invoice needs a fresh password confirmation.
          const confirmed = await sessions.rotateAuthenticated(
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
          sessionIds.push(confirmed.session.id);
          return { id, token: confirmed.token };
        });
      const ktv = await staff();
      const a = await staff();
      const b = await staff();
      const canceller = await staff(true);
      if ((await database.loyaltyGoLive.count()) === 0) {
        await database.loyaltyGoLive.create({ data: { activatedByUserId: a.id } });
        installedGoLive = true;
      }
      // The birthday gift: fixed 20,000, no combining, one use per customer per birthday year.
      const config = await database.birthdayRewardConfig.create({
        data: { createdByUserId: a.id },
        select: { id: true },
      });
      configId = config.id;
      await database.birthdayRewardVersion.create({
        data: {
          configId: config.id,
          versionNo: 1,
          isActive: true,
          kind: 'FIXED_AMOUNT',
          fixedAmountVnd: 20_000n,
          minSpendVnd: 0n,
          windowDaysBefore: 7,
          windowDaysAfter: 7,
          combineMember: false,
          combinePromotion: false,
          combineVoucher: false,
          usageLimitUnlimited: false,
          usageLimitPerYear: 1,
          createdByUserId: a.id,
        },
      });
      /** A customer whose birthday is today (year 2000 is a leap year, so every month-day exists), committed. */
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
            emailCanonical: `br-${id}@example.com`,
            emailDelivery: `br-${id}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date(`2000${today.slice(4)}`), address: 'Fixture' },
            },
          },
        });
        return id;
      };
      let slot = 0;
      const completedVisit = (ownerUserId: string) =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `BDR-${run}-${++serial}`,
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
              serviceCode: `BDR_SVC_${run}`,
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
      const openPriced = async (payer: string, token = a.token) => {
        const opened = (await invoices.open(token, await completedVisit(payer))).invoice;
        return invoices.setPrice(token, opened.id, opened.lines[0]!.id, {
          expectedVersion: opened.version,
          unitPriceVnd: '100000',
        });
      };
      const redemptionsOf = (payer: string) =>
        database.birthdayRedemption.findMany({ where: { payerUserId: payer } });

      await suite.test(
        'two invoices of one customer finalized together: exactly one gets the birthday gift (limit 1 per year)',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const payer = await member();
            const first = await openPriced(payer);
            const second = await openPriced(payer, b.token);
            const results = await race(
              () => invoices.finalize(a.token, first.id, { expectedVersion: first.version }),
              () => invoices.finalize(b.token, second.id, { expectedVersion: second.version }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const stored = await database.invoice.findMany({
              where: { id: { in: [first.id, second.id] } },
              select: { id: true, discountTotalVnd: true, totalVnd: true },
            });
            const discounts = stored.map((invoice) => invoice.discountTotalVnd).sort();
            assert.deepEqual(discounts, [0n, 20_000n], `round ${round}: one gift only`);
            const redemptions = await redemptionsOf(payer);
            assert.equal(redemptions.length, 1, 'one use recorded');
            const giftInvoice = stored.find((invoice) => invoice.discountTotalVnd === 20_000n)!;
            assert.equal(redemptions[0]!.invoiceId, giftInvoice.id);
            const losing = stored.find((invoice) => invoice.discountTotalVnd === 0n)!;
            const snapshot = await database.invoiceLoyaltySnapshot.findUniqueOrThrow({
              where: { invoiceId: losing.id },
            });
            assert.equal(snapshot.birthdayAmountVnd, 0n);
            const result = snapshot.birthdayResult as { reason?: string } | null;
            assert.equal(result?.reason, 'USAGE_LIMIT_REACHED');
          }
        },
      );

      await suite.test(
        'finalization racing the cancellation of the customer’s other gift invoice: the use is never lost or doubled',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const payer = await member();
            const holder = await openPriced(payer);
            await invoices.finalize(a.token, holder.id, { expectedVersion: holder.version });
            const waiting = await openPriced(payer, b.token);
            const held = await invoices.get(a.token, holder.id);
            const results = await race(
              () => invoices.finalize(b.token, waiting.id, { expectedVersion: waiting.version }),
              () =>
                invoices.cancel(canceller.token, holder.id, {
                  expectedVersion: held.version,
                  reason: 'Race',
                }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            // Whatever the order, ACTIVE uses are at most one and equal the gifts still on live invoices.
            const redemptions = await redemptionsOf(payer);
            const active = [];
            for (const redemption of redemptions) {
              const release = await database.birthdayRedemptionRelease.findUnique({
                where: { redemptionId: redemption.id },
              });
              const invoice = await database.invoice.findUniqueOrThrow({
                where: { id: redemption.invoiceId },
              });
              assert.equal(invoice.status === 'CANCELLED', release !== null);
              if (!release) active.push(redemption);
            }
            assert.ok(active.length <= 1, `round ${round}: at most one active use`);
          }
        },
      );

      await suite.test(
        'the Owner saving a new version while an invoice is finalized: the invoice used one whole version, never a mix',
        async () => {
          const ownerRow = await database.user.findFirst({ where: { kind: 'OWNER' } });
          if (!ownerRow) return;
          const issued = await database.$transaction(async (tx) => {
            const anonymous = await sessions.createAnonymous(tx);
            sessionIds.push(anonymous.session.id);
            const session = await sessions.rotateAuthenticated(
              anonymous.token,
              {
                userId: ownerRow.id,
                passwordHash: ownerRow.passwordHash!,
                credentialVersion: ownerRow.credentialVersion,
                authzVersion: ownerRow.authzVersion,
              },
              { reauthenticated: false },
              tx,
            );
            sessionIds.push(session.session.id);
            return session;
          });
          let version = 1;
          for (let round = 0; round < 4; round += 1) {
            const payer = await member();
            const draft = await openPriced(payer);
            const save = () =>
              loyalty.saveBirthdayReward(issued.token, {
                expectedVersionNo: version,
                isActive: round % 2 === 1,
                kind: 'FIXED_AMOUNT',
                percentBp: null,
                fixedAmountVnd: String(20_000 + (round + 1) * 1_000),
                minSpendVnd: '0',
                windowDaysBefore: 7,
                windowDaysAfter: 7,
                combineMember: false,
                combinePromotion: false,
                combineVoucher: false,
                usageLimit: { mode: 'PER_YEAR', perYear: 1 },
              });
            const results = await race(
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              save,
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            version += 1;
            const snapshot = await database.invoiceLoyaltySnapshot.findUniqueOrThrow({
              where: { invoiceId: draft.id },
            });
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
            const redemptions = await redemptionsOf(payer);
            if (redemptions.length === 1) {
              // The gift came from exactly one stored version, with that version's amount.
              const used = await database.birthdayRewardVersion.findUniqueOrThrow({
                where: { id: redemptions[0]!.versionId },
              });
              assert.equal(snapshot.birthdayConfigVersion, used.versionNo);
              assert.equal(stored.discountTotalVnd, used.fixedAmountVnd);
              assert.equal(redemptions[0]!.amountVnd, used.fixedAmountVnd);
            } else {
              assert.equal(stored.discountTotalVnd, 0n);
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
            const redemptionRows = (
              await tx.birthdayRedemption.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((v) => v.id);
            await tx.birthdayRedemptionRelease.deleteMany({
              where: { redemptionId: { in: redemptionRows } },
            });
            await tx.birthdayRedemption.deleteMany({ where: { id: { in: redemptionRows } } });
            await tx.invoiceLoyaltySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            if (configId) {
              await tx.birthdayRewardVersion.deleteMany({ where: { configId } });
              await tx.birthdayRewardConfig.deleteMany({ where: { id: configId } });
            }
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
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
                  ...(configId ? [{ entityType: 'BirthdayRewardConfig', entityId: configId }] : []),
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
