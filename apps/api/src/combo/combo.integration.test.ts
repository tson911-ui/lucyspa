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
import { DiscountService } from '../discounts/discount.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { customerInvoiceDetail } from '../pos/customer-invoice.core.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ComboService } from './combo.service.js';

/**
 * Phase 5 P5-7: combo definitions and the counter sale against real PostgreSQL (design 9.1-9.3, OQ-1, the Owner answers of
 * 2026-10-05). Definitions go through the real combo service; sales, vouchers, finalization, payment, reversal and cancellation
 * through the real invoice service; the `loyalty` consumer issues and revokes on the real outbox events. Every fixture rolls
 * back with the outer transaction. Using a session is P5-8 and is not tested here.
 */
test(
  'Phase 5 P5-7 combo definitions and combo sale; fixtures roll back',
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
    const rollback = new Error('Phase 5 P5-7 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `combo_${++savepoint}`;
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
            const discounts = new DiscountService(sessionAdapter, throttle);
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
              | 'MANAGE_COMBOS';
            const category = await tx.serviceCategory.create({
              data: { code: `P57_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
            });
            const newService = (suffix: string, extra: { isActive?: boolean } = {}) =>
              tx.service.create({
                data: {
                  code: `P57_${suffix}_${run}`,
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
                  ...extra,
                },
              });
            const massage = await newService('MASSAGE');
            const retired = await newService('RETIRED', { isActive: false });
            const nails = await newService('NAILS');

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
            const branch = await tx.branch.create({
              data: { code: `P57_MAIN_${run}`, name: 'Combo', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const otherBranch = await tx.branch.create({
              data: { code: `P57_OTHER_${run}`, name: 'Other', timezone: 'Asia/Ho_Chi_Minh' },
            });
            const customer = async (label: string) => {
              n++;
              return tx.user.create({
                data: {
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: `Khách ${label}`,
                  preferredLocale: 'vi',
                  emailCanonical: `p57-${label}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p57-${label}-${run.toLowerCase()}@example.com`,
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
                  emailCanonical: `p57-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `p57-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              }));
            const ownerToken = await login(ownerRow);

            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `P57_${name}_${run}`,
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
                      employeeCodeCanonical: `P57_${run}_${n}`,
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
                  data:
                    scope === 'GLOBAL'
                      ? { userId: user.id, roleId, scopeKind: 'GLOBAL', branchId: null }
                      : { userId: user.id, roleId, scopeKind: 'BRANCH', branchId: branch.id },
                });
              }
              return { id: user.id, token: await login(user) };
            };
            const roles = {
              sell: await makeRole('SELL', ['VIEW_INVOICES', 'MANAGE_INVOICES', 'SELL_COMBOS']),
              prepare: await makeRole('PREPARE', ['VIEW_INVOICES', 'MANAGE_INVOICES']),
              sellOnly: await makeRole('SELLONLY', ['VIEW_INVOICES', 'SELL_COMBOS']),
              collect: await makeRole('COLLECT', ['COLLECT_PAYMENTS', 'VIEW_INVOICES']),
              correct: await makeRole('CORRECT', ['CORRECT_PAYMENTS', 'VIEW_INVOICES']),
              cancel: await makeRole('CANCEL', ['CANCEL_INVOICES', 'VIEW_INVOICES']),
              define: await makeRole('DEFINE', ['MANAGE_COMBOS']),
            };
            const seller = await staffUser(roles.sell.id);
            const preparer = await staffUser(roles.prepare.id);
            const sellOnly = await staffUser(roles.sellOnly.id);
            const collector = await staffUser(roles.collect.id);
            const corrector = await staffUser(roles.correct.id);
            const canceller = await staffUser(roles.cancel.id);
            const manager = await staffUser(roles.define.id, 'GLOBAL');
            const ktv = await staffUser(null);

            // --------------------------------------------------------------------------------------------- helpers
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
            const defineCombo = (over: Partial<ComboCreateRequest> = {}) =>
              ok(() => combos.create(ownerToken, comboBody(over)));
            const edit = (
              combo: ComboResponse,
              over: Partial<Omit<ComboCreateRequest, 'serviceId'>> = {},
            ) =>
              ok(() =>
                combos.addVersion(ownerToken, combo.id, {
                  expectedVersionNo: combo.current.versionNo,
                  nameVi: combo.current.nameVi,
                  nameEn: combo.current.nameEn,
                  paidSessions: combo.current.paidSessions,
                  bonusSessions: combo.current.bonusSessions,
                  priceVnd: combo.current.priceVnd,
                  active: combo.current.active,
                  ...over,
                }),
              );
            const startSale = async (combo: ComboResponse, payer: { id: string }) =>
              (
                await ok(() =>
                  invoices.openComboSale(seller.token, branch.id, {
                    comboId: combo.id,
                    payerUserId: payer.id,
                  }),
                )
              ).invoice;
            const finalize = async (draft: InvoiceResponse) =>
              (await ok(() =>
                invoices.finalize(seller.token, draft.id, { expectedVersion: draft.version }),
              )) as InvoiceResponse;
            const pay = (invoice: InvoiceResponse) =>
              ok(() =>
                invoices.recordPayment(collector.token, invoice.id, {
                  method: 'CASH',
                  amountVnd: invoice.totalVnd,
                  tenderedVnd: invoice.totalVnd,
                  idempotencyKey: randomUUID(),
                }),
              );
            const reverse = (invoiceId: string, paymentId: string) =>
              ok(() =>
                invoices.reversePayment(corrector.token, invoiceId, paymentId, {
                  reason: 'Thu nhầm',
                }),
              );
            const reload = (invoiceId: string) => ok(() => invoices.get(seller.token, invoiceId));
            /** Runs the loyalty consumer over the invoice's loyalty events, oldest first; returns the outcomes. */
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
                include: { sessions: { orderBy: { sessionNo: 'asc' } } },
              });
            const balanceOf = async (userId: string) =>
              (
                await tx.loyaltyWalletAccount.findUnique({
                  where: { userId_wallet: { userId, wallet: 'SPA' } },
                })
              )?.balancePoints ?? 0;
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

            // ================================================================================== definitions
            await suite.test(
              'ships empty; only MANAGE_COMBOS (global) manages definitions: an Owner or a manager, never branch staff',
              async () => {
                const before = await tx.combo.count();
                assert.equal(before, 0, 'no combo is preset');
                const empty = await ok(() => combos.list(ownerToken));
                assert.deepEqual(empty.combos, []);
                assert.equal(empty.loyaltyLive, false);
                for (const staff of [seller, preparer, sellOnly, collector]) {
                  await fails(() => combos.list(staff.token), 'FORBIDDEN');
                  await fails(() => combos.create(staff.token, comboBody()), 'FORBIDDEN');
                }
                assert.equal(await tx.combo.count(), 0, 'refused saves left nothing');
                const byManager = await ok(() => combos.create(manager.token, comboBody()));
                assert.equal(byManager.current.versionNo, 1);
                assert.equal(byManager.current.totalSessions, 6);
                assert.match(byManager.code, /^COMBO-[A-Z0-9]{6}$/);
                assert.equal(byManager.service.id, massage.id);
                const listed = await ok(() => combos.list(manager.token));
                assert.equal(listed.combos.length, 1);
              },
            );

            await suite.test('validation: every field is explicit and checked', async () => {
              const bad = (over: Partial<ComboCreateRequest>, field: string) =>
                fails(() => combos.create(ownerToken, comboBody(over)), 'VALIDATION_FAILED', field);
              await bad({ nameVi: '   ' }, 'nameVi');
              await bad({ nameEn: '' }, 'nameEn');
              await bad({ nameVi: 'x'.repeat(121) }, 'nameVi');
              await bad({ paidSessions: 0 }, 'paidSessions');
              await bad({ paidSessions: 1.5 }, 'paidSessions');
              await bad({ bonusSessions: -1 }, 'bonusSessions');
              await bad({ priceVnd: '0' }, 'priceVnd');
              await bad({ priceVnd: '12.5' }, 'priceVnd');
              await bad({ priceVnd: '-5' }, 'priceVnd');
              await bad({ active: undefined as never }, 'active');
              await fails(
                () => combos.create(ownerToken, comboBody({ serviceId: 'not-a-uuid' })),
                'VALIDATION_FAILED',
                'serviceId',
              );
              await fails(
                () => combos.create(ownerToken, comboBody({ serviceId: randomUUID() })),
                'COMBO_SERVICE_INVALID',
              );
              await fails(
                () => combos.create(ownerToken, comboBody({ serviceId: retired.id })),
                'COMBO_SERVICE_INVALID',
              );
              // Not hard-coded to 5+1 or 10+2; no bonus is fine.
              const odd = await defineCombo({
                paidSessions: 7,
                bonusSessions: 0,
                priceVnd: '700000',
              });
              assert.equal(odd.current.totalSessions, 7);
            });

            await suite.test(
              'versions are appended, never edited; a stale editor conflicts; the same values change nothing',
              async () => {
                const combo = await defineCombo({ serviceId: nails.id });
                const v2 = await edit(combo, { priceVnd: '900000' });
                assert.equal(v2.current.versionNo, 2);
                assert.equal(v2.versions.length, 2);
                assert.equal(v2.versions[1]!.priceVnd, '1000000', 'the history keeps what was');
                await fails(
                  () =>
                    combos.addVersion(ownerToken, combo.id, {
                      expectedVersionNo: 1,
                      nameVi: 'a',
                      nameEn: 'a',
                      paidSessions: 1,
                      bonusSessions: 0,
                      priceVnd: '1',
                      active: true,
                    }),
                  'CONFLICT',
                );
                const same = await edit(v2);
                assert.equal(same.current.versionNo, 2, 'no second version for the same values');
                assert.equal(await tx.comboVersion.count({ where: { comboId: combo.id } }), 2);
                await sqlRejects(
                  () =>
                    tx.comboVersion.update({
                      where: { id: v2.current.id },
                      data: { priceVnd: 1n },
                    }),
                  /Permanent identity and audit history cannot be removed or rewritten/,
                );
                // The service of a combo never changes.
                await sqlRejects(
                  () =>
                    tx.$executeRaw`UPDATE combos SET service_id = ${massage.id}::uuid WHERE id = ${combo.id}::uuid`,
                  /./,
                );
              },
            );

            // ===================================================================== selling needs loyalty to be live
            const main = await defineCombo();
            const buyer = await customer('buyer');
            await suite.test(
              'while go-live is OFF nothing can be sold (P5-T2, Owner answer): no invoice is created',
              async () => {
                const options = await ok(() => invoices.comboOptions(seller.token, branch.id));
                assert.equal(options.sellable, false);
                const invoicesBefore = await tx.invoice.count();
                await fails(
                  () =>
                    invoices.openComboSale(seller.token, branch.id, {
                      comboId: main.id,
                      payerUserId: buyer.id,
                    }),
                  'LOYALTY_NOT_LIVE',
                );
                assert.equal(await tx.invoice.count(), invoicesBefore);
                // The database refuses it too, whoever writes.
                await sqlRejects(
                  () =>
                    tx.$executeRaw`
                      INSERT INTO invoices (code, kind, branch_id, payer_user_id, business_date, calculation_version, created_by_user_id)
                      VALUES ('INV-270301-AAAAAA', 'COMBO_SALE', ${branch.id}::uuid, ${buyer.id}::uuid,
                        lucy_branch_local_date(${branch.id}::uuid, now()), 2, ${ownerRow.id}::uuid)`,
                  /only once loyalty is live|business date/,
                );
                await ok(() => loyalty.activate(ownerToken));
                assert.equal((await ok(() => combos.list(ownerToken))).loyaltyLive, true);
              },
            );

            // ===================================================================================== the sale
            await suite.test(
              'the sale list shows only combos whose current version is active; selling needs SELL_COMBOS',
              async () => {
                const hidden = await defineCombo({ active: false, nameVi: 'Tạm ngưng' });
                const options = await ok(() => invoices.comboOptions(seller.token, branch.id));
                assert.equal(options.sellable, true);
                assert.ok(options.options.some((option) => option.comboId === main.id));
                assert.ok(!options.options.some((option) => option.comboId === hidden.id));
                const sold = options.options.find((option) => option.comboId === main.id)!;
                assert.equal(sold.priceVnd, '1000000');
                assert.equal(sold.totalSessions, 6);
                await fails(() => invoices.comboOptions(preparer.token, branch.id), 'FORBIDDEN');
                await fails(() => invoices.comboOptions(collector.token, branch.id), 'FORBIDDEN');
                await fails(
                  () =>
                    invoices.openComboSale(preparer.token, branch.id, {
                      comboId: main.id,
                      payerUserId: buyer.id,
                    }),
                  'FORBIDDEN',
                );
                // SELL_COMBOS alone is not enough: MANAGE_INVOICES is needed too.
                await fails(
                  () =>
                    invoices.openComboSale(sellOnly.token, branch.id, {
                      comboId: main.id,
                      payerUserId: buyer.id,
                    }),
                  'FORBIDDEN',
                );
                // Scope: no authority at another branch.
                await fails(
                  () =>
                    invoices.openComboSale(seller.token, otherBranch.id, {
                      comboId: main.id,
                      payerUserId: buyer.id,
                    }),
                  'FORBIDDEN',
                );
                await fails(
                  () =>
                    invoices.openComboSale(seller.token, branch.id, {
                      comboId: hidden.id,
                      payerUserId: buyer.id,
                    }),
                  'COMBO_NOT_SELLABLE',
                );
                await fails(
                  () =>
                    invoices.openComboSale(seller.token, branch.id, {
                      comboId: randomUUID(),
                      payerUserId: buyer.id,
                    }),
                  'COMBO_NOT_SELLABLE',
                );
              },
            );

            await suite.test(
              'members only: a guest, a staff account or a made-up id cannot buy',
              async () => {
                for (const payerUserId of [ktv.id, randomUUID()]) {
                  await fails(
                    () =>
                      invoices.openComboSale(seller.token, branch.id, {
                        comboId: main.id,
                        payerUserId,
                      }),
                    'VALIDATION_FAILED',
                    'payerUserId',
                  );
                }
                await fails(
                  () =>
                    invoices.openComboSale(seller.token, branch.id, {
                      comboId: main.id,
                      payerUserId: null as never,
                    }),
                  'VALIDATION_FAILED',
                  'payerUserId',
                );
                // The database has no guest combo sale either.
                await sqlRejects(
                  () =>
                    tx.invoice.create({
                      data: {
                        code: 'INV-270301-BBBBBB',
                        kind: 'COMBO_SALE',
                        branchId: branch.id,
                        payerUserId: null,
                        businessDate: new Date('2027-03-01'),
                        calculationVersion: 2,
                        createdByUserId: ownerRow.id,
                      },
                    }),
                  /invoices_combo_sale_member|business date/,
                );
              },
            );

            await suite.test(
              'a draft combo sale: no visit, one fixed-price combo line, no price or buyer to change',
              async () => {
                const draft = await startSale(main, buyer);
                assert.equal(draft.kind, 'COMBO_SALE');
                assert.equal(draft.status, 'DRAFT');
                assert.equal(draft.visit, null);
                assert.equal(draft.defaultPayer, null);
                assert.equal(draft.payer?.id, buyer.id);
                assert.deepEqual(draft.lines, []);
                assert.equal(draft.comboLine?.priceVnd, '1000000');
                assert.equal(draft.comboLine?.paidSessions, 5);
                assert.equal(draft.comboLine?.bonusSessions, 1);
                assert.equal(draft.comboLine?.totalSessions, 6);
                assert.equal(draft.comboLine?.issuance, 'NOT_PAID');
                assert.equal(draft.comboLine?.service.id, massage.id);
                assert.equal(draft.subtotalVnd, '1000000');
                assert.equal(draft.readiness.ready, true);
                assert.equal(draft.actions.editPrices, false);
                assert.equal(draft.actions.setPayer, false);
                assert.equal(draft.actions.finalize, true);
                const row = await tx.invoice.findUniqueOrThrow({ where: { id: draft.id } });
                assert.equal(row.visitId, null);
                assert.equal(row.kind, 'COMBO_SALE');
                assert.match(row.code, /^INV-\d{6}-[A-HJ-NP-Z2-9]{6}$/);
                // Price and buyer are never chosen on a combo sale.
                await fails(
                  () =>
                    invoices.setPrice(seller.token, draft.id, draft.comboLine!.id, {
                      expectedVersion: draft.version,
                      unitPriceVnd: '1',
                    }),
                  'INVOICE_STATE_INVALID',
                );
                await fails(
                  () =>
                    invoices.payer(seller.token, draft.id, {
                      expectedVersion: draft.version,
                      payerUserId: null,
                    }),
                  'INVOICE_STATE_INVALID',
                );
                // The database keeps the shape: one combo line at the combo price, never edited.
                await sqlRejects(
                  () =>
                    tx.invoiceLine.update({
                      where: { id: draft.comboLine!.id },
                      data: { unitPriceVnd: 1n, grossVnd: 1n, rowVersion: { increment: 1 } },
                    }),
                  /priced by its combo and never edited/,
                );
                await sqlRejects(
                  () =>
                    tx.invoiceLine.create({
                      data: {
                        invoiceId: draft.id,
                        sequence: 2,
                        kind: 'SERVICE',
                        itemCode: 'X',
                        nameVi: 'x',
                        nameEn: 'x',
                        quantity: 1,
                        unitPriceVnd: 1n,
                        grossVnd: 1n,
                      },
                    }),
                  /line kind must match the invoice kind/,
                );
                await sqlRejects(
                  () =>
                    tx.invoiceLine.create({
                      data: {
                        invoiceId: draft.id,
                        sequence: 2,
                        kind: 'COMBO_PURCHASE',
                        itemCode: 'X',
                        nameVi: 'x',
                        nameEn: 'x',
                        quantity: 1,
                        unitPriceVnd: 1n,
                        grossVnd: 1n,
                      },
                    }),
                  /exactly one combo purchase line|combo detail/,
                );
                await sqlRejects(
                  () =>
                    tx.invoice.update({
                      where: { id: draft.id },
                      data: { visitId: randomUUID(), rowVersion: { increment: 1 } },
                    }),
                  /./,
                );
                // A draft can be cancelled without re-authentication, like any draft.
                const cancelled = await ok(() =>
                  invoices.cancel(canceller.token, draft.id, {
                    expectedVersion: draft.version,
                    reason: 'Khách đổi ý',
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal((await purchasesOf(draft.id)).length, 0);
              },
            );

            await suite.test('the POS board lists a combo sale and offers selling', async () => {
              const draft = await startSale(main, buyer);
              const board = await ok(() => invoices.board(seller.token, branch.id, undefined));
              assert.equal(board.canSellCombos, true);
              const entry = board.invoices.find((invoice) => invoice.id === draft.id)!;
              assert.equal(entry.kind, 'COMBO_SALE');
              assert.equal(entry.visitId, null);
              assert.equal(entry.visitCode, null);
              assert.equal(entry.comboName?.vi, 'Combo massage mua 5 tặng 1');
              assert.equal(entry.payerName, buyer.fullName);
              assert.equal(
                (await ok(() => invoices.board(preparer.token, branch.id, undefined)))
                  .canSellCombos,
                false,
              );
              await ok(() =>
                invoices.cancel(canceller.token, draft.id, {
                  expectedVersion: draft.version,
                  reason: 'Dọn dẹp',
                }),
              );
            });

            // ====================================================================================== the money flow
            const diamond = await customer('diamond');
            await suite.test(
              'paid sale: member discount on the combo price, points once, combo issued only when PAID, one row per session',
              async () => {
                await giveTier(diamond, 5000);
                const draft = await startSale(main, diamond);
                // The preview already shows the Diamond 7% member discount on the combo price.
                assert.equal(draft.discount.preview, true);
                assert.equal(draft.discountTotalVnd, '70000');
                assert.equal(draft.totalVnd, '930000');
                const final = await finalize(draft);
                assert.equal(final.status, 'PENDING_PAYMENT');
                assert.equal(final.totalVnd, '930000');
                assert.equal(final.discount.winnerSource, 'MEMBER_TIER');
                assert.equal(final.comboLine?.issuance, 'NOT_PAID');
                // Finalized, unpaid: nothing is issued, nothing is earned.
                assert.deepEqual(await consume(final.id), []);
                assert.equal((await purchasesOf(final.id)).length, 0);
                await sqlRejects(
                  () =>
                    tx.comboPurchase.create({
                      data: {
                        comboId: main.id,
                        versionId: main.current.id,
                        ownerUserId: diamond.id,
                        invoiceLineId: final.comboLine!.id,
                        paidSeq: 1,
                        serviceId: massage.id,
                        nameVi: main.current.nameVi,
                        nameEn: main.current.nameEn,
                        paidSessions: 5,
                        bonusSessions: 1,
                        priceVnd: 1_000_000n,
                        expiryMode: 'NONE',
                      },
                    }),
                  /current paid episode of a paid invoice/,
                );
                const paid = await pay(final);
                assert.equal(paid.invoice.status, 'PAID');
                // Paid, but the worker has not run yet: the combo is on its way.
                const waiting = await reload(final.id);
                assert.equal(waiting.comboLine?.issuance, 'PENDING');
                assert.equal((await purchasesOf(final.id)).length, 0);
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                // PRD 17.7: 1,000,000 at Diamond 7% = 930,000 paid = 930 points, once.
                assert.equal(await balanceOf(diamond.id), 5930);
                const [purchase, ...extra] = await purchasesOf(final.id);
                assert.equal(extra.length, 0);
                assert.equal(purchase!.ownerUserId, diamond.id);
                assert.equal(purchase!.paidSeq, 1);
                assert.equal(purchase!.comboId, main.id);
                assert.equal(purchase!.serviceId, massage.id);
                assert.equal(purchase!.expiresAt, null, 'no expiry');
                assert.equal(purchase!.voidedAt, null);
                assert.equal(purchase!.priceVnd, 1_000_000n);
                // One row per session, numbered 1..6, five PAID then one BONUS (P5-T11).
                assert.deepEqual(
                  purchase!.sessions.map((session) => [session.sessionNo, session.kind]),
                  [
                    [1, 'PAID'],
                    [2, 'PAID'],
                    [3, 'PAID'],
                    [4, 'PAID'],
                    [5, 'PAID'],
                    [6, 'BONUS'],
                  ],
                );
                const done = await reload(final.id);
                assert.equal(done.comboLine?.issuance, 'ISSUED');
                assert.ok(done.comboLine?.issuedAt);
                // A replay of the same events changes nothing.
                assert.deepEqual(await consume(final.id), []);
                const event = await tx.outboxEvent.findFirstOrThrow({
                  where: {
                    aggregateType: 'ComboPurchase',
                    aggregateId: purchase!.id,
                    eventType: 'COMBO_ISSUED',
                  },
                });
                assert.deepEqual(Object.keys(event.payload as object).sort(), [
                  'bonusSessions',
                  'comboPurchaseId',
                  'invoiceId',
                  'paidSeq',
                  'paidSessions',
                ]);
                // The same episode can never be issued twice.
                await sqlRejects(
                  () =>
                    tx.comboPurchase.create({
                      data: {
                        comboId: main.id,
                        versionId: main.current.id,
                        ownerUserId: diamond.id,
                        invoiceLineId: final.comboLine!.id,
                        paidSeq: 1,
                        serviceId: massage.id,
                        nameVi: main.current.nameVi,
                        nameEn: main.current.nameEn,
                        paidSessions: 5,
                        bonusSessions: 1,
                        priceVnd: 1_000_000n,
                        expiryMode: 'NONE',
                      },
                    }),
                  /combo_purchases_line_episode_key|Unique constraint/,
                );
                // The owner sees the purchase as an invoice (no visit date, the combo as its line).
                const view = await customerInvoiceDetail(tx, diamond.id, final.id);
                assert.equal(view.kind, 'COMBO_SALE');
                assert.equal(view.lines.length, 1);
                assert.equal(view.lines[0]!.nameVi, 'Combo massage mua 5 tặng 1');
                assert.equal(view.lines[0]!.forSelf, true);
                assert.equal(view.totalVnd, '930000');
              },
            );

            await suite.test(
              'a combo edited or switched off AFTER finalization is still issued exactly as it was sold',
              async () => {
                const combo = await defineCombo({ nameVi: 'Combo bán', priceVnd: '500000' });
                const member = await customer('snapshot');
                const final = await finalize(await startSale(combo, member));
                await edit(combo, { priceVnd: '800000', paidSessions: 9 });
                await edit(
                  (await ok(() => combos.list(ownerToken))).combos.find((c) => c.id === combo.id)!,
                  {
                    active: false,
                    priceVnd: '800000',
                    paidSessions: 9,
                  },
                );
                await pay(final);
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                const [purchase] = await purchasesOf(final.id);
                assert.equal(purchase!.priceVnd, 500_000n);
                assert.equal(purchase!.paidSessions, 5);
                assert.equal(purchase!.sessions.length, 6);
                assert.equal(purchase!.nameVi, 'Combo bán');
                assert.equal(purchase!.versionId, combo.current.id);
              },
            );

            await suite.test(
              'a draft whose combo changed (price, sessions, switched off) cannot be finalized; a rename does not matter',
              async () => {
                const combo = await defineCombo({ priceVnd: '600000' });
                const member = await customer('changed');
                const stale = await startSale(combo, member);
                const renamed = await edit(combo, { nameVi: 'Tên mới', nameEn: 'New name' });
                const f1 = await finalize(stale);
                assert.equal(f1.status, 'PENDING_PAYMENT', 'a rename is fine');
                const second = await startSale(renamed, member);
                const repriced = await edit(renamed, { priceVnd: '650000' });
                await fails(
                  () =>
                    invoices.finalize(seller.token, second.id, { expectedVersion: second.version }),
                  'COMBO_CHANGED',
                );
                const third = await startSale(repriced, member);
                const off = await edit(repriced, { active: false });
                await fails(
                  () =>
                    invoices.finalize(seller.token, third.id, { expectedVersion: third.version }),
                  'COMBO_CHANGED',
                );
                // A sale needs the combo on sale now, and the line is a copy of the version current at that moment.
                await fails(
                  () =>
                    invoices.openComboSale(seller.token, branch.id, {
                      comboId: off.id,
                      payerUserId: member.id,
                    }),
                  'COMBO_NOT_SELLABLE',
                );
                for (const draft of [second, third]) {
                  await ok(() =>
                    invoices.cancel(canceller.token, draft.id, {
                      expectedVersion: draft.version,
                      reason: 'Combo đã đổi',
                    }),
                  );
                }
              },
            );

            await suite.test(
              'payment reversed before any session is used: the combo is taken back, points reversed; paying again issues a new combo',
              async () => {
                const member = await customer('reversal');
                await giveTier(member, 500);
                const final = await finalize(await startSale(main, member));
                assert.equal(final.totalVnd, '970000', 'Silver 3%');
                const paid = await pay(final);
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                assert.equal(await balanceOf(member.id), 500 + 970);
                const [first] = await purchasesOf(final.id);
                assert.equal(first!.voidedAt, null);
                // Reverse the cash payment: the invoice is reopened.
                await reverse(final.id, paid.payment.id);
                assert.equal((await reload(final.id)).status, 'PENDING_PAYMENT');
                // Until the worker runs the combo still stands, then it is taken back.
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                assert.equal(
                  await balanceOf(member.id),
                  500,
                  'the earned points were taken back too',
                );
                const [revoked] = await purchasesOf(final.id);
                assert.ok(revoked!.voidedAt);
                assert.equal(
                  revoked!.voidedByUserId,
                  corrector.id,
                  'the person who reversed the payment',
                );
                assert.match(revoked!.voidReason ?? '', /đảo/);
                assert.equal(revoked!.sessions.length, 6, 'the sessions stay as history');
                assert.equal((await reload(final.id)).comboLine?.issuance, 'REVOKED');
                assert.ok(
                  await tx.outboxEvent.findFirst({
                    where: { aggregateId: revoked!.id, eventType: 'COMBO_REVOKED' },
                  }),
                );
                // Paying again: a NEW purchase under the next paid episode; the old one stays voided.
                const reopened = await reload(final.id);
                await pay(reopened);
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                const all = await purchasesOf(final.id);
                assert.equal(all.length, 2);
                assert.equal(all[0]!.paidSeq, 1);
                assert.ok(all[0]!.voidedAt);
                assert.equal(all[1]!.paidSeq, 2);
                assert.equal(all[1]!.voidedAt, null);
                assert.equal(all[1]!.sessions.length, 6);
                assert.equal((await reload(final.id)).comboLine?.issuance, 'ISSUED');
                assert.equal(
                  await balanceOf(member.id),
                  500 + 970,
                  'points earned once for the current episode',
                );
              },
            );

            await suite.test(
              'a stale paid event (reversed before the worker ran) issues nothing; cancelling a reopened sale leaves it revoked',
              async () => {
                const member = await customer('stale');
                const final = await finalize(await startSale(main, member));
                const paid = await pay(final);
                // The worker has not seen the payment yet when it is reversed.
                await reverse(final.id, paid.payment.id);
                assert.deepEqual(await consume(final.id), ['SKIPPED_STALE', 'NOOP']);
                assert.equal((await purchasesOf(final.id)).length, 0);
                const reopened = await reload(final.id);
                const cancelled = await ok(() =>
                  invoices.cancel(canceller.token, reopened.id, {
                    expectedVersion: reopened.version,
                    reason: 'Khách không mua nữa',
                  }),
                );
                assert.equal(cancelled.status, 'CANCELLED');
                assert.deepEqual(await consume(final.id), ['NOOP']);
                assert.equal((await purchasesOf(final.id)).length, 0);
              },
            );

            await suite.test(
              'DB rule: an issued combo is revoked only after its paid episode ended and while no session is in use',
              async () => {
                const member = await customer('dbrules');
                const final = await finalize(await startSale(main, member));
                await pay(final);
                await consume(final.id);
                const [purchase] = await purchasesOf(final.id);
                await sqlRejects(
                  () =>
                    tx.comboPurchase.update({
                      where: { id: purchase!.id },
                      data: { voidedAt: new Date(), voidedByUserId: ownerRow.id, voidReason: 'x' },
                    }),
                  /after the paid episode that issued it has ended/,
                );
                await sqlRejects(
                  () =>
                    tx.comboPurchase.update({
                      where: { id: purchase!.id },
                      data: { priceVnd: 1n },
                    }),
                  /immutable apart from being voided once/,
                );
                await sqlRejects(
                  () =>
                    tx.$executeRaw`DELETE FROM combo_purchases WHERE id = ${purchase!.id}::uuid`,
                  /never deleted/,
                );
              },
            );

            await suite.test(
              'a zero-balance combo sale (a 100% program) is paid at finalization and issues the combo',
              async () => {
                await ok(() =>
                  discounts.create(ownerToken, {
                    code: `FREE${run}`,
                    nameVi: 'Miễn phí',
                    nameEn: 'Free',
                    requiresCode: false,
                    version: {
                      kind: 'PERCENT',
                      percentBp: 10_000,
                      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
                      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
                      minSpendVnd: '0',
                      scopeMode: 'SELECTED',
                      serviceIds: [nails.id],
                      categoryIds: [],
                      usageLimitTotal: null,
                      usageLimitPerCustomer: null,
                    },
                  }),
                );
                // A program scoped to the combo's SERVICE reaches the combo line (best offer, PRD 16.1, Owner answer).
                const combo = await defineCombo({ serviceId: nails.id, priceVnd: '300000' });
                const member = await customer('promo');
                const draft = await startSale(combo, member);
                assert.equal(draft.discount.winnerSource, 'PROMOTION');
                const final = await finalize(draft);
                assert.equal(final.status, 'PAID');
                assert.equal(final.totalVnd, '0');
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                const [purchase] = await purchasesOf(final.id);
                assert.equal(purchase!.sessions.length, 6);
                assert.equal(await balanceOf(member.id), 0, 'a 0 VND sale earns no points');
              },
            );

            await suite.test(
              'a promotion and a voucher both reach a combo line, but only the better ONE applies: never stacked (Owner, 2026-10-05)',
              async () => {
                const spa = await newService('STACK');
                const version = (fixedAmountVnd: string) => ({
                  kind: 'FIXED_AMOUNT' as const,
                  fixedAmountVnd,
                  validFrom: new Date(Date.now() - 86_400_000).toISOString(),
                  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
                  minSpendVnd: '0',
                  scopeMode: 'SELECTED' as const,
                  serviceIds: [spa.id],
                  categoryIds: [],
                  usageLimitTotal: null,
                  usageLimitPerCustomer: null,
                });
                await ok(() =>
                  discounts.create(ownerToken, {
                    code: `STP${run}`,
                    nameVi: 'Khuyến mãi',
                    nameEn: 'Promotion',
                    requiresCode: false,
                    version: version('50000'),
                  }),
                );
                const program = await ok(() =>
                  discounts.create(ownerToken, {
                    code: `STV${run}`,
                    nameVi: 'Voucher',
                    nameEn: 'Voucher',
                    requiresCode: true,
                    version: version('80000'),
                  }),
                );
                await ok(() =>
                  discounts.createVoucher(ownerToken, program.id, { code: `STACK${run}` }),
                );
                const combo = await defineCombo({ serviceId: spa.id, priceVnd: '300000' });
                const draft = await startSale(combo, await customer('stack'));
                const supplied = await ok(() =>
                  invoices.supplyVoucher(ownerToken, draft.id, {
                    expectedVersion: draft.version,
                    code: `STACK${run}`,
                  }),
                );
                assert.equal(
                  supplied.discount.candidates.filter((candidate) => candidate.eligible).length,
                  2,
                  'both reach the combo line',
                );
                assert.equal(
                  supplied.discountTotalVnd,
                  '80000',
                  'the better one only, not 130,000',
                );
                const final = (await ok(() =>
                  invoices.finalize(ownerToken, supplied.id, { expectedVersion: supplied.version }),
                )) as InvoiceResponse;
                assert.equal(final.discountTotalVnd, '80000');
                assert.equal(final.totalVnd, '220000');
                assert.equal(final.discount.winnerSource, 'VOUCHER');
                assert.equal(
                  await tx.invoiceDiscountApplication.count({ where: { invoiceId: final.id } }),
                  1,
                );
                assert.equal(
                  await tx.discountRedemption.count({ where: { invoiceId: final.id } }),
                  1,
                );
              },
            );

            await suite.test('a combo sale never takes a visit-only path', async () => {
              const member = await customer('visitonly');
              const final = await finalize(await startSale(main, member));
              const paid = await pay(final);
              await consume(final.id);
              assert.equal(await tx.referral.count({ where: { awardedInvoiceId: final.id } }), 0);
              assert.equal(paid.invoice.status, 'PAID');
              const row = await tx.invoice.findUniqueOrThrow({ where: { id: final.id } });
              assert.equal(row.visitId, null);
            });

            await suite.test(
              'the birthday gift never applies to a combo sale, even for a member inside the window (Owner answer)',
              async () => {
                const rows = await tx.$queryRaw<{ today: string }[]>`
                  SELECT lucy_branch_local_date(${branch.id}::uuid, clock_timestamp())::text AS today`;
                const today = rows[0]!.today;
                const birthday = await tx.user.create({
                  data: {
                    kind: 'CUSTOMER',
                    status: 'ACTIVE',
                    fullName: 'Khách sinh nhật',
                    preferredLocale: 'vi',
                    emailCanonical: `p57-bday-${run.toLowerCase()}@example.com`,
                    emailDelivery: `p57-bday-${run.toLowerCase()}@example.com`,
                    emailVerifiedAt: new Date(),
                    phoneCanonical: phoneOf(),
                    normalizationVersion: 1,
                    passwordHash: '$argon2id$fixture',
                    customerProfile: {
                      create: {
                        dateOfBirth: new Date(`2000${today.slice(4)}`),
                        address: 'Fixture',
                      },
                    },
                  },
                });
                await ok(() =>
                  loyalty.saveBirthdayReward(ownerToken, {
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
                  }),
                );
                // The member really is inside the window, so the gift would apply to an ordinary invoice.
                const [window] = await tx.$queryRaw<{ occurrence: Date | null }[]>`
                  SELECT lucy_birthday_occurrence(${new Date(`2000${today.slice(4)}`)}::date, ${today}::date, 7, 7) AS occurrence`;
                assert.ok(window!.occurrence);
                const draft = await startSale(main, birthday);
                assert.equal(draft.discount.birthday, null);
                assert.equal(draft.discountTotalVnd, '0');
                const final = await finalize(draft);
                assert.equal(final.discountTotalVnd, '0');
                assert.equal(final.discount.birthday, null);
                assert.equal(
                  await tx.birthdayRedemption.count({ where: { invoiceId: final.id } }),
                  0,
                );
                const snapshot = await tx.invoiceLoyaltySnapshot.findUnique({
                  where: { invoiceId: final.id },
                });
                assert.ok(!snapshot || snapshot.birthdayAmountVnd === 0n);
              },
            );

            await suite.test(
              'buying a combo is not a visit: it never triggers the referral reward, however much was paid',
              async () => {
                const referrer = await customer('referrer');
                const referred = await customer('referred');
                const referral = await tx.referral.create({
                  data: {
                    referredUserId: referred.id,
                    referrerUserId: referrer.id,
                    boundVia: 'COUNTER',
                    boundByUserId: seller.id,
                  },
                });
                const final = await finalize(await startSale(main, referred));
                await pay(final);
                assert.deepEqual(await consume(final.id), ['APPLIED']);
                const after = await tx.referral.findUniqueOrThrow({ where: { id: referral.id } });
                assert.equal(after.awardedAt, null);
                assert.equal(after.awardedInvoiceId, null);
                assert.equal(await balanceOf(referrer.id), 0);
                assert.equal(
                  await balanceOf(referred.id),
                  1000,
                  'the buyer still earns for the purchase',
                );
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
