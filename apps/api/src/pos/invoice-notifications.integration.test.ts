import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InvoiceResponse } from '@lucy-spa/contracts';
import {
  appendOutboxEvent,
  createDatabaseClient,
  syncPermissionCatalog,
  type DatabaseClient,
  type Prisma,
} from '@lucy-spa/database';
import {
  createPayosSimulator,
  parseApiEnvironment,
  processFinancialNotificationEvent,
  scheduleRevenueSummaries,
} from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';
import { PayosWebhookService } from './payos.webhook.js';

/**
 * Phase 4 Step 10 (Owner answers Q8): invoice / revenue notifications against real PostgreSQL. Staff
 * create, pay, reverse and cancel invoices through the real services (which append the real outbox events);
 * the consumer then runs on those events. Every fixture rolls back with the outer transaction.
 */
test(
  'Phase 4 Step 10 invoice / revenue notifications; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 10 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `notify_${++savepoint}`;
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
            const webhook = new PayosWebhookService(
              { client: { $transaction: (work: never) => isolated(work) } } as never,
              simulator.provider,
              null,
            );
            const sweepDatabase = {
              $queryRaw: tx.$queryRaw.bind(tx),
              $transaction: (work: never) => isolated(work),
            } as unknown as DatabaseClient;
            // Deferred Step 4 integrity triggers fire at commit; fixtures never commit, so force them.
            const settle = async () => {
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            };
            const ok = async <T>(work: () => Promise<T>): Promise<T> => {
              const result = await work();
              await settle();
              return result;
            };
            const deliver = async (body: unknown) => {
              const outcome = await webhook.receive(body);
              await settle();
              return outcome;
            };

            await syncPermissionCatalog(tx);
            type Code =
              | 'VIEW_INVOICES'
              | 'MANAGE_INVOICES'
              | 'CANCEL_INVOICES'
              | 'COLLECT_PAYMENTS'
              | 'CORRECT_PAYMENTS'
              | 'APPLY_DISCOUNTS'
              | 'VIEW_REVENUE';
            const category = await tx.serviceCategory.create({
              data: { code: `N10_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const makeService = (key: string, price: [bigint, bigint]) =>
              tx.service.create({
                data: {
                  code: `N10_${key}_${run}`,
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
            const fixtureIds = new Set<string>();
            const customer = async (label: string) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `n10-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `n10-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
              fixtureIds.add(user.id);
              return user;
            };
            const alice = await customer('alice');
            const bob = await customer('bob');

            /** One branch with its own staff, so figures and recipients never mix between branches. */
            const world = async (label: string, options: { active?: boolean } = {}) => {
              const branch = await tx.branch.create({
                data: {
                  code: `N10_${label}_${run}`,
                  name: `Notify ${label}`,
                  timezone: 'Asia/Ho_Chi_Minh',
                  isActive: options.active ?? true,
                },
              });
              const makeRole = async (name: string, codes: Code[]) =>
                tx.role.create({
                  data: {
                    code: `N10_${name}_${label}_${run}`,
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
              const roles = {
                prepare: await makeRole('PREPARE', [
                  'VIEW_INVOICES',
                  'MANAGE_INVOICES',
                  'APPLY_DISCOUNTS',
                ]),
                collect: await makeRole('COLLECT', ['COLLECT_PAYMENTS']),
                correct: await makeRole('CORRECT', ['CORRECT_PAYMENTS', 'VIEW_INVOICES']),
                cancel: await makeRole('CANCEL', ['CANCEL_INVOICES', 'VIEW_INVOICES']),
                revenue: await makeRole('REVENUE', ['VIEW_REVENUE']),
                both: await makeRole('BOTH', ['COLLECT_PAYMENTS', 'CORRECT_PAYMENTS']),
              };
              const staffUser = async (roleId: string | null) => {
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
                        employeeCodeCanonical: `N10_${run}_${n}`,
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
                fixtureIds.add(user.id);
                return { id: user.id, token: await login(user), raw: user };
              };
              const cashier = await staffUser(roles.prepare.id);
              const collector = await staffUser(roles.collect.id);
              const corrector = await staffUser(roles.correct.id);
              const canceller = await staffUser(roles.cancel.id);
              const viewer = await staffUser(roles.revenue.id);
              const both = await staffUser(roles.both.id);
              const ktv = await staffUser(null);

              let slot = 0;
              const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
              const completedVisit = async (services: Service[], owner: { id: string } | null) => {
                n++;
                const visit = await tx.visit.create({
                  data: {
                    code: `VS-N10-${run}-${n}`,
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
              const draft = async (services: Service[], owner: { id: string } | null) => {
                const visitId = await completedVisit(services, owner);
                return (await ok(() => invoices.open(cashier.token, visitId))).invoice;
              };
              const priceAll = async (invoice: InvoiceResponse) => {
                let current = invoice;
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
              /** A finalized invoice whose payer defaults to the visit owner (null = a guest payer). */
              const finalized = async (services: Service[], owner: { id: string } | null) => {
                const priced = await priceAll(await draft(services, owner));
                return ok(() =>
                  invoices.finalize(cashier.token, priced.id, { expectedVersion: priced.version }),
                );
              };
              const pay = (invoiceId: string, amount: number, by = collector) =>
                ok(() =>
                  invoices.recordPayment(by.token, invoiceId, {
                    method: 'CASH',
                    amountVnd: String(amount),
                    tenderedVnd: String(amount),
                    idempotencyKey: randomUUID(),
                  }),
                );
              const payos = (invoiceId: string, amount: number, by = collector) =>
                ok(() =>
                  invoices.createPayos(by.token, invoiceId, {
                    amountVnd: String(amount),
                    idempotencyKey: randomUUID(),
                  }),
                );
              return {
                branch,
                roles,
                cashier,
                collector,
                corrector,
                canceller,
                viewer,
                both,
                staffUser,
                draft,
                finalized,
                pay,
                payos,
              };
            };
            const main = await world('MAIN');
            const other = await world('OTHER');

            // ------------------------------------------------------------------ consumer helpers
            const HANDLED = [
              'INVOICE_PAID',
              'INVOICE_CANCELLED',
              'PAYMENT_SUCCEEDED',
              'PAYMENT_REVERSED',
              'PAYMENT_ANOMALY_FLAGGED',
              'REVENUE_SUMMARY_DUE',
            ];
            /** Runs the consumer over every handled event of the invoice and its payments, oldest first. */
            const consume = async (invoiceId: string) => {
              const paymentIds = (
                await tx.payment.findMany({ where: { invoiceId }, select: { id: true } })
              ).map((row) => row.id);
              const events = await tx.outboxEvent.findMany({
                where: {
                  aggregateId: { in: [invoiceId, ...paymentIds] },
                  eventType: { in: HANDLED },
                },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
              const results: { id: string; eventType: string; outcome: string }[] = [];
              for (const event of events) {
                results.push({
                  id: event.id,
                  eventType: event.eventType,
                  outcome: await processFinancialNotificationEvent(tx, event.id),
                });
              }
              return results;
            };
            const outcomeOf = (
              results: { eventType: string; outcome: string }[],
              eventType: string,
            ) =>
              results
                .filter((entry) => entry.eventType === eventType && entry.outcome !== 'NOT_CLAIMED')
                .map((entry) => entry.outcome);
            const rowsOf = (entityId: string) =>
              tx.notification.findMany({ where: { entityId }, orderBy: { id: 'asc' } });
            const heldBy = (rows: { recipientUserId: string }[]) =>
              rows
                .map((row) => row.recipientUserId)
                .filter((id) => fixtureIds.has(id))
                .sort();
            const sorted = (...people: { id: string }[]) => people.map((p) => p.id).sort();
            /** Anyone outside the fixtures that received a row must be an Owner (holds every permission). */
            const assertOnlyOwnersBeyondFixtures = async (rows: { recipientUserId: string }[]) => {
              for (const row of rows.filter((entry) => !fixtureIds.has(entry.recipientUserId))) {
                const user = await tx.user.findUniqueOrThrow({
                  where: { id: row.recipientUserId },
                });
                assert.equal(user.kind, 'OWNER');
              }
            };

            // ===================================================================== payer: PAID
            await suite.test(
              'payer: notified when the invoice becomes PAID (incl. zero balance); nothing for a partial payment or a guest payer',
              async () => {
                const invoice = await main.finalized([exact], alice);
                await main.pay(invoice.id, 100_000);
                const partial = await consume(invoice.id);
                assert.deepEqual(outcomeOf(partial, 'PAYMENT_SUCCEEDED'), ['SKIPPED']);
                assert.deepEqual(await rowsOf(invoice.id), [], 'a partial cash payment is silent');

                await main.pay(invoice.id, 100_000);
                const done = await consume(invoice.id);
                assert.deepEqual(outcomeOf(done, 'INVOICE_PAID'), ['PUBLISHED']);
                const rows = await rowsOf(invoice.id);
                assert.equal(rows.length, 1);
                const [row] = rows;
                assert.equal(row!.recipientUserId, alice.id);
                assert.equal(row!.type, 'INVOICE_PAID');
                assert.equal(row!.entityType, 'Invoice');
                assert.equal(row!.branchId, main.branch.id);
                assert.equal(row!.contextCode, invoice.code);
                assert.deepEqual(row!.params, { amountVnd: '200000' });
                assert.equal(row!.readAt, null);
                const paidEvent = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: invoice.id, eventType: 'INVOICE_PAID' },
                });
                assert.equal(paidEvent.publishedAt, null, 'published_at is never used');
                assert.equal(row!.sourceEventId, paidEvent.id);
                assert.equal(row!.actionAt.getTime(), paidEvent.occurredAt.getTime());
                const consumption = await tx.outboxConsumption.findUniqueOrThrow({
                  where: { eventId_consumer: { eventId: paidEvent.id, consumer: 'notifications' } },
                });
                assert.equal(consumption.outcome, 'PUBLISHED');

                // A replay changes nothing and never resets the read state.
                await tx.notification.update({
                  where: { id: row!.id },
                  data: { readAt: new Date() },
                });
                const replay = await consume(invoice.id);
                assert.ok(replay.every((entry) => entry.outcome === 'NOT_CLAIMED'));
                const after = await rowsOf(invoice.id);
                assert.equal(after.length, 1);
                assert.ok(after[0]!.readAt);

                // Nobody else hears about it: not another customer, not staff.
                assert.ok(!heldBy(after).includes(bob.id));

                // A guest payer has no account: nothing is delivered.
                const guest = await main.finalized([exact], null);
                await main.pay(guest.id, 200_000);
                assert.deepEqual(outcomeOf(await consume(guest.id), 'INVOICE_PAID'), ['SKIPPED']);
                assert.deepEqual(await rowsOf(guest.id), []);

                // Zero balance (no payment row): PAID is still announced, with amount 0.
                const zero = await main.finalized([free], alice);
                assert.equal(zero.status, 'PAID');
                assert.deepEqual(outcomeOf(await consume(zero.id), 'INVOICE_PAID'), ['PUBLISHED']);
                const [zeroRow] = await rowsOf(zero.id);
                assert.deepEqual(zeroRow!.params, { amountVnd: '0' });
              },
            );

            await suite.test(
              'payer: a reversed paid episode is never announced; the new episode is',
              async () => {
                const invoice = await main.finalized([exact], alice);
                const paid = await main.pay(invoice.id, 200_000);
                await ok(() =>
                  invoices.reversePayment(main.corrector.token, invoice.id, paid.payment.id, {
                    reason: 'Nhập nhầm',
                  }),
                );
                // Consumed only now: the episode it announces has already been superseded.
                const stale = await consume(invoice.id);
                assert.deepEqual(outcomeOf(stale, 'INVOICE_PAID'), ['SKIPPED']);
                assert.deepEqual(
                  (await rowsOf(invoice.id)).filter((row) => row.type === 'INVOICE_PAID'),
                  [],
                );
                await main.pay(invoice.id, 200_000);
                const fresh = await consume(invoice.id);
                assert.deepEqual(outcomeOf(fresh, 'INVOICE_PAID'), ['PUBLISHED']);
                const paidRows = (await rowsOf(invoice.id)).filter(
                  (row) => row.type === 'INVOICE_PAID',
                );
                assert.equal(paidRows.length, 1);
                assert.equal(paidRows[0]!.recipientUserId, alice.id);
              },
            );

            // ===================================================================== cancellation
            await suite.test(
              'cancellation of a finalized invoice: payer (no reason) + CORRECT_PAYMENTS holders of that branch only; drafts are silent',
              async () => {
                const secret = 'Lý do nội bộ không được lộ';
                const invoice = await main.finalized([exact], alice);
                await ok(() =>
                  invoices.cancel(main.canceller.token, invoice.id, {
                    expectedVersion: invoice.version,
                    reason: secret,
                  }),
                );
                const results = await consume(invoice.id);
                assert.deepEqual(outcomeOf(results, 'INVOICE_CANCELLED'), ['PUBLISHED']);
                const rows = await rowsOf(invoice.id);
                const customerRow = rows.find((row) => row.recipientUserId === alice.id)!;
                assert.equal(customerRow.type, 'INVOICE_CANCELLED');
                assert.equal(customerRow.params, null);
                const alerts = rows.filter((row) => row.type === 'INVOICE_CANCELLED_ALERT');
                assert.deepEqual(heldBy(alerts), sorted(main.corrector, main.both));
                assert.deepEqual(alerts[0]!.params, {
                  cancelledFrom: 'PENDING_PAYMENT',
                  amountVnd: '200000',
                });
                await assertOnlyOwnersBeyondFixtures(alerts);
                // Not the cancelling actor's role, not other permissions, not another branch, not bob.
                for (const stranger of [
                  main.cashier,
                  main.collector,
                  main.canceller,
                  main.viewer,
                  other.corrector,
                  other.both,
                  bob,
                ]) {
                  assert.ok(!heldBy(rows).includes(stranger.id));
                }
                assert.ok(!JSON.stringify(rows).includes(secret), 'the reason is never delivered');

                // A draft that is cancelled is nobody's business.
                const drafted = await main.draft([exact], alice);
                await ok(() =>
                  invoices.cancel(main.canceller.token, drafted.id, {
                    expectedVersion: drafted.version,
                    reason: 'Sửa nháp',
                  }),
                );
                assert.deepEqual(outcomeOf(await consume(drafted.id), 'INVOICE_CANCELLED'), [
                  'SKIPPED',
                ]);
                assert.deepEqual(await rowsOf(drafted.id), []);

                // OP-7: cancelling a zero-balance PAID invoice notifies the same way.
                const zero = await main.finalized([free], alice);
                await consume(zero.id);
                await ok(() =>
                  invoices.cancel(main.canceller.token, zero.id, {
                    expectedVersion: zero.version,
                    reason: 'Sai ưu đãi',
                  }),
                );
                assert.deepEqual(outcomeOf(await consume(zero.id), 'INVOICE_CANCELLED'), [
                  'PUBLISHED',
                ]);
                const zeroRows = await rowsOf(zero.id);
                assert.ok(
                  zeroRows.some(
                    (row) => row.type === 'INVOICE_CANCELLED' && row.recipientUserId === alice.id,
                  ),
                );
                const zeroAlert = zeroRows.find((row) => row.type === 'INVOICE_CANCELLED_ALERT')!;
                assert.deepEqual(zeroAlert.params, { cancelledFrom: 'PAID', amountVnd: '0' });
              },
            );

            // ===================================================================== reversal
            await suite.test(
              'payment reversal: CORRECT_PAYMENTS holders of that branch only, with that invoice’s amount',
              async () => {
                const invoice = await main.finalized([exact], alice);
                const paid = await main.pay(invoice.id, 200_000);
                await ok(() =>
                  invoices.reversePayment(main.corrector.token, invoice.id, paid.payment.id, {
                    reason: 'Nhập nhầm số tiền',
                  }),
                );
                const results = await consume(invoice.id);
                assert.deepEqual(outcomeOf(results, 'PAYMENT_REVERSED'), ['PUBLISHED']);
                const rows = (await rowsOf(invoice.id)).filter(
                  (row) => row.type === 'PAYMENT_REVERSED',
                );
                assert.deepEqual(heldBy(rows), sorted(main.corrector, main.both));
                assert.deepEqual(rows[0]!.params, { method: 'CASH', amountVnd: '200000' });
                await assertOnlyOwnersBeyondFixtures(rows);
                const all = await rowsOf(invoice.id);
                for (const stranger of [
                  alice,
                  bob,
                  main.cashier,
                  main.collector,
                  main.viewer,
                  other.corrector,
                ]) {
                  assert.ok(!heldBy(all).includes(stranger.id));
                }
                assert.ok(
                  !JSON.stringify(all).includes('Nhập nhầm'),
                  'the reason is never delivered',
                );
              },
            );

            // ===================================================================== PayOS
            await suite.test(
              'PayOS: the request creator hears of success; the payer of PAID; management stays silent',
              async () => {
                const invoice = await main.finalized([exact], alice);
                const made = await main.payos(invoice.id, 200_000);
                const orderCode = Number(
                  (await tx.payment.findUniqueOrThrow({ where: { id: made.payment.id } }))
                    .providerOrderCode,
                );
                await deliver(simulator.pay(orderCode, { reference: `TF-N-${run}` }));
                const results = await consume(invoice.id);
                assert.deepEqual(outcomeOf(results, 'PAYMENT_SUCCEEDED'), ['PUBLISHED']);
                assert.deepEqual(outcomeOf(results, 'INVOICE_PAID'), ['PUBLISHED']);
                const rows = await rowsOf(invoice.id);
                const succeeded = rows.filter((row) => row.type === 'PAYOS_PAYMENT_SUCCEEDED');
                assert.deepEqual(heldBy(succeeded), sorted(main.collector));
                assert.deepEqual(succeeded[0]!.params, { amountVnd: '200000' });
                assert.deepEqual(
                  rows.filter((row) => row.type === 'INVOICE_PAID').map((r) => r.recipientUserId),
                  [alice.id],
                );
                assert.equal(rows.length, 2, 'no management row for a normal success');
              },
            );

            await suite.test(
              'PayOS: a creator who can no longer collect at the branch is not notified',
              async () => {
                const temp = await main.staffUser(main.roles.collect.id);
                const invoice = await main.finalized([exact], null);
                const made = await main.payos(invoice.id, 200_000, temp);
                await tx.userRoleAssignment.deleteMany({ where: { userId: temp.id } });
                const orderCode = Number(
                  (await tx.payment.findUniqueOrThrow({ where: { id: made.payment.id } }))
                    .providerOrderCode,
                );
                await deliver(simulator.pay(orderCode, { reference: `TF-T-${run}` }));
                const results = await consume(invoice.id);
                assert.deepEqual(outcomeOf(results, 'PAYMENT_SUCCEEDED'), ['SKIPPED']);
                assert.deepEqual(await rowsOf(invoice.id), []);
              },
            );

            await suite.test(
              'PayOS anomaly: the creator and CORRECT_PAYMENTS holders of the branch, once each, with that invoice’s amounts',
              async () => {
                // Creator holds COLLECT only: told in addition to the holders.
                const invoice = await main.finalized([exact], alice);
                const made = await main.payos(invoice.id, 200_000);
                const orderCode = Number(
                  (await tx.payment.findUniqueOrThrow({ where: { id: made.payment.id } }))
                    .providerOrderCode,
                );
                await deliver(
                  simulator.pay(orderCode, { amount: 150_000, reference: `TF-M-${run}` }),
                );
                const results = await consume(invoice.id);
                assert.deepEqual(outcomeOf(results, 'PAYMENT_ANOMALY_FLAGGED'), ['PUBLISHED']);
                const rows = (await rowsOf(invoice.id)).filter(
                  (row) => row.type === 'PAYOS_PAYMENT_ANOMALY',
                );
                assert.deepEqual(heldBy(rows), sorted(main.collector, main.corrector, main.both));
                assert.deepEqual(rows[0]!.params, {
                  anomaly: 'AMOUNT_MISMATCH',
                  expectedAmountVnd: '200000',
                  receivedAmountVnd: '150000',
                });
                await assertOnlyOwnersBeyondFixtures(rows);
                for (const stranger of [
                  alice,
                  main.cashier,
                  main.viewer,
                  other.corrector,
                  other.collector,
                ]) {
                  assert.ok(!heldBy(rows).includes(stranger.id));
                }

                // Creator who is also a holder: one row, not two.
                const second = await main.finalized([exact], alice);
                const madeBoth = await main.payos(second.id, 200_000, main.both);
                const secondCode = Number(
                  (await tx.payment.findUniqueOrThrow({ where: { id: madeBoth.payment.id } }))
                    .providerOrderCode,
                );
                await deliver(
                  simulator.pay(secondCode, { amount: 100_000, reference: `TF-B-${run}` }),
                );
                await consume(second.id);
                const bothRows = (await rowsOf(second.id)).filter(
                  (row) => row.type === 'PAYOS_PAYMENT_ANOMALY',
                );
                assert.equal(
                  bothRows.filter((row) => row.recipientUserId === main.both.id).length,
                  1,
                );
                assert.ok(
                  !heldBy(bothRows).includes(main.collector.id),
                  'not the creator this time',
                );
                assert.deepEqual(heldBy(bothRows), sorted(main.corrector, main.both));
              },
            );

            // ===================================================================== daily summary
            await suite.test(
              'daily summary: scheduled once per branch-local date at 21:30; only VIEW_REVENUE holders get the totals',
              async () => {
                const rev = await world('REV');
                const eventsOfBranch = () =>
                  tx.outboxEvent.findMany({
                    where: { aggregateId: rev.branch.id, eventType: 'REVENUE_SUMMARY_DUE' },
                    orderBy: { occurredAt: 'asc' },
                  });
                // 21:29 in Ho Chi Minh City: not yet. 21:31: due, exactly once.
                await scheduleRevenueSummaries(sweepDatabase, new Date('2026-03-02T14:29:00Z'));
                assert.equal((await eventsOfBranch()).length, 0);
                await scheduleRevenueSummaries(sweepDatabase, new Date('2026-03-02T14:31:00Z'));
                await scheduleRevenueSummaries(sweepDatabase, new Date('2026-03-02T14:45:00Z'));
                const first = await eventsOfBranch();
                assert.equal(first.length, 1);
                assert.deepEqual(first[0]!.payload, { businessDate: '2026-03-02' });
                assert.equal(first[0]!.publishedAt, null);
                assert.equal(first[0]!.branchId, rev.branch.id);
                // The unique index is the backstop for a concurrent scheduler.
                await assert.rejects(
                  isolated(() =>
                    appendOutboxEvent(tx, {
                      branchId: rev.branch.id,
                      aggregateType: 'Branch',
                      aggregateId: rev.branch.id,
                      eventType: 'REVENUE_SUMMARY_DUE',
                      schemaVersion: 1,
                      payload: { businessDate: '2026-03-02' },
                    }),
                  ),
                );
                await scheduleRevenueSummaries(sweepDatabase, new Date('2026-03-03T14:31:00Z'));
                assert.equal((await eventsOfBranch()).length, 2);

                // Fixtures for 2026-03-02 (local). Instants are stamped with the trigger-free technique
                // the other Step 8 suites use, inside the rolled-back transaction.
                const stamp = async (paymentId: string, invoiceId: string, iso: string) => {
                  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
                  await tx.$executeRawUnsafe(
                    `UPDATE payments SET collected_at = '${iso}'::timestamptz WHERE id = '${paymentId}'::uuid`,
                  );
                  // created_at <= finalized_at <= paid_at is a CHECK: the invoice moves back with its money.
                  await tx.$executeRawUnsafe(
                    `UPDATE invoices SET created_at = '${iso}'::timestamptz - interval '2 hours',
                       finalized_at = '${iso}'::timestamptz - interval '1 hour',
                       paid_at = CASE WHEN status = 'PAID' THEN '${iso}'::timestamptz ELSE NULL END
                     WHERE id = '${invoiceId}'::uuid`,
                  );
                  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
                };
                // 1: cash 200k paid 10:00 (counts). 2: PayOS 200k paid 15:00 (counts).
                const inv1 = await rev.finalized([exact], alice);
                const cash1 = await rev.pay(inv1.id, 200_000);
                await stamp(cash1.payment.id, inv1.id, '2026-03-02T10:00:00+07:00');
                const inv2 = await rev.finalized([exact], alice);
                const made2 = await rev.payos(inv2.id, 200_000);
                const code2 = Number(
                  (await tx.payment.findUniqueOrThrow({ where: { id: made2.payment.id } }))
                    .providerOrderCode,
                );
                await deliver(simulator.pay(code2, { reference: `TF-S-${run}` }));
                await stamp(made2.payment.id, inv2.id, '2026-03-02T15:00:00+07:00');
                // 3: paid 22:00, after the 21:30 dispatch instant (excluded).
                const inv3 = await rev.finalized([exact], alice);
                const cash3 = await rev.pay(inv3.id, 200_000);
                await stamp(cash3.payment.id, inv3.id, '2026-03-02T22:00:00+07:00');
                // 4: partial cash 100k at 11:00 (collected; still pending). 5: unpaid (pending).
                const inv4 = await rev.finalized([exact], alice);
                const cash4 = await rev.pay(inv4.id, 100_000);
                await stamp(cash4.payment.id, inv4.id, '2026-03-02T11:00:00+07:00');
                await rev.finalized([exact], alice);
                // 6: cash 200k at 12:00 then reversed: not collected, and pending again.
                const inv6 = await rev.finalized([exact], alice);
                const cash6 = await rev.pay(inv6.id, 200_000);
                await ok(() =>
                  invoices.reversePayment(rev.corrector.token, inv6.id, cash6.payment.id, {
                    reason: 'Nhập nhầm',
                  }),
                );
                await stamp(cash6.payment.id, inv6.id, '2026-03-02T12:00:00+07:00');
                // 7: paid the day before (not this date).
                const inv7 = await rev.finalized([exact], alice);
                const cash7 = await rev.pay(inv7.id, 200_000);
                await stamp(cash7.payment.id, inv7.id, '2026-03-01T23:59:00+07:00');

                const [dueMarch2, dueMarch3] = await eventsOfBranch();
                assert.equal(
                  await processFinancialNotificationEvent(tx, dueMarch2!.id),
                  'PUBLISHED',
                );
                const summaries = await tx.notification.findMany({
                  where: { sourceEventId: dueMarch2!.id },
                });
                assert.deepEqual(heldBy(summaries), sorted(rev.viewer));
                await assertOnlyOwnersBeyondFixtures(summaries);
                const [summary] = summaries.filter((row) => row.recipientUserId === rev.viewer.id);
                assert.equal(summary!.type, 'REVENUE_DAILY_SUMMARY');
                assert.equal(summary!.entityType, 'Branch');
                assert.equal(summary!.entityId, rev.branch.id);
                assert.equal(summary!.branchId, rev.branch.id);
                assert.deepEqual(summary!.params, {
                  businessDate: '2026-03-02',
                  totalVnd: '500000',
                  cashVnd: '300000',
                  payosVnd: '200000',
                  paidInvoiceCount: 2,
                  pendingPaymentCount: 3,
                });
                // Revenue totals reach VIEW_REVENUE holders only: not CORRECT_PAYMENTS holders,
                // customers, staff of other branches, nor holders of the permission elsewhere.
                for (const stranger of [
                  rev.corrector,
                  rev.both,
                  rev.cashier,
                  alice,
                  bob,
                  main.viewer,
                  other.viewer,
                ]) {
                  assert.ok(!heldBy(summaries).includes(stranger.id));
                }
                // The next date starts from zero (the money above was collected the day before).
                assert.equal(
                  await processFinancialNotificationEvent(tx, dueMarch3!.id),
                  'PUBLISHED',
                );
                const [next] = await tx.notification.findMany({
                  where: { sourceEventId: dueMarch3!.id, recipientUserId: rev.viewer.id },
                });
                assert.deepEqual(next!.params, {
                  businessDate: '2026-03-03',
                  totalVnd: '0',
                  cashVnd: '0',
                  payosVnd: '0',
                  paidInvoiceCount: 0,
                  pendingPaymentCount: 3,
                });
              },
            );

            await suite.test(
              'daily summary of an inactive branch is skipped, never delivered',
              async () => {
                const closed = await world('CLOSED', { active: false });
                const event = await appendOutboxEvent(tx, {
                  branchId: closed.branch.id,
                  aggregateType: 'Branch',
                  aggregateId: closed.branch.id,
                  eventType: 'REVENUE_SUMMARY_DUE',
                  schemaVersion: 1,
                  payload: { businessDate: '2026-03-02' },
                });
                assert.equal(await processFinancialNotificationEvent(tx, event.id), 'SKIPPED');
                assert.deepEqual(
                  await tx.notification.findMany({ where: { sourceEventId: event.id } }),
                  [],
                );
              },
            );

            // ===================================================================== contract / DB
            await suite.test(
              'multi-consumer contract: consumptions are per consumer, permanent and unique; unrelated events are untouched',
              async () => {
                const invoice = await main.finalized([exact], alice);
                const finalizedEvent = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: invoice.id, eventType: 'INVOICE_FINALIZED' },
                });
                assert.equal(
                  await processFinancialNotificationEvent(tx, finalizedEvent.id),
                  'IGNORED',
                );
                assert.equal(
                  await tx.outboxConsumption.count({ where: { eventId: finalizedEvent.id } }),
                  0,
                  'an event this consumer does not handle gets no consumption row',
                );

                await main.pay(invoice.id, 200_000);
                const paidEvent = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: invoice.id, eventType: 'INVOICE_PAID' },
                });
                // Another consumer has already handled it: this consumer is unaffected.
                await tx.outboxConsumption.create({
                  data: { eventId: paidEvent.id, consumer: 'loyalty', outcome: 'PUBLISHED' },
                });
                assert.equal(
                  await processFinancialNotificationEvent(tx, paidEvent.id),
                  'PUBLISHED',
                );
                assert.equal(
                  await processFinancialNotificationEvent(tx, paidEvent.id),
                  'NOT_CLAIMED',
                );
                assert.equal(
                  await tx.outboxConsumption.count({ where: { eventId: paidEvent.id } }),
                  2,
                );
                // One row per (event, consumer); rows are append-only.
                await assert.rejects(
                  isolated(() =>
                    tx.outboxConsumption.create({
                      data: { eventId: paidEvent.id, consumer: 'loyalty', outcome: 'SKIPPED' },
                    }),
                  ),
                );
                await assert.rejects(
                  isolated(() =>
                    tx.$executeRawUnsafe(
                      `UPDATE outbox_consumptions SET outcome = 'SKIPPED' WHERE event_id = '${paidEvent.id}'::uuid`,
                    ),
                  ),
                );
                await assert.rejects(
                  isolated(() =>
                    tx.$executeRawUnsafe(
                      `DELETE FROM outbox_consumptions WHERE event_id = '${paidEvent.id}'::uuid`,
                    ),
                  ),
                );
              },
            );

            await suite.test(
              'the closed notification CHECKs keep type/entity pairing and the summary branch rule',
              async () => {
                const invoice = await main.finalized([exact], alice);
                const source = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: invoice.id, eventType: 'INVOICE_FINALIZED' },
                });
                const base = {
                  recipientUserId: alice.id,
                  sourceEventId: source.id,
                  branchId: main.branch.id,
                  contextCode: invoice.code,
                  actionAt: new Date(),
                };
                const insert = (data: Record<string, unknown>) =>
                  isolated(() => tx.notification.create({ data: { ...base, ...data } as never }));
                // Wrong pairings are refused in both directions.
                await assert.rejects(
                  insert({ type: 'INVOICE_PAID', entityType: 'Booking', entityId: invoice.id }),
                );
                await assert.rejects(
                  insert({ type: 'BOOKING_CREATED', entityType: 'Invoice', entityId: invoice.id }),
                );
                await assert.rejects(
                  insert({
                    type: 'REVENUE_DAILY_SUMMARY',
                    entityType: 'Invoice',
                    entityId: invoice.id,
                  }),
                );
                // The summary's entity must be its own branch.
                await assert.rejects(
                  insert({
                    type: 'REVENUE_DAILY_SUMMARY',
                    entityType: 'Branch',
                    entityId: other.branch.id,
                  }),
                );
                // A valid Invoice row is accepted.
                await insert({ type: 'INVOICE_PAID', entityType: 'Invoice', entityId: invoice.id });
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
