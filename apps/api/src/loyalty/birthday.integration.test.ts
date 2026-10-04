import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  BirthdayRewardConfigResponse,
  BirthdayRewardSaveRequest,
  InvoiceResponse,
} from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  createPayosSimulator,
  LOYALTY_EVENT_TYPES,
  parseApiEnvironment,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import { birthdayOccurrence } from '../pos/birthday.engine.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { LoyaltyService } from './loyalty.service.js';

/**
 * Phase 5 P5-6: the birthday gift against real PostgreSQL (design 6.3, 8 and the Owner decisions of 2026-10-04, OQ-8). The
 * Owner configures through the real service; staff finalize, pay and cancel through the real invoice service; the `loyalty`
 * consumer earns on the real INVOICE_PAID events. The invoice business date is the database's own "today" in the branch
 * timezone, so each payer's date of birth is chosen relative to it. Every fixture rolls back with the outer transaction.
 */
test(
  'Phase 5 P5-6 birthday gift; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-6 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `birthday_${++savepoint}`;
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
            const simulator = createPayosSimulator();
            const invoices = new InvoiceService(
              sessionAdapter,
              new AuthThrottleService(environment),
              environment,
              simulator.provider,
            );
            const loyalty = new LoyaltyService(
              sessionAdapter,
              new AuthThrottleService(environment),
              environment,
            );
            const settle = async () => {
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            };
            const ok = async <T>(work: () => Promise<T>): Promise<T> => {
              const result = await work();
              await settle();
              return result;
            };
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
                await assert.rejects(async () => {
                  await work();
                  await settle();
                }, pattern);
              } finally {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              }
            };

            await syncPermissionCatalog(tx);
            type Code =
              | 'VIEW_INVOICES'
              | 'MANAGE_INVOICES'
              | 'CANCEL_INVOICES'
              | 'COLLECT_PAYMENTS'
              | 'VIEW_LOYALTY';
            const category = await tx.serviceCategory.create({
              data: { code: `P56_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const exact = await tx.service.create({
              data: {
                code: `P56_EXACT_${run}`,
                categoryId: category.id,
                nameVi: 'Dịch vụ',
                nameEn: 'Service',
                priceVnd: 200_000n,
                priceMaxVnd: 200_000n,
                pricingUnit: 'PER_SERVICE',
                maxQuantity: 1,
                durationMinutes: 10,
                estimatedMinMinutes: 10,
                estimatedMaxMinutes: 10,
              },
            });
            type Service = typeof exact;

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

            // ------------------------------------------------------------------ dates: relative to the database's "today"
            const branchRow = await tx.branch.create({
              data: { code: `P56_MAIN_${run}`, name: 'Birthday', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const branch = branchRow;
            const todayRows = await tx.$queryRaw<{ today: string }[]>`
              SELECT lucy_branch_local_date(${branch.id}::uuid, clock_timestamp())::text AS today`;
            const today = todayRows[0]!.today;
            const shiftDay = (days: number) => {
              const date = new Date(`${today}T00:00:00.000Z`);
              date.setUTCDate(date.getUTCDate() + days);
              return date.toISOString().slice(0, 10);
            };
            /** A date of birth (year 2000, a leap year, so every month-day exists) whose birthday falls `offset` days from today. */
            const dobWithBirthdayIn = (offset: number) =>
              new Date(`2000${shiftDay(offset).slice(4)}`);

            const customer = async (label: string, birthdayOffset: number | null = 0) => {
              n++;
              const phone = phoneOf();
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `p56-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p56-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: phone,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: {
                      dateOfBirth:
                        birthdayOffset === null
                          ? new Date('1990-06-15')
                          : dobWithBirthdayIn(birthdayOffset),
                      address: 'Fixture',
                    },
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
                  emailCanonical: `p56-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p56-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);

            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P56_${name}_${run}`,
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
            const staffUser = async (roleId: string | null) => {
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
                      employeeCodeCanonical: `P56_${run}_${n}`,
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
              if (roleId) {
                await tx.userRoleAssignment.create({
                  data: { userId: user.id, roleId, scopeKind: 'BRANCH', branchId: branch.id },
                });
              }
              return { id: user.id, token: await login(user) };
            };
            const roles = {
              prepare: await makeRole('PREPARE', ['VIEW_INVOICES', 'MANAGE_INVOICES']),
              collect: await makeRole('COLLECT', ['COLLECT_PAYMENTS']),
              cancel: await makeRole('CANCEL', ['CANCEL_INVOICES', 'VIEW_INVOICES']),
              view: await makeRole('VIEW', ['VIEW_LOYALTY']),
            };
            const cashier = await staffUser(roles.prepare.id);
            const collector = await staffUser(roles.collect.id);
            const canceller = await staffUser(roles.cancel.id);
            const viewer = await staffUser(roles.view.id);
            const ktv = await staffUser(null);

            // ------------------------------------------------------------------------ visit and invoice helpers
            let slot = 0;
            let clock = 0;
            const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
            type Recipient = { member: { id: string } } | { guest: true };
            const completedVisit = async (
              service: Service,
              recipient: Recipient,
              owner: { id: string } | null,
            ) => {
              n++;
              const visit = await tx.visit.create({
                data: {
                  code: `VS-P56-${run}-${n}`,
                  branchId: branch.id,
                  origin: 'WALK_IN',
                  ownerUserId: owner?.id ?? null,
                  serviceDate: new Date('2027-03-01T00:00:00.000Z'),
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: cashier.id,
                  idempotencyKey: randomUUID(),
                },
              });
              const participant = await tx.visitParticipant.create({
                data:
                  'member' in recipient
                    ? { visitId: visit.id, kind: 'MEMBER', customerUserId: recipient.member.id }
                    : { visitId: visit.id, kind: 'GUEST', displayName: 'Khách lẻ', phone: null },
              });
              const start = new Date(LOCAL_MIDNIGHT + (6 * 60 + 10 * slot++) * 60_000);
              const line = await tx.visitServiceLine.create({
                data: {
                  visitId: visit.id,
                  participantId: participant.id,
                  sequence: 1,
                  serviceId: service.id,
                  employeeUserId: ktv.id,
                  assignmentMode: 'ANY',
                  plannedStartAt: start,
                  plannedEndAt: new Date(start.getTime() + 10 * 60_000),
                  durationMinutes: 10,
                  bufferMinutes: 0,
                  serviceCode: service.code,
                  serviceNameVi: service.nameVi,
                  serviceNameEn: service.nameEn,
                  catalogPriceMinVnd: service.priceVnd,
                  catalogPriceMaxVnd: service.priceMaxVnd,
                  catalogPricingUnit: service.pricingUnit,
                  maxQuantitySnapshot: service.maxQuantity,
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
                  completedAt: new Date(
                    new Date('2027-03-01T07:00:00+07:00').getTime() + ++clock * 60_000,
                  ),
                  rowVersion: { increment: 1 },
                },
              });
              return visit.id;
            };
            /** A DRAFT whose payer is `payer` (the visit owner) or a guest (no owner). */
            const draftOf = async (payer: { id: string } | null, service: Service = exact) => {
              const visitId = await completedVisit(
                service,
                payer ? { member: payer } : { guest: true },
                payer,
              );
              let current = (await ok(() => invoices.open(cashier.token, visitId))).invoice;
              for (const line of current.lines) {
                current = await ok(() =>
                  invoices.setPrice(cashier.token, current.id, line.id, {
                    expectedVersion: current.version,
                    unitPriceVnd: line.priceMinVnd,
                  }),
                );
              }
              return current;
            };
            const finalize = async (draft: InvoiceResponse) =>
              (await ok(() =>
                invoices.finalize(cashier.token, draft.id, { expectedVersion: draft.version }),
              )) as InvoiceResponse;
            const finalized = async (payer: { id: string } | null) =>
              finalize(await draftOf(payer));
            const pay = (invoice: InvoiceResponse) =>
              ok(() =>
                invoices.recordPayment(collector.token, invoice.id, {
                  method: 'CASH',
                  amountVnd: invoice.totalVnd,
                  tenderedVnd: invoice.totalVnd,
                  idempotencyKey: randomUUID(),
                }),
              );
            const cancel = (invoice: InvoiceResponse) =>
              ok(() =>
                invoices.cancel(canceller.token, invoice.id, {
                  expectedVersion: invoice.version,
                  reason: 'Khách đổi ý',
                }),
              );
            const consume = async (invoiceId: string) => {
              const events = await tx.outboxEvent.findMany({
                where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
              for (const event of events) {
                await processLoyaltyEvent(tx, event.id);
                await settle();
              }
            };
            const balanceOf = async (userId: string) =>
              (
                await tx.loyaltyWalletAccount.findUnique({
                  where: { userId_wallet: { userId, wallet: 'SPA' } },
                })
              )?.balancePoints ?? 0;

            // ----------------------------------------------------------------------------------- configuration
            const body = (
              over: Partial<BirthdayRewardSaveRequest> = {},
            ): BirthdayRewardSaveRequest => ({
              expectedVersionNo: null,
              isActive: true,
              kind: 'FIXED_AMOUNT',
              percentBp: null,
              fixedAmountVnd: '50000',
              minSpendVnd: '0',
              windowDaysBefore: 7,
              windowDaysAfter: 7,
              combineMember: false,
              combinePromotion: false,
              combineVoucher: false,
              usageLimit: { mode: 'PER_YEAR', perYear: 1 },
              ...over,
            });
            let current: BirthdayRewardConfigResponse | null = null;
            const read = async () => {
              current = await ok(() => loyalty.birthdayReward(ownerToken));
              return current;
            };
            /** Saves a new version on top of the current one. */
            const save = async (over: Partial<BirthdayRewardSaveRequest> = {}) => {
              const before = current ?? (await read());
              current = await ok(() =>
                loyalty.saveBirthdayReward(
                  ownerToken,
                  body({ expectedVersionNo: before.current?.versionNo ?? null, ...over }),
                ),
              );
              return current;
            };
            const giveTier = async (user: { id: string }, points: number) => {
              await ok(() =>
                loyalty.adjust(ownerToken, user.id, {
                  wallet: 'SPA',
                  points,
                  reason: 'Fixture',
                  clientRequestId: randomUUID(),
                }),
              );
            };
            const snapshotOf = (invoiceId: string) =>
              tx.invoiceLoyaltySnapshot.findUniqueOrThrow({ where: { invoiceId } });
            const redemptionOf = (invoiceId: string) =>
              tx.birthdayRedemption.findUnique({
                where: { invoiceId },
                include: { release: true },
              });

            // ====================================================================== ships empty, Owner only
            await suite.test('ships empty: no configuration, no version, no gift', async () => {
              assert.equal(await tx.birthdayRewardConfig.count(), 0);
              assert.equal(await tx.birthdayRewardVersion.count(), 0);
              assert.equal(await tx.birthdayRedemption.count(), 0);
              const empty = await read();
              assert.equal(empty.configured, false);
              assert.equal(empty.current, null);
              assert.deepEqual(empty.versions, []);
              assert.equal(empty.loyaltyLive, false);
            });

            await suite.test(
              'Owner only: staff cannot read or save it, and no role can ever carry the permission',
              async () => {
                await fails(() => loyalty.birthdayReward(viewer.token), 'FORBIDDEN');
                await fails(() => loyalty.birthdayReward(cashier.token), 'FORBIDDEN');
                await fails(() => loyalty.saveBirthdayReward(cashier.token, body()), 'FORBIDDEN');
                const permission = await tx.permission.findUniqueOrThrow({
                  where: { code: 'MANAGE_BIRTHDAY_REWARDS' },
                });
                const role = await tx.role.create({
                  data: {
                    code: `P56_BAD_${run}`,
                    displayNameVi: 'x',
                    displayNameEn: 'x',
                  },
                });
                await sqlRejects(
                  () =>
                    tx.rolePermission.create({
                      data: { roleId: role.id, permissionId: permission.id },
                    }),
                  /belongs to the Owner/,
                );
                assert.equal(
                  await tx.birthdayRewardConfig.count(),
                  0,
                  'refused saves left nothing',
                );
              },
            );

            await suite.test(
              'save validation: every field is explicit, the usage limit included (Owner, OQ-8 #6)',
              async () => {
                const bad = (over: Partial<BirthdayRewardSaveRequest>, field: string) =>
                  fails(
                    () => loyalty.saveBirthdayReward(ownerToken, body(over)),
                    'VALIDATION_FAILED',
                    field,
                  );
                await bad({ usageLimit: undefined as never }, 'usageLimit');
                await bad({ usageLimit: {} as never }, 'usageLimit');
                await bad({ usageLimit: { mode: 'PER_YEAR', perYear: 0 } }, 'usageLimit');
                await bad({ usageLimit: { mode: 'PER_YEAR', perYear: 1.5 } }, 'usageLimit');
                await bad({ kind: 'PERCENT', percentBp: 0 }, 'percentBp');
                await bad({ kind: 'PERCENT', percentBp: 10_001 }, 'percentBp');
                await bad({ kind: 'PERCENT', percentBp: 500 }, 'fixedAmountVnd');
                await bad({ fixedAmountVnd: '0' }, 'fixedAmountVnd');
                await bad({ fixedAmountVnd: '12.5' }, 'fixedAmountVnd');
                await bad({ fixedAmountVnd: null }, 'fixedAmountVnd');
                await bad({ percentBp: 500 }, 'percentBp');
                await bad({ minSpendVnd: '-1' }, 'minSpendVnd');
                await bad({ windowDaysBefore: -1 }, 'windowDaysBefore');
                await bad({ windowDaysBefore: 300, windowDaysAfter: 100 }, 'windowDaysAfter');
                await bad({ combineMember: undefined as never }, 'combineMember');
                await bad({ isActive: 'yes' as never }, 'isActive');
                await bad({ expectedVersionNo: 0 }, 'expectedVersionNo');
                assert.equal(await tx.birthdayRewardVersion.count(), 0, 'nothing was saved');
              },
            );

            await suite.test(
              'save: versions append (edit, deactivate), a stale edit conflicts, the same values add nothing',
              async () => {
                const first = await save();
                assert.equal(first.configured, true);
                assert.equal(first.current?.versionNo, 1);
                assert.deepEqual(first.current?.usageLimit, { mode: 'PER_YEAR', perYear: 1 });
                assert.equal(first.current?.fixedAmountVnd, '50000');
                // The same values again: no second version.
                const again = await ok(() =>
                  loyalty.saveBirthdayReward(ownerToken, body({ expectedVersionNo: 1 })),
                );
                assert.equal(again.versions.length, 1);
                // An edit is version 2 and keeps version 1.
                const edited = await save({
                  fixedAmountVnd: '70000',
                  usageLimit: { mode: 'UNLIMITED' },
                });
                assert.equal(edited.current?.versionNo, 2);
                assert.deepEqual(edited.current?.usageLimit, { mode: 'UNLIMITED' });
                assert.equal(edited.versions[1]?.fixedAmountVnd, '50000');
                // Editing from a stale version conflicts and writes nothing.
                await fails(
                  () =>
                    loyalty.saveBirthdayReward(
                      ownerToken,
                      body({ expectedVersionNo: 1, fixedAmountVnd: '80000' }),
                    ),
                  'CONFLICT',
                );
                assert.equal(await tx.birthdayRewardVersion.count(), 2);
                // Deactivation is a version too; every save is audited with before and after.
                const off = await save({
                  isActive: false,
                  fixedAmountVnd: '70000',
                  usageLimit: { mode: 'UNLIMITED' },
                });
                assert.equal(off.current?.isActive, false);
                const audits = await tx.auditEvent.findMany({
                  where: { action: 'BIRTHDAY_REWARD_SAVED', actorUserId: ownerRow.id },
                });
                assert.equal(audits.length, 3);
                // History is permanent and there is exactly one configuration.
                const config = await tx.birthdayRewardConfig.findFirstOrThrow();
                const row = await tx.birthdayRewardVersion.findFirstOrThrow({
                  where: { versionNo: 1 },
                });
                await sqlRejects(
                  () =>
                    tx.$executeRaw`UPDATE birthday_reward_versions SET is_active = false WHERE id = ${row.id}::uuid`,
                  /permanent|append|cannot/i,
                );
                await sqlRejects(
                  () =>
                    tx.$executeRaw`DELETE FROM birthday_reward_versions WHERE id = ${row.id}::uuid`,
                  /permanent|append|cannot|delete/i,
                );
                await sqlRejects(
                  () => tx.birthdayRewardConfig.create({ data: { createdByUserId: ownerRow.id } }),
                  /singleton|duplicate|unique/i,
                );
                await sqlRejects(
                  () =>
                    tx.birthdayRewardVersion.create({
                      data: {
                        configId: config.id,
                        versionNo: 9,
                        isActive: true,
                        kind: 'FIXED_AMOUNT',
                        fixedAmountVnd: 1n,
                        minSpendVnd: 0n,
                        windowDaysBefore: 0,
                        windowDaysAfter: 0,
                        combineMember: false,
                        combinePromotion: false,
                        combineVoucher: false,
                        usageLimitUnlimited: true,
                        createdByUserId: ownerRow.id,
                      },
                    }),
                  /next version number/,
                );
              },
            );

            // ====================================================================== OFF: the gift does nothing
            await suite.test(
              'go-live OFF: an active configuration still gives nothing',
              async () => {
                await save({
                  isActive: true,
                  fixedAmountVnd: '50000',
                  usageLimit: { mode: 'PER_YEAR', perYear: 1 },
                });
                const early = await customer('early');
                const invoice = await finalized(early);
                assert.equal(invoice.discount.birthday, null);
                assert.equal(invoice.discountTotalVnd, '0');
                assert.equal(
                  await tx.invoiceLoyaltySnapshot.count({ where: { invoiceId: invoice.id } }),
                  0,
                );
                assert.equal(await redemptionOf(invoice.id), null);
                assert.equal(invoice.calculationVersion, 2);
                await ok(() => loyalty.activate(ownerToken));
                assert.equal((await read()).loyaltyLive, true);
              },
            );

            // ====================================================================== the gift (go-live ON)
            const gifts = { fixed: '50000' };
            await suite.test(
              'the gift stands alone on an invoice with no other offer; points follow the total AFTER the gift, never doubled',
              async () => {
                await save({ fixedAmountVnd: gifts.fixed });
                const ann = await customer('ann');
                const draft = await draftOf(ann);
                // A DRAFT previews the gift (non-binding).
                assert.equal(draft.discount.preview, true);
                assert.equal(draft.discount.birthday?.applied, true);
                assert.equal(draft.discountTotalVnd, '50000');
                const invoice = await finalize(draft);
                assert.equal(invoice.discount.winnerSource, 'BIRTHDAY');
                assert.equal(invoice.discount.birthday?.mode, 'ALONE');
                assert.equal(invoice.discount.birthday?.amountVnd, '50000');
                assert.equal(invoice.discount.birthday?.baseVnd, '200000');
                assert.equal(invoice.discount.birthday?.birthdayOn, today);
                assert.equal(invoice.discountTotalVnd, '50000');
                assert.equal(invoice.totalVnd, '150000');
                const snapshot = await snapshotOf(invoice.id);
                assert.equal(snapshot.winnerSource, 'BIRTHDAY');
                assert.equal(snapshot.birthdayAmountVnd, 50_000n);
                assert.equal(snapshot.birthdayBaseVnd, 200_000n);
                assert.equal(snapshot.birthdayConfigVersion, current?.current?.versionNo);
                const redemption = await redemptionOf(invoice.id);
                assert.equal(redemption?.amountVnd, 50_000n);
                assert.equal(redemption?.payerUserId, ann.id);
                assert.equal(redemption?.release, null);
                // The payer earns on what was paid: floor(150,000 / 1000) = 150, no birthday multiplier.
                await pay(invoice);
                await consume(invoice.id);
                assert.equal(await balanceOf(ann.id), 150);
                const earned = await tx.loyaltyLedgerEntry.findMany({ where: { userId: ann.id } });
                assert.deepEqual(
                  earned.map((entry) => [entry.kind, entry.points]),
                  [['EARN', 150]],
                );
              },
            );

            await suite.test(
              'no gift: outside the window, no birthday on a guest invoice, an inactive version',
              async () => {
                await save({ windowDaysBefore: 3, windowDaysAfter: 3 });
                const late = await customer('late', -4); // birthday was 4 days ago
                const soon = await customer('soon', 4); // birthday in 4 days
                const edge = await customer('edge', -3); // last day of the window
                for (const person of [late, soon]) {
                  const invoice = await finalized(person);
                  assert.equal(
                    invoice.discount.birthday,
                    null,
                    'outside the window: nothing shown',
                  );
                  assert.equal(invoice.discountTotalVnd, '0');
                  assert.equal(await redemptionOf(invoice.id), null);
                }
                const lastDay = await finalized(edge);
                assert.equal(lastDay.discount.birthday?.applied, true, 'the window is inclusive');
                // A guest payer has no birthday.
                const guest = await finalized(null);
                assert.equal(guest.discount.birthday, null);
                assert.equal(guest.discountTotalVnd, '0');
                // An inactive current version gives nothing.
                await save({ windowDaysBefore: 3, windowDaysAfter: 3, isActive: false });
                const idle = await finalized(await customer('idle'));
                assert.equal(idle.discount.birthday, null);
                await save({ windowDaysBefore: 7, windowDaysAfter: 7, isActive: true });
              },
            );

            await suite.test(
              'minimum spend is tested before any benefit; a gift larger than the total is capped and pays nothing',
              async () => {
                await save({ minSpendVnd: '300000' });
                const small = await customer('small');
                const below = await finalized(small);
                assert.equal(below.discount.birthday?.applied, false);
                assert.equal(below.discount.birthday?.reason, 'BELOW_MIN_SPEND');
                assert.equal(below.discountTotalVnd, '0');
                assert.equal(await redemptionOf(below.id), null);
                assert.equal(
                  (await snapshotOf(below.id)).birthdayConfigVersion,
                  current?.current?.versionNo,
                  'the version consulted is recorded even when nothing applied',
                );
                // A fixed gift above the invoice is capped by the base: the total is 0 (zero-balance, OP-2).
                await save({ minSpendVnd: '0', fixedAmountVnd: '500000' });
                const generous = await finalized(await customer('generous'));
                assert.equal(generous.discount.birthday?.amountVnd, '200000');
                assert.equal(generous.totalVnd, '0');
                assert.equal(generous.status, 'PAID');
                assert.equal((await redemptionOf(generous.id))?.amountVnd, 200_000n);
                await save({ fixedAmountVnd: gifts.fixed });
              },
            );

            await suite.test(
              'usage limit: 1 per customer per birthday year; a cancelled invoice gives the use back; unlimited is explicit',
              async () => {
                await save({ usageLimit: { mode: 'PER_YEAR', perYear: 1 } });
                const dora = await customer('dora');
                const first = await finalized(dora);
                assert.equal(first.discount.birthday?.applied, true);
                const second = await finalized(dora);
                assert.equal(second.discount.birthday?.applied, false);
                assert.equal(second.discount.birthday?.reason, 'USAGE_LIMIT_REACHED');
                assert.equal(second.discountTotalVnd, '0');
                // Another customer is unaffected.
                assert.equal(
                  (await finalized(await customer('eli'))).discount.birthday?.applied,
                  true,
                );
                // Cancelling the first invoice releases its use (append-only); the third invoice gets the gift.
                const cancelled = await cancel(first);
                const released = await redemptionOf(first.id);
                assert.ok(released?.release, 'a release row was appended');
                assert.equal(released.release.cause, 'INVOICE_CANCELLED_UNPAID');
                assert.equal(cancelled.status, 'CANCELLED');
                const third = await finalized(dora);
                assert.equal(third.discount.birthday?.applied, true);
                // Two per year: the second applies, the third does not.
                await save({ usageLimit: { mode: 'PER_YEAR', perYear: 2 } });
                const fay = await customer('fay');
                assert.equal((await finalized(fay)).discount.birthday?.applied, true);
                assert.equal((await finalized(fay)).discount.birthday?.applied, true);
                assert.equal(
                  (await finalized(fay)).discount.birthday?.reason,
                  'USAGE_LIMIT_REACHED',
                );
                // Unlimited is an explicit choice.
                await save({ usageLimit: { mode: 'UNLIMITED' } });
                for (let i = 0; i < 3; i += 1) {
                  assert.equal((await finalized(fay)).discount.birthday?.applied, true);
                }
                await save({ usageLimit: { mode: 'PER_YEAR', perYear: 1 } });
              },
            );

            await suite.test(
              'with the member discount: combinable adds on the remaining amount; not combinable the larger one wins',
              async () => {
                const gina = await customer('gina');
                await giveTier(gina, 600); // Silver 3% of 200,000 = 6,000
                await save({ combineMember: true, usageLimit: { mode: 'UNLIMITED' } });
                const stacked = await finalized(gina);
                assert.equal(stacked.discount.winnerSource, 'MEMBER_TIER');
                assert.equal(stacked.discount.birthday?.mode, 'STACKED');
                assert.equal(stacked.discount.birthday?.baseVnd, '194000');
                assert.equal(stacked.discountTotalVnd, '56000');
                assert.equal(stacked.totalVnd, '144000');
                const stackedSnapshot = await snapshotOf(stacked.id);
                assert.equal(stackedSnapshot.memberAmountVnd, 6_000n);
                assert.equal(stackedSnapshot.birthdayAmountVnd, 50_000n);
                assert.equal(stackedSnapshot.birthdayBaseVnd, 194_000n);
                // A percentage gift is calculated on what is left after the best offer: 10% of 194,000 = 19,400.
                await save({
                  combineMember: true,
                  kind: 'PERCENT',
                  percentBp: 1000,
                  fixedAmountVnd: null,
                  usageLimit: { mode: 'UNLIMITED' },
                });
                const percent = await finalized(gina);
                assert.equal(percent.discount.birthday?.amountVnd, '19400');
                assert.equal(percent.totalVnd, '174600');
                // Not combinable: 50,000 is larger than the 6,000 member discount, so the gift replaces it.
                await save({
                  combineMember: false,
                  kind: 'FIXED_AMOUNT',
                  percentBp: null,
                  fixedAmountVnd: '50000',
                  usageLimit: { mode: 'UNLIMITED' },
                });
                const replaced = await finalized(gina);
                assert.equal(replaced.discount.birthday?.mode, 'REPLACES_OFFER');
                assert.equal(replaced.discount.winnerSource, 'BIRTHDAY');
                assert.equal(replaced.discount.selectionReason, 'BIRTHDAY_BEATS_OFFER');
                assert.equal(replaced.totalVnd, '150000');
                const replacedSnapshot = await snapshotOf(replaced.id);
                assert.equal(
                  replacedSnapshot.memberAmountVnd,
                  0n,
                  'the member discount was not used',
                );
                assert.equal(replacedSnapshot.winnerSource, 'BIRTHDAY');
                // Not combinable and the gift is SMALLER: the member discount stays, nothing is used up.
                await save({
                  fixedAmountVnd: '5000',
                  usageLimit: { mode: 'UNLIMITED' },
                });
                const kept = await finalized(gina);
                assert.equal(kept.discount.birthday?.applied, false);
                assert.equal(kept.discount.birthday?.reason, 'OFFER_IS_BETTER');
                assert.equal(kept.discount.winnerSource, 'MEMBER_TIER');
                assert.equal(kept.discountTotalVnd, '6000');
                assert.equal(
                  await redemptionOf(kept.id),
                  null,
                  'a gift that lost is not recorded as used',
                );
                // Equal amounts keep the member discount too.
                await save({ fixedAmountVnd: '6000', usageLimit: { mode: 'UNLIMITED' } });
                const tie = await finalized(gina);
                assert.equal(tie.discount.birthday?.reason, 'OFFER_IS_BETTER');
                assert.equal(tie.discountTotalVnd, '6000');
                await save({
                  fixedAmountVnd: gifts.fixed,
                  usageLimit: { mode: 'PER_YEAR', perYear: 1 },
                });
              },
            );

            await suite.test(
              'a finalized invoice is never recalculated: later configuration changes, a changed birthday or a new balance leave it as it was',
              async () => {
                await save({ usageLimit: { mode: 'UNLIMITED' } });
                const hal = await customer('hal');
                const invoice = await finalized(hal);
                const stored = await ok(() => invoices.get(cashier.token, invoice.id));
                assert.equal(
                  stored.discount.birthday?.versionNo,
                  invoice.discount.birthday?.versionNo,
                );
                await save({ fixedAmountVnd: '90000', usageLimit: { mode: 'UNLIMITED' } });
                await tx.customerProfile.update({
                  where: { userId: hal.id },
                  data: { dateOfBirth: new Date('1990-06-15') },
                });
                await giveTier(hal, 600);
                const after = await ok(() => invoices.get(cashier.token, invoice.id));
                assert.equal(after.discountTotalVnd, '50000');
                assert.equal(after.totalVnd, '150000');
                assert.equal(after.discount.birthday?.amountVnd, '50000');
                assert.equal(
                  after.discount.birthday?.versionNo,
                  invoice.discount.birthday?.versionNo,
                );
                assert.equal(after.discount.winnerSource, 'BIRTHDAY');
                // Paying it later still pays the frozen amount and earns on it.
                await pay(after);
                await consume(after.id);
                assert.equal(await balanceOf(hal.id), 600 + 150);
                await save({
                  fixedAmountVnd: gifts.fixed,
                  usageLimit: { mode: 'PER_YEAR', perYear: 1 },
                });
              },
            );

            await suite.test(
              'database guards: a redemption must match its invoice, version, window and limit',
              async () => {
                const ivy = await customer('ivy');
                const invoice = await finalized(ivy);
                const redemption = await tx.birthdayRedemption.findUniqueOrThrow({
                  where: { invoiceId: invoice.id },
                });
                // History is append-only.
                await sqlRejects(
                  () =>
                    tx.$executeRaw`UPDATE birthday_redemptions SET amount_vnd = 1 WHERE id = ${redemption.id}::uuid`,
                  /permanent|append|cannot/i,
                );
                // A release needs a CANCELLED invoice.
                await sqlRejects(
                  () =>
                    tx.birthdayRedemptionRelease.create({
                      data: {
                        redemptionId: redemption.id,
                        releasedByUserId: ownerRow.id,
                        cause: 'INVOICE_CANCELLED_UNPAID',
                        reason: 'x',
                      },
                    }),
                  /only when its invoice is cancelled/,
                );
                // A forged second redemption: wrong amount, outside the window, over the limit, other payer.
                const version = await tx.birthdayRewardVersion.findFirstOrThrow({
                  orderBy: { versionNo: 'desc' },
                });
                const jan = await customer('jan', 30);
                const forged = async (invoiceId: string, over: Record<string, unknown>) =>
                  tx.birthdayRedemption.create({
                    data: {
                      invoiceId,
                      configId: version.configId,
                      versionId: version.id,
                      payerUserId: ivy.id,
                      birthdayOn: new Date(`${today}T00:00:00.000Z`),
                      amountVnd: 50_000n,
                      ...over,
                    } as Prisma.BirthdayRedemptionUncheckedCreateInput,
                  });
                const other = await draftOf(ivy);
                await sqlRejects(() => forged(other.id, {}), /exactly the gift|snapshot/);
                await sqlRejects(
                  () => forged(invoice.id, { payerUserId: jan.id }),
                  /duplicate|unique|payer/i,
                );
                // The loyalty consumer, a payment and a go-live check are unaffected by all of the above.
                await settle();
              },
            );

            await suite.test(
              'the SQL occurrence function and its TypeScript twin agree (29 February, New Year, window edges)',
              async () => {
                const births = [
                  '2000-02-29',
                  '1999-12-31',
                  '2001-01-01',
                  '1990-03-10',
                  '2004-02-28',
                  '2000-12-30',
                ];
                const days: string[] = [];
                for (const year of [2026, 2027, 2028, 2100]) {
                  for (const month of ['01', '02', '03', '12']) {
                    for (const day of ['01', '02', '10', '27', '28', '29', '30', '31']) {
                      if (month === '02' && Number(day) > 29) continue;
                      if (
                        month === '02' &&
                        day === '29' &&
                        !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))
                      )
                        continue;
                      days.push(`${year}-${month}-${day}`);
                    }
                  }
                }
                let compared = 0;
                for (const dob of births) {
                  for (const on of days) {
                    for (const [before, after] of [
                      [0, 0],
                      [7, 7],
                      [30, 0],
                      [0, 45],
                      [182, 182],
                    ] as const) {
                      const [row] = await tx.$queryRaw<{ occurrence: string | null }[]>`
                        SELECT lucy_birthday_occurrence(${dob}::date, ${on}::date, ${before}::integer, ${after}::integer)::text AS occurrence`;
                      assert.equal(
                        birthdayOccurrence(dob, on, before, after),
                        row!.occurrence,
                        `${dob} on ${on} (-${before}/+${after})`,
                      );
                      compared += 1;
                    }
                  }
                }
                assert.ok(compared > 3000);
              },
            );

            throw rollback;
          },
          { timeout: 600_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
