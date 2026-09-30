import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  DiscountCreateRequest,
  DiscountVersionInput,
  InvoiceResponse,
} from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { DiscountService } from '../discounts/discount.service.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { InvoiceService } from './invoice.service.js';

/**
 * Phase 4 Step 6: discount programs, vouchers and their effect on the Invoice / POS workflow against real
 * PostgreSQL. Every fixture (and every command) rolls back with the outer transaction, and each sub-test
 * additionally runs in its own savepoint (`sandbox`) so its programs never leak into another. Concurrency is
 * covered by the separate race suite. After each command the deferred Step 4 integrity triggers are forced
 * to run (`settle`), so a command that would fail the database's commit-time checks fails here too.
 */
test(
  'Phase 4 Step 6 discounts, vouchers and the invoice benefit; fixtures roll back',
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
    const rollback = new Error('Phase 4 Step 6 fixture rollback');
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
            const discounts = new DiscountService(
              {
                withTransaction: isolated,
                withExclusiveTransaction: isolated,
                resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              },
              new AuthThrottleService(environment),
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
              | 'APPLY_DISCOUNTS'
              | 'MANAGE_DISCOUNTS'
              | 'CREATE_VOUCHERS';
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
              applier: await makeRole('APPLIER', [
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'APPLY_DISCOUNTS',
              ]),
              discountAdmin: await makeRole('DISCOUNT_ADMIN', [
                'MANAGE_DISCOUNTS',
                'CREATE_VOUCHERS',
              ]),
              discountManage: await makeRole('DISCOUNT_MANAGE', ['MANAGE_DISCOUNTS']),
              voucherMake: await makeRole('VOUCHER_MAKE', ['CREATE_VOUCHERS']),
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
            const category2 = await tx.serviceCategory.create({
              data: { code: `IV2_${run}`, nameVi: 'Nhóm hai', nameEn: 'Group two' },
            });
            void category2;
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
            const at = (roleId: string, branchId = branch.id) => [{ roleId, branchId }];
            const cashier = await staffUser(at(roles.cashier.id));
            const viewer = await staffUser(at(roles.view.id));
            const boss = await staffUser(at(roles.boss.id), { reauthenticated: true });
            const bossStale = await staffUser(at(roles.boss.id));
            const outsider = await staffUser(at(roles.boss.id, elsewhere.id), {
              reauthenticated: true,
            });
            const nobody = await staffUser([]);
            const ktv = await staffUser([]);
            const applier = await staffUser(at(roles.applier.id));
            const admin = await staffUser([{ roleId: roles.discountAdmin.id }]);
            const discManager = await staffUser([{ roleId: roles.discountManage.id }]);
            const voucherMaker = await staffUser([{ roleId: roles.voucherMake.id }]);
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

            // =============================================================== discount fixtures
            let box = 0;
            /** Everything a sub-test creates (programs, vouchers, invoices, visits) rolls back at its end. */
            const sandbox = async (work: () => Promise<void>) => {
              const name = `box_${++box}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                await work();
                await settle();
              } finally {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
              }
            };
            const HOUR = 3_600_000;
            const span = (fromHours = -24, untilHours = 720) => ({
              validFrom: new Date(Date.now() + fromHours * HOUR).toISOString(),
              validUntil: new Date(Date.now() + untilHours * HOUR).toISOString(),
            });
            const versionInput = (
              change: Partial<DiscountVersionInput> = {},
            ): DiscountVersionInput => {
              const merged: DiscountVersionInput = {
                kind: 'PERCENT',
                percentBp: 1000,
                ...span(),
                minSpendVnd: '0',
                scopeMode: 'ALL_SERVICES',
                serviceIds: [],
                categoryIds: [],
                usageLimitTotal: null,
                usageLimitPerCustomer: null,
                ...change,
              };
              // A fixed amount carries no percentage unless a test asks for the invalid combination.
              if (merged.kind === 'FIXED_AMOUNT' && !('percentBp' in change))
                delete merged.percentBp;
              return merged;
            };
            const fixed = (amount: string): Partial<DiscountVersionInput> => ({
              kind: 'FIXED_AMOUNT',
              fixedAmountVnd: amount,
            });
            let programNo = 0;
            const newProgram = (
              options: {
                code?: string;
                requiresCode?: boolean;
                version?: Partial<DiscountVersionInput>;
              } = {},
            ) =>
              discounts.create(admin.token, {
                code: options.code ?? `P${run}${++programNo}`,
                nameVi: 'Ưu đãi',
                nameEn: 'Promotion',
                requiresCode: options.requiresCode ?? false,
                version: versionInput(options.version),
              });
            const freshCreate = (): DiscountCreateRequest => ({
              code: `Q${run}${++programNo}`,
              nameVi: 'Ưu đãi',
              nameEn: 'Promotion',
              requiresCode: false,
              version: versionInput(),
            });
            const newProgramAs = (actor: Person) => discounts.create(actor.token, freshCreate());
            let voucherNo = 0;
            const newVoucher = async (programId: string, code?: string) => {
              const before = await discounts.get(admin.token, programId);
              const detail = await discounts.createVoucher(admin.token, programId, {
                code: code ?? `V${run}${++voucherNo}`,
              });
              return {
                detail,
                voucher: detail.vouchers.find(
                  (candidate) => !before.vouchers.some((existing) => existing.id === candidate.id),
                )!,
              };
            };
            const finalizeAs = (invoice: InvoiceResponse, actor: Person = cashier) =>
              ok(() =>
                invoices.finalize(actor.token, invoice.id, { expectedVersion: invoice.version }),
              );
            const cancelAs = (invoice: InvoiceResponse, actor: Person = boss, reason = 'Sửa sai') =>
              ok(() =>
                invoices.cancel(actor.token, invoice.id, {
                  expectedVersion: invoice.version,
                  reason,
                }),
              );
            const redemptionsOf = (invoiceId: string) =>
              tx.discountRedemption.findMany({ where: { invoiceId }, include: { release: true } });
            const usage = async (programId: string) =>
              (await discounts.get(admin.token, programId)).redemptions;
            const candidateOf = (invoice: InvoiceResponse, code: string) =>
              invoice.discount.candidates.find((candidate) => candidate.discountCode === code)!;
            const supply = (invoice: InvoiceResponse, code: string, actor: Person = applier) =>
              ok(() =>
                invoices.supplyVoucher(actor.token, invoice.id, {
                  expectedVersion: invoice.version,
                  code,
                }),
              );
            /** The draft of a fresh completed visit; the booking owner is the member payer unless `guest`. */
            const freshDraft = async (services: Service[] = [exact], guest = false) =>
              draft(
                await completedVisit(services, guest ? {} : { ownerUserId: owner.id }),
                applier,
              );

            // ================================================================== program configuration
            await suite.test(
              'programs: GLOBAL-only authority, validation, immutable versions, pause/terminate, vouchers, audit',
              async () =>
                sandbox(async () => {
                  // Authority: branch roles and branch-scoped grants never configure discounts.
                  for (const actor of [cashier, boss, applier, nobody, viewer]) {
                    await fails(() => discounts.list(actor.token), 'FORBIDDEN');
                    await fails(() => newProgramAs(actor), 'FORBIDDEN');
                  }
                  const branchAdmin = await staffUser([]);
                  try {
                    await isolated((client) =>
                      client.userRoleAssignment.create({
                        data: {
                          userId: branchAdmin.id,
                          roleId: roles.discountAdmin.id,
                          scopeKind: 'BRANCH',
                          branchId: branch.id,
                        },
                      }),
                    );
                  } catch {
                    // The database may already refuse a GLOBAL_ONLY code at a branch scope; either way:
                  }
                  await fails(() => discounts.list(branchAdmin.token), 'FORBIDDEN');
                  await fails(() => newProgramAs(branchAdmin), 'FORBIDDEN');
                  await fails(() => discounts.list(undefined), 'AUTHENTICATION_REQUIRED');

                  // The two authorities are separate.
                  await fails(
                    () => discounts.create(voucherMaker.token, freshCreate()),
                    'FORBIDDEN',
                  );
                  assert.equal(
                    (await discounts.list(voucherMaker.token)).permissions.manage,
                    false,
                  );
                  assert.equal(
                    (await discounts.list(discManager.token)).permissions.createVouchers,
                    false,
                  );

                  // Validation matrix (the Step 4 CHECKs are the backstop).
                  const bad = async (change: Partial<DiscountVersionInput>, field: string) =>
                    fails(() => newProgram({ version: change }), 'VALIDATION_FAILED', field);
                  await bad({ percentBp: 0 }, 'percentBp');
                  await bad({ percentBp: 10_001 }, 'percentBp');
                  await bad({ percentBp: 12.5 }, 'percentBp');
                  await bad({ percentBp: undefined } as never, 'percentBp');
                  await bad({ fixedAmountVnd: '5000' }, 'fixedAmountVnd');
                  await bad({ ...fixed('0') }, 'fixedAmountVnd');
                  await bad({ ...fixed('-5') }, 'fixedAmountVnd');
                  await bad({ ...fixed('1.5') }, 'fixedAmountVnd');
                  await bad({ ...fixed('5000'), percentBp: 1000 }, 'percentBp');
                  await bad({ validFrom: 'yesterday' }, 'validFrom');
                  await bad({ ...span(24, 24) }, 'validUntil');
                  await bad({ ...span(24, -24) }, 'validUntil');
                  await bad({ minSpendVnd: '-1' }, 'minSpendVnd');
                  await bad({ scopeMode: 'ALL_SERVICES', serviceIds: [ranged.id] }, 'serviceIds');
                  await bad({ scopeMode: 'SELECTED' }, 'serviceIds');
                  await bad({ scopeMode: 'SELECTED', serviceIds: [randomUUID()] }, 'serviceIds');
                  await bad({ scopeMode: 'SELECTED', categoryIds: [randomUUID()] }, 'categoryIds');
                  await bad({ usageLimitTotal: 0 }, 'usageLimitTotal');
                  await bad({ usageLimitPerCustomer: 1.5 }, 'usageLimitPerCustomer');
                  await fails(
                    () => discounts.create(admin.token, { ...freshCreate(), code: 'bad code' }),
                    'VALIDATION_FAILED',
                    'code',
                  );
                  await fails(
                    () => discounts.create(admin.token, { ...freshCreate(), nameVi: '  ' }),
                    'VALIDATION_FAILED',
                    'nameVi',
                  );
                  assert.equal((await discounts.list(admin.token)).discounts.length, 0);

                  // Create: percentage with scope; the code is canonical (upper-case).
                  const created = await ok(() =>
                    discounts.create(admin.token, {
                      ...freshCreate(),
                      code: `s${run}scoped`.toLowerCase(),
                      version: versionInput({
                        percentBp: 2500,
                        minSpendVnd: '50000',
                        scopeMode: 'SELECTED',
                        serviceIds: [ranged.id],
                        categoryIds: [category2.id],
                        usageLimitTotal: 5,
                        usageLimitPerCustomer: 1,
                      }),
                    }),
                  );
                  assert.equal(created.code, `S${run}SCOPED`);
                  assert.equal(created.status, 'ACTIVE');
                  assert.equal(created.version, 1);
                  assert.equal(created.current.versionNo, 1);
                  assert.equal(created.current.percentBp, 2500);
                  assert.deepEqual(created.current.serviceIds, [ranged.id]);
                  assert.deepEqual(created.current.categoryIds, [category2.id]);
                  await fails(
                    () => discounts.create(admin.token, { ...freshCreate(), code: created.code }),
                    'DISCOUNT_CODE_TAKEN',
                  );

                  // Versions are appended, never edited; a stale program version conflicts.
                  await fails(
                    () =>
                      discounts.addVersion(admin.token, created.id, {
                        expectedVersion: 7,
                        version: versionInput(),
                      }),
                    'CONFLICT',
                  );
                  const second = await ok(() =>
                    discounts.addVersion(admin.token, created.id, {
                      expectedVersion: created.version,
                      nameEn: 'Renamed',
                      version: versionInput({ percentBp: 3000 }),
                    }),
                  );
                  assert.equal(second.current.versionNo, 2);
                  assert.equal(second.version, 2);
                  assert.equal(second.nameEn, 'Renamed');
                  assert.deepEqual(
                    second.versions.map((entry) => entry.versionNo),
                    [2, 1],
                  );
                  assert.equal(second.versions[1]!.percentBp, 2500, 'version 1 is unchanged');
                  await assert.rejects(
                    isolated((client) =>
                      client.$executeRawUnsafe('UPDATE discount_versions SET min_spend_vnd = 1'),
                    ),
                  );
                  await assert.rejects(
                    isolated((client) => client.$executeRawUnsafe('DELETE FROM discounts')),
                  );

                  // Pause / resume is reversible; a repeat changes nothing.
                  const paused = await ok(() =>
                    discounts.setActive(admin.token, created.id, {
                      expectedVersion: second.version,
                      isActive: false,
                    }),
                  );
                  assert.equal(paused.status, 'PAUSED');
                  assert.equal(paused.version, 3);
                  const again = await ok(() =>
                    discounts.setActive(admin.token, created.id, {
                      expectedVersion: paused.version,
                      isActive: false,
                    }),
                  );
                  assert.equal(again.version, 3, 'a repeat is a no-op');
                  const resumed = await ok(() =>
                    discounts.setActive(admin.token, created.id, {
                      expectedVersion: again.version,
                      isActive: true,
                    }),
                  );
                  assert.equal(resumed.status, 'ACTIVE');

                  // Vouchers: only under a code-requiring program; generated or explicit; canonical; unique.
                  await fails(
                    () => discounts.createVoucher(admin.token, created.id, {}),
                    'DISCOUNT_STATE_INVALID',
                  );
                  const voucherProgram = await newProgram({ requiresCode: true });
                  const generated = await ok(() =>
                    discounts.createVoucher(voucherMaker.token, voucherProgram.id, {}),
                  );
                  assert.match(generated.vouchers[0]!.code, /^[A-HJ-NP-Z2-9]{10}$/);
                  const explicit = await ok(() =>
                    discounts.createVoucher(admin.token, voucherProgram.id, { code: ' vip-2027 ' }),
                  );
                  assert.ok(explicit.vouchers.some((voucher) => voucher.code === 'VIP-2027'));
                  await fails(
                    () =>
                      discounts.createVoucher(admin.token, voucherProgram.id, { code: 'vip-2027' }),
                    'DISCOUNT_CODE_TAKEN',
                  );
                  await fails(
                    () => discounts.createVoucher(admin.token, voucherProgram.id, { code: 'a b' }),
                    'VOUCHER_INVALID',
                  );
                  await fails(
                    () => discounts.createVoucher(discManager.token, voucherProgram.id, {}),
                    'FORBIDDEN',
                  );
                  const target = explicit.vouchers.find((voucher) => voucher.code === 'VIP-2027')!;
                  await fails(
                    () =>
                      discounts.setVoucherActive(voucherMaker.token, voucherProgram.id, target.id, {
                        expectedVersion: 9,
                        isActive: false,
                      }),
                    'CONFLICT',
                  );
                  const off = await ok(() =>
                    discounts.setVoucherActive(voucherMaker.token, voucherProgram.id, target.id, {
                      expectedVersion: target.version,
                      isActive: false,
                    }),
                  );
                  assert.equal(
                    off.vouchers.find((voucher) => voucher.id === target.id)!.isActive,
                    false,
                  );
                  await fails(
                    () =>
                      discounts.setVoucherActive(admin.token, voucherProgram.id, randomUUID(), {
                        expectedVersion: 1,
                        isActive: false,
                      }),
                    'NOT_FOUND',
                  );

                  // Termination: permanent, with a reason; nothing else is allowed afterwards.
                  await fails(
                    () =>
                      discounts.terminate(admin.token, voucherProgram.id, {
                        expectedVersion: voucherProgram.version,
                        reason: '   ',
                      }),
                    'VALIDATION_FAILED',
                  );
                  const detail = await discounts.get(admin.token, voucherProgram.id);
                  const ended = await ok(() =>
                    discounts.terminate(admin.token, voucherProgram.id, {
                      expectedVersion: detail.version,
                      reason: 'Kết thúc sớm',
                    }),
                  );
                  assert.equal(ended.status, 'TERMINATED');
                  assert.equal(ended.terminatedReason, 'Kết thúc sớm');
                  const twice = await ok(() =>
                    discounts.terminate(admin.token, voucherProgram.id, {
                      expectedVersion: ended.version,
                      reason: 'Lần hai',
                    }),
                  );
                  assert.equal(twice.version, ended.version, 'repeating a termination is a no-op');
                  for (const attempt of [
                    () =>
                      discounts.addVersion(admin.token, voucherProgram.id, {
                        expectedVersion: ended.version,
                        version: versionInput(),
                      }),
                    () =>
                      discounts.setActive(admin.token, voucherProgram.id, {
                        expectedVersion: ended.version,
                        isActive: true,
                      }),
                    () => discounts.createVoucher(admin.token, voucherProgram.id, {}),
                  ]) {
                    await fails(attempt, 'DISCOUNT_STATE_INVALID');
                  }
                  await fails(() => discounts.get(admin.token, randomUUID()), 'NOT_FOUND');
                  await fails(() => discounts.get(admin.token, 'nope'), 'NOT_FOUND');
                  const list = await discounts.list(admin.token);
                  assert.ok(list.permissions.manage && list.permissions.createVouchers);

                  // Every configuration change is a FINANCIAL audit event without a branch.
                  const trail = await tx.auditEvent.findMany({
                    where: {
                      OR: [
                        { action: { startsWith: 'DISCOUNT_' } },
                        { action: { startsWith: 'VOUCHER_' } },
                      ],
                    },
                  });
                  const actions = new Set(trail.map((event) => event.action));
                  for (const action of [
                    'DISCOUNT_CREATED',
                    'DISCOUNT_VERSIONED',
                    'DISCOUNT_ACTIVE_CHANGED',
                    'DISCOUNT_TERMINATED',
                    'VOUCHER_CREATED',
                    'VOUCHER_ACTIVE_CHANGED',
                  ]) {
                    assert.ok(actions.has(action), action);
                  }
                  assert.ok(
                    trail.every(
                      (event) =>
                        event.dataClassification === 'FINANCIAL' && event.branchId === null,
                    ),
                  );
                }),
            );

            // ==================================================================== draft evaluation
            await suite.test(
              'draft: the code-less promotion applies by itself, follows every edit, never the client',
              async () =>
                sandbox(async () => {
                  const promo = await newProgram({ version: { percentBp: 1000 } });
                  const opened = await freshDraft([exact, ranged]);
                  // Live evaluation: 10% of the priced 200,000 line; nothing was typed by anyone.
                  assert.equal(opened.discount.preview, true);
                  assert.equal(opened.discount.winner?.discountCode, promo.code);
                  assert.equal(opened.discountTotalVnd, '20000');
                  assert.equal(opened.totalVnd, '180000');
                  assert.equal(opened.discount.appliedAt, null);
                  const ex = lineOf(opened, exact.code);
                  assert.equal(ex.grossVnd, '200000');
                  const priced = await ok(() =>
                    invoices.setPrice(applier.token, opened.id, lineOf(opened, ranged.code).id, {
                      expectedVersion: opened.version,
                      unitPriceVnd: '120000',
                    }),
                  );
                  assert.equal(priced.subtotalVnd, '320000');
                  assert.equal(priced.discountTotalVnd, '32000');
                  assert.equal(priced.totalVnd, '288000');
                  // The header is refreshed with every draft edit (and finalization recomputes it).
                  const header = await tx.invoice.findUniqueOrThrow({ where: { id: opened.id } });
                  assert.equal(header.discountTotalVnd, 32_000n);
                  assert.equal(header.totalVnd, 288_000n);
                  assert.equal(
                    (await redemptionsOf(opened.id)).length,
                    0,
                    'a draft redeems nothing',
                  );
                  assert.equal(
                    await tx.invoiceDiscountApplication.count({ where: { invoiceId: opened.id } }),
                    0,
                  );
                  const audit = (await audits(opened.id, 'INVOICE_PRICE_SET')).at(-1)!;
                  assert.equal(
                    (audit.after as Record<string, unknown>)['discountTotalVnd'],
                    '32000',
                  );

                  // Pausing the program changes the next evaluation, not any stored fact.
                  await ok(() =>
                    discounts.setActive(admin.token, promo.id, {
                      expectedVersion: promo.version,
                      isActive: false,
                    }),
                  );
                  const after = await ok(() => invoices.get(cashier.token, opened.id));
                  assert.equal(after.discount.winner, null);
                  assert.equal(after.discountTotalVnd, '0');
                  assert.equal(after.totalVnd, '320000');
                  assert.deepEqual(
                    after.discount.candidates,
                    [],
                    'a paused promotion is not a candidate',
                  );

                  // A scoped promotion counts only its in-scope lines (OP-4), before the benefit.
                  const scoped = await newProgram({
                    version: {
                      percentBp: 5000,
                      minSpendVnd: '150000',
                      scopeMode: 'SELECTED',
                      serviceIds: [exact.id],
                    },
                  });
                  const view = await ok(() => invoices.get(cashier.token, opened.id));
                  const candidate = candidateOf(view, scoped.code);
                  assert.equal(candidate.eligibleSubtotalVnd, '200000');
                  assert.equal(candidate.eligible, true);
                  assert.equal(candidate.amountVnd, '100000');
                  assert.equal(view.totalVnd, '220000');

                  // Not yet valid / expired programs are shown (or hidden) with stable reasons.
                  await newProgram({ version: span(24, 48) });
                  await newProgram({ version: span(-48, -24) });
                  const dated = await ok(() => invoices.get(cashier.token, opened.id));
                  assert.equal(
                    dated.discount.candidates.filter((entry) => entry.reason === 'NOT_STARTED')
                      .length,
                    1,
                  );
                  assert.equal(
                    dated.discount.candidates.some((entry) => entry.reason === 'EXPIRED'),
                    false,
                    'an expired promotion is not a candidate',
                  );
                }),
            );

            await suite.test(
              'draft: a member payer unlocks a per-customer-limited benefit; a guest never fakes identity (OP-3)',
              async () =>
                sandbox(async () => {
                  const open = await newProgram({ version: { percentBp: 1000 } });
                  const limited = await newProgram({
                    version: { percentBp: 3000, usageLimitPerCustomer: 1 },
                  });
                  const guest = await freshDraft([exact], true);
                  assert.equal(guest.payer, null);
                  assert.equal(candidateOf(guest, limited.code).reason, 'MEMBER_REQUIRED');
                  assert.equal(guest.discount.winner?.discountCode, open.code);
                  assert.equal(guest.discountTotalVnd, '20000');
                  // Attaching an existing member (exact lookup) makes it eligible on the next recalculation.
                  const member = await ok(() =>
                    invoices.payer(applier.token, guest.id, {
                      expectedVersion: guest.version,
                      payerUserId: other.id,
                    }),
                  );
                  assert.equal(candidateOf(member, limited.code).eligible, true);
                  assert.equal(member.discount.winner?.discountCode, limited.code);
                  assert.equal(member.discountTotalVnd, '60000');
                  const header = await tx.invoice.findUniqueOrThrow({ where: { id: guest.id } });
                  assert.equal(
                    header.discountTotalVnd,
                    60_000n,
                    'the payer edit refreshed the header',
                  );
                  const back = await ok(() =>
                    invoices.payer(applier.token, guest.id, {
                      expectedVersion: member.version,
                      payerUserId: null,
                    }),
                  );
                  assert.equal(back.discount.winner?.discountCode, open.code);
                  assert.equal(back.discountTotalVnd, '20000');
                  assert.equal(await tx.user.count({ where: { fullName: 'Khách lẻ' } }), 0);
                }),
            );

            await suite.test(
              'vouchers: supply and remove need APPLY_DISCOUNTS; one stable error; best-of never stacks',
              async () =>
                sandbox(async () => {
                  const promo = await newProgram({
                    version: { ...fixed('100000') },
                  });
                  const big = await newProgram({
                    requiresCode: true,
                    version: { ...fixed('150000') },
                  });
                  const { voucher } = await newVoucher(big.id, `BIG${run}`);
                  const invoice = await freshDraft([exact]);
                  assert.equal(invoice.actions.applyVouchers, true);
                  assert.equal(
                    (await ok(() => invoices.get(cashier.token, invoice.id))).actions.applyVouchers,
                    false,
                  );
                  await fails(() => supply(invoice, voucher.code, cashier), 'FORBIDDEN');
                  await fails(() => supply(invoice, voucher.code, outsider), 'FORBIDDEN');
                  await fails(() => supply(invoice, voucher.code, nobody), 'FORBIDDEN');

                  // One stable error whatever the reason; nothing changes.
                  const inactive = (await newVoucher(big.id)).voucher;
                  await ok(() =>
                    discounts.setVoucherActive(admin.token, big.id, inactive.id, {
                      expectedVersion: inactive.version,
                      isActive: false,
                    }),
                  );
                  const expiredProgram = await newProgram({
                    requiresCode: true,
                    version: span(-48, -24),
                  });
                  const future = await newProgram({ requiresCode: true, version: span(24, 48) });
                  const pausedProgram = await newProgram({ requiresCode: true });
                  await ok(() =>
                    discounts.setActive(admin.token, pausedProgram.id, {
                      expectedVersion: pausedProgram.version,
                      isActive: false,
                    }),
                  );
                  const ended = await newProgram({ requiresCode: true });
                  const endedVoucher = (await newVoucher(ended.id)).voucher;
                  await ok(() =>
                    discounts.terminate(admin.token, ended.id, {
                      expectedVersion: ended.version,
                      reason: 'Hết chương trình',
                    }),
                  );
                  const codes = [
                    'NO-SUCH-CODE',
                    '',
                    'bad code!',
                    'x'.repeat(200),
                    inactive.code,
                    (await newVoucher(expiredProgram.id)).voucher.code,
                    (await newVoucher(future.id)).voucher.code,
                    (await newVoucher(pausedProgram.id)).voucher.code,
                    endedVoucher.code,
                  ];
                  for (const code of codes)
                    await fails(() => supply(invoice, code), 'VOUCHER_INVALID');
                  const before = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
                  assert.equal(before.rowVersion, invoice.version);
                  assert.equal(
                    await tx.invoiceVoucherEntry.count({ where: { invoiceId: invoice.id } }),
                    0,
                  );

                  // A valid code (any case, padded) joins the candidates; the larger benefit wins alone.
                  const supplied = await supply(invoice, ` ${voucher.code.toLowerCase()} `);
                  assert.equal(supplied.version, invoice.version + 1);
                  assert.equal(supplied.discount.vouchers.length, 1);
                  assert.equal(supplied.discount.vouchers[0]!.code, voucher.code);
                  assert.equal(supplied.discount.winner?.voucherCode, voucher.code);
                  assert.equal(
                    supplied.discountTotalVnd,
                    '150000',
                    '150,000, not 250,000: no stacking',
                  );
                  assert.equal(supplied.totalVnd, '50000');
                  assert.equal(supplied.discount.selectionReason, 'LARGEST_BENEFIT');
                  assert.equal(candidateOf(supplied, promo.code).eligible, true);
                  assert.equal(candidateOf(supplied, promo.code).winner, false);
                  // Repeating the same code is a quiet no-op; a stale version conflicts.
                  const repeat = await supply(supplied, voucher.code);
                  assert.equal(repeat.version, supplied.version);
                  assert.equal(repeat.discount.vouchers.length, 1);
                  await fails(
                    () =>
                      invoices.supplyVoucher(applier.token, invoice.id, {
                        expectedVersion: invoice.version,
                        code: voucher.code,
                      }),
                    'CONFLICT',
                  );
                  // Removing withdraws only that candidate; the automatic promotion stays and now wins.
                  const entry = supplied.discount.vouchers[0]!;
                  await fails(
                    () =>
                      invoices.removeVoucher(cashier.token, invoice.id, entry.id, {
                        expectedVersion: supplied.version,
                      }),
                    'FORBIDDEN',
                  );
                  const removed = await ok(() =>
                    invoices.removeVoucher(applier.token, invoice.id, entry.id, {
                      expectedVersion: supplied.version,
                    }),
                  );
                  assert.equal(removed.discount.vouchers.length, 0);
                  assert.equal(removed.discount.winner?.discountCode, promo.code);
                  assert.equal(removed.discountTotalVnd, '100000');
                  await fails(
                    () =>
                      invoices.removeVoucher(applier.token, invoice.id, entry.id, {
                        expectedVersion: removed.version,
                      }),
                    'NOT_FOUND',
                  );
                  await fails(
                    () =>
                      invoices.removeVoucher(applier.token, invoice.id, 'nope', {
                        expectedVersion: removed.version,
                      }),
                    'NOT_FOUND',
                  );
                  // History is kept: one entry with its single removal transition.
                  const row = await tx.invoiceVoucherEntry.findUniqueOrThrow({
                    where: { id: entry.id },
                  });
                  assert.equal(row.removedByUserId, applier.id);
                  assert.ok(row.removedAt);
                  // The code can be supplied again after its removal.
                  const again = await supply(removed, voucher.code);
                  assert.equal(again.discount.winner?.voucherCode, voucher.code);
                  assert.equal((await audits(invoice.id, 'INVOICE_VOUCHER_SUPPLIED')).length, 2);
                  assert.equal((await audits(invoice.id, 'INVOICE_VOUCHER_REMOVED')).length, 1);

                  // Frozen at finalization.
                  const done = await finalizeAs(again);
                  await fails(() => supply(done, voucher.code), 'INVOICE_STATE_INVALID');
                  await fails(
                    () =>
                      invoices.removeVoucher(applier.token, invoice.id, entry.id, {
                        expectedVersion: done.version,
                      }),
                    'INVOICE_STATE_INVALID',
                  );
                  assert.equal(
                    await tx.invoiceVoucherEntry.count({ where: { invoiceId: invoice.id } }),
                    2,
                  );
                }),
            );

            // ============================================================ historical category scope
            await suite.test(
              'category scope uses the historical snapshot: moving the live service never changes a draft or finalization',
              async () =>
                sandbox(async () => {
                  const inOriginal = await newProgram({
                    version: { percentBp: 1000, scopeMode: 'SELECTED', categoryIds: [category.id] },
                  });
                  const inMoved = await newProgram({
                    version: {
                      percentBp: 2000,
                      scopeMode: 'SELECTED',
                      categoryIds: [category2.id],
                    },
                  });
                  const byService = await newProgram({
                    version: { percentBp: 500, scopeMode: 'SELECTED', serviceIds: [exact.id] },
                  });
                  const invoice = await freshDraft([exact]);
                  const detailOf = (invoiceId: string) =>
                    tx.invoiceLineService.findFirstOrThrow({ where: { invoiceId } });
                  assert.equal((await detailOf(invoice.id)).serviceCategoryId, category.id);
                  assert.equal(candidateOf(invoice, inOriginal.code).eligible, true);
                  assert.equal(candidateOf(invoice, inMoved.code).reason, 'NO_ELIGIBLE_LINES');
                  assert.equal(invoice.discount.winner?.discountCode, inOriginal.code);
                  assert.equal(invoice.discountTotalVnd, '20000');

                  // The catalog moves the service to another category after the Visit.
                  await tx.service.update({
                    where: { id: exact.id },
                    data: { categoryId: category2.id, rowVersion: { increment: 1 } },
                  });
                  // The existing draft keeps its historical eligibility: same candidates, same winner, same amount.
                  const view = await ok(() => invoices.get(applier.token, invoice.id));
                  assert.equal(candidateOf(view, inOriginal.code).eligible, true);
                  assert.equal(candidateOf(view, inMoved.code).reason, 'NO_ELIGIBLE_LINES');
                  assert.equal(view.discount.winner?.discountCode, inOriginal.code);
                  assert.equal(view.discountTotalVnd, '20000');
                  // A draft edit recomputes from the snapshot too (and the stored header agrees).
                  const priced = await ok(() =>
                    invoices.payer(applier.token, invoice.id, {
                      expectedVersion: view.version,
                      payerUserId: other.id,
                    }),
                  );
                  assert.equal(priced.discountTotalVnd, '20000');
                  assert.equal(
                    (await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
                      .discountTotalVnd,
                    20_000n,
                  );
                  // A NEW visit of the moved service snapshots the new category and behaves the other way round.
                  const later = await freshDraft([exact]);
                  assert.equal((await detailOf(later.id)).serviceCategoryId, category2.id);
                  assert.equal(candidateOf(later, inMoved.code).eligible, true);
                  assert.equal(candidateOf(later, inOriginal.code).reason, 'NO_ELIGIBLE_LINES');
                  assert.equal(later.discount.winner?.discountCode, inMoved.code);
                  // Finalization uses the snapshot as well: the first invoice still gets its historical benefit.
                  const done = await finalizeAs(priced);
                  assert.equal(done.discount.winner?.discountCode, inOriginal.code);
                  assert.equal(done.discountTotalVnd, '20000');
                  const application = await tx.invoiceDiscountApplication.findUniqueOrThrow({
                    where: { invoiceId: invoice.id },
                  });
                  assert.equal(application.discountId, inOriginal.id);
                  assert.equal(application.eligibleSubtotalVnd, 200_000n);
                  // Service-scoped eligibility never depended on the category.
                  assert.equal(candidateOf(done, byService.code).eligible, true);
                  assert.equal(
                    candidateOf(
                      await ok(() => invoices.get(cashier.token, later.id)),
                      byService.code,
                    ).eligible,
                    true,
                  );
                  // The invoice detail is immutable: nothing can rewrite the historical category.
                  await assert.rejects(
                    isolated((client) =>
                      client.$executeRawUnsafe(
                        `UPDATE invoice_line_services SET service_category_id = NULL WHERE invoice_id = '${invoice.id}'`,
                      ),
                    ),
                    /recorded once/,
                  );
                }),
            );

            // ==================================================================== finalization
            await suite.test(
              'finalize: the winner is applied and redeemed once; frozen facts, audit and event',
              async () =>
                sandbox(async () => {
                  const promo = await newProgram({ version: { ...fixed('100000') } });
                  const big = await newProgram({
                    requiresCode: true,
                    version: { ...fixed('150000') },
                  });
                  const small = await newProgram({
                    requiresCode: true,
                    version: { ...fixed('20000') },
                  });
                  const bigCode = (await newVoucher(big.id)).voucher;
                  const smallCode = (await newVoucher(small.id)).voucher;
                  let invoice = await freshDraft([exact, ranged]);
                  invoice = await ok(() =>
                    invoices.setPrice(applier.token, invoice.id, lineOf(invoice, ranged.code).id, {
                      expectedVersion: invoice.version,
                      unitPriceVnd: '150000',
                    }),
                  );
                  invoice = await supply(invoice, bigCode.code);
                  invoice = await supply(invoice, smallCode.code);
                  assert.equal(invoice.subtotalVnd, '350000');
                  const done = await finalizeAs(invoice);
                  assert.equal(done.status, 'PENDING_PAYMENT');
                  assert.equal(done.discount.preview, false);
                  assert.equal(done.discountTotalVnd, '150000');
                  assert.equal(done.totalVnd, '200000');
                  assert.equal(done.discount.winner?.voucherCode, bigCode.code);
                  assert.equal(
                    done.discount.candidates.length,
                    3,
                    'every evaluated candidate is stored',
                  );
                  assert.ok(done.discount.appliedAt);
                  assert.equal(done.calculationVersion, 1);

                  const application = await tx.invoiceDiscountApplication.findUniqueOrThrow({
                    where: { invoiceId: invoice.id },
                  });
                  assert.equal(application.discountId, big.id);
                  assert.equal(application.voucherId, bigCode.id);
                  assert.equal(application.computedAmountVnd, 150_000n);
                  assert.equal(application.eligibleSubtotalVnd, 350_000n);
                  assert.equal(application.selectionReason, 'LARGEST_BENEFIT');
                  assert.equal(application.finalizedByUserId, cashier.id);
                  const redemptions = await redemptionsOf(invoice.id);
                  assert.equal(redemptions.length, 1, 'one benefit, one redemption');
                  assert.equal(redemptions[0]!.discountId, big.id);
                  assert.equal(redemptions[0]!.versionId, application.versionId);
                  assert.equal(redemptions[0]!.payerUserId, owner.id);
                  assert.equal(redemptions[0]!.release, null);
                  // Only the winner consumes usage; the losing eligible ones consume nothing.
                  assert.equal(await usage(big.id), 1);
                  assert.equal(await usage(small.id), 0);
                  assert.equal(await usage(promo.id), 0);
                  const stored = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
                  assert.equal(stored.discountTotalVnd, 150_000n);
                  assert.equal(stored.totalVnd, 200_000n);
                  assert.equal(stored.subtotalVnd, 350_000n);

                  const trail = (await audits(invoice.id, 'INVOICE_FINALIZED'))[0]!;
                  assert.equal(trail.dataClassification, 'FINANCIAL');
                  const after = trail.after as Record<string, unknown>;
                  assert.equal(after['discountTotalVnd'], '150000');
                  assert.equal(
                    (after['benefit'] as Record<string, unknown>)['voucherCode'],
                    bigCode.code,
                  );
                  assert.equal((after['candidates'] as unknown[]).length, 3);
                  const emitted = (await events(invoice.id)).filter(
                    (event) => event.eventType === 'INVOICE_FINALIZED',
                  );
                  assert.equal(emitted.length, 1);
                  assert.equal(
                    (emitted[0]!.payload as Record<string, unknown>)['discountTotalVnd'],
                    '150000',
                  );

                  // Replay by the same actor: no second application, redemption, audit or event.
                  const replay = await ok(() =>
                    invoices.finalize(cashier.token, invoice.id, {
                      expectedVersion: invoice.version,
                    }),
                  );
                  assert.equal(replay.status, 'PENDING_PAYMENT');
                  assert.equal((await redemptionsOf(invoice.id)).length, 1);
                  assert.equal((await audits(invoice.id, 'INVOICE_FINALIZED')).length, 1);
                  // The frozen application is what any later read shows, even after the program changes.
                  const bigDetail = await discounts.get(admin.token, big.id);
                  await ok(() =>
                    discounts.addVersion(admin.token, big.id, {
                      expectedVersion: bigDetail.version,
                      version: versionInput({ ...fixed('1000') }),
                    }),
                  );
                  const later = await ok(() => invoices.get(cashier.token, invoice.id));
                  assert.equal(later.discountTotalVnd, '150000');
                  assert.equal(later.discount.winner?.versionNo, 1);
                  assert.equal(later.discount.winner?.amountVnd, '150000');
                  assert.equal(await usage(big.id), 1);
                }),
            );

            await suite.test(
              'finalize: deterministic tie-break, an ineligible voucher consumes nothing, no benefit means no rows',
              async () =>
                sandbox(async () => {
                  const beta = await newProgram({ code: `B${run}`, version: { percentBp: 1000 } });
                  const alpha = await newProgram({ code: `A${run}`, version: { percentBp: 1000 } });
                  const invoice = await freshDraft([exact]);
                  assert.equal(invoice.discount.winner?.discountCode, alpha.code);
                  const done = await finalizeAs(invoice);
                  assert.equal(done.discount.winner?.discountCode, alpha.code);
                  assert.equal(done.discount.selectionReason, 'TIE_BREAK_CODE_ORDER');
                  assert.equal(await usage(alpha.id), 1);
                  assert.equal(await usage(beta.id), 0);

                  // No eligible benefit: the invoice finalizes at its subtotal with no application/redemption.
                  const none = await freshDraft([ranged]);
                  const alphaNow = await discounts.get(admin.token, alpha.id);
                  await ok(() =>
                    discounts.setActive(admin.token, alpha.id, {
                      expectedVersion: alphaNow.version,
                      isActive: false,
                    }),
                  );
                  const betaNow = await discounts.get(admin.token, beta.id);
                  await ok(() =>
                    discounts.setActive(admin.token, beta.id, {
                      expectedVersion: betaNow.version,
                      isActive: false,
                    }),
                  );
                  const priced = await priceAll(none, applier);
                  const plain = await finalizeAs(priced);
                  assert.equal(plain.discountTotalVnd, '0');
                  assert.equal(plain.totalVnd, plain.subtotalVnd);
                  assert.equal(plain.discount.winner, null);
                  assert.equal((await redemptionsOf(none.id)).length, 0);
                  assert.equal(
                    await tx.invoiceDiscountApplication.count({ where: { invoiceId: none.id } }),
                    0,
                  );
                  const trail = (await audits(none.id, 'INVOICE_FINALIZED'))[0]!;
                  assert.equal((trail.after as Record<string, unknown>)['benefit'], null);
                }),
            );

            await suite.test(
              'limits: total and per-customer usage count active redemptions; a guest cannot use a per-customer limit',
              async () =>
                sandbox(async () => {
                  const limited = await newProgram({
                    version: { percentBp: 1000, usageLimitTotal: 1 },
                  });
                  const first = await freshDraft([exact]);
                  const second = await freshDraft([exact]);
                  assert.equal(candidateOf(second, limited.code).eligible, true);
                  const one = await finalizeAs(first);
                  assert.equal(one.discountTotalVnd, '20000');
                  // The last usage is gone: the other draft now sees why, and finalizes without a benefit.
                  const view = await ok(() => invoices.get(applier.token, second.id));
                  assert.equal(candidateOf(view, limited.code).reason, 'TOTAL_LIMIT_REACHED');
                  assert.equal(view.discountTotalVnd, '0');
                  const two = await finalizeAs(view);
                  assert.equal(two.discountTotalVnd, '0');
                  assert.equal(two.totalVnd, '200000');
                  assert.equal((await redemptionsOf(second.id)).length, 0);
                  assert.equal(await usage(limited.id), 1);

                  // Cancelling the first (finalized, unpaid) releases the usage: capacity returns.
                  const cancelled = await cancelAs(one);
                  assert.equal(cancelled.status, 'CANCELLED');
                  assert.equal(await usage(limited.id), 0);
                  const third = await freshDraft([exact]);
                  assert.equal(candidateOf(third, limited.code).eligible, true);
                  assert.equal((await finalizeAs(third)).discountTotalVnd, '20000');
                  assert.equal(await usage(limited.id), 1);
                }),
            );

            await suite.test(
              'limits: per-customer usage is per payer; guests are never eligible for it (OP-3)',
              async () =>
                sandbox(async () => {
                  const perCustomer = await newProgram({
                    version: { percentBp: 1000, usageLimitPerCustomer: 1 },
                  });
                  const a = await freshDraft([exact]);
                  const b = await freshDraft([exact]);
                  const guest = await freshDraft([exact], true);
                  assert.equal(a.payer?.id, owner.id);
                  assert.equal(candidateOf(guest, perCustomer.code).reason, 'MEMBER_REQUIRED');
                  const first = await finalizeAs(a);
                  assert.equal(first.discountTotalVnd, '20000');
                  const redemption = (await redemptionsOf(a.id))[0]!;
                  assert.equal(redemption.payerUserId, owner.id);
                  // The same member's second invoice: the customer limit is reached.
                  const viewB = await ok(() => invoices.get(applier.token, b.id));
                  assert.equal(
                    candidateOf(viewB, perCustomer.code).reason,
                    'CUSTOMER_LIMIT_REACHED',
                  );
                  assert.equal((await finalizeAs(viewB)).discountTotalVnd, '0');
                  // The guest still cannot use it, and finalizes without identity and without a benefit.
                  const viewG = await ok(() => invoices.get(applier.token, guest.id));
                  assert.equal(candidateOf(viewG, perCustomer.code).reason, 'MEMBER_REQUIRED');
                  const doneG = await finalizeAs(viewG);
                  assert.equal(doneG.discountTotalVnd, '0');
                  assert.equal((await redemptionsOf(guest.id)).length, 0);
                  // Another member is unaffected.
                  const c = await freshDraft([exact], true);
                  const member = await ok(() =>
                    invoices.payer(applier.token, c.id, {
                      expectedVersion: c.version,
                      payerUserId: other.id,
                    }),
                  );
                  assert.equal((await finalizeAs(member)).discountTotalVnd, '20000');
                  assert.equal(await usage(perCustomer.id), 2);
                }),
            );

            // ============================================================== zero balance and release
            await suite.test(
              'a benefit that makes the receivable 0 settles PAID directly; OP-7 cancellation releases the redemption',
              async () =>
                sandbox(async () => {
                  const free100 = await newProgram({
                    version: { percentBp: 10_000, usageLimitTotal: 1 },
                  });
                  const invoice = await freshDraft([exact]);
                  assert.equal(invoice.totalVnd, '0');
                  assert.equal(invoice.discountTotalVnd, '200000');
                  const done = await finalizeAs(invoice);
                  assert.equal(done.status, 'PAID');
                  assert.equal(done.paidSeq, 1);
                  assert.equal(done.totalVnd, '0');
                  assert.equal(done.discountTotalVnd, '200000');
                  assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
                  assert.deepEqual(
                    (await events(invoice.id)).map((event) => event.eventType).sort(),
                    ['INVOICE_FINALIZED', 'INVOICE_PAID'],
                  );
                  const redemption = (await redemptionsOf(invoice.id))[0]!;
                  assert.equal(redemption.release, null);
                  assert.equal(await usage(free100.id), 1);

                  // Only OP-7 can undo it: CANCEL_INVOICES + reason + fresh re-authentication.
                  await fails(
                    () =>
                      invoices.cancel(bossStale.token, invoice.id, {
                        expectedVersion: done.version,
                        reason: 'Sửa sai',
                      }),
                    'REAUTHENTICATION_REQUIRED',
                  );
                  assert.equal(
                    await usage(free100.id),
                    1,
                    'a refused cancellation releases nothing',
                  );
                  const cancelled = await cancelAs(done);
                  assert.equal(cancelled.status, 'CANCELLED');
                  assert.equal(cancelled.cancelledFromStatus, 'PAID');
                  const after = (await redemptionsOf(invoice.id))[0]!;
                  assert.equal(after.id, redemption.id, 'the redemption row itself stays');
                  assert.ok(after.release, 'released by an append-only release row');
                  assert.equal(after.release!.cause, 'ZERO_BALANCE_CORRECTION');
                  assert.equal(after.release!.releasedByUserId, boss.id);
                  assert.equal(after.release!.reason, 'Sửa sai');
                  assert.equal(await usage(free100.id), 0);
                  const released = (await audits(invoice.id, 'DISCOUNT_REDEMPTION_RELEASED'))[0]!;
                  assert.equal(released.dataClassification, 'FINANCIAL');
                  assert.equal(released.reason, 'Sửa sai');
                  const cancelAudit = (await audits(invoice.id, 'INVOICE_CANCELLED'))[0]!;
                  assert.equal(
                    (cancelAudit.after as Record<string, unknown>)['redemptionReleased'],
                    redemption.id,
                  );
                  const cancelEvent = (await events(invoice.id)).find(
                    (event) => event.eventType === 'INVOICE_CANCELLED',
                  )!;
                  assert.equal(
                    (cancelEvent.payload as Record<string, unknown>)['redemptionReleased'],
                    true,
                  );
                  // Repeating the cancellation is a quiet no-op: no second release, audit or event.
                  const repeat = await ok(() =>
                    invoices.cancel(boss.token, invoice.id, {
                      expectedVersion: done.version,
                      reason: 'Sửa sai',
                    }),
                  );
                  assert.equal(repeat.status, 'CANCELLED');
                  assert.equal(await tx.discountRedemptionRelease.count(), 1);
                  assert.equal(
                    (await audits(invoice.id, 'DISCOUNT_REDEMPTION_RELEASED')).length,
                    1,
                  );
                  // The released usage is available again, and a new invoice may be created for the visit.
                  const next = await draft(
                    await completedVisit([exact], { ownerUserId: owner.id }),
                    applier,
                  );
                  assert.equal(candidateOf(next, free100.code).eligible, true);
                  // The redemption and application rows cannot be rewritten or removed.
                  await assert.rejects(
                    isolated((client) =>
                      client.$executeRawUnsafe('DELETE FROM discount_redemption_releases'),
                    ),
                  );
                  await assert.rejects(
                    isolated((client) =>
                      client.$executeRawUnsafe(
                        'UPDATE discount_redemptions SET payer_user_id = NULL',
                      ),
                    ),
                  );
                }),
            );

            await suite.test(
              'cancellation of a DRAFT releases nothing; an unpaid finalized cancellation releases once',
              async () =>
                sandbox(async () => {
                  const promo = await newProgram({
                    version: { percentBp: 1000, usageLimitTotal: 5 },
                  });
                  const draftOnly = await freshDraft([exact]);
                  const cancelledDraft = await ok(() =>
                    invoices.cancel(boss.token, draftOnly.id, {
                      expectedVersion: draftOnly.version,
                      reason: 'Khách hủy',
                    }),
                  );
                  assert.equal(cancelledDraft.status, 'CANCELLED');
                  assert.equal(await tx.discountRedemptionRelease.count(), 0);
                  assert.equal(await usage(promo.id), 0);

                  const finalized = await finalizeAs(await freshDraft([exact]));
                  assert.equal(await usage(promo.id), 1);
                  const cancelled = await cancelAs(finalized);
                  assert.equal(cancelled.cancelledFromStatus, 'PENDING_PAYMENT');
                  const release = await tx.discountRedemptionRelease.findFirstOrThrow();
                  assert.equal(release.cause, 'INVOICE_CANCELLED_UNPAID');
                  assert.equal(await usage(promo.id), 0);
                  const audit = (await audits(finalized.id, 'INVOICE_CANCELLED'))[0]!;
                  assert.equal(
                    (audit.after as Record<string, unknown>)['cancellationPath'],
                    'UNPAID_FINALIZED',
                  );
                  // A terminated program still releases (the release needs only the program row).
                  const again = await finalizeAs(await freshDraft([exact]));
                  const detail = await discounts.get(admin.token, promo.id);
                  await ok(() =>
                    discounts.terminate(admin.token, promo.id, {
                      expectedVersion: detail.version,
                      reason: 'Kết thúc',
                    }),
                  );
                  await cancelAs(again);
                  assert.equal(await tx.discountRedemptionRelease.count(), 2);
                  assert.equal(await usage(promo.id), 0);
                }),
            );

            await suite.test('every discount audit is FINANCIAL and append-only', async () =>
              sandbox(async () => {
                await newProgram();
                await freshDraft([exact]);
                const rows = await tx.auditEvent.findMany({
                  where: {
                    OR: [
                      { action: { startsWith: 'DISCOUNT_' } },
                      { action: { startsWith: 'VOUCHER_' } },
                      { action: { startsWith: 'INVOICE_VOUCHER_' } },
                    ],
                  },
                });
                assert.ok(rows.length > 0);
                assert.ok(rows.every((row) => row.dataClassification === 'FINANCIAL'));
                await assert.rejects(
                  isolated((client) =>
                    client.$executeRawUnsafe(
                      "UPDATE audit_events SET reason = 'x' WHERE action LIKE 'DISCOUNT_%'",
                    ),
                  ),
                  /cannot be removed or rewritten/,
                );
              }),
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
