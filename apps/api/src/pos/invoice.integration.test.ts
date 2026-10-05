import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { InvoiceResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 4 Step 5: the Invoice / POS workflow against real PostgreSQL. Every fixture (and every command)
 * rolls back with the outer transaction; concurrency is covered by the separate race suite. After each
 * command the deferred Step 4 integrity triggers are forced to run (`settle`), so a command that would
 * fail the database's commit-time checks fails here too.
 */
test(
  'Phase 4 Step 5 invoice / POS workflow; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 5 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `invoice_${++savepoint}`;
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
            type Code = 'VIEW_INVOICES' | 'MANAGE_INVOICES' | 'CANCEL_INVOICES';
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
              cancel: await makeRole('CANCEL', ['CANCEL_INVOICES']),
              cashier: await makeRole('CASHIER', ['VIEW_INVOICES', 'MANAGE_INVOICES']),
              boss: await makeRole('BOSS', ['VIEW_INVOICES', 'MANAGE_INVOICES', 'CANCEL_INVOICES']),
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
            const nail = await makeService('NAIL', [5_000n, 10_000n], 'PER_NAIL', 10);
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
            const cashier = await staffUser(at(roles.cashier.id));
            const viewer = await staffUser(at(roles.view.id));
            const manageOnly = await staffUser(at(roles.manage.id));
            const cancelOnly = await staffUser(at(roles.cancel.id));
            const boss = await staffUser(at(roles.boss.id), { reauthenticated: true });
            const bossStale = await staffUser(at(roles.boss.id));
            const outsider = await staffUser(at(roles.boss.id, elsewhere.id), {
              reauthenticated: true,
            });
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
            const other = await customer('other');

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
            const lineOf = (invoice: InvoiceResponse, code: string) =>
              invoice.lines.find((line) => line.itemCode === code)!;
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

            // ================================================================== creation
            await suite.test(
              'open: completed visit only; DONE lines exactly once; historical snapshot; defaults; retry-safe',
              async () => {
                const open = await tx.visit.create({
                  data: {
                    code: `VS-IV-${run}-OPEN`,
                    branchId: branch.id,
                    origin: 'WALK_IN',
                    serviceDate: new Date('2027-03-01T00:00:00.000Z'),
                    arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                    createdByUserId: cashier.id,
                    idempotencyKey: randomUUID(),
                  },
                });
                await fails(
                  () => invoices.open(cashier.token, open.id),
                  'INVOICE_VISIT_NOT_COMPLETED',
                );
                assert.equal(await tx.invoice.count({ where: { visitId: open.id } }), 0);
                await fails(() => invoices.open(cashier.token, randomUUID()), 'NOT_FOUND');
                await fails(() => invoices.open(cashier.token, 'not-a-uuid'), 'NOT_FOUND');

                const visit = await completedVisit([ranged, exact, nail, free], {
                  cancelled: 1,
                  ownerUserId: owner.id,
                });
                const opened = await ok(() => invoices.open(cashier.token, visit.id, 'req-1'));
                assert.equal(opened.created, true);
                const invoice = opened.invoice;
                assert.equal(invoice.status, 'DRAFT');
                assert.match(invoice.code, /^INV-\d{6}-[A-HJ-NP-Z2-9]{6}$/);
                assert.equal(invoice.version, 1);
                assert.equal(invoice.calculationVersion, 2);
                // Exactly the performed lines, once each; the cancelled line is never invoiced.
                assert.equal(invoice.lines.length, 4);
                assert.deepEqual(
                  invoice.lines.map((line) => line.visitServiceLineId).sort(),
                  visit.done.map((entry) => entry.id).sort(),
                );
                assert.ok(
                  !invoice.lines.some((line) => visit.cancelled.includes(line.visitServiceLineId)),
                );
                assert.equal(
                  await tx.invoiceLineService.count({ where: { invoiceId: invoice.id } }),
                  4,
                );
                // Historical snapshot, quantity limit included; auto-priced exact services.
                const rangedLine = lineOf(invoice, ranged.code);
                assert.deepEqual(
                  [rangedLine.priceMinVnd, rangedLine.priceMaxVnd, rangedLine.quantityLimit],
                  ['100000', '150000', 1],
                );
                assert.deepEqual([rangedLine.quantity, rangedLine.unitPriceVnd], [1, null]);
                assert.equal(rangedLine.priceEditable, true);
                const exactLine = lineOf(invoice, exact.code);
                assert.deepEqual(
                  [exactLine.quantity, exactLine.unitPriceVnd, exactLine.grossVnd],
                  [1, '200000', '200000'],
                );
                assert.equal(exactLine.priceEditable, false);
                const nailLine = lineOf(invoice, nail.code);
                assert.deepEqual(
                  [nailLine.quantity, nailLine.unitPriceVnd, nailLine.quantityLimit],
                  [null, null, 10],
                );
                assert.equal(invoice.subtotalVnd, '200000');
                assert.equal(invoice.totalVnd, '200000');
                assert.equal(invoice.discountTotalVnd, '0');
                assert.deepEqual(invoice.readiness, { ready: false, unpricedLines: 3 });
                // The booking owner is the default payer; a member payer is a customer account.
                assert.equal(invoice.payer?.id, owner.id);
                assert.equal(invoice.defaultPayer?.id, owner.id);
                assert.match(invoice.payer?.emailMasked ?? '', /^i•••@/);
                // Audit (FINANCIAL) and no event on creation.
                const [created] = await audits(invoice.id, 'INVOICE_CREATED');
                assert.ok(created);
                assert.equal(created.dataClassification, 'FINANCIAL');
                assert.equal(created.branchId, branch.id);
                assert.equal(created.actorUserId, cashier.id);
                assert.equal((await events(invoice.id)).length, 0);
                // A retry / double click / another cashier returns the SAME invoice: no second row or audit.
                const again = await ok(() => invoices.open(cashier.token, visit.id));
                assert.equal(again.created, false);
                assert.equal(again.invoice.id, invoice.id);
                const byOther = await ok(() => invoices.open(boss.token, visit.id));
                assert.equal(byOther.invoice.id, invoice.id);
                assert.equal(await tx.invoice.count({ where: { visitId: visit.id } }), 1);
                assert.equal((await audits(invoice.id, 'INVOICE_CREATED')).length, 1);

                // Later catalog changes never alter the transaction: the snapshot is the source.
                await tx.service.update({
                  where: { id: ranged.id },
                  data: { priceVnd: 1n, priceMaxVnd: 999_999n, rowVersion: { increment: 1 } },
                });
                await tx.service.update({
                  where: { id: nail.id },
                  data: { maxQuantity: 99, rowVersion: { increment: 1 } },
                });
                const reread = await ok(() => invoices.get(cashier.token, invoice.id));
                const rangedAfter = lineOf(reread, ranged.code);
                assert.deepEqual(
                  [rangedAfter.priceMinVnd, rangedAfter.priceMaxVnd],
                  ['100000', '150000'],
                );
                assert.equal(lineOf(reread, nail.code).quantityLimit, 10);
                await fails(
                  () =>
                    invoices.setPrice(cashier.token, invoice.id, rangedLine.id, {
                      expectedVersion: reread.version,
                      unitPriceVnd: '999',
                    }),
                  'VALIDATION_FAILED',
                  'unitPriceVnd',
                );
                await tx.service.update({
                  where: { id: ranged.id },
                  data: { priceVnd: 100_000n, priceMaxVnd: 150_000n, rowVersion: { increment: 1 } },
                });
                await tx.service.update({
                  where: { id: nail.id },
                  data: { maxQuantity: 10, rowVersion: { increment: 1 } },
                });
                // The visit is never mutated by invoicing.
                const stored = await tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
                assert.equal(stored.status, 'COMPLETED');
                // A walk-in without a booking owner: guest payer (no account is inferred or created).
                const guestVisit = await completedVisit([exact]);
                const usersBefore = await tx.user.count();
                const guestInvoice = await draft(guestVisit);
                assert.equal(guestInvoice.payer, null);
                assert.equal(guestInvoice.defaultPayer, null);
                assert.equal(
                  await tx.user.count(),
                  usersBefore,
                  'no account is created for a guest',
                );
              },
            );

            await suite.test(
              'open: authorization and branch scope are decided in the transaction',
              async () => {
                const visit = await completedVisit([exact]);
                await fails(() => invoices.open(viewer.token, visit.id), 'FORBIDDEN');
                await fails(() => invoices.open(cancelOnly.token, visit.id), 'FORBIDDEN');
                await fails(() => invoices.open(nobody.token, visit.id), 'FORBIDDEN');
                await fails(() => invoices.open(outsider.token, visit.id), 'FORBIDDEN');
                await fails(() => invoices.open(owner.token, visit.id), 'FORBIDDEN'); // customers never pass the frame
                await fails(() => invoices.open(undefined, visit.id), 'AUTHENTICATION_REQUIRED');
                assert.equal(await tx.invoice.count({ where: { visitId: visit.id } }), 0);
                // MANAGE alone is enough to open (design: the commands and VIEW are independent checks).
                const opened = await ok(() => invoices.open(manageOnly.token, visit.id));
                assert.equal(opened.created, true);
                assert.equal(opened.invoice.actions.editPrices, true);
                assert.equal(opened.invoice.actions.cancel, false);
                // Another branch's visit is out of scope for a branch-scoped actor.
                const foreign = await completedVisit([exact], { branchId: elsewhere.id });
                await fails(() => invoices.open(cashier.token, foreign.id), 'FORBIDDEN');
                const foreignOpened = await ok(() => invoices.open(outsider.token, foreign.id));
                assert.equal(foreignOpened.invoice.branch.id, elsewhere.id);
                await fails(
                  () => invoices.get(cashier.token, foreignOpened.invoice.id),
                  'FORBIDDEN',
                );
              },
            );

            // ==================================================================== price / quantity
            await suite.test(
              'price and quantity: inside the historical range and limit only; deterministic totals; audited',
              async () => {
                const visit = await completedVisit([ranged, nail, exact, free]);
                let invoice = await draft(visit);
                const rangedLine = lineOf(invoice, ranged.code);
                const nailLine = lineOf(invoice, nail.code);
                const exactLine = lineOf(invoice, exact.code);
                const set = (
                  line: { id: string },
                  body: { unitPriceVnd?: string; quantity?: number },
                  actor: Person = cashier,
                  expectedVersion = invoice.version,
                ) =>
                  invoices.setPrice(actor.token, invoice.id, line.id, { expectedVersion, ...body });
                // Outside the historical range: rejected, nothing written.
                for (const price of ['99999', '150001', '0']) {
                  await fails(
                    () => set(rangedLine, { unitPriceVnd: price }),
                    'VALIDATION_FAILED',
                    'unitPriceVnd',
                  );
                }
                for (const bad of ['-1', '1.5', '1e5', '0100000', '', 'abc']) {
                  await fails(
                    () => set(rangedLine, { unitPriceVnd: bad }),
                    'VALIDATION_FAILED',
                    'unitPriceVnd',
                  );
                }
                await fails(
                  () => set(exactLine, { unitPriceVnd: '199999' }),
                  'VALIDATION_FAILED',
                  'unitPriceVnd',
                );
                // Quantity: positive integer within the snapshotted limit; PER_SERVICE is exactly 1.
                for (const bad of [0, -1, 11, 1.5]) {
                  await fails(
                    () => set(nailLine, { quantity: bad }),
                    'VALIDATION_FAILED',
                    'quantity',
                  );
                }
                await fails(
                  () => set(nailLine, { quantity: '3' as never }),
                  'VALIDATION_FAILED',
                  'quantity',
                );
                await fails(
                  () => set(rangedLine, { quantity: 2 }),
                  'VALIDATION_FAILED',
                  'quantity',
                );
                await fails(() => set(rangedLine, {}), 'VALIDATION_FAILED');
                assert.equal(
                  (await ok(() => invoices.get(cashier.token, invoice.id))).version,
                  invoice.version,
                );
                // Valid choices; totals are exact integer VND computed by the server.
                invoice = await ok(() => set(rangedLine, { unitPriceVnd: '120000' }));
                assert.equal(lineOf(invoice, ranged.code).grossVnd, '120000');
                assert.equal(
                  invoice.version,
                  2,
                  'the header recomputation bumps the invoice version once',
                );
                invoice = await ok(() => set(nailLine, { quantity: 4 }));
                assert.equal(
                  lineOf(invoice, nail.code).grossVnd,
                  null,
                  'no gross until the price is chosen too',
                );
                invoice = await ok(() => set(nailLine, { unitPriceVnd: '7000' }));
                assert.equal(lineOf(invoice, nail.code).grossVnd, '28000');
                // 120,000 + 4 x 7,000 + 200,000 (exact) = 348,000; the free service is still unpriced.
                assert.equal(invoice.subtotalVnd, '348000');
                assert.equal(invoice.totalVnd, '348000');
                assert.deepEqual(invoice.readiness, { ready: false, unpricedLines: 1 });
                // Boundaries are inclusive; large quantity x price stays exact.
                invoice = await ok(() => set(nailLine, { quantity: 10, unitPriceVnd: '10000' }));
                assert.equal(lineOf(invoice, nail.code).grossVnd, '100000');
                invoice = await ok(() => set(rangedLine, { unitPriceVnd: '150000' }));
                invoice = await ok(() => set(rangedLine, { unitPriceVnd: '100000' }));
                assert.equal(invoice.subtotalVnd, String(100_000 + 100_000 + 200_000));
                // Repeating the same choice is a no-op: no version bump, audit or write.
                const before = invoice.version;
                const auditsBefore = (await audits(invoice.id, 'INVOICE_PRICE_SET')).length;
                const same = await ok(() => set(rangedLine, { unitPriceVnd: '100000' }));
                assert.equal(same.version, before);
                assert.equal((await audits(invoice.id, 'INVOICE_PRICE_SET')).length, auditsBefore);
                // A stale version is a conflict and writes nothing.
                await fails(
                  () => set(rangedLine, { unitPriceVnd: '110000' }, cashier, before - 1),
                  'CONFLICT',
                );
                assert.equal(
                  lineOf(await ok(() => invoices.get(cashier.token, invoice.id)), ranged.code)
                    .unitPriceVnd,
                  '100000',
                );
                // Authority: MANAGE_INVOICES at the invoice's branch, never by role name or UI.
                for (const denied of [viewer, cancelOnly, nobody, outsider]) {
                  await fails(
                    () => set(rangedLine, { unitPriceVnd: '110000' }, denied),
                    'FORBIDDEN',
                  );
                }
                // A line id of another invoice / unknown id is not found.
                await fails(
                  () => set({ id: randomUUID() }, { unitPriceVnd: '110000' }),
                  'NOT_FOUND',
                );
                // Audit: FINANCIAL, the selected values and the historical range/limit.
                const trail = await audits(invoice.id, 'INVOICE_PRICE_SET');
                assert.ok(trail.length >= 5);
                for (const event of trail) {
                  assert.equal(event.dataClassification, 'FINANCIAL');
                  assert.equal(event.actorUserId, cashier.id);
                  assert.equal(event.branchId, branch.id);
                }
                const first = trail[0]!;
                const firstAfter = first.after as Record<string, unknown>;
                assert.equal(firstAfter['unitPriceVnd'], '120000');
                assert.equal(firstAfter['priceRangeMinVnd'], '100000');
                assert.equal(firstAfter['priceRangeMaxVnd'], '150000');
                assert.equal(firstAfter['quantityLimit'], 1);
                assert.equal((first.before as Record<string, unknown>)['unitPriceVnd'], null);
              },
            );

            // ======================================================================== payer
            await suite.test(
              'payer: booking owner by default; exact member lookup; guest; no fabricated identity; DRAFT only',
              async () => {
                const visit = await completedVisit([exact], { ownerUserId: owner.id });
                let invoice = await draft(visit);
                assert.equal(invoice.payer?.id, owner.id);
                // Exact lookup, masked, MANAGE_INVOICES only; never a partial match or enumeration.
                const phone = `0${owner.phoneCanonical!.slice(3)}`;
                const found = await ok(() => invoices.members(cashier.token, branch.id, { phone }));
                assert.equal(found.members.length, 1);
                assert.equal(found.members[0]!.id, owner.id);
                assert.deepEqual(Object.keys(found.members[0]!).sort(), [
                  'displayName',
                  'emailMasked',
                  'id',
                  'phoneMasked',
                ]);
                const emailFound = await ok(() =>
                  invoices.members(cashier.token, branch.id, { email: other.emailCanonical! }),
                );
                assert.equal(emailFound.members[0]!.id, other.id);
                assert.equal(
                  (await invoices.members(cashier.token, branch.id, { phone: '0999000111' }))
                    .members.length,
                  0,
                );
                await fails(
                  () => invoices.members(cashier.token, branch.id, {}),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => invoices.members(viewer.token, branch.id, { phone }),
                  'FORBIDDEN',
                );
                await fails(
                  () => invoices.members(outsider.token, branch.id, { phone }),
                  'FORBIDDEN',
                );
                // Attach another member, then a guest payer (null); the change is versioned and audited.
                invoice = await ok(() =>
                  invoices.payer(cashier.token, invoice.id, {
                    expectedVersion: invoice.version,
                    payerUserId: other.id,
                  }),
                );
                assert.equal(invoice.payer?.id, other.id);
                assert.equal(
                  invoice.defaultPayer?.id,
                  owner.id,
                  'the booking owner stays the default',
                );
                invoice = await ok(() =>
                  invoices.payer(cashier.token, invoice.id, {
                    expectedVersion: invoice.version,
                    payerUserId: null,
                  }),
                );
                assert.equal(invoice.payer, null);
                const stored = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
                assert.equal(stored.payerUserId, null);
                // Same payer again: no-op. Invalid payers: employee, unknown, inactive customer.
                const version = invoice.version;
                const same = await ok(() =>
                  invoices.payer(cashier.token, invoice.id, {
                    expectedVersion: version,
                    payerUserId: null,
                  }),
                );
                assert.equal(same.version, version);
                for (const bad of [ktv.id, randomUUID()]) {
                  await fails(
                    () =>
                      invoices.payer(cashier.token, invoice.id, {
                        expectedVersion: version,
                        payerUserId: bad,
                      }),
                    'VALIDATION_FAILED',
                    'payerUserId',
                  );
                }
                await fails(
                  () =>
                    invoices.payer(cashier.token, invoice.id, {
                      expectedVersion: version,
                      payerUserId: 'nope' as never,
                    }),
                  'VALIDATION_FAILED',
                  'payerUserId',
                );
                await fails(
                  () =>
                    invoices.payer(cashier.token, invoice.id, {
                      expectedVersion: version - 1,
                      payerUserId: other.id,
                    }),
                  'CONFLICT',
                );
                for (const denied of [viewer, cancelOnly, nobody, outsider]) {
                  await fails(
                    () =>
                      invoices.payer(denied.token, invoice.id, {
                        expectedVersion: version,
                        payerUserId: other.id,
                      }),
                    'FORBIDDEN',
                  );
                }
                const trail = await audits(invoice.id, 'INVOICE_PAYER_SET');
                assert.equal(trail.length, 2);
                assert.ok(trail.every((event) => event.dataClassification === 'FINANCIAL'));
                assert.deepEqual(trail[0]!.after, {
                  payerUserId: other.id,
                  payerKind: 'MEMBER',
                  discountTotalVnd: '0',
                });
                assert.deepEqual(trail[1]!.after, {
                  payerUserId: null,
                  payerKind: 'GUEST',
                  discountTotalVnd: '0',
                });
                // Frozen at finalization.
                invoice = await priceAll(invoice);
                invoice = await ok(() =>
                  invoices.finalize(cashier.token, invoice.id, {
                    expectedVersion: invoice.version,
                  }),
                );
                await fails(
                  () =>
                    invoices.payer(cashier.token, invoice.id, {
                      expectedVersion: invoice.version,
                      payerUserId: other.id,
                    }),
                  'INVOICE_STATE_INVALID',
                );
                assert.equal(invoice.payer, null);
              },
            );

            // ==================================================================== finalize
            await suite.test(
              'finalize: server totals, PENDING_PAYMENT, frozen facts, events, replay, authority',
              async () => {
                const visit = await completedVisit([ranged, nail]);
                let invoice = await draft(visit);
                await fails(
                  () =>
                    invoices.finalize(cashier.token, invoice.id, {
                      expectedVersion: invoice.version,
                    }),
                  'INVOICE_NOT_READY',
                );
                invoice = await priceAll(invoice);
                assert.equal(invoice.readiness.ready, true);
                assert.equal(invoice.actions.finalize, true);
                const nailLine = lineOf(invoice, nail.code);
                invoice = await ok(() =>
                  invoices.setPrice(cashier.token, invoice.id, nailLine.id, {
                    expectedVersion: invoice.version,
                    quantity: 6,
                    unitPriceVnd: '7500',
                  }),
                );
                // 100,000 (minimum) + 6 x 7,500 = 145,000, computed on the server.
                assert.equal(invoice.subtotalVnd, '145000');
                const draftVersion = invoice.version;
                for (const denied of [viewer, cancelOnly, nobody, outsider]) {
                  await fails(
                    () =>
                      invoices.finalize(denied.token, invoice.id, {
                        expectedVersion: draftVersion,
                      }),
                    'FORBIDDEN',
                  );
                }
                await fails(
                  () =>
                    invoices.finalize(cashier.token, invoice.id, {
                      expectedVersion: draftVersion - 1,
                    }),
                  'CONFLICT',
                );
                assert.equal(
                  (await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
                  'DRAFT',
                );
                const at = Date.now();
                const done = await ok(() =>
                  invoices.finalize(cashier.token, invoice.id, { expectedVersion: draftVersion }),
                );
                assert.equal(done.status, 'PENDING_PAYMENT');
                assert.equal(done.subtotalVnd, '145000');
                assert.equal(done.totalVnd, '145000');
                assert.equal(done.discountTotalVnd, '0');
                assert.equal(done.version, draftVersion + 1);
                assert.equal(done.paidAt, null);
                assert.equal(done.paidSeq, 0);
                assert.ok(done.finalizedAt && Date.parse(done.finalizedAt) > at - 60_000);
                assert.deepEqual(
                  [done.actions.editPrices, done.actions.setPayer, done.actions.finalize],
                  [false, false, false],
                );
                assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
                // Audit + event (FINANCIAL, ids and amounts only; published_at never used).
                const [audit] = await audits(invoice.id, 'INVOICE_FINALIZED');
                assert.ok(audit);
                assert.equal(audit.dataClassification, 'FINANCIAL');
                const after = audit.after as Record<string, unknown>;
                assert.equal(after['totalVnd'], '145000');
                assert.equal(after['zeroBalance'], false);
                assert.equal((after['lines'] as unknown[]).length, 2);
                const emitted = await events(invoice.id);
                assert.deepEqual(
                  emitted.map((event) => event.eventType),
                  ['INVOICE_FINALIZED'],
                );
                assert.equal(emitted[0]!.publishedAt, null);
                assert.equal(emitted[0]!.branchId, branch.id);
                assert.deepEqual(emitted[0]!.payload, {
                  invoiceId: invoice.id,
                  branchId: branch.id,
                  visitId: visit.id,
                  totalVnd: '145000',
                  discountTotalVnd: '0',
                  calculationVersion: 2,
                });
                // Replay by the same actor: the current state, no second audit or event.
                const replay = await ok(() =>
                  invoices.finalize(cashier.token, invoice.id, { expectedVersion: draftVersion }),
                );
                assert.equal(replay.status, 'PENDING_PAYMENT');
                assert.equal((await audits(invoice.id, 'INVOICE_FINALIZED')).length, 1);
                assert.equal((await events(invoice.id)).length, 1);
                // Another actor / a later stale request does not silently re-finalize.
                await fails(
                  () =>
                    invoices.finalize(boss.token, invoice.id, { expectedVersion: draftVersion }),
                  'CONFLICT',
                );
                // A finalized invoice cannot be edited through the API ...
                await fails(
                  () =>
                    invoices.setPrice(cashier.token, invoice.id, nailLine.id, {
                      expectedVersion: done.version,
                      quantity: 2,
                    }),
                  'INVOICE_STATE_INVALID',
                );
                await fails(
                  () =>
                    invoices.finalize(cashier.token, invoice.id, { expectedVersion: done.version }),
                  'INVOICE_STATE_INVALID',
                );
                // ... nor silently rewritten by anything else (the Step 4 guards refuse raw writes too).
                await assert.rejects(
                  isolated((client) =>
                    client.$executeRawUnsafe(
                      `UPDATE invoices SET total_vnd = 1, subtotal_vnd = 1, row_version = row_version + 1 WHERE id = '${invoice.id}'`,
                    ),
                  ),
                  /finalized invoice keeps/,
                );
                await assert.rejects(
                  isolated((client) =>
                    client.$executeRawUnsafe(`DELETE FROM invoices WHERE id = '${invoice.id}'`),
                  ),
                  /never deleted/,
                );
                // The board shows it; the visit is no longer awaiting an invoice.
                const board = await ok(() => invoices.board(viewer.token, branch.id, undefined));
                assert.ok(
                  board.invoices.some(
                    (entry) => entry.id === invoice.id && entry.status === 'PENDING_PAYMENT',
                  ),
                );
                assert.ok(!board.awaiting.some((entry) => entry.visitId === visit.id));
              },
            );

            // ============================================================== zero balance
            await suite.test(
              'zero balance: PAID directly with no Payment row; OP-7 cancellation only for such invoices',
              async () => {
                const visit = await completedVisit([free], { ownerUserId: owner.id });
                let invoice = await draft(visit);
                const line = invoice.lines[0]!;
                invoice = await ok(() =>
                  invoices.setPrice(cashier.token, invoice.id, line.id, {
                    expectedVersion: invoice.version,
                    unitPriceVnd: '0',
                  }),
                );
                assert.equal(invoice.totalVnd, '0');
                const paid = await ok(() =>
                  invoices.finalize(cashier.token, invoice.id, {
                    expectedVersion: invoice.version,
                  }),
                );
                assert.equal(paid.status, 'PAID');
                assert.equal(paid.totalVnd, '0');
                assert.equal(paid.paidSeq, 1);
                assert.equal(paid.paidAt, paid.finalizedAt);
                assert.equal(
                  await tx.payment.count({ where: { invoiceId: invoice.id } }),
                  0,
                  'no fake 0-VND payment',
                );
                assert.deepEqual(
                  (await events(invoice.id)).map((event) => event.eventType),
                  ['INVOICE_FINALIZED', 'INVOICE_PAID'],
                );
                const [paidEvent] = (await events(invoice.id)).filter(
                  (event) => event.eventType === 'INVOICE_PAID',
                );
                assert.deepEqual(paidEvent!.payload, {
                  invoiceId: invoice.id,
                  branchId: branch.id,
                  visitId: visit.id,
                  paidSeq: 1,
                  totalVnd: '0',
                  settlement: 'ZERO_BALANCE',
                });
                const [paidAudit] = await audits(invoice.id, 'INVOICE_PAID');
                assert.equal(paidAudit!.dataClassification, 'FINANCIAL');
                assert.equal(
                  (paidAudit!.after as Record<string, unknown>)['settlement'],
                  'ZERO_BALANCE',
                );
                assert.equal(paid.actions.cancel, false, 'the cashier has no CANCEL_INVOICES');
                // OP-7: CANCEL_INVOICES + reason + FRESH re-authentication.
                const reason = 'Áp nhầm giá 0';
                await fails(
                  () =>
                    invoices.cancel(cashier.token, invoice.id, {
                      expectedVersion: paid.version,
                      reason,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    invoices.cancel(bossStale.token, invoice.id, {
                      expectedVersion: paid.version,
                      reason,
                    }),
                  'REAUTHENTICATION_REQUIRED',
                );
                await fails(
                  () =>
                    invoices.cancel(boss.token, invoice.id, {
                      expectedVersion: paid.version,
                      reason: '  ',
                    }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                await fails(
                  () =>
                    invoices.cancel(boss.token, invoice.id, {
                      expectedVersion: paid.version - 1,
                      reason,
                    }),
                  'CONFLICT',
                );
                const cancelled = await ok(() =>
                  invoices.cancel(boss.token, invoice.id, {
                    expectedVersion: paid.version,
                    reason,
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelledFromStatus, 'PAID');
                assert.equal(cancelled.cancelReason, reason);
                assert.equal(cancelled.paidSeq, 1, 'the voided paid episode is kept as history');
                assert.equal(cancelled.paidAt, paid.paidAt);
                assert.equal(cancelled.totalVnd, '0');
                const [cancelAudit] = await audits(invoice.id, 'INVOICE_CANCELLED');
                const cancelAfter = cancelAudit!.after as Record<string, unknown>;
                assert.equal(cancelAudit!.dataClassification, 'FINANCIAL');
                assert.equal(cancelAudit!.reason, reason);
                assert.equal(cancelAfter['cancellationPath'], 'ZERO_BALANCE_CORRECTION');
                assert.equal(cancelAfter['voidedPaidSeq'], 1);
                assert.ok(cancelAfter['reauthenticatedAt']);
                const cancelEvents = (await events(invoice.id)).filter(
                  (event) => event.eventType === 'INVOICE_CANCELLED',
                );
                assert.equal(cancelEvents.length, 1);
                assert.deepEqual(cancelEvents[0]!.payload, {
                  invoiceId: invoice.id,
                  branchId: branch.id,
                  visitId: visit.id,
                  cancelledFrom: 'PAID',
                  zeroBalanceCorrection: true,
                  voidedPaidSeq: 1,
                  redemptionReleased: false,
                });
                // Replay by the same actor is quiet; a new invoice may be created for the visit afterwards.
                const replay = await ok(() =>
                  invoices.cancel(boss.token, invoice.id, {
                    expectedVersion: paid.version,
                    reason,
                  }),
                );
                assert.equal(replay.status, 'CANCELLED');
                assert.equal((await audits(invoice.id, 'INVOICE_CANCELLED')).length, 1);
                const fresh = await ok(() => invoices.open(cashier.token, visit.id));
                assert.equal(fresh.created, true);
                assert.notEqual(fresh.invoice.id, invoice.id);
                assert.equal(
                  await tx.invoice.count({ where: { visitId: visit.id } }),
                  2,
                  'history is preserved',
                );
              },
            );

            // ==================================================================== cancel
            await suite.test(
              'cancel: DRAFT without re-authentication; PENDING_PAYMENT with it; never a financially settled invoice',
              async () => {
                const reason = 'Khách hủy';
                // DRAFT: CANCEL_INVOICES + reason, no re-authentication (bossStale has none).
                const draftVisit = await completedVisit([ranged]);
                const draftInvoice = await draft(draftVisit);
                await fails(
                  () =>
                    invoices.cancel(manageOnly.token, draftInvoice.id, {
                      expectedVersion: draftInvoice.version,
                      reason,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    invoices.cancel(viewer.token, draftInvoice.id, {
                      expectedVersion: draftInvoice.version,
                      reason,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    invoices.cancel(outsider.token, draftInvoice.id, {
                      expectedVersion: draftInvoice.version,
                      reason,
                    }),
                  'FORBIDDEN',
                );
                assert.equal(
                  draftInvoice.actions.cancel,
                  false,
                  'the cashier is not offered cancellation',
                );
                const seen = await ok(() => invoices.get(bossStale.token, draftInvoice.id));
                assert.equal(seen.actions.cancel, true);
                assert.equal(seen.actions.cancelNeedsReauth, false);
                const gone = await ok(() =>
                  invoices.cancel(bossStale.token, draftInvoice.id, {
                    expectedVersion: draftInvoice.version,
                    reason,
                  }),
                );
                assert.equal(gone.status, 'CANCELLED');
                assert.equal(gone.cancelledFromStatus, 'DRAFT');
                assert.equal(gone.finalizedAt, null);
                const [draftAudit] = await audits(draftInvoice.id, 'INVOICE_CANCELLED');
                assert.equal(
                  (draftAudit!.after as Record<string, unknown>)['cancellationPath'],
                  'DRAFT',
                );
                assert.equal(
                  (draftAudit!.after as Record<string, unknown>)['reauthenticatedAt'],
                  null,
                );
                // A cancelled draft cannot be edited or finalized; another actor cannot re-cancel it.
                await fails(
                  () =>
                    invoices.setPrice(cashier.token, draftInvoice.id, gone.lines[0]!.id, {
                      expectedVersion: gone.version,
                      unitPriceVnd: '120000',
                    }),
                  'INVOICE_STATE_INVALID',
                );
                await fails(
                  () =>
                    invoices.cancel(boss.token, draftInvoice.id, {
                      expectedVersion: gone.version,
                      reason,
                    }),
                  'INVOICE_STATE_INVALID',
                );
                // Reopening creates a NEW invoice; the cancelled one is untouched.
                const reopened = await ok(() => invoices.open(cashier.token, draftVisit.id));
                assert.equal(reopened.created, true);
                assert.notEqual(reopened.invoice.id, draftInvoice.id);

                // PENDING_PAYMENT: fresh re-authentication is required.
                const visit = await completedVisit([exact]);
                let invoice = await draft(visit);
                invoice = await ok(() =>
                  invoices.finalize(cashier.token, invoice.id, {
                    expectedVersion: invoice.version,
                  }),
                );
                assert.equal(invoice.status, 'PENDING_PAYMENT');
                const seenPending = await ok(() => invoices.get(bossStale.token, invoice.id));
                assert.equal(seenPending.actions.cancelNeedsReauth, true);
                await fails(
                  () =>
                    invoices.cancel(bossStale.token, invoice.id, {
                      expectedVersion: invoice.version,
                      reason,
                    }),
                  'REAUTHENTICATION_REQUIRED',
                );
                assert.equal(
                  (await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
                  'PENDING_PAYMENT',
                );
                const cancelled = await ok(() =>
                  invoices.cancel(boss.token, invoice.id, {
                    expectedVersion: invoice.version,
                    reason,
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelledFromStatus, 'PENDING_PAYMENT');
                assert.equal(
                  cancelled.totalVnd,
                  '200000',
                  'amounts are preserved, nothing is rewritten',
                );
                assert.equal(cancelled.lines.length, 1);
                const [pendingAudit] = await audits(invoice.id, 'INVOICE_CANCELLED');
                assert.equal(
                  (pendingAudit!.after as Record<string, unknown>)['cancellationPath'],
                  'UNPAID_FINALIZED',
                );
                assert.equal(pendingAudit!.reason, reason);
                assert.equal(pendingAudit!.dataClassification, 'FINANCIAL');
                assert.ok(
                  (await events(invoice.id)).some(
                    (event) =>
                      event.eventType === 'INVOICE_CANCELLED' &&
                      (event.payload as Record<string, unknown>)['zeroBalanceCorrection'] === false,
                  ),
                );
                // Payments belong to Step 7; if a payment row exists the Step 5 cancel path refuses.
                const paidVisit = await completedVisit([exact]);
                let paidInvoice = await draft(paidVisit);
                paidInvoice = await ok(() =>
                  invoices.finalize(cashier.token, paidInvoice.id, {
                    expectedVersion: paidInvoice.version,
                  }),
                );
                const payment = await tx.payment.create({
                  data: {
                    invoiceId: paidInvoice.id,
                    branchId: branch.id,
                    method: 'CASH',
                    status: 'SUCCEEDED',
                    amountDueVnd: 200_000n,
                    amountVnd: 100_000n,
                    tenderedVnd: 100_000n,
                    changeVnd: 0n,
                    collectedByUserId: cashier.id,
                    idempotencyKey: randomUUID(),
                  },
                });
                await settle();
                await fails(
                  () =>
                    invoices.cancel(boss.token, paidInvoice.id, {
                      expectedVersion: paidInvoice.version,
                      reason,
                    }),
                  'INVOICE_CANCEL_NOT_ALLOWED',
                );
                const covered = await tx.payment.create({
                  data: {
                    invoiceId: paidInvoice.id,
                    branchId: branch.id,
                    method: 'CASH',
                    status: 'SUCCEEDED',
                    amountDueVnd: 100_000n,
                    amountVnd: 100_000n,
                    tenderedVnd: 100_000n,
                    changeVnd: 0n,
                    collectedByUserId: cashier.id,
                    idempotencyKey: randomUUID(),
                  },
                });
                await tx.invoice.update({
                  where: { id: paidInvoice.id },
                  data: {
                    status: 'PAID',
                    paidAt: new Date(),
                    paidSeq: { increment: 1 },
                    rowVersion: { increment: 1 },
                  },
                });
                await settle();
                assert.ok(payment.id && covered.id);
                const fullyPaid = await ok(() => invoices.get(boss.token, paidInvoice.id));
                assert.equal(fullyPaid.status, 'PAID');
                assert.equal(
                  fullyPaid.actions.cancel,
                  false,
                  'a PAID invoice with a payment is never cancellable here',
                );
                await fails(
                  () =>
                    invoices.cancel(boss.token, paidInvoice.id, {
                      expectedVersion: fullyPaid.version,
                      reason,
                    }),
                  'INVOICE_CANCEL_NOT_ALLOWED',
                );
                assert.equal(
                  (await tx.invoice.findUniqueOrThrow({ where: { id: paidInvoice.id } })).status,
                  'PAID',
                );
              },
            );

            // ========================================================== board and reading
            await suite.test(
              'board and reading: VIEW_INVOICES at the record branch, awaiting visits, validation',
              async () => {
                const awaitingVisit = await completedVisit([exact]);
                const billedVisit = await completedVisit([exact]);
                const billed = await draft(billedVisit);
                const board = await ok(() => invoices.board(viewer.token, branch.id, '2027-03-01'));
                assert.equal(board.date, '2027-03-01');
                assert.equal(board.windowStart, '2027-02-23');
                assert.ok(board.awaiting.some((entry) => entry.visitId === awaitingVisit.id));
                assert.ok(!board.awaiting.some((entry) => entry.visitId === billedVisit.id));
                const entry = board.awaiting.find((row) => row.visitId === awaitingVisit.id)!;
                assert.deepEqual(entry.participants, ['Khách lẻ']);
                assert.equal(entry.performedServices, 1);
                assert.equal(board.canManage, false);
                const managerBoard = await ok(() =>
                  invoices.board(cashier.token, branch.id, '2027-03-01'),
                );
                assert.equal(managerBoard.canManage, true);
                // Invoices are listed by business date (today, the day the fixtures were invoiced).
                const today = await ok(() => invoices.board(viewer.token, branch.id, undefined));
                assert.ok(today.invoices.some((row) => row.id === billed.id));
                // Older / other-day windows do not list them and never create anything.
                const old = await ok(() => invoices.board(viewer.token, branch.id, '2020-01-10'));
                assert.equal(old.awaiting.length, 0);
                assert.ok(!old.invoices.some((row) => row.id === billed.id));
                for (const bad of ['2027-3-1', '2027-02-30', 'today', '20270301']) {
                  await fails(
                    () => invoices.board(viewer.token, branch.id, bad),
                    'VALIDATION_FAILED',
                    'date',
                  );
                }
                await fails(
                  () => invoices.board(viewer.token, randomUUID(), undefined),
                  'NOT_FOUND',
                );
                await fails(
                  () => invoices.board(manageOnly.token, branch.id, undefined),
                  'FORBIDDEN',
                );
                await fails(
                  () => invoices.board(outsider.token, branch.id, undefined),
                  'FORBIDDEN',
                );
                await fails(() => invoices.board(nobody.token, branch.id, undefined), 'FORBIDDEN');
                await fails(() => invoices.get(manageOnly.token, billed.id), 'FORBIDDEN');
                await fails(() => invoices.get(nobody.token, billed.id), 'FORBIDDEN');
                await fails(() => invoices.get(cashier.token, randomUUID()), 'NOT_FOUND');
                const read = await ok(() => invoices.get(viewer.token, billed.id));
                assert.equal(read.id, billed.id);
                assert.deepEqual(
                  [
                    read.actions.editPrices,
                    read.actions.setPayer,
                    read.actions.finalize,
                    read.actions.cancel,
                  ],
                  [false, false, false, false],
                );
                // Nothing about the operational visit changed.
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: billedVisit.id } })).status,
                  'COMPLETED',
                );
                assert.equal(
                  await tx.visitServiceLine.count({
                    where: { visitId: billedVisit.id, status: 'DONE' },
                  }),
                  1,
                );
              },
            );

            await suite.test(
              'every invoice audit is FINANCIAL and uses the shared audit table',
              async () => {
                const all = await tx.auditEvent.findMany({
                  where: {
                    action: { startsWith: 'INVOICE_' },
                    entityType: 'Invoice',
                    actorUserId: { not: null },
                  },
                });
                assert.ok(all.length > 20);
                assert.ok(all.every((event) => event.dataClassification === 'FINANCIAL'));
                assert.deepEqual([...new Set(all.map((event) => event.action))].sort(), [
                  'INVOICE_CANCELLED',
                  'INVOICE_CREATED',
                  'INVOICE_FINALIZED',
                  'INVOICE_PAID',
                  'INVOICE_PAYER_SET',
                  'INVOICE_PRICE_SET',
                ]);
                // Audit history is append-only for the runtime connection.
                await assert.rejects(
                  isolated((client) =>
                    client.$executeRawUnsafe(
                      "UPDATE audit_events SET reason = 'x' WHERE action LIKE 'INVOICE_%'",
                    ),
                  ),
                  /cannot be removed or rewritten/,
                );
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
