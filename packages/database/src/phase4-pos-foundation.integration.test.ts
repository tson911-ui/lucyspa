import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  generateInvoiceCode,
  INVOICE_CODE_ALPHABET,
  INVOICE_CODE_PATTERN,
  isInvoiceCode,
  PERMISSION_CATALOG,
  syncPermissionCatalog,
  type Prisma,
} from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const FINANCIAL_CODES = [
  'VIEW_INVOICES',
  'MANAGE_INVOICES',
  'COLLECT_PAYMENTS',
  'APPLY_DISCOUNTS',
  'MANAGE_DISCOUNTS',
  'CREATE_VOUCHERS',
  'CANCEL_INVOICES',
  'CORRECT_PAYMENTS',
  'VIEW_REVENUE',
] as const;
const GLOBAL_ONLY_FINANCIAL = ['MANAGE_DISCOUNTS', 'CREATE_VOUCHERS'];

// Monday 2027-03-01 in Asia/Ho_Chi_Minh (UTC+7).
const DAY = new Date('2027-03-01T00:00:00.000Z');
const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();

test('invoice code generator: INV-YYMMDD-XXXXXX, unambiguous alphabet, real dates only', () => {
  // Deterministic bytes: 0,1,2,3,4,5 -> A,B,C,D,E,F; the alphabet has no 0, 1, I or O.
  const code = generateInvoiceCode('2027-03-01', () => Uint8Array.from([0, 1, 2, 3, 4, 5]));
  assert.equal(code, 'INV-270301-ABCDEF');
  assert.ok(isInvoiceCode(code));
  assert.equal(INVOICE_CODE_ALPHABET.length, 32);
  for (const banned of ['0', '1', 'I', 'O']) assert.ok(!INVOICE_CODE_ALPHABET.includes(banned));
  // 256 is a multiple of 32: every byte maps to a letter of the alphabet.
  for (let byte = 0; byte < 256; byte += 1) {
    const generated = generateInvoiceCode('2027-12-31', () =>
      Uint8Array.from([byte, 0, 0, 0, 0, 0]),
    );
    assert.match(generated, INVOICE_CODE_PATTERN);
    assert.equal(generated.slice(0, 11), 'INV-271231-');
  }
  // A random source produces valid, varying codes.
  const seen = new Set(Array.from({ length: 50 }, () => generateInvoiceCode('2027-03-01')));
  assert.ok(seen.size > 45);
  for (const value of seen) assert.match(value, INVOICE_CODE_PATTERN);
  for (const bad of [
    '2027-3-1',
    '20270301',
    '2027-02-30',
    '2027-13-01',
    'x',
    '',
    '2027-03-01T00',
  ]) {
    assert.throws(() => generateInvoiceCode(bad), /business date/, bad);
  }
  assert.throws(
    () => generateInvoiceCode('2027-03-01', () => new Uint8Array(5)),
    /six random bytes/,
  );
  for (const bad of [
    'INV-270301-ABCDE0',
    'INV-270301-abcdef',
    'BK-270301-ABCDEF',
    'INV-27031-ABCDEF',
  ]) {
    assert.equal(isInvoiceCode(bad), false, bad);
  }
});

test('Phase 4 Step 4 POS database foundation invariants (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 4 POS foundation rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          // Each rejected statement runs in its own savepoint so the fixture transaction survives.
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          // Deferred integrity triggers fire at commit; fixtures never commit, so check on demand.
          const settle = async () => {
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
          };
          // Truncating a referenced table is refused by the history guard or by the foreign key.
          const NO_TRUNCATE = /cannot be removed or rewritten|cannot truncate a table referenced/;
          const dbNow = async () =>
            (await tx.$queryRaw<{ t: Date }[]>`SELECT clock_timestamp() AS t`)[0]!.t;

          let sequence = 0;
          const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
          const user = async (kind: 'CUSTOMER' | 'EMPLOYEE') => {
            sequence += 1;
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind,
                status: 'ACTIVE',
                fullName: `P4 fixture ${sequence}`,
                preferredLocale: 'vi',
                emailCanonical: `p4-${sequence}-${run.toLowerCase()}@example.com`,
                emailDelivery: `p4-${sequence}-${run.toLowerCase()}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+849${phoneBase}${String(sequence).padStart(3, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                ...(kind === 'CUSTOMER'
                  ? {
                      customerProfile: {
                        create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                      },
                    }
                  : {
                      employeeProfile: {
                        create: {
                          employeeCodeCanonical: `P4_${run}_${sequence}`,
                          dateOfBirth: new Date('1990-01-01'),
                          address: 'Fixture',
                        },
                      },
                    }),
              },
              select: { id: true },
            });
            return id;
          };
          const branch = (
            await tx.branch.create({
              data: { code: `IT-P4-${run}`, name: 'P4 branch', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const otherBranch = (
            await tx.branch.create({
              data: {
                code: `IT-P4B-${run}`,
                name: 'P4 other branch',
                timezone: 'Asia/Ho_Chi_Minh',
              },
              select: { id: true },
            })
          ).id;
          const category = (
            await tx.serviceCategory.create({
              data: { code: `IT_P4_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
              select: { id: true },
            })
          ).id;
          const service = async (
            key: string,
            price: [bigint, bigint],
            unit: 'PER_SERVICE' | 'PER_NAIL' = 'PER_SERVICE',
            maxQuantity = 1,
          ) => {
            const row = await tx.service.create({
              data: {
                code: `IT_P4_${key}_${run}`,
                categoryId: category,
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
              select: {
                id: true,
                code: true,
                nameVi: true,
                nameEn: true,
                priceVnd: true,
                priceMaxVnd: true,
                pricingUnit: true,
                maxQuantity: true,
              },
            });
            return row;
          };
          type ServiceRow = Awaited<ReturnType<typeof service>>;
          const ranged = await service('RANGED', [100_000n, 150_000n]);
          const exact = await service('EXACT', [200_000n, 200_000n]);
          const nail = await service('NAIL', [5_000n, 10_000n], 'PER_NAIL', 10);
          const free = await service('FREE', [0n, 50_000n]);
          const wide = await service('WIDE', [1_000n, 10_000_000n]);

          const customer = await user('CUSTOMER');
          const customer2 = await user('CUSTOMER');
          const staff = await user('EMPLOYEE');
          const ktv = await user('EMPLOYEE');
          const today = (
            await tx.$queryRaw<
              { d: Date }[]
            >`SELECT lucy_branch_local_date(${branch}::uuid, now()) AS d`
          )[0]!.d;
          const todayText = today.toISOString().slice(0, 10);

          // ------------------------------------------------------------- visit fixtures
          let slot = 0;
          let visitSequence = 0;
          const slotStart = () => new Date(LOCAL_MIDNIGHT + (6 * 60 + 10 * slot++) * 60_000);
          const snapshotOf = (row: ServiceRow) => ({
            serviceCode: row.code,
            serviceNameVi: row.nameVi,
            serviceNameEn: row.nameEn,
            catalogPriceMinVnd: row.priceVnd,
            catalogPriceMaxVnd: row.priceMaxVnd,
            catalogPricingUnit: row.pricingUnit,
            maxQuantitySnapshot: row.maxQuantity,
          });
          interface VisitFixture {
            id: string;
            participantId: string;
            done: { id: string; service: ServiceRow }[];
            cancelled: { id: string }[];
          }
          /** A COMPLETED visit whose services were performed (DONE), plus optional cancelled lines. */
          const completedVisit = async (
            services: ServiceRow[],
            options: { cancelled?: number; branchId?: string } = {},
          ): Promise<VisitFixture> => {
            visitSequence += 1;
            const visit = await tx.visit.create({
              data: {
                code: `VS-P4-${run}-${visitSequence}`,
                branchId: options.branchId ?? branch,
                origin: 'WALK_IN',
                serviceDate: DAY,
                arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                createdByUserId: staff,
                idempotencyKey: randomUUID(),
              },
              select: { id: true },
            });
            const participant = await tx.visitParticipant.create({
              data: { visitId: visit.id, kind: 'GUEST', displayName: 'Khách' },
              select: { id: true },
            });
            let sequenceInVisit = 0;
            const line = async (row: ServiceRow) => {
              sequenceInVisit += 1;
              const start = slotStart();
              return tx.visitServiceLine.create({
                data: {
                  visitId: visit.id,
                  participantId: participant.id,
                  sequence: sequenceInVisit,
                  serviceId: row.id,
                  employeeUserId: ktv,
                  assignmentMode: 'ANY',
                  plannedStartAt: start,
                  plannedEndAt: new Date(start.getTime() + 10 * 60_000),
                  durationMinutes: 10,
                  bufferMinutes: 0,
                  ...snapshotOf(row),
                },
                select: { id: true, plannedStartAt: true },
              });
            };
            const done: VisitFixture['done'] = [];
            const cancelled: VisitFixture['cancelled'] = [];
            for (const row of services) done.push({ id: (await line(row)).id, service: row });
            for (let index = 0; index < (options.cancelled ?? 0); index += 1) {
              const extra = await line(services[0]!);
              await tx.visitServiceLine.update({
                where: { id: extra.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: new Date('2027-03-01T05:45:00+07:00'),
                  cancelledByUserId: staff,
                  cancelReason: 'Khách đổi ý',
                  rowVersion: { increment: 1 },
                },
              });
              cancelled.push({ id: extra.id });
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
                  employeeUserId: ktv,
                  startedAt: started,
                  expectedEndAt: new Date(started.getTime() + 10 * 60_000),
                },
                select: { id: true },
              });
              await tx.serviceExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'ENDED',
                  endedAt: new Date(started.getTime() + 10 * 60_000),
                  endKind: 'NORMAL',
                  endedByUserId: ktv,
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
            return { id: visit.id, participantId: participant.id, done, cancelled };
          };

          // ------------------------------------------------------------ invoice fixtures
          interface InvoiceFixture {
            id: string;
            code: string;
            visitId: string;
            lines: { id: string; visitLineId: string; service: ServiceRow }[];
          }
          const draft = async (
            visit: VisitFixture,
            options: {
              payer?: string | null;
              branchId?: string;
              priced?: [number, bigint][];
              code?: string;
            } = {},
          ): Promise<InvoiceFixture> => {
            const code = options.code ?? generateInvoiceCode(todayText);
            const invoice = await tx.invoice.create({
              data: {
                code,
                branchId: options.branchId ?? branch,
                visitId: visit.id,
                payerUserId: options.payer ?? null,
                businessDate: today,
                calculationVersion: 1,
                createdByUserId: staff,
              },
              select: { id: true },
            });
            const lines: InvoiceFixture['lines'] = [];
            for (const [index, entry] of visit.done.entries()) {
              const priced = options.priced?.[index];
              const line = await tx.invoiceLine.create({
                data: {
                  invoiceId: invoice.id,
                  sequence: index + 1,
                  itemCode: entry.service.code,
                  nameVi: entry.service.nameVi,
                  nameEn: entry.service.nameEn,
                  ...(priced
                    ? {
                        quantity: priced[0],
                        unitPriceVnd: priced[1],
                        grossVnd: BigInt(priced[0]) * priced[1],
                        priceSetByUserId: staff,
                        priceSetAt: await dbNow(),
                      }
                    : {}),
                },
                select: { id: true },
              });
              await tx.invoiceLineService.create({
                data: {
                  invoiceLineId: line.id,
                  invoiceId: invoice.id,
                  visitServiceLineId: entry.id,
                  serviceId: entry.service.id,
                  participantId: visit.participantId,
                  employeeUserId: ktv,
                  pricingUnit: entry.service.pricingUnit,
                  catalogPriceMinVnd: entry.service.priceVnd,
                  catalogPriceMaxVnd: entry.service.priceMaxVnd,
                  quantityLimit: entry.service.maxQuantity,
                  addedOnBehalf: false,
                },
              });
              lines.push({ id: line.id, visitLineId: entry.id, service: entry.service });
            }
            return { id: invoice.id, code, visitId: visit.id, lines };
          };
          const priceLine = async (lineId: string, quantity: number, unitPrice: bigint) =>
            tx.invoiceLine.update({
              where: { id: lineId },
              data: {
                quantity,
                unitPriceVnd: unitPrice,
                grossVnd: BigInt(quantity) * unitPrice,
                priceSetByUserId: staff,
                priceSetAt: await dbNow(),
                rowVersion: { increment: 1 },
              },
            });
          const version = async (id: string) =>
            (await tx.invoice.findUniqueOrThrow({ where: { id }, select: { rowVersion: true } }))
              .rowVersion;
          const subtotalOf = async (id: string) =>
            (await tx.invoiceLine.aggregate({ where: { invoiceId: id }, _sum: { grossVnd: true } }))
              ._sum.grossVnd ?? 0n;
          /** Finalizes a priced draft: PENDING_PAYMENT, or PAID directly when the receivable is 0. */
          const finalize = async (id: string, discountTotal = 0n) => {
            const subtotal = await subtotalOf(id);
            const total = subtotal - discountTotal;
            const at = await dbNow();
            return tx.invoice.update({
              where: { id },
              data: {
                status: total === 0n ? 'PAID' : 'PENDING_PAYMENT',
                subtotalVnd: subtotal,
                discountTotalVnd: discountTotal,
                totalVnd: total,
                finalizedAt: at,
                finalizedByUserId: staff,
                ...(total === 0n ? { paidAt: at, paidSeq: 1 } : {}),
                rowVersion: { increment: 1 },
              },
            });
          };
          /** A finalized, unpaid invoice worth `price` for one wide-range service. */
          const unpaid = async (price = 200_000n, payer: string | null = null) => {
            const visit = await completedVisit([wide]);
            const invoice = await draft(visit, { payer, priced: [[1, price]] });
            await finalize(invoice.id);
            await settle();
            return { visit, invoice };
          };
          const pay = async (
            invoiceId: string,
            amount: bigint,
            due: bigint,
            options: { tendered?: bigint; key?: string; by?: string } = {},
          ) => {
            const tendered = options.tendered ?? amount;
            return tx.payment.create({
              data: {
                invoiceId,
                branchId: branch,
                method: 'CASH',
                status: 'SUCCEEDED',
                amountDueVnd: due,
                amountVnd: amount,
                tenderedVnd: tendered,
                changeVnd: tendered - amount,
                collectedByUserId: options.by ?? staff,
                idempotencyKey: options.key ?? randomUUID(),
              },
            });
          };
          const markPaid = async (id: string) =>
            tx.invoice.update({
              where: { id },
              data: {
                status: 'PAID',
                paidAt: await dbNow(),
                paidSeq: { increment: 1 },
                rowVersion: { increment: 1 },
              },
            });

          // =================================================================== permissions

          await context.test(
            'permission foundation: the nine financial codes, FINANCIAL data, discounts and vouchers GLOBAL_ONLY',
            async () => {
              const labels = (
                await tx.$queryRaw<
                  { labels: string[] }[]
                >`SELECT enum_range(NULL::"PermissionCode")::text[] AS labels`
              )[0]?.labels;
              for (const code of FINANCIAL_CODES) {
                assert.ok(labels?.includes(code), code);
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
              }
              await syncPermissionCatalog(tx);
              const rows = await tx.permission.findMany({
                where: { code: { in: [...FINANCIAL_CODES] } },
                select: { code: true, scopeCapability: true, dataClassification: true },
              });
              assert.equal(rows.length, 9);
              for (const row of rows) {
                assert.equal(
                  row.scopeCapability,
                  GLOBAL_ONLY_FINANCIAL.includes(row.code) ? 'GLOBAL_ONLY' : 'BRANCH_CAPABLE',
                  row.code,
                );
                assert.equal(row.dataClassification, 'FINANCIAL', row.code);
              }
              // Only the pay codes are EMPLOYEE_PAY and no other code is FINANCIAL (Phase 5 adds two FINANCIAL codes, Phase 6 six).
              const others = await tx.permission.findMany({
                where: { code: { notIn: [...FINANCIAL_CODES] } },
                select: { code: true, dataClassification: true },
              });
              for (const row of others) {
                assert.equal(
                  row.dataClassification,
                  ['VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY'].includes(row.code)
                    ? 'EMPLOYEE_PAY'
                    : [
                          'ADJUST_LOYALTY_POINTS',
                          'RESTORE_COMBO_SESSIONS',
                          'MANAGE_PRODUCT_PRICES',
                          'VIEW_PRODUCT_COST',
                          'MANAGE_STOCK_RECEIPTS',
                          'IMPORT_PRODUCT_DATA',
                          'REFUND_PRODUCTS',
                          'MANAGE_PRODUCT_CAMPAIGNS',
                        ].includes(row.code)
                      ? 'FINANCIAL'
                      : 'STANDARD',
                  row.code,
                );
              }
              // The semantics are enforced in SQL: a wrong scope or classification never fits the
              // catalog rule (the CHECK fires before the unique key, so the message names the rule).
              const wrong = async (
                code: string,
                scope: 'GLOBAL_ONLY' | 'BRANCH_CAPABLE',
                classification: 'STANDARD' | 'EMPLOYEE_PAY' | 'FINANCIAL',
              ) =>
                rejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO permissions (id, code, scope_capability, data_classification)
                       VALUES (gen_random_uuid(), '${code}'::"PermissionCode", '${scope}'::"ScopeCapability", '${classification}'::"DataClassification")`,
                    ),
                  /permissions_catalog_semantics/,
                );
              await wrong('MANAGE_DISCOUNTS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('CREATE_VOUCHERS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('VIEW_INVOICES', 'GLOBAL_ONLY', 'FINANCIAL');
              await wrong('COLLECT_PAYMENTS', 'BRANCH_CAPABLE', 'STANDARD');
              await wrong('VIEW_REVENUE', 'BRANCH_CAPABLE', 'EMPLOYEE_PAY');
              await wrong('VIEW_EMPLOYEE_PAY', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('MANAGE_BOOKINGS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('MANAGE_SERVICE_PRICES', 'GLOBAL_ONLY', 'FINANCIAL');
              // The correct semantics pass the rule (the row already exists, so the unique key answers).
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `INSERT INTO permissions (id, code, scope_capability, data_classification)
                     VALUES (gen_random_uuid(), 'MANAGE_DISCOUNTS', 'GLOBAL_ONLY', 'FINANCIAL')`,
                  ),
                /permissions_code_key|Unique constraint|duplicate key/,
              );
              // Stored semantics are immutable.
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    "UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'MANAGE_DISCOUNTS'",
                  ),
                /code-owned and immutable/,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    "UPDATE permissions SET data_classification = 'STANDARD' WHERE code = 'VIEW_INVOICES'",
                  ),
                /code-owned and immutable/,
              );
              // A GLOBAL_ONLY code can be overridden at GLOBAL scope only; a branch grant is refused.
              const catalog = new Map(
                (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                  row.code,
                  row.id,
                ]),
              );
              const grantee = await user('EMPLOYEE');
              for (const code of GLOBAL_ONLY_FINANCIAL) {
                await rejects(
                  () =>
                    tx.userPermissionOverride.create({
                      data: {
                        userId: grantee,
                        permissionId: catalog.get(code as never)!,
                        effect: 'ALLOW',
                        scopeKind: 'BRANCH',
                        branchId: branch,
                      },
                    }),
                  /GLOBAL_ONLY permission cannot be overridden/,
                );
                await tx.userPermissionOverride.create({
                  data: {
                    userId: grantee,
                    permissionId: catalog.get(code as never)!,
                    effect: 'ALLOW',
                    scopeKind: 'GLOBAL',
                  },
                });
              }
              // Branch-capable financial codes can be granted at a branch (nothing is granted by default).
              await tx.userPermissionOverride.create({
                data: {
                  userId: grantee,
                  permissionId: catalog.get('COLLECT_PAYMENTS')!,
                  effect: 'ALLOW',
                  scopeKind: 'BRANCH',
                  branchId: branch,
                },
              });
              assert.equal(
                await tx.rolePermission.count({
                  where: { permission: { code: { in: [...FINANCIAL_CODES] } } },
                }),
                0,
                'no role receives a financial permission by default',
              );
            },
          );

          await context.test(
            'FINANCIAL audit classification: financial actions are always classified FINANCIAL',
            async () => {
              const event = (action: string, classification: 'STANDARD' | 'FINANCIAL') =>
                tx.auditEvent.create({
                  data: {
                    action,
                    actorKind: 'SYSTEM',
                    entityType: `P4Fin${run}`,
                    entityId: 'x',
                    dataClassification: classification,
                  },
                  select: { id: true },
                });
              for (const action of [
                'INVOICE_CREATED',
                'INVOICE_PRICE_SET',
                'INVOICE_PAYER_SET',
                'INVOICE_VOUCHER_SUPPLIED',
                'INVOICE_VOUCHER_REMOVED',
                'INVOICE_FINALIZED',
                'INVOICE_CANCELLED',
                'INVOICE_PAID',
                'INVOICE_REOPENED',
                'DISCOUNT_REDEMPTION_RELEASED',
                'DISCOUNT_CREATED',
                'DISCOUNT_VERSIONED',
                'DISCOUNT_TERMINATED',
                'VOUCHER_CREATED',
                'PAYMENT_RECORDED',
                'PAYMENT_REVERSED',
              ]) {
                await rejects(
                  () => event(action, 'STANDARD'),
                  /audit_events_financial_classification/,
                );
                await event(action, 'FINANCIAL');
              }
              // Existing operational audits stay STANDARD and are unaffected.
              await event('VISIT_LINE_ADDED', 'STANDARD');
              await event('SERVICE_PRICE_CHANGED', 'STANDARD');
              await settle();
            },
          );

          // ========================================================= quantity-limit (OP-1)

          await context.test(
            'quantity limit (OP-1): per service, PER_SERVICE is 1, snapshots are immutable and survive catalog changes',
            async () => {
              assert.equal(ranged.maxQuantity, 1);
              assert.equal(nail.maxQuantity, 10);
              // Constraints on the catalog column.
              const bad = (key: string, unit: 'PER_SERVICE' | 'PER_NAIL', limit: number) =>
                rejects(() => service(key, [1n, 1n], unit, limit), /services_max_quantity/);
              await bad('BAD1', 'PER_SERVICE', 2);
              await bad('BAD2', 'PER_NAIL', 0);
              await bad('BAD3', 'PER_NAIL', -5);
              // Default (legacy shape): a row inserted without the column gets the neutral limit 1.
              await tx.$executeRawUnsafe(
                `INSERT INTO services (code, category_id, name_vi, name_en, price_vnd, price_max_vnd,
                   duration_minutes, estimated_min_minutes, estimated_max_minutes)
                 VALUES ('IT_P4_LEGACY_${run}', '${category}', 'x', 'x', 1, 1, 10, 10, 10)`,
              );
              assert.equal(
                (await tx.service.findUniqueOrThrow({ where: { code: `IT_P4_LEGACY_${run}` } }))
                  .maxQuantity,
                1,
              );
              // A visit line has NO quantity, only the snapshot of the limit; the snapshot is a copy.
              const visit = await completedVisit([nail]);
              const visitLine = await tx.visitServiceLine.findUniqueOrThrow({
                where: { id: visit.done[0]!.id },
              });
              assert.equal(visitLine.maxQuantitySnapshot, 10);
              assert.ok(!('quantity' in visitLine), 'VisitServiceLine gained no quantity field');
              // Owner example: the limit was 10 when the line was established, the catalog is raised to 20.
              await tx.service.update({
                where: { id: nail.id },
                data: { maxQuantity: 20, rowVersion: { increment: 1 } },
              });
              assert.equal(
                (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: visitLine.id } }))
                  .maxQuantitySnapshot,
                10,
                'the existing visit line keeps 10',
              );
              const laterService = await tx.service.findUniqueOrThrow({ where: { id: nail.id } });
              assert.equal(laterService.maxQuantity, 20);
              const later = await completedVisit([
                { ...nail, maxQuantity: laterService.maxQuantity },
              ]);
              assert.equal(
                (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: later.done[0]!.id } }))
                  .maxQuantitySnapshot,
                20,
                'a line established afterwards carries the new limit',
              );
              // The invoice copies the visit line's limit (10), never the live catalog (20).
              const invoice = await draft(visit);
              const detail = await tx.invoiceLineService.findFirstOrThrow({
                where: { invoiceId: invoice.id },
              });
              assert.equal(detail.quantityLimit, 10);
              await priceLine(invoice.lines[0]!.id, 10, 5_000n);
              await settle();
              await rejects(async () => {
                await priceLine(invoice.lines[0]!.id, 11, 5_000n);
                await settle();
              }, /snapshotted range and its quantity within the snapshotted limit/);
              // The snapshot cannot be rewritten (visit line and booking line guards).
              await rejects(
                () =>
                  tx.visitServiceLine.update({
                    where: { id: visitLine.id },
                    data: { maxQuantitySnapshot: 20, rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE visit_service_lines SET max_quantity_snapshot = 3 WHERE id = '${later.done[0]!.id}'`,
                  ),
                /cannot be rewritten/,
              );
              // Snapshot CHECKs mirror the catalog rule (PER_SERVICE is 1, minimum 1).
              const ktvBooking = await user('EMPLOYEE');
              const booking = await tx.booking.create({
                data: {
                  code: `BK-P4-${run}-1`,
                  branchId: branch,
                  ownerUserId: customer,
                  channel: 'ONLINE',
                  startsAt: new Date('2027-03-01T09:00:00+07:00'),
                  endsAt: new Date('2027-03-01T09:10:00+07:00'),
                  serviceDate: DAY,
                  idempotencyKey: randomUUID(),
                  createdByUserId: customer,
                },
                select: { id: true },
              });
              const recipient = await tx.bookingRecipient.create({
                data: { bookingId: booking.id, relation: 'SELF' },
                select: { id: true },
              });
              const bookingLine = (limit: number, unit: 'PER_SERVICE' | 'PER_NAIL', seq: number) =>
                tx.bookingServiceLine.create({
                  data: {
                    bookingId: booking.id,
                    recipientId: recipient.id,
                    sequence: seq,
                    serviceId: nail.id,
                    employeeUserId: ktvBooking,
                    assignmentMode: 'ANY',
                    plannedStartAt: new Date('2027-03-01T09:00:00+07:00'),
                    plannedEndAt: new Date('2027-03-01T09:10:00+07:00'),
                    durationMinutes: 10,
                    bufferMinutes: 0,
                    serviceCode: nail.code,
                    serviceNameVi: nail.nameVi,
                    serviceNameEn: nail.nameEn,
                    catalogPriceMinVnd: 5_000n,
                    catalogPriceMaxVnd: 10_000n,
                    catalogPricingUnit: unit,
                    maxQuantitySnapshot: limit,
                  },
                  select: { id: true, maxQuantitySnapshot: true },
                });
              await rejects(
                () => bookingLine(2, 'PER_SERVICE', 1),
                /booking_service_lines_max_quantity/,
              );
              await rejects(
                () => bookingLine(0, 'PER_NAIL', 1),
                /booking_service_lines_max_quantity/,
              );
              // The same rule on a visit line (checked on an OPEN visit, where lines may be added).
              const openVisit = await tx.visit.create({
                data: {
                  code: `VS-P4-${run}-QTY`,
                  branchId: branch,
                  origin: 'WALK_IN',
                  serviceDate: DAY,
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: staff,
                  idempotencyKey: randomUUID(),
                },
                select: { id: true },
              });
              const openParticipant = await tx.visitParticipant.create({
                data: { visitId: openVisit.id, kind: 'GUEST', displayName: 'Khách' },
                select: { id: true },
              });
              const openLine = (unit: 'PER_SERVICE' | 'PER_NAIL', limit: number) =>
                tx.visitServiceLine.create({
                  data: {
                    visitId: openVisit.id,
                    participantId: openParticipant.id,
                    sequence: 1,
                    serviceId: nail.id,
                    status: 'WAITING',
                    assignmentMode: 'ANY',
                    durationMinutes: 10,
                    ...snapshotOf(nail),
                    catalogPricingUnit: unit,
                    maxQuantitySnapshot: limit,
                  },
                });
              await rejects(() => openLine('PER_SERVICE', 4), /visit_service_lines_max_quantity/);
              await rejects(() => openLine('PER_NAIL', 0), /visit_service_lines_max_quantity/);
              const waiting = await openLine('PER_NAIL', 10);
              assert.equal(waiting.maxQuantitySnapshot, 10);
              const carried = await bookingLine(10, 'PER_NAIL', 1);
              assert.equal(carried.maxQuantitySnapshot, 10);
              await rejects(
                () =>
                  tx.bookingServiceLine.update({
                    where: { id: carried.id },
                    data: { maxQuantitySnapshot: 12, rowVersion: { increment: 1 } },
                  }),
                /snapshot, order and version cannot be rewritten/,
              );
              await settle();
            },
          );

          // ================================================== service category snapshot (Step 6 follow-up)

          await context.test(
            'the service category is snapshotted once, copied downstream and immutable (historical discount scope)',
            async () => {
              const categoryNow = async () =>
                (await tx.service.findUniqueOrThrow({ where: { id: nail.id } })).categoryId;
              const original = await categoryNow();
              const elsewhere = await tx.serviceCategory.create({
                data: { code: `SC_${run}_A`, nameVi: 'Nhóm khác', nameEn: 'Other group' },
                select: { id: true },
              });
              const moveTo = (categoryId: string) =>
                tx.service.update({
                  where: { id: nail.id },
                  data: { categoryId, rowVersion: { increment: 1 } },
                });

              // Booking line: an unset category is filled from the service AT CREATION.
              const ktvBooking = await user('EMPLOYEE');
              const booking = await tx.booking.create({
                data: {
                  code: `BK-P4-${run}-CAT`,
                  branchId: branch,
                  ownerUserId: customer,
                  channel: 'ONLINE',
                  startsAt: new Date('2027-03-01T09:00:00+07:00'),
                  endsAt: new Date('2027-03-01T09:10:00+07:00'),
                  serviceDate: DAY,
                  idempotencyKey: randomUUID(),
                  createdByUserId: customer,
                },
                select: { id: true },
              });
              const recipient = await tx.bookingRecipient.create({
                data: { bookingId: booking.id, relation: 'SELF' },
                select: { id: true },
              });
              const bookingLine = await tx.bookingServiceLine.create({
                data: {
                  bookingId: booking.id,
                  recipientId: recipient.id,
                  sequence: 1,
                  serviceId: nail.id,
                  employeeUserId: ktvBooking,
                  assignmentMode: 'ANY',
                  plannedStartAt: new Date('2027-03-01T09:00:00+07:00'),
                  plannedEndAt: new Date('2027-03-01T09:10:00+07:00'),
                  durationMinutes: 10,
                  bufferMinutes: 0,
                  ...snapshotOf(nail),
                },
                select: { id: true, serviceCategoryId: true },
              });
              assert.equal(bookingLine.serviceCategoryId, original);
              // Moving the live service afterwards never rewrites the snapshot, and the snapshot cannot be changed.
              await moveTo(elsewhere.id);
              assert.equal(
                (await tx.bookingServiceLine.findUniqueOrThrow({ where: { id: bookingLine.id } }))
                  .serviceCategoryId,
                original,
                'a later category move never alters the booking line',
              );
              await rejects(
                () =>
                  tx.bookingServiceLine.update({
                    where: { id: bookingLine.id },
                    data: { serviceCategoryId: elsewhere.id, rowVersion: { increment: 1 } },
                  }),
                /snapshot, order and version cannot be rewritten/,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE booking_service_lines SET service_category_id = NULL WHERE id = '${bookingLine.id}'`,
                  ),
                /snapshot, order and version cannot be rewritten/,
              );

              // Visit line (walk-in / staff-added shape): filled from the service at that moment.
              const openVisit = await tx.visit.create({
                data: {
                  code: `VS-P4-${run}-CAT`,
                  branchId: branch,
                  origin: 'WALK_IN',
                  serviceDate: DAY,
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: staff,
                  idempotencyKey: randomUUID(),
                },
                select: { id: true },
              });
              const participant = await tx.visitParticipant.create({
                data: { visitId: openVisit.id, kind: 'GUEST', displayName: 'Khách' },
                select: { id: true },
              });
              const visitLine = await tx.visitServiceLine.create({
                data: {
                  visitId: openVisit.id,
                  participantId: participant.id,
                  sequence: 1,
                  serviceId: nail.id,
                  status: 'WAITING',
                  assignmentMode: 'ANY',
                  durationMinutes: 10,
                  ...snapshotOf(nail),
                },
                select: { id: true, serviceCategoryId: true },
              });
              assert.equal(
                visitLine.serviceCategoryId,
                elsewhere.id,
                'the category at THIS moment',
              );
              await moveTo(original);
              assert.equal(
                (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: visitLine.id } }))
                  .serviceCategoryId,
                elsewhere.id,
                'a later category move never alters the visit line',
              );
              await rejects(
                () =>
                  tx.visitServiceLine.update({
                    where: { id: visitLine.id },
                    data: { serviceCategoryId: original, rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );

              // A carried visit line copies its booking line's snapshot exactly (never the live catalog).
              const arrived = await tx.visit.create({
                data: {
                  code: `VS-P4-${run}-CAT2`,
                  branchId: branch,
                  bookingId: booking.id,
                  ownerUserId: customer,
                  origin: 'BOOKING',
                  serviceDate: DAY,
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: staff,
                  idempotencyKey: randomUUID(),
                },
                select: { id: true },
              });
              const arrivedParticipant = await tx.visitParticipant.create({
                data: { visitId: arrived.id, kind: 'GUEST', displayName: 'Khách' },
                select: { id: true },
              });
              const carry = (
                overrides: Partial<Prisma.VisitServiceLineUncheckedCreateInput> = {},
              ) =>
                tx.visitServiceLine.create({
                  data: {
                    visitId: arrived.id,
                    participantId: arrivedParticipant.id,
                    sequence: 1,
                    bookingServiceLineId: bookingLine.id,
                    serviceId: nail.id,
                    status: 'PLANNED',
                    assignmentMode: 'ANY',
                    employeeUserId: ktvBooking,
                    plannedStartAt: new Date('2027-03-01T09:00:00+07:00'),
                    plannedEndAt: new Date('2027-03-01T09:10:00+07:00'),
                    bufferMinutes: 0,
                    durationMinutes: 10,
                    ...snapshotOf(nail),
                    ...overrides,
                  },
                  select: { id: true, serviceCategoryId: true },
                });
              await rejects(
                () => carry({ serviceCategoryId: elsewhere.id }),
                /copies the historical category of its booking line/,
              );
              const carried = await carry();
              assert.equal(
                carried.serviceCategoryId,
                original,
                'the booking line snapshot, not the live catalog',
              );
              assert.notEqual(await categoryNow(), elsewhere.id);

              // Invoice detail: copies the visit line snapshot; a different category is refused.
              const visit = await completedVisit([nail]);
              const doneLine = await tx.visitServiceLine.findUniqueOrThrow({
                where: { id: visit.done[0]!.id },
                select: { serviceCategoryId: true },
              });
              assert.equal(doneLine.serviceCategoryId, original);
              await moveTo(elsewhere.id);
              const invoice = await draft(visit);
              const detail = await tx.invoiceLineService.findFirstOrThrow({
                where: { invoiceId: invoice.id },
              });
              assert.equal(
                detail.serviceCategoryId,
                original,
                'copied from the visit line, not from the live service (now elsewhere)',
              );
              await rejects(
                () =>
                  tx.invoiceLineService.update({
                    where: { invoiceLineId: detail.invoiceLineId },
                    data: { serviceCategoryId: elsewhere.id },
                  }),
                /recorded once/,
              );
              await rejects(async () => {
                const spare = await tx.invoiceLine.create({
                  data: {
                    invoiceId: invoice.id,
                    sequence: 9,
                    itemCode: nail.code,
                    nameVi: nail.nameVi,
                    nameEn: nail.nameEn,
                  },
                  select: { id: true },
                });
                await tx.invoiceLineService.create({
                  data: {
                    invoiceLineId: spare.id,
                    invoiceId: invoice.id,
                    visitServiceLineId: visit.done[0]!.id,
                    serviceId: nail.id,
                    participantId: visit.participantId,
                    employeeUserId: ktv,
                    pricingUnit: nail.pricingUnit,
                    catalogPriceMinVnd: nail.priceVnd,
                    catalogPriceMaxVnd: nail.priceMaxVnd,
                    quantityLimit: nail.maxQuantity,
                    addedOnBehalf: false,
                    serviceCategoryId: elsewhere.id,
                  },
                });
              }, /copy the visit line snapshot/);
              await moveTo(original);
              await settle();
            },
          );

          // ================================================================ invoice header

          await context.test(
            'invoice creation: completed visit only, branch of the visit, internal code, one active invoice per visit',
            async () => {
              const open = await tx.visit.create({
                data: {
                  code: `VS-P4-${run}-OPEN`,
                  branchId: branch,
                  origin: 'WALK_IN',
                  serviceDate: DAY,
                  arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
                  createdByUserId: staff,
                  idempotencyKey: randomUUID(),
                },
                select: { id: true },
              });
              const header = (overrides: Partial<Prisma.InvoiceUncheckedCreateInput> = {}) =>
                tx.invoice.create({
                  data: {
                    code: generateInvoiceCode(todayText),
                    branchId: branch,
                    visitId: open.id,
                    businessDate: today,
                    calculationVersion: 1,
                    createdByUserId: staff,
                    ...overrides,
                  },
                  select: { id: true },
                });
              await rejects(() => header(), /created only for a completed visit/);
              const visit = await completedVisit([ranged]);
              await rejects(
                () => header({ visitId: visit.id, branchId: otherBranch }),
                /branch of its visit/,
              );
              await rejects(
                () =>
                  header({ visitId: visit.id, businessDate: new Date('2027-03-02T00:00:00.000Z') }),
                /branch-local date of its creation/,
              );
              await rejects(
                () => header({ visitId: visit.id, status: 'PENDING_PAYMENT' }),
                /starts as a DRAFT at version 1/,
              );
              await rejects(
                () => header({ visitId: visit.id, rowVersion: 2 }),
                /starts as a DRAFT at version 1/,
              );
              await rejects(
                () => header({ visitId: visit.id, paidSeq: 1 }),
                /starts as a DRAFT at version 1/,
              );
              await rejects(
                () => header({ visitId: visit.id, payerUserId: staff }),
                /payer is a customer account/,
              );
              // Code format: INV-YYMMDD-XXXXXX, the date being the business date, no 0/1/I/O.
              for (const bad of [
                'INV-270301-0BCDEF',
                'INV-270301-ABCDE1',
                'INV-270301-ABCDEI',
                'INV-270301-ABCDEO',
                'INV-270301-abcdef',
                'INV-270301-ABCDE',
                'INV-270301-ABCDEFG',
                'BK-270301-ABCDEF',
                'INV-270302-ABCDEF', // not the business date (2027-03-01 is not today)
                'INV-2703-ABCDEF',
                '',
              ]) {
                await rejects(
                  () => header({ visitId: visit.id, code: bad }),
                  /invoices_code_format|starts as|business date/,
                );
              }
              // The code must carry today's business date, whatever the suffix.
              const wrongDay = new Date(today.getTime() + 86_400_000).toISOString().slice(2, 10);
              await rejects(
                () =>
                  header({
                    visitId: visit.id,
                    code: `INV-${wrongDay.replaceAll('-', '')}-ABCDEF`,
                  }),
                /invoices_code_format/,
              );
              const first = await draft(visit, { payer: customer });
              assert.equal(
                (await tx.invoice.findUniqueOrThrow({ where: { id: first.id } })).status,
                'DRAFT',
              );
              // ONE Visit -> ONE active invoice.
              await rejects(() => header({ visitId: visit.id }), /invoices_visit_active_key/);
              // The invoice code is unique.
              const other = await completedVisit([ranged]);
              const usedCode = first.code;
              await rejects(
                () => header({ visitId: other.id, code: usedCode }),
                /invoices_code_key|Unique constraint/,
              );
              // A guest payer (NULL) and a member payer are both fine.
              const guestInvoice = await draft(other, { payer: null });
              assert.equal(
                (await tx.invoice.findUniqueOrThrow({ where: { id: guestInvoice.id } }))
                  .payerUserId,
                null,
              );
              // Money constraints are integer VND, never negative, and total = subtotal - discount.
              const moneyVisit = await completedVisit([ranged]);
              for (const bad of [
                { subtotalVnd: -1n, totalVnd: -1n },
                { subtotalVnd: 100n, discountTotalVnd: -1n, totalVnd: 101n },
                { subtotalVnd: 100n, discountTotalVnd: 200n, totalVnd: -100n },
                { subtotalVnd: 100n, discountTotalVnd: 0n, totalVnd: 99n },
                { subtotalVnd: 100n, discountTotalVnd: 0n, totalVnd: 101n },
                { subtotalVnd: 100n, discountTotalVnd: 40n, totalVnd: 100n },
              ]) {
                await rejects(() => header({ visitId: moneyVisit.id, ...bad }), /invoices_money/);
              }
              await rejects(
                () => header({ visitId: moneyVisit.id, calculationVersion: 0 }),
                /invoices_calculation_version/,
              );
              // Large VND values stay exact integers (BIGINT), no floating point.
              const huge = 9_007_199_254_740_993n; // beyond Number.MAX_SAFE_INTEGER
              const big = await draft(moneyVisit);
              await tx.invoice.update({
                where: { id: big.id },
                data: { subtotalVnd: huge, totalVnd: huge, rowVersion: { increment: 1 } },
              });
              assert.equal(
                (await tx.invoice.findUniqueOrThrow({ where: { id: big.id } })).totalVnd,
                huge,
              );
              // Existing completed visits are never given invoices by the migration: only these exist.
              assert.equal(
                await tx.invoice.count({
                  where: { visitId: { in: [visit.id, other.id, moneyVisit.id] } },
                }),
                3,
              );
              await settle();
            },
          );

          await context.test(
            'invoice lines: exact snapshot copy of DONE visit lines, price inside the range, quantity within the limit',
            async () => {
              const visit = await completedVisit([ranged, exact, nail, free], { cancelled: 1 });
              const invoice = await draft(visit);
              // Unpriced lines are allowed while DRAFT; the whole invoice is complete.
              await settle();
              const [rangedLine, exactLine, nailLine, freeLine] = invoice.lines as [
                InvoiceFixture['lines'][number],
                InvoiceFixture['lines'][number],
                InvoiceFixture['lines'][number],
                InvoiceFixture['lines'][number],
              ];
              // Price inside [min, max]; exact quantity rules through the snapshotted limit.
              await priceLine(rangedLine.id, 1, 100_000n);
              await priceLine(rangedLine.id, 1, 150_000n);
              await priceLine(exactLine.id, 1, 200_000n);
              await priceLine(nailLine.id, 10, 5_000n);
              await priceLine(nailLine.id, 1, 10_000n);
              await priceLine(freeLine.id, 1, 0n);
              await settle();
              const outside = async (lineId: string, quantity: number, price: bigint) =>
                rejects(async () => {
                  await priceLine(lineId, quantity, price);
                  await settle();
                }, /snapshotted range and its quantity within the snapshotted limit/);
              await outside(rangedLine.id, 1, 99_999n);
              await outside(rangedLine.id, 1, 150_001n);
              await outside(exactLine.id, 1, 199_999n);
              await outside(exactLine.id, 2, 200_000n); // PER_SERVICE quantity is exactly 1
              await outside(nailLine.id, 11, 5_000n); // above the snapshotted limit of 10
              await outside(nailLine.id, 1, 4_999n);
              await outside(nailLine.id, 1, 10_001n);
              // Arithmetic and sign are CHECKed: positive integer quantity, price >= 0, gross = qty x price.
              await rejects(
                () => priceLine(nailLine.id, 0, 5_000n),
                /invoice_lines_quantity_positive|invoice_lines_gross/,
              );
              await rejects(
                () => priceLine(nailLine.id, -1, 5_000n),
                /invoice_lines_quantity_positive|invoice_lines_gross/,
              );
              await rejects(
                () => priceLine(nailLine.id, 1, -1n),
                /invoice_lines_price_nonnegative|invoice_lines_gross/,
              );
              await rejects(
                () =>
                  tx.invoiceLine.update({
                    where: { id: nailLine.id },
                    data: { grossVnd: 1n, rowVersion: { increment: 1 } },
                  }),
                /invoice_lines_gross/,
              );
              await rejects(
                () =>
                  tx.invoiceLine.update({
                    where: { id: nailLine.id },
                    data: { quantity: null, rowVersion: { increment: 1 } },
                  }),
                /invoice_lines_gross/,
              );
              // A priced line always has its exact gross: NULL never satisfies the rule.
              await rejects(
                () =>
                  tx.invoiceLine.update({
                    where: { id: nailLine.id },
                    data: {
                      quantity: 2,
                      unitPriceVnd: 5_000n,
                      grossVnd: null,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /invoice_lines_gross/,
              );
              await rejects(
                () =>
                  tx.invoiceLine.update({
                    where: { id: nailLine.id },
                    data: { priceSetByUserId: null, rowVersion: { increment: 1 } },
                  }),
                /invoice_lines_price_facts/,
              );
              // Identity and snapshot of a line are immutable; every change bumps the version.
              await rejects(
                () =>
                  tx.invoiceLine.update({
                    where: { id: nailLine.id },
                    data: { nameVi: 'Đổi tên', rowVersion: { increment: 1 } },
                  }),
                /identity and snapshot cannot be rewritten/,
              );
              await rejects(
                () => tx.invoiceLine.update({ where: { id: nailLine.id }, data: { sequence: 9 } }),
                /identity and snapshot cannot be rewritten|bump the version/,
              );
              await rejects(
                () =>
                  tx.invoiceLine.update({
                    where: { id: nailLine.id },
                    data: { quantity: 2, unitPriceVnd: 5_000n, grossVnd: 10_000n },
                  }),
                /bump the version by one/,
              );
              // The detail is an exact copy of the visit-line snapshot and of a DONE line of the same visit.
              // Everything below leaves spare lines without a detail; the whole block ends in the
              // completeness refusal at commit, which also undoes those spare lines.
              await rejects(async () => {
                const cancelledId = visit.cancelled[0]!.id;
                const spare = await tx.invoiceLine.create({
                  data: {
                    invoiceId: invoice.id,
                    sequence: 9,
                    itemCode: exact.code,
                    nameVi: exact.nameVi,
                    nameEn: exact.nameEn,
                  },
                  select: { id: true },
                });
                const detailFor = (
                  visitServiceLineId: string,
                  overrides: Partial<Prisma.InvoiceLineServiceUncheckedCreateInput> = {},
                ) =>
                  tx.invoiceLineService.create({
                    data: {
                      invoiceLineId: spare.id,
                      invoiceId: invoice.id,
                      visitServiceLineId,
                      serviceId: exact.id,
                      participantId: visit.participantId,
                      employeeUserId: ktv,
                      pricingUnit: 'PER_SERVICE',
                      catalogPriceMinVnd: 200_000n,
                      catalogPriceMaxVnd: 200_000n,
                      quantityLimit: 1,
                      addedOnBehalf: false,
                      ...overrides,
                    },
                  });
                await rejects(() => detailFor(cancelledId), /performed service of its own visit/);
                const foreign = await completedVisit([exact]);
                await rejects(
                  () => detailFor(foreign.done[0]!.id),
                  /performed service of its own visit/,
                );
                await rejects(
                  () => detailFor(exactLine.visitLineId, { quantityLimit: 5 }),
                  /invoice_line_services_quantity_limit|copy the visit line snapshot/,
                );
                await rejects(
                  () => detailFor(exactLine.visitLineId, { catalogPriceMaxVnd: 300_000n }),
                  /copy the visit line snapshot/,
                );
                await rejects(
                  () => detailFor(exactLine.visitLineId, { serviceId: ranged.id }),
                  /copy the visit line snapshot/,
                );
                await rejects(
                  () => detailFor(exactLine.visitLineId, { addedOnBehalf: true }),
                  /copy the visit line snapshot/,
                );
                await rejects(
                  () => detailFor(exactLine.visitLineId, { employeeUserId: staff }),
                  /copy the visit line snapshot/,
                );
                // The same performance appears at most once per invoice.
                await rejects(
                  () => detailFor(exactLine.visitLineId),
                  /invoice_line_services_invoice_visit_line_key|copy the visit line snapshot|Unique constraint/,
                );
                // A price range must be ordered and non-negative.
                await rejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE invoice_line_services SET quantity_limit = 0 WHERE invoice_line_id = '${exactLine.id}'`,
                    ),
                  /recorded once/,
                );
                // The PER_SERVICE limit of an invoice detail is 1 (CHECK), like the catalog.
                await rejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO invoice_line_services (invoice_line_id, invoice_id, visit_service_line_id, service_id,
                       participant_id, employee_user_id, pricing_unit, catalog_price_min_vnd, catalog_price_max_vnd,
                       quantity_limit, added_on_behalf)
                     VALUES ('${spare.id}', '${invoice.id}', '${exactLine.visitLineId}', '${exact.id}',
                       '${visit.participantId}', '${ktv}', 'PER_SERVICE', 1, 2, 3, false)`,
                    ),
                  /invoice_line_services_quantity_limit|copy the visit line snapshot/,
                );
                await rejects(
                  () =>
                    tx.invoiceLineService.update({
                      where: { invoiceLineId: exactLine.id },
                      data: { quantityLimit: 3 },
                    }),
                  /recorded once/,
                );
                // Line names must equal the visit-line snapshot names.
                const mismatch = await tx.invoiceLine.create({
                  data: {
                    invoiceId: invoice.id,
                    sequence: 10,
                    itemCode: 'OTHER',
                    nameVi: 'Khác',
                    nameEn: 'Other',
                  },
                  select: { id: true },
                });
                await rejects(
                  () =>
                    tx.invoiceLineService.create({
                      data: {
                        invoiceLineId: mismatch.id,
                        invoiceId: invoice.id,
                        visitServiceLineId: freeLine.visitLineId,
                        serviceId: free.id,
                        participantId: visit.participantId,
                        employeeUserId: ktv,
                        pricingUnit: 'PER_SERVICE',
                        catalogPriceMinVnd: 0n,
                        catalogPriceMaxVnd: 50_000n,
                        quantityLimit: 1,
                        addedOnBehalf: false,
                      },
                    }),
                  /copy the visit line snapshot/,
                );
                // The two spare lines carry no detail: completeness refuses the invoice at commit.
                await settle();
              }, /every performed service of its visit exactly once/);
              await settle();
            },
          );

          await context.test(
            'invoice completeness: every DONE service exactly once, cancelled lines never',
            async () => {
              const visit = await completedVisit([ranged, exact], { cancelled: 1 });
              // Missing the second performance: refused at commit.
              const invoice = await tx.invoice.create({
                data: {
                  code: generateInvoiceCode(todayText),
                  branchId: branch,
                  visitId: visit.id,
                  businessDate: today,
                  calculationVersion: 1,
                  createdByUserId: staff,
                },
                select: { id: true },
              });
              const first = await tx.invoiceLine.create({
                data: {
                  invoiceId: invoice.id,
                  sequence: 1,
                  itemCode: ranged.code,
                  nameVi: ranged.nameVi,
                  nameEn: ranged.nameEn,
                },
                select: { id: true },
              });
              await tx.invoiceLineService.create({
                data: {
                  invoiceLineId: first.id,
                  invoiceId: invoice.id,
                  visitServiceLineId: visit.done[0]!.id,
                  serviceId: ranged.id,
                  participantId: visit.participantId,
                  employeeUserId: ktv,
                  pricingUnit: 'PER_SERVICE',
                  catalogPriceMinVnd: 100_000n,
                  catalogPriceMaxVnd: 150_000n,
                  quantityLimit: 1,
                  addedOnBehalf: false,
                },
              });
              await rejects(() => settle(), /every performed service of its visit exactly once/);
              // A line without a detail is refused as well.
              const dangling = await tx.invoiceLine.create({
                data: {
                  invoiceId: invoice.id,
                  sequence: 2,
                  itemCode: exact.code,
                  nameVi: exact.nameVi,
                  nameEn: exact.nameEn,
                },
                select: { id: true },
              });
              await rejects(() => settle(), /every performed service of its visit exactly once/);
              await tx.invoiceLineService.create({
                data: {
                  invoiceLineId: dangling.id,
                  invoiceId: invoice.id,
                  visitServiceLineId: visit.done[1]!.id,
                  serviceId: exact.id,
                  participantId: visit.participantId,
                  employeeUserId: ktv,
                  pricingUnit: 'PER_SERVICE',
                  catalogPriceMinVnd: 200_000n,
                  catalogPriceMaxVnd: 200_000n,
                  quantityLimit: 1,
                  addedOnBehalf: false,
                },
              });
              await settle();
            },
          );

          // =============================================================== lifecycle

          await context.test(
            'lifecycle: finalization rules, frozen invoice, legal and illegal transitions, versioning',
            async () => {
              const visit = await completedVisit([ranged, nail]);
              const invoice = await draft(visit, { payer: customer });
              const [rangedLine, nailLine] = invoice.lines as [
                InvoiceFixture['lines'][number],
                InvoiceFixture['lines'][number],
              ];
              const change = (data: Prisma.InvoiceUncheckedUpdateInput) =>
                tx.invoice.update({
                  where: { id: invoice.id },
                  data: { ...data, rowVersion: { increment: 1 } },
                });
              // Identity is immutable.
              await rejects(
                () => change({ code: generateInvoiceCode(todayText) }),
                /identity cannot be rewritten/,
              );
              await rejects(
                () => change({ visitId: randomUUID() }),
                /identity cannot be rewritten|Foreign key|invoices_visit_id_fkey/,
              );
              await rejects(
                () => change({ branchId: otherBranch }),
                /identity cannot be rewritten/,
              );
              await rejects(
                () => change({ businessDate: new Date('2027-03-01T00:00:00.000Z') }),
                /identity cannot be rewritten/,
              );
              // Every change bumps the version by exactly one.
              await rejects(
                () => tx.invoice.update({ where: { id: invoice.id }, data: { payerUserId: null } }),
                /bump the version by one/,
              );
              // The payer is editable while DRAFT (member, guest, another member) and is a customer.
              await change({ payerUserId: null });
              await change({ payerUserId: customer2 });
              await rejects(() => change({ payerUserId: ktv }), /payer is a customer account/);
              // DRAFT amounts are recomputed and may be edited while pricing.
              await change({ subtotalVnd: 5n, totalVnd: 5n });
              await change({ subtotalVnd: 0n, totalVnd: 0n });
              // Finalizing with an unpriced line is refused.
              await rejects(
                () =>
                  change({
                    status: 'PENDING_PAYMENT',
                    subtotalVnd: 100_000n,
                    totalVnd: 100_000n,
                    finalizedAt: new Date(),
                    finalizedByUserId: staff,
                  }),
                /every line priced with a quantity/,
              );
              await priceLine(rangedLine.id, 1, 120_000n);
              await rejects(
                () =>
                  change({
                    status: 'PENDING_PAYMENT',
                    subtotalVnd: 120_000n,
                    totalVnd: 120_000n,
                    finalizedAt: new Date(),
                    finalizedByUserId: staff,
                  }),
                /every line priced with a quantity/,
              );
              await priceLine(nailLine.id, 4, 7_000n);
              // The subtotal must be the exact sum of the lines (120,000 + 4 x 7,000 = 148,000).
              await rejects(
                () =>
                  change({
                    status: 'PENDING_PAYMENT',
                    subtotalVnd: 147_999n,
                    totalVnd: 147_999n,
                    finalizedAt: new Date(),
                    finalizedByUserId: staff,
                  }),
                /subtotal must be the sum of its lines/,
              );
              // Not settled directly unless the receivable is exactly 0; PAID needs paid_at = finalized_at.
              const finalizedAt = await dbNow();
              await rejects(
                () =>
                  change({
                    status: 'PAID',
                    subtotalVnd: 148_000n,
                    totalVnd: 148_000n,
                    finalizedAt,
                    finalizedByUserId: staff,
                    paidAt: finalizedAt,
                    paidSeq: 1,
                  }),
                /Only a zero-balance invoice is settled directly/,
              );
              // Finalization facts must be complete (CHECK status facts).
              await rejects(
                () =>
                  change({
                    status: 'PENDING_PAYMENT',
                    subtotalVnd: 148_000n,
                    totalVnd: 148_000n,
                    finalizedAt,
                  }),
                /invoices_status_facts/,
              );
              await finalize(invoice.id);
              await settle();
              const finalized = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(finalized.status, 'PENDING_PAYMENT');
              assert.equal(finalized.subtotalVnd, 148_000n);
              assert.equal(finalized.totalVnd, 148_000n);
              assert.equal(finalized.paidSeq, 0);
              assert.equal(finalized.paidAt, null);
              // FROZEN: payer, amounts, calculation version, finalization facts and every line.
              for (const data of [
                { payerUserId: customer },
                { payerUserId: null },
                { calculationVersion: 2 },
                { subtotalVnd: 100_000n, totalVnd: 100_000n },
                { finalizedAt: new Date() },
                { finalizedByUserId: ktv },
              ] as Prisma.InvoiceUncheckedUpdateInput[]) {
                await rejects(
                  () => change(data),
                  /keeps its payer, amounts and finalization facts/,
                );
              }
              await rejects(
                () => priceLine(rangedLine.id, 1, 130_000n),
                /created and priced only while the invoice is a draft/,
              );
              await rejects(
                () =>
                  tx.invoiceLine.create({
                    data: {
                      invoiceId: invoice.id,
                      sequence: 20,
                      itemCode: exact.code,
                      nameVi: exact.nameVi,
                      nameEn: exact.nameEn,
                    },
                  }),
                /created and priced only while the invoice is a draft/,
              );
              // Illegal transitions: nothing returns to DRAFT; only PENDING/PAID/CANCELLED follow their rules.
              await rejects(
                () => change({ status: 'DRAFT', finalizedAt: null, finalizedByUserId: null }),
                /Illegal invoice status transition/,
              );
              // Cancel needs a reason, the actor, the status it left and a cancellation time.
              const cancelStamp = await dbNow();
              await rejects(
                () =>
                  change({
                    status: 'CANCELLED',
                    cancelledAt: cancelStamp,
                    cancelledByUserId: staff,
                    cancelledFromStatus: 'PENDING_PAYMENT',
                  }),
                /invoices_status_facts/,
              );
              await rejects(
                () =>
                  change({
                    status: 'CANCELLED',
                    cancelledAt: cancelStamp,
                    cancelledByUserId: staff,
                    cancelledFromStatus: 'DRAFT',
                    cancelReason: 'Nhầm',
                  }),
                /records the status it left|invoices_status_facts/,
              );
              await rejects(
                () =>
                  change({
                    status: 'CANCELLED',
                    cancelledAt: cancelStamp,
                    cancelledByUserId: staff,
                    cancelledFromStatus: 'PENDING_PAYMENT',
                    cancelReason: '   ',
                  }),
                /invoices_cancel_reason_nonblank|invoices_status_facts/,
              );
              await change({
                status: 'CANCELLED',
                cancelledAt: await dbNow(),
                cancelledByUserId: staff,
                cancelledFromStatus: 'PENDING_PAYMENT',
                cancelReason: 'Khách không thanh toán',
              });
              await settle();
              // CANCELLED is terminal and preserved.
              await rejects(
                () => change({ cancelReason: 'Sửa lý do' }),
                /cancelled invoice is final/,
              );
              await rejects(
                () => change({ status: 'PENDING_PAYMENT' }),
                /cancelled invoice is final/,
              );
              await rejects(
                () => tx.invoice.delete({ where: { id: invoice.id } }),
                /Financial records are never deleted/,
              );
              // A new invoice may be created for the visit after a cancellation; history stays.
              const reissued = await draft(visit, {
                payer: customer,
                priced: [
                  [1, 100_000n],
                  [2, 5_000n],
                ],
              });
              await finalize(reissued.id);
              await settle();
              assert.equal(
                await tx.invoice.count({ where: { visitId: visit.id } }),
                2,
                'cancelled history is preserved next to the new active invoice',
              );
              // ...but still only one non-cancelled invoice per visit.
              await rejects(() => draft(visit), /invoices_visit_active_key/);
              // A draft cancelled before finalization keeps no finalization facts.
              const visit2 = await completedVisit([exact]);
              const cancelledDraft = await draft(visit2);
              await tx.invoice.update({
                where: { id: cancelledDraft.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: await dbNow(),
                  cancelledByUserId: staff,
                  cancelledFromStatus: 'DRAFT',
                  cancelReason: 'Lập nhầm',
                  rowVersion: { increment: 1 },
                },
              });
              await settle();
              assert.equal(await version(cancelledDraft.id), 2);
            },
          );

          // ============================================================ zero balance

          await context.test(
            'zero balance (OP-2): PAID directly with no payment row; only a zero-balance PAID invoice is cancellable (OP-7)',
            async () => {
              const visit = await completedVisit([free]);
              const invoice = await draft(visit, { payer: customer, priced: [[1, 0n]] });
              // A receivable of exactly 0 can never be PENDING_PAYMENT.
              const at = await dbNow();
              await rejects(
                () =>
                  tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                      status: 'PENDING_PAYMENT',
                      finalizedAt: at,
                      finalizedByUserId: staff,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /invoices_status_facts/,
              );
              // ...and PAID needs paid_at = finalized_at and paid_seq = 1.
              await rejects(
                () =>
                  tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                      status: 'PAID',
                      finalizedAt: at,
                      finalizedByUserId: staff,
                      paidAt: new Date(at.getTime() + 1_000),
                      paidSeq: 1,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /Only a zero-balance invoice is settled directly/,
              );
              await rejects(
                () =>
                  tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                      status: 'PAID',
                      finalizedAt: at,
                      finalizedByUserId: staff,
                      paidAt: at,
                      paidSeq: 2,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /paid episode counter/,
              );
              await finalize(invoice.id);
              await settle(); // PAID with total 0 and NO payment row reconciles.
              const zero = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(zero.status, 'PAID');
              assert.equal(zero.totalVnd, 0n);
              assert.equal(zero.paidSeq, 1);
              assert.deepEqual(zero.paidAt, zero.finalizedAt);
              assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 0);
              // Its lines, subtotal and payer are kept exactly like any other invoice.
              assert.equal(await tx.invoiceLine.count({ where: { invoiceId: invoice.id } }), 1);
              // No payment can ever be recorded against it: no zero-VND payment, no positive payment.
              await rejects(() => pay(invoice.id, 1n, 0n), /awaiting payment/);
              await rejects(() => pay(invoice.id, 0n, 0n), /payments_amounts|awaiting payment/);
              // A zero-balance invoice cannot be 'reopened' (no payment to reverse).
              await rejects(
                () =>
                  tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                      status: 'PENDING_PAYMENT',
                      paidAt: null,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /invoices_status_facts/,
              );
              // OP-7: PAID -> CANCELLED for a zero-balance invoice with no payment row.
              const cancelledAt = await dbNow();
              await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt,
                  cancelledByUserId: staff,
                  cancelledFromStatus: 'PAID',
                  cancelReason: 'Áp nhầm ưu đãi',
                  rowVersion: { increment: 1 },
                },
              });
              await settle();
              const voided = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(voided.cancelledFromStatus, 'PAID');
              assert.equal(voided.paidSeq, 1, 'the voided paid episode is kept as history');
              assert.deepEqual(voided.paidAt, zero.paidAt);
              assert.equal(voided.totalVnd, 0n);
              // The visit may be invoiced again afterwards.
              const again = await draft(visit, { priced: [[1, 10_000n]] });
              await finalize(again.id);
              await settle();
              // A cancelled-from-PAID record must be a zero-balance settlement (CHECK).
              const nonZero = await unpaid();
              await rejects(
                () =>
                  tx.invoice.update({
                    where: { id: nonZero.invoice.id },
                    data: {
                      status: 'CANCELLED',
                      cancelledAt: new Date(),
                      cancelledByUserId: staff,
                      cancelledFromStatus: 'PAID',
                      cancelReason: 'x',
                      rowVersion: { increment: 1 },
                    },
                  }),
                /records the status it left|invoices_status_facts/,
              );
            },
          );

          // ============================================================== payments

          await context.test(
            'cash payments: against a finalized unpaid invoice, exact balance, server clock, split, idempotent, append-only',
            async () => {
              const { invoice } = await unpaid(200_000n, customer);
              // Only a finalized invoice awaiting payment accepts a payment.
              const draftVisit = await completedVisit([exact]);
              const draftInvoice = await draft(draftVisit, { priced: [[1, 200_000n]] });
              await rejects(() => pay(draftInvoice.id, 200_000n, 200_000n), /awaiting payment/);
              // Shape: positive credited amount, amount <= due, tendered >= amount, change derived.
              await rejects(() => pay(invoice.id, 0n, 200_000n), /payments_amounts/);
              await rejects(() => pay(invoice.id, -5n, 200_000n), /payments_amounts/);
              await rejects(() => pay(invoice.id, 200_001n, 200_000n), /payments_amounts|balance/);
              await rejects(() => pay(invoice.id, 100_000n, 200_001n), /balance/);
              await rejects(() => pay(invoice.id, 100_000n, 150_000n), /balance/);
              await rejects(
                () =>
                  tx.payment.create({
                    data: {
                      invoiceId: invoice.id,
                      branchId: branch,
                      method: 'CASH',
                      status: 'SUCCEEDED',
                      amountDueVnd: 200_000n,
                      amountVnd: 100_000n,
                      tenderedVnd: 90_000n,
                      changeVnd: 0n,
                      collectedByUserId: staff,
                      idempotencyKey: randomUUID(),
                    },
                  }),
                /payments_amounts/,
              );
              await rejects(
                () =>
                  tx.payment.create({
                    data: {
                      invoiceId: invoice.id,
                      branchId: branch,
                      method: 'CASH',
                      status: 'SUCCEEDED',
                      amountDueVnd: 200_000n,
                      amountVnd: 100_000n,
                      tenderedVnd: 120_000n,
                      changeVnd: 5n, // change must be exactly tendered - credited
                      collectedByUserId: staff,
                      idempotencyKey: randomUUID(),
                    },
                  }),
                /payments_amounts/,
              );
              await rejects(
                () =>
                  tx.payment.create({
                    data: {
                      invoiceId: invoice.id,
                      branchId: otherBranch,
                      method: 'CASH',
                      status: 'SUCCEEDED',
                      amountDueVnd: 200_000n,
                      amountVnd: 100_000n,
                      tenderedVnd: 100_000n,
                      changeVnd: 0n,
                      collectedByUserId: staff,
                      idempotencyKey: randomUUID(),
                    },
                  }),
                /branch of its invoice/,
              );
              await rejects(
                () =>
                  tx.payment.create({
                    data: {
                      invoiceId: invoice.id,
                      branchId: branch,
                      method: 'CASH',
                      status: 'PENDING',
                      amountDueVnd: 200_000n,
                      amountVnd: 100_000n,
                      tenderedVnd: 100_000n,
                      changeVnd: 0n,
                      collectedByUserId: staff,
                      idempotencyKey: randomUUID(),
                    },
                  }),
                /payments_cash_succeeded/,
              );
              // First split payment: 60,000 credited, 100,000 tendered (change 40,000). Server clock is used
              // even when the client sends a past time (no backdating).
              const key = randomUUID();
              const before = await dbNow();
              const first = await tx.payment.create({
                data: {
                  invoiceId: invoice.id,
                  branchId: branch,
                  method: 'CASH',
                  status: 'SUCCEEDED',
                  amountDueVnd: 200_000n,
                  amountVnd: 60_000n,
                  tenderedVnd: 100_000n,
                  changeVnd: 40_000n,
                  collectedByUserId: staff,
                  collectedAt: new Date('2020-01-01T00:00:00Z'),
                  businessDate: new Date('2020-01-01T00:00:00Z'),
                  idempotencyKey: key,
                },
              });
              const after = await dbNow();
              assert.ok(
                first.collectedAt >= before && first.collectedAt <= after,
                'database clock',
              );
              assert.equal(
                first.businessDate.toISOString().slice(0, 10),
                todayText,
                'business date is computed from the server time in the branch timezone',
              );
              // Idempotency: the same collector and key can only exist once; another collector is independent.
              await rejects(
                () => pay(invoice.id, 140_000n, 140_000n, { key }),
                /payments_collector_idempotency_key|Unique constraint/,
              );
              await settle(); // PENDING_PAYMENT with 60,000 of 200,000 effective reconciles
              // The amount due of the next payment is the remaining balance (140,000), never the total.
              await rejects(() => pay(invoice.id, 140_000n, 200_000n), /balance/);
              await rejects(() => pay(invoice.id, 140_001n, 140_000n), /payments_amounts|balance/);
              // The idempotency key is per collector: the same key by another collector is independent.
              await pay(invoice.id, 140_000n, 140_000n, { key, by: customer2 });
              // The invoice is now fully covered but still PENDING: reconciliation refuses that at commit.
              await rejects(() => settle(), /reconcile with the invoice status and receivable/);
              await markPaid(invoice.id);
              await settle();
            },
          );

          await context.test(
            'reconciliation: PAID <=> effective payments cover the receivable; reversal reopens; paid episodes count',
            async () => {
              const { invoice } = await unpaid(300_000n, customer);
              const p1 = await pay(invoice.id, 100_000n, 300_000n, { tendered: 200_000n });
              await settle();
              const p2 = await pay(invoice.id, 200_000n, 200_000n);
              // Covered but not yet PAID: refused at commit.
              await rejects(() => settle(), /reconcile/);
              const paidAtStart = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(paidAtStart.status, 'PENDING_PAYMENT');
              await markPaid(invoice.id);
              await settle();
              const paid = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(paid.status, 'PAID');
              assert.equal(paid.paidSeq, 1);
              assert.ok(paid.paidAt);
              // No overpayment can be recorded any more.
              await rejects(() => pay(invoice.id, 1n, 0n), /awaiting payment|payments_amounts/);
              // PAID -> PENDING_PAYMENT only as the consequence of a reversal leaving it short.
              await rejects(async () => {
                await tx.invoice.update({
                  where: { id: invoice.id },
                  data: { status: 'PENDING_PAYMENT', paidAt: null, rowVersion: { increment: 1 } },
                });
                await settle();
              }, /reconcile/);
              // A reversal is an appended record: reason required, one per payment, original untouched.
              const reversal = (paymentId: string, reason = 'Nhập nhầm số tiền') =>
                tx.paymentCorrection.create({
                  data: { paymentId, reason, actorUserId: staff },
                });
              await rejects(() => reversal(p2.id, '  '), /payment_corrections_reason_nonblank/);
              const stampedAt = await dbNow();
              const correction = await tx.paymentCorrection.create({
                data: {
                  paymentId: p2.id,
                  reason: 'Nhập nhầm số tiền',
                  actorUserId: staff,
                  occurredAt: new Date('2020-01-01T00:00:00Z'),
                },
              });
              assert.ok(
                correction.occurredAt >= stampedAt,
                'the reversal time is the database clock',
              );
              await rejects(
                () => reversal(p2.id),
                /payment_corrections_payment_key|Unique constraint/,
              );
              // Reversal without reopening the invoice does not reconcile.
              await rejects(() => settle(), /reconcile/);
              await tx.invoice.update({
                where: { id: invoice.id },
                data: { status: 'PENDING_PAYMENT', paidAt: null, rowVersion: { increment: 1 } },
              });
              await settle();
              const reopened = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(reopened.status, 'PENDING_PAYMENT');
              assert.equal(reopened.paidSeq, 1, 'the paid episode counter is kept');
              assert.equal(reopened.paidAt, null);
              // The reversed payment stays visible and no longer counts; the balance is 200,000 again.
              assert.equal(await tx.payment.count({ where: { invoiceId: invoice.id } }), 2);
              await rejects(() => pay(invoice.id, 200_000n, 100_000n), /balance/);
              const p3 = await pay(invoice.id, 200_000n, 200_000n);
              await markPaid(invoice.id);
              await settle();
              const second = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
              assert.equal(second.paidSeq, 2, 'a new paid episode after the reversal');
              assert.equal(p1.amountVnd + p3.amountVnd, 300_000n);
              // Corrections and payments are permanent: no edit, no delete, no truncate.
              await rejects(
                () =>
                  tx.paymentCorrection.update({
                    where: { id: correction.id },
                    data: { reason: 'Sửa lý do' },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.paymentCorrection.delete({ where: { id: correction.id } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.$executeRawUnsafe('TRUNCATE payment_corrections'),
                NO_TRUNCATE,
              );
              await rejects(
                () => tx.payment.update({ where: { id: p1.id }, data: { amountVnd: 1n } }),
                /recorded payment cannot be rewritten/,
              );
              await rejects(
                () =>
                  tx.payment.update({
                    where: { id: p1.id },
                    data: { collectedAt: new Date('2020-01-01T00:00:00Z') },
                  }),
                /recorded payment cannot be rewritten/,
              );
              await rejects(
                () => tx.payment.update({ where: { id: p1.id }, data: { status: 'CANCELLED' } }),
                /recorded payment cannot be rewritten/,
              );
              await rejects(
                () => tx.payment.delete({ where: { id: p1.id } }),
                /Financial records are never deleted/,
              );
              await rejects(() => tx.$executeRawUnsafe('TRUNCATE payments'), NO_TRUNCATE);
              // A paid invoice that took a payment cannot be cancelled through OP-7 (effective or reversed).
              await rejects(
                () =>
                  tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                      status: 'CANCELLED',
                      cancelledAt: new Date(),
                      cancelledByUserId: staff,
                      cancelledFromStatus: 'PAID',
                      cancelReason: 'x',
                      rowVersion: { increment: 1 },
                    },
                  }),
                /only as a zero-balance correction|invoices_status_facts/,
              );
              // Cancelling requires the invoice to be unpaid: reverse everything first.
              const p3Correction = await reversal(p3.id, 'Khách trả lại');
              assert.ok(p3Correction.id);
              await reversal(p1.id, 'Khách trả lại phần đầu');
              await tx.invoice.update({
                where: { id: invoice.id },
                data: { status: 'PENDING_PAYMENT', paidAt: null, rowVersion: { increment: 1 } },
              });
              await settle();
              // A reversal of an already-cancelled invoice is refused.
              await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: await dbNow(),
                  cancelledByUserId: staff,
                  cancelledFromStatus: 'PENDING_PAYMENT',
                  cancelReason: 'Hủy sau khi hoàn tiền mặt',
                  rowVersion: { increment: 1 },
                },
              });
              await settle();
              await rejects(
                () => reversal(p1.id, 'Sau khi hủy'),
                /while its invoice is awaiting payment or paid/,
              );
              // Cancelling while an effective payment remains is refused at commit.
              const held = await unpaid(80_000n);
              await pay(held.invoice.id, 30_000n, 80_000n);
              await rejects(async () => {
                await tx.invoice.update({
                  where: { id: held.invoice.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: await dbNow(),
                    cancelledByUserId: staff,
                    cancelledFromStatus: 'PENDING_PAYMENT',
                    cancelReason: 'x',
                    rowVersion: { increment: 1 },
                  },
                });
                await settle();
              }, /reconcile/);
            },
          );

          await context.test(
            'payer model: customer account or guest; multiple participants stay one invoice',
            async () => {
              const visit = await completedVisit([ranged, exact]);
              // A visit with two performances is ONE invoice with two lines (no invoice split).
              const invoice = await draft(visit, { payer: customer2 });
              assert.equal(invoice.lines.length, 2);
              assert.equal(
                (await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).payerUserId,
                customer2,
              );
              const details = await tx.invoiceLineService.findMany({
                where: { invoiceId: invoice.id },
              });
              assert.equal(details.length, 2);
              assert.equal(new Set(details.map((row) => row.participantId)).size, 1);
              // The payer is never written to the (immutable) completed visit.
              await rejects(
                () =>
                  tx.visit.update({
                    where: { id: visit.id },
                    data: { ownerUserId: customer2, rowVersion: { increment: 1 } },
                  }),
                /cannot|final|immutable|rewritten/i,
              );
              await settle();
              // Payer lookup index exists for "invoices where I am the payer".
              const indexes = await tx.$queryRaw<
                { indexname: string }[]
              >`SELECT indexname FROM pg_indexes WHERE tablename = 'invoices' ORDER BY indexname`;
              assert.deepEqual(
                indexes.map((row) => row.indexname),
                [
                  'invoices_branch_date_idx',
                  'invoices_code_key',
                  'invoices_payer_idx',
                  'invoices_pkey',
                  'invoices_visit_active_key',
                ],
              );
            },
          );

          // =========================================================== permanent history

          await context.test(
            'permanent financial history: no delete or truncate, restrictive references',
            async () => {
              const { invoice } = await unpaid(120_000n, customer);
              const line = invoice.lines[0]!;
              const detail = await tx.invoiceLineService.findFirstOrThrow({
                where: { invoiceId: invoice.id },
              });
              const payment = await pay(invoice.id, 120_000n, 120_000n);
              await markPaid(invoice.id);
              await settle();
              for (const [table, id, column] of [
                ['invoices', invoice.id, 'id'],
                ['invoice_lines', line.id, 'id'],
                ['invoice_line_services', detail.invoiceLineId, 'invoice_line_id'],
                ['payments', payment.id, 'id'],
              ] as const) {
                await rejects(
                  () => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE ${column} = '${id}'`),
                  /Financial records are never deleted/,
                );
                await rejects(() => tx.$executeRawUnsafe(`TRUNCATE ${table}`), NO_TRUNCATE);
              }
              // Restrictive foreign keys: the referenced records cannot vanish from under an invoice.
              await rejects(
                () => tx.$executeRawUnsafe(`DELETE FROM services WHERE id = '${wide.id}'`),
                /foreign key|violates|never deleted/i,
              );
              await rejects(
                () => tx.$executeRawUnsafe(`DELETE FROM branches WHERE id = '${branch}'`),
                /foreign key|violates|never deleted/i,
              );
              await rejects(
                () => tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${staff}'`),
                /foreign key|violates|never|cannot|identities are permanent/i,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `DELETE FROM visit_service_lines WHERE id = '${detail.visitServiceLineId}'`,
                  ),
                /foreign key|violates|never deleted/i,
              );
              // The visit line behind a finalized invoice is DONE, hence immutable.
              await rejects(
                () =>
                  tx.visitServiceLine.update({
                    where: { id: detail.visitServiceLineId },
                    data: { maxQuantitySnapshot: 99, rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );
              // Catalog changes never rewrite an invoice (name, price range, limit are copies).
              await tx.service.update({
                where: { id: wide.id },
                data: {
                  nameVi: 'Tên mới',
                  priceVnd: 1n,
                  priceMaxVnd: 1n,
                  rowVersion: { increment: 1 },
                },
              });
              const stored = await tx.invoiceLineService.findUniqueOrThrow({
                where: { invoiceLineId: detail.invoiceLineId },
              });
              assert.equal(stored.catalogPriceMinVnd, 1_000n);
              assert.equal(stored.catalogPriceMaxVnd, 10_000_000n);
              assert.equal(
                (await tx.invoiceLine.findUniqueOrThrow({ where: { id: line.id } })).nameVi,
                wide.nameVi,
              );
              await settle();
            },
          );

          // ====================================================================== discounts

          const validity = {
            validFrom: new Date('2027-01-01T00:00:00Z'),
            validUntil: new Date('2028-01-01T00:00:00Z'),
          };
          let programSequence = 0;
          const program = (requiresCode: boolean) =>
            tx.discount.create({
              data: {
                code: `P4_DISC_${run}_${++programSequence}`,
                nameVi: 'Ưu đãi',
                nameEn: 'Offer',
                requiresCode,
              },
              select: { id: true },
            });
          const configuration = (
            discountId: string,
            overrides: Partial<Prisma.DiscountVersionUncheckedCreateInput> = {},
          ) =>
            tx.discountVersion.create({
              data: {
                discountId,
                versionNo: 1,
                kind: 'PERCENT',
                percentBp: 1000,
                scopeMode: 'ALL_SERVICES',
                createdByUserId: staff,
                ...validity,
                ...overrides,
              },
              select: { id: true },
            });

          await context.test(
            'discount programs: versioned append-only configuration, code-less vs voucher programs, scope',
            async () => {
              const promo = await program(false);
              const voucherProgram = await program(true);
              // Program facts: canonical code, names, termination is one fact and permanent.
              await rejects(
                () =>
                  tx.discount.create({
                    data: { code: 'lower_case', nameVi: 'x', nameEn: 'x', requiresCode: false },
                  }),
                /discounts_code_canonical/,
              );
              await rejects(
                () =>
                  tx.discount.create({
                    data: {
                      code: `P4_BLANK_${run}`,
                      nameVi: ' ',
                      nameEn: 'x',
                      requiresCode: false,
                    },
                  }),
                /discounts_names_nonblank/,
              );
              await rejects(
                () =>
                  tx.discount.update({
                    where: { id: promo.id },
                    data: { terminatedAt: new Date(), rowVersion: { increment: 1 } },
                  }),
                /discounts_termination_facts/,
              );
              await rejects(
                () =>
                  tx.discount.update({
                    where: { id: promo.id },
                    data: { requiresCode: true, rowVersion: { increment: 1 } },
                  }),
                /keeps its identity, code and code requirement/,
              );
              await rejects(
                () =>
                  tx.discount.update({
                    where: { id: promo.id },
                    data: { code: `P4_OTHER_${run}`, rowVersion: { increment: 1 } },
                  }),
                /keeps its identity, code and code requirement/,
              );
              await rejects(
                () => tx.discount.update({ where: { id: promo.id }, data: { isActive: false } }),
                /bump the version by one/,
              );
              await tx.discount.update({
                where: { id: promo.id },
                data: { isActive: false, rowVersion: { increment: 1 } },
              });
              const ended = await program(false);
              await tx.discount.update({
                where: { id: ended.id },
                data: {
                  terminatedAt: new Date(),
                  terminatedByUserId: staff,
                  terminatedReason: 'Kết thúc sớm',
                  rowVersion: { increment: 1 },
                },
              });
              await rejects(
                () =>
                  tx.discount.update({
                    where: { id: ended.id },
                    data: {
                      terminatedAt: null,
                      terminatedByUserId: null,
                      terminatedReason: null,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /cannot be reopened/,
              );
              await rejects(
                () => tx.discount.delete({ where: { id: promo.id } }),
                /Financial records are never deleted/,
              );
              await rejects(() => tx.$executeRawUnsafe('TRUNCATE discounts'), NO_TRUNCATE);
              // Versions: percentage in basis points XOR fixed VND amount, validity, spend and limits.
              const bad = async (
                overrides: Partial<Prisma.DiscountVersionUncheckedCreateInput>,
                rule: RegExp,
              ) => {
                try {
                  await rejects(() => configuration(promo.id, overrides), rule);
                } catch (error) {
                  const shown = JSON.stringify(overrides, (_key, value: unknown) =>
                    typeof value === 'bigint' ? value.toString() : value,
                  );
                  throw new Error(`configuration ${shown}: ${(error as Error).message}`, {
                    cause: error,
                  });
                }
              };
              await bad({ percentBp: 0 }, /discount_versions_value/);
              await bad({ percentBp: 10_001 }, /discount_versions_value/);
              await bad({ percentBp: -1 }, /discount_versions_value/);
              await bad({ percentBp: null }, /discount_versions_value/);
              await bad({ fixedAmountVnd: 1_000n }, /discount_versions_value/); // both kinds
              await bad({ kind: 'FIXED_AMOUNT', percentBp: null }, /discount_versions_value/);
              await bad(
                { kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: 0n },
                /discount_versions_value/,
              );
              await bad(
                { kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: -5n },
                /discount_versions_value/,
              );
              await bad({ versionNo: 0 }, /discount_versions_number_positive/);
              await bad({ validUntil: validity.validFrom }, /discount_versions_validity/);
              await bad({ minSpendVnd: -1n }, /discount_versions_min_spend/);
              await bad({ usageLimitTotal: 0 }, /discount_versions_limits/);
              await bad({ usageLimitPerCustomer: 0 }, /discount_versions_limits/);
              const v1 = await configuration(promo.id, { percentBp: 10_000 });
              await configuration(promo.id, {
                versionNo: 2,
                kind: 'FIXED_AMOUNT',
                percentBp: null,
                fixedAmountVnd: 50_000n,
                minSpendVnd: 500_000n,
                usageLimitTotal: 100,
                usageLimitPerCustomer: 1,
              });
              await bad(
                { versionNo: 2 },
                /discount_versions_discount_version_key|Unique constraint/,
              );
              // Versions are append-only configuration.
              await rejects(
                () => tx.discountVersion.update({ where: { id: v1.id }, data: { percentBp: 500 } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.discountVersion.delete({ where: { id: v1.id } }),
                /cannot be removed or rewritten/,
              );
              await settle();
              await rejects(() => tx.$executeRawUnsafe('TRUNCATE discount_versions'), NO_TRUNCATE);
              // Scope: SELECTED needs services or categories, ALL_SERVICES needs none.
              await rejects(async () => {
                await configuration(promo.id, { versionNo: 3, scopeMode: 'SELECTED' });
                await settle();
              }, /selected-scope version names/);
              const selected = await configuration(promo.id, {
                versionNo: 4,
                scopeMode: 'SELECTED',
              });
              await tx.discountVersionService.create({
                data: { versionId: selected.id, serviceId: ranged.id },
              });
              const byCategory = await configuration(promo.id, {
                versionNo: 5,
                scopeMode: 'SELECTED',
              });
              await tx.discountVersionCategory.create({
                data: { versionId: byCategory.id, categoryId: category },
              });
              await settle();
              await rejects(async () => {
                await tx.discountVersionService.create({
                  data: { versionId: v1.id, serviceId: ranged.id },
                });
                await settle();
              }, /all-services version names none/);
              await rejects(
                () =>
                  tx.discountVersionService.delete({
                    where: {
                      versionId_serviceId: { versionId: selected.id, serviceId: ranged.id },
                    },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.$executeRawUnsafe(`DELETE FROM services WHERE id = '${ranged.id}'`),
                /foreign key|violates|never deleted/i,
              );
              // Vouchers belong only to programs that require a code; canonical codes; never deleted.
              const voucher = (discountId: string, code: string) =>
                tx.voucher.create({ data: { discountId, code, createdByUserId: staff } });
              await rejects(
                () => voucher(promo.id, `P4V_${run}_A`),
                /Voucher codes belong only to programs that require a code/,
              );
              await rejects(() => voucher(voucherProgram.id, 'lower'), /vouchers_code_canonical/);
              await rejects(
                () => voucher(voucherProgram.id, 'HAS SPACE'),
                /vouchers_code_canonical/,
              );
              const code = await voucher(voucherProgram.id, `P4V_${run}_B`);
              await rejects(
                () => voucher(voucherProgram.id, `P4V_${run}_B`),
                /vouchers_code_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.voucher.update({
                    where: { id: code.id },
                    data: { code: `P4V_${run}_C`, rowVersion: { increment: 1 } },
                  }),
                /keeps its program and code/,
              );
              await tx.voucher.update({
                where: { id: code.id },
                data: { isActive: false, rowVersion: { increment: 1 } },
              });
              await rejects(
                () => tx.voucher.delete({ where: { id: code.id } }),
                /Financial records are never deleted/,
              );
              await settle();
            },
          );

          /**
           * A finalized invoice with an applied benefit. `Q3` boundaries live in the amount CHECK.
           */
          const benefitInvoice = async (options: {
            discountId: string;
            versionId: string;
            kind: 'PERCENT' | 'FIXED_AMOUNT';
            percentBp?: number;
            fixedAmountVnd?: bigint;
            amount: bigint;
            eligible: bigint;
            price: bigint;
            payer: string | null;
            voucherId?: string;
            finalizeStatus?: boolean;
          }) => {
            const visit = await completedVisit([free]);
            const invoice = await draft(visit, {
              payer: options.payer,
              priced: [[1, options.price]],
            });
            if (options.voucherId) {
              await tx.invoiceVoucherEntry.create({
                data: {
                  invoiceId: invoice.id,
                  voucherId: options.voucherId,
                  suppliedByUserId: staff,
                },
              });
            }
            await tx.invoiceDiscountApplication.create({
              data: {
                invoiceId: invoice.id,
                discountId: options.discountId,
                versionId: options.versionId,
                voucherId: options.voucherId ?? null,
                kind: options.kind,
                percentBp: options.percentBp ?? null,
                fixedAmountVnd: options.fixedAmountVnd ?? null,
                eligibleSubtotalVnd: options.eligible,
                computedAmountVnd: options.amount,
                candidates: [{ discount: 'x', eligible: true, amount: options.amount.toString() }],
                selectionReason: 'Lợi ích lớn nhất',
                finalizedByUserId: staff,
              },
            });
            await tx.discountRedemption.create({
              data: {
                invoiceId: invoice.id,
                discountId: options.discountId,
                versionId: options.versionId,
                voucherId: options.voucherId ?? null,
                payerUserId: options.payer,
              },
            });
            if (options.finalizeStatus !== false) await finalize(invoice.id, options.amount);
            return invoice;
          };

          await context.test(
            'benefit application: Q3 half-up amount rule, one winner, redemption, usage limits, OP-3 member payer',
            async () => {
              const promo = await program(false);
              const percent = await configuration(promo.id, { percentBp: 1000 }); // 10.00 %
              const fixedProgram = await program(false);
              const fixed = await configuration(fixedProgram.id, {
                kind: 'FIXED_AMOUNT',
                percentBp: null,
                fixedAmountVnd: 50_000n,
              });
              const application = (
                invoiceId: string,
                overrides: Partial<Prisma.InvoiceDiscountApplicationUncheckedCreateInput>,
              ) =>
                tx.invoiceDiscountApplication.create({
                  data: {
                    invoiceId,
                    discountId: promo.id,
                    versionId: percent.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    eligibleSubtotalVnd: 15n,
                    computedAmountVnd: 2n,
                    candidates: [],
                    selectionReason: 'Lợi ích lớn nhất',
                    finalizedByUserId: staff,
                    ...overrides,
                  },
                });
              const visit = await completedVisit([free]);
              const invoice = await draft(visit, { priced: [[1, 50_000n]] });
              // Q3: percentages round HALF UP to 1 VND. 15 x 10% = 1.5 -> 2; 14 x 10% = 1.4 -> 1; 25 -> 3 (2.5).
              await rejects(
                () => application(invoice.id, { computedAmountVnd: 1n }),
                /invoice_discount_applications_amount/,
              );
              await rejects(
                () => application(invoice.id, { computedAmountVnd: 3n }),
                /invoice_discount_applications_amount/,
              );
              await rejects(
                () => application(invoice.id, { eligibleSubtotalVnd: 14n, computedAmountVnd: 2n }),
                /invoice_discount_applications_amount/,
              );
              await rejects(
                () => application(invoice.id, { eligibleSubtotalVnd: 25n, computedAmountVnd: 2n }),
                /invoice_discount_applications_amount/,
              );
              // No benefit worth 0 is recorded (no row exists when nothing won), and never more than eligible.
              await rejects(
                () => application(invoice.id, { eligibleSubtotalVnd: 4n, computedAmountVnd: 0n }),
                /invoice_discount_applications_amount/,
              );
              await rejects(
                () => application(invoice.id, { eligibleSubtotalVnd: 0n, computedAmountVnd: 0n }),
                /invoice_discount_applications_amount/,
              );
              // Fixed amounts are capped by the eligible subtotal.
              await rejects(
                () =>
                  application(invoice.id, {
                    discountId: fixedProgram.id,
                    versionId: fixed.id,
                    kind: 'FIXED_AMOUNT',
                    percentBp: null,
                    fixedAmountVnd: 50_000n,
                    eligibleSubtotalVnd: 30_000n,
                    computedAmountVnd: 50_000n,
                  }),
                /invoice_discount_applications_amount/,
              );
              // The applied rule must copy its program version; the kind and value cannot be invented.
              await rejects(
                () =>
                  application(invoice.id, {
                    percentBp: 2000,
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 10_000n,
                  }),
                /must copy its program version/,
              );
              await rejects(
                () =>
                  application(invoice.id, {
                    versionId: fixed.id,
                    discountId: promo.id,
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                  }),
                /must copy its program version|invoice_discount_applications_version_fkey|Foreign key/,
              );
              await rejects(
                () => application(invoice.id, { candidates: { not: 'an array' } as never }),
                /invoice_discount_applications_candidates|invoice_discount_applications_amount/,
              );
              await rejects(
                () =>
                  application(invoice.id, {
                    selectionReason: ' ',
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                  }),
                /invoice_discount_applications_reason_nonblank/,
              );
              // A code-less promotion is an automatic candidate; a voucher-program benefit needs its code.
              const voucherProgram = await program(true);
              const voucherVersion = await configuration(voucherProgram.id);
              await rejects(
                () =>
                  application(invoice.id, {
                    discountId: voucherProgram.id,
                    versionId: voucherVersion.id,
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                  }),
                /must come from a code-less promotion/,
              );
              const other = await program(false);
              const otherVersion = await configuration(other.id);
              const voucher = await tx.voucher.create({
                data: {
                  discountId: voucherProgram.id,
                  code: `P4V_${run}_APP`,
                  createdByUserId: staff,
                },
              });
              await rejects(
                () =>
                  application(invoice.id, {
                    discountId: other.id,
                    versionId: otherVersion.id,
                    voucherId: voucher.id,
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                  }),
                /must use a code of its own program/,
              );
              // Valid: 10 % of 50,000 = 5,000. Applications are immutable and unique per invoice.
              const winner = await application(invoice.id, {
                eligibleSubtotalVnd: 50_000n,
                computedAmountVnd: 5_000n,
              });
              await rejects(
                () =>
                  application(invoice.id, {
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                  }),
                /invoice_discount_applications_invoice_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.invoiceDiscountApplication.update({
                    where: { id: winner.id },
                    data: { selectionReason: 'x' },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.invoiceDiscountApplication.delete({ where: { id: winner.id } }),
                /cannot be removed or rewritten/,
              );
              // Still a DRAFT: the applied benefit without finalization is refused at commit.
              await rejects(
                () => settle(),
                /draft invoice has no applied benefit or redemption yet/,
              );
              await tx.discountRedemption.create({
                data: {
                  invoiceId: invoice.id,
                  discountId: promo.id,
                  versionId: percent.id,
                  payerUserId: null,
                },
              });
              await finalize(invoice.id, 5_000n);
              await settle();
            },
          );

          await context.test(
            'redemptions: one per invoice, member payer for per-customer limits (OP-3), usage limits under the program lock',
            async () => {
              const promo = await program(false);
              const limited = await configuration(promo.id, {
                usageLimitTotal: 2,
                usageLimitPerCustomer: 1,
              });
              const totalOnly = await program(false);
              const totalOnlyVersion = await configuration(totalOnly.id, { usageLimitTotal: 1 });
              const unlimited = await program(false);
              const unlimitedVersion = await configuration(unlimited.id);
              // A per-customer limit needs an identified MEMBER payer: a guest is refused (OP-3).
              await rejects(
                () =>
                  benefitInvoice({
                    discountId: promo.id,
                    versionId: limited.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    amount: 5_000n,
                    eligible: 50_000n,
                    price: 50_000n,
                    payer: null,
                  }),
                /needs an identified member payer/,
              );
              // A benefit with only a total limit is eligible for a guest (no identity is fabricated).
              const guest = await benefitInvoice({
                discountId: totalOnly.id,
                versionId: totalOnlyVersion.id,
                kind: 'PERCENT',
                percentBp: 1000,
                amount: 5_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: null,
              });
              await settle();
              const guestRedemption = await tx.discountRedemption.findFirstOrThrow({
                where: { invoiceId: guest.id },
              });
              assert.equal(guestRedemption.payerUserId, null);
              // The total limit (1) is reached: the next redemption is refused, whoever pays.
              await rejects(
                () =>
                  benefitInvoice({
                    discountId: totalOnly.id,
                    versionId: totalOnlyVersion.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    amount: 5_000n,
                    eligible: 50_000n,
                    price: 50_000n,
                    payer: customer,
                  }),
                /total usage limit of the benefit is reached/,
              );
              // Per-customer limit 1: the member redeems once, a second time is refused, another member may.
              const member = await benefitInvoice({
                discountId: promo.id,
                versionId: limited.id,
                kind: 'PERCENT',
                percentBp: 1000,
                amount: 5_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: customer,
              });
              await settle();
              await rejects(
                () =>
                  benefitInvoice({
                    discountId: promo.id,
                    versionId: limited.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    amount: 5_000n,
                    eligible: 50_000n,
                    price: 50_000n,
                    payer: customer,
                  }),
                /per-customer usage limit of the benefit is reached/,
              );
              const second = await benefitInvoice({
                discountId: promo.id,
                versionId: limited.id,
                kind: 'PERCENT',
                percentBp: 1000,
                amount: 5_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: customer2,
              });
              await settle();
              await rejects(
                () =>
                  benefitInvoice({
                    discountId: promo.id,
                    versionId: limited.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    amount: 5_000n,
                    eligible: 50_000n,
                    price: 50_000n,
                    payer: null,
                  }),
                /needs an identified member payer|total usage limit/,
              );
              // The ledger is permanent and one redemption per invoice.
              const redemption = await tx.discountRedemption.findFirstOrThrow({
                where: { invoiceId: member.id },
              });
              await rejects(
                () =>
                  tx.discountRedemption.create({
                    data: {
                      invoiceId: member.id,
                      discountId: promo.id,
                      versionId: limited.id,
                      payerUserId: customer,
                    },
                  }),
                /discount_redemptions_invoice_key|Unique constraint|records exactly the applied benefit|usage limit/,
              );
              await rejects(
                () =>
                  tx.discountRedemption.update({
                    where: { id: redemption.id },
                    data: { payerUserId: null },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.discountRedemption.delete({ where: { id: redemption.id } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.$executeRawUnsafe('TRUNCATE discount_redemptions'),
                NO_TRUNCATE,
              );
              // Redemption must record exactly the applied benefit and the invoice's payer.
              const visit = await completedVisit([free]);
              const bare = await draft(visit, { payer: customer, priced: [[1, 50_000n]] });
              await rejects(
                () =>
                  tx.discountRedemption.create({
                    data: {
                      invoiceId: bare.id,
                      discountId: unlimited.id,
                      versionId: unlimitedVersion.id,
                      payerUserId: customer,
                    },
                  }),
                /exactly the applied benefit of its invoice/,
              );
              await tx.invoiceDiscountApplication.create({
                data: {
                  invoiceId: bare.id,
                  discountId: unlimited.id,
                  versionId: unlimitedVersion.id,
                  kind: 'PERCENT',
                  percentBp: 1000,
                  eligibleSubtotalVnd: 50_000n,
                  computedAmountVnd: 5_000n,
                  candidates: [],
                  selectionReason: 'Lợi ích lớn nhất',
                  finalizedByUserId: staff,
                },
              });
              await rejects(
                () =>
                  tx.discountRedemption.create({
                    data: {
                      invoiceId: bare.id,
                      discountId: unlimited.id,
                      versionId: unlimitedVersion.id,
                      payerUserId: customer2, // not the invoice's payer
                    },
                  }),
                /records the payer of its invoice/,
              );
              await rejects(
                () =>
                  tx.discountRedemption.create({
                    data: {
                      invoiceId: bare.id,
                      discountId: unlimited.id,
                      versionId: unlimitedVersion.id,
                      payerUserId: null,
                    },
                  }),
                /records the payer of its invoice/,
              );
              // A redemption without a redeemed_at from the client: the database clock is used.
              const stamped = await tx.discountRedemption.create({
                data: {
                  invoiceId: bare.id,
                  discountId: unlimited.id,
                  versionId: unlimitedVersion.id,
                  payerUserId: customer,
                  redeemedAt: new Date('2020-01-01T00:00:00Z'),
                },
              });
              assert.ok(
                stamped.redeemedAt.getUTCFullYear() >= 2026,
                'redeemed_at is the database clock',
              );
              await finalize(bare.id, 5_000n);
              await settle();
              assert.ok(second.id);
            },
          );

          await context.test(
            'finalized-invoice discount integrity: header equals the benefit, applied <=> redeemed once, voucher supplied',
            async () => {
              const promo = await program(false);
              const version1 = await configuration(promo.id);
              // A discount total without an applied benefit is refused for a finalized invoice.
              const visit = await completedVisit([free]);
              const orphan = await draft(visit, { priced: [[1, 50_000n]] });
              await rejects(async () => {
                await finalize(orphan.id, 5_000n);
                await settle();
              }, /discount total must equal its applied benefit/);
              // An applied benefit without the matching header discount, or without a redemption, is refused.
              const visit2 = await completedVisit([free]);
              const mismatched = await draft(visit2, { priced: [[1, 50_000n]] });
              await tx.invoiceDiscountApplication.create({
                data: {
                  invoiceId: mismatched.id,
                  discountId: promo.id,
                  versionId: version1.id,
                  kind: 'PERCENT',
                  percentBp: 1000,
                  eligibleSubtotalVnd: 50_000n,
                  computedAmountVnd: 5_000n,
                  candidates: [],
                  selectionReason: 'Lợi ích lớn nhất',
                  finalizedByUserId: staff,
                },
              });
              await rejects(async () => {
                await finalize(mismatched.id, 4_000n);
                await settle();
              }, /discount total must equal its applied benefit/);
              await rejects(async () => {
                await finalize(mismatched.id, 5_000n);
                await settle();
              }, /applied benefit is redeemed exactly once/);
              await tx.discountRedemption.create({
                data: { invoiceId: mismatched.id, discountId: promo.id, versionId: version1.id },
              });
              await finalize(mismatched.id, 5_000n);
              await settle();
              // The eligible subtotal never exceeds the invoice subtotal.
              const visit3 = await completedVisit([free]);
              const oversized = await draft(visit3, { priced: [[1, 10_000n]] });
              await rejects(async () => {
                await tx.invoiceDiscountApplication.create({
                  data: {
                    invoiceId: oversized.id,
                    discountId: promo.id,
                    versionId: version1.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                    candidates: [],
                    selectionReason: 'Lợi ích lớn nhất',
                    finalizedByUserId: staff,
                  },
                });
                await tx.discountRedemption.create({
                  data: { invoiceId: oversized.id, discountId: promo.id, versionId: version1.id },
                });
                await finalize(oversized.id, 5_000n);
                await settle();
              }, /eligible subtotal cannot exceed the invoice subtotal/);
              // A voucher benefit needs its code supplied (and only while the invoice is a draft).
              const voucherProgram = await program(true);
              const voucherVersion = await configuration(voucherProgram.id);
              const code = await tx.voucher.create({
                data: {
                  discountId: voucherProgram.id,
                  code: `P4V_${run}_INT`,
                  createdByUserId: staff,
                },
              });
              const visit4 = await completedVisit([free]);
              const withoutEntry = await draft(visit4, { priced: [[1, 50_000n]] });
              await rejects(async () => {
                await tx.invoiceDiscountApplication.create({
                  data: {
                    invoiceId: withoutEntry.id,
                    discountId: voucherProgram.id,
                    versionId: voucherVersion.id,
                    voucherId: code.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    eligibleSubtotalVnd: 50_000n,
                    computedAmountVnd: 5_000n,
                    candidates: [],
                    selectionReason: 'Mã hợp lệ',
                    finalizedByUserId: staff,
                  },
                });
                await tx.discountRedemption.create({
                  data: {
                    invoiceId: withoutEntry.id,
                    discountId: voucherProgram.id,
                    versionId: voucherVersion.id,
                    voucherId: code.id,
                  },
                });
                await finalize(withoutEntry.id, 5_000n);
                await settle();
              }, /voucher benefit needs its code supplied/);
              const supplied = await benefitInvoice({
                discountId: voucherProgram.id,
                versionId: voucherVersion.id,
                kind: 'PERCENT',
                percentBp: 1000,
                amount: 5_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: null,
                voucherId: code.id,
              });
              await settle();
              // After finalization the supplied entries are frozen.
              const entry = await tx.invoiceVoucherEntry.findFirstOrThrow({
                where: { invoiceId: supplied.id },
              });
              await rejects(
                () =>
                  tx.invoiceVoucherEntry.update({
                    where: { id: entry.id },
                    data: { removedAt: new Date(), removedByUserId: staff },
                  }),
                /only while the invoice is a draft/,
              );
              await rejects(
                () =>
                  tx.invoiceVoucherEntry.create({
                    data: { invoiceId: supplied.id, voucherId: code.id, suppliedByUserId: staff },
                  }),
                /only while the invoice is a draft/,
              );
              await rejects(
                () => tx.invoiceVoucherEntry.delete({ where: { id: entry.id } }),
                /Financial records are never deleted/,
              );
            },
          );

          await context.test(
            'voucher entries: unique active code per draft, one removal transition, re-supply after removal',
            async () => {
              const voucherProgram = await program(true);
              await configuration(voucherProgram.id);
              const code = await tx.voucher.create({
                data: {
                  discountId: voucherProgram.id,
                  code: `P4V_${run}_ENT`,
                  createdByUserId: staff,
                },
              });
              const visit = await completedVisit([free]);
              const invoice = await draft(visit, { priced: [[1, 50_000n]] });
              const supply = () =>
                tx.invoiceVoucherEntry.create({
                  data: { invoiceId: invoice.id, voucherId: code.id, suppliedByUserId: staff },
                });
              const entry = await supply();
              await rejects(() => supply(), /invoice_voucher_entries_active_key|Unique constraint/);
              await rejects(
                () =>
                  tx.invoiceVoucherEntry.create({
                    data: {
                      invoiceId: invoice.id,
                      voucherId: code.id,
                      suppliedByUserId: staff,
                      removedAt: new Date(),
                      removedByUserId: staff,
                    },
                  }),
                /supplied before it is removed|invoice_voucher_entries_active_key/,
              );
              await rejects(
                () =>
                  tx.invoiceVoucherEntry.update({
                    where: { id: entry.id },
                    data: { removedAt: new Date() },
                  }),
                /invoice_voucher_entries_removal_facts/,
              );
              await rejects(
                () =>
                  tx.invoiceVoucherEntry.update({
                    where: { id: entry.id },
                    data: { suppliedByUserId: customer },
                  }),
                /one removal transition and nothing else changes/,
              );
              await tx.invoiceVoucherEntry.update({
                where: { id: entry.id },
                data: { removedAt: await dbNow(), removedByUserId: staff },
              });
              await rejects(
                () =>
                  tx.invoiceVoucherEntry.update({
                    where: { id: entry.id },
                    data: { removedAt: null, removedByUserId: null },
                  }),
                /one removal transition and nothing else changes/,
              );
              // The removed entry no longer blocks supplying the same code again.
              await supply();
              await settle();
              await rejects(
                () => tx.$executeRawUnsafe('TRUNCATE invoice_voucher_entries'),
                NO_TRUNCATE,
              );
            },
          );

          await context.test(
            'redemption release (OP-7): append-only, only for a cancelled invoice, cause matches, at most once',
            async () => {
              const promo = await program(false);
              const version1 = await configuration(promo.id, { usageLimitTotal: 1 });
              // ---- unpaid finalized cancellation releases with INVOICE_CANCELLED_UNPAID
              const unpaidBenefit = await benefitInvoice({
                discountId: promo.id,
                versionId: version1.id,
                kind: 'PERCENT',
                percentBp: 1000,
                amount: 5_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: customer,
              });
              await settle();
              const redemption = await tx.discountRedemption.findFirstOrThrow({
                where: { invoiceId: unpaidBenefit.id },
              });
              const release = (
                cause: 'INVOICE_CANCELLED_UNPAID' | 'ZERO_BALANCE_CORRECTION',
                reason = 'Hủy hóa đơn',
              ) =>
                tx.discountRedemptionRelease.create({
                  data: {
                    redemptionId: redemption.id,
                    releasedByUserId: staff,
                    cause,
                    reason,
                  },
                });
              // Capacity is used up: another redemption of the same program is refused (limit 1).
              await rejects(
                () =>
                  benefitInvoice({
                    discountId: promo.id,
                    versionId: version1.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    amount: 5_000n,
                    eligible: 50_000n,
                    price: 50_000n,
                    payer: customer2,
                  }),
                /total usage limit of the benefit is reached/,
              );
              // A release is refused while the invoice is not cancelled.
              await rejects(
                () => release('INVOICE_CANCELLED_UNPAID'),
                /released only when its invoice is cancelled/,
              );
              // Cancelling without releasing the redemption is refused at commit.
              const cancelUnpaid = async () =>
                tx.invoice.update({
                  where: { id: unpaidBenefit.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: await dbNow(),
                    cancelledByUserId: staff,
                    cancelledFromStatus: 'PENDING_PAYMENT',
                    cancelReason: 'Khách bỏ về',
                    rowVersion: { increment: 1 },
                  },
                });
              await rejects(async () => {
                await cancelUnpaid();
                await settle();
              }, /redemption is released exactly when its invoice is cancelled/);
              await cancelUnpaid();
              // The cause must match how the invoice was cancelled.
              await rejects(
                () => release('ZERO_BALANCE_CORRECTION'),
                /cause must match how the invoice was cancelled/,
              );
              await rejects(
                () => release('INVOICE_CANCELLED_UNPAID', ' '),
                /discount_redemption_releases_reason_nonblank/,
              );
              const released = await release('INVOICE_CANCELLED_UNPAID');
              assert.ok(released.releasedAt.getUTCFullYear() >= 2026);
              await settle();
              // Released at most once; the redemption itself stays as permanent history.
              await rejects(
                () => release('INVOICE_CANCELLED_UNPAID'),
                /discount_redemption_releases_redemption_key|Unique constraint/,
              );
              assert.equal(
                await tx.discountRedemption.count({ where: { id: redemption.id } }),
                1,
                'the original redemption stays',
              );
              await rejects(
                () =>
                  tx.discountRedemptionRelease.update({
                    where: { id: released.id },
                    data: { reason: 'x' },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.discountRedemptionRelease.delete({ where: { id: released.id } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.$executeRawUnsafe('TRUNCATE discount_redemption_releases'),
                NO_TRUNCATE,
              );
              // Capacity returned exactly once: the program can be redeemed again (limit 1, none active).
              const again = await benefitInvoice({
                discountId: promo.id,
                versionId: version1.id,
                kind: 'PERCENT',
                percentBp: 1000,
                amount: 5_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: customer2,
              });
              await settle();
              assert.ok(again.id);
              await rejects(
                () =>
                  benefitInvoice({
                    discountId: promo.id,
                    versionId: version1.id,
                    kind: 'PERCENT',
                    percentBp: 1000,
                    amount: 5_000n,
                    eligible: 50_000n,
                    price: 50_000n,
                    payer: customer,
                  }),
                /total usage limit of the benefit is reached/,
              );

              // ---- OP-7: a zero-balance PAID invoice with a benefit, cancelled as a correction
              const zeroProgram = await program(false);
              const zeroVersion = await configuration(zeroProgram.id, {
                kind: 'FIXED_AMOUNT',
                percentBp: null,
                fixedAmountVnd: 50_000n,
                usageLimitTotal: 1,
              });
              const zero = await benefitInvoice({
                discountId: zeroProgram.id,
                versionId: zeroVersion.id,
                kind: 'FIXED_AMOUNT',
                fixedAmountVnd: 50_000n,
                amount: 50_000n,
                eligible: 50_000n,
                price: 50_000n,
                payer: customer,
              });
              await settle();
              const settled = await tx.invoice.findUniqueOrThrow({ where: { id: zero.id } });
              assert.equal(settled.status, 'PAID', 'the benefit covered the whole receivable');
              assert.equal(settled.totalVnd, 0n);
              assert.equal(settled.discountTotalVnd, 50_000n);
              assert.equal(await tx.payment.count({ where: { invoiceId: zero.id } }), 0);
              const zeroRedemption = await tx.discountRedemption.findFirstOrThrow({
                where: { invoiceId: zero.id },
              });
              const cancelZero = async () =>
                tx.invoice.update({
                  where: { id: zero.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: await dbNow(),
                    cancelledByUserId: staff,
                    cancelledFromStatus: 'PAID',
                    cancelReason: 'Áp nhầm ưu đãi',
                    rowVersion: { increment: 1 },
                  },
                });
              await rejects(async () => {
                await cancelZero();
                await settle();
              }, /redemption is released exactly when its invoice is cancelled/);
              await cancelZero();
              await rejects(
                () =>
                  tx.discountRedemptionRelease.create({
                    data: {
                      redemptionId: zeroRedemption.id,
                      releasedByUserId: staff,
                      cause: 'INVOICE_CANCELLED_UNPAID',
                      reason: 'Sai nguyên nhân',
                    },
                  }),
                /cause must match how the invoice was cancelled/,
              );
              await tx.discountRedemptionRelease.create({
                data: {
                  redemptionId: zeroRedemption.id,
                  releasedByUserId: staff,
                  cause: 'ZERO_BALANCE_CORRECTION',
                  reason: 'Áp nhầm ưu đãi',
                },
              });
              await settle();
              // Original facts are preserved on the cancelled invoice: benefit, discount, paid episode.
              const history = await tx.invoice.findUniqueOrThrow({ where: { id: zero.id } });
              assert.equal(history.discountTotalVnd, 50_000n);
              assert.equal(history.paidSeq, 1);
              assert.equal(
                await tx.invoiceDiscountApplication.count({ where: { invoiceId: zero.id } }),
                1,
              );
              assert.equal(await tx.discountRedemption.count({ where: { invoiceId: zero.id } }), 1);
            },
          );

          await settle();
          throw rollback;
        },
        { timeout: 300_000 },
      ),
      (error: unknown) => error === rollback,
    );
    // Nothing the suite created survives.
    assert.equal(
      await database.invoice.count({
        where: { code: { startsWith: 'INV-' }, branch: { code: { endsWith: run } } },
      }),
      0,
    );
    assert.equal(await database.branch.count({ where: { code: { endsWith: run } } }), 0);
    assert.equal(await database.discount.count({ where: { code: { contains: run } } }), 0);
    assert.equal(await database.auditEvent.count({ where: { entityType: `P4Fin${run}` } }), 0);
  } finally {
    await database.$disconnect();
  }
});
