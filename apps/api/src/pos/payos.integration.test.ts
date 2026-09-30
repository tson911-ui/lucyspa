import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { InvoiceResponse, PaymentResultResponse } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type DatabaseClient,
  type Prisma,
} from '@lucy-spa/database';
import {
  createPayosSimulator,
  parseApiEnvironment,
  reconcilePendingPayments,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';
import { PayosWebhookService } from './payos.webhook.js';

/**
 * Phase 4 Step 8: PayOS (simulated provider) against real PostgreSQL: request creation, verified
 * confirmation, late/mismatched money, cancel, reconciliation and the database backstops. Every
 * fixture (and every command) rolls back with the outer transaction; concurrency is covered by the separate
 * race suite. After each command the deferred Step 4 integrity triggers are forced to run (`settle`), so a
 * command that would fail the database's commit-time checks fails here too.
 */
test(
  'Phase 4 Step 8 PayOS payments; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 8 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `payos_${++savepoint}`;
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
            // No PayOS configuration: the method is disabled, never mocked.
            const unconfigured = new InvoiceService(
              sessionAdapter,
              new AuthThrottleService(environment),
              environment,
            );
            const webhook = new PayosWebhookService(
              { client: { $transaction: (work: never) => isolated(work) } } as never,
              simulator.provider,
              null,
            );
            const sweepDatabase = {
              payment: tx.payment,
              $transaction: (work: never) => isolated(work),
            } as unknown as DatabaseClient;
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            };
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

            const branch = await tx.branch.create({
              data: { code: `IV_${run}`, name: 'Invoice fixture', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const elsewhere = await tx.branch.create({
              data: { code: `IV_OTHER_${run}`, name: 'Other', timezone: 'Asia/Ho_Chi_Minh' },
            });
            await syncPermissionCatalog(tx);
            type Code =
              | 'VIEW_INVOICES'
              | 'MANAGE_INVOICES'
              | 'CANCEL_INVOICES'
              | 'COLLECT_PAYMENTS'
              | 'CORRECT_PAYMENTS';
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `IV_${name}_${run}`,
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
              view: await makeRole('VIEW', ['VIEW_INVOICES']),
              manage: await makeRole('MANAGE', ['MANAGE_INVOICES']),
              prepare: await makeRole('PREPARE', ['VIEW_INVOICES', 'MANAGE_INVOICES']),
              collect: await makeRole('COLLECT', ['COLLECT_PAYMENTS']),
              collectView: await makeRole('COLLECTVIEW', ['COLLECT_PAYMENTS', 'VIEW_INVOICES']),
              correct: await makeRole('CORRECT', ['CORRECT_PAYMENTS', 'VIEW_INVOICES']),
              cancel: await makeRole('CANCEL', ['CANCEL_INVOICES', 'VIEW_INVOICES']),
              boss: await makeRole('BOSS', [
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'CANCEL_INVOICES',
                'COLLECT_PAYMENTS',
                'CORRECT_PAYMENTS',
              ]),
            };

            const category = await tx.serviceCategory.create({
              data: { code: `IV_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const makeService = (
              key: string,
              price: [bigint, bigint],
              unit: 'PER_SERVICE' | 'PER_NAIL' = 'PER_SERVICE',
              maxQuantity = 1,
            ) =>
              tx.service.create({
                data: {
                  code: `IV_${key}_${run}`,
                  categoryId: category.id,
                  nameVi: `Dịch vụ ${key}`,
                  nameEn: `Service ${key}`,
                  priceVnd: price[0],
                  priceMaxVnd: price[1],
                  pricingUnit: unit,
                  maxQuantity,
                  durationMinutes: 10,
                  estimatedMinMinutes: 10,
                  estimatedMaxMinutes: 10,
                },
              });
            const ranged = await makeService('RANGED', [100_000n, 150_000n]);
            const exact = await makeService('EXACT', [200_000n, 200_000n]);
            type Service = typeof ranged;

            type Person = { id: string; token: string };
            const login = async (
              user: {
                id: string;
                passwordHash: string | null;
                credentialVersion: number;
                authzVersion: number;
              },
              reauthenticated = false,
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
              // A password confirmation rotates an already authenticated session.
              return (
                await sessions.rotateAuthenticated(first, principal, { reauthenticated: true }, tx)
              ).token;
            };
            const staffUser = async (
              grants: { roleId: string; branchId: string }[],
              options: { reauthenticated?: boolean } = {},
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
                      employeeCodeCanonical: `IV_${run}_${n}`,
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
                data: {
                  employeeUserId: user.id,
                  branchId: grants[0]?.branchId ?? branch.id,
                  grantedByUserId: user.id,
                },
              });
              for (const grant of grants) {
                await tx.userRoleAssignment.create({
                  data: {
                    userId: user.id,
                    roleId: grant.roleId,
                    scopeKind: 'BRANCH',
                    branchId: grant.branchId,
                  },
                });
              }
              return {
                id: user.id,
                token: await login(user, options.reauthenticated ?? false),
                raw: user,
              };
            };
            const at = (roleId: string, branchId = branch.id) => [{ roleId, branchId }];
            // `cashier` only prepares invoices (open / price / finalize); it can NOT collect money.
            const cashier = await staffUser(at(roles.prepare.id));
            const collector = await staffUser(at(roles.collect.id)); // COLLECT_PAYMENTS only (OP-6)
            const collectorB = await staffUser(at(roles.collectView.id));
            const viewer = await staffUser(at(roles.view.id));
            const manageOnly = await staffUser(at(roles.manage.id));
            const corrector = await staffUser(at(roles.correct.id), { reauthenticated: true });
            const canceller = await staffUser(at(roles.cancel.id), { reauthenticated: true });
            const boss = await staffUser(at(roles.boss.id), { reauthenticated: true });
            const outsider = await staffUser(
              [
                { roleId: roles.boss.id, branchId: elsewhere.id },
                { roleId: roles.collect.id, branchId: elsewhere.id },
              ],
              { reauthenticated: true },
            );
            const nobody = await staffUser([]);
            const ktv = await staffUser([]);
            const customer = async (label: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status,
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `iv-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `iv-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: status === 'ACTIVE' ? '$argon2id$fixture' : null,
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
              return { ...user, token: status === 'ACTIVE' ? await login(user) : '' };
            };
            const owner = await customer('owner');

            // ---------------------------------------------------------- visit fixtures
            let slot = 0;
            const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
            const slotStart = () => new Date(LOCAL_MIDNIGHT + (6 * 60 + 10 * slot++) * 60_000);
            const snapshotOf = (service: Service) => ({
              serviceCode: service.code,
              serviceNameVi: service.nameVi,
              serviceNameEn: service.nameEn,
              catalogPriceMinVnd: service.priceVnd,
              catalogPriceMaxVnd: service.priceMaxVnd,
              catalogPricingUnit: service.pricingUnit,
              maxQuantitySnapshot: service.maxQuantity,
            });
            interface Visit {
              id: string;
              code: string;
              participantId: string;
              done: { id: string; service: Service }[];
              cancelled: string[];
            }
            /** A COMPLETED visit whose services were performed (DONE) plus optional cancelled lines. */
            const completedVisit = async (
              services: Service[],
              options: { cancelled?: number; ownerUserId?: string; branchId?: string } = {},
            ): Promise<Visit> => {
              n++;
              const visit = await tx.visit.create({
                data: {
                  code: `VS-IV-${run}-${n}`,
                  branchId: options.branchId ?? branch.id,
                  origin: 'WALK_IN',
                  ownerUserId: options.ownerUserId ?? null,
                  serviceDate: new Date('2027-03-01T00:00:00.000Z'),
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: cashier.id,
                  idempotencyKey: randomUUID(),
                },
              });
              const participant = await tx.visitParticipant.create({
                data: { visitId: visit.id, kind: 'GUEST', displayName: 'Khách lẻ' },
              });
              let sequence = 0;
              const line = async (service: Service) => {
                sequence += 1;
                const start = slotStart();
                return tx.visitServiceLine.create({
                  data: {
                    visitId: visit.id,
                    participantId: participant.id,
                    sequence,
                    serviceId: service.id,
                    employeeUserId: ktv.id,
                    assignmentMode: 'ANY',
                    plannedStartAt: start,
                    plannedEndAt: new Date(start.getTime() + 10 * 60_000),
                    durationMinutes: 10,
                    bufferMinutes: 0,
                    ...snapshotOf(service),
                  },
                });
              };
              const done: Visit['done'] = [];
              const cancelled: string[] = [];
              for (const service of services) done.push({ id: (await line(service)).id, service });
              for (let index = 0; index < (options.cancelled ?? 0); index += 1) {
                const extra = await line(services[0]!);
                await tx.visitServiceLine.update({
                  where: { id: extra.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: new Date('2027-03-01T05:45:00+07:00'),
                    cancelledByUserId: cashier.id,
                    cancelReason: 'Khách đổi ý',
                    rowVersion: { increment: 1 },
                  },
                });
                cancelled.push(extra.id);
              }
              for (const [index, entry] of done.entries()) {
                const started = new Date('2027-03-01T06:00:00+07:00');
                await tx.visitServiceLine.update({
                  where: { id: entry.id },
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
                    visitServiceLineId: entry.id,
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
                  where: { id: entry.id },
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
              return {
                id: visit.id,
                code: visit.code,
                participantId: participant.id,
                done,
                cancelled,
              };
            };
            const draft = async (
              visit: Visit,
              actor: Person = cashier,
            ): Promise<InvoiceResponse> => {
              const opened = await ok(() => invoices.open(actor.token, visit.id));
              return opened.invoice;
            };
            const audits = (entityId: string, action?: string) =>
              tx.auditEvent.findMany({
                where: { entityId, ...(action ? { action } : {}) },
                orderBy: { occurredAt: 'asc' },
              });
            const events = (id: string) =>
              tx.outboxEvent.findMany({
                where: { aggregateId: id, aggregateType: 'Invoice' },
                orderBy: { occurredAt: 'asc' },
              });
            /** Prices every line at its minimum (PER_NAIL quantity 1) so the draft can be finalized. */
            const priceAll = async (invoice: InvoiceResponse, actor: Person = cashier) => {
              let current = invoice;
              for (const line of current.lines) {
                if (line.unitPriceVnd !== null && line.quantity !== null) continue;
                current = await ok(() =>
                  invoices.setPrice(actor.token, current.id, line.id, {
                    expectedVersion: current.version,
                    ...(line.unitPriceVnd === null ? { unitPriceVnd: line.priceMinVnd } : {}),
                    ...(line.quantity === null ? { quantity: 1 } : {}),
                  }),
                );
              }
              return current;
            };

            // ------------------------------------------------------------------ payment helpers
            const key = () => randomUUID();
            const pay = (
              actor: Person,
              invoiceId: string,
              amount: number | string,
              tendered: number | string = amount,
              idempotencyKey: string = key(),
              method: unknown = 'CASH',
            ): Promise<PaymentResultResponse> =>
              invoices.recordPayment(actor.token, invoiceId, {
                method: method as 'CASH',
                amountVnd: String(amount),
                tenderedVnd: String(tendered),
                idempotencyKey,
              });
            const reverse = (
              actor: Person,
              invoiceId: string,
              paymentId: string,
              reason = 'Nhập nhầm',
            ) => invoices.reversePayment(actor.token, invoiceId, paymentId, { reason });
            const cancelInvoice = (
              actor: Person,
              invoiceId: string,
              version: number,
              reason = 'Sai',
            ) => invoices.cancel(actor.token, invoiceId, { expectedVersion: version, reason });
            /** A FINALIZED, unpaid invoice (PENDING_PAYMENT). [exact, ranged@min] totals 300,000; [exact] 200,000. */
            const pending = async (services: Service[] = [exact, ranged]) => {
              const visit = await completedVisit(services, { ownerUserId: owner.id });
              const priced = await priceAll(await draft(visit));
              const finalized = await ok(() =>
                invoices.finalize(cashier.token, priced.id, { expectedVersion: priced.version }),
              );
              assert.equal(finalized.status, 'PENDING_PAYMENT');
              return finalized;
            };
            const stored = (id: string) =>
              tx.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
            const paymentEvents = (paymentId: string) =>
              tx.outboxEvent.findMany({
                where: { aggregateId: paymentId, aggregateType: 'Payment' },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
            const invoiceEvents = async (id: string, eventType: string) =>
              (await events(id)).filter((event) => event.eventType === eventType);
            const localDate = (instant: Date) =>
              new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(instant);

            // ------------------------------------------------------------------ PayOS helpers
            const payos = (
              actor: Person,
              invoiceId: string,
              amount: number | string,
              idempotencyKey: string = key(),
              service: InvoiceService = invoices,
            ): Promise<PaymentResultResponse> =>
              service.createPayos(actor.token, invoiceId, {
                amountVnd: String(amount),
                idempotencyKey,
              });
            const cancelRequest = (actor: Person, invoiceId: string, paymentId: string) =>
              invoices.cancelPayos(actor.token, invoiceId, paymentId);
            const refreshRequest = (actor: Person, invoiceId: string, paymentId: string) =>
              invoices.refreshPayos(actor.token, invoiceId, paymentId);
            const orderOf = async (paymentId: string) =>
              Number(
                (await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }))
                  .providerOrderCode,
              );
            const paymentRow = (id: string) => tx.payment.findUniqueOrThrow({ where: { id } });
            const invoiceRow = (id: string) => tx.invoice.findUniqueOrThrow({ where: { id } });
            /** Delivers a notification through the real webhook service (signature checked first). */
            const deliver = async (body: unknown) => {
              const outcome = await webhook.receive(body);
              await settle();
              return outcome;
            };
            /**
             * Ends the request's lifetime. Triggers are lifted only for this one fixture statement (the same
             * local-superuser technique the race suites use), inside the rolled-back outer transaction.
             */
            const expireNow = async (paymentId: string) => {
              await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
              await tx.$executeRawUnsafe(
                `UPDATE payments SET expires_at = clock_timestamp() - interval '1 minute' WHERE id = '${paymentId}'::uuid`,
              );
              await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
            };
            const sweep = (later = 5 * 60_000) =>
              reconcilePendingPayments(sweepDatabase, simulator.provider, {
                now: new Date(Date.now() + later),
              });
            const inbox = (orderCode: number) =>
              tx.paymentProviderEvent.findMany({
                where: { orderCode: BigInt(orderCode) },
                orderBy: { receivedAt: 'asc' },
              });
            const anomaliesOf = (invoiceId: string) =>
              tx.paymentAnomaly.findMany({ where: { invoiceId }, orderBy: { openedAt: 'asc' } });
            const attemptsOf = async (paymentId: string) =>
              (
                await tx.paymentAttempt.findMany({
                  where: { paymentId },
                  orderBy: { occurredAt: 'asc' },
                })
              ).map((attempt) => `${attempt.kind}:${attempt.outcome}`);
            const paymentAudits = (invoiceId: string, action: string) => audits(invoiceId, action);

            // ================================================== create: authority, rules, idempotency
            await suite.test(
              'PayOS create: COLLECT_PAYMENTS in scope only, part of the balance, one pending, 15 minutes, idempotent',
              async () => {
                const invoice = await pending([exact]);
                assert.equal(invoice.totalVnd, '200000');
                for (const actor of [
                  nobody,
                  ktv,
                  viewer,
                  manageOnly,
                  cashier,
                  canceller,
                  corrector,
                  outsider,
                ]) {
                  await fails(() => payos(actor, invoice.id, 100_000), 'FORBIDDEN');
                }
                await fails(() => payos(owner, invoice.id, 100_000), 'FORBIDDEN');
                await fails(() => payos(collector, randomUUID(), 100_000), 'NOT_FOUND');
                const drafted = await draft(await completedVisit([exact]));
                await fails(() => payos(collector, drafted.id, 100_000), 'INVOICE_STATE_INVALID');
                await fails(() => payos(collector, invoice.id, 0), 'VALIDATION_FAILED');
                await fails(() => payos(collector, invoice.id, '-5'), 'VALIDATION_FAILED');
                await fails(() => payos(collector, invoice.id, 200_001), 'PAYMENT_AMOUNT_INVALID');
                await fails(
                  () => payos(collector, invoice.id, 100_000, 'not-a-uuid'),
                  'VALIDATION_FAILED',
                );
                // Disabled without configuration: a clear error and nothing is written.
                await fails(
                  () => payos(collector, invoice.id, 100_000, key(), unconfigured),
                  'PAYMENT_METHOD_UNAVAILABLE',
                );
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
                assert.deepEqual(
                  simulator.calls,
                  [],
                  'a refused command never reaches the provider',
                );

                const before = Date.now();
                const idempotencyKey = key();
                const made = await ok(() => payos(collector, invoice.id, 120_000, idempotencyKey));
                assert.equal(made.payment.method, 'PAYOS');
                assert.equal(made.payment.status, 'PENDING');
                assert.equal(made.payment.amountVnd, '120000');
                assert.equal(made.payment.amountDueVnd, '200000');
                assert.equal(made.payment.tenderedVnd, '120000');
                assert.equal(made.payment.changeVnd, '0');
                assert.equal(made.payment.effective, false);
                assert.equal(made.payment.reversible, false);
                assert.equal(made.payment.cancellable, true);
                assert.ok(made.payment.provider);
                assert.match(made.payment.provider.checkoutUrl ?? '', /^https:\/\//);
                assert.ok(made.payment.provider.qrCode);
                assert.equal(made.payment.provider.reference, null);
                assert.equal(made.payment.provider.late, false);
                const lifetime = Date.parse(made.payment.provider.expiresAt) - before;
                assert.ok(
                  lifetime > 14 * 60_000 && lifetime <= 15 * 60_000 + 60_000,
                  `expires 15 minutes after creation, got ${lifetime}`,
                );
                // A pending request credits nothing.
                assert.equal(made.invoice.status, 'PENDING_PAYMENT');
                assert.equal(made.invoice.paidVnd, '0');
                assert.equal(made.invoice.balanceVnd, '200000');
                assert.deepEqual(simulator.calls, ['POST /v2/payment-requests']);
                const order = simulator.orders.get(await orderOf(made.payment.id));
                assert.ok(order);
                assert.equal(order.amount, 120_000);
                assert.equal(order.description, 'LUCYSPA');
                const [requested] = await paymentAudits(invoice.id, 'PAYMENT_PROVIDER_REQUESTED');
                assert.ok(requested);
                assert.equal(requested.dataClassification, 'FINANCIAL');
                assert.equal(requested.actorKind, 'USER');
                assert.equal(requested.actorUserId, collector.id);

                // Idempotent: the same key returns the stored request and never calls the provider again.
                const replay = await ok(() =>
                  payos(collector, invoice.id, 120_000, idempotencyKey),
                );
                assert.equal(replay.payment.id, made.payment.id);
                assert.equal(simulator.calls.length, 1);
                await fails(() => payos(collector, invoice.id, 90_000, idempotencyKey), 'CONFLICT');
                await fails(
                  () => pay(collector, invoice.id, 1_000, 1_000, idempotencyKey),
                  'CONFLICT',
                );

                // Who sees the payment instrument: only an actor who may collect.
                const viewed = await invoices.get(viewer.token, invoice.id);
                assert.equal(viewed.payments[0]!.provider?.checkoutUrl, null);
                assert.equal(viewed.payments[0]!.provider?.qrCode, null);
                assert.equal(viewed.payments[0]!.cancellable, false);
                const collected = await invoices.get(collectorB.token, invoice.id);
                assert.ok(collected.payments[0]!.provider?.checkoutUrl);
                assert.equal(collected.pendingProviderVnd, '120000');
                assert.equal(collected.actions.collectPayos, true);
                assert.equal(
                  (await invoices.get(boss.token, invoice.id)).actions.cancel,
                  false,
                  'a live request blocks cancelling the invoice',
                );

                // At most one pending request per invoice; the invoice cannot be cancelled meanwhile.
                await fails(() => payos(collector, invoice.id, 50_000), 'PAYMENT_PROVIDER_PENDING');
                await fails(
                  () => cancelInvoice(canceller, invoice.id, invoice.version),
                  'PAYMENT_PROVIDER_PENDING',
                );
                // A live request holds its share of the balance: cash may take only the rest.
                await fails(() => pay(collector, invoice.id, 100_000), 'PAYMENT_PROVIDER_PENDING');
                const rest = await ok(() => pay(collector, invoice.id, 80_000));
                assert.equal(rest.invoice.status, 'PENDING_PAYMENT');
                assert.equal(rest.invoice.balanceVnd, '120000');
              },
            );

            // ============================================== confirmation by webhook (Q7 items 5, 7, 9)
            await suite.test(
              'PayOS webhook: verified confirmation settles a split with cash exactly once; staff cannot',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 120_000));
                await ok(() => pay(collector, invoice.id, 80_000));
                const orderCode = await orderOf(made.payment.id);

                // There is no staff path to "received": recording PAYOS directly is refused.
                await fails(
                  () => pay(collector, invoice.id, 1_000, 1_000, key(), 'PAYOS'),
                  'PAYMENT_METHOD_UNAVAILABLE',
                );
                const paidOnProvider = simulator.pay(orderCode, { reference: 'TF-A-1' });
                // Still pending in Lucy Spa until the authentic notification arrives.
                assert.equal((await paymentRow(made.payment.id)).status, 'PENDING');

                assert.deepEqual(await deliver(paidOnProvider), { received: true });
                const confirmed = await paymentRow(made.payment.id);
                assert.equal(confirmed.status, 'SUCCEEDED');
                assert.equal(confirmed.providerReference, 'TF-A-1');
                assert.equal(confirmed.amountVnd, 120_000n);
                assert.equal(confirmed.lateOfPaymentId, null);
                assert.ok(Math.abs(confirmed.collectedAt.getTime() - Date.now()) < 60_000);
                assert.equal(
                  confirmed.businessDate.toISOString().slice(0, 10),
                  localDate(confirmed.collectedAt),
                );
                const settled = await invoiceRow(invoice.id);
                assert.equal(settled.status, 'PAID');
                assert.equal(settled.paidSeq, 1);
                assert.equal(settled.paidAt!.getTime(), confirmed.collectedAt.getTime());

                const [confirmation] = await paymentAudits(
                  invoice.id,
                  'PAYMENT_PROVIDER_CONFIRMED',
                );
                assert.ok(confirmation);
                assert.equal(confirmation.actorKind, 'SYSTEM');
                assert.equal(confirmation.actorUserId, null);
                assert.equal(confirmation.dataClassification, 'FINANCIAL');
                assert.deepEqual(confirmation.after, {
                  paymentId: made.payment.id,
                  method: 'PAYOS',
                  orderCode: String(orderCode),
                  providerReference: 'TF-A-1',
                  amountVnd: '120000',
                  amountDueVnd: '120000',
                  late: false,
                  source: 'WEBHOOK',
                  paidVnd: '200000',
                  balanceVnd: '0',
                  status: 'PAID',
                });
                assert.equal((await paymentAudits(invoice.id, 'INVOICE_PAID')).length, 1);
                const [succeeded] = await paymentEvents(made.payment.id);
                assert.ok(succeeded);
                assert.equal(succeeded.eventType, 'PAYMENT_SUCCEEDED');
                assert.equal(Reflect.get(succeeded.payload as object, 'method'), 'PAYOS');
                assert.equal((await invoiceEvents(invoice.id, 'INVOICE_PAID')).length, 1);
                const [entry] = await inbox(orderCode);
                assert.ok(entry);
                assert.equal(entry.outcome, 'APPLIED');
                assert.equal(entry.outcomeDetail, 'APPLIED');
                assert.equal(entry.signatureValid, true);
                assert.equal(JSON.stringify(entry.rawPayload).includes('counterAccount'), false);
                assert.equal(JSON.stringify(entry.rawPayload).includes('Payer Name'), false);

                // A replay (PayOS retries) changes nothing: no second credit, audit, event or inbox row.
                await deliver(paidOnProvider);
                await deliver(paidOnProvider);
                assert.equal((await inbox(orderCode)).length, 1);
                assert.equal(
                  (await paymentAudits(invoice.id, 'PAYMENT_PROVIDER_CONFIRMED')).length,
                  1,
                );
                assert.equal((await paymentEvents(made.payment.id)).length, 1);
                assert.equal(
                  (await stored(invoice.id)).payments.filter(
                    (entry) => entry.status === 'SUCCEEDED',
                  ).length,
                  2,
                );

                // A confirmed PayOS payment is never reversed in Lucy Spa (Q6).
                await fails(
                  () => reverse(corrector, invoice.id, made.payment.id),
                  'PAYMENT_STATE_INVALID',
                );
                await assert.rejects(
                  isolated(() =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO payment_corrections (payment_id, reason, actor_user_id) VALUES ('${made.payment.id}'::uuid, 'x', '${corrector.id}'::uuid)`,
                    ),
                  ),
                  (error: unknown) => error instanceof Error,
                );
                // ... and a paid invoice with a PayOS payment cannot be cancelled either.
                await fails(
                  () => cancelInvoice(canceller, invoice.id, settled.rowVersion),
                  'INVOICE_CANCEL_NOT_ALLOWED',
                );
              },
            );

            await suite.test(
              'PayOS full amount: one confirmed request pays the invoice',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                await deliver(simulator.pay(await orderOf(made.payment.id)));
                const row = await stored(invoice.id);
                assert.equal(row.status, 'PAID');
                assert.equal(row.payments.length, 1);
                const view = await invoices.get(boss.token, invoice.id);
                assert.equal(view.status, 'PAID');
                assert.equal(view.paidVnd, '200000');
                assert.equal(view.payments[0]!.provider?.reference !== null, true);
                assert.equal(view.payments[0]!.effective, true);
                assert.equal(
                  view.payments[0]!.provider?.checkoutUrl,
                  null,
                  'no instrument once paid',
                );
              },
            );

            // ================================================ amount mismatch and anomalies (Q7 item 6)
            await suite.test(
              'PayOS amount mismatch never marks paid: the request fails, an anomaly is flagged for management',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const orderCode = await orderOf(made.payment.id);
                await deliver(simulator.pay(orderCode, { amount: 150_000, reference: 'TF-M-1' }));

                assert.equal((await paymentRow(made.payment.id)).status, 'FAILED');
                const unchanged = await invoiceRow(invoice.id);
                assert.equal(unchanged.status, 'PENDING_PAYMENT');
                assert.equal(unchanged.paidSeq, 0);
                const [anomaly] = await anomaliesOf(invoice.id);
                assert.ok(anomaly);
                assert.equal(anomaly.kind, 'AMOUNT_MISMATCH');
                assert.equal(anomaly.status, 'OPEN');
                assert.equal(anomaly.expectedAmountVnd, 200_000n);
                assert.equal(anomaly.receivedAmountVnd, 150_000n);
                assert.equal(anomaly.branchId, branch.id);
                const [inboxed] = await inbox(orderCode);
                assert.equal(inboxed!.outcome, 'ANOMALY');
                assert.equal(inboxed!.outcomeDetail, 'AMOUNT_MISMATCH');
                assert.equal(anomaly.providerEventId, inboxed!.id);
                const [flagged] = await paymentAudits(invoice.id, 'PAYMENT_ANOMALY_FLAGGED');
                assert.ok(flagged);
                assert.equal(flagged.actorKind, 'SYSTEM');
                assert.equal(flagged.dataClassification, 'FINANCIAL');
                assert.equal(
                  (await paymentEvents(made.payment.id)).filter(
                    (event) => event.eventType === 'PAYMENT_ANOMALY_FLAGGED',
                  ).length,
                  1,
                );
                // Replays never open a second anomaly.
                await deliver(
                  simulator.webhook({ orderCode, amount: 150_000, reference: 'TF-M-1' }),
                );
                assert.equal((await anomaliesOf(invoice.id)).length, 1);

                // Management sees it (CORRECT_PAYMENTS); collectors and viewers do not.
                const seen = await invoices.get(corrector.token, invoice.id);
                assert.equal(seen.anomalies.length, 1);
                assert.equal(seen.anomalies[0]!.kind, 'AMOUNT_MISMATCH');
                assert.equal(seen.actions.manageAnomalies, true);
                assert.deepEqual((await invoices.get(collectorB.token, invoice.id)).anomalies, []);
                assert.deepEqual((await invoices.get(viewer.token, invoice.id)).anomalies, []);
                const listed = await invoices.anomalies(corrector.token, branch.id, 'OPEN');
                assert.ok(listed.anomalies.some((entry) => entry.id === anomaly.id));
                assert.equal(
                  listed.anomalies.find((entry) => entry.id === anomaly.id)!.invoice.code,
                  invoice.code,
                );
                await fails(
                  () => invoices.anomalies(collector.token, branch.id, 'OPEN'),
                  'FORBIDDEN',
                );
                await fails(
                  () => invoices.anomalies(outsider.token, branch.id, undefined),
                  'FORBIDDEN',
                );
                await fails(
                  () => invoices.anomalies(corrector.token, branch.id, 'BOGUS'),
                  'VALIDATION_FAILED',
                );

                // The failed request no longer blocks: staff can ask again.
                const again = await ok(() => payos(collector, invoice.id, 200_000));
                assert.equal(again.payment.status, 'PENDING');

                // Review records that management looked; it moves no money and changes nothing else.
                await fails(
                  () => invoices.reviewAnomaly(collector.token, anomaly.id, { note: 'x' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => invoices.reviewAnomaly(corrector.token, anomaly.id, { note: '  ' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => invoices.reviewAnomaly(corrector.token, randomUUID(), { note: 'x' }),
                  'NOT_FOUND',
                );
                const reviewed = await ok(() =>
                  invoices.reviewAnomaly(corrector.token, anomaly.id, { note: 'Đã liên hệ khách' }),
                );
                assert.equal(reviewed.status, 'REVIEWED');
                assert.equal(reviewed.reviewedBy?.id, corrector.id);
                assert.equal(reviewed.reviewNote, 'Đã liên hệ khách');
                await fails(
                  () => invoices.reviewAnomaly(corrector.token, anomaly.id, { note: 'again' }),
                  'PAYMENT_ANOMALY_REVIEWED',
                );
                const [reviewAudit] = await paymentAudits(invoice.id, 'PAYMENT_ANOMALY_REVIEWED');
                assert.ok(reviewAudit);
                assert.equal(reviewAudit.actorUserId, corrector.id);
                assert.equal(reviewAudit.dataClassification, 'FINANCIAL');
                assert.equal((await invoiceRow(invoice.id)).status, 'PENDING_PAYMENT');
                for (const statement of [
                  `UPDATE payment_anomalies SET received_amount_vnd = 1 WHERE id = '${anomaly.id}'::uuid`,
                  `UPDATE payment_anomalies SET status = 'OPEN', reviewed_by_user_id = NULL, reviewed_at = NULL, review_note = NULL, row_version = row_version + 1 WHERE id = '${anomaly.id}'::uuid`,
                  `DELETE FROM payment_anomalies WHERE id = '${anomaly.id}'::uuid`,
                ]) {
                  await assert.rejects(
                    isolated(() => tx.$executeRawUnsafe(statement)),
                    (error: unknown) => error instanceof Error,
                    statement,
                  );
                }
              },
            );

            await suite.test(
              'PayOS confirmation for an already fully paid invoice is never auto-applied: anomaly (Q7 item 5)',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const orderCode = await orderOf(made.payment.id);
                // The customer changes their mind: staff cancel the QR and take cash for everything.
                const cancelled = await ok(() =>
                  cancelRequest(collector, invoice.id, made.payment.id),
                );
                assert.equal(cancelled.payment.status, 'CANCELLED');
                await ok(() => pay(collector, invoice.id, 200_000));
                assert.equal((await invoiceRow(invoice.id)).status, 'PAID');
                // ... but the transfer had already been made: the confirmation arrives afterwards.
                await deliver(simulator.pay(orderCode, { reference: 'TF-P-1' }));
                const row = await stored(invoice.id);
                assert.equal(row.status, 'PAID');
                assert.equal(row.paidSeq, 1);
                assert.equal(
                  row.payments.filter((payment) => payment.status === 'SUCCEEDED').length,
                  1,
                  'nothing is credited twice',
                );
                assert.equal((await paymentRow(made.payment.id)).status, 'CANCELLED');
                const [anomaly] = await anomaliesOf(invoice.id);
                assert.equal(anomaly!.kind, 'INVOICE_NOT_PAYABLE');
                assert.equal(anomaly!.invoiceStatus, 'PAID');
                assert.equal(anomaly!.status, 'OPEN');
                assert.equal((await inbox(orderCode))[0]!.outcomeDetail, 'INVOICE_NOT_PAYABLE');
              },
            );

            await suite.test(
              'PayOS confirmation larger than the remaining balance is flagged, not applied',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const orderCode = await orderOf(made.payment.id);
                await ok(() => cancelRequest(collector, invoice.id, made.payment.id));
                await ok(() => pay(collector, invoice.id, 150_000));
                await deliver(simulator.pay(orderCode, { reference: 'TF-X-1' }));
                const row = await stored(invoice.id);
                assert.equal(row.status, 'PENDING_PAYMENT');
                const [anomaly] = await anomaliesOf(invoice.id);
                assert.equal(anomaly!.kind, 'EXCEEDS_BALANCE');
                assert.equal(anomaly!.receivedAmountVnd, 200_000n);
              },
            );

            // ==================================================== late confirmation (Q7 item 5)
            await suite.test(
              'PayOS confirmation after expiry is recorded as a new succeeded payment when a balance remains',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const orderCode = await orderOf(made.payment.id);
                await expireNow(made.payment.id);
                // On-demand re-check: PayOS still says PENDING, but our 15 minutes are over -> EXPIRED.
                const refreshed = await ok(() =>
                  refreshRequest(collector, invoice.id, made.payment.id),
                );
                assert.equal(refreshed.payment.status, 'EXPIRED');
                assert.equal(refreshed.payment.provider?.checkoutUrl, null);
                assert.equal(
                  (await paymentEvents(made.payment.id)).filter(
                    (event) => event.eventType === 'PAYMENT_EXPIRED',
                  ).length,
                  1,
                );
                // The transfer still arrives (a bank was slow): the balance remains -> recorded.
                await deliver(simulator.pay(orderCode, { reference: 'TF-L-1' }));
                const row = await stored(invoice.id);
                assert.equal(row.status, 'PAID');
                const original = row.payments.find((payment) => payment.id === made.payment.id)!;
                assert.equal(original.status, 'EXPIRED');
                const late = row.payments.find(
                  (payment) => payment.lateOfPaymentId === original.id,
                )!;
                assert.equal(late.status, 'SUCCEEDED');
                assert.equal(late.providerReference, 'TF-L-1');
                assert.equal(late.amountVnd, 200_000n);
                assert.equal(late.providerOrderCode, original.providerOrderCode);
                const [confirmation] = await paymentAudits(
                  invoice.id,
                  'PAYMENT_PROVIDER_CONFIRMED',
                );
                assert.equal(Reflect.get(confirmation!.after as object, 'late'), true);
                assert.equal((await inbox(orderCode))[0]!.outcomeDetail, 'APPLIED_LATE');
                const view = await invoices.get(boss.token, invoice.id);
                assert.equal(
                  view.payments.find((payment) => payment.id === late.id)!.provider?.late,
                  true,
                );
                await deliver(
                  simulator.webhook({ orderCode, amount: 200_000, reference: 'TF-L-1' }),
                );
                assert.equal(
                  (await stored(invoice.id)).payments.length,
                  2,
                  'a replay adds nothing',
                );
              },
            );

            await suite.test(
              'PayOS request cancelled by staff: a later confirmation is recorded and leaves the remaining balance',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 100_000));
                const orderCode = await orderOf(made.payment.id);
                for (const actor of [viewer, outsider, cashier, nobody]) {
                  await fails(() => cancelRequest(actor, invoice.id, made.payment.id), 'FORBIDDEN');
                }
                const cancelled = await ok(() =>
                  cancelRequest(collector, invoice.id, made.payment.id),
                );
                assert.equal(cancelled.payment.status, 'CANCELLED');
                assert.equal(simulator.orders.get(orderCode)!.status, 'CANCELLED');
                const [cancelAudit] = await paymentAudits(invoice.id, 'PAYMENT_PROVIDER_CANCELLED');
                assert.equal(cancelAudit!.actorUserId, collector.id);
                assert.equal(cancelAudit!.dataClassification, 'FINANCIAL');
                assert.deepEqual(await attemptsOf(made.payment.id), [
                  'CREATE:OK',
                  'CANCEL:OK',
                  'STATUS_READ:OK',
                ]);
                // Cancelling again is a quiet no-op.
                const twice = await ok(() => cancelRequest(collector, invoice.id, made.payment.id));
                assert.equal(twice.payment.status, 'CANCELLED');
                assert.equal(
                  (await paymentAudits(invoice.id, 'PAYMENT_PROVIDER_CANCELLED')).length,
                  1,
                );
                // Staff can now create a new request (Q7 item 3), and the invoice can be cancelled again later.
                const next = await ok(() => payos(collector, invoice.id, 60_000));
                assert.equal(next.payment.status, 'PENDING');
                await ok(() => cancelRequest(collector, invoice.id, next.payment.id));

                // The customer had paid the cancelled QR after all.
                simulator.orders.get(orderCode)!.status = 'PENDING';
                await deliver(simulator.pay(orderCode, { reference: 'TF-C-1' }));
                const row = await stored(invoice.id);
                assert.equal(row.status, 'PENDING_PAYMENT');
                assert.equal(
                  row.payments.filter((payment) => payment.status === 'SUCCEEDED').length,
                  1,
                );
                const view = await invoices.get(boss.token, invoice.id);
                assert.equal(view.paidVnd, '100000');
                assert.equal(view.balanceVnd, '100000');
              },
            );

            await suite.test(
              'PayOS cancel when the customer already paid: the confirmation wins, money is never lost',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const orderCode = await orderOf(made.payment.id);
                simulator.pay(orderCode, { reference: 'TF-R-1' }); // webhook not delivered (yet)
                const result = await ok(() =>
                  cancelRequest(collector, invoice.id, made.payment.id),
                );
                assert.equal(result.payment.status, 'SUCCEEDED');
                assert.equal(result.invoice.status, 'PAID');
                const [entry] = await paymentAudits(invoice.id, 'PAYMENT_PROVIDER_CONFIRMED');
                assert.equal(Reflect.get(entry!.after as object, 'source'), 'STATUS_READ');
                assert.equal(entry!.actorUserId, collector.id);
                // The webhook that arrives afterwards is a harmless duplicate.
                await deliver(
                  simulator.webhook({ orderCode, amount: 200_000, reference: 'TF-R-1' }),
                );
                assert.equal((await stored(invoice.id)).payments.length, 1);
                assert.equal((await inbox(orderCode))[0]!.outcome, 'IGNORED');
                assert.equal((await inbox(orderCode))[0]!.outcomeDetail, 'ALREADY_APPLIED');
              },
            );

            await suite.test('PayOS on-demand refresh applies a missed confirmation', async () => {
              const invoice = await pending([exact]);
              const made = await ok(() => payos(collector, invoice.id, 200_000));
              const orderCode = await orderOf(made.payment.id);
              await fails(() => refreshRequest(viewer, invoice.id, made.payment.id), 'FORBIDDEN');
              const pendingRead = await ok(() =>
                refreshRequest(collector, invoice.id, made.payment.id),
              );
              assert.equal(pendingRead.payment.status, 'PENDING');
              simulator.pay(orderCode, { reference: 'TF-F-1' });
              const applied = await ok(() =>
                refreshRequest(collector, invoice.id, made.payment.id),
              );
              assert.equal(applied.payment.status, 'SUCCEEDED');
              assert.equal(applied.invoice.status, 'PAID');
              // Refreshing a finished request changes nothing.
              const again = await ok(() => refreshRequest(collector, invoice.id, made.payment.id));
              assert.equal(again.payment.status, 'SUCCEEDED');
              assert.equal(
                (await paymentAudits(invoice.id, 'PAYMENT_PROVIDER_CONFIRMED')).length,
                1,
              );
              // Provider expired it: the local request ends without money.
              const other = await pending([exact]);
              const second = await ok(() => payos(collector, other.id, 200_000));
              simulator.expire(await orderOf(second.payment.id));
              const ended = await ok(() => refreshRequest(collector, other.id, second.payment.id));
              assert.equal(ended.payment.status, 'EXPIRED');
              assert.equal((await invoiceRow(other.id)).status, 'PENDING_PAYMENT');
            });

            // ================================================================= provider failures
            await suite.test(
              'PayOS provider failures: refusal fails the request, unreachable leaves it for staff or the sweep',
              async () => {
                const invoice = await pending([exact]);
                simulator.fail('create', 'REJECT');
                await fails(
                  () => payos(collector, invoice.id, 100_000),
                  'PAYMENT_PROVIDER_REJECTED',
                );
                const [failed] = (await stored(invoice.id)).payments;
                assert.equal(failed!.status, 'FAILED');
                assert.deepEqual(await attemptsOf(failed!.id), ['CREATE:REJECTED']);
                assert.equal(
                  (await paymentEvents(failed!.id)).filter(
                    (event) => event.eventType === 'PAYMENT_FAILED',
                  ).length,
                  1,
                );
                assert.equal((await invoiceRow(invoice.id)).status, 'PENDING_PAYMENT');

                // Unreachable: outcome unknown -> PENDING without a link, blocks another request until settled.
                simulator.fail('create', 'UNREACHABLE');
                await fails(
                  () => payos(collector, invoice.id, 100_000),
                  'PAYMENT_PROVIDER_UNAVAILABLE',
                );
                const linkless = (await stored(invoice.id)).payments.find(
                  (payment) => payment.status === 'PENDING',
                )!;
                assert.equal(linkless.checkoutUrl, null);
                assert.deepEqual(await attemptsOf(linkless.id), ['CREATE:UNREACHABLE']);
                await fails(
                  () => payos(collector, invoice.id, 100_000),
                  'PAYMENT_PROVIDER_PENDING',
                );
                // Staff cancel it: PayOS does not know the order, so it ends locally without money.
                const cleared = await ok(() => cancelRequest(collector, invoice.id, linkless.id));
                assert.equal(cleared.payment.status, 'FAILED');
                await ok(() => payos(collector, invoice.id, 100_000));

                // Cancel while PayOS is unreachable: nothing changes, staff retry.
                const live = (await stored(invoice.id)).payments.find(
                  (payment) => payment.status === 'PENDING',
                )!;
                simulator.fail('cancel', 'UNREACHABLE');
                await fails(
                  () => cancelRequest(collector, invoice.id, live.id),
                  'PAYMENT_PROVIDER_UNAVAILABLE',
                );
                assert.equal((await paymentRow(live.id)).status, 'PENDING');
                assert.ok((await attemptsOf(live.id)).includes('STATUS_READ:UNREACHABLE'));
                // A tampered answer is never trusted.
                simulator.fail('cancel', 'BAD_SIGNATURE');
                await fails(
                  () => cancelRequest(collector, invoice.id, live.id),
                  'PAYMENT_PROVIDER_UNAVAILABLE',
                );
                assert.equal((await paymentRow(live.id)).status, 'PENDING');
              },
            );

            await suite.test(
              'PayOS reconciliation sweep: missed webhook applied, expiry ended, never-linked requests closed',
              async () => {
                // A missed webhook.
                const paid = await pending([exact]);
                const madePaid = await ok(() => payos(collector, paid.id, 200_000));
                simulator.pay(await orderOf(madePaid.payment.id), { reference: 'TF-S-1' });
                // An expired request PayOS still shows pending.
                const stale = await pending([exact]);
                const madeStale = await ok(() => payos(collector, stale.id, 200_000));
                await expireNow(madeStale.payment.id);
                // A request the API never finished (provider created it, the answer was lost).
                const lost = await pending([exact]);
                simulator.fail('create', 'BAD_SIGNATURE');
                await fails(
                  () => payos(collector, lost.id, 200_000),
                  'PAYMENT_PROVIDER_UNAVAILABLE',
                );
                const lostRow = (await stored(lost.id)).payments[0]!;
                assert.equal(
                  simulator.orders.get(Number(lostRow.providerOrderCode))!.status,
                  'PENDING',
                );
                // A live request within its lifetime is left alone by a sweep that runs right away.
                const quiet = await pending([exact]);
                const madeQuiet = await ok(() => payos(collector, quiet.id, 200_000));
                const early = await sweep(0);
                assert.equal((await paymentRow(madeQuiet.payment.id)).status, 'PENDING');
                assert.equal(early.applied, 0);

                simulator.fail('read', 'UNREACHABLE', 10);
                const outage = await sweep();
                assert.ok(outage.unavailable >= 1);
                assert.equal(
                  (await paymentRow(madePaid.payment.id)).status,
                  'PENDING',
                  'an outage changes nothing',
                );
                simulator.fail('read', 'REJECT', 0);

                // Drain leftover injected faults, then run a normal sweep.
                for (let attempt = 0; attempt < 10; attempt += 1) await sweep();
                assert.equal((await paymentRow(madePaid.payment.id)).status, 'SUCCEEDED');
                assert.equal((await invoiceRow(paid.id)).status, 'PAID');
                assert.equal((await paymentRow(madeStale.payment.id)).status, 'EXPIRED');
                assert.equal((await invoiceRow(stale.id)).status, 'PENDING_PAYMENT');
                assert.equal((await paymentRow(lostRow.id)).status, 'CANCELLED');
                assert.equal(
                  simulator.orders.get(Number(lostRow.providerOrderCode))!.status,
                  'CANCELLED',
                );
                assert.equal((await paymentRow(madeQuiet.payment.id)).status, 'PENDING');
                const [confirmation] = await paymentAudits(paid.id, 'PAYMENT_PROVIDER_CONFIRMED');
                assert.equal(confirmation!.actorKind, 'SYSTEM');
                assert.equal(Reflect.get(confirmation!.after as object, 'source'), 'STATUS_READ');
                await settle();
              },
            );

            // ================================================================ webhook endpoint
            await suite.test(
              'PayOS webhook endpoint: signature first, constant refusals, throttled forgeries, unknown orders ignored',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const orderCode = await orderOf(made.payment.id);
                const good = simulator.webhook({ orderCode, amount: 200_000, reference: 'TF-W-1' });
                const data = good['data'] as Record<string, unknown>;
                const attempts = await stored(invoice.id);
                const forged = [
                  { ...good, signature: 'a'.repeat(64) },
                  { ...good, data: { ...data, amount: 1 } },
                  { ...good, data: { ...data, orderCode: orderCode + 1 } },
                  { ...good, signature: undefined },
                  { code: '00', success: true },
                  null,
                  'nope',
                  [],
                ];
                for (const body of forged)
                  await fails(() => webhook.receive(body), 'AUTHENTICATION_FAILED');
                // A signature made with another key (a forger who knows the format) is refused too.
                const other = createPayosSimulator({
                  ...simulator.config,
                  checksumKey: 'someone-else',
                });
                await fails(
                  () =>
                    webhook.receive(
                      other.webhook({ orderCode, amount: 200_000, reference: 'TF-W-2' }),
                    ),
                  'AUTHENTICATION_FAILED',
                );
                await fails(
                  () => webhook.receive({ ...good, padding: 'x'.repeat(20_000) }),
                  'VALIDATION_FAILED',
                );
                assert.equal((await stored(invoice.id)).payments.length, attempts.payments.length);
                assert.equal((await paymentRow(made.payment.id)).status, 'PENDING');
                assert.equal((await inbox(orderCode)).length, 0, 'nothing unauthentic is stored');
                assert.equal(
                  await tx.paymentProviderEvent.count({ where: { signatureValid: false } }),
                  0,
                );

                // Forgeries are throttled per minute, but an authentic delivery is never refused.
                const flood = new PayosWebhookService(
                  { client: { $transaction: (work: never) => isolated(work) } } as never,
                  simulator.provider,
                  null,
                );
                const codes: string[] = [];
                for (let index = 0; index < 70; index += 1) {
                  try {
                    await flood.receive({ ...good, signature: 'b'.repeat(64) });
                  } catch (error) {
                    codes.push(error instanceof AuthError ? error.code : 'other');
                  }
                }
                assert.equal(codes.filter((code) => code === 'AUTHENTICATION_FAILED').length, 60);
                assert.equal(codes.filter((code) => code === 'RATE_LIMITED').length, 10);
                assert.deepEqual(
                  await flood.receive(
                    simulator.webhook({ orderCode: 424242, amount: 1_000, reference: 'TF-W-3' }),
                  ),
                  { received: true },
                );

                // Unknown orders (PayOS's own registration test uses one) are recorded and ignored.
                const [unknown] = await inbox(424242);
                assert.equal(unknown!.outcome, 'IGNORED');
                assert.equal(unknown!.outcomeDetail, 'UNKNOWN_ORDER');
                assert.equal(unknown!.paymentId, null);
                // Not configured: the endpoint cannot verify anything and refuses.
                await fails(
                  () => new PayosWebhookService({ client: {} } as never, null, null).receive(good),
                  'SERVICE_UNAVAILABLE',
                );
                // An authentic but unsuccessful notification never credits anything.
                await deliver(
                  simulator.webhook({
                    orderCode,
                    amount: 200_000,
                    reference: 'TF-W-4',
                    success: false,
                  }),
                );
                assert.equal((await paymentRow(made.payment.id)).status, 'PENDING');
                assert.equal((await inbox(orderCode))[0]!.outcomeDetail, 'NOT_SUCCESS');
                // A processing failure answers 503 so PayOS retries.
                const broken = new PayosWebhookService(
                  {
                    client: {
                      $transaction: () => Promise.reject(new Error('database is down')),
                    },
                  } as never,
                  simulator.provider,
                  null,
                );
                await fails(() => broken.receive(good), 'SERVICE_UNAVAILABLE');
                // The real, authentic notification finally settles the invoice.
                await deliver(good);
                assert.equal((await invoiceRow(invoice.id)).status, 'PAID');
              },
            );

            // ============================================================ management note (Q7 item 8)
            await suite.test(
              'wrong benefit on a PayOS-settled invoice: an audited management note only, no correction',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 200_000));
                const cashOnly = await pending([exact]);
                await ok(() => pay(collector, cashOnly.id, 200_000));
                await fails(
                  () => invoices.addNote(corrector.token, cashOnly.id, { note: 'x' }),
                  'INVOICE_NOTE_NOT_ALLOWED',
                );
                await fails(
                  () => invoices.addNote(corrector.token, invoice.id, { note: 'x' }),
                  'INVOICE_NOTE_NOT_ALLOWED',
                );
                await deliver(simulator.pay(await orderOf(made.payment.id)));
                for (const actor of [collector, viewer, cashier, canceller, outsider, nobody]) {
                  await fails(
                    () => invoices.addNote(actor.token, invoice.id, { note: 'x' }),
                    'FORBIDDEN',
                  );
                }
                await fails(
                  () => invoices.addNote(corrector.token, invoice.id, { note: '   ' }),
                  'VALIDATION_FAILED',
                );
                const before = await stored(invoice.id);
                const noted = await ok(() =>
                  invoices.addNote(corrector.token, invoice.id, {
                    note: 'Sai ưu đãi, xử lý ngoài hệ thống',
                  }),
                );
                assert.equal(noted.managementNotes.length, 1);
                assert.equal(noted.managementNotes[0]!.note, 'Sai ưu đãi, xử lý ngoài hệ thống');
                assert.equal(noted.managementNotes[0]!.author.id, corrector.id);
                assert.equal(noted.actions.addManagementNote, true);
                assert.equal(noted.status, 'PAID');
                // Nothing else changed: same payments, totals and version.
                const after = await stored(invoice.id);
                assert.equal(after.rowVersion, before.rowVersion);
                assert.equal(after.totalVnd, before.totalVnd);
                assert.equal(after.payments.length, before.payments.length);
                const [noteAudit] = await paymentAudits(
                  invoice.id,
                  'INVOICE_MANAGEMENT_NOTE_ADDED',
                );
                assert.equal(noteAudit!.actorUserId, corrector.id);
                assert.equal(noteAudit!.dataClassification, 'FINANCIAL');
                assert.equal(noteAudit!.reason, 'Sai ưu đãi, xử lý ngoài hệ thống');
                // Management only: a collector who can also view sees no notes.
                assert.deepEqual(
                  (await invoices.get(collectorB.token, invoice.id)).managementNotes,
                  [],
                );
                const id = noted.managementNotes[0]!.id;
                for (const statement of [
                  `UPDATE invoice_management_notes SET note = 'x' WHERE id = '${id}'::uuid`,
                  `DELETE FROM invoice_management_notes WHERE id = '${id}'::uuid`,
                ]) {
                  await assert.rejects(
                    isolated(() => tx.$executeRawUnsafe(statement)),
                    (error: unknown) => error instanceof Error,
                    statement,
                  );
                }
              },
            );

            // ==================================================================== database backstops
            await suite.test(
              'database guards: no direct succeeded PayOS row, one pending, frozen requests, no reversal, no cancel',
              async () => {
                const invoice = await pending([exact]);
                const made = await ok(() => payos(collector, invoice.id, 100_000));
                const id = made.payment.id;
                const insert = (columns: Record<string, string>) => {
                  const base: Record<string, string> = {
                    invoice_id: `'${invoice.id}'::uuid`,
                    branch_id: `'${branch.id}'::uuid`,
                    method: `'PAYOS'`,
                    status: `'PENDING'`,
                    amount_due_vnd: '200000',
                    amount_vnd: '50000',
                    tendered_vnd: '50000',
                    change_vnd: '0',
                    collected_by_user_id: `'${collector.id}'::uuid`,
                    idempotency_key: `'${randomUUID()}'::uuid`,
                    provider_order_code: String(
                      9_000_000_000_000 + Math.floor(Math.random() * 1_000_000),
                    ),
                    expires_at: `clock_timestamp() + interval '10 minutes'`,
                    ...columns,
                  };
                  return `INSERT INTO payments (${Object.keys(base).join(', ')}) VALUES (${Object.values(base).join(', ')})`;
                };
                // Positive control: the builder produces a VALID row (on an invoice with no pending request),
                // so every refusal below is the database's rule, not a typo.
                const other = await pending([exact]);
                const insertOther = insert({}).replace(invoice.id, other.id);
                await isolated(() => tx.$executeRawUnsafe(insertOther));
                assert.equal(await tx.payment.count({ where: { invoiceId: other.id } }), 1);
                await settle();
                const refused: [string, RegExp][] = [
                  // Staff cannot create a succeeded provider payment (no "mark received").
                  [
                    insert({ status: `'SUCCEEDED'`, provider_reference: `'TF-FAKE'` }),
                    /succeeds only by confirmation of its request/,
                  ],
                  [
                    insert({
                      status: `'SUCCEEDED'`,
                      provider_reference: `'TF-FAKE'`,
                      amount_due_vnd: '100000',
                    }),
                    /amount due must equal the invoice balance/,
                  ],
                  // Only one pending request per invoice.
                  [insert({}), /payments_one_pending_key/],
                  // A pending request needs its order code and a bounded lifetime; no tender or reference.
                  [insert({ provider_order_code: 'NULL' }), /payments_provider_columns/],
                  [
                    insert({ expires_at: `clock_timestamp() + interval '2 days'` }),
                    /expires within one day/,
                  ],
                  [insert({ provider_reference: `'TF-EARLY'` }), /starts pending and unconfirmed/],
                  [
                    insert({ tendered_vnd: '60000', change_vnd: '10000' }),
                    /payments_provider_columns/,
                  ],
                  // Cash rows carry no provider data; cash is never pending.
                  [
                    insert({ method: `'CASH'`, status: `'SUCCEEDED'`, amount_due_vnd: '200000' }),
                    /payments_provider_columns/,
                  ],
                  [
                    insert({ method: `'CASH'`, status: `'PENDING'` }),
                    /payments_(cash_succeeded|pending_provider_only|provider_columns)/,
                  ],
                  // A pending request is frozen, cannot succeed without a reference, cannot be deleted.
                  [
                    `UPDATE payments SET amount_vnd = 1, tendered_vnd = 1, row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                    /cannot be rewritten/,
                  ],
                  [
                    `UPDATE payments SET provider_order_code = 5, row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                    /cannot be rewritten/,
                  ],
                  [
                    `UPDATE payments SET expires_at = expires_at + interval '1 hour', row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                    /cannot be rewritten/,
                  ],
                  [
                    `UPDATE payments SET status = 'SUCCEEDED', row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                    /payments_provider_columns/,
                  ],
                  [
                    `UPDATE payments SET checkout_url = 'https://evil.example', row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                    /attached once/,
                  ],
                  [`DELETE FROM payments WHERE id = '${id}'::uuid`, /./],
                  // The invoice cannot be cancelled under a pending request.
                  [
                    `UPDATE invoices SET status = 'CANCELLED', cancelled_from_status = 'PENDING_PAYMENT', cancelled_at = clock_timestamp(), cancel_reason = 'x', cancelled_by_user_id = '${canceller.id}'::uuid, row_version = row_version + 1 WHERE id = '${invoice.id}'::uuid`,
                    /pending provider request cannot be cancelled/,
                  ],
                  // Inbox and attempts are append-only; an unauthentic event cannot be stored.
                  [
                    `INSERT INTO payment_provider_events (dedupe_key, signature_valid, raw_payload, outcome, outcome_detail) VALUES ('forged', false, '{}'::jsonb, 'IGNORED', 'x')`,
                    /payment_provider_events_authentic/,
                  ],
                  [
                    `UPDATE payment_attempts SET outcome = 'REJECTED' WHERE payment_id = '${id}'::uuid`,
                    /./,
                  ],
                  [`DELETE FROM payment_attempts WHERE payment_id = '${id}'::uuid`, /./],
                ];
                for (const [statement, reason] of refused) {
                  let seen: string | null = null;
                  try {
                    await isolated(() => tx.$executeRawUnsafe(statement));
                  } catch (error) {
                    seen = inspect(error, { depth: 8 });
                  }
                  assert.ok(
                    seen !== null && reason.test(seen),
                    `${statement}
expected ${reason}; got ${seen === null ? 'success' : seen.slice(0, 500)}`,
                  );
                }
                const row = await stored(invoice.id);
                assert.equal(row.status, 'PENDING_PAYMENT');
                assert.equal(row.payments.length, 1);
                assert.equal(row.payments[0]!.status, 'PENDING');
                assert.equal(row.payments[0]!.amountVnd, 100_000n);

                // A confirmed request is frozen too, and the first confirmation is the only one for an order.
                await deliver(simulator.pay(await orderOf(id), { reference: 'TF-G-1' }));
                for (const statement of [
                  `UPDATE payments SET status = 'FAILED', provider_reference = NULL, row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                  `UPDATE payments SET amount_vnd = 1 WHERE id = '${id}'::uuid`,
                  `UPDATE payments SET provider_reference = 'TF-OTHER' WHERE id = '${id}'::uuid`,
                ]) {
                  await assert.rejects(
                    isolated(() => tx.$executeRawUnsafe(statement)),
                    (error: unknown) =>
                      error instanceof Error &&
                      /cannot be rewritten/.test(inspect(error, { depth: 8 })),
                    statement,
                  );
                }
                assert.equal((await paymentRow(id)).providerReference, 'TF-G-1');
              },
            );

            await settle();
            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(
        await database.invoice.count({ where: { branch: { code: { endsWith: run } } } }),
        0,
      );
      assert.equal(await database.branch.count({ where: { code: { endsWith: run } } }), 0);
    } finally {
      await database.$disconnect();
    }
  },
);
