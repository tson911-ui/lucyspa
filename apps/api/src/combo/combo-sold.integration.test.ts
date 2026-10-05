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
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { RewardService } from '../reward/reward.service.js';
import { ComboService } from './combo.service.js';

/**
 * Phase 5 P5-10b: the "Combo đã bán" list (Owner/manager) and a customer's combos and gifts on the staff profile, against real
 * PostgreSQL. Every state is listed, nothing hidden; the totals count only combos usable now; no money value appears. Sale
 * invoices and purchases that no service can create in isolation are inserted with `session_replication_role = replica`
 * (scratch databases only); the real flow is checked on the review database. Every fixture rolls back with the outer transaction.
 */
test(
  'Phase 5 P5-10b sold combos and the staff profile lists; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-10b fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `p510b_${++savepoint}`;
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
            const combos = new ComboService(sessionAdapter, throttle, environment);
            const loyalty = new LoyaltyService(sessionAdapter, throttle, environment);
            const rewards = new RewardService(sessionAdapter, throttle, environment);
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(Reflect.get(Object(error), 'code'), code);
                if (field !== undefined) assert.equal(Reflect.get(Object(error), 'field'), field);
                return true;
              });
            };
            const replica = async <T>(work: () => Promise<T>): Promise<T> => {
              await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
              try {
                return await work();
              } finally {
                await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
              }
            };

            await syncPermissionCatalog(tx);
            type Code = 'MANAGE_COMBOS' | 'RESTORE_COMBO_SESSIONS' | 'VIEW_LOYALTY';
            const category = await tx.serviceCategory.create({
              data: { code: `P510B_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const massage = await tx.service.create({
              data: {
                code: `P510B_MASSAGE_${run}`,
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
            const login = async (user: {
              id: string;
              passwordHash: string | null;
              credentialVersion: number;
              authzVersion: number;
            }) => {
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
              return (
                await sessions.rotateAuthenticated(first, principal, { reauthenticated: true }, tx)
              ).token;
            };
            const phoneOf = () =>
              `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
            const customer = async (label: string, fullName: string) => {
              n++;
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName,
                  preferredLocale: 'vi',
                  emailCanonical: `p510b-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p510b-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: phoneOf(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
            };
            const ownerRow =
              (await tx.user.findFirst({ where: { kind: 'OWNER' } })) ??
              (await tx.user.create({
                data: {
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Chủ spa fixture',
                  preferredLocale: 'vi',
                  emailCanonical: `p510b-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p510b-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);
            const branch = await tx.branch.create({
              data: { code: `P510B_${run}`, name: 'Lucy Spa Một', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const otherBranch = await tx.branch.create({
              data: { code: `P510B2_${run}`, name: 'Lucy Spa Hai', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P510B_${name}_${run}`,
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
            const staffUser = async (
              branchId: string,
              roleId: string | null,
              scope: 'BRANCH' | 'GLOBAL',
              name = 'Nhân viên',
            ) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `${name} ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: phoneOf(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `P510B_${run}_${n}`,
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
                data: { employeeUserId: user.id, branchId, grantedByUserId: user.id },
              });
              if (roleId) {
                await tx.userRoleAssignment.create({
                  data:
                    scope === 'GLOBAL'
                      ? { userId: user.id, roleId, scopeKind: 'GLOBAL' }
                      : { userId: user.id, roleId, scopeKind: 'BRANCH', branchId },
                });
              }
              return { id: user.id, token: await login(user), name: user.fullName };
            };
            const manager = await staffUser(
              branch.id,
              (await makeRole('MANAGE', ['MANAGE_COMBOS'])).id,
              'GLOBAL',
            );
            const restorer = await staffUser(
              branch.id,
              (await makeRole('RESTORE', ['RESTORE_COMBO_SESSIONS'])).id,
              'GLOBAL',
            );
            const viewerRole = await makeRole('VIEW', ['VIEW_LOYALTY']);
            const viewer = await staffUser(branch.id, viewerRole.id, 'BRANCH');
            const otherViewer = await staffUser(otherBranch.id, viewerRole.id, 'BRANCH');
            const nobody = await staffUser(branch.id, null, 'BRANCH');
            const canceller = await staffUser(branch.id, null, 'BRANCH', 'Người hủy Bí Mật');
            const alice = await customer('alice', 'Phạm Mai An');
            const bob = await customer('bob', 'Lê Quốc Bình');

            let day = 0;
            // A sale invoice with one COMBO_PURCHASE line per entry, in the given state (rows written past the triggers).
            const sale = async (
              state: 'PAID' | 'PENDING' | 'CANCELLED',
              payer: { id: string },
              lines = 1,
              total = 1_000_000n,
            ) =>
              replica(async () => {
                day++;
                const date = new Date(Date.UTC(2027, 0, day));
                const code = `INV-2701${String(day).padStart(2, '0')}-AAAA${'BCDEFGHJKLMN'[day]}${'BCDEFGHJKLMN'[day]}`;
                const finalizedAt = new Date(Date.now() + 1000);
                const invoice = await tx.invoice.create({
                  data: {
                    code,
                    branchId: branch.id,
                    kind: 'COMBO_SALE',
                    status:
                      state === 'PAID'
                        ? 'PAID'
                        : state === 'PENDING'
                          ? 'PENDING_PAYMENT'
                          : 'CANCELLED',
                    payerUserId: payer.id,
                    businessDate: date,
                    calculationVersion: 2,
                    subtotalVnd: 1_000_000n,
                    discountTotalVnd: 1_000_000n - total,
                    totalVnd: total,
                    finalizedAt,
                    finalizedByUserId: ownerRow.id,
                    paidAt: state === 'PAID' ? new Date(finalizedAt.getTime() + 1000) : null,
                    paidSeq: 1,
                    cancelledAt:
                      state === 'CANCELLED' ? new Date(finalizedAt.getTime() + 2000) : null,
                    cancelledByUserId: state === 'CANCELLED' ? canceller.id : null,
                    cancelledFromStatus: state === 'CANCELLED' ? 'PENDING_PAYMENT' : null,
                    cancelReason: state === 'CANCELLED' ? 'Khách đổi ý' : null,
                    createdByUserId: ownerRow.id,
                  },
                });
                const lineIds: string[] = [];
                for (let sequence = 1; sequence <= lines; sequence++) {
                  lineIds.push(
                    (
                      await tx.invoiceLine.create({
                        data: {
                          invoiceId: invoice.id,
                          sequence,
                          kind: 'COMBO_PURCHASE',
                          itemCode: `P510B_${sequence}`,
                          nameVi: 'Combo',
                          nameEn: 'Combo',
                        },
                      })
                    ).id,
                  );
                }
                return lineIds;
              });
            const comboDef = await tx.combo.create({
              data: { code: `P510BC_${run}`, serviceId: massage.id, createdByUserId: ownerRow.id },
            });
            // A purchase with `paid` PAID and `bonus` BONUS sessions; `used` lists the session numbers with an active use.
            const purchase = async (
              owner: { id: string },
              lineId: string,
              name: string,
              paid: number,
              bonus: number,
              used: number[] = [],
              extra: { expiresAt?: Date; voidReason?: string } = {},
            ) =>
              replica(async () => {
                const id = randomUUID();
                await tx.$executeRawUnsafe(
                  `INSERT INTO combo_purchases (id, combo_id, version_id, owner_user_id, invoice_line_id, paid_seq, service_id,
                     name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode, expires_at, voided_at, voided_by_user_id, void_reason)
                   VALUES ('${id}', '${comboDef.id}', '${randomUUID()}', '${owner.id}', '${lineId}', 1, '${massage.id}',
                     '${name}', '${name} EN', ${paid}, ${bonus}, 1000000, '${extra.expiresAt ? 'DAYS_AFTER_ISSUE' : 'NONE'}',
                     ${extra.expiresAt ? `'${extra.expiresAt.toISOString()}'` : 'NULL'},
                     ${extra.voidReason ? 'clock_timestamp()' : 'NULL'},
                     ${extra.voidReason ? `'${canceller.id}'` : 'NULL'},
                     ${extra.voidReason ? `'${extra.voidReason}'` : 'NULL'})`,
                );
                for (let no = 1; no <= paid + bonus; no++) {
                  const sessionId = randomUUID();
                  await tx.$executeRawUnsafe(
                    `INSERT INTO combo_sessions (id, purchase_id, session_no, kind)
                     VALUES ('${sessionId}', '${id}', ${no}, '${no <= paid ? 'PAID' : 'BONUS'}'::"ComboSessionKind")`,
                  );
                  if (used.includes(no)) {
                    await tx.$executeRawUnsafe(
                      `INSERT INTO combo_session_consumptions (session_id, invoice_line_id, branch_id, used_by, performed_by_user_id)
                       VALUES ('${sessionId}', '${randomUUID()}', '${branch.id}', 'OWNER', '${ownerRow.id}')`,
                    );
                  }
                }
                return id;
              });

            // ------------------------------------------------------------------- fixtures, one per state
            // The active combo was sold with a 10% discount: it is worth what was paid (900,000), not the list price.
            const [lineActive] = await sale('PAID', alice, 1, 900_000n);
            const active = await purchase(alice, lineActive!, 'Combo đang dùng', 3, 1, [1]);
            const [lineUsedUp] = await sale('PAID', alice);
            const usedUp = await purchase(alice, lineUsedUp!, 'Combo dùng hết', 2, 0, [1, 2]);
            const [lineExpired] = await sale('PAID', bob);
            const expired = await purchase(bob, lineExpired!, 'Combo hết hạn', 2, 1, [], {
              expiresAt: new Date(Date.now() - 86_400_000),
            });
            const [lineFrozen] = await sale('PENDING', bob);
            const frozen = await purchase(bob, lineFrozen!, 'Combo bị khóa', 3, 1, [1]);
            const [lineFrozenCancelled] = await sale('CANCELLED', alice);
            const frozenCancelled = await purchase(
              alice,
              lineFrozenCancelled!,
              'Combo khóa hủy',
              2,
              0,
              [2],
            );
            const [lineRevoked] = await sale('PENDING', alice);
            const revoked = await purchase(alice, lineRevoked!, 'Combo thu hồi', 2, 1, [], {
              voidReason: 'Thanh toán đã bị đảo, combo chưa dùng buổi nào được thu hồi',
            });
            const [lineRevokedCancelled] = await sale('CANCELLED', bob);
            const revokedCancelled = await purchase(
              bob,
              lineRevokedCancelled!,
              'Combo thu hồi hủy',
              1,
              0,
              [],
              {
                voidReason: 'Hóa đơn đã bị hủy, combo chưa dùng buổi nào được thu hồi',
              },
            );

            await suite.test(
              'every state is listed with its status, sessions left and, for frozen and revoked, when and why',
              async () => {
                const page = await combos.sold(manager.token, {});
                assert.equal(page.total, 7, 'nothing is hidden');
                const byId = new Map(page.items.map((item) => [item.purchaseId, item]));
                const state = (id: string) => byId.get(id)!;
                assert.equal(state(active).status, 'ACTIVE');
                assert.deepEqual([state(active).paidLeft, state(active).bonusLeft], [2, 1]);
                assert.equal(state(usedUp).status, 'USED_UP');
                assert.deepEqual([state(usedUp).paidLeft, state(usedUp).bonusLeft], [0, 0]);
                assert.equal(state(expired).status, 'EXPIRED');
                assert.equal(state(frozen).status, 'FROZEN');
                assert.equal(state(frozenCancelled).status, 'FROZEN');
                assert.equal(state(revoked).status, 'REVOKED');
                assert.equal(state(revokedCancelled).status, 'REVOKED');
                // Frozen: the reversal fallback (no payment row in this fixture) and the cancellation.
                assert.equal(state(frozen).event?.kind, 'FROZEN');
                assert.equal(state(frozen).event?.cause, 'SALE_REVERSED');
                assert.ok(state(frozen).event?.at);
                assert.equal(state(frozenCancelled).event?.cause, 'SALE_CANCELLED');
                // Revoked: the date and the cause told from the stored text.
                assert.equal(state(revoked).event?.kind, 'REVOKED');
                assert.equal(state(revoked).event?.cause, 'SALE_REVERSED');
                assert.equal(state(revokedCancelled).event?.cause, 'SALE_CANCELLED');
                // A usable combo has no event.
                assert.equal(state(active).event, null);
                assert.equal(state(expired).event, null);
                // The row: buyer masked as in the other staff lists, branch of the sale, sale date, nothing about money.
                const row = state(active);
                assert.equal(row.buyer.id, alice.id);
                assert.equal(row.buyer.displayName, 'Phạm Mai An');
                assert.ok(
                  row.buyer.phoneMasked && !row.buyer.phoneMasked.includes(alice.phoneCanonical!),
                );
                assert.equal(row.branchName, 'Lucy Spa Một');
                assert.ok(row.soldAt && row.saleInvoiceCode.startsWith('INV-'));
                // A manager sees no money at all: the value is the Owner's alone.
                assert.ok(page.items.every((item) => item.valueVnd === null));
                assert.equal(page.totals.value, null);
                assert.doesNotMatch(JSON.stringify(page), /price|amount|tiền/i);
                assert.ok(!JSON.stringify(page).includes(alice.phoneCanonical!));
              },
            );

            await suite.test(
              'totals count only the sessions usable now; the status filter and the page never change them',
              async () => {
                const all = await combos.sold(manager.token, {});
                const usable = {
                  paidLeft: 2,
                  bonusLeft: 1,
                  // Locked in the two frozen combos: 2 + 1 purchased and 1 bonus, never inside the usable totals.
                  frozenPaidLeft: 3,
                  frozenBonusLeft: 1,
                  value: null,
                };
                assert.deepEqual(all.totals, usable);
                for (const [status, total] of [
                  ['ACTIVE', 1],
                  ['USED_UP', 1],
                  ['EXPIRED', 1],
                  ['FROZEN', 2],
                  ['REVOKED', 2],
                ] as const) {
                  const filtered = await combos.sold(manager.token, { status });
                  assert.equal(filtered.total, total, status);
                  assert.ok(filtered.items.every((item) => item.status === status));
                  assert.deepEqual(filtered.totals, usable);
                }
                assert.deepEqual((await combos.sold(manager.token, { status: '' })).total, 7);
                await fails(
                  () => combos.sold(manager.token, { status: 'NOPE' }),
                  'VALIDATION_FAILED',
                  'status',
                );
                for (const bad of ['0', 'x', '-1', '1.5']) {
                  await fails(
                    () => combos.sold(manager.token, { page: bad }),
                    'VALIDATION_FAILED',
                    'page',
                  );
                }
                // Newest first.
                const times = all.items.map((item) => item.soldAt);
                assert.deepEqual(times, [...times].sort().reverse());
              },
            );

            await suite.test(
              'unused prepaid value (Owner only): paid after discount / purchased sessions x purchased sessions left, bonus is 0, frozen and revoked apart',
              async () => {
                const page = await combos.sold(ownerToken, {});
                const byId = new Map(page.items.map((item) => [item.purchaseId, item]));
                const value = (id: string) => byId.get(id)!.valueVnd;
                // 900,000 paid (10% off 1,000,000) over 3 purchased sessions, 2 left: 600,000; the bonus session adds nothing.
                assert.equal(value(active), '600000');
                assert.equal(value(usedUp), '0');
                // Expired: the row still says what was left; it is in no total.
                assert.equal(value(expired), '1000000');
                // 1,000,000 / 3 x 2 = 666,666.67 -> rounded half up once to 1 VND.
                assert.equal(value(frozen), '666667');
                assert.equal(value(frozenCancelled), '500000');
                assert.equal(value(revoked), '1000000');
                assert.equal(value(revokedCancelled), '1000000');
                // Active, frozen and revoked are summed apart; the frozen and the revoked never enter the active total.
                assert.deepEqual(page.totals.value, {
                  activeVnd: '600000',
                  frozenVnd: '1166667',
                  revokedVnd: '2000000',
                });
                assert.equal(page.totals.frozenPaidLeft, 3);
                assert.equal(page.totals.frozenBonusLeft, 1);
                // The filter and the page never change the totals.
                const frozenOnly = await combos.sold(ownerToken, { status: 'FROZEN' });
                assert.deepEqual(frozenOnly.totals, page.totals);
                assert.deepEqual(frozenOnly.items.map((item) => item.valueVnd).sort(), [
                  '500000',
                  '666667',
                ]);
                // Nobody else sees a value: not a manager, a restorer, nor the branch profile.
                for (const token of [manager.token, restorer.token]) {
                  const other = await combos.sold(token, {});
                  assert.ok(other.items.every((item) => item.valueVnd === null));
                  assert.equal(other.totals.value, null);
                  assert.doesNotMatch(JSON.stringify(other), /600000|666667|1166667|2000000/);
                }
                const profile = await loyalty.combos(viewer.token, branch.id, alice.id, {});
                assert.doesNotMatch(JSON.stringify(profile), /600000|666667|1166667|2000000/);
                // The Owner reading the profile sees none either: the profile is staff work, not an Owner report.
                const ownerProfile = await loyalty.combos(ownerToken, branch.id, alice.id, {});
                assert.ok(ownerProfile.items.every((item) => item.valueVnd === null));
              },
            );

            await suite.test('20 per page', async () => {
              // 21 more combos (one session, used, so used up) on one invoice with 21 lines: 28 in all.
              for (const lineId of await sale('PAID', alice, 21)) {
                await purchase(alice, lineId, 'Combo hàng loạt', 1, 0, [1]);
              }
              const page1 = await combos.sold(manager.token, {});
              assert.equal(page1.total, 28);
              assert.equal(page1.pageSize, 20);
              assert.equal(page1.items.length, 20);
              const page2 = await combos.sold(manager.token, { page: '2' });
              assert.equal(page2.items.length, 8);
              assert.equal((await combos.sold(manager.token, { page: '3' })).items.length, 0);
              assert.deepEqual(page1.totals, page2.totals);
            });

            await suite.test(
              'who may read it: MANAGE_COMBOS or RESTORE_COMBO_SESSIONS (global); a branch viewer or nobody may not',
              async () => {
                assert.ok((await combos.sold(ownerToken, {})).total > 0);
                assert.ok((await combos.sold(restorer.token, {})).total > 0);
                await fails(() => combos.sold(viewer.token, {}), 'FORBIDDEN');
                await fails(() => combos.sold(nobody.token, {}), 'FORBIDDEN');
                await fails(() => combos.sold(undefined, {}), 'AUTHENTICATION_REQUIRED');
              },
            );

            await suite.test(
              'staff profile: the customer’s own combos in every state and gifts, with VIEW_LOYALTY at the branch only',
              async () => {
                const mine = await loyalty.combos(viewer.token, branch.id, alice.id, {});
                assert.equal(
                  mine.total,
                  25,
                  'alice: active, used up, frozen (cancelled), revoked + 21 bulk',
                );
                const second = await loyalty.combos(viewer.token, branch.id, alice.id, {
                  page: '2',
                });
                const everyRow = [...mine.items, ...second.items];
                assert.equal(everyRow.length, 25);
                assert.ok(everyRow.every((item) => item.buyer.id === alice.id));
                assert.ok(everyRow.some((item) => item.status === 'REVOKED'));
                assert.ok(everyRow.some((item) => item.status === 'FROZEN'));
                // The staff profile never carries money, even for a customer with unused prepaid sessions.
                assert.deepEqual(mine.totals, {
                  paidLeft: 2,
                  bonusLeft: 1,
                  frozenPaidLeft: 1,
                  frozenBonusLeft: 0,
                  value: null,
                });
                assert.ok(everyRow.every((item) => item.valueVnd === null));
                const bobs = await loyalty.combos(viewer.token, branch.id, bob.id, {});
                assert.equal(bobs.total, 3);
                assert.deepEqual(bobs.totals, {
                  paidLeft: 0,
                  bonusLeft: 0,
                  frozenPaidLeft: 2,
                  frozenBonusLeft: 1,
                  value: null,
                });
                await fails(
                  () => loyalty.combos(otherViewer.token, branch.id, alice.id, {}),
                  'FORBIDDEN',
                );
                await fails(
                  () => loyalty.combos(nobody.token, branch.id, alice.id, {}),
                  'FORBIDDEN',
                );
                await fails(
                  () => loyalty.combos(viewer.token, branch.id, ownerRow.id, {}),
                  'NOT_FOUND',
                );
                await fails(
                  () => loyalty.combos(viewer.token, branch.id, alice.id, { page: '0' }),
                  'VALIDATION_FAILED',
                  'page',
                );

                // Gifts: empty while OFF, then status, units left and expiry; the grant reason and staff names stay out.
                assert.equal((await loyalty.gifts(viewer.token, branch.id, alice.id, {})).total, 0);
                await loyalty.activate(ownerToken);
                const issuerRole = await tx.role.create({
                  data: {
                    code: `P510B_ISSUE_${run}`,
                    displayNameVi: 'ISSUE',
                    displayNameEn: 'ISSUE',
                    permissions: {
                      create: [
                        {
                          permissionId: (
                            await tx.permission.findUniqueOrThrow({
                              where: { code: 'ISSUE_REWARDS' },
                            })
                          ).id,
                        },
                      ],
                    },
                  },
                });
                const issuer = await staffUser(
                  branch.id,
                  issuerRole.id,
                  'BRANCH',
                  'Người tặng Bí Mật',
                );
                const item = await rewards.createItem(ownerToken, {
                  kind: 'PRODUCT_GIFT',
                  serviceId: null,
                  nameVi: 'Khăn spa',
                  nameEn: 'Spa towel',
                  active: true,
                  expiryDays: 30,
                });
                const grant = await rewards.issue(issuer.token, branch.id, alice.id, {
                  catalogItemId: item.id,
                  quantity: 3,
                  reason: 'Lý do tặng bí mật',
                });
                await rewards.use(issuer.token, branch.id, grant.id, { note: 'Ghi chú nội bộ' });
                const gifts = await loyalty.gifts(viewer.token, branch.id, alice.id, {});
                assert.equal(gifts.total, 1);
                assert.equal(gifts.items[0]!.status, 'ACTIVE');
                assert.equal(gifts.items[0]!.quantityLeft, 2);
                assert.ok(gifts.items[0]!.expiresAt);
                const text = JSON.stringify(gifts);
                for (const secret of ['Lý do tặng', 'Ghi chú nội bộ', 'Bí Mật', issuer.id]) {
                  assert.ok(!text.includes(secret), `leaked: ${secret}`);
                }
                await fails(
                  () => loyalty.gifts(otherViewer.token, branch.id, alice.id, {}),
                  'FORBIDDEN',
                );
                assert.equal((await loyalty.gifts(viewer.token, branch.id, bob.id, {})).total, 0);
              },
            );

            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
