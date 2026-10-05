import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ReferralService } from '../referral/referral.service.js';
import { RewardService } from '../reward/reward.service.js';
import { CustomerLoyaltyService } from './customer-loyalty.service.js';
import { LoyaltyService } from './loyalty.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-10: the customer's own membership page against real PostgreSQL (design 15, P5-Q9). Read only, identity from the
 * session, nothing while go-live is OFF, simple wording, never another person's full name or phone, never a staff reason or name.
 * Combo rows that no service can create in isolation (a sale invoice and a use invoice) are inserted with
 * `session_replication_role = replica` (scratch databases only); the real flow is checked on the review database.
 * Every fixture rolls back with the outer transaction.
 */
test(
  'Phase 5 P5-10 customer membership page; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
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
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const rollback = new Error('Phase 5 P5-10 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `p510_${++savepoint}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work(tx);
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const sessionAdapter = {
              withTransaction: isolated,
              withExclusiveTransaction: isolated,
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const mine = new CustomerLoyaltyService(sessionAdapter, throttle);
            const loyalty = new LoyaltyService(sessionAdapter, throttle, environment);
            const rewards = new RewardService(sessionAdapter, throttle, environment);
            const referrals = new ReferralService(sessionAdapter, throttle, environment);
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(Reflect.get(Object(error), 'code'), code);
                if (field !== undefined) assert.equal(Reflect.get(Object(error), 'field'), field);
                return true;
              });
            };

            await syncPermissionCatalog(tx);
            type Code = 'ISSUE_REWARDS' | 'MANAGE_REFERRALS';
            const category = await tx.serviceCategory.create({
              data: { code: `P510_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const massage = await tx.service.create({
              data: {
                code: `P510_MASSAGE_${run}`,
                categoryId: category.id,
                nameVi: 'Massage body',
                nameEn: 'Body massage',
                priceVnd: 200_000n,
                priceMaxVnd: 200_000n,
                pricingUnit: 'PER_SERVICE',
                maxQuantity: 1,
                durationMinutes: 10,
                estimatedMinMinutes: 10,
                estimatedMaxMinutes: 10,
              },
            });
            const login = async (
              user: {
                id: string;
                passwordHash: string | null;
                credentialVersion: number;
                authzVersion: number;
              },
              reauthenticated = true,
            ) => {
              const principal = {
                userId: user.id,
                passwordHash: user.passwordHash!,
                credentialVersion: user.credentialVersion,
                authzVersion: user.authzVersion,
              };
              const first = (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  principal,
                  { reauthenticated: false },
                  tx,
                )
              ).token;
              if (!reauthenticated) return first;
              return (
                await sessions.rotateAuthenticated(first, principal, { reauthenticated: true }, tx)
              ).token;
            };
            const phoneOf = () => validVnMobile();
            const customer = async (label: string, fullName: string) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName,
                  preferredLocale: 'vi',
                  emailCanonical: `p510-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p510-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: phoneOf(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
              return { ...user, token: await login(user, false) };
            };
            const typed = (user: { phoneCanonical: string | null }) =>
              `0${user.phoneCanonical!.slice(3)}`;
            const ownerRow =
              (await tx.user.findFirst({ where: { kind: 'OWNER' } })) ??
              (await tx.user.create({
                data: {
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Chủ spa fixture',
                  preferredLocale: 'vi',
                  emailCanonical: `p510-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p510-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);
            const branch = await tx.branch.create({
              data: { code: `P510_${run}`, name: 'Lucy Spa Test', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P510_${name}_${run}`,
                  displayNameVi: name,
                  displayNameEn: name,
                  permissions: {
                    create: await Promise.all(
                      codes.map(async (code) => ({
                        permissionId: (await tx.permission.findUniqueOrThrow({ where: { code } }))
                          .id,
                      })),
                    ),
                  },
                },
              });
            const staffUser = async (roleId: string) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Nhân viên Bí Mật ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: phoneOf(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `P510_${run}_${n}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
              });
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: user.id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: user.id, branchId: branch.id, grantedByUserId: user.id },
              });
              await tx.userRoleAssignment.create({
                data: { userId: user.id, roleId, scopeKind: 'BRANCH', branchId: branch.id },
              });
              return { id: user.id, token: await login(user) };
            };
            const issuer = await staffUser((await makeRole('ISSUE', ['ISSUE_REWARDS'])).id);
            const binder = await staffUser((await makeRole('BIND', ['MANAGE_REFERRALS'])).id);
            const alice = await customer('alice', 'Phạm Mai An');
            const bob = await customer('bob', 'Lê Quốc Bình');
            const carol = await customer('carol', 'Nguyễn Thị Lan');
            const everything = (value: unknown) => JSON.stringify(value);
            const noLeak = (value: unknown, ...secrets: string[]) => {
              const text = everything(value);
              for (const secret of secrets) assert.ok(!text.includes(secret), `leaked: ${secret}`);
            };
            const replica = async <T>(work: () => Promise<T>): Promise<T> => {
              await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
              try {
                return await work();
              } finally {
                await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
              }
            };

            // ===================================================================== go-live OFF
            await suite.test(
              'go-live OFF: nothing is returned, even for a referral already stored; identity rules',
              async () => {
                // A referral may be stored while OFF (P5-5); the customer still sees nothing.
                await referrals.bind(binder.token, branch.id, bob.id, {
                  referrerPhone: typed(alice),
                });
                assert.equal(await tx.referral.count({ where: { referrerUserId: alice.id } }), 1);
                assert.deepEqual(await mine.summary(alice.token), { live: false, wallets: [] });
                for (const read of [
                  () => mine.history(alice.token),
                  () => mine.combos(alice.token),
                  () => mine.comboUses(alice.token),
                  () => mine.referrals(alice.token),
                  () => mine.gifts(alice.token),
                ]) {
                  assert.deepEqual(await read(), {
                    live: false,
                    items: [],
                    page: 1,
                    pageSize: 20,
                    total: 0,
                  });
                }
                // No session, or a staff session, is not a customer.
                await fails(() => mine.summary(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(() => mine.history(ownerToken), 'FORBIDDEN');
                await fails(() => mine.gifts(issuer.token), 'FORBIDDEN');
                // A bad page is a validation failure, not a guess.
                for (const bad of ['0', 'x', '-1', '1.5', '9999999']) {
                  await fails(() => mine.history(alice.token, bad), 'VALIDATION_FAILED', 'page');
                }
              },
            );

            await loyalty.activate(ownerToken);

            // ===================================================================== points
            await suite.test(
              'points: both wallets, tier, Member Discount and the next tier; history in simple wording with no staff text',
              async () => {
                const fresh = await mine.summary(carol.token);
                assert.equal(fresh.live, true);
                assert.deepEqual(
                  fresh.wallets.map((w) => [w.wallet, w.balancePoints, w.tier, w.pointsToNextTier]),
                  [
                    ['SPA', 0, 'NONE', 500],
                    ['BEAUTY', 0, 'NONE', 500],
                  ],
                );
                const adjust = (wallet: 'SPA' | 'BEAUTY', points: number, reason: string) =>
                  loyalty.adjust(ownerToken, alice.id, {
                    wallet,
                    points,
                    reason,
                    clientRequestId: randomUUID(),
                  });
                await adjust('SPA', 620, 'Lý do nội bộ XYZ');
                await adjust('SPA', -20, 'Trừ nhầm, nhân viên Bí Mật');
                await adjust('BEAUTY', 10, 'Tặng thử');
                const summary = await mine.summary(alice.token);
                const spa = summary.wallets.find((w) => w.wallet === 'SPA')!;
                assert.equal(spa.balancePoints, 600);
                assert.equal(spa.tier, 'SILVER');
                assert.equal(spa.memberDiscountBp, 300);
                assert.equal(spa.nextTier, 'GOLD');
                assert.equal(spa.pointsToNextTier, 400);
                assert.equal(summary.wallets.find((w) => w.wallet === 'BEAUTY')!.balancePoints, 10);

                const history = await mine.history(alice.token);
                assert.equal(history.total, 3);
                assert.deepEqual(
                  history.items.map((item) => [item.wallet, item.kind, item.points]),
                  [
                    ['BEAUTY', 'ADJUSTED', 10],
                    ['SPA', 'ADJUSTED', -20],
                    ['SPA', 'ADJUSTED', 620],
                  ],
                );
                for (const item of history.items) {
                  assert.deepEqual(Object.keys(item).sort(), [
                    'createdAt',
                    'id',
                    'kind',
                    'points',
                    'wallet',
                  ]);
                }
                noLeak(history, 'Lý do nội bộ', 'Trừ nhầm', 'Bí Mật', 'shortfall');
                assert.equal((await mine.history(alice.token, '2')).items.length, 0);
                // One customer never sees another's points.
                assert.equal((await mine.history(bob.token)).total, 0);
                assert.equal((await mine.summary(bob.token)).wallets[0]!.balancePoints, 0);
              },
            );

            // ===================================================================== referrals
            await suite.test(
              'referrals: masked names only, waiting then rewarded; the referred person sees nothing of it',
              async () => {
                const waiting = await mine.referrals(alice.token);
                assert.equal(waiting.total, 1);
                assert.deepEqual(
                  waiting.items.map((item) => [item.referredMasked, item.status, item.rewardedAt]),
                  [['L••• Q••• B•••', 'WAITING', null]],
                );
                assert.deepEqual(Object.keys(waiting.items[0]!).sort(), [
                  'boundAt',
                  'id',
                  'referredMasked',
                  'rewardedAt',
                  'status',
                ]);
                noLeak(waiting, 'Bình', 'Quốc', bob.phoneCanonical!, typed(bob), bob.id);
                // The referred customer is not the referrer: an empty list.
                assert.equal((await mine.referrals(bob.token)).total, 0);

                // The award is stamped by the worker; here the stamped state is written directly (replica role).
                await replica(() =>
                  tx.$executeRawUnsafe(
                    `UPDATE referrals SET awarded_at = clock_timestamp(), awarded_invoice_id = '${randomUUID()}', awarded_paid_seq = 1
                     WHERE referrer_user_id = '${alice.id}'`,
                  ),
                );
                const rewarded = await mine.referrals(alice.token);
                assert.equal(rewarded.items[0]!.status, 'REWARDED');
                assert.ok(rewarded.items[0]!.rewardedAt);
              },
            );

            // ===================================================================== gifts
            await suite.test(
              'gifts: status, units left and expiry; the grant reason and staff names stay internal',
              async () => {
                const free = await rewards.createItem(ownerToken, {
                  kind: 'FREE_SERVICE',
                  serviceId: massage.id,
                  nameVi: 'Massage miễn phí',
                  nameEn: 'Free massage',
                  active: true,
                  expiryDays: 30,
                });
                const towel = await rewards.createItem(ownerToken, {
                  kind: 'PRODUCT_GIFT',
                  serviceId: null,
                  nameVi: 'Khăn spa',
                  nameEn: 'Spa towel',
                  active: true,
                  expiryDays: null,
                });
                const grant = (itemId: string, quantity: number, reason: string) =>
                  rewards.issue(issuer.token, branch.id, alice.id, {
                    catalogItemId: itemId,
                    quantity,
                    reason,
                  });
                const g1 = await grant(free.id, 1, 'Lý do tặng bí mật');
                const g2 = await grant(towel.id, 3, 'Bù lỗi dịch vụ');
                const g3 = await grant(towel.id, 2, 'Tặng nhầm');
                await rewards.use(issuer.token, branch.id, g2.id, { note: 'Ghi chú nội bộ' });
                await rewards.revoke(issuer.token, branch.id, g3.id, {
                  reason: 'Thu hồi vì phát nhầm',
                });
                const gifts = await mine.gifts(alice.token);
                assert.equal(gifts.total, 3);
                const byId = new Map(gifts.items.map((item) => [item.id, item]));
                assert.equal(byId.get(g1.id)!.status, 'ACTIVE');
                assert.equal(byId.get(g1.id)!.kind, 'FREE_SERVICE');
                assert.equal(byId.get(g1.id)!.serviceNameVi, 'Massage body');
                assert.equal(byId.get(g1.id)!.quantityLeft, 1);
                assert.ok(byId.get(g1.id)!.expiresAt, 'a 30-day item carries its expiry');
                assert.equal(byId.get(g2.id)!.status, 'ACTIVE');
                assert.equal(byId.get(g2.id)!.quantityIssued, 3);
                assert.equal(byId.get(g2.id)!.quantityLeft, 2);
                assert.equal(byId.get(g2.id)!.expiresAt, null);
                assert.equal(byId.get(g3.id)!.status, 'VOIDED');
                // Used up and expired.
                await rewards.use(issuer.token, branch.id, g1.id, {});
                assert.equal(
                  (await mine.gifts(alice.token)).items.find((item) => item.id === g1.id)!.status,
                  'USED_UP',
                );
                await replica(() =>
                  tx.$executeRawUnsafe(
                    `UPDATE reward_entitlements SET expires_at = clock_timestamp() - interval '1 day' WHERE id = '${g2.id}'`,
                  ),
                );
                assert.equal(
                  (await mine.gifts(alice.token)).items.find((item) => item.id === g2.id)!.status,
                  'EXPIRED',
                );
                noLeak(
                  await mine.gifts(alice.token),
                  'Lý do tặng',
                  'Bù lỗi',
                  'Tặng nhầm',
                  'Thu hồi vì',
                  'Ghi chú nội bộ',
                  'Bí Mật',
                  issuer.id,
                );
                assert.equal((await mine.gifts(bob.token)).total, 0);
              },
            );

            // ===================================================================== combos
            await suite.test(
              'combos: sessions left (paid and bonus), uses by the owner and by a relative (masked), mistaken uses not listed, nothing of others',
              async () => {
                const combo = await tx.combo.create({
                  data: {
                    code: `P510C_${run}`,
                    serviceId: massage.id,
                    createdByUserId: ownerRow.id,
                  },
                });
                const purchaseId = randomUUID();
                await replica(async () => {
                  // The sale invoice does not exist in this fixture, so the database's own rule says "not usable": paused.
                  await tx.$executeRawUnsafe(
                    `INSERT INTO combo_purchases (id, combo_id, version_id, owner_user_id, invoice_line_id, paid_seq, service_id,
                       name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode)
                     VALUES ('${purchaseId}', '${combo.id}', '${randomUUID()}', '${alice.id}', '${randomUUID()}', 1, '${massage.id}',
                       'Liệu trình 3+1', '3+1 course', 3, 1, 1000000, 'NONE')`,
                  );
                  for (const [no, kind] of [
                    [1, 'PAID'],
                    [2, 'PAID'],
                    [3, 'PAID'],
                    [4, 'BONUS'],
                  ] as const) {
                    await tx.$executeRawUnsafe(
                      `INSERT INTO combo_sessions (id, purchase_id, session_no, kind)
                       VALUES ('${randomUUID()}', '${purchaseId}', ${no}, '${kind}'::"ComboSessionKind")`,
                    );
                  }
                });
                const sessionRows = await tx.comboSession.findMany({
                  where: { purchaseId },
                  orderBy: { sessionNo: 'asc' },
                });
                const relativeVisitId = randomUUID();
                const relative = await replica(() =>
                  tx.visitParticipant.create({
                    data: {
                      visitId: relativeVisitId,
                      kind: 'MEMBER',
                      customerUserId: carol.id,
                    },
                  }),
                );
                const consume = (
                  sessionId: string,
                  usedBy: 'OWNER' | 'RELATIVE',
                  participantId: string | null,
                ) =>
                  replica(() =>
                    tx.comboSessionConsumption.create({
                      data: {
                        sessionId,
                        invoiceLineId: randomUUID(),
                        branchId: branch.id,
                        usedBy,
                        relationshipNote: usedBy === 'RELATIVE' ? 'con gái, 0901 000 111' : null,
                        recipientParticipantId: participantId,
                        performedByUserId: issuer.id,
                      },
                    }),
                  );
                await consume(sessionRows[0]!.id, 'OWNER', null);
                await consume(sessionRows[1]!.id, 'RELATIVE', relative.id);
                const mistaken = await consume(sessionRows[2]!.id, 'OWNER', null);
                await replica(() =>
                  tx.$executeRawUnsafe(
                    `INSERT INTO combo_session_restorations (consumption_id, restored_by_user_id, reason)
                     VALUES ('${mistaken.id}', '${issuer.id}', 'Nhân viên bấm nhầm')`,
                  ),
                );

                const combos = await mine.combos(alice.token);
                assert.equal(combos.total, 1);
                const row = combos.items[0]!;
                assert.equal(row.status, 'PAUSED');
                // Sessions 1 and 2 are in use; session 3 was restored (free again); the BONUS one was never used.
                assert.equal(row.paidLeft, 1);
                assert.equal(row.bonusLeft, 1);
                assert.equal(row.paidSessions, 3);
                assert.equal(row.bonusSessions, 1);
                assert.equal(row.serviceNameVi, 'Massage body');

                const uses = await mine.comboUses(alice.token);
                assert.equal(uses.total, 2, 'a restored (mistaken) use is not listed');
                const relativeUse = uses.items.find((item) => item.usedBy === 'RELATIVE')!;
                assert.equal(relativeUse.recipientMasked, 'N••• T••• L•••');
                assert.equal(
                  uses.items.find((item) => item.usedBy === 'OWNER')!.recipientMasked,
                  null,
                );
                assert.equal(relativeUse.sessionKind, 'PAID');
                assert.equal(relativeUse.branchName, 'Lucy Spa Test');
                assert.deepEqual(Object.keys(relativeUse).sort(), [
                  'branchName',
                  'comboNameEn',
                  'comboNameVi',
                  'id',
                  'recipientMasked',
                  'serviceNameEn',
                  'serviceNameVi',
                  'sessionKind',
                  'usedAt',
                  'usedBy',
                ]);
                noLeak(
                  uses,
                  'Thị Lan',
                  'Nguyễn',
                  carol.phoneCanonical!,
                  '0901 000 111',
                  'con gái',
                  'Bí Mật',
                  'Nhân viên bấm nhầm',
                  issuer.id,
                );
                // The other customers see none of it (the relative received the service but owns nothing).
                for (const other of [bob, carol]) {
                  assert.equal((await mine.combos(other.token)).total, 0);
                  assert.equal((await mine.comboUses(other.token)).total, 0);
                }
              },
            );

            throw rollback;
          },
          { timeout: 120_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
