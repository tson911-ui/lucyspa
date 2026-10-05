import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InvoiceResponse, PaymentResultResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 4 Step 7: cash / split payments, payment states and corrections against real PostgreSQL. Every
 * fixture (and every command) rolls back with the outer transaction; concurrency is covered by the separate
 * race suite. After each command the deferred Step 4 integrity triggers are forced to run (`settle`), so a
 * command that would fail the database's commit-time checks fails here too.
 */
test(
  'Phase 4 Step 7 cash payments, split payments and corrections; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 7 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `payment_${++savepoint}`;
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
            const invoices = new InvoiceService(
              {
                withTransaction: isolated,
                withExclusiveTransaction: isolated,
                resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              },
              new AuthThrottleService(environment),
              environment,
            );
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
            const free = await makeService('FREE', [0n, 50_000n]);
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
                  phoneCanonical: validVnMobile(),
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
            const correctorStale = await staffUser(at(roles.correct.id));
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
                  phoneCanonical: validVnMobile(),
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

            // ============================================================== cash collection (OP-6)
            await suite.test(
              'cash: COLLECT_PAYMENTS alone records it; every other actor is refused; server time, change and history',
              async () => {
                const invoice = await pending([exact]);
                assert.equal(invoice.totalVnd, '200000');
                assert.equal(invoice.balanceVnd, '200000');
                assert.equal(invoice.paidVnd, '0');
                assert.deepEqual(invoice.payments, []);

                // No permission, another branch, a customer, a viewer/manager/preparer: all refused, nothing written.
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
                  await fails(() => pay(actor, invoice.id, 200_000), 'FORBIDDEN');
                }
                await fails(() => pay(owner, invoice.id, 200_000), 'FORBIDDEN');
                await fails(() => pay(collector, randomUUID(), 200_000), 'NOT_FOUND');
                await fails(() => pay(collector, 'not-a-uuid', 200_000), 'NOT_FOUND');
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
                // A draft (not yet finalized) takes no payment.
                const drafted = await draft(await completedVisit([exact]));
                await fails(() => pay(collector, drafted.id, 100_000), 'INVOICE_STATE_INVALID');

                const visitBefore = await tx.visit.findUniqueOrThrow({
                  where: { id: (await stored(invoice.id)).visitId! },
                });
                const before = Date.now();
                // The collector has ONLY COLLECT_PAYMENTS: it records cash (tender above the amount) but cannot read.
                const result = await ok(() => pay(collector, invoice.id, 200_000, 500_000));
                assert.deepEqual(Object.keys(result).sort(), ['invoice', 'payment']);
                assert.equal(result.payment.method, 'CASH');
                assert.equal(result.payment.status, 'SUCCEEDED');
                assert.equal(result.payment.amountDueVnd, '200000');
                assert.equal(result.payment.amountVnd, '200000');
                assert.equal(result.payment.tenderedVnd, '500000');
                assert.equal(result.payment.changeVnd, '300000');
                assert.equal(result.payment.effective, true);
                assert.equal(result.payment.reversible, false, 'a collector cannot reverse');
                assert.equal(result.payment.collectedBy.id, collector.id);
                assert.equal(result.invoice.status, 'PAID');
                assert.equal(result.invoice.paidVnd, '200000');
                assert.equal(result.invoice.balanceVnd, '0');
                assert.equal(result.invoice.paidSeq, 1);
                await fails(() => invoices.get(collector.token, invoice.id), 'FORBIDDEN');

                // Stored facts: server clock (not a client value), branch-local business date.
                const row = await stored(invoice.id);
                const payment = row.payments[0]!;
                assert.equal(row.status, 'PAID');
                assert.equal(row.paidSeq, 1);
                assert.equal(payment.branchId, branch.id);
                assert.equal(payment.collectedByUserId, collector.id);
                assert.ok(Math.abs(payment.collectedAt.getTime() - before) < 60_000);
                assert.ok(payment.collectedAt.getTime() >= row.finalizedAt!.getTime());
                assert.equal(row.paidAt!.getTime(), payment.collectedAt.getTime());
                assert.equal(
                  payment.businessDate.toISOString().slice(0, 10),
                  localDate(payment.collectedAt),
                );
                assert.equal(result.payment.collectedAt, payment.collectedAt.toISOString());
                // Payment never touches the Visit (END/completion independence).
                const visitAfter = await tx.visit.findUniqueOrThrow({
                  where: { id: row.visitId! },
                });
                assert.equal(visitAfter.status, 'COMPLETED');
                assert.equal(visitAfter.rowVersion, visitBefore.rowVersion);

                // FINANCIAL audit in the same transaction: due, tendered, change, credited, collector.
                const [recorded] = await audits(invoice.id, 'PAYMENT_RECORDED');
                assert.ok(recorded);
                assert.equal(recorded.dataClassification, 'FINANCIAL');
                assert.equal(recorded.actorUserId, collector.id);
                assert.equal(recorded.branchId, branch.id);
                assert.deepEqual(recorded.after, {
                  paymentId: payment.id,
                  method: 'CASH',
                  amountDueVnd: '200000',
                  amountVnd: '200000',
                  tenderedVnd: '500000',
                  changeVnd: '300000',
                  collectedByUserId: collector.id,
                  paidVnd: '200000',
                  balanceVnd: '0',
                  status: 'PAID',
                });
                const [paidAudit] = await audits(invoice.id, 'INVOICE_PAID');
                assert.ok(paidAudit);
                assert.deepEqual(paidAudit.after, {
                  status: 'PAID',
                  paidSeq: 1,
                  settlement: 'PAYMENT',
                  totalVnd: '200000',
                });
                // Events: PAYMENT_SUCCEEDED (Payment) and INVOICE_PAID (Invoice, paid episode 1), no personal data.
                const [succeeded] = await paymentEvents(payment.id);
                assert.ok(succeeded);
                assert.equal(succeeded.eventType, 'PAYMENT_SUCCEEDED');
                assert.deepEqual(succeeded.payload, {
                  invoiceId: invoice.id,
                  branchId: branch.id,
                  visitId: row.visitId,
                  paymentId: payment.id,
                  method: 'CASH',
                  amountVnd: '200000',
                });
                const [paidEvent] = await invoiceEvents(invoice.id, 'INVOICE_PAID');
                assert.ok(paidEvent);
                assert.deepEqual(paidEvent.payload, {
                  invoiceId: invoice.id,
                  branchId: branch.id,
                  visitId: row.visitId,
                  paidSeq: 1,
                  totalVnd: '200000',
                  settlement: 'PAYMENT',
                });
                assert.equal(
                  succeeded.publishedAt,
                  null,
                  'financial events never use published_at',
                );

                // A PAID invoice takes no further payment.
                await fails(() => pay(collector, invoice.id, 1), 'INVOICE_STATE_INVALID');
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 1);
              },
            );

            await suite.test(
              'cash: method rules; only CASH exists and is accepted, CARD and unknown methods are refused',
              async () => {
                const invoice = await pending([exact]);
                for (const method of [
                  'CARD',
                  'PAYOS',
                  'cash',
                  'BANK_TRANSFER',
                  '',
                  '__proto__',
                  'constructor',
                  'toString',
                  5,
                  null,
                ]) {
                  await fails(
                    () => pay(collector, invoice.id, 1_000, 1_000, key(), method),
                    'PAYMENT_METHOD_UNAVAILABLE',
                  );
                }
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
                const [methods] = await tx.$queryRawUnsafe<{ values: string[] }[]>(
                  `SELECT array_agg(v::text) AS values FROM unnest(enum_range(NULL::"PaymentMethod")) v`,
                );
                assert.deepEqual(
                  methods?.values,
                  ['CASH', 'PAYOS'],
                  'CARD is ready by design, not in the enum; PAYOS (Step 8) is never recorded directly',
                );
                // Money input is strict integer VND.
                for (const amount of [
                  '0',
                  '-1',
                  '1.5',
                  '1e3',
                  '',
                  ' 100',
                  '0100',
                  '9'.repeat(19),
                ]) {
                  await fails(
                    () => pay(collector, invoice.id, amount, '999999999'),
                    'VALIDATION_FAILED',
                    'amountVnd',
                  );
                }
                for (const tendered of ['-1', '1.5', '', 'abc']) {
                  await fails(
                    () => pay(collector, invoice.id, 1_000, tendered),
                    'VALIDATION_FAILED',
                    'tenderedVnd',
                  );
                }
                await fails(
                  () => pay(collector, invoice.id, 1_000, 1_000, 'not-a-key'),
                  'VALIDATION_FAILED',
                  'idempotencyKey',
                );
                await fails(
                  () => pay(collector, invoice.id, 5_000, 4_999),
                  'VALIDATION_FAILED',
                  'tenderedVnd',
                );
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
              },
            );

            // ================================================================== split payments
            await suite.test(
              'split: several payments sum to the receivable; the last one completes; no overpayment',
              async () => {
                const invoice = await pending([exact, ranged]);
                assert.equal(invoice.totalVnd, '300000');
                const first = await ok(() => pay(collector, invoice.id, 100_000, 100_000));
                assert.equal(first.payment.amountDueVnd, '300000');
                assert.equal(first.invoice.status, 'PENDING_PAYMENT');
                assert.equal(first.invoice.paidVnd, '100000');
                assert.equal(first.invoice.balanceVnd, '200000');
                assert.equal(first.invoice.paidSeq, 0);
                assert.equal((await stored(invoice.id)).paidAt, null);
                assert.equal((await invoiceEvents(invoice.id, 'INVOICE_PAID')).length, 0);

                // A different collector; change is derived from the tender.
                const second = await ok(() => pay(collectorB, invoice.id, 150_000, 200_000));
                assert.equal(
                  second.payment.amountDueVnd,
                  '200000',
                  'due = the balance at that moment',
                );
                assert.equal(second.payment.changeVnd, '50000');
                assert.equal(second.invoice.balanceVnd, '50000');
                assert.equal(second.invoice.status, 'PENDING_PAYMENT');

                // No overpayment, however much is tendered; nothing changes.
                await fails(
                  () => pay(collector, invoice.id, 50_001, 100_000),
                  'PAYMENT_AMOUNT_INVALID',
                );
                await fails(
                  () => pay(collector, invoice.id, 300_000, 300_000),
                  'PAYMENT_AMOUNT_INVALID',
                );
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 2);

                const last = await ok(() => pay(collectorB, invoice.id, 50_000, 50_000));
                assert.equal(last.invoice.status, 'PAID');
                assert.equal(last.invoice.paidVnd, '300000');
                assert.equal(last.invoice.balanceVnd, '0');
                assert.equal(last.invoice.paidSeq, 1);

                const row = await stored(invoice.id);
                assert.equal(
                  row.payments.reduce((sum, entry) => sum + entry.amountVnd, 0n),
                  row.totalVnd,
                );
                assert.equal(
                  row.paidAt!.getTime(),
                  row.payments.find((entry) => entry.id === last.payment.id)!.collectedAt.getTime(),
                );
                // One INVOICE_PAID for the single paid episode; one PAYMENT_RECORDED per payment.
                assert.equal((await invoiceEvents(invoice.id, 'INVOICE_PAID')).length, 1);
                assert.equal((await audits(invoice.id, 'PAYMENT_RECORDED')).length, 3);
                assert.equal((await audits(invoice.id, 'INVOICE_PAID')).length, 1);
                // History reads (VIEW_INVOICES): oldest first, all effective, collectors named.
                const read = await invoices.get(viewer.token, invoice.id);
                assert.deepEqual(
                  read.payments.map((entry) => [
                    entry.amountVnd,
                    entry.effective,
                    entry.reversible,
                  ]),
                  [
                    ['100000', true, false],
                    ['150000', true, false],
                    ['50000', true, false],
                  ],
                );
                assert.equal(read.paidVnd, '300000');
                assert.equal(read.actions.collectPayment, false);
                assert.equal(read.payments[0]!.collectedBy.id, collector.id);
                assert.equal(read.payments[1]!.collectedBy.id, collectorB.id);
              },
            );

            await suite.test(
              'idempotency: a replay returns the stored payment; the key is per collector; different content conflicts',
              async () => {
                const invoice = await pending([exact, ranged]);
                const k = key();
                const original = await ok(() => pay(collector, invoice.id, 100_000, 120_000, k));
                const replay = await ok(() => pay(collector, invoice.id, 100_000, 120_000, k));
                assert.equal(replay.payment.id, original.payment.id);
                assert.equal(replay.invoice.paidVnd, '100000', 'a replay never credits twice');
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 1);
                assert.equal((await audits(invoice.id, 'PAYMENT_RECORDED')).length, 1);
                assert.equal((await paymentEvents(original.payment.id)).length, 1);
                // The same key with other content is not silently accepted.
                await fails(() => pay(collector, invoice.id, 100_001, 120_000, k), 'CONFLICT');
                await fails(() => pay(collector, invoice.id, 100_000, 130_000, k), 'CONFLICT');
                // Another collector's key space is independent.
                const independent = await ok(() =>
                  pay(collectorB, invoice.id, 100_000, 100_000, k),
                );
                assert.notEqual(independent.payment.id, original.payment.id);
                // A replay after the invoice became PAID still returns the stored result, changing nothing.
                const closing = key();
                const done = await ok(() => pay(collector, invoice.id, 100_000, 100_000, closing));
                assert.equal(done.invoice.status, 'PAID');
                const again = await ok(() => pay(collector, invoice.id, 100_000, 100_000, closing));
                assert.equal(again.payment.id, done.payment.id);
                assert.equal(again.invoice.status, 'PAID');
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 3);
                assert.equal((await invoiceEvents(invoice.id, 'INVOICE_PAID')).length, 1);
                // A key used for one invoice cannot be replayed on another.
                const other = await pending([exact]);
                await fails(() => pay(collector, other.id, 100_000, 120_000, k), 'CONFLICT');
              },
            );

            // ============================================================= corrections (Q6)
            await suite.test(
              'reversal: CORRECT_PAYMENTS + reason + fresh re-auth; append-only; PAID returns to PENDING; a new paid episode',
              async () => {
                const invoice = await pending([exact, ranged]);
                const a = await ok(() => pay(collector, invoice.id, 100_000));
                const b = await ok(() => pay(collector, invoice.id, 200_000));
                assert.equal(b.invoice.status, 'PAID');
                assert.equal(b.invoice.paidSeq, 1);

                // Authority: reversal is CORRECT_PAYMENTS only (collecting/managing/cancelling do not imply it).
                for (const actor of [
                  collector,
                  collectorB,
                  cashier,
                  manageOnly,
                  canceller,
                  viewer,
                  nobody,
                  outsider,
                ]) {
                  await fails(() => reverse(actor, invoice.id, b.payment.id), 'FORBIDDEN');
                }
                // Fresh password re-authentication, always; a reason is required.
                await fails(
                  () => reverse(correctorStale, invoice.id, b.payment.id),
                  'REAUTHENTICATION_REQUIRED',
                );
                for (const reason of ['', '   ', 'x'.repeat(501)]) {
                  await fails(
                    () => reverse(corrector, invoice.id, b.payment.id, reason),
                    'VALIDATION_FAILED',
                    'reason',
                  );
                }
                await fails(() => reverse(corrector, invoice.id, randomUUID()), 'NOT_FOUND');
                await fails(() => reverse(corrector, invoice.id, 'nope'), 'NOT_FOUND');
                const foreign = await pending([exact]);
                const foreignPay = await ok(() => pay(collector, foreign.id, 100_000));
                await fails(
                  () => reverse(corrector, invoice.id, foreignPay.payment.id),
                  'NOT_FOUND',
                );
                assert.equal(await tx.paymentCorrection.count(), 0);

                const reversed = await ok(() =>
                  reverse(corrector, invoice.id, b.payment.id, '  Nhập nhầm số tiền '),
                );
                assert.equal(reversed.payment.effective, false);
                assert.equal(
                  reversed.payment.status,
                  'SUCCEEDED',
                  'the original row is never edited',
                );
                assert.equal(reversed.payment.correction?.reason, 'Nhập nhầm số tiền');
                assert.equal(reversed.payment.correction?.actor.id, corrector.id);
                assert.equal(reversed.invoice.status, 'PENDING_PAYMENT');
                assert.equal(reversed.invoice.paidVnd, '100000');
                assert.equal(reversed.invoice.balanceVnd, '200000');
                assert.equal(reversed.invoice.paidSeq, 1, 'the episode counter is kept');
                const row = await stored(invoice.id);
                assert.equal(row.paidAt, null);
                assert.equal(row.status, 'PENDING_PAYMENT');
                const original = row.payments.find((entry) => entry.id === b.payment.id)!;
                assert.equal(original.status, 'SUCCEEDED');
                assert.equal(original.amountVnd, 200_000n);
                assert.equal(
                  await tx.paymentCorrection.count({ where: { paymentId: b.payment.id } }),
                  1,
                );
                // Audit + events.
                const [audit] = await audits(invoice.id, 'PAYMENT_REVERSED');
                assert.ok(audit);
                assert.equal(audit.dataClassification, 'FINANCIAL');
                assert.equal(audit.reason, 'Nhập nhầm số tiền');
                assert.equal(audit.actorUserId, corrector.id);
                assert.equal(audit.branchId, branch.id);
                const after = audit.after as Record<string, unknown>;
                assert.equal(after['paymentId'], b.payment.id);
                assert.equal(after['paidVnd'], '100000');
                assert.equal(after['balanceVnd'], '200000');
                assert.ok(after['reauthenticatedAt']);
                assert.equal((await audits(invoice.id, 'INVOICE_REOPENED')).length, 1);
                assert.deepEqual(
                  (await paymentEvents(b.payment.id)).map((event) => event.eventType),
                  ['PAYMENT_SUCCEEDED', 'PAYMENT_REVERSED'],
                );
                const [reopened] = await invoiceEvents(invoice.id, 'INVOICE_REOPENED');
                assert.ok(reopened);
                assert.equal((reopened.payload as Record<string, unknown>)['paidSeq'], 1);

                // Idempotent: the same actor repeating is a quiet no-op; another actor is refused.
                const replay = await ok(() =>
                  reverse(corrector, invoice.id, b.payment.id, 'again'),
                );
                assert.equal(replay.payment.correction?.reason, 'Nhập nhầm số tiền');
                await fails(() => reverse(boss, invoice.id, b.payment.id), 'PAYMENT_STATE_INVALID');
                assert.equal(
                  await tx.paymentCorrection.count({ where: { paymentId: b.payment.id } }),
                  1,
                );
                assert.equal((await audits(invoice.id, 'PAYMENT_REVERSED')).length, 1);
                assert.equal((await paymentEvents(b.payment.id)).length, 2);

                // Re-payment completes a NEW paid episode (paid_seq 2); events distinguish the two episodes.
                const repaid = await ok(() => pay(collectorB, invoice.id, 200_000, 200_000));
                assert.equal(repaid.invoice.status, 'PAID');
                assert.equal(repaid.invoice.paidSeq, 2);
                assert.equal(repaid.payment.amountDueVnd, '200000');
                const paidEvents = await invoiceEvents(invoice.id, 'INVOICE_PAID');
                assert.deepEqual(
                  paidEvents
                    .map((event) => (event.payload as Record<string, unknown>)['paidSeq'])
                    .sort(),
                  [1, 2],
                );
                // The first payment is untouched and still effective.
                const read = await invoices.get(boss.token, invoice.id);
                assert.deepEqual(
                  read.payments.map((entry) => [
                    entry.id === a.payment.id,
                    entry.effective,
                    entry.reversible,
                  ]),
                  [
                    [true, true, true],
                    [false, false, false],
                    [false, true, true],
                  ],
                );
              },
            );

            await suite.test(
              'reversal on PENDING_PAYMENT keeps it pending; reverse everything then cancel; history is never deleted',
              async () => {
                const invoice = await pending([exact, ranged]);
                const a = await ok(() => pay(collector, invoice.id, 100_000));
                const b = await ok(() => pay(collector, invoice.id, 100_000));
                const undone = await ok(() => reverse(corrector, invoice.id, a.payment.id));
                assert.equal(undone.invoice.status, 'PENDING_PAYMENT');
                assert.equal(undone.invoice.paidVnd, '100000');
                assert.equal(undone.invoice.balanceVnd, '200000');
                assert.equal((await audits(invoice.id, 'INVOICE_REOPENED')).length, 0);
                assert.equal((await invoiceEvents(invoice.id, 'INVOICE_REOPENED')).length, 0);

                // With an effective payment left, the invoice cannot be cancelled (Q6: reverse first).
                await fails(
                  () => cancelInvoice(canceller, invoice.id, undone.invoice.version),
                  'INVOICE_CANCEL_NOT_ALLOWED',
                );
                await ok(() => reverse(corrector, invoice.id, b.payment.id));
                const current = await invoices.get(canceller.token, invoice.id);
                assert.equal(current.paidVnd, '0');
                assert.equal(current.balanceVnd, '300000');
                const cancelled = await ok(() =>
                  cancelInvoice(canceller, invoice.id, current.version, 'Khách hủy'),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelledFromStatus, 'PENDING_PAYMENT');
                assert.equal(cancelled.paidVnd, '0');
                assert.equal(cancelled.balanceVnd, '0');
                // Both payments and both corrections are still there; a cancelled invoice takes nothing more.
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 2);
                assert.equal(cancelled.payments.length, 2);
                assert.ok(
                  cancelled.payments.every(
                    (entry) => !entry.effective && !entry.reversible && entry.correction,
                  ),
                );
                await fails(() => pay(collector, invoice.id, 1), 'INVOICE_STATE_INVALID');
                // Repeating the reversal is a quiet no-op for its actor; anyone else finds it already reversed.
                await ok(() => reverse(corrector, invoice.id, a.payment.id));
                await fails(() => reverse(boss, invoice.id, a.payment.id), 'PAYMENT_STATE_INVALID');
                assert.equal(
                  await tx.paymentCorrection.count({ where: { paymentId: a.payment.id } }),
                  1,
                );
                assert.equal(cancelled.actions.collectPayment, false);
              },
            );

            await suite.test(
              'Q6 / OP-7: an invoice with a payment is never cancelled from PAID; a zero-balance invoice has no payment path',
              async () => {
                const paid = await pending([exact]);
                const result = await ok(() => pay(collector, paid.id, 200_000));
                assert.equal(result.invoice.status, 'PAID');
                // The command refuses (even for the boss with fresh re-authentication)...
                await fails(
                  () => cancelInvoice(boss, paid.id, result.invoice.version),
                  'INVOICE_CANCEL_NOT_ALLOWED',
                );
                // ...and so does the database guard, even if a caller tried it directly.
                await assert.rejects(
                  isolated(() =>
                    tx.$executeRawUnsafe(
                      `UPDATE invoices SET status = 'CANCELLED', cancelled_at = now(),
                       cancelled_by_user_id = '${boss.id}'::uuid, cancelled_from_status = 'PAID',
                       cancel_reason = 'x', row_version = row_version + 1 WHERE id = '${paid.id}'::uuid`,
                    ),
                  ),
                  /zero-balance correction with no payment/,
                );
                // After a reversal it is PENDING_PAYMENT: OP-7 (PAID only) is no route around Q6.
                await ok(() => reverse(corrector, paid.id, result.payment.id));
                assert.equal((await stored(paid.id)).status, 'PENDING_PAYMENT');

                // Zero-balance invoice: PAID with no Payment row; no payment or reversal can exist on it.
                const visit = await completedVisit([free]);
                const zeroDraft = await draft(visit);
                const zeroPriced = await ok(() =>
                  invoices.setPrice(cashier.token, zeroDraft.id, zeroDraft.lines[0]!.id, {
                    expectedVersion: zeroDraft.version,
                    unitPriceVnd: '0',
                  }),
                );
                const zero = await ok(() =>
                  invoices.finalize(cashier.token, zeroPriced.id, {
                    expectedVersion: zeroPriced.version,
                  }),
                );
                assert.deepEqual(
                  [zero.status, zero.totalVnd, zero.paidVnd, zero.balanceVnd],
                  ['PAID', '0', '0', '0'],
                );
                await fails(() => pay(collector, zero.id, 1), 'INVOICE_STATE_INVALID');
                await fails(() => reverse(corrector, zero.id, randomUUID()), 'NOT_FOUND');
                await fails(() => reverse(corrector, zero.id, result.payment.id), 'NOT_FOUND');
                assert.equal(await tx.payment.count({ where: { invoiceId: zero.id } }), 0);
                // OP-7 still works for it (no payment row): the Step 5 path is unchanged.
                const corrected = await ok(() =>
                  cancelInvoice(canceller, zero.id, zero.version, 'Nhầm ưu đãi'),
                );
                assert.equal(corrected.status, 'CANCELLED');
                assert.equal(corrected.cancelledFromStatus, 'PAID');
              },
            );

            await suite.test(
              'split-paid invoice: refused by OP-7 and cancellable only after every effective payment is reversed',
              async () => {
                const invoice = await pending([exact, ranged]);
                const a = await ok(() => pay(collector, invoice.id, 100_000));
                const b = await ok(() => pay(collectorB, invoice.id, 200_000));
                assert.equal(b.invoice.status, 'PAID');
                await fails(
                  () => cancelInvoice(boss, invoice.id, b.invoice.version),
                  'INVOICE_CANCEL_NOT_ALLOWED',
                );
                await ok(() => reverse(boss, invoice.id, b.payment.id));
                await ok(() => reverse(boss, invoice.id, a.payment.id));
                const current = await invoices.get(boss.token, invoice.id);
                assert.equal(current.status, 'PENDING_PAYMENT');
                const cancelled = await ok(() => cancelInvoice(boss, invoice.id, current.version));
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelledFromStatus, 'PENDING_PAYMENT');
                assert.equal(cancelled.paidSeq, 1, 'the earlier paid episode stays as a fact');
              },
            );

            // =============================================================== reads and immutability
            await suite.test(
              'reads: payments and permitted actions follow the actor; nothing beyond the invoice branch',
              async () => {
                const invoice = await pending([exact, ranged]);
                await ok(() => pay(collector, invoice.id, 100_000));
                const asViewer = await invoices.get(viewer.token, invoice.id);
                assert.equal(asViewer.actions.collectPayment, false);
                assert.deepEqual(
                  asViewer.payments.map((entry) => entry.reversible),
                  [false],
                );
                const asCollector = await invoices.get(collectorB.token, invoice.id);
                assert.equal(asCollector.actions.collectPayment, true);
                assert.deepEqual(
                  asCollector.payments.map((entry) => entry.reversible),
                  [false],
                );
                const asBoss = await invoices.get(boss.token, invoice.id);
                assert.equal(asBoss.actions.collectPayment, true);
                assert.deepEqual(
                  asBoss.payments.map((entry) => entry.reversible),
                  [true],
                );
                assert.equal(asBoss.paidVnd, '100000');
                assert.equal(asBoss.balanceVnd, '200000');
                await fails(() => invoices.get(outsider.token, invoice.id), 'FORBIDDEN');
                // A draft has no payments and offers no collection.
                const drafted = await draft(await completedVisit([exact]));
                assert.deepEqual(
                  [
                    drafted.payments,
                    drafted.paidVnd,
                    drafted.balanceVnd,
                    drafted.actions.collectPayment,
                  ],
                  [[], '0', '0', false],
                );
              },
            );

            await suite.test(
              'immutable financial history: payments and corrections are never rewritten or deleted',
              async () => {
                const invoice = await pending([exact]);
                const paid = await ok(() => pay(collector, invoice.id, 200_000, 250_000));
                await ok(() => reverse(corrector, invoice.id, paid.payment.id));
                const id = paid.payment.id;
                for (const statement of [
                  `UPDATE payments SET amount_vnd = 1 WHERE id = '${id}'::uuid`,
                  `UPDATE payments SET tendered_vnd = 999999, change_vnd = 799999 WHERE id = '${id}'::uuid`,
                  `UPDATE payments SET collected_at = collected_at - interval '1 day' WHERE id = '${id}'::uuid`,
                  `UPDATE payments SET status = 'CANCELLED', row_version = row_version + 1 WHERE id = '${id}'::uuid`,
                  `DELETE FROM payments WHERE id = '${id}'::uuid`,
                  `UPDATE payment_corrections SET reason = 'x' WHERE payment_id = '${id}'::uuid`,
                  `DELETE FROM payment_corrections WHERE payment_id = '${id}'::uuid`,
                  `UPDATE audit_events SET reason = 'x' WHERE action IN ('PAYMENT_RECORDED', 'PAYMENT_REVERSED')`,
                ]) {
                  await assert.rejects(
                    isolated(() => tx.$executeRawUnsafe(statement)),
                    (error: unknown) => error instanceof Error,
                    statement,
                  );
                }
                const row = await stored(invoice.id);
                assert.equal(row.payments[0]!.amountVnd, 200_000n);
                assert.equal(row.payments[0]!.tenderedVnd, 250_000n);
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
