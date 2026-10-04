import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InvoiceResponse } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type DatabaseClient,
  type Prisma,
} from '@lucy-spa/database';
import {
  appendLedgerEntry,
  createPayosSimulator,
  LOYALTY_EVENT_TYPES,
  parseApiEnvironment,
  processLoyaltyEvent,
  relayLoyaltyEvents,
} from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import { LoyaltyService } from './loyalty.service.js';

/**
 * Phase 5 P5-3: points and tiers against real PostgreSQL. Staff create, pay, reverse and cancel invoices
 * through the real services (which append the real outbox events); the `loyalty` consumer then runs on those
 * events, and the admin commands run through the real LoyaltyService. Every fixture rolls back with the outer
 * transaction. The Owner is the database's own, or a rolled-back fixture (the go-live switch is the Owner's alone).
 */
test(
  'Phase 5 P5-3 loyalty points and tiers; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-3 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `loyalty_${++savepoint}`;
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
            // Deferred integrity triggers fire at commit; fixtures never commit, so force them.
            const settle = async () => {
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            };
            const ok = async <T>(work: () => Promise<T>): Promise<T> => {
              const result = await work();
              await settle();
              return result;
            };
            const fails = async (work: () => Promise<unknown>, code: string) => {
              await assert.rejects(
                work,
                (error: unknown) => Reflect.get(Object(error), 'code') === code,
              );
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
              | 'ADJUST_LOYALTY_POINTS'
              | 'VIEW_LOYALTY_EXCEPTIONS';
            const category = await tx.serviceCategory.create({
              data: { code: `L53_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const makeService = (key: string, price: [bigint, bigint]) =>
              tx.service.create({
                data: {
                  code: `L53_${key}_${run}`,
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
            const odd = await makeService('ODD', [930_500n, 930_500n]);
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
            const customer = async (label: string) => {
              n++;
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `l53-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `l53-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
            };
            const alice = await customer('alice');
            const bob = await customer('bob');
            const carol = await customer('carol');
            // The database's own Owner, or a fixture Owner when it has none (CI starts empty); rolled back with the rest.
            const ownerRow =
              (await tx.user.findFirst({ where: { kind: 'OWNER' } })) ??
              (await tx.user.create({
                data: {
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Chủ spa fixture',
                  preferredLocale: 'vi',
                  emailCanonical: `l53-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `l53-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);
            const ownerStaleToken = await login(ownerRow, false);

            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `L53_${name}_${run}`,
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
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `L53_${run}_${n}`,
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
                  code: `L53_${label}_${run}`,
                  name: `Loyalty ${label}`,
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
              adjust: await makeRole('ADJUST', ['ADJUST_LOYALTY_POINTS', 'VIEW_LOYALTY']),
              exceptions: await makeRole('EXCEPTIONS', ['VIEW_LOYALTY_EXCEPTIONS']),
            };
            const cashier = await staffUser(branch.id, roles.prepare.id);
            const collector = await staffUser(branch.id, roles.collect.id);
            const corrector = await staffUser(branch.id, roles.correct.id);
            const canceller = await staffUser(branch.id, roles.cancel.id);
            const viewer = await staffUser(branch.id, roles.view.id);
            const adjuster = await staffUser(branch.id, roles.adjust.id, 'GLOBAL');
            const examiner = await staffUser(branch.id, roles.exceptions.id, 'GLOBAL');
            const ktv = await staffUser(branch.id, null);

            let slot = 0;
            const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
            const completedVisit = async (services: Service[], owner: { id: string } | null) => {
              n++;
              const visit = await tx.visit.create({
                data: {
                  code: `VS-L53-${run}-${n}`,
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
                data: { visitId: visit.id, kind: 'GUEST', displayName: 'Khách lẻ' },
              });
              const lineIds: string[] = [];
              for (const [index, service] of services.entries()) {
                const start = new Date(LOCAL_MIDNIGHT + (6 * 60 + 10 * slot++) * 60_000);
                const line = await tx.visitServiceLine.create({
                  data: {
                    visitId: visit.id,
                    participantId: participant.id,
                    sequence: index + 1,
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
                lineIds.push(line.id);
              }
              for (const [index, id] of lineIds.entries()) {
                const started = new Date('2027-03-01T06:00:00+07:00');
                await tx.visitServiceLine.update({
                  where: { id },
                  data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                });
                if (index === 0) {
                  await tx.visit.update({
                    where: { id: visit.id },
                    data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
                  });
                }
                const execution = await tx.serviceExecution.create({
                  data: {
                    visitServiceLineId: id,
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
                  where: { id },
                  data: { status: 'DONE', rowVersion: { increment: 1 } },
                });
              }
              await tx.visit.update({
                where: { id: visit.id },
                data: {
                  status: 'COMPLETED',
                  completedAt: new Date('2027-03-01T07:00:00+07:00'),
                  rowVersion: { increment: 1 },
                },
              });
              return visit.id;
            };
            const finalized = async (services: Service[], owner: { id: string } | null) => {
              const visitId = await completedVisit(services, owner);
              let current = (await ok(() => invoices.open(cashier.token, visitId))).invoice;
              for (const line of current.lines) {
                current = await ok(() =>
                  invoices.setPrice(cashier.token, current.id, line.id, {
                    expectedVersion: current.version,
                    unitPriceVnd: line.priceMinVnd,
                  }),
                );
              }
              return ok(() =>
                invoices.finalize(cashier.token, current.id, { expectedVersion: current.version }),
              ) as Promise<InvoiceResponse>;
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
            const reverse = (invoiceId: string, paymentId: string) =>
              ok(() =>
                invoices.reversePayment(corrector.token, invoiceId, paymentId, {
                  reason: 'Nhập nhầm',
                }),
              );

            // ----------------------------------------------------------------- consumer helpers
            const eventsOf = (invoiceId: string) =>
              tx.outboxEvent.findMany({
                where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
            const consumeEvent = async (id: string) => {
              const outcome = await processLoyaltyEvent(tx, id);
              await settle();
              return outcome;
            };
            /** Runs the consumer over every loyalty event of the invoice, oldest first. */
            const consume = async (invoiceId: string) => {
              const results: { eventType: string; paidSeq: unknown; outcome: string }[] = [];
              for (const event of await eventsOf(invoiceId)) {
                results.push({
                  eventType: event.eventType,
                  paidSeq: Reflect.get(Object(event.payload), 'paidSeq'),
                  outcome: await consumeEvent(event.id),
                });
              }
              return results;
            };
            const outcomes = (results: { outcome: string }[]) =>
              results
                .filter((entry) => entry.outcome !== 'NOT_CLAIMED')
                .map((entry) => entry.outcome);
            const balanceOf = async (userId: string, wallet: 'SPA' | 'BEAUTY' = 'SPA') =>
              (
                await tx.loyaltyWalletAccount.findUnique({
                  where: { userId_wallet: { userId, wallet } },
                })
              )?.balancePoints ?? null;
            const ledgerOf = (userId: string) =>
              tx.loyaltyLedgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
            const ledgerSum = async (userId: string, wallet: 'SPA' | 'BEAUTY' = 'SPA') =>
              (await ledgerOf(userId))
                .filter((entry) => entry.wallet === wallet)
                .reduce((sum, entry) => sum + entry.points, 0);

            let preGoLiveInvoiceId = '';
            // =============================================================== go-live OFF (default)
            await suite.test(
              'OFF by default: nothing is earned and every event is recorded',
              async () => {
                assert.equal(await tx.loyaltyGoLive.count(), 0);
                const before = await finalized([exact], alice);
                await pay(before.id, 200_000);
                // Not consumed yet: it will still be a pre-go-live episode once the switch is on.
                const consumed = await finalized([exact], alice);
                await pay(consumed.id, 200_000);
                const results = await consume(consumed.id);
                assert.deepEqual(outcomes(results), ['SKIPPED_PRE_GO_LIVE']);
                assert.equal(
                  await tx.loyaltyWalletAccount.count({ where: { userId: alice.id } }),
                  0,
                );
                assert.equal(await tx.loyaltyLedgerEntry.count({ where: { userId: alice.id } }), 0);
                const event = (await eventsOf(consumed.id))[0]!;
                const row = await tx.outboxConsumption.findUniqueOrThrow({
                  where: { eventId_consumer: { eventId: event.id, consumer: 'loyalty' } },
                });
                assert.equal(row.outcome, 'SKIPPED_PRE_GO_LIVE', 'recorded: no backlog while OFF');
                // The loyalty module is dormant: no manual adjustment either.
                await fails(
                  () =>
                    loyalty.adjust(adjuster.token, alice.id, {
                      wallet: 'SPA',
                      points: 10,
                      reason: 'Thử',
                      clientRequestId: randomUUID(),
                    }),
                  'LOYALTY_NOT_LIVE',
                );
                preGoLiveInvoiceId = before.id;
              },
            );

            // ========================================================================= go-live
            await suite.test(
              'go-live: Owner only, fresh re-authentication, once, immutable',
              async () => {
                // Nobody but the virtual Owner can read or flip the switch, whatever role they hold.
                await fails(() => loyalty.goLive(adjuster.token), 'FORBIDDEN');
                await fails(() => loyalty.activate(adjuster.token), 'FORBIDDEN');
                await fails(() => loyalty.activate(canceller.token), 'FORBIDDEN');
                // No fresh re-authentication: refused, still OFF.
                await fails(() => loyalty.activate(ownerStaleToken), 'REAUTHENTICATION_REQUIRED');
                assert.deepEqual((await loyalty.goLive(ownerToken)).active, false);
                const on = await ok(() => loyalty.activate(ownerToken));
                assert.equal(on.active, true);
                assert.ok(on.goLiveAt);
                await fails(() => loyalty.activate(ownerToken), 'LOYALTY_ALREADY_LIVE');
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'LOYALTY_GO_LIVE_ACTIVATED' },
                });
                assert.equal(audit.actorUserId, ownerRow.id);
                assert.equal(audit.dataClassification, 'FINANCIAL');
                // The row is permanent: no update, no delete.
                await sqlRejects(
                  () => tx.$executeRawUnsafe('DELETE FROM loyalty_go_live'),
                  /permanent|immutable|history/i,
                );
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe("UPDATE loyalty_go_live SET go_live_at = '2020-01-01'"),
                  /permanent|immutable|history/i,
                );
              },
            );

            await suite.test(
              'an episode paid before go-live is never backfilled (P5-Q1)',
              async () => {
                const results = await consume(preGoLiveInvoiceId);
                assert.deepEqual(outcomes(results), ['SKIPPED_PRE_GO_LIVE']);
                assert.equal(await balanceOf(alice.id), null);
              },
            );

            // ============================================================================== earn
            await suite.test(
              'earn: floor(total / 1000) once per paid episode, member payer only',
              async () => {
                // 930,500 VND -> 930 points (round down, P5-Q3); Silver from 500.
                const invoice = await finalized([odd], alice);
                await pay(invoice.id, 930_500);
                assert.deepEqual(outcomes(await consume(invoice.id)), ['APPLIED']);
                assert.equal(await balanceOf(alice.id), 930);
                const [entry] = await ledgerOf(alice.id);
                assert.equal(entry!.kind, 'EARN');
                assert.equal(entry!.points, 930);
                assert.equal(entry!.wallet, 'SPA');
                assert.equal(entry!.idempotencyKey, `SPA_EARN:${invoice.id}:1`);
                assert.equal(entry!.invoiceId, invoice.id);
                assert.equal(entry!.paidSeq, 1);
                assert.equal(
                  await balanceOf(alice.id, 'BEAUTY'),
                  null,
                  'no Beauty wallet is touched',
                );
                const emitted = await tx.outboxEvent.findMany({
                  where: { eventType: 'LOYALTY_POINTS_EARNED', aggregateId: entry!.id },
                });
                assert.equal(emitted.length, 1);
                assert.equal(emitted[0]!.publishedAt, null);
                assert.ok(!JSON.stringify(emitted[0]!.payload).includes('+84'), 'no personal data');

                // Replay: the consumer never runs twice, and the ledger key is idempotent on its own.
                assert.deepEqual(outcomes(await consume(invoice.id)), []);
                const again = await ok(() =>
                  appendLedgerEntry(tx, {
                    userId: alice.id,
                    wallet: 'SPA',
                    kind: 'EARN',
                    points: 930,
                    idempotencyKey: `SPA_EARN:${invoice.id}:1`,
                    invoiceId: invoice.id,
                    paidSeq: 1,
                  }),
                );
                assert.equal(again.created, false);
                assert.equal((await ledgerOf(alice.id)).length, 1);
                assert.equal(await balanceOf(alice.id), await ledgerSum(alice.id));

                // A guest payer earns nothing; a zero-balance invoice earns nothing; 999 VND earns nothing.
                const guest = await finalized([exact], null);
                await pay(guest.id, 200_000);
                assert.deepEqual(outcomes(await consume(guest.id)), ['SKIPPED_GUEST']);
                const zero = await finalized([free], bob);
                assert.equal(zero.status, 'PAID');
                assert.deepEqual(outcomes(await consume(zero.id)), ['NOOP']);
                assert.equal(await tx.loyaltyLedgerEntry.count({ where: { userId: bob.id } }), 0);
                assert.equal(await balanceOf(bob.id), null);
              },
            );

            await suite.test(
              'reversal: a reopened episode takes its points back; the new episode earns again',
              async () => {
                const invoice = await finalized([exact], carol);
                const paid = await pay(invoice.id, 200_000);
                assert.deepEqual(outcomes(await consume(invoice.id)), ['APPLIED']);
                assert.equal(await balanceOf(carol.id), 200);
                await reverse(invoice.id, paid.payment.id);
                assert.deepEqual(
                  outcomes(await consume(invoice.id)),
                  ['APPLIED'],
                  'INVOICE_REOPENED',
                );
                assert.equal(await balanceOf(carol.id), 0);
                const entries = await ledgerOf(carol.id);
                assert.deepEqual(
                  entries.map((entry) => [entry.kind, entry.points, entry.shortfallPoints]),
                  [
                    ['EARN', 200, 0],
                    ['EARN_REVERSAL', -200, 0],
                  ],
                );
                assert.equal(entries[1]!.reversesEntryId, entries[0]!.id);
                assert.equal(entries[1]!.idempotencyKey, `EARN_REVERSAL:${entries[0]!.id}`);
                // History is never edited or deleted.
                await sqlRejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE loyalty_ledger_entries SET points = 1 WHERE id = '${entries[0]!.id}'`,
                    ),
                  /permanent|immutable|history|append/i,
                );
                await sqlRejects(
                  () => tx.$executeRawUnsafe('DELETE FROM loyalty_ledger_entries'),
                  /permanent|immutable|history|append/i,
                );
                // Re-pay: a new paid episode (seq 2) earns normally.
                await pay(invoice.id, 200_000);
                const results = await consume(invoice.id);
                assert.deepEqual(outcomes(results), ['APPLIED']);
                assert.equal(await balanceOf(carol.id), 200);
                const last = (await ledgerOf(carol.id)).at(-1)!;
                assert.equal(last.idempotencyKey, `SPA_EARN:${invoice.id}:2`);
                assert.equal(await balanceOf(carol.id), await ledgerSum(carol.id));
              },
            );

            await suite.test(
              'out-of-order events: the stale-episode guard and no double reversal',
              async () => {
                const invoice = await finalized([exact], alice);
                const before = (await balanceOf(alice.id)) ?? 0;
                const paid = await pay(invoice.id, 200_000);
                await reverse(invoice.id, paid.payment.id);
                await pay(invoice.id, 200_000);
                const events = await eventsOf(invoice.id);
                const byKey = (type: string, seq: number) =>
                  events.find(
                    (event) =>
                      event.eventType === type &&
                      Reflect.get(Object(event.payload), 'paidSeq') === seq,
                  )!;
                // The episode paid second is processed first; its voided predecessor arrives late.
                assert.equal(await consumeEvent(byKey('INVOICE_PAID', 2).id), 'APPLIED');
                assert.equal(await consumeEvent(byKey('INVOICE_REOPENED', 1).id), 'NOOP');
                assert.equal(await consumeEvent(byKey('INVOICE_PAID', 1).id), 'SKIPPED_STALE');
                assert.equal(await balanceOf(alice.id), before + 200, 'earned exactly once');
                const keys = (await ledgerOf(alice.id)).map((entry) => entry.idempotencyKey);
                assert.equal(new Set(keys).size, keys.length);
              },
            );

            await suite.test(
              'cancel: a cancellation that voids no paid episode changes nothing',
              async () => {
                const draft = await finalized([exact], alice);
                const cancelled = await ok(() =>
                  invoices.cancel(canceller.token, draft.id, {
                    expectedVersion: draft.version,
                    reason: 'Khách đổi ý',
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                const before = await balanceOf(alice.id);
                assert.deepEqual(outcomes(await consume(draft.id)), ['NOOP']);
                assert.equal(await balanceOf(alice.id), before);
                const zero = await finalized([free], alice);
                const voided = await ok(() =>
                  invoices.cancel(canceller.token, zero.id, {
                    expectedVersion: zero.version,
                    reason: 'Hóa đơn 0 đồng nhầm',
                  }),
                );
                assert.equal(voided.status, 'CANCELLED');
                const zeroResults = await consume(zero.id);
                // PAID (0 points) is a no-op; once cancelled the episode is stale; the CANCELLED event voids the empty episode.
                assert.deepEqual(outcomes(zeroResults), ['SKIPPED_STALE', 'NOOP']);
                assert.equal(await balanceOf(alice.id), before);
              },
            );

            // ====================================================================== adjustments
            await suite.test(
              'manual adjustment: reason, actor, offset entry, replay, links',
              async () => {
                const request = (points: number, extra: Record<string, unknown> = {}) => ({
                  wallet: 'SPA' as const,
                  points,
                  reason: 'Tặng điểm xin lỗi khách',
                  clientRequestId: randomUUID(),
                  ...extra,
                });
                // Authority: ADJUST_LOYALTY_POINTS (GLOBAL) and a fresh re-authentication.
                await fails(() => loyalty.adjust(viewer.token, bob.id, request(10)), 'FORBIDDEN');
                await fails(
                  () => loyalty.adjust(adjuster.staleToken, bob.id, request(10)),
                  'REAUTHENTICATION_REQUIRED',
                );
                await fails(
                  () => loyalty.adjust(adjuster.token, bob.id, request(0)),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => loyalty.adjust(adjuster.token, bob.id, { ...request(10), reason: '   ' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () =>
                    loyalty.adjust(adjuster.token, bob.id, {
                      ...request(10),
                      clientRequestId: 'not-a-uuid',
                    }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => loyalty.adjust(adjuster.token, randomUUID(), request(10)),
                  'NOT_FOUND',
                );
                await fails(
                  () => loyalty.adjust(adjuster.token, ownerRow.id, request(10)),
                  'NOT_FOUND',
                );

                const first = request(120);
                const done = await ok(() => loyalty.adjust(adjuster.token, bob.id, first));
                assert.equal(done.replayed, false);
                assert.equal(done.entry.kind, 'MANUAL_ADJUSTMENT');
                assert.equal(done.entry.points, 120);
                assert.equal(done.entry.reason, first.reason);
                assert.equal(done.entry.actorName?.startsWith('Staff'), true);
                assert.equal(done.wallet.balancePoints, 120);
                assert.equal(await balanceOf(bob.id), 120);
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'LOYALTY_POINTS_ADJUSTED', entityId: done.entry.id },
                });
                assert.equal(audit.actorUserId, adjuster.id);
                assert.equal(audit.subjectUserId, bob.id);
                assert.equal(audit.reason, first.reason);
                assert.equal(audit.dataClassification, 'FINANCIAL');

                // Replay: the stored result; nothing is written twice. A different body is a conflict.
                const replay = await ok(() => loyalty.adjust(adjuster.token, bob.id, first));
                assert.equal(replay.replayed, true);
                assert.equal(replay.entry.id, done.entry.id);
                assert.equal(await balanceOf(bob.id), 120);
                await fails(
                  () => loyalty.adjust(adjuster.token, bob.id, { ...first, points: 121 }),
                  'CONFLICT',
                );
                await fails(
                  () => loyalty.adjust(adjuster.token, bob.id, { ...first, wallet: 'BEAUTY' }),
                  'CONFLICT',
                );

                // The Beauty wallet is independent (never merged).
                const beauty = await ok(() =>
                  loyalty.adjust(adjuster.token, bob.id, { ...request(15), wallet: 'BEAUTY' }),
                );
                assert.equal(beauty.wallet.balancePoints, 15);
                assert.equal(await balanceOf(bob.id), 120);

                // A linked correction offsets an earlier entry once (PRD 18.4), in the same wallet and customer.
                const correction = await ok(() =>
                  loyalty.adjust(
                    adjuster.token,
                    bob.id,
                    request(-120, { correctsEntryId: done.entry.id }),
                  ),
                );
                assert.equal(correction.entry.kind, 'MANUAL_CORRECTION');
                assert.equal(correction.entry.correctsEntryId, done.entry.id);
                assert.equal(await balanceOf(bob.id), 0);
                await fails(
                  () =>
                    loyalty.adjust(
                      adjuster.token,
                      bob.id,
                      request(-120, { correctsEntryId: done.entry.id }),
                    ),
                  'LOYALTY_ENTRY_ALREADY_CORRECTED',
                );
                await fails(
                  () =>
                    loyalty.adjust(
                      adjuster.token,
                      bob.id,
                      request(-1, { correctsEntryId: beauty.entry.id }),
                    ),
                  'VALIDATION_FAILED',
                );
                const [aliceEntry] = await ledgerOf(alice.id);
                await fails(
                  () =>
                    loyalty.adjust(
                      adjuster.token,
                      bob.id,
                      request(-1, { correctsEntryId: aliceEntry!.id }),
                    ),
                  'VALIDATION_FAILED',
                );
                assert.equal(await balanceOf(bob.id), await ledgerSum(bob.id));
              },
            );

            // ======================================================================== shortfall
            await suite.test(
              'shortfall: the balance never goes below 0; the rest is recorded and flagged',
              async () => {
                const erin = await customer('erin');
                const invoice = await finalized([exact], erin);
                const paid = await pay(invoice.id, 200_000);
                assert.deepEqual(outcomes(await consume(invoice.id)), ['APPLIED']);
                assert.equal(await balanceOf(erin.id), 200);
                // A manual deduction takes 150 of 200, leaving 50.
                await ok(() =>
                  loyalty.adjust(adjuster.token, erin.id, {
                    wallet: 'SPA',
                    points: -150,
                    reason: 'Khách đã dùng quà',
                    clientRequestId: randomUUID(),
                  }),
                );
                assert.equal(await balanceOf(erin.id), 50);
                // The 200-point earn is now reversed: only 50 can be taken, 150 is the shortfall.
                await reverse(invoice.id, paid.payment.id);
                assert.deepEqual(outcomes(await consume(invoice.id)), ['APPLIED']);
                assert.equal(await balanceOf(erin.id), 0);
                const reversal = (await ledgerOf(erin.id)).find(
                  (entry) => entry.kind === 'EARN_REVERSAL',
                )!;
                assert.equal(reversal.points, -50);
                assert.equal(reversal.shortfallPoints, 150);
                assert.equal(await balanceOf(erin.id), await ledgerSum(erin.id));
                // Flagged: outbox fact + audit row + a row in the exceptions list; no customer notification.
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { eventType: 'LOYALTY_SHORTFALL_FLAGGED', aggregateId: reversal.id },
                  }),
                  1,
                );
                const flag = await tx.auditEvent.findFirstOrThrow({
                  where: { action: 'LOYALTY_SHORTFALL_FLAGGED', entityId: reversal.id },
                });
                assert.equal(flag.actorKind, 'SYSTEM');
                assert.deepEqual(flag.after, {
                  kind: 'EARN_REVERSAL',
                  wallet: 'SPA',
                  requestedPoints: 200,
                  appliedPoints: 50,
                  shortfallPoints: 150,
                });
                assert.equal(
                  await tx.notification.count({ where: { recipientUserId: erin.id } }),
                  0,
                );
                const listed = await loyalty.exceptions(examiner.token, {});
                const row = listed.items.find((item) => item.entryId === reversal.id)!;
                assert.equal(row.shortfallPoints, 150);
                assert.equal(row.appliedPoints, 50);
                assert.equal(row.customer.id, erin.id);
                assert.equal(row.invoiceCode, invoice.code);
                assert.ok(
                  row.customer.phoneMasked?.includes('•') ||
                    row.customer.phoneMasked?.includes('*'),
                );
                await fails(() => loyalty.exceptions(viewer.token, {}), 'FORBIDDEN');
                await fails(() => loyalty.exceptions(adjuster.token, {}), 'FORBIDDEN');

                // A manual deduction larger than the balance clamps the same way (P5-T8).
                const clamped = await ok(() =>
                  loyalty.adjust(adjuster.token, erin.id, {
                    wallet: 'SPA',
                    points: -40,
                    reason: 'Sửa nhầm',
                    clientRequestId: randomUUID(),
                  }),
                );
                assert.equal(clamped.entry.points, 0);
                assert.equal(clamped.entry.shortfallPoints, 40);
                assert.equal(clamped.wallet.balancePoints, 0);
                assert.equal(await balanceOf(erin.id), await ledgerSum(erin.id));
                const after = await loyalty.exceptions(examiner.token, {});
                assert.equal(after.total, listed.total + 1);
              },
            );

            // ============================================================================ reading
            await suite.test(
              'profile and ledger: branch-scoped read, both wallets, tier, 20 per page',
              async () => {
                const profile = await loyalty.profile(viewer.token, branch.id, alice.id);
                assert.equal(profile.customer.id, alice.id);
                assert.equal(profile.goLive.active, true);
                assert.deepEqual(
                  profile.wallets.map((wallet) => wallet.wallet),
                  ['SPA', 'BEAUTY'],
                );
                const spa = profile.wallets[0]!;
                assert.equal(spa.balancePoints, await balanceOf(alice.id));
                // 930 (930,500 VND) + 200 (one paid episode, the stale one skipped) = 1,130: Gold, 4%.
                assert.equal(spa.balancePoints, 1130);
                assert.equal(spa.tier, 'GOLD');
                assert.equal(spa.memberDiscountBp, 400);
                assert.equal(spa.nextTier, 'PLATINUM');
                assert.equal(spa.pointsToNextTier, 3000 - 1130);
                assert.deepEqual(profile.wallets[1], {
                  wallet: 'BEAUTY',
                  balancePoints: 0,
                  tier: 'NONE',
                  memberDiscountBp: 0,
                  nextTier: 'SILVER',
                  pointsToNextTier: 500,
                });
                assert.equal(profile.can.adjust, false);
                assert.equal(
                  (await loyalty.profile(adjuster.token, branch.id, alice.id)).can.adjust,
                  true,
                );
                assert.equal(profile.customer.phoneMasked?.includes(alice.phoneCanonical!), false);
                // The branch decides (VIEW_LOYALTY exactly like the POS lookup); an Owner passes; staff elsewhere do not.
                await fails(
                  () => loyalty.profile(viewer.token, otherBranch.id, alice.id),
                  'FORBIDDEN',
                );
                await fails(
                  () => loyalty.profile(collector.token, branch.id, alice.id),
                  'FORBIDDEN',
                );
                assert.equal(
                  (await loyalty.profile(ownerToken, otherBranch.id, alice.id)).customer.id,
                  alice.id,
                );
                await fails(() => loyalty.profile(viewer.token, branch.id, ktv.id), 'NOT_FOUND');
                await fails(
                  () => loyalty.profile(viewer.token, branch.id, ownerRow.id),
                  'NOT_FOUND',
                );
                await fails(
                  () => loyalty.profile(undefined, branch.id, alice.id),
                  'AUTHENTICATION_REQUIRED',
                );

                const ledger = await loyalty.ledger(viewer.token, branch.id, alice.id, {});
                assert.equal(ledger.pageSize, 20);
                assert.equal(ledger.total, (await ledgerOf(alice.id)).length);
                assert.ok(ledger.items.length > 0 && ledger.items.length <= 20);
                const times = ledger.items.map((item) => Date.parse(item.createdAt));
                assert.deepEqual(
                  [...times].sort((a, b) => b - a),
                  times,
                  'newest first',
                );
                const earn = ledger.items.find(
                  (item) => item.kind === 'EARN' && item.paidSeq === 1,
                )!;
                assert.ok(earn.invoiceCode);
                assert.equal(earn.paidSeq, 1);
                await fails(
                  () => loyalty.ledger(viewer.token, branch.id, alice.id, { page: '0' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => loyalty.ledger(viewer.token, branch.id, alice.id, { wallet: 'X' }),
                  'VALIDATION_FAILED',
                );
                const beautyOnly = await loyalty.ledger(viewer.token, branch.id, bob.id, {
                  wallet: 'BEAUTY',
                });
                assert.ok(beautyOnly.items.every((item) => item.wallet === 'BEAUTY'));
                assert.equal(beautyOnly.total, 1, JSON.stringify(beautyOnly.items));

                // Exact lookup only (masked), at the staff member's own branch.
                const found = await loyalty.members(viewer.token, branch.id, {
                  phone: alice.phoneCanonical!,
                });
                assert.equal(found.members.length, 1);
                assert.equal(found.members[0]!.id, alice.id);
                assert.equal(
                  (await loyalty.members(viewer.token, branch.id, { phone: '+84900000000' }))
                    .members.length,
                  0,
                );
                await fails(
                  () =>
                    loyalty.members(viewer.token, otherBranch.id, { phone: alice.phoneCanonical! }),
                  'FORBIDDEN',
                );
              },
            );

            await suite.test(
              'the worker pass handles pending events and parks a failing one',
              async () => {
                const invoice = await finalized([exact], bob);
                await pay(invoice.id, 200_000);
                const sweepDatabase = {
                  outboxEvent: tx.outboxEvent,
                  $transaction: (work: never) => isolated(work),
                } as unknown as DatabaseClient;
                const cooling = new Map<string, number>();
                const seen: string[] = [];
                const failures: unknown[] = [];
                const handled = await relayLoyaltyEvents(
                  sweepDatabase,
                  cooling,
                  (outcome) => seen.push(outcome),
                  (error) => failures.push(error),
                );
                await settle();
                assert.ok(handled >= 1);
                assert.equal(failures.length, 0);
                assert.ok(seen.includes('APPLIED'));
                assert.equal(await balanceOf(bob.id), 200);
                assert.equal(
                  await relayLoyaltyEvents(
                    sweepDatabase,
                    cooling,
                    () => undefined,
                    () => undefined,
                  ),
                  0,
                );
              },
            );

            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
