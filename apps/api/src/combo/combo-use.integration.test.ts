import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ComboCreateRequest, ComboResponse, InvoiceResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  createPayosSimulator,
  LOYALTY_EVENT_TYPES,
  parseApiEnvironment,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ComboService } from './combo.service.js';
import { validVnMobile } from '../testing/phone.js';

/**
 * Phase 5 P5-8: using the sessions of a combo at a visit's invoice, against real PostgreSQL (design 9.4-9.5; the Owner answers of
 * 2026-10-05, all approved by the Owner in own words). Everything goes through the real invoice and combo
 * services; the `loyalty` consumer issues, revokes and reopens on the real outbox events. Every fixture rolls back with the outer
 * transaction.
 */
test(
  'Phase 5 P5-8 combo usage; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-8 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `use_${++savepoint}`;
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
            const loyalty = new LoyaltyService(sessionAdapter, throttle, environment);
            const combos = new ComboService(sessionAdapter, throttle, environment);
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
              | 'CORRECT_PAYMENTS'
              | 'SELL_COMBOS'
              | 'MANAGE_COMBOS'
              | 'CONSUME_COMBO_SESSIONS'
              | 'RESTORE_COMBO_SESSIONS'
              | 'VIEW_LOYALTY_EXCEPTIONS';
            const category = await tx.serviceCategory.create({
              data: { code: `P58_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            type Service = Awaited<ReturnType<typeof newService>>;
            const newService = (suffix: string, price = 200_000n, max = price) =>
              tx.service.create({
                data: {
                  code: `P58_${suffix}_${run}`,
                  categoryId: category.id,
                  nameVi: 'Dịch vụ',
                  nameEn: 'Service',
                  priceVnd: price,
                  priceMaxVnd: max,
                  pricingUnit: 'PER_SERVICE',
                  maxQuantity: 1,
                  durationMinutes: 10,
                  estimatedMinMinutes: 10,
                  estimatedMaxMinutes: 10,
                },
              });
            const massage = await newService('MASSAGE');
            const nails = await newService('NAILS');
            const facial = await newService('FACIAL', 150_000n, 250_000n);

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
            const phoneOf = () => validVnMobile();
            const makeBranch = (label: string) =>
              tx.branch.create({
                data: {
                  code: `P58_${label}_${run}`,
                  name: `Usage ${label}`,
                  timezone: 'Asia/Ho_Chi_Minh',
                },
              });
            const branch = await makeBranch('MAIN');
            const otherBranch = await makeBranch('OTHER');
            const customer = async (label: string) => {
              n++;
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `p58-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p58-${label}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: phoneOf(),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-06-15'), address: 'Fixture' },
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
                  emailCanonical: `p58-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p58-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);

            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P58_${name}_${run}`,
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
              at: { id: string },
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
                      employeeCodeCanonical: `P58_${run}_${n}`,
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
                data: { employeeUserId: user.id, branchId: at.id, grantedByUserId: user.id },
              });
              if (roleId) {
                await tx.userRoleAssignment.create({
                  data:
                    scope === 'GLOBAL'
                      ? { userId: user.id, roleId, scopeKind: 'GLOBAL', branchId: null }
                      : { userId: user.id, roleId, scopeKind: 'BRANCH', branchId: at.id },
                });
              }
              return {
                id: user.id,
                fullName: user.fullName,
                token: await login(user),
                staleToken: await login(user, false),
              };
            };
            const roles = {
              use: await makeRole('USE', [
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'CONSUME_COMBO_SESSIONS',
              ]),
              manageOnly: await makeRole('MANAGEONLY', ['VIEW_INVOICES', 'MANAGE_INVOICES']),
              consumeOnly: await makeRole('CONSUMEONLY', [
                'VIEW_INVOICES',
                'CONSUME_COMBO_SESSIONS',
              ]),
              sell: await makeRole('SELL', ['VIEW_INVOICES', 'MANAGE_INVOICES', 'SELL_COMBOS']),
              collect: await makeRole('COLLECT', ['COLLECT_PAYMENTS', 'VIEW_INVOICES']),
              correct: await makeRole('CORRECT', ['CORRECT_PAYMENTS', 'VIEW_INVOICES']),
              cancel: await makeRole('CANCEL', ['CANCEL_INVOICES', 'VIEW_INVOICES']),
              restore: await makeRole('RESTORE', [
                'RESTORE_COMBO_SESSIONS',
                'VIEW_LOYALTY_EXCEPTIONS',
              ]),
              history: await makeRole('HISTORY', ['MANAGE_COMBOS']),
            };
            const cashier = await staffUser(branch, roles.use.id);
            const otherCashier = await staffUser(otherBranch, roles.use.id);
            const manageOnly = await staffUser(branch, roles.manageOnly.id);
            const consumeOnly = await staffUser(branch, roles.consumeOnly.id);
            const seller = await staffUser(branch, roles.sell.id);
            const collector = await staffUser(branch, roles.collect.id);
            const corrector = await staffUser(branch, roles.correct.id);
            const canceller = await staffUser(branch, roles.cancel.id);
            const restorer = await staffUser(branch, roles.restore.id, 'GLOBAL');
            const historian = await staffUser(branch, roles.history.id, 'GLOBAL');
            const ktv = await staffUser(branch, null);
            const otherKtv = await staffUser(otherBranch, null);

            // ------------------------------------------------------------------------ visit and invoice helpers
            let slot = 0;
            let clock = 0;
            const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();
            const completedVisit = async (
              serviceOrServices: Service | Service[],
              recipient: { id: string },
              at: { id: string } = branch,
              employee: { id: string } = ktv,
              owner: { id: string } | null = null,
            ) => {
              const services = Array.isArray(serviceOrServices)
                ? serviceOrServices
                : [serviceOrServices];
              n++;
              const visit = await tx.visit.create({
                data: {
                  code: `VS-P58-${run}-${n}`,
                  branchId: at.id,
                  origin: 'WALK_IN',
                  ownerUserId: owner?.id ?? null,
                  serviceDate: new Date('2027-03-01T00:00:00.000Z'),
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: cashier.id,
                  idempotencyKey: randomUUID(),
                },
              });
              const participant = await tx.visitParticipant.create({
                data: { visitId: visit.id, kind: 'MEMBER', customerUserId: recipient.id },
              });
              const created: { id: string }[] = [];
              for (const [index, service] of services.entries()) {
                const start = new Date(LOCAL_MIDNIGHT + (6 * 60 + 10 * slot++) * 60_000);
                created.push(
                  await tx.visitServiceLine.create({
                    data: {
                      visitId: visit.id,
                      participantId: participant.id,
                      sequence: index + 1,
                      serviceId: service.id,
                      employeeUserId: employee.id,
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
                  }),
                );
              }
              const started = new Date('2027-03-01T06:00:00+07:00');
              for (const [index, line] of created.entries()) {
                await tx.visitServiceLine.update({
                  where: { id: line.id },
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
                    visitServiceLineId: line.id,
                    employeeUserId: employee.id,
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
                    endedByUserId: employee.id,
                    rowVersion: { increment: 1 },
                  },
                });
                await tx.visitServiceLine.update({
                  where: { id: line.id },
                  data: { status: 'DONE', rowVersion: { increment: 1 } },
                });
              }
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
            const draftFor = async (
              service: Service | Service[],
              recipient: { id: string },
              opts: {
                at?: { id: string };
                by?: { token: string };
                employee?: { id: string };
                owner?: { id: string } | null;
              } = {},
            ) => {
              const visitId = await completedVisit(
                service,
                recipient,
                opts.at ?? branch,
                opts.employee ?? ktv,
                opts.owner ?? null,
              );
              return (await ok(() => invoices.open((opts.by ?? cashier).token, visitId)))
                .invoice as InvoiceResponse;
            };
            const choose = (
              draft: InvoiceResponse,
              purchaseId: string,
              usedBy: 'OWNER' | 'RELATIVE' = 'OWNER',
              note?: string,
              by: { token: string } = cashier,
              lineIndex = 0,
            ) =>
              ok(() =>
                invoices.comboUse(by.token, draft.id, draft.lines[lineIndex]!.id, {
                  expectedVersion: draft.version,
                  purchaseId,
                  usedBy,
                  ...(note === undefined ? {} : { relationshipNote: note }),
                }),
              );
            const finalize = async (draft: InvoiceResponse, by: { token: string } = cashier) =>
              (await ok(() =>
                invoices.finalize(by.token, draft.id, { expectedVersion: draft.version }),
              )) as InvoiceResponse;
            /** A whole use: a draft, the choice, the finalization. */
            const useOnce = async (
              purchaseId: string,
              usedBy: 'OWNER' | 'RELATIVE' = 'OWNER',
              recipient: { id: string } = buyer,
              note?: string,
            ) => {
              const draft = await draftFor(massage, recipient);
              const chosen = await choose(draft, purchaseId, usedBy, note);
              return finalize(chosen);
            };
            const reload = (invoiceId: string) => ok(() => invoices.get(cashier.token, invoiceId));
            const consume = async (invoiceId: string) => {
              const events = await tx.outboxEvent.findMany({
                where: {
                  aggregateId: invoiceId,
                  eventType: { in: LOYALTY_EVENT_TYPES },
                  consumptions: { none: { consumer: 'loyalty' } },
                },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
              const outcomes: string[] = [];
              for (const event of events) {
                outcomes.push(await processLoyaltyEvent(tx, event.id));
                await settle();
              }
              return outcomes;
            };
            const purchasesOf = (invoiceId: string) =>
              tx.comboPurchase.findMany({
                where: { invoiceLine: { invoiceId } },
                orderBy: { paidSeq: 'asc' },
                include: { sessions: { orderBy: { sessionNo: 'asc' } }, reopenings: true },
              });
            const comboBody = (over: Partial<ComboCreateRequest> = {}): ComboCreateRequest => ({
              serviceId: massage.id,
              nameVi: 'Combo massage mua 5 tặng 1',
              nameEn: 'Massage combo, pay 5 get 1',
              paidSessions: 5,
              bonusSessions: 1,
              priceVnd: '1000000',
              active: true,
              ...over,
            });
            const sellAndIssue = async (combo: ComboResponse, owner: { id: string }) => {
              const sale = (
                await ok(() =>
                  invoices.openComboSale(seller.token, branch.id, {
                    comboId: combo.id,
                    payerUserId: owner.id,
                  }),
                )
              ).invoice;
              const pending = (await ok(() =>
                invoices.finalize(seller.token, sale.id, { expectedVersion: sale.version }),
              )) as InvoiceResponse;
              const payment = await ok(() =>
                invoices.recordPayment(collector.token, pending.id, {
                  method: 'CASH',
                  amountVnd: pending.totalVnd,
                  tenderedVnd: pending.totalVnd,
                  idempotencyKey: randomUUID(),
                }),
              );
              await consume(pending.id);
              const [purchase] = await purchasesOf(pending.id);
              assert.ok(purchase, 'the combo was issued');
              return { sale: pending, payment, purchase };
            };
            const countsOf = async (purchaseId: string) => {
              const sessionsOfPurchase = await tx.comboSession.findMany({
                where: { purchaseId },
                orderBy: { sessionNo: 'asc' },
                include: { consumptions: { include: { release: true, restoration: true } } },
              });
              const active = (s: (typeof sessionsOfPurchase)[number]) =>
                s.consumptions.some((use) => !use.release && !use.restoration);
              return {
                used: sessionsOfPurchase.filter(active).length,
                free: sessionsOfPurchase.filter((s) => !active(s)).length,
                total: sessionsOfPurchase.length,
              };
            };

            // ===================================================================================== set up
            const buyer = await customer('buyer');
            const relative = await customer('relative');
            const stranger = await customer('stranger');
            const main = await ok(() => combos.create(ownerToken, comboBody()));
            const nailsCombo = await ok(() =>
              combos.create(ownerToken, comboBody({ serviceId: nails.id, nameVi: 'Combo nail' })),
            );
            await ok(() => loyalty.activate(ownerToken));
            const sold = await sellAndIssue(main, buyer);
            const purchase = sold.purchase;
            const nailsSold = await sellAndIssue(nailsCombo, buyer);

            // ============================================================================ lookup by the owner's phone
            await suite.test(
              'lookup by the owner phone shows only the combo, the sessions left and the MASKED name; nothing else',
              async () => {
                const draft = await draftFor(massage, relative);
                const found = await ok(() =>
                  invoices.comboLookup(cashier.token, draft.id, { phone: buyer.phoneCanonical! }),
                );
                assert.equal(found.owners.length, 1);
                const owner = found.owners[0]!;
                assert.equal(owner.ownerNameMasked, 'K••• b•••');
                assert.deepEqual(Object.keys(owner).sort(), ['combos', 'ownerNameMasked']);
                // Only the combo for the service on this invoice is offered (the nails combo is not).
                assert.equal(owner.combos.length, 1);
                const combo = owner.combos[0]!;
                assert.deepEqual(Object.keys(combo).sort(), [
                  'lineIds',
                  'nameEn',
                  'nameVi',
                  'purchaseId',
                  'service',
                  'sessionsLeft',
                  'totalSessions',
                ]);
                assert.equal(combo.purchaseId, purchase.id);
                assert.equal(combo.sessionsLeft, 6);
                assert.equal(combo.totalSessions, 6);
                assert.deepEqual(combo.lineIds, [draft.lines[0]!.id]);
                const text = JSON.stringify(found);
                assert.ok(!text.includes(buyer.phoneCanonical!), 'no phone');
                assert.ok(!text.includes(buyer.emailCanonical!), 'no email');
                assert.ok(!text.includes('Khách'), 'no full name');
                assert.ok(!text.includes(buyer.id), 'no owner id');
                // A phone that is nobody's, a member with no usable combo and a malformed phone.
                assert.deepEqual(
                  (
                    await ok(() =>
                      invoices.comboLookup(cashier.token, draft.id, { phone: '+84900000001' }),
                    )
                  ).owners,
                  [],
                );
                assert.deepEqual(
                  (
                    await ok(() =>
                      invoices.comboLookup(cashier.token, draft.id, {
                        phone: stranger.phoneCanonical!,
                      }),
                    )
                  ).owners,
                  [],
                );
                await fails(
                  () => invoices.comboLookup(cashier.token, draft.id, { phone: 'abc' }),
                  'VALIDATION_FAILED',
                  'phone',
                );
                // Needs both permissions at the branch.
                await fails(
                  () =>
                    invoices.comboLookup(manageOnly.token, draft.id, {
                      phone: buyer.phoneCanonical!,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    invoices.comboLookup(consumeOnly.token, draft.id, {
                      phone: buyer.phoneCanonical!,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    invoices.comboLookup(otherCashier.token, draft.id, {
                      phone: buyer.phoneCanonical!,
                    }),
                  'FORBIDDEN',
                );
                assert.equal(draft.actions.useCombos, true);
              },
            );

            // ==================================================================================== choosing a use
            await suite.test(
              'choosing pays the line 0 VND, quantity 1, takes NO session yet; clearing pays it normally again',
              async () => {
                const draft = await draftFor(massage, buyer);
                assert.equal(draft.lines[0]!.unitPriceVnd, '200000');
                assert.equal(draft.totalVnd, '200000');
                const chosen = await choose(draft, purchase.id, 'OWNER');
                const line = chosen.lines[0]!;
                assert.equal(line.unitPriceVnd, '0');
                assert.equal(line.quantity, 1);
                assert.equal(line.grossVnd, '0');
                assert.equal(line.priceEditable, false);
                assert.equal(chosen.totalVnd, '0');
                assert.equal(line.comboUse?.state, 'SELECTED');
                assert.equal(line.comboUse?.usedBy, 'OWNER');
                assert.equal(line.comboUse?.sessionNo, null);
                assert.equal(
                  (await countsOf(purchase.id)).used,
                  0,
                  'no session is taken on a draft',
                );
                assert.equal(
                  await tx.comboSessionConsumption.count({
                    where: { invoiceLine: { invoiceId: draft.id } },
                  }),
                  0,
                );
                // The price command no longer applies to this line.
                await fails(
                  () =>
                    invoices.setPrice(cashier.token, chosen.id, line.id, {
                      expectedVersion: chosen.version,
                      unitPriceVnd: '200000',
                    }),
                  'INVOICE_STATE_INVALID',
                );
                // The same choice again changes nothing.
                const again = await choose(chosen, purchase.id, 'OWNER');
                assert.equal(again.version, chosen.version);
                // A stale version conflicts.
                await fails(
                  () =>
                    invoices.comboUse(cashier.token, chosen.id, line.id, {
                      expectedVersion: draft.version,
                      purchaseId: purchase.id,
                      usedBy: 'OWNER',
                    }),
                  'CONFLICT',
                );
                // Clear: back to the fixed price, the marker is gone.
                const cleared = await ok(() =>
                  invoices.comboUseClear(cashier.token, chosen.id, line.id, {
                    expectedVersion: chosen.version,
                  }),
                );
                assert.equal(cleared.lines[0]!.unitPriceVnd, '200000');
                assert.equal(cleared.lines[0]!.comboUse, null);
                assert.equal(cleared.totalVnd, '200000');
                assert.equal(
                  await tx.invoiceLineComboUsage.count({ where: { invoiceId: draft.id } }),
                  0,
                );
              },
            );

            await suite.test(
              'refusals: a relative note only for a relative; the combo service; quantity 1; permission; not usable',
              async () => {
                const draft = await draftFor(massage, buyer);
                const refuse = (
                  body: Record<string, unknown>,
                  code: string,
                  field?: string,
                  by = cashier,
                ) =>
                  fails(
                    () =>
                      invoices.comboUse(by.token, draft.id, draft.lines[0]!.id, {
                        expectedVersion: draft.version,
                        purchaseId: purchase.id,
                        usedBy: 'OWNER',
                        ...body,
                      } as never),
                    code,
                    field,
                  );
                await refuse(
                  { relationshipNote: 'Con gái' },
                  'VALIDATION_FAILED',
                  'relationshipNote',
                );
                await refuse({ usedBy: 'FRIEND' }, 'VALIDATION_FAILED', 'usedBy');
                await refuse({ purchaseId: 'not-a-uuid' }, 'VALIDATION_FAILED', 'purchaseId');
                await refuse({ purchaseId: randomUUID() }, 'COMBO_NOT_USABLE');
                // A combo is for its own service (PRD 17.3).
                await refuse({ purchaseId: nailsSold.purchase.id }, 'COMBO_SERVICE_MISMATCH');
                await refuse({}, 'FORBIDDEN', undefined, manageOnly as never);
                await refuse({}, 'FORBIDDEN', undefined, consumeOnly as never);
                await refuse({}, 'FORBIDDEN', undefined, otherCashier as never);
                // A line already set to more than one unit is refused; here a ranged service and a quantity.
                assert.equal(
                  await tx.invoiceLineComboUsage.count({ where: { invoiceId: draft.id } }),
                  0,
                );
                // A relative's note is optional and free text.
                const withNote = await choose(draft, purchase.id, 'RELATIVE', '  Con gái  ');
                assert.equal(withNote.lines[0]!.comboUse?.usedBy, 'RELATIVE');
                assert.equal(withNote.lines[0]!.comboUse?.relationshipNote, 'Con gái');
                // Switching to the owner replaces the choice.
                const owner = await choose(withNote, purchase.id, 'OWNER');
                assert.equal(owner.lines[0]!.comboUse?.relationshipNote, null);
              },
            );

            // ================================================================================== finalization
            await suite.test(
              'finalization takes the lowest free session: PAID first, then BONUS; the line is 0 VND and passes the range check',
              async () => {
                const before = await tx.loyaltyLedgerEntry.count({ where: { userId: buyer.id } });
                const kinds: string[] = [];
                for (let i = 1; i <= 6; i++) {
                  const done = await useOnce(purchase.id, 'OWNER', buyer);
                  // 200,000 is the whole catalog price; 0 is below it, yet the line stands (only a combo line is exempt).
                  assert.equal(done.status, 'PAID');
                  assert.equal(done.totalVnd, '0');
                  const use = done.lines[0]!.comboUse!;
                  assert.equal(use.state, 'USED');
                  assert.equal(use.sessionNo, i);
                  kinds.push(use.sessionKind!);
                  assert.equal(use.countsAsTour, use.sessionKind === 'PAID');
                  await consume(done.id);
                }
                assert.deepEqual(kinds, ['PAID', 'PAID', 'PAID', 'PAID', 'PAID', 'BONUS']);
                assert.deepEqual(await countsOf(purchase.id), { used: 6, free: 0, total: 6 });
                assert.equal(
                  await tx.loyaltyLedgerEntry.count({ where: { userId: buyer.id } }),
                  before,
                  '0 points',
                );
                // Nothing left: the seventh is refused when chosen.
                const draft = await draftFor(massage, buyer);
                await fails(
                  () =>
                    invoices.comboUse(cashier.token, draft.id, draft.lines[0]!.id, {
                      expectedVersion: draft.version,
                      purchaseId: purchase.id,
                      usedBy: 'OWNER',
                    }),
                  'COMBO_NO_SESSION_LEFT',
                );
                const found = await ok(() =>
                  invoices.comboLookup(cashier.token, draft.id, { phone: buyer.phoneCanonical! }),
                );
                assert.deepEqual(found.owners, [], 'a combo with no session left is not offered');
                // The fixed-price line of an unmarked invoice still obeys the range (the exemption is only the marker).
                await sqlRejects(
                  () =>
                    tx.invoiceLine.update({
                      where: { id: draft.lines[0]!.id },
                      data: { unitPriceVnd: 0n, grossVnd: 0n, rowVersion: { increment: 1 } },
                    }),
                  /snapshotted range|price/,
                );
              },
            );

            const second = await sellAndIssue(main, buyer);
            const fresh = second.purchase;

            await suite.test(
              'the consumption records the owner/relative, the technician and the recipient of the LINE, who did it and when',
              async () => {
                const done = await useOnce(fresh.id, 'RELATIVE', relative, 'Chị gái');
                const row = await tx.comboSessionConsumption.findFirstOrThrow({
                  where: { invoiceLine: { invoiceId: done.id } },
                  include: { recipientParticipant: true, session: true },
                });
                assert.equal(row.usedBy, 'RELATIVE');
                assert.equal(row.relationshipNote, 'Chị gái');
                assert.equal(row.ktvUserId, ktv.id);
                assert.equal(row.recipientParticipant?.customerUserId, relative.id);
                assert.equal(row.performedByUserId, cashier.id);
                assert.equal(row.branchId, branch.id);
                assert.equal(row.session.sessionNo, 1);
                assert.equal(row.session.kind, 'PAID');
                assert.ok(row.consumedAt instanceof Date);
                // History is append-only: nobody edits or deletes it.
                await sqlRejects(
                  () =>
                    tx.comboSessionConsumption.update({
                      where: { id: row.id },
                      data: { usedBy: 'OWNER' },
                    }),
                  /Permanent identity and audit history cannot be removed or rewritten/,
                );
                await sqlRejects(
                  () => tx.comboSessionConsumption.delete({ where: { id: row.id } }),
                  /Permanent identity and audit history cannot be removed or rewritten/,
                );
                // The database refuses a consumption that does not follow the staff's choice.
                const draft = await draftFor(massage, buyer);
                await sqlRejects(
                  () =>
                    tx.comboSessionConsumption.create({
                      data: {
                        sessionId: await_first(fresh.sessions, 2).id,
                        invoiceLineId: draft.lines[0]!.id,
                        branchId: branch.id,
                        usedBy: 'OWNER',
                        performedByUserId: cashier.id,
                      },
                    }),
                  /follows the combo use chosen|chosen on its line/,
                );
                const events = await tx.outboxEvent.count({
                  where: { aggregateId: fresh.id, eventType: 'COMBO_SESSION_CONSUMED' },
                });
                assert.equal(events, 1);
              },
            );

            await suite.test(
              'any branch may use the combo (Owner-approved); a mixed invoice keeps only the paid line in its total',
              async () => {
                const draft = await draftFor(massage, buyer, {
                  at: otherBranch,
                  by: otherCashier,
                  employee: otherKtv,
                });
                const chosen = await choose(draft, fresh.id, 'OWNER', undefined, otherCashier);
                const done = await finalize(chosen, otherCashier);
                const row = await tx.comboSessionConsumption.findFirstOrThrow({
                  where: { invoiceLine: { invoiceId: done.id } },
                });
                assert.equal(
                  row.branchId,
                  otherBranch.id,
                  'the branch of the invoice that used it',
                );
                assert.equal(row.ktvUserId, otherKtv.id);
                assert.equal(done.lines[0]!.comboUse?.sessionNo, 2);
              },
            );

            await suite.test(
              'cancelling the use invoice releases the session (append-only, once); the next use takes it again',
              async () => {
                const done = await useOnce(fresh.id, 'OWNER', buyer);
                const sessionNo = done.lines[0]!.comboUse!.sessionNo!;
                const before = await countsOf(fresh.id);
                const cancelled = await ok(() =>
                  invoices.cancel(canceller.token, done.id, {
                    expectedVersion: done.version,
                    reason: 'Nhập nhầm',
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.lines[0]!.comboUse?.state, 'RELEASED');
                const release = await tx.comboSessionRelease.findFirstOrThrow({
                  where: { consumption: { invoiceLine: { invoiceId: done.id } } },
                });
                assert.equal(release.cause, 'ZERO_BALANCE_CORRECTION');
                assert.equal(release.releasedByUserId, canceller.id);
                assert.deepEqual(await countsOf(fresh.id), {
                  ...before,
                  used: before.used - 1,
                  free: before.free + 1,
                });
                // Repeating the cancellation releases nothing again.
                await ok(() =>
                  invoices.cancel(canceller.token, done.id, {
                    expectedVersion: done.version,
                    reason: 'Nhập nhầm',
                  }),
                );
                assert.equal(
                  await tx.comboSessionRelease.count({
                    where: { consumption: { invoiceLine: { invoiceId: done.id } } },
                  }),
                  1,
                );
                const next = await useOnce(fresh.id, 'OWNER', buyer);
                assert.equal(
                  next.lines[0]!.comboUse!.sessionNo,
                  sessionNo,
                  'the released session is the lowest free again',
                );
              },
            );

            await suite.test(
              'a mixed invoice: the paid line is charged, the combo line is free; cancelling it unpaid releases with its own cause',
              async () => {
                // One visit: a massage (paid with a session) and a ranged facial (paid in money).
                const mixed = await draftFor([massage, facial], buyer);
                assert.equal(mixed.lines.length, 2);
                const chosen = await choose(mixed, fresh.id, 'OWNER');
                assert.equal(chosen.lines[0]!.comboUse?.state, 'SELECTED');
                assert.equal(chosen.lines[1]!.comboUse, null);
                const priced = await ok(() =>
                  invoices.setPrice(cashier.token, chosen.id, chosen.lines[1]!.id, {
                    expectedVersion: chosen.version,
                    unitPriceVnd: '180000',
                  }),
                );
                assert.equal(priced.totalVnd, '180000', 'only the paid line is charged');
                const pending = await finalize(priced);
                assert.equal(pending.status, 'PENDING_PAYMENT');
                assert.equal(pending.lines[0]!.comboUse?.state, 'USED');
                // The ranged line still obeys its range; the combo line is the only exemption.
                const before = await countsOf(fresh.id);
                const cancelled = await ok(() =>
                  invoices.cancel(canceller.token, pending.id, {
                    expectedVersion: pending.version,
                    reason: 'Khách đổi ý',
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                const release = await tx.comboSessionRelease.findFirstOrThrow({
                  where: { consumption: { invoiceLine: { invoiceId: pending.id } } },
                });
                assert.equal(release.cause, 'INVOICE_CANCELLED_UNPAID');
                assert.equal((await countsOf(fresh.id)).free, before.free + 1);

                // A draft cancelled with a choice on it never took a session and has nothing to release.
                const abandoned = await draftFor(massage, buyer);
                const picked = await choose(abandoned, fresh.id, 'OWNER');
                const gone = await ok(() =>
                  invoices.cancel(canceller.token, picked.id, {
                    expectedVersion: picked.version,
                    reason: 'Bỏ',
                  }),
                );
                assert.equal(gone.status, 'CANCELLED');
                assert.equal(
                  await tx.comboSessionConsumption.count({
                    where: { invoiceLine: { invoiceId: picked.id } },
                  }),
                  0,
                );
                assert.equal((await countsOf(fresh.id)).free, before.free + 1);
              },
            );

            // ========================================================================================== history
            await suite.test(
              'history shows who, when, which technician, owner or relative; only a manager reads it; staff cannot change it',
              async () => {
                await fails(() => combos.usage(cashier.token, {}), 'FORBIDDEN');
                await fails(() => combos.usage(consumeOnly.token, {}), 'FORBIDDEN');
                const page = await ok(() => combos.usage(historian.token, {}));
                assert.equal(page.pageSize, 20);
                assert.equal(page.canRestore, false, 'MANAGE_COMBOS alone cannot restore');
                const relativeUse = page.items.find((item) => item.relationshipNote === 'Chị gái');
                assert.ok(relativeUse);
                assert.equal(relativeUse.usedBy, 'RELATIVE');
                assert.equal(relativeUse.status, 'ACTIVE');
                assert.equal(relativeUse.owner.id, buyer.id);
                assert.ok(relativeUse.owner.phoneMasked?.includes('•'));
                assert.equal(relativeUse.technicianName, ktv.fullName);
                assert.equal(relativeUse.performedByName, cashier.fullName);
                assert.equal(relativeUse.recipientName, 'Khách relative');
                assert.equal(relativeUse.branchName, 'Usage MAIN');
                assert.ok(relativeUse.usedAt);
                const asRestorer = await ok(() => combos.usage(restorer.token, {}));
                assert.equal(asRestorer.canRestore, true);
                assert.equal(asRestorer.total, page.total);
                await fails(
                  () => combos.usage(historian.token, { page: '0' }),
                  'VALIDATION_FAILED',
                  'page',
                );
              },
            );

            // ========================================================================================= restore
            await suite.test(
              'a manager restores a mistaken use with a reason, as one offset entry; history stays; the line keeps its 0 VND',
              async () => {
                const done = await useOnce(fresh.id, 'OWNER', buyer);
                const row = await tx.comboSessionConsumption.findFirstOrThrow({
                  where: { invoiceLine: { invoiceId: done.id } },
                });
                const freeBefore = (await countsOf(fresh.id)).free;
                await fails(
                  () => combos.restore(cashier.token, row.id, { reason: 'Nhầm' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => combos.restore(historian.token, row.id, { reason: 'Nhầm' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => combos.restore(restorer.staleToken, row.id, { reason: 'Nhầm' }),
                  'REAUTHENTICATION_REQUIRED',
                );
                await fails(
                  () => combos.restore(restorer.token, row.id, { reason: '   ' }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                await fails(
                  () => combos.restore(restorer.token, randomUUID(), { reason: 'Nhầm' }),
                  'NOT_FOUND',
                );
                const restored = await ok(() =>
                  combos.restore(restorer.token, row.id, { reason: 'Nhập nhầm khách' }),
                );
                assert.equal(restored.status, 'RESTORED');
                assert.equal(restored.restoration?.reason, 'Nhập nhầm khách');
                assert.equal(restored.restoration?.restoredByName, restorer.fullName);
                assert.equal((await countsOf(fresh.id)).free, freeBefore + 1);
                // The use is still there, and the invoice is untouched.
                assert.equal(await tx.comboSessionConsumption.count({ where: { id: row.id } }), 1);
                const invoice = await reload(done.id);
                assert.equal(invoice.lines[0]!.comboUse?.state, 'RESTORED');
                assert.equal(invoice.lines[0]!.unitPriceVnd, '0');
                assert.equal(invoice.status, 'PAID');
                // One offset per use.
                await fails(
                  () => combos.restore(restorer.token, row.id, { reason: 'Lại' }),
                  'COMBO_USE_NOT_RESTORABLE',
                );
                await sqlRejects(
                  () =>
                    tx.comboSessionRestoration.update({
                      where: { consumptionId: row.id },
                      data: { reason: 'đổi' },
                    }),
                  /Permanent identity and audit history cannot be removed or rewritten/,
                );
                const audit = await tx.auditEvent.findFirst({
                  where: { action: 'COMBO_SESSION_RESTORED', entityId: row.id },
                });
                assert.equal(audit?.reason, 'Nhập nhầm khách');
                assert.equal(audit?.actorUserId, restorer.id);
                // The restored session is the lowest free one and is used again by the next use.
                const next = await useOnce(fresh.id, 'OWNER', buyer);
                assert.equal(
                  next.lines[0]!.comboUse!.sessionNo,
                  done.lines[0]!.comboUse!.sessionNo,
                );
                // Cancelling the invoice of a restored use releases nothing (nothing to give back twice).
                await ok(() =>
                  invoices.cancel(canceller.token, done.id, {
                    expectedVersion: invoice.version,
                    reason: 'Hủy sau khi hoàn',
                  }),
                );
                assert.equal(
                  await tx.comboSessionRelease.count({ where: { consumptionId: row.id } }),
                  0,
                );
              },
            );

            // ======================================================================== reversal of the sale (OQ-9)
            await suite.test(
              'reversing the sale after use freezes the unused sessions at once; paying again reopens the SAME combo',
              async () => {
                const pack = await sellAndIssue(
                  await ok(() =>
                    combos.create(
                      ownerToken,
                      comboBody({
                        paidSessions: 3,
                        bonusSessions: 1,
                        priceVnd: '600000',
                        nameVi: 'Combo 3+1',
                      }),
                    ),
                  ),
                  buyer,
                );
                const frozenPurchase = pack.purchase;
                await useOnce(frozenPurchase.id, 'OWNER', buyer);
                await useOnce(frozenPurchase.id, 'OWNER', buyer);
                // A choice is already on a draft when the sale is reversed.
                const waiting = await draftFor(massage, buyer);
                const chosen = await choose(waiting, frozenPurchase.id, 'OWNER');

                await ok(() =>
                  invoices.reversePayment(corrector.token, pack.sale.id, pack.payment.payment.id, {
                    reason: 'Thu nhầm',
                  }),
                );
                // Frozen immediately, before any worker runs: choosing and finalizing are both refused, nothing is written.
                const another = await draftFor(massage, buyer);
                await fails(
                  () =>
                    invoices.comboUse(cashier.token, another.id, another.lines[0]!.id, {
                      expectedVersion: another.version,
                      purchaseId: frozenPurchase.id,
                      usedBy: 'OWNER',
                    }),
                  'COMBO_NOT_USABLE',
                );
                const consumptionsBefore = await tx.comboSessionConsumption.count();
                await fails(
                  () =>
                    invoices.finalize(cashier.token, chosen.id, {
                      expectedVersion: chosen.version,
                    }),
                  'COMBO_NOT_USABLE',
                );
                assert.equal(await tx.comboSessionConsumption.count(), consumptionsBefore);
                assert.equal((await reload(chosen.id)).status, 'DRAFT');
                await sqlRejects(
                  () =>
                    tx.$executeRaw`UPDATE combo_purchases SET voided_at = clock_timestamp() WHERE id = ${frozenPurchase.id}::uuid`,
                  /./,
                );

                // The worker sees the reversal: the combo with used sessions is not revoked (history stays).
                await consume(pack.sale.id);
                const [still] = await purchasesOf(pack.sale.id);
                assert.equal(still!.voidedAt, null);
                assert.deepEqual(await countsOf(frozenPurchase.id), { used: 2, free: 2, total: 4 });
                // The Owner is told: the frozen list.
                await fails(() => combos.frozen(cashier.token), 'FORBIDDEN');
                const frozen = await ok(() => combos.frozen(restorer.token));
                const item = frozen.items.find(
                  (candidate) => candidate.purchaseId === frozenPurchase.id,
                );
                assert.ok(item);
                assert.equal(item.sessionsUsed, 2);
                assert.equal(item.sessionsLeft, 2);
                assert.equal(item.saleInvoiceStatus, 'PENDING_PAYMENT');
                assert.ok(item.owner.phoneMasked?.includes('•'));
                const lookup = await ok(() =>
                  invoices.comboLookup(cashier.token, another.id, { phone: buyer.phoneCanonical! }),
                );
                assert.ok(
                  !lookup.owners.some((owner) =>
                    owner.combos.some((combo) => combo.purchaseId === frozenPurchase.id),
                  ),
                );
                await sqlRejects(
                  () =>
                    tx.comboSessionConsumption.create({
                      data: {
                        sessionId: await_first(frozenPurchase.sessions, 3).id,
                        invoiceLineId: another.lines[0]!.id,
                        branchId: branch.id,
                        usedBy: 'OWNER',
                        performedByUserId: cashier.id,
                      },
                    }),
                  /cannot be consumed|chosen on its line/,
                );

                // Paying the sale again reopens the same combo: no second combo, never more sessions than were sold.
                const repaid = await ok(() =>
                  invoices.recordPayment(collector.token, pack.sale.id, {
                    method: 'CASH',
                    amountVnd: pack.sale.totalVnd,
                    tenderedVnd: pack.sale.totalVnd,
                    idempotencyKey: randomUUID(),
                  }),
                );
                assert.ok(repaid);
                assert.deepEqual(await consume(pack.sale.id), ['APPLIED']);
                const all = await purchasesOf(pack.sale.id);
                assert.equal(all.length, 1, 'no second combo');
                assert.equal(all[0]!.reopenings.length, 1);
                assert.equal(
                  await tx.comboSession.count({
                    where: { purchase: { invoiceLine: { invoice: { id: pack.sale.id } } } },
                  }),
                  4,
                );
                assert.deepEqual(await countsOf(frozenPurchase.id), { used: 2, free: 2, total: 4 });
                const back = await ok(() =>
                  invoices.comboLookup(cashier.token, another.id, { phone: buyer.phoneCanonical! }),
                );
                assert.equal(
                  back.owners[0]!.combos.find((combo) => combo.purchaseId === frozenPurchase.id)
                    ?.sessionsLeft,
                  2,
                );
                const finalized = await finalize(chosen);
                assert.equal(finalized.lines[0]!.comboUse!.sessionNo, 3);
                assert.deepEqual(
                  (await ok(() => combos.frozen(restorer.token))).items.filter(
                    (candidate) => candidate.purchaseId === frozenPurchase.id,
                  ),
                  [],
                );
                // Replaying the same events changes nothing.
                assert.deepEqual(await consume(pack.sale.id), []);
              },
            );

            await suite.test(
              'a combo with no use is still revoked when its sale is reversed (P5-7 rule unchanged)',
              async () => {
                const unused = await sellAndIssue(
                  await ok(() =>
                    combos.create(ownerToken, comboBody({ nameVi: 'Combo chưa dùng' })),
                  ),
                  buyer,
                );
                await ok(() =>
                  invoices.reversePayment(
                    corrector.token,
                    unused.sale.id,
                    unused.payment.payment.id,
                    {
                      reason: 'Thu nhầm',
                    },
                  ),
                );
                await consume(unused.sale.id);
                const [revoked] = await purchasesOf(unused.sale.id);
                assert.ok(revoked!.voidedAt);
              },
            );

            // ================================================================================ points and discounts
            await suite.test(
              'a combo use earns 0 points and a free line never makes a benefit eligible or gives it a base',
              async () => {
                const rich = await customer('rich');
                await ok(() =>
                  loyalty.adjust(ownerToken, rich.id, {
                    wallet: 'SPA',
                    points: 1_000_000,
                    reason: 'Fixture',
                    clientRequestId: randomUUID(),
                  }),
                );
                const draft = await draftFor(massage, rich, { owner: rich });
                assert.equal(draft.payer?.id, rich.id);
                const chosen = await choose(draft, fresh.id, 'OWNER');
                assert.equal(
                  chosen.discount.winner,
                  null,
                  'a free line has no base for any benefit',
                );
                assert.equal(chosen.discount.member?.eligible ?? false, false);
                const done = await finalize(chosen);
                assert.equal(done.totalVnd, '0');
                assert.equal(done.discountTotalVnd, '0');
                assert.equal(
                  await tx.discountRedemption.count({ where: { invoiceId: done.id } }),
                  0,
                );
                const balanceBefore = (
                  await tx.loyaltyWalletAccount.findUniqueOrThrow({
                    where: { userId_wallet: { userId: rich.id, wallet: 'SPA' } },
                  })
                ).balancePoints;
                await consume(done.id);
                const balanceAfter = (
                  await tx.loyaltyWalletAccount.findUniqueOrThrow({
                    where: { userId_wallet: { userId: rich.id, wallet: 'SPA' } },
                  })
                ).balancePoints;
                assert.equal(balanceAfter, balanceBefore, 'using a session earns nothing');
                // A used combo is not a visit's payment: the invoice is a zero-balance settlement, never a money payment.
                assert.equal(await tx.payment.count({ where: { invoiceId: done.id } }), 0);
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

/** The session of `sessions` with the given number. */
function await_first<T extends { sessionNo: number }>(rows: T[], sessionNo: number): T {
  const row = rows.find((candidate) => candidate.sessionNo === sessionNo);
  assert.ok(row);
  return row;
}
