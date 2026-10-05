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
import { RewardService } from './reward.service.js';

/**
 * Phase 5 P5-9: the reward catalog and the customers' entitlements against real PostgreSQL (design 10; the Owner's instruction and
 * answers of 2026-10-05). Definitions need `MANAGE_REWARD_CATALOG` (global); granting, using and revoking need `ISSUE_REWARDS` at a
 * branch and the go-live switch; a mistaken use is restored by a manager only. History is append-only, rewards never touch points.
 * Every fixture rolls back with the outer transaction.
 */
test(
  'Phase 5 P5-9 reward catalog; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-9 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `reward_${++savepoint}`;
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
            const rewards = new RewardService(sessionAdapter, throttle, environment);
            const loyalty = new LoyaltyService(sessionAdapter, throttle, environment);
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(Reflect.get(Object(error), 'code'), code);
                if (field !== undefined) assert.equal(Reflect.get(Object(error), 'field'), field);
                return true;
              });
            };
            const sqlRejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
              const name = `reject_${++savepoint}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                await assert.rejects(work, pattern);
              } finally {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              }
            };

            await syncPermissionCatalog(tx);
            type Code = 'ISSUE_REWARDS' | 'MANAGE_REWARD_CATALOG' | 'VIEW_LOYALTY';
            const category = await tx.serviceCategory.create({
              data: { code: `P59_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const makeService = (key: string, isActive = true) =>
              tx.service.create({
                data: {
                  code: `P59_${key}_${run}`,
                  categoryId: category.id,
                  nameVi: `Dịch vụ ${key}`,
                  nameEn: `Service ${key}`,
                  priceVnd: 200_000n,
                  priceMaxVnd: 200_000n,
                  pricingUnit: 'PER_SERVICE',
                  maxQuantity: 1,
                  durationMinutes: 10,
                  estimatedMinMinutes: 10,
                  estimatedMaxMinutes: 10,
                  isActive,
                },
              });
            const massage = await makeService('MASSAGE');
            const retired = await makeService('RETIRED', false);

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
            const phoneOf = () =>
              `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`;
            const customer = async (label: string) => {
              n++;
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `p59-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p59-${label}-${run.toLowerCase()}@example.com`,
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
                  emailCanonical: `p59-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p59-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P59_${name}_${run}`,
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
              scope: 'BRANCH' | 'GLOBAL' = 'BRANCH',
            ) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Staff ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: phoneOf(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `P59_${run}_${n}`,
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
              return { id: user.id, token: await login(user) };
            };
            const makeBranch = (label: string) =>
              tx.branch.create({
                data: {
                  code: `P59_${label}_${run}`,
                  name: `Reward ${label}`,
                  timezone: 'Asia/Ho_Chi_Minh',
                },
              });
            const branch = await makeBranch('MAIN');
            const otherBranch = await makeBranch('OTHER');
            const roles = {
              issue: await makeRole('ISSUE', ['ISSUE_REWARDS']),
              manage: await makeRole('MANAGE', ['MANAGE_REWARD_CATALOG']),
              view: await makeRole('VIEW', ['VIEW_LOYALTY']),
            };
            const issuer = await staffUser(branch.id, roles.issue.id);
            const otherIssuer = await staffUser(otherBranch.id, roles.issue.id);
            const manager = await staffUser(branch.id, roles.manage.id, 'GLOBAL');
            const viewer = await staffUser(branch.id, roles.view.id);
            const nobody = await staffUser(branch.id, null);
            const alice = await customer('alice');
            const bob = await customer('bob');

            const ledgerOf = (userId: string) => tx.loyaltyLedgerEntry.count({ where: { userId } });
            const walletsOf = (userId: string) =>
              tx.loyaltyWalletAccount.count({ where: { userId } });
            const catalog = {
              free: { kind: 'FREE_SERVICE' as const, serviceId: massage.id },
              voucher: { kind: 'VOUCHER' as const, serviceId: null },
              gift: { kind: 'PRODUCT_GIFT' as const, serviceId: null },
            };
            const values = (key: string, extra: { expiryDays?: number | null } = {}) => ({
              nameVi: `Quà ${key}`,
              nameEn: `Reward ${key}`,
              active: true,
              expiryDays: extra.expiryDays ?? null,
            });

            // ====================================================================== the catalog
            await suite.test(
              'the catalog ships empty; only a manager with MANAGE_REWARD_CATALOG (global) defines items; validation, edit, audit',
              async () => {
                assert.equal(await tx.rewardCatalogItem.count(), 0, 'no preset item');
                assert.equal(await tx.rewardEntitlement.count(), 0, 'no entitlement');
                // Permission: ISSUE_REWARDS alone, VIEW_LOYALTY and no role are all refused; the Owner may.
                for (const who of [issuer, viewer, nobody]) {
                  await fails(() => rewards.catalog(who.token), 'FORBIDDEN');
                  await fails(
                    () => rewards.createItem(who.token, { ...catalog.voucher, ...values('X') }),
                    'FORBIDDEN',
                  );
                }
                await fails(() => rewards.catalog(undefined), 'AUTHENTICATION_REQUIRED');
                const empty = await rewards.catalog(manager.token);
                assert.deepEqual(empty.items, []);
                assert.equal(empty.loyaltyLive, false);
                assert.ok(empty.serviceOptions.some((option) => option.id === massage.id));
                assert.ok(!empty.serviceOptions.some((option) => option.id === retired.id));

                // The three kinds.
                const free = await rewards.createItem(manager.token, {
                  ...catalog.free,
                  ...values('FREE', { expiryDays: 30 }),
                });
                assert.equal(free.kind, 'FREE_SERVICE');
                assert.equal(free.service?.id, massage.id);
                assert.equal(free.expiryDays, 30);
                assert.equal(free.rowVersion, 1);
                assert.match(free.code, /^REWARD-[A-Z0-9]{6}$/);
                const voucher = await rewards.createItem(ownerToken, {
                  ...catalog.voucher,
                  ...values('VOUCHER'),
                });
                assert.equal(voucher.service, null);
                assert.equal(voucher.expiryDays, null);
                const gift = await rewards.createItem(manager.token, {
                  ...catalog.gift,
                  ...values('GIFT'),
                });
                assert.equal(gift.kind, 'PRODUCT_GIFT');

                // Validation: a free service needs an active service; the others forbid one; kinds, names, expiry.
                await fails(
                  () =>
                    rewards.createItem(manager.token, {
                      kind: 'FREE_SERVICE',
                      serviceId: null,
                      ...values('A'),
                    }),
                  'VALIDATION_FAILED',
                  'serviceId',
                );
                await fails(
                  () =>
                    rewards.createItem(manager.token, {
                      kind: 'FREE_SERVICE',
                      serviceId: retired.id,
                      ...values('B'),
                    }),
                  'REWARD_SERVICE_INVALID',
                );
                await fails(
                  () =>
                    rewards.createItem(manager.token, {
                      kind: 'VOUCHER',
                      serviceId: massage.id,
                      ...values('C'),
                    }),
                  'VALIDATION_FAILED',
                  'serviceId',
                );
                await fails(
                  () =>
                    rewards.createItem(manager.token, {
                      kind: 'OTHER',
                      serviceId: null,
                      ...values('D'),
                    }),
                  'VALIDATION_FAILED',
                  'kind',
                );
                await fails(
                  () =>
                    rewards.createItem(manager.token, {
                      ...catalog.voucher,
                      ...values('E'),
                      nameVi: '   ',
                    }),
                  'VALIDATION_FAILED',
                  'nameVi',
                );
                for (const bad of [0, -1, 1.5, 3651]) {
                  await fails(
                    () =>
                      rewards.createItem(manager.token, {
                        ...catalog.voucher,
                        ...values('F', { expiryDays: bad }),
                      }),
                    'VALIDATION_FAILED',
                    'expiryDays',
                  );
                }
                assert.equal(await tx.rewardCatalogItem.count(), 3, 'refusals wrote nothing');

                // Edit: names, active flag, expiry rule under an optimistic row version; same values change nothing.
                const edited = await rewards.editItem(manager.token, voucher.id, {
                  expectedRowVersion: 1,
                  nameVi: 'Phiếu mới',
                  nameEn: 'New voucher',
                  active: true,
                  expiryDays: 14,
                });
                assert.equal(edited.rowVersion, 2);
                assert.equal(edited.expiryDays, 14);
                assert.equal(edited.code, voucher.code);
                await fails(
                  () =>
                    rewards.editItem(manager.token, voucher.id, {
                      expectedRowVersion: 1,
                      nameVi: 'Cũ',
                      nameEn: 'Old',
                      active: true,
                      expiryDays: null,
                    }),
                  'CONFLICT',
                );
                const same = await rewards.editItem(manager.token, voucher.id, {
                  expectedRowVersion: 2,
                  nameVi: 'Phiếu mới',
                  nameEn: 'New voucher',
                  active: true,
                  expiryDays: 14,
                });
                assert.equal(same.rowVersion, 2, 'the same values do not advance the version');
                await fails(
                  () =>
                    rewards.editItem(issuer.token, voucher.id, {
                      expectedRowVersion: 2,
                      nameVi: 'x',
                      nameEn: 'x',
                      active: true,
                      expiryDays: null,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    rewards.editItem(manager.token, randomUUID(), {
                      expectedRowVersion: 1,
                      nameVi: 'x',
                      nameEn: 'x',
                      active: true,
                      expiryDays: null,
                    }),
                  'NOT_FOUND',
                );
                const audits = await tx.auditEvent.findMany({
                  where: { entityType: 'RewardCatalogItem', entityId: voucher.id },
                  orderBy: { occurredAt: 'asc' },
                });
                assert.deepEqual(
                  audits.map((audit) => audit.action),
                  ['REWARD_ITEM_CREATED', 'REWARD_ITEM_UPDATED'],
                );
                assert.ok(audits[1]!.before && audits[1]!.after, 'an edit keeps before and after');

                // The identity of an item never changes and an item is never deleted (database).
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE reward_catalog_items SET code = 'HACK' WHERE id = '${free.id}'`,
                    ),
                  /identity is immutable/,
                );
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `DELETE FROM reward_catalog_items WHERE id = '${free.id}'`,
                    ),
                  /cannot be removed or rewritten/,
                );
              },
            );

            // ====================================================================== go-live OFF
            await suite.test(
              'go-live OFF: nothing can be granted (API and database); the issue options say so',
              async () => {
                assert.equal(await tx.loyaltyGoLive.count(), 0);
                const item = await tx.rewardCatalogItem.findFirstOrThrow({
                  where: { kind: 'VOUCHER' },
                });
                const options = await rewards.options(issuer.token, branch.id);
                assert.equal(options.loyaltyLive, false);
                assert.equal(options.items.length, 3);
                await fails(
                  () =>
                    rewards.issue(issuer.token, branch.id, alice.id, {
                      catalogItemId: item.id,
                      quantity: 1,
                      reason: 'Quà tặng',
                    }),
                  'LOYALTY_NOT_LIVE',
                );
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO reward_entitlements (owner_user_id, catalog_item_id, source_kind, quantity_issued)
                       VALUES ('${alice.id}', '${item.id}', 'CAMPAIGN', 1)`,
                    ),
                  /Loyalty is not live/,
                );
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO reward_manual_uses (entitlement_id, branch_id, used_by_user_id)
                       VALUES ('${randomUUID()}', '${branch.id}', '${issuer.id}')`,
                    ),
                  /Loyalty is not live/,
                );
                assert.equal(await tx.rewardEntitlement.count(), 0);
              },
            );

            // Switch the programme on (Owner, fresh password): the rest needs it.
            await loyalty.activate(ownerToken);
            const items = Object.fromEntries(
              (await tx.rewardCatalogItem.findMany()).map((row) => [row.kind, row]),
            ) as unknown as Record<'FREE_SERVICE' | 'VOUCHER' | 'PRODUCT_GIFT', { id: string }>;

            // ====================================================================== granting
            await suite.test(
              'granting: ISSUE_REWARDS at the branch, exact masked lookup, validation, expiry from the item, audit, event; points untouched',
              async () => {
                const before = {
                  ledger: await ledgerOf(alice.id),
                  wallets: await walletsOf(alice.id),
                };
                // Lookup: exact phone only, masked, no listing.
                const found = await rewards.lookup(issuer.token, branch.id, {
                  phone: typed(alice),
                });
                assert.equal(found.members.length, 1);
                assert.equal(found.members[0]!.id, alice.id);
                assert.ok(found.members[0]!.phoneMasked);
                assert.notEqual(found.members[0]!.phoneMasked, typed(alice));
                assert.ok(!JSON.stringify(found).includes(alice.phoneCanonical!));
                assert.deepEqual(
                  (await rewards.lookup(issuer.token, branch.id, { phone: '0900000001' })).members,
                  [],
                );
                await fails(
                  () => rewards.lookup(issuer.token, branch.id, { phone: 'abc' }),
                  'VALIDATION_FAILED',
                  'phone',
                );
                await fails(() => rewards.lookup(issuer.token, branch.id, {}), 'VALIDATION_FAILED');
                // Permission: only ISSUE_REWARDS at THAT branch (another branch, a manager without it, view, none).
                for (const who of [otherIssuer, manager, viewer, nobody]) {
                  await fails(
                    () => rewards.lookup(who.token, branch.id, { phone: typed(alice) }),
                    'FORBIDDEN',
                  );
                  await fails(
                    () =>
                      rewards.issue(who.token, branch.id, alice.id, {
                        catalogItemId: items.VOUCHER.id,
                        quantity: 1,
                        reason: 'Không được',
                      }),
                    'FORBIDDEN',
                  );
                  await fails(() => rewards.options(who.token, branch.id), 'FORBIDDEN');
                }
                await fails(
                  async () =>
                    rewards.issue(issuer.token, 'not-a-uuid', alice.id, {
                      catalogItemId: items.VOUCHER.id,
                      quantity: 1,
                      reason: 'Sai nhánh',
                    }),
                  'NOT_FOUND',
                );
                // Validation: quantity, reason, item, customer.
                const grant = (quantity: unknown, reason: unknown, itemId = items.VOUCHER.id) =>
                  rewards.issue(issuer.token, branch.id, alice.id, {
                    catalogItemId: itemId,
                    quantity: quantity as number,
                    reason: reason as string,
                  });
                for (const bad of [0, -1, 1.5, 51, '2']) {
                  await fails(() => grant(bad, 'Lý do'), 'VALIDATION_FAILED', 'quantity');
                }
                await fails(() => grant(1, ''), 'VALIDATION_FAILED', 'reason');
                await fails(() => grant(1, '   '), 'VALIDATION_FAILED', 'reason');
                await fails(() => grant(1, 'x'.repeat(501)), 'VALIDATION_FAILED', 'reason');
                await fails(() => grant(1, 'Lý do', randomUUID()), 'NOT_FOUND', 'catalogItemId');
                await fails(
                  () =>
                    rewards.issue(issuer.token, branch.id, issuer.id, {
                      catalogItemId: items.VOUCHER.id,
                      quantity: 1,
                      reason: 'Nhân viên không phải khách',
                    }),
                  'NOT_FOUND',
                );
                // An inactive item cannot be granted.
                const switchedOff = await rewards.editItem(manager.token, items.PRODUCT_GIFT.id, {
                  expectedRowVersion: 1,
                  nameVi: 'Quà GIFT',
                  nameEn: 'Reward GIFT',
                  active: false,
                  expiryDays: null,
                });
                assert.equal(switchedOff.active, false);
                await fails(() => grant(1, 'Lý do', items.PRODUCT_GIFT.id), 'REWARD_ITEM_INACTIVE');
                assert.equal(
                  (await rewards.options(issuer.token, branch.id)).items.length,
                  2,
                  'only active items are offered',
                );
                // The voucher item had a 14-day rule in the catalog test; switch it off so this grant has no expiry.
                await rewards.editItem(manager.token, items.VOUCHER.id, {
                  expectedRowVersion: 2,
                  nameVi: 'Phiếu mới',
                  nameEn: 'New voucher',
                  active: true,
                  expiryDays: null,
                });
                // A grant: quantity, issuer, reason, status; an item with an expiry rule fixes the expiry NOW.
                const first = await grant(3, '  Quà sinh nhật bù  ');
                assert.equal(first.status, 'ACTIVE');
                assert.equal(first.quantityIssued, 3);
                assert.equal(first.quantityUsed, 0);
                assert.equal(first.quantityLeft, 3);
                assert.equal(first.reason, 'Quà sinh nhật bù');
                assert.equal(first.issuedByName, 'Staff 1');
                assert.equal(first.expiresAt, null, 'the voucher item had no expiry when granted');
                assert.deepEqual(first.can, { use: true, revoke: true, restore: false });
                const dated = await grant(1, 'Có hạn', items.FREE_SERVICE.id);
                assert.equal(dated.item.service?.nameVi, 'Dịch vụ MASSAGE');
                assert.equal(
                  new Date(dated.expiresAt!).getTime() - new Date(dated.issuedAt).getTime(),
                  30 * 24 * 3600 * 1000,
                  'the expiry is issue date + the item rule',
                );
                // A later change of the rule does not move an existing expiry.
                await rewards.editItem(manager.token, items.FREE_SERVICE.id, {
                  expectedRowVersion: 1,
                  nameVi: 'Quà FREE',
                  nameEn: 'Reward FREE',
                  active: true,
                  expiryDays: null,
                });
                const reread = await rewards.list(issuer.token, branch.id, alice.id, {});
                assert.equal(
                  reread.items.find((entry) => entry.id === dated.id)!.expiresAt,
                  dated.expiresAt,
                );
                // Audit and event: reason, subject, branch; ids only in the event.
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REWARD_ISSUED', entityId: first.id },
                });
                assert.equal(audit.subjectUserId, alice.id);
                assert.equal(audit.branchId, branch.id);
                assert.equal(audit.reason, 'Quà sinh nhật bù');
                const event = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: first.id, eventType: 'REWARD_ISSUED' },
                });
                assert.ok(!JSON.stringify(event.payload).includes('Quà sinh nhật'));
                // Rewards are not points: nothing moved in a wallet or the ledger.
                assert.equal(await ledgerOf(alice.id), before.ledger);
                assert.equal(await walletsOf(alice.id), before.wallets);
                // The listing: newest first, the customer masked, paging validated.
                const page = await rewards.list(issuer.token, branch.id, alice.id, {});
                assert.equal(page.total, 2);
                assert.equal(page.pageSize, 20);
                assert.equal(page.canIssue, true);
                assert.equal(page.items[0]!.id, dated.id, 'newest first');
                assert.equal(page.customer.id, alice.id);
                await fails(
                  () => rewards.list(issuer.token, branch.id, alice.id, { page: '0' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => rewards.list(otherIssuer.token, branch.id, alice.id, {}),
                  'FORBIDDEN',
                );
                await fails(
                  () => rewards.list(issuer.token, branch.id, issuer.id, {}),
                  'NOT_FOUND',
                );
                assert.equal((await rewards.list(issuer.token, branch.id, bob.id, {})).total, 0);
              },
            );

            // ====================================================================== using
            await suite.test(
              'using: one unit at a time at any branch with ISSUE_REWARDS, nothing left, expired and revoked refused; history',
              async () => {
                const grants = await rewards.list(issuer.token, branch.id, alice.id, {});
                const triple = grants.items.find((entry) => entry.quantityIssued === 3)!;
                await fails(() => rewards.use(viewer.token, branch.id, triple.id, {}), 'FORBIDDEN');
                await fails(
                  () => rewards.use(manager.token, branch.id, triple.id, {}),
                  'FORBIDDEN',
                );
                await fails(
                  () => rewards.use(otherIssuer.token, branch.id, triple.id, {}),
                  'FORBIDDEN',
                  undefined,
                );
                await fails(
                  () => rewards.use(issuer.token, branch.id, randomUUID(), {}),
                  'NOT_FOUND',
                );
                await fails(
                  () => rewards.use(issuer.token, branch.id, triple.id, { note: 'x'.repeat(501) }),
                  'VALIDATION_FAILED',
                  'note',
                );
                const one = await rewards.use(issuer.token, branch.id, triple.id, {
                  note: '  Khách hài lòng  ',
                });
                assert.equal(one.quantityUsed, 1);
                assert.equal(one.quantityLeft, 2);
                assert.equal(one.status, 'ACTIVE');
                assert.equal(one.uses.length, 1);
                assert.equal(one.uses[0]!.note, 'Khách hài lòng');
                assert.equal(one.uses[0]!.branchName, 'Reward MAIN');
                assert.equal(one.uses[0]!.usedByName, 'Staff 1');
                // Any branch: a staff member of the OTHER branch uses it there (they hold ISSUE_REWARDS at that branch).
                const two = await rewards.use(otherIssuer.token, otherBranch.id, triple.id, {});
                assert.equal(two.uses[1]!.branchName, 'Reward OTHER');
                assert.equal(two.uses[1]!.note, null);
                const three = await rewards.use(issuer.token, branch.id, triple.id, {});
                assert.equal(three.status, 'USED_UP');
                assert.equal(three.quantityLeft, 0);
                assert.deepEqual(three.can, { use: false, revoke: true, restore: false });
                await fails(
                  () => rewards.use(issuer.token, branch.id, triple.id, {}),
                  'REWARD_NOTHING_LEFT',
                );
                assert.equal(
                  await tx.rewardManualUse.count({ where: { entitlementId: triple.id } }),
                  3,
                  'the refused fourth use wrote nothing',
                );
                // Audit and event for a use.
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REWARD_USED', entityId: triple.id, reason: 'Khách hài lòng' },
                });
                assert.equal(audit.subjectUserId, alice.id);
                assert.equal(audit.branchId, branch.id);
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: triple.id, eventType: 'REWARD_REDEEMED' },
                  }),
                  3,
                );
                // The database refuses a unit beyond the quantity even when written around the API.
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO reward_manual_uses (entitlement_id, branch_id, used_by_user_id)
                       VALUES ('${triple.id}', '${branch.id}', '${issuer.id}')`,
                    ),
                  /no quantity left/,
                );
                // An expired entitlement cannot be used (the expiry is moved into the past around the guard).
                const dated = grants.items.find((entry) => entry.expiresAt !== null)!;
                await tx.$executeRawUnsafe('ALTER TABLE reward_entitlements DISABLE TRIGGER USER');
                await tx.$executeRawUnsafe(
                  `UPDATE reward_entitlements SET expires_at = clock_timestamp() - interval '1 minute' WHERE id = '${dated.id}'`,
                );
                await tx.$executeRawUnsafe('ALTER TABLE reward_entitlements ENABLE TRIGGER USER');
                await fails(
                  () => rewards.use(issuer.token, branch.id, dated.id, {}),
                  'REWARD_NOT_USABLE',
                );
                const expired = (
                  await rewards.list(issuer.token, branch.id, alice.id, {})
                ).items.find((entry) => entry.id === dated.id)!;
                assert.equal(expired.status, 'EXPIRED');
                assert.equal(expired.can.use, false);
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO reward_manual_uses (entitlement_id, branch_id, used_by_user_id)
                       VALUES ('${dated.id}', '${branch.id}', '${issuer.id}')`,
                    ),
                  /voided or expired entitlement cannot be used/,
                );
              },
            );

            // ====================================================================== revoking
            await suite.test(
              'revoking: a reason is required, nothing is deleted, used units stay, twice and later use refused',
              async () => {
                const fresh = await rewards.issue(issuer.token, branch.id, bob.id, {
                  catalogItemId: items.VOUCHER.id,
                  quantity: 4,
                  reason: 'Tặng nhầm khách',
                });
                const used = await rewards.use(issuer.token, branch.id, fresh.id, {});
                assert.equal(used.quantityUsed, 1);
                for (const bad of ['', '   ', 'x'.repeat(501)]) {
                  await fails(
                    () => rewards.revoke(issuer.token, branch.id, fresh.id, { reason: bad }),
                    'VALIDATION_FAILED',
                    'reason',
                  );
                }
                await fails(
                  () =>
                    rewards.revoke(otherIssuer.token, branch.id, fresh.id, {
                      reason: 'Không được',
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    rewards.revoke(manager.token, branch.id, fresh.id, { reason: 'Không được' }),
                  'FORBIDDEN',
                );
                const revoked = await rewards.revoke(issuer.token, branch.id, fresh.id, {
                  reason: '  Nhập nhầm khách  ',
                });
                assert.equal(revoked.status, 'VOIDED');
                assert.equal(revoked.void?.reason, 'Nhập nhầm khách');
                assert.equal(revoked.void?.byName, 'Staff 1');
                assert.equal(revoked.uses.length, 1, 'the used unit stays as history');
                assert.equal(revoked.quantityIssued, 4);
                assert.deepEqual(revoked.can, { use: false, revoke: false, restore: false });
                await fails(
                  () => rewards.revoke(issuer.token, branch.id, fresh.id, { reason: 'Lại' }),
                  'REWARD_ALREADY_VOIDED',
                );
                await fails(
                  () => rewards.use(issuer.token, branch.id, fresh.id, {}),
                  'REWARD_NOT_USABLE',
                );
                assert.equal(
                  await tx.rewardEntitlement.count({ where: { id: fresh.id } }),
                  1,
                  'never deleted',
                );
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REWARD_VOIDED', entityId: fresh.id },
                });
                assert.equal(audit.reason, 'Nhập nhầm khách');
                assert.equal(audit.subjectUserId, bob.id);
                // The void facts are written once and never change (database).
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE reward_entitlements SET void_reason = 'khác' WHERE id = '${fresh.id}'`,
                    ),
                  /voided entitlement cannot change/,
                );
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `DELETE FROM reward_entitlements WHERE id = '${fresh.id}'`,
                    ),
                  /cannot be removed or rewritten/,
                );
              },
            );

            // ====================================================================== restoring a mistaken use
            await suite.test(
              'restoring a mistaken use: manager only, a reason, one offset row, the unit is free again; revoked and twice refused',
              async () => {
                const grant = await rewards.issue(issuer.token, branch.id, bob.id, {
                  catalogItemId: items.VOUCHER.id,
                  quantity: 1,
                  reason: 'Quà thử',
                });
                const used = await rewards.use(issuer.token, branch.id, grant.id, {
                  note: 'Bấm nhầm',
                });
                assert.equal(used.status, 'USED_UP');
                const useId = used.uses[0]!.id;
                for (const who of [issuer, otherIssuer, viewer, nobody]) {
                  await fails(
                    () => rewards.restore(who.token, useId, { reason: 'Không được' }),
                    'FORBIDDEN',
                  );
                }
                for (const bad of ['', '   ']) {
                  await fails(
                    () => rewards.restore(manager.token, useId, { reason: bad }),
                    'VALIDATION_FAILED',
                    'reason',
                  );
                }
                await fails(
                  () => rewards.restore(manager.token, randomUUID(), { reason: 'Không có' }),
                  'NOT_FOUND',
                );
                const restored = await rewards.restore(manager.token, useId, {
                  reason: '  Nhân viên bấm nhầm  ',
                });
                assert.equal(restored.status, 'ACTIVE');
                assert.equal(restored.quantityUsed, 0);
                assert.equal(restored.quantityLeft, 1);
                assert.equal(restored.uses.length, 1, 'the use stays as history');
                assert.equal(restored.uses[0]!.restoration?.reason, 'Nhân viên bấm nhầm');
                assert.equal(restored.uses[0]!.restoration?.restoredByName, 'Staff 3');
                assert.equal(
                  await tx.rewardManualUseRestoration.count({ where: { useId } }),
                  1,
                  'one offset row',
                );
                await fails(
                  () => rewards.restore(manager.token, useId, { reason: 'Lần hai' }),
                  'REWARD_USE_NOT_RESTORABLE',
                );
                // The freed unit can be used again; then a revoked grant refuses a restoration.
                const again = await rewards.use(issuer.token, branch.id, grant.id, {});
                assert.equal(again.status, 'USED_UP');
                assert.equal(again.uses.length, 2);
                const second = again.uses.find((entry) => entry.restoration === null)!;
                await fails(() => rewards.list(manager.token, branch.id, bob.id, {}), 'FORBIDDEN');
                await rewards.revoke(issuer.token, branch.id, grant.id, { reason: 'Thu hồi sau' });
                await fails(
                  () => rewards.restore(manager.token, second.id, { reason: 'Quá muộn' }),
                  'REWARD_USE_NOT_RESTORABLE',
                );
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REWARD_USE_RESTORED', entityId: grant.id },
                });
                assert.equal(audit.reason, 'Nhân viên bấm nhầm');
                assert.equal(audit.subjectUserId, bob.id);
                // History is append-only (database): uses and restorations cannot be edited, deleted or truncated.
                for (const statement of [
                  `UPDATE reward_manual_uses SET note = 'sửa' WHERE id = '${useId}'`,
                  `DELETE FROM reward_manual_uses WHERE id = '${useId}'`,
                  `UPDATE reward_manual_use_restorations SET reason = 'sửa' WHERE use_id = '${useId}'`,
                  `DELETE FROM reward_manual_use_restorations WHERE use_id = '${useId}'`,
                ]) {
                  await sqlRejects(
                    () => tx.$executeRawUnsafe(statement),
                    /cannot be removed or rewritten/,
                  );
                }
                // Neither table can be truncated: each has its BEFORE TRUNCATE guard.
                for (const table of ['reward_manual_uses', 'reward_manual_use_restorations']) {
                  const guards = await tx.$queryRaw<{ n: bigint }[]>`
                    SELECT count(*)::bigint AS n FROM pg_trigger t
                    WHERE t.tgrelid = ${table}::regclass AND t.tgname = ${`${table}_no_truncate`}
                      AND (t.tgtype & 32) = 32 AND (t.tgtype & 2) = 2`;
                  assert.equal(guards[0]!.n, 1n, `${table} has a BEFORE TRUNCATE guard`);
                }
                // A restoration needs a reason even around the API.
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO reward_manual_use_restorations (use_id, restored_by_user_id, reason)
                       VALUES ('${second.id}', '${manager.id}', '  ')`,
                    ),
                  /reward_manual_use_restorations_reason/,
                );
              },
            );

            // ====================================================================== separate from points
            await suite.test(
              'rewards are separate from points: no ledger or wallet row from any reward command, and no exchange exists',
              async () => {
                assert.equal(await ledgerOf(alice.id), 0);
                assert.equal(await ledgerOf(bob.id), 0);
                assert.equal(await walletsOf(alice.id), 0);
                assert.equal(await walletsOf(bob.id), 0);
                const rewardEvents = await tx.outboxEvent.findMany({
                  where: { aggregateType: 'RewardEntitlement' },
                  select: { eventType: true },
                });
                assert.ok(rewardEvents.length > 0);
                for (const event of rewardEvents) {
                  assert.ok(
                    [
                      'REWARD_ISSUED',
                      'REWARD_REDEEMED',
                      'REWARD_VOIDED',
                      'REWARD_USE_RESTORED',
                    ].includes(event.eventType),
                  );
                }
                assert.equal(
                  await tx.loyaltyLedgerEntry.count({
                    where: { userId: { in: [alice.id, bob.id] } },
                  }),
                  0,
                );
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
