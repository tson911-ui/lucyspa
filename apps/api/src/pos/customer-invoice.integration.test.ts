import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DiscountVersionInput, InvoiceResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { createPayosSimulator, parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { customerInvoiceList } from './customer-invoice.core.js';
import { CustomerInvoiceService } from './customer-invoice.service.js';
import { DiscountService } from '../discounts/discount.service.js';
import { InvoiceService } from './invoice.service.js';

/**
 * Phase 4 Step 9: the customer's invoice history against real PostgreSQL. Every fixture (and every command)
 * rolls back with the outer transaction. Staff create, finalize, pay, reverse and cancel invoices through the real
 * services; the customer service only reads what results.
 */
test(
  'Phase 4 Step 9 customer invoice history; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 9 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `custinv_${++savepoint}`;
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
            const simulator = createPayosSimulator();
            const invoices = new InvoiceService(
              sessionAdapter,
              throttle,
              environment,
              simulator.provider,
            );
            const discounts = new DiscountService(sessionAdapter, throttle);
            const mine = new CustomerInvoiceService(sessionAdapter, throttle);
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
              data: {
                code: `CI_${run}`,
                name: 'Customer invoice fixture',
                timezone: 'Asia/Ho_Chi_Minh',
              },
            });
            await syncPermissionCatalog(tx);
            type Code =
              | 'VIEW_INVOICES'
              | 'MANAGE_INVOICES'
              | 'CANCEL_INVOICES'
              | 'COLLECT_PAYMENTS'
              | 'CORRECT_PAYMENTS'
              | 'APPLY_DISCOUNTS'
              | 'MANAGE_DISCOUNTS'
              | 'CREATE_VOUCHERS';
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `CI_${name}_${run}`,
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
              discountAdmin: await makeRole('DISCOUNT_ADMIN', [
                'MANAGE_DISCOUNTS',
                'CREATE_VOUCHERS',
              ]),
            };

            const category = await tx.serviceCategory.create({
              data: { code: `CI_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const makeService = (key: string, price: [bigint, bigint]) =>
              tx.service.create({
                data: {
                  code: `CI_${key}_${run}`,
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
            const ranged = await makeService('RANGED', [100_000n, 150_000n]);
            const exact = await makeService('EXACT', [200_000n, 200_000n]);
            const free = await makeService('FREE', [0n, 50_000n]);
            type Service = typeof ranged;

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
              return (
                await sessions.rotateAuthenticated(first, principal, { reauthenticated: true }, tx)
              ).token;
            };
            const staffUser = async (
              grants: { roleId: string; branchId?: string }[],
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
                      employeeCodeCanonical: `CI_${run}_${n}`,
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
                    scopeKind: grant.branchId ? 'BRANCH' : 'GLOBAL',
                    branchId: grant.branchId ?? null,
                  },
                });
              }
              return {
                id: user.id,
                token: await login(user, options.reauthenticated ?? false),
                raw: user,
              };
            };
            const at = (roleId: string) => [{ roleId, branchId: branch.id }];
            const cashier = await staffUser(at(roles.prepare.id));
            const collector = await staffUser(at(roles.collect.id));
            const corrector = await staffUser(at(roles.correct.id), { reauthenticated: true });
            const canceller = await staffUser(at(roles.cancel.id), { reauthenticated: true });
            const admin = await staffUser([{ roleId: roles.discountAdmin.id }]);
            const ktv = await staffUser([]);
            const customer = async (label: string) => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `ci-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `ci-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                  },
                },
              });
              return { ...user, token: await login(user) };
            };
            const alice = await customer('alice');
            const bob = await customer('bob');

            // ---------------------------------------------------------- visit / invoice fixtures
            let slot = 0;
            const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
            const slotStart = () => new Date(LOCAL_MIDNIGHT + (6 * 60 + 10 * slot++) * 60_000);
            interface Visit {
              id: string;
              code: string;
            }
            /** A COMPLETED visit whose services were performed. `selfCustomerId` makes that member the participant. */
            const completedVisit = async (
              services: Service[],
              options: { ownerUserId?: string; selfCustomerId?: string } = {},
            ): Promise<Visit> => {
              n++;
              const visit = await tx.visit.create({
                data: {
                  code: `VS-CI-${run}-${n}`,
                  branchId: branch.id,
                  origin: 'WALK_IN',
                  ownerUserId: options.ownerUserId ?? null,
                  serviceDate: new Date('2027-03-01T00:00:00.000Z'),
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: cashier.id,
                  idempotencyKey: randomUUID(),
                },
              });
              const participant = await tx.visitParticipant.create({
                data: options.selfCustomerId
                  ? { visitId: visit.id, kind: 'MEMBER', customerUserId: options.selfCustomerId }
                  : { visitId: visit.id, kind: 'GUEST', displayName: 'Khách lẻ' },
              });
              const lines: string[] = [];
              for (const [index, service] of services.entries()) {
                const start = slotStart();
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
                lines.push(line.id);
              }
              for (const [index, id] of lines.entries()) {
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
              return { id: visit.id, code: visit.code };
            };
            const draft = async (visit: Visit): Promise<InvoiceResponse> =>
              (await ok(() => invoices.open(cashier.token, visit.id))).invoice;
            /** Prices every line at its minimum so the draft can be finalized. */
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
            const finalize = (invoice: InvoiceResponse) =>
              ok(() =>
                invoices.finalize(cashier.token, invoice.id, { expectedVersion: invoice.version }),
              );
            /** A finalized invoice. [exact, ranged@min] totals 300,000; [exact] 200,000. */
            const finalized = async (
              services: Service[],
              options: { ownerUserId?: string; selfCustomerId?: string } = {},
            ) => finalize(await priceAll(await draft(await completedVisit(services, options))));
            const staffView = (id: string) => invoices.get(cashier.token, id);
            const pay = (invoiceId: string, amount: number) =>
              ok(() =>
                invoices.recordPayment(collector.token, invoiceId, {
                  method: 'CASH',
                  amountVnd: String(amount),
                  tenderedVnd: String(amount),
                  idempotencyKey: randomUUID(),
                }),
              );
            const listOf = async (customerToken: string) =>
              (await mine.list(customerToken, undefined)).invoices.map((entry) => entry.id);

            // ===================================================================== visibility
            await suite.test(
              'only finalized invoices where the session customer is the payer are visible; everything else is NOT_FOUND',
              async () => {
                // A draft is not a customer document, and neither is a draft that was cancelled.
                const drafted = await draft(
                  await completedVisit([exact], { ownerUserId: alice.id }),
                );
                assert.equal(drafted.status, 'DRAFT');
                assert.equal(drafted.payer?.id, alice.id, 'alice is the default payer');
                assert.deepEqual(await listOf(alice.token), []);
                await fails(() => mine.detail(alice.token, drafted.id), 'NOT_FOUND');
                const abandoned = await draft(
                  await completedVisit([exact], { ownerUserId: alice.id }),
                );
                await ok(() =>
                  invoices.cancel(canceller.token, abandoned.id, {
                    expectedVersion: abandoned.version,
                    reason: 'Sửa sai',
                  }),
                );
                assert.deepEqual(await listOf(alice.token), []);
                await fails(() => mine.detail(alice.token, abandoned.id), 'NOT_FOUND');

                // Finalized: the payer sees it, nobody else does.
                const mineNow = await finalize(await priceAll(drafted));
                assert.equal(mineNow.status, 'PENDING_PAYMENT');
                assert.deepEqual(await listOf(alice.token), [mineNow.id]);
                assert.equal((await mine.detail(alice.token, mineNow.id)).code, mineNow.code);
                assert.deepEqual(await listOf(bob.token), []);
                for (const id of [mineNow.id, randomUUID(), 'not-a-uuid', 'INV-000000-AAAAAA']) {
                  await fails(() => mine.detail(bob.token, id), 'NOT_FOUND');
                }
                // A foreign invoice and a missing one are indistinguishable (same code, same field).
                const foreign = await mine
                  .detail(bob.token, mineNow.id)
                  .catch((error: unknown) => error);
                const missing = await mine
                  .detail(bob.token, randomUUID())
                  .catch((error: unknown) => error);
                assert.ok(foreign instanceof AuthError && missing instanceof AuthError);
                assert.deepEqual([foreign.code, foreign.field], [missing.code, missing.field]);

                // A guest payer (no account) is nobody's invoice.
                const guest = await finalized([exact]);
                assert.equal(guest.payer, null);
                for (const person of [alice, bob]) {
                  assert.ok(!(await listOf(person.token)).includes(guest.id));
                  await fails(() => mine.detail(person.token, guest.id), 'NOT_FOUND');
                }

                // Being the booking owner is not enough: the payer (set by staff on the draft) decides.
                const moved = await draft(await completedVisit([exact], { ownerUserId: alice.id }));
                const toBob = await ok(() =>
                  invoices.payer(cashier.token, moved.id, {
                    expectedVersion: moved.version,
                    payerUserId: bob.id,
                  }),
                );
                const movedFinal = await finalize(await priceAll(toBob));
                assert.equal(movedFinal.payer?.id, bob.id);
                assert.ok(!(await listOf(alice.token)).includes(movedFinal.id));
                await fails(() => mine.detail(alice.token, movedFinal.id), 'NOT_FOUND');
                assert.deepEqual(await listOf(bob.token), [movedFinal.id]);
                // A member attached as payer on a walk-in with no owner also sees it.
                const walkIn = await draft(await completedVisit([exact]));
                const attached = await ok(() =>
                  invoices.payer(cashier.token, walkIn.id, {
                    expectedVersion: walkIn.version,
                    payerUserId: alice.id,
                  }),
                );
                const attachedFinal = await finalize(await priceAll(attached));
                assert.ok((await listOf(alice.token)).includes(attachedFinal.id));

                // Only a signed-in customer reads: staff, anonymous and garbage sessions are refused.
                await fails(() => mine.list(cashier.token, undefined), 'FORBIDDEN');
                await fails(() => mine.list(admin.token, undefined), 'FORBIDDEN');
                await fails(() => mine.detail(cashier.token, mineNow.id), 'FORBIDDEN');
                await fails(() => mine.list(undefined, undefined), 'AUTHENTICATION_REQUIRED');
                await fails(() => mine.list('garbage', undefined), 'AUTHENTICATION_REQUIRED');
                await fails(() => mine.detail(undefined, mineNow.id), 'AUTHENTICATION_REQUIRED');
              },
            );

            // ===================================================================== content
            await suite.test(
              'the detail shows the bill, mirrors the staff totals and exposes no staff or internal data',
              async () => {
                const invoice = await finalized([exact, ranged], {
                  ownerUserId: alice.id,
                  selfCustomerId: alice.id,
                });
                const view = await mine.detail(alice.token, invoice.id);
                const staff = await staffView(invoice.id);

                assert.deepEqual(Object.keys(view).sort(), [
                  'balanceVnd',
                  'branch',
                  'businessDate',
                  'cancelledAt',
                  'code',
                  'discount',
                  'discountTotalVnd',
                  'finalizedAt',
                  'id',
                  'lines',
                  'paidAt',
                  'paidVnd',
                  'payments',
                  'status',
                  'subtotalVnd',
                  'totalVnd',
                  'visitDate',
                ]);
                assert.deepEqual(Object.keys(view.branch).sort(), ['id', 'name', 'timezone']);
                assert.equal(view.status, staff.status);
                assert.equal(view.code, staff.code);
                for (const field of [
                  'subtotalVnd',
                  'discountTotalVnd',
                  'totalVnd',
                  'paidVnd',
                  'balanceVnd',
                  'businessDate',
                ] as const) {
                  assert.equal(view[field], staff[field], field);
                }
                assert.equal(view.totalVnd, '300000');
                assert.equal(view.balanceVnd, '300000');
                assert.equal(view.visitDate, '2027-03-01');
                assert.equal(view.finalizedAt, staff.finalizedAt);
                assert.equal(view.discount, null);
                assert.deepEqual(view.payments, []);
                assert.equal(view.paidAt, null);
                assert.equal(view.cancelledAt, null);

                assert.equal(view.lines.length, 2);
                for (const [index, line] of view.lines.entries()) {
                  const source = staff.lines[index]!;
                  assert.deepEqual(Object.keys(line).sort(), [
                    'forSelf',
                    'grossVnd',
                    'nameEn',
                    'nameVi',
                    'pricingUnit',
                    'quantity',
                    'recipientName',
                    'sequence',
                    'unitPriceVnd',
                  ]);
                  assert.equal(line.sequence, source.sequence);
                  assert.equal(line.nameVi, source.nameVi);
                  assert.equal(line.unitPriceVnd, source.unitPriceVnd);
                  assert.equal(line.grossVnd, source.grossVnd);
                  assert.equal(line.quantity, source.quantity);
                  // The customer is the participant: their own account name is not repeated back.
                  assert.equal(line.forSelf, true);
                  assert.equal(line.recipientName, null);
                }
                // The listing carries the summary of the same facts.
                const [entry] = (await mine.list(alice.token, undefined)).invoices.filter(
                  (candidate) => candidate.id === invoice.id,
                );
                assert.ok(entry);
                assert.deepEqual(Object.keys(entry).sort(), [
                  'balanceVnd',
                  'branch',
                  'businessDate',
                  'cancelledAt',
                  'code',
                  'finalizedAt',
                  'id',
                  'paidAt',
                  'paidVnd',
                  'status',
                  'totalVnd',
                ]);
                assert.equal(entry.totalVnd, view.totalVnd);

                // A service for someone else shows the name given at the desk, never an account name.
                const forGuest = await finalized([exact], { ownerUserId: alice.id });
                const guestView = await mine.detail(alice.token, forGuest.id);
                assert.equal(guestView.lines[0]?.forSelf, false);
                assert.equal(guestView.lines[0]?.recipientName, 'Khách lẻ');

                // Nothing internal leaks: staff, the KTV, visit, cancel data and provider data.
                const text = JSON.stringify([view, guestView, entry]);
                for (const secret of [
                  ktv.id,
                  cashier.id,
                  collector.id,
                  'Staff ',
                  staff.visit.id,
                  staff.visit.code,
                  staff.lines[0]!.visitServiceLineId,
                  'cancelReason',
                  'checkoutUrl',
                  'qrCode',
                  'anomalies',
                  'managementNotes',
                  'phone',
                  'email',
                ]) {
                  assert.ok(!text.includes(secret), `leaked ${secret}`);
                }
              },
            );

            // ===================================================================== payments
            await suite.test(
              'payments: succeeded ones only, reversed ones flagged, totals mirror the staff view',
              async () => {
                const invoice = await finalized([exact, ranged], { ownerUserId: alice.id });
                const first = await pay(invoice.id, 100_000);
                // A pending PayOS request is an internal payment attempt: the customer neither sees nor is credited it.
                const request = await ok(() =>
                  invoices.createPayos(collector.token, invoice.id, {
                    amountVnd: '50000',
                    idempotencyKey: randomUUID(),
                  }),
                );
                assert.equal(request.payment.status, 'PENDING');
                let view = await mine.detail(alice.token, invoice.id);
                assert.equal(view.status, 'PENDING_PAYMENT');
                assert.deepEqual(
                  view.payments.map((payment) => [
                    payment.id,
                    payment.method,
                    payment.amountVnd,
                    payment.reversed,
                  ]),
                  [[first.payment.id, 'CASH', '100000', false]],
                );
                assert.deepEqual(Object.keys(view.payments[0]!).sort(), [
                  'amountVnd',
                  'id',
                  'method',
                  'paidAt',
                  'reversed',
                ]);
                assert.equal(view.payments[0]?.paidAt, first.payment.collectedAt);
                assert.equal(view.paidVnd, '100000');
                assert.equal(view.balanceVnd, '200000');
                assert.ok(!JSON.stringify(view).includes(request.payment.id));

                // Split payment completes it.
                const staffBefore = await staffView(invoice.id);
                assert.equal(staffBefore.paidVnd, '100000');
                await ok(() =>
                  invoices.cancelPayos(collector.token, invoice.id, request.payment.id),
                );
                const second = await pay(invoice.id, 200_000);
                view = await mine.detail(alice.token, invoice.id);
                const staff = await staffView(invoice.id);
                assert.equal(view.status, 'PAID');
                assert.equal(view.paidVnd, '300000');
                assert.equal(view.balanceVnd, '0');
                assert.equal(view.paidAt, staff.paidAt);
                assert.ok(view.paidAt);
                assert.deepEqual(
                  view.payments.map((payment) => payment.id),
                  [first.payment.id, second.payment.id],
                );

                // A reversal reopens the invoice; the reversed payment stays listed and flagged, without reason or staff.
                await ok(() =>
                  invoices.reversePayment(corrector.token, invoice.id, second.payment.id, {
                    reason: 'Nhập nhầm số tiền',
                  }),
                );
                view = await mine.detail(alice.token, invoice.id);
                const staffAfter = await staffView(invoice.id);
                assert.equal(view.status, staffAfter.status);
                assert.equal(view.paidVnd, staffAfter.paidVnd);
                assert.equal(view.balanceVnd, staffAfter.balanceVnd);
                assert.equal(view.paidVnd, '100000');
                assert.deepEqual(
                  view.payments.map((payment) => [payment.id, payment.reversed]),
                  [
                    [first.payment.id, false],
                    [second.payment.id, true],
                  ],
                );
                assert.ok(!JSON.stringify(view).includes('Nhập nhầm'));
                assert.ok(!JSON.stringify(view).includes(corrector.id));
              },
            );

            // ===================================================================== discount
            await suite.test(
              'the applied voucher benefit is shown by name, code and amount',
              async () => {
                const HOUR = 3_600_000;
                const version: DiscountVersionInput = {
                  kind: 'PERCENT',
                  percentBp: 1000,
                  validFrom: new Date(Date.now() - 24 * HOUR).toISOString(),
                  validUntil: new Date(Date.now() + 720 * HOUR).toISOString(),
                  minSpendVnd: '0',
                  scopeMode: 'ALL_SERVICES',
                  serviceIds: [],
                  categoryIds: [],
                  usageLimitTotal: null,
                  usageLimitPerCustomer: null,
                };
                const program = await discounts.create(admin.token, {
                  code: `CI${run}`,
                  nameVi: 'Giảm mười phần trăm',
                  nameEn: 'Ten percent off',
                  requiresCode: true,
                  version,
                });
                const withVoucher = await discounts.createVoucher(admin.token, program.id, {
                  code: `VC${run}`,
                });
                const voucher = withVoucher.vouchers[0]!;
                const drafted = await priceAll(
                  await draft(await completedVisit([exact], { ownerUserId: alice.id })),
                );
                const supplied = await ok(() =>
                  invoices.supplyVoucher(cashier.token, drafted.id, {
                    expectedVersion: drafted.version,
                    code: voucher.code,
                  }),
                );
                const done = await finalize(supplied);
                const view = await mine.detail(alice.token, done.id);
                assert.equal(view.subtotalVnd, '200000');
                assert.equal(view.discountTotalVnd, '20000');
                assert.equal(view.totalVnd, '180000');
                assert.deepEqual(view.discount, {
                  nameVi: 'Giảm mười phần trăm',
                  nameEn: 'Ten percent off',
                  voucherCode: voucher.code,
                  amountVnd: '20000',
                });
                const text = JSON.stringify(view);
                assert.ok(!text.includes('candidates') && !text.includes('selectionReason'));
              },
            );

            // ===================================================================== lifecycle
            await suite.test(
              'zero-balance PAID and cancelled-after-finalization invoices are history too; cancel data stays internal',
              async () => {
                const zero = await finalized([free], { ownerUserId: alice.id });
                assert.equal(zero.status, 'PAID');
                const zeroView = await mine.detail(alice.token, zero.id);
                assert.equal(zeroView.status, 'PAID');
                assert.equal(zeroView.totalVnd, '0');
                assert.equal(zeroView.paidVnd, '0');
                assert.equal(zeroView.balanceVnd, '0');
                assert.deepEqual(zeroView.payments, []);
                assert.ok(zeroView.paidAt);

                const unpaid = await finalized([exact], { ownerUserId: alice.id });
                await ok(() =>
                  invoices.cancel(canceller.token, unpaid.id, {
                    expectedVersion: unpaid.version,
                    reason: 'Khách yêu cầu hủy hóa đơn',
                  }),
                );
                const cancelled = await mine.detail(alice.token, unpaid.id);
                assert.equal(cancelled.status, 'CANCELLED');
                assert.ok(cancelled.cancelledAt);
                assert.equal(cancelled.balanceVnd, '0');
                assert.equal(cancelled.paidVnd, '0');
                assert.equal(cancelled.totalVnd, '200000', 'the frozen amounts stay');
                assert.ok(!JSON.stringify(cancelled).includes('Khách yêu cầu'));
                assert.ok((await listOf(alice.token)).includes(unpaid.id));
              },
            );

            // ===================================================================== list
            await suite.test(
              'the list is newest first, paged by cursor, and never leaks across customers',
              async () => {
                const made: string[] = [];
                for (let index = 0; index < 5; index += 1) {
                  made.push((await finalized([exact], { ownerUserId: alice.id })).id);
                  // A different customer's invoice interleaved in time must never appear in Alice's pages.
                  await finalized([exact], { ownerUserId: bob.id });
                }
                const everything = await tx.invoice.findMany({
                  where: { payerUserId: alice.id, finalizedAt: { not: null } },
                  orderBy: [{ finalizedAt: 'desc' }, { id: 'desc' }],
                  select: { id: true },
                });
                const expected = everything.map((row) => row.id);
                for (const id of made) assert.ok(expected.includes(id));

                const pages: string[][] = [];
                let cursor: string | undefined;
                do {
                  const page = await customerInvoiceList(tx, alice.id, cursor, 2);
                  assert.ok(page.invoices.length <= 2);
                  pages.push(page.invoices.map((entry) => entry.id));
                  cursor = page.nextCursor ?? undefined;
                } while (cursor);
                assert.deepEqual(pages.flat(), expected, 'every invoice once, newest first');
                assert.ok(pages.length >= 3);

                // The service pages the same way with its own page size and a plain cursor.
                const first = await mine.list(alice.token, undefined);
                assert.deepEqual(
                  first.invoices.map((entry) => entry.id),
                  expected.slice(0, 20),
                );
                // A cursor from another customer's list, or a malformed one, is rejected the same way.
                const bobs = (await mine.list(bob.token, undefined)).invoices;
                assert.ok(bobs.length > 0);
                await fails(
                  () => mine.list(alice.token, bobs[0]!.id),
                  'VALIDATION_FAILED',
                  'cursor',
                );
                await fails(
                  () => mine.list(alice.token, randomUUID()),
                  'VALIDATION_FAILED',
                  'cursor',
                );
                await fails(() => mine.list(alice.token, 'x'), 'VALIDATION_FAILED', 'cursor');
              },
            );

            // ===================================================================== read only
            await suite.test('reading history writes nothing', async () => {
              const invoice = await finalized([exact], { ownerUserId: alice.id });
              const counts = async () => ({
                audit: await tx.auditEvent.count(),
                outbox: await tx.outboxEvent.count(),
                invoices: await tx.invoice.count(),
                payments: await tx.payment.count(),
                version: (await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
                  .rowVersion,
              });
              const before = await counts();
              await mine.list(alice.token, undefined);
              await mine.detail(alice.token, invoice.id);
              await mine.detail(bob.token, invoice.id).catch(() => undefined);
              assert.deepEqual(await counts(), before);
            });

            throw rollback;
          },
          { timeout: 300_000, maxWait: 30_000 },
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
