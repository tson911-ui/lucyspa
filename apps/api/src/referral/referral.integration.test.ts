import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InvoiceResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  createPayosSimulator,
  LOYALTY_EVENT_TYPES,
  parseApiEnvironment,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { normalizePhone } from '../auth/identity.js';
import { SessionService } from '../auth/session.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ReferralService } from './referral.service.js';

/**
 * Phase 5 P5-5: referral against real PostgreSQL (design 7 and the Owner decisions of 2026-10-04 in 2.5). Staff bind, pay and
 * cancel through the real services; the `loyalty` consumer awards on the real INVOICE_PAID events. Every fixture rolls back with
 * the outer transaction. The Owner is the database's own, or a rolled-back fixture.
 */
test(
  'Phase 5 P5-5 referral; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-5 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `referral_${++savepoint}`;
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
            const referrals = new ReferralService(
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
                await assert.rejects(work, pattern);
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
              | 'CORRECT_PAYMENTS'
              | 'VIEW_LOYALTY'
              | 'MANAGE_REFERRALS';
            const category = await tx.serviceCategory.create({
              data: { code: `P55_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const makeService = (key: string, price: [bigint, bigint]) =>
              tx.service.create({
                data: {
                  code: `P55_${key}_${run}`,
                  categoryId: category.id,
                  nameVi: `Dịch vụ ${key}`,
                  nameEn: `Service ${key}`,
                  priceVnd: price[0],
                  priceMaxVnd: price[1],
                  pricingUnit: 'PER_SERVICE',
                  maxQuantity: 1,
                  durationMinutes: 10,
                  estimatedMinMinutes: 10,
                  estimatedMaxMinutes: 10,
                },
              });
            const exact = await makeService('EXACT', [200_000n, 200_000n]);
            const free = await makeService('FREE', [0n, 50_000n]);
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
            const customer = async (label: string, phone = phoneOf()) => {
              n++;
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `p55-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p55-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: phone,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
            };
            /** The national form a person types (0912…), the same number as the canonical +84912…. */
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
                  emailCanonical: `p55-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p55-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);
            const ownerStaleToken = await login(ownerRow, false);

            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P55_${name}_${run}`,
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
                      employeeCodeCanonical: `P55_${run}_${n}`,
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
              return {
                id: user.id,
                token: await login(user),
                staleToken: await login(user, false),
              };
            };
            const makeBranch = (label: string) =>
              tx.branch.create({
                data: {
                  code: `P55_${label}_${run}`,
                  name: `Referral ${label}`,
                  timezone: 'Asia/Ho_Chi_Minh',
                },
              });
            const branch = await makeBranch('MAIN');
            const otherBranch = await makeBranch('OTHER');
            const roles = {
              prepare: await makeRole('PREPARE', ['VIEW_INVOICES', 'MANAGE_INVOICES']),
              collect: await makeRole('COLLECT', ['COLLECT_PAYMENTS']),
              correct: await makeRole('CORRECT', ['CORRECT_PAYMENTS', 'VIEW_INVOICES']),
              cancel: await makeRole('CANCEL', ['CANCEL_INVOICES', 'VIEW_INVOICES']),
              view: await makeRole('VIEW', ['VIEW_LOYALTY']),
              bind: await makeRole('BIND', ['MANAGE_REFERRALS', 'VIEW_LOYALTY']),
            };
            const cashier = await staffUser(branch.id, roles.prepare.id);
            const collector = await staffUser(branch.id, roles.collect.id);
            const corrector = await staffUser(branch.id, roles.correct.id);
            const canceller = await staffUser(branch.id, roles.cancel.id);
            const viewer = await staffUser(branch.id, roles.view.id);
            const binder = await staffUser(branch.id, roles.bind.id);
            const otherBinder = await staffUser(otherBranch.id, roles.bind.id);
            const ktv = await staffUser(branch.id, null);

            // ------------------------------------------------------------------------ visit and invoice helpers
            let slot = 0;
            let clock = 0;
            const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
            type Recipient = { member: { id: string } } | { guestPhone: string | null };
            const completedVisit = async (
              service: Service,
              recipient: Recipient,
              owner: { id: string } | null = null,
            ) => {
              n++;
              const visit = await tx.visit.create({
                data: {
                  code: `VS-P55-${run}-${n}`,
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
                    : {
                        visitId: visit.id,
                        kind: 'GUEST',
                        displayName: 'Khách lẻ',
                        phone: recipient.guestPhone,
                      },
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
              // Strictly increasing completion times: "first completed visit" has a defined order.
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
            const pricedDraft = async (
              service: Service,
              recipient: Recipient,
              owner: { id: string } | null = null,
            ) => {
              const visitId = await completedVisit(service, recipient, owner);
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
            const finalized = async (
              service: Service,
              recipient: Recipient,
              owner: { id: string } | null = null,
            ) => {
              const draft = await pricedDraft(service, recipient, owner);
              return (await ok(() =>
                invoices.finalize(cashier.token, draft.id, { expectedVersion: draft.version }),
              )) as InvoiceResponse;
            };
            const pay = (invoiceId: string, amount: number) =>
              ok(() =>
                invoices.recordPayment(collector.token, invoiceId, {
                  method: 'CASH',
                  amountVnd: String(amount),
                  tenderedVnd: String(amount),
                  idempotencyKey: randomUUID(),
                }),
              );

            // ------------------------------------------------------------------------ consumer helpers
            const eventsOf = (invoiceId: string) =>
              tx.outboxEvent.findMany({
                where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
            const consume = async (invoiceId: string) => {
              const results: string[] = [];
              for (const event of await eventsOf(invoiceId)) {
                const outcome = await processLoyaltyEvent(tx, event.id);
                await settle();
                if (outcome !== 'NOT_CLAIMED') results.push(outcome);
              }
              return results;
            };
            const balanceOf = async (userId: string, wallet: 'SPA' | 'BEAUTY' = 'SPA') =>
              (
                await tx.loyaltyWalletAccount.findUnique({
                  where: { userId_wallet: { userId, wallet } },
                })
              )?.balancePoints ?? null;
            const awardsOf = (userId: string) =>
              tx.loyaltyLedgerEntry.findMany({
                where: { userId, kind: 'REFERRAL_AWARD' },
                orderBy: [{ wallet: 'asc' }],
              });
            const referralOf = (referredUserId: string) =>
              tx.referral.findUniqueOrThrow({ where: { referredUserId } });
            const bind = (token: string, referred: { id: string }, referrerPhone: string) =>
              ok(() => referrals.bind(token, branch.id, referred.id, { referrerPhone }));
            const goLive = async () => {
              await ok(() => loyalty.activate(ownerToken));
            };

            const alice = await customer('alice');
            const bob = await customer('bob');
            const carol = await customer('carol');
            const dan = await customer('dan');
            const eve = await customer('eve');

            // ====================================================================== binding works while go-live is OFF
            await suite.test(
              'counter binding: permission and branch, exact masked lookup, rules, replay (go-live still OFF)',
              async () => {
                assert.equal(await tx.loyaltyGoLive.count(), 0);
                // Permission: MANAGE_REFERRALS at the branch only (VIEW_LOYALTY alone, another branch, no role: refused).
                await fails(
                  () => referrals.lookup(viewer.token, branch.id, { phone: typed(alice) }),
                  'FORBIDDEN',
                );
                await fails(
                  () => referrals.lookup(otherBinder.token, branch.id, { phone: typed(alice) }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    referrals.bind(viewer.token, branch.id, dan.id, {
                      referrerPhone: typed(alice),
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    referrals.bind(otherBinder.token, branch.id, dan.id, {
                      referrerPhone: typed(alice),
                    }),
                  'FORBIDDEN',
                );
                // Lookup: exact phone, masked, no listing; unknown phone finds nobody; garbage is a field error.
                const found = await referrals.lookup(binder.token, branch.id, {
                  phone: typed(alice),
                });
                assert.equal(found.members.length, 1);
                assert.equal(found.members[0]!.id, alice.id);
                assert.ok(found.members[0]!.phoneMasked?.includes('•'));
                assert.ok(!JSON.stringify(found).includes(alice.phoneCanonical!));
                assert.deepEqual(
                  (await referrals.lookup(binder.token, branch.id, { phone: '0900000000' }))
                    .members,
                  [],
                );
                await fails(
                  () => referrals.lookup(binder.token, branch.id, { phone: 'abc' }),
                  'VALIDATION_FAILED',
                  'phone',
                );
                // Rules: no self-referral, a member must exist, a malformed phone is refused.
                await fails(
                  () => bind(binder.token, dan, typed(dan)),
                  'REFERRAL_SELF',
                  'referrerPhone',
                );
                await fails(
                  () => bind(binder.token, dan, '0900000000'),
                  'NOT_FOUND',
                  'referrerPhone',
                );
                await fails(
                  () => bind(binder.token, dan, 'xyz'),
                  'VALIDATION_FAILED',
                  'referrerPhone',
                );
                // Bound while OFF: the Owner's go-live decision only relaxes binding, never the reward.
                const first = await bind(binder.token, dan, typed(alice));
                assert.equal(first.replayed, false);
                assert.equal(first.referral.referrer.id, alice.id);
                assert.equal(first.referral.boundVia, 'COUNTER');
                assert.equal(first.referral.awarded, null);
                const row = await referralOf(dan.id);
                assert.equal(row.boundByUserId, binder.id);
                // Replay of the same referrer returns the stored binding; another referrer is refused.
                const replay = await bind(binder.token, dan, `+84${typed(alice).slice(1)}`);
                assert.equal(replay.replayed, true);
                assert.equal(await tx.referral.count({ where: { referredUserId: dan.id } }), 1);
                await fails(() => bind(binder.token, dan, typed(bob)), 'REFERRAL_ALREADY_BOUND');
                // Audited with ids, never a phone number; an outbox fact exists.
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REFERRAL_BOUND', entityId: row.id },
                });
                assert.equal(audit.actorUserId, binder.id);
                assert.equal(audit.subjectUserId, dan.id);
                assert.ok(!JSON.stringify(audit).includes('+84'));
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { eventType: 'REFERRAL_BOUND', aggregateId: row.id },
                  }),
                  1,
                );
                // Mutual referral is allowed (Owner decision, OQ-6): alice refers dan and dan refers alice.
                const mutual = await bind(binder.token, alice, typed(dan));
                assert.equal(mutual.referral.referrer.id, dan.id);
                // Bob is referred by carol (used by the award tests below). A customer account is always ACTIVE in this data model
                // (users_kind_credentials), and no code path looks at the referrer's status, so a locked referrer is still credited (OQ-6).
                const second = await bind(binder.token, bob, typed(carol));
                assert.equal(second.referral.referrer.id, carol.id);
              },
            );

            await suite.test(
              'while OFF: a referral is stored, and a first visit paid before go-live never rewards',
              async () => {
                // eve is bound while OFF and then pays her first visit while OFF: that visit is before go-live.
                await bind(binder.token, eve, typed(alice));
                const invoice = await finalized(exact, { member: eve }, eve);
                await pay(invoice.id, 200_000);
                // Go-live is switched on; only then does the consumer see the old event.
                await goLive();
                assert.deepEqual(await consume(invoice.id), ['SKIPPED_PRE_GO_LIVE']);
                assert.equal((await referralOf(eve.id)).awardedAt, null);
                assert.equal(await balanceOf(alice.id), null);
                // Her next visit is paid after go-live, but it is no longer her first visit: no reward, ever.
                const second = await finalized(exact, { member: eve });
                await pay(second.id, 200_000);
                assert.deepEqual(await consume(second.id), ['SKIPPED_GUEST']);
                assert.equal((await referralOf(eve.id)).awardedAt, null);
                assert.equal(await balanceOf(alice.id), null);
              },
            );

            // ====================================================================== the award
            await suite.test(
              'award: +10 Spa and +10 Beauty to the referrer, once, when the first visit is paid with real money (anyone may pay)',
              async () => {
                // dan was bound while OFF (stored) and his first visit is paid after go-live by a guest payer.
                const invoice = await finalized(exact, { member: dan }, null);
                assert.equal(invoice.payer, null, 'a guest pays');
                const paid = await pay(invoice.id, 200_000);
                // The guest payer earns nothing, yet the referral is rewarded: one outcome says something was applied.
                assert.deepEqual(await consume(invoice.id), ['APPLIED']);
                assert.equal(await balanceOf(alice.id, 'SPA'), 10);
                assert.equal(await balanceOf(alice.id, 'BEAUTY'), 10);
                const awards = await awardsOf(alice.id);
                assert.deepEqual(awards.map((entry) => [entry.wallet, entry.points]).sort(), [
                  ['BEAUTY', 10],
                  ['SPA', 10],
                ]);
                const row = await referralOf(dan.id);
                for (const entry of awards) {
                  assert.equal(entry.referralId, row.id);
                  assert.equal(entry.invoiceId, null);
                  assert.equal(entry.idempotencyKey, `REFERRAL_AWARD:${row.id}:${entry.wallet}`);
                }
                assert.equal(row.awardedInvoiceId, invoice.id);
                assert.equal(row.awardedPaidSeq, 1);
                assert.ok(row.awardedAt);
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REFERRAL_AWARDED', entityId: row.id },
                });
                assert.equal(audit.subjectUserId, alice.id);
                assert.equal(
                  (await tx.outboxEvent.count({
                    where: { eventType: 'REFERRAL_AWARDED', aggregateType: 'LoyaltyLedgerEntry' },
                  })) >= 2,
                  true,
                );
                // Replay: the consumer never runs twice; the keys and the single stamp make a second award impossible.
                assert.deepEqual(await consume(invoice.id), []);
                // A refund/reversal and a re-pay never take the reward back and never grant it twice.
                await ok(() =>
                  invoices.reversePayment(corrector.token, invoice.id, paid.payment.id, {
                    reason: 'Nhập nhầm',
                  }),
                );
                await pay(invoice.id, 200_000);
                assert.deepEqual(await consume(invoice.id), ['NOOP', 'SKIPPED_GUEST']);
                assert.equal(await balanceOf(alice.id, 'SPA'), 10);
                assert.equal(await balanceOf(alice.id, 'BEAUTY'), 10);
                assert.equal((await awardsOf(alice.id)).length, 2);
                assert.equal((await referralOf(dan.id)).awardedInvoiceId, invoice.id);
                // The reward is the referrer's: the referred customer received nothing from it.
                assert.equal(await balanceOf(dan.id, 'BEAUTY'), null);
              },
            );

            await suite.test(
              'a first visit that is 0 VND (zero balance) does not reward, and the next visit never does either (Owner, OQ-4)',
              async () => {
                const frank = await customer('frank');
                await bind(binder.token, frank, typed(alice));
                const zero = await finalized(free, { member: frank });
                // The free service needs a price of 0 to make a zero-balance invoice.
                assert.equal(zero.status, 'PAID');
                assert.equal(zero.totalVnd, '0');
                const before = await balanceOf(alice.id, 'SPA');
                assert.deepEqual(await consume(zero.id), ['SKIPPED_GUEST']);
                assert.equal((await referralOf(frank.id)).awardedAt, null);
                // frank's second visit is paid with real money, but his FIRST completed visit was the free one.
                const second = await finalized(exact, { member: frank });
                await pay(second.id, 200_000);
                assert.deepEqual(await consume(second.id), ['SKIPPED_GUEST']);
                assert.equal((await referralOf(frank.id)).awardedAt, null);
                assert.equal(await balanceOf(alice.id, 'SPA'), before);
              },
            );

            await suite.test(
              'a cancelled or never-paid first invoice means no reward (Owner, OQ-5)',
              async () => {
                const gail = await customer('gail');
                await bind(binder.token, gail, typed(alice));
                const first = await finalized(exact, { member: gail });
                await ok(() =>
                  invoices.cancel(canceller.token, first.id, {
                    expectedVersion: first.version,
                    reason: 'Khách bỏ về',
                  }),
                );
                assert.deepEqual(await consume(first.id), ['NOOP']);
                const before = await balanceOf(alice.id, 'SPA');
                const second = await finalized(exact, { member: gail });
                await pay(second.id, 200_000);
                assert.deepEqual(await consume(second.id), ['SKIPPED_GUEST']);
                assert.equal((await referralOf(gail.id)).awardedAt, null);
                assert.equal(await balanceOf(alice.id, 'SPA'), before);
              },
            );

            await suite.test(
              'brand-new: any completed visit counts, guest phones included, and the window closes at the first payment',
              async () => {
                const before = await balanceOf(alice.id, 'SPA');
                // A guest visit under the customer's phone (typed in another format) is HER visit (P5-Q4): paid, it closes the window.
                const hana = await customer('hana');
                const guestVisit = await finalized(exact, { guestPhone: typed(hana) });
                await pay(guestVisit.id, 200_000);
                await fails(() => bind(binder.token, hana, typed(alice)), 'REFERRAL_NOT_NEW');
                // A paid first visit closes the window.
                const ivy = await customer('ivy');
                const paidFirst = await finalized(exact, { member: ivy });
                await pay(paidFirst.id, 200_000);
                await fails(() => bind(binder.token, ivy, typed(alice)), 'REFERRAL_NOT_NEW');
                // Two completed visits: no longer new even if the second is unpaid.
                const jade = await customer('jade');
                await finalized(exact, { member: jade });
                await finalized(exact, { member: jade });
                await fails(() => bind(binder.token, jade, typed(alice)), 'REFERRAL_NOT_NEW');
                // The window: one completed visit whose invoice is still unpaid can still be bound at the counter...
                const kim = await customer('kim');
                const open = await finalized(exact, { member: kim });
                const late = await bind(binder.token, kim, typed(alice));
                assert.equal(late.replayed, false);
                // ...and the payment that follows rewards the referrer.
                await pay(open.id, 200_000);
                assert.deepEqual(await consume(open.id), ['APPLIED']);
                assert.equal(await balanceOf(alice.id, 'SPA'), (before ?? 0) + 10);
                // Never bound then paid first: nothing to reward.
                assert.deepEqual(await consume(paidFirst.id), ['SKIPPED_GUEST']);
              },
            );

            await suite.test(
              'brand-new (Owner decision): a booker who received no service is still new and can still get a referrer',
              async () => {
                const olga = await customer('olga');
                // olga only booked and paid for a friend's visit: she is the visit owner but not a recipient.
                const friendsVisit = await finalized(exact, { guestPhone: null }, olga);
                await pay(friendsVisit.id, 200_000);
                const spaBefore = await balanceOf(alice.id, 'SPA');
                const bound = await bind(binder.token, olga, typed(alice));
                assert.equal(bound.replayed, false);
                // The friend's visit did not close her window and does not reward: she received nothing.
                assert.equal((await referralOf(olga.id)).awardedAt, null);
                assert.equal(await balanceOf(alice.id, 'SPA'), spaBefore);
                // Her own first visit (she receives the service) is the one that rewards the referrer.
                const own = await finalized(exact, { member: olga });
                await pay(own.id, 200_000);
                assert.deepEqual(await consume(own.id), ['APPLIED']);
                assert.ok((await referralOf(olga.id)).awardedAt, 'olga received the service');
                assert.equal(await balanceOf(alice.id, 'SPA'), (spaBefore ?? 0) + 10);
              },
            );

            await suite.test(
              'who received the service: a participant found by phone, several referred customers on one invoice',
              async () => {
                const lena = await customer('lena');
                const mark = await customer('mark');
                const nora = await customer('nora');
                await bind(binder.token, lena, typed(bob));
                await bind(binder.token, mark, typed(carol));
                await bind(binder.token, nora, typed(alice));
                // lena is recorded as a GUEST who left her phone: she still received the service.
                const byPhone = await finalized(exact, { guestPhone: typed(lena) });
                await pay(byPhone.id, 200_000);
                const spaBefore = await balanceOf(bob.id, 'SPA');
                assert.deepEqual(await consume(byPhone.id), ['APPLIED']);
                assert.equal(await balanceOf(bob.id, 'SPA'), (spaBefore ?? 0) + 10);
                assert.equal(await balanceOf(bob.id, 'BEAUTY'), 10);
                // A visit owner who merely booked (a different participant received the service) is not rewarded.
                const owned = await finalized(exact, { member: mark }, nora);
                await pay(owned.id, 200_000);
                assert.deepEqual(await consume(owned.id), ['APPLIED']);
                assert.ok((await referralOf(mark.id)).awardedAt, 'mark received the service');
                assert.equal(
                  (await referralOf(nora.id)).awardedAt,
                  null,
                  'nora only booked and paid',
                );
              },
            );

            // ====================================================================== Owner correction
            await suite.test(
              'Owner correction: Owner only, fresh re-authentication, a reason, history, and locked after the reward',
              async () => {
                const pia = await customer('pia');
                const quinn = await customer('quinn');
                await bind(binder.token, pia, typed(alice));
                const change = (token: string, phone: string, reason = 'Khách nhập nhầm số') =>
                  ok(() => referrals.change(token, pia.id, { referrerPhone: phone, reason }));
                // Nobody else can: not the binder, not a manager with every referral permission.
                await fails(() => change(binder.token, typed(bob)), 'FORBIDDEN');
                await fails(() => change(viewer.token, typed(bob)), 'FORBIDDEN');
                // The Owner needs a fresh password confirmation, a valid phone, a reason and a real change.
                await fails(() => change(ownerStaleToken, typed(bob)), 'REAUTHENTICATION_REQUIRED');
                await fails(() => change(ownerToken, 'abc'), 'VALIDATION_FAILED', 'referrerPhone');
                await fails(() => change(ownerToken, typed(bob), '   '), 'VALIDATION_FAILED');
                await fails(() => change(ownerToken, '0900000000'), 'NOT_FOUND', 'referrerPhone');
                await fails(() => change(ownerToken, typed(pia)), 'REFERRAL_SELF', 'referrerPhone');
                await fails(() => change(ownerToken, typed(alice)), 'REFERRAL_SAME_REFERRER');
                await fails(
                  () =>
                    referrals.change(ownerToken, quinn.id, {
                      referrerPhone: typed(bob),
                      reason: 'x',
                    }),
                  'NOT_FOUND',
                );
                // The change: reason and history (old, new, actor, time), the referral row follows, audited and published.
                const changed = await change(ownerToken, typed(bob));
                assert.equal(changed.referral.referrer.id, bob.id);
                assert.equal(changed.referral.changes.length, 1);
                const [entry] = changed.referral.changes;
                assert.equal(entry!.oldReferrer.id, alice.id);
                assert.equal(entry!.newReferrer.id, bob.id);
                assert.equal(entry!.reason, 'Khách nhập nhầm số');
                assert.equal(entry!.actorName, ownerRow.fullName);
                assert.equal(
                  changed.referral.boundVia,
                  'COUNTER',
                  'the original binding facts stay',
                );
                const stored = await tx.referralChange.findMany({
                  where: { referral: { referredUserId: pia.id } },
                });
                assert.equal(stored.length, 1);
                assert.equal(stored[0]!.actorUserId, ownerRow.id);
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'REFERRAL_CHANGED', entityId: stored[0]!.referralId },
                });
                assert.equal(audit.actorUserId, ownerRow.id);
                assert.equal(audit.reason, 'Khách nhập nhầm số');
                assert.ok(!JSON.stringify(audit).includes('+84'));
                // A second correction is allowed before the reward and is another history row.
                await change(ownerToken, typed(carol), 'Sửa lần hai');
                assert.equal((await referralOf(pia.id)).referrerUserId, carol.id);
                // The award goes to the CURRENT referrer.
                const aliceBefore = await balanceOf(alice.id, 'SPA');
                const carolBefore = await balanceOf(carol.id, 'SPA');
                const invoice = await finalized(exact, { member: pia });
                await pay(invoice.id, 200_000);
                assert.deepEqual(await consume(invoice.id), ['APPLIED']);
                assert.equal(await balanceOf(carol.id, 'SPA'), (carolBefore ?? 0) + 10);
                assert.equal(await balanceOf(alice.id, 'SPA'), aliceBefore);
                // After the reward the referrer is locked forever: the command and the database both refuse.
                await fails(() => change(ownerToken, typed(bob), 'Quá muộn'), 'REFERRAL_LOCKED');
                const referral = await referralOf(pia.id);
                await sqlRejects(
                  () =>
                    tx.referral.update({
                      where: { id: referral.id },
                      data: { referrerUserId: bob.id },
                    }),
                  /locked once the reward has been granted/,
                );
                assert.equal(
                  await tx.referralChange.count({ where: { referralId: referral.id } }),
                  2,
                );
              },
            );

            // ====================================================================== reading
            await suite.test(
              'profile and list: referrer, status, history, totals; read follows VIEW_LOYALTY at the branch',
              async () => {
                const profile = await loyalty.profile(binder.token, branch.id, dan.id);
                assert.equal(profile.referral?.referrer.id, alice.id);
                assert.ok(profile.referral?.awarded);
                assert.equal(profile.referral?.awarded?.invoiceCode !== undefined, true);
                assert.equal(profile.can.bindReferrer, false, 'already has a referrer');
                assert.equal(profile.can.changeReferrer, false, 'the reward was granted');
                const fresh = await customer('fresh');
                const open = await loyalty.profile(binder.token, branch.id, fresh.id);
                assert.equal(open.referral, null);
                assert.equal(open.can.bindReferrer, true);
                assert.equal(open.can.changeReferrer, false);
                const viewOnly = await loyalty.profile(viewer.token, branch.id, fresh.id);
                assert.equal(viewOnly.can.bindReferrer, false, 'VIEW_LOYALTY alone cannot bind');
                const asReferrer = await loyalty.profile(binder.token, branch.id, alice.id);
                assert.ok(asReferrer.asReferrer.referred >= 3);
                assert.ok(asReferrer.asReferrer.rewarded >= 2);
                assert.doesNotMatch(JSON.stringify(profile), /\+84/, 'phones are masked');
                // The Owner sees the change action on an unawarded referral.
                const ron = await customer('ron');
                await bind(binder.token, ron, typed(alice));
                // (The Owner has no branch assignment here: the points profile is branch-scoped, so use the command's own flag.)
                assert.equal((await referrals.list(binder.token, branch.id, {})).can.change, false);
                // List: newest first, paged, filtered; forbidden without VIEW_LOYALTY.
                const all = await referrals.list(binder.token, branch.id, {});
                assert.ok(all.total >= 8);
                assert.equal(all.pageSize, 20);
                assert.ok(all.items.length <= 20);
                const times = all.items.map((item) => item.boundAt);
                assert.deepEqual([...times].sort().reverse(), times);
                const rewarded = await referrals.list(binder.token, branch.id, {
                  status: 'REWARDED',
                });
                assert.ok(
                  rewarded.items.length > 0 && rewarded.items.every((item) => item.awarded),
                );
                const pending = await referrals.list(binder.token, branch.id, {
                  status: 'PENDING',
                });
                assert.ok(pending.items.length > 0 && pending.items.every((item) => !item.awarded));
                assert.equal(rewarded.total + pending.total, all.total);
                const changedItem = all.items.find((item) => item.changed);
                assert.ok(changedItem, 'a corrected referral is marked');
                await fails(
                  () => referrals.list(binder.token, branch.id, { status: 'ALL' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => referrals.list(binder.token, branch.id, { page: '0' }),
                  'VALIDATION_FAILED',
                );
                await fails(() => referrals.list(otherBinder.token, branch.id, {}), 'FORBIDDEN');
                await fails(() => referrals.list(ownerToken, 'not-a-uuid', {}), 'NOT_FOUND');
                assert.equal((await referrals.list(ownerToken, branch.id, {})).can.change, true);
              },
            );

            // ====================================================================== canonical phone parity
            await suite.test(
              'the SQL canonical phone of a participant equals normalizePhone for every valid number',
              async () => {
                const samples = [
                  '0912345678',
                  '091 234 5678',
                  '(091) 234-5678',
                  '0084912345678',
                  '+84912345678',
                  '+84 912 345 678',
                  '0243 123 4567',
                  '+1 415 555 2671',
                  '+442071838750',
                ];
                for (const sample of samples) {
                  const expected = normalizePhone(sample).phoneCanonical;
                  const rows = await tx.$queryRaw<{ c: string | null }[]>`
                    SELECT lucy_phone_canonical(${sample}) AS c`;
                  assert.equal(rows[0]!.c, expected, sample);
                }
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
