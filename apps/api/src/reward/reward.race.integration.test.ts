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
import { RewardService } from './reward.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-9 reward races on separate committed PostgreSQL connections with real production service calls (design 16): two staff
 * members using the last unit at the same moment, a use against a revocation, a use against the restoration of the unit it wants,
 * and the same use restored twice. In every round the invariant holds: never more units in use than were issued, and no use after a
 * revocation. Requires an explicitly opted-in local scratch/validation database (replica-role cleanup of permanent history);
 * cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 5 P5-9 reward races: the last unit is used once, a revoked reward is never used, a restoration never doubles',
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
    const rewards = new RewardService(adapter, new AuthThrottleService(environment), environment);
    const ids = {
      branch: randomUUID(),
      issueRole: randomUUID(),
      manageRole: randomUUID(),
    };
    const roleIds = [ids.issueRole, ids.manageRole];
    const userIds: string[] = [];
    const memberIds: string[] = [];
    const sessionIds: string[] = [];
    const itemIds: string[] = [];
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
            code: `RWR_${run}`,
            name: 'Reward race',
            timezone: 'Asia/Ho_Chi_Minh',
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
              code: `RWR_${name}_${run}`,
              displayNameVi: name,
              displayNameEn: name,
              permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
            },
          });
        };
        await role(ids.issueRole, 'ISSUE', ['ISSUE_REWARDS']);
        await role(ids.manageRole, 'MANAGE', ['MANAGE_REWARD_CATALOG']);
      });
      const staff = (roleId: string, scope: 'BRANCH' | 'GLOBAL' = 'BRANCH') =>
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
                  employeeCodeCanonical: `RWR_${run}_${++serial}`,
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
      const issuerOne = await staff(ids.issueRole);
      const issuerTwo = await staff(ids.issueRole);
      const manager = await staff(ids.manageRole, 'GLOBAL');
      if ((await database.loyaltyGoLive.count()) === 0) {
        await database.loyaltyGoLive.create({ data: { activatedByUserId: manager.id } });
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
            emailCanonical: `rwr-${id}@example.com`,
            emailDelivery: `rwr-${id}@example.com`,
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
      const item = await database.rewardCatalogItem.create({
        data: {
          code: `RWR-${run}`,
          kind: 'VOUCHER',
          nameVi: 'Phiếu đua',
          nameEn: 'Race voucher',
          createdByUserId: manager.id,
        },
      });
      itemIds.push(item.id);
      const grant = async (quantity: number) => {
        const owner = await member();
        const created = await rewards.issue(issuerOne.token, ids.branch, owner, {
          catalogItemId: item.id,
          quantity,
          reason: 'Quà đua',
        });
        return created.id;
      };
      /** The invariant after every round: never more units in use than were issued, and no use after a revocation. */
      const invariant = async (entitlementId: string) => {
        const row = await database.rewardEntitlement.findUniqueOrThrow({
          where: { id: entitlementId },
          include: { manualUses: { include: { restoration: true } } },
        });
        const inUse = row.manualUses.filter((use) => use.restoration === null).length;
        assert.ok(inUse <= row.quantityIssued, 'never more units in use than were issued');
        if (row.voidedAt) {
          for (const use of row.manualUses) {
            assert.ok(use.usedAt <= row.voidedAt, 'no use after the revocation');
          }
        }
        return { inUse, voided: row.voidedAt !== null, uses: row.manualUses };
      };

      await suite.test(
        'two staff members use the last unit at the same moment: one succeeds, one is refused',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const entitlement = await grant(1);
            const results = await race(
              () => rewards.use(issuerOne.token, ids.branch, entitlement, { note: 'A' }),
              () => rewards.use(issuerTwo.token, ids.branch, entitlement, { note: 'B' }),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'REWARD_NOTHING_LEFT'],
              `round ${round}`,
            );
            assert.equal((await invariant(entitlement)).inUse, 1);
          }
        },
      );

      await suite.test('a use against a revocation: never a use after the revocation', async () => {
        for (let round = 0; round < 4; round += 1) {
          const entitlement = await grant(2);
          const results = await race(
            () => rewards.use(issuerOne.token, ids.branch, entitlement, {}),
            () =>
              rewards.revoke(issuerTwo.token, ids.branch, entitlement, { reason: 'Thu hồi đua' }),
          );
          const [useResult, revokeResult] = results.map(outcome);
          assert.equal(revokeResult, 'OK', `round ${round}`);
          assert.ok(
            ['OK', 'REWARD_NOT_USABLE'].includes(useResult!),
            `round ${round}: ${useResult}`,
          );
          const state = await invariant(entitlement);
          assert.equal(state.voided, true);
          assert.equal(state.inUse, useResult === 'OK' ? 1 : 0);
        }
      });

      await suite.test(
        'a use against the restoration of the unit it wants: never over the quantity',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const entitlement = await grant(1);
            const first = await rewards.use(issuerOne.token, ids.branch, entitlement, {});
            const useId = first.uses[0]!.id;
            const results = await race(
              () => rewards.use(issuerTwo.token, ids.branch, entitlement, { note: 'Sau' }),
              () => rewards.restore(manager.token, useId, { reason: 'Bấm nhầm' }),
            );
            const [useResult, restoreResult] = results.map(outcome);
            assert.equal(restoreResult, 'OK', `round ${round}`);
            // Either the second use ran first and found nothing left, or after the restoration and took the freed unit.
            assert.ok(
              ['OK', 'REWARD_NOTHING_LEFT'].includes(useResult!),
              `round ${round}: ${useResult}`,
            );
            const state = await invariant(entitlement);
            assert.equal(state.inUse, useResult === 'OK' ? 1 : 0);
            assert.equal(state.uses.length, useResult === 'OK' ? 2 : 1);
          }
        },
      );

      await suite.test('the same use restored twice at once: one offset row', async () => {
        for (let round = 0; round < 3; round += 1) {
          const entitlement = await grant(1);
          const used = await rewards.use(issuerOne.token, ids.branch, entitlement, {});
          const useId = used.uses[0]!.id;
          const results = await race(
            () => rewards.restore(manager.token, useId, { reason: 'Một' }),
            () => rewards.restore(manager.token, useId, { reason: 'Hai' }),
          );
          const codes = results.map(outcome).sort();
          assert.equal(codes[0], 'OK', `round ${round}`);
          assert.ok(
            ['REWARD_USE_NOT_RESTORABLE', 'CONFLICT'].includes(codes[1]!),
            `round ${round}`,
          );
          assert.equal(await database.rewardManualUseRestoration.count({ where: { useId } }), 1);
          assert.equal((await invariant(entitlement)).inUse, 0);
        }
      });
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const entitlementRows = (
              await tx.rewardEntitlement.findMany({
                where: { catalogItemId: { in: itemIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const useRows = (
              await tx.rewardManualUse.findMany({
                where: { entitlementId: { in: entitlementRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const eventRows = (
              await tx.outboxEvent.findMany({
                where: { OR: [{ branchId: ids.branch }, { aggregateId: { in: entitlementRows } }] },
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
                ],
              },
            });
            await tx.rewardManualUseRestoration.deleteMany({ where: { useId: { in: useRows } } });
            await tx.rewardManualUse.deleteMany({ where: { id: { in: useRows } } });
            await tx.rewardEntitlement.deleteMany({ where: { id: { in: entitlementRows } } });
            await tx.rewardCatalogItem.deleteMany({ where: { id: { in: itemIds } } });
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
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 30_000 },
        );
        assert.equal(await database.rewardCatalogItem.count({ where: { id: { in: itemIds } } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);
