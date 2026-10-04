import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  generateInvoiceCode,
  PERMISSION_CATALOG,
  syncPermissionCatalog,
} from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const PHASE5_CODES = [
  'VIEW_LOYALTY',
  'ADJUST_LOYALTY_POINTS',
  'MANAGE_REFERRALS',
  'MANAGE_COMBOS',
  'SELL_COMBOS',
  'CONSUME_COMBO_SESSIONS',
  'RESTORE_COMBO_SESSIONS',
  'MANAGE_BIRTHDAY_REWARDS',
  'MANAGE_REWARD_CATALOG',
  'ISSUE_REWARDS',
  'VIEW_LOYALTY_EXCEPTIONS',
] as const;
const GLOBAL_ONLY_CODES: readonly string[] = [
  'ADJUST_LOYALTY_POINTS',
  'MANAGE_COMBOS',
  'RESTORE_COMBO_SESSIONS',
  'MANAGE_BIRTHDAY_REWARDS',
  'MANAGE_REWARD_CATALOG',
  'VIEW_LOYALTY_EXCEPTIONS',
];
const FINANCIAL_CODES: readonly string[] = ['ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS'];

const NEW_TABLES = [
  'loyalty_go_live',
  'loyalty_wallets',
  'loyalty_ledger_entries',
  'referrals',
  'referral_changes',
  'invoice_loyalty_snapshots',
  'combos',
  'combo_versions',
  'combo_purchases',
  'combo_sessions',
  'combo_session_consumptions',
  'combo_session_releases',
  'combo_session_restorations',
  'reward_catalog_items',
  'reward_entitlements',
  'reward_redemptions',
  'reward_redemption_releases',
] as const;

// Monday 2027-03-01 in Asia/Ho_Chi_Minh (UTC+7).
const DAY = new Date('2027-03-01T00:00:00.000Z');
const LOCAL_MIDNIGHT = new Date('2027-03-01T00:00:00+07:00').getTime();

test('Phase 5 P5-2 loyalty / referral / combo / reward database foundation (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 5 foundation rollback');
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
          // A rejection that only appears at commit: the offending work and the check share one savepoint.
          const rejectsAtCommit = (work: () => Promise<unknown>, pattern: RegExp) =>
            rejects(async () => {
              await work();
              await settle();
            }, pattern);
          // The statement-level TRUNCATE guard exists on the table. The guard is also executed for real in the
          // isolated-schema race suite: TRUNCATE takes ACCESS EXCLUSIVE locks, which would deadlock with the
          // other database suites that run in parallel against this shared database.
          const truncateRejected = async (table: string) => {
            const guards = await tx.$queryRaw<{ n: bigint }[]>`
              SELECT count(*)::bigint AS n FROM pg_trigger t
              WHERE t.tgrelid = ${table}::regclass AND t.tgname = ${`${table}_no_truncate`}
                AND (t.tgtype & 32) = 32 AND (t.tgtype & 2) = 2`;
            assert.equal(guards[0]!.n, 1n, `${table} has a BEFORE TRUNCATE guard`);
          };
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
                fullName: `P5 fixture ${sequence}`,
                preferredLocale: 'vi',
                emailCanonical: `p5-${sequence}-${run.toLowerCase()}@example.com`,
                emailDelivery: `p5-${sequence}-${run.toLowerCase()}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+848${phoneBase}${String(sequence).padStart(3, '0')}`,
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
                          employeeCodeCanonical: `P5_${run}_${sequence}`,
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
              data: { code: `IT-P5-${run}`, name: 'P5 branch', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const otherBranch = (
            await tx.branch.create({
              data: { code: `IT-P5B-${run}`, name: 'P5 other', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const category = (
            await tx.serviceCategory.create({
              data: { code: `IT_P5_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
              select: { id: true },
            })
          ).id;
          const service = async (key: string) =>
            tx.service.create({
              data: {
                code: `IT_P5_${key}_${run}`,
                categoryId: category,
                nameVi: `Dịch vụ ${key}`,
                nameEn: `Service ${key}`,
                priceVnd: 1_000n,
                priceMaxVnd: 10_000_000n,
                pricingUnit: 'PER_SERVICE',
                maxQuantity: 1,
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
          type ServiceRow = Awaited<ReturnType<typeof service>>;
          const wide = await service('WIDE');
          const other = await service('OTHER');

          const customer = await user('CUSTOMER');
          const customer2 = await user('CUSTOMER');
          const customer3 = await user('CUSTOMER');
          const staff = await user('EMPLOYEE');
          const ktv = await user('EMPLOYEE');
          const today = (
            await tx.$queryRaw<
              { d: Date }[]
            >`SELECT lucy_branch_local_date(${branch}::uuid, now()) AS d`
          )[0]!.d;
          const todayText = today.toISOString().slice(0, 10);

          // ---------------------------------------------------------- invoice fixtures (Phase 4 shapes)
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
          }
          const completedVisit = async (
            services: ServiceRow[],
            branchId = branch,
          ): Promise<VisitFixture> => {
            visitSequence += 1;
            const visit = await tx.visit.create({
              data: {
                code: `VS-P5-${run}-${visitSequence}`,
                branchId,
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
            const done: VisitFixture['done'] = [];
            for (const [index, row] of services.entries()) {
              const start = slotStart();
              const line = await tx.visitServiceLine.create({
                data: {
                  visitId: visit.id,
                  participantId: participant.id,
                  sequence: index + 1,
                  serviceId: row.id,
                  employeeUserId: ktv,
                  assignmentMode: 'ANY',
                  plannedStartAt: start,
                  plannedEndAt: new Date(start.getTime() + 10 * 60_000),
                  durationMinutes: 10,
                  bufferMinutes: 0,
                  ...snapshotOf(row),
                },
                select: { id: true },
              });
              done.push({ id: line.id, service: row });
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
            return { id: visit.id, participantId: participant.id, done };
          };
          interface InvoiceFixture {
            id: string;
            visitId: string;
            lines: { id: string; service: ServiceRow }[];
          }
          /** A priced DRAFT invoice with one line per performed service. */
          const draft = async (
            visit: VisitFixture,
            options: { payer?: string | null; branchId?: string; price?: bigint } = {},
          ): Promise<InvoiceFixture> => {
            const invoice = await tx.invoice.create({
              data: {
                code: generateInvoiceCode(todayText),
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
              const price = options.price ?? 500_000n;
              const line = await tx.invoiceLine.create({
                data: {
                  invoiceId: invoice.id,
                  sequence: index + 1,
                  itemCode: entry.service.code,
                  nameVi: entry.service.nameVi,
                  nameEn: entry.service.nameEn,
                  quantity: 1,
                  unitPriceVnd: price,
                  grossVnd: price,
                  priceSetByUserId: staff,
                  priceSetAt: await dbNow(),
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
              lines.push({ id: line.id, service: entry.service });
            }
            return { id: invoice.id, visitId: visit.id, lines };
          };
          const finalize = async (invoice: InvoiceFixture) => {
            const sum = await tx.invoiceLine.aggregate({
              where: { invoiceId: invoice.id },
              _sum: { grossVnd: true },
            });
            const total = sum._sum.grossVnd ?? 0n;
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: 'PENDING_PAYMENT',
                subtotalVnd: total,
                totalVnd: total,
                finalizedAt: await dbNow(),
                finalizedByUserId: staff,
                rowVersion: { increment: 1 },
              },
            });
            await settle();
            return total;
          };
          /** A finalized invoice that is then fully paid in cash (paid episode 1). */
          const paidInvoice = async (
            payer: string | null,
            options: { service?: ServiceRow; branchId?: string } = {},
          ): Promise<InvoiceFixture & { total: bigint }> => {
            const branchId = options.branchId ?? branch;
            const visit = await completedVisit([options.service ?? wide], branchId);
            const invoice = await draft(visit, { payer, branchId });
            const total = await finalize(invoice);
            await tx.payment.create({
              data: {
                invoiceId: invoice.id,
                branchId,
                method: 'CASH',
                status: 'SUCCEEDED',
                amountDueVnd: total,
                amountVnd: total,
                tenderedVnd: total,
                changeVnd: 0n,
                collectedByUserId: staff,
                idempotencyKey: randomUUID(),
              },
            });
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: 'PAID',
                paidAt: await dbNow(),
                paidSeq: { increment: 1 },
                rowVersion: { increment: 1 },
              },
            });
            await settle();
            return { ...invoice, total };
          };
          /** A finalized, unpaid invoice (PENDING_PAYMENT) for one performed service. */
          const unpaidInvoice = async (
            service: ServiceRow = wide,
            payer: string | null = null,
            branchId = branch,
          ) => {
            const visit = await completedVisit([service], branchId);
            const invoice = await draft(visit, { payer, branchId });
            await finalize(invoice);
            return { ...invoice, visit };
          };
          const cancelUnpaid = async (invoiceId: string) => {
            await tx.invoice.update({
              where: { id: invoiceId },
              data: {
                status: 'CANCELLED',
                cancelledAt: await dbNow(),
                cancelledByUserId: staff,
                cancelledFromStatus: 'PENDING_PAYMENT',
                cancelReason: 'Khách không thanh toán',
                rowVersion: { increment: 1 },
              },
            });
          };

          // ---------------------------------------------------------- loyalty helpers
          const wallet = async (userId: string, kind: 'SPA' | 'BEAUTY' = 'SPA') =>
            tx.loyaltyWalletAccount.upsert({
              where: { userId_wallet: { userId, wallet: kind } },
              create: { userId, wallet: kind },
              update: {},
            });
          const bump = async (userId: string, delta: number, kind: 'SPA' | 'BEAUTY' = 'SPA') =>
            tx.loyaltyWalletAccount.update({
              where: { userId_wallet: { userId, wallet: kind } },
              data: { balancePoints: { increment: delta }, rowVersion: { increment: 1 } },
            });
          const balanceOf = async (userId: string, kind: 'SPA' | 'BEAUTY' = 'SPA') =>
            (
              await tx.loyaltyWalletAccount.findUniqueOrThrow({
                where: { userId_wallet: { userId, wallet: kind } },
                select: { balancePoints: true },
              })
            ).balancePoints;
          const earn = async (
            userId: string,
            invoiceId: string,
            points: number,
            paidSeq = 1,
            key = `SPA_EARN:${invoiceId}:${paidSeq}`,
          ) =>
            tx.loyaltyLedgerEntry.create({
              data: {
                userId,
                wallet: 'SPA',
                kind: 'EARN',
                points,
                invoiceId,
                paidSeq,
                idempotencyKey: key,
              },
              select: { id: true },
            });
          const manual = async (userId: string, points: number, reason = 'Điều chỉnh thử') =>
            tx.loyaltyLedgerEntry.create({
              data: {
                userId,
                wallet: 'SPA',
                kind: 'MANUAL_ADJUSTMENT',
                points,
                reason,
                actorUserId: staff,
                idempotencyKey: randomUUID(),
              },
              select: { id: true },
            });

          // Paid BEFORE go-live (the switch row is inserted later, so its instant is after this payment).
          const oldPayer = await user('CUSTOMER');
          const oldPaid = await paidInvoice(oldPayer);

          // ====================================================================== ships empty
          await context.test('every new table is empty after the migrations', async () => {
            for (const table of NEW_TABLES) {
              const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
                `SELECT count(*)::bigint AS n FROM ${table}`,
              );
              assert.equal(rows[0]!.n, 0n, `${table} must start empty (no seed data, no backfill)`);
            }
          });

          // ====================================================================== permissions
          await context.test(
            'permissions: eleven codes, semantics enforced in SQL, nothing granted',
            async () => {
              const labels = (
                await tx.$queryRaw<
                  { labels: string[] }[]
                >`SELECT enum_range(NULL::"PermissionCode")::text[] AS labels`
              )[0]?.labels;
              for (const code of PHASE5_CODES) {
                assert.ok(labels?.includes(code), code);
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
              }
              await syncPermissionCatalog(tx);
              const rows = await tx.permission.findMany({
                where: { code: { in: [...PHASE5_CODES] } },
                select: { code: true, scopeCapability: true, dataClassification: true },
              });
              assert.equal(rows.length, 11);
              for (const row of rows) {
                assert.equal(
                  row.scopeCapability,
                  GLOBAL_ONLY_CODES.includes(row.code) ? 'GLOBAL_ONLY' : 'BRANCH_CAPABLE',
                  row.code,
                );
                assert.equal(
                  row.dataClassification,
                  FINANCIAL_CODES.includes(row.code) ? 'FINANCIAL' : 'STANDARD',
                  row.code,
                );
              }
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
              await wrong('ADJUST_LOYALTY_POINTS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('ADJUST_LOYALTY_POINTS', 'GLOBAL_ONLY', 'STANDARD');
              await wrong('RESTORE_COMBO_SESSIONS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('MANAGE_COMBOS', 'BRANCH_CAPABLE', 'STANDARD');
              await wrong('MANAGE_REWARD_CATALOG', 'BRANCH_CAPABLE', 'STANDARD');
              await wrong('VIEW_LOYALTY', 'GLOBAL_ONLY', 'STANDARD');
              await wrong('SELL_COMBOS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('CONSUME_COMBO_SESSIONS', 'GLOBAL_ONLY', 'STANDARD');
              // Earlier semantics are unchanged.
              await wrong('MANAGE_DISCOUNTS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('VIEW_INVOICES', 'BRANCH_CAPABLE', 'STANDARD');
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    "UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'MANAGE_COMBOS'",
                  ),
                /code-owned and immutable/,
              );
              // A GLOBAL_ONLY code is overridden at GLOBAL scope only; branch-capable ones can be granted at a branch.
              const catalog = new Map(
                (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                  row.code,
                  row.id,
                ]),
              );
              const grantee = await user('EMPLOYEE');
              for (const code of GLOBAL_ONLY_CODES) {
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
              }
              await tx.userPermissionOverride.create({
                data: {
                  userId: grantee,
                  permissionId: catalog.get('SELL_COMBOS')!,
                  effect: 'ALLOW',
                  scopeKind: 'BRANCH',
                  branchId: branch,
                },
              });
              assert.equal(
                await tx.rolePermission.count({
                  where: { permission: { code: { in: [...PHASE5_CODES] } } },
                }),
                0,
                'no role receives a Phase 5 permission by default',
              );
            },
          );

          // ============================================================ ACTIVATE_LOYALTY (P5-3, Owner only)
          await context.test(
            'ACTIVATE_LOYALTY: GLOBAL_ONLY, never carried by a role or an override',
            async () => {
              await syncPermissionCatalog(tx);
              const permission = await tx.permission.findUniqueOrThrow({
                where: { code: 'ACTIVATE_LOYALTY' },
              });
              assert.equal(permission.scopeCapability, 'GLOBAL_ONLY');
              assert.equal(permission.dataClassification, 'STANDARD');
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'ACTIVATE_LOYALTY'`,
                  ),
                /code-owned and immutable/,
              );
              const role = await tx.role.create({
                data: {
                  code: `P53_OWNER_ONLY_${randomUUID().slice(0, 8).toUpperCase()}`,
                  displayNameVi: 'x',
                  displayNameEn: 'x',
                },
              });
              await rejects(
                () =>
                  tx.rolePermission.create({
                    data: { roleId: role.id, permissionId: permission.id },
                  }),
                /belongs to the Owner and cannot be granted/,
              );
              const grantee = await user('EMPLOYEE');
              await rejects(
                () =>
                  tx.userPermissionOverride.create({
                    data: {
                      userId: grantee,
                      permissionId: permission.id,
                      effect: 'ALLOW',
                      scopeKind: 'GLOBAL',
                    },
                  }),
                /belongs to the Owner and cannot be granted/,
              );
              // Any other global-only code is still grantable at GLOBAL scope (the rule is specific).
              const other = await tx.permission.findUniqueOrThrow({
                where: { code: 'VIEW_LOYALTY_EXCEPTIONS' },
              });
              await tx.rolePermission.create({ data: { roleId: role.id, permissionId: other.id } });
            },
          );

          // ============================================================ CHANGE_REFERRER (P5-5, Owner only)
          await context.test(
            'CHANGE_REFERRER: GLOBAL_ONLY, never carried by a role or an override',
            async () => {
              await syncPermissionCatalog(tx);
              const permission = await tx.permission.findUniqueOrThrow({
                where: { code: 'CHANGE_REFERRER' },
              });
              assert.equal(permission.scopeCapability, 'GLOBAL_ONLY');
              assert.equal(permission.dataClassification, 'STANDARD');
              const role = await tx.role.create({
                data: {
                  code: `P55_OWNER_ONLY_${randomUUID().slice(0, 8).toUpperCase()}`,
                  displayNameVi: 'x',
                  displayNameEn: 'x',
                },
              });
              await rejects(
                () =>
                  tx.rolePermission.create({
                    data: { roleId: role.id, permissionId: permission.id },
                  }),
                /belongs to the Owner and cannot be granted/,
              );
              const grantee = await user('EMPLOYEE');
              await rejects(
                () =>
                  tx.userPermissionOverride.create({
                    data: {
                      userId: grantee,
                      permissionId: permission.id,
                      effect: 'ALLOW',
                      scopeKind: 'GLOBAL',
                    },
                  }),
                /belongs to the Owner and cannot be granted/,
              );
            },
          );

          // ============================================================ canonical phone of a participant (P5-T10)
          await context.test(
            'lucy_phone_canonical: the SQL twin of normalizePhone for matching participant phones',
            async () => {
              const canonical = async (input: string | null) =>
                (
                  await tx.$queryRaw<
                    { c: string | null }[]
                  >`SELECT lucy_phone_canonical(${input}) AS c`
                )[0]!.c;
              assert.equal(await canonical('0912 345 678'), '+84912345678');
              assert.equal(await canonical('(091) 234-5678'), '+84912345678');
              assert.equal(await canonical('0084912345678'), '+84912345678');
              assert.equal(await canonical('+84 912.345.678'), '+84912345678');
              assert.equal(await canonical('+1 (415) 555-2671'), '+14155552671');
              for (const bad of [
                null,
                '',
                'abc',
                '00123456',
                '+840912345678',
                '12345',
                'x0912345678',
              ]) {
                assert.equal(await canonical(bad), null, String(bad));
              }
            },
          );

          // ====================================================================== go-live (OFF by default)
          await context.test(
            'the go-live switch is OFF by default and gates every customer fact',
            async () => {
              assert.equal(await tx.loyaltyGoLive.count(), 0, 'no row means OFF');
              const off = /Loyalty is not live: the go-live switch is off/;
              await rejects(() => wallet(customer), off);
              // P5-5 (Owner decision): a referral may be BOUND while go-live is OFF (the guard is relaxed for binding only);
              // the award, its ledger entries and everything else still need go-live ON.
              const earlyReferred = await user('CUSTOMER');
              const early = await tx.referral.create({
                data: {
                  referredUserId: earlyReferred,
                  referrerUserId: customer2,
                  boundVia: 'SIGNUP',
                },
                select: { id: true },
              });
              const unpaidEarly = await unpaidInvoice(wide, earlyReferred);
              await rejects(
                () =>
                  tx.referral.update({
                    where: { id: early.id },
                    data: {
                      awardedAt: new Date(),
                      awardedInvoiceId: unpaidEarly.id,
                      awardedPaidSeq: 1,
                    },
                  }),
                off,
              );
              // Configuration is allowed before go-live (definitions and catalog items).
              const comboId = (
                await tx.combo.create({
                  data: { code: `OFF_${run}`, serviceId: wide.id, createdByUserId: staff },
                  select: { id: true },
                })
              ).id;
              await tx.comboVersion.create({
                data: {
                  comboId,
                  version: 1,
                  nameVi: 'Combo',
                  nameEn: 'Combo',
                  paidSessions: 5,
                  bonusSessions: 1,
                  priceVnd: 1_000_000n,
                  active: true,
                  createdByUserId: staff,
                },
              });
              const itemId = (
                await tx.rewardCatalogItem.create({
                  data: {
                    code: `OFF_${run}`,
                    kind: 'FREE_SERVICE',
                    serviceId: wide.id,
                    nameVi: 'Quà',
                    nameEn: 'Gift',
                    createdByUserId: staff,
                  },
                  select: { id: true },
                })
              ).id;
              await rejects(
                () =>
                  tx.rewardEntitlement.create({
                    data: {
                      ownerUserId: customer,
                      catalogItemId: itemId,
                      sourceKind: 'CAMPAIGN',
                      quantityIssued: 1,
                    },
                  }),
                off,
              );
              // Purchases, consumptions and redemptions are gated too (checked before any other rule).
              const paid = await paidInvoice(customer);
              const versionId = (await tx.comboVersion.findFirstOrThrow({ where: { comboId } })).id;
              await rejects(
                () =>
                  tx.comboPurchase.create({
                    data: {
                      comboId,
                      versionId,
                      ownerUserId: customer,
                      invoiceLineId: paid.lines[0]!.id,
                      paidSeq: 1,
                      serviceId: wide.id,
                      nameVi: 'Combo',
                      nameEn: 'Combo',
                      paidSessions: 5,
                      bonusSessions: 1,
                      priceVnd: 1_000_000n,
                      expiryMode: 'NONE',
                    },
                  }),
                off,
              );
              await rejects(
                () =>
                  tx.invoiceLoyaltySnapshot.create({
                    data: {
                      invoiceId: paid.id,
                      payerUserId: customer,
                      wallet: 'SPA',
                      balanceBefore: 0,
                      tier: 'NONE',
                      tierTableVersion: 1,
                      memberDiscountBp: 0,
                      calculationVersion: 2,
                      eligibleSpaVnd: paid.total,
                      candidates: [],
                    },
                  }),
                off,
              );
            },
          );

          await context.test(
            'go-live is a single immutable row stamped with the database clock',
            async () => {
              const before = await dbNow();
              const backdated = new Date('2020-01-01T00:00:00Z');
              const row = await tx.loyaltyGoLive.create({
                data: { goLiveAt: backdated, activatedByUserId: staff },
                select: { goLiveAt: true },
              });
              assert.ok(
                row.goLiveAt.getTime() >= before.getTime(),
                'a backdated instant is overwritten (no backfill)',
              );
              await rejects(
                () => tx.loyaltyGoLive.create({ data: { activatedByUserId: staff } }),
                /loyalty_go_live_pkey|Unique constraint|duplicate key/,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `INSERT INTO loyalty_go_live (id, activated_by_user_id) VALUES (2, '${staff}')`,
                  ),
                /loyalty_go_live_singleton/,
              );
              await rejects(
                () => tx.loyaltyGoLive.update({ where: { id: 1 }, data: { goLiveAt: backdated } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.loyaltyGoLive.delete({ where: { id: 1 } }),
                /cannot be removed or rewritten/,
              );
              await truncateRejected('loyalty_go_live');
            },
          );

          // ====================================================================== wallets and ledger
          await context.test(
            'wallets: customer accounts only, start at 0, never negative, version steps',
            async () => {
              await rejects(() => wallet(staff), /belongs to a customer account/);
              await rejects(
                () =>
                  tx.loyaltyWalletAccount.create({
                    data: { userId: customer, wallet: 'SPA', balancePoints: 5 },
                  }),
                /starts at 0 points/,
              );
              const created = await wallet(customer);
              assert.equal(created.balancePoints, 0);
              assert.equal(created.rowVersion, 1);
              await wallet(customer, 'BEAUTY'); // the two wallets are independent rows
              await rejects(
                () =>
                  tx.loyaltyWalletAccount.update({
                    where: { userId_wallet: { userId: customer, wallet: 'SPA' } },
                    data: { balancePoints: -1, rowVersion: { increment: 1 } },
                  }),
                /loyalty_wallets_balance/,
              );
              await rejects(
                () =>
                  tx.loyaltyWalletAccount.update({
                    where: { userId_wallet: { userId: customer, wallet: 'SPA' } },
                    data: { balancePoints: 0 },
                  }),
                /advance its version by one/,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE loyalty_wallets SET wallet = 'SPA', user_id = '${customer2}', row_version = row_version + 1
                   WHERE user_id = '${customer}' AND wallet = 'BEAUTY'`,
                  ),
                /identity is immutable/,
              );
              await rejects(
                () =>
                  tx.loyaltyWalletAccount.delete({
                    where: { userId_wallet: { userId: customer, wallet: 'SPA' } },
                  }),
                /never deleted/,
              );
              await truncateRejected('loyalty_wallets');
            },
          );

          await context.test(
            'earn: payer of a paid invoice at the current episode, balance equals the ledger',
            async () => {
              const invoice = await paidInvoice(customer);
              await wallet(customer);
              // Wrong episode, wrong user, guest payer.
              await rejects(
                () => earn(customer, invoice.id, 500, 2),
                /current paid episode of a paid invoice/,
              );
              await wallet(customer2);
              await rejects(
                () => earn(customer2, invoice.id, 500),
                /member payer of the invoice only/,
              );
              const guest = await paidInvoice(null);
              await rejects(
                () => earn(customer, guest.id, 500),
                /member payer of the invoice only/,
              );
              // An unpaid invoice earns nothing.
              const unpaid = await unpaidInvoice(wide, customer);
              await rejects(
                () => earn(customer, unpaid.id, 500),
                /current paid episode of a paid invoice/,
              );
              // Shape rules.
              await rejects(() => earn(customer, invoice.id, 0), /loyalty_ledger_entries_amounts/);
              await rejects(
                () => earn(customer, invoice.id, -5),
                /loyalty_ledger_entries_kind_shape/,
              );
              await rejects(
                () => earn(customer, invoice.id, 500, 1, '   '),
                /loyalty_ledger_entries_key/,
              );
              // The ledger without the matching cache update fails the commit-time balance check.
              await rejectsAtCommit(
                () => earn(customer, invoice.id, 500),
                /must equal the sum of its ledger entries/,
              );
              // With the cache updated in the same transaction it passes.
              await earn(customer, invoice.id, 500);
              await bump(customer, 500);
              await settle();
              assert.equal(await balanceOf(customer), 500);
              // Cache and ledger disagree the other way round.
              await rejectsAtCommit(
                () => bump(customer, 5),
                /must equal the sum of its ledger entries/,
              );
            },
          );

          await context.test(
            'earn, reversal, shortfall and correction keep the ledger permanent and balanced',
            async () => {
              const invoice = await paidInvoice(customer3);
              await wallet(customer3);
              const earned = await earn(customer3, invoice.id, 100);
              await bump(customer3, 100);
              await settle();
              assert.equal(await balanceOf(customer3), 100);
              // Idempotency: the same key (same invoice and episode) is refused.
              await rejects(
                () => earn(customer3, invoice.id, 100),
                /idempotency_key|Unique constraint/,
              );
              // A manual deduction leaves 40; the reversal of the 100 earn can only apply 40 (P5-Q5).
              await manual(customer3, -60);
              await bump(customer3, -60);
              await settle();
              const reversal = (points: number, shortfall: number, key = `REV:${earned.id}`) =>
                tx.loyaltyLedgerEntry.create({
                  data: {
                    userId: customer3,
                    wallet: 'SPA',
                    kind: 'EARN_REVERSAL',
                    points,
                    shortfallPoints: shortfall,
                    invoiceId: invoice.id,
                    paidSeq: 1,
                    reversesEntryId: earned.id,
                    idempotencyKey: key,
                  },
                  select: { id: true },
                });
              await rejects(
                () => reversal(-40, 0),
                /full earned amount \(applied plus shortfall\)/,
              );
              await rejects(
                () => reversal(-40, 70),
                /full earned amount \(applied plus shortfall\)/,
              );
              await rejects(
                () => reversal(40, 0),
                /full earned amount|loyalty_ledger_entries_kind_shape/,
              );
              const applied = await reversal(-40, 60);
              await bump(customer3, -40);
              await settle();
              assert.equal(await balanceOf(customer3), 0, 'the balance floors at 0');
              const stored = await tx.loyaltyLedgerEntry.findUniqueOrThrow({
                where: { id: applied.id },
              });
              assert.equal(stored.points, -40);
              assert.equal(stored.shortfallPoints, 60, 'the shortfall is recorded in the ledger');
              // One reversal per earn entry.
              await rejects(() => reversal(-40, 60, 'REV2'), /reverses_key|Unique constraint/);
              // A reversal must target the earn entry of the same wallet, invoice and episode.
              const otherInvoice = await paidInvoice(customer3);
              await rejects(
                () =>
                  tx.loyaltyLedgerEntry.create({
                    data: {
                      userId: customer3,
                      wallet: 'SPA',
                      kind: 'EARN_REVERSAL',
                      points: -1,
                      shortfallPoints: 99,
                      invoiceId: otherInvoice.id,
                      paidSeq: 1,
                      reversesEntryId: earned.id,
                      idempotencyKey: 'REV3',
                    },
                  }),
                /earn entry of the same wallet and paid episode/,
              );
              // A zero-applied reversal is representable (balance already 0, everything is shortfall).
              const second = await earn(customer3, otherInvoice.id, 30);
              await bump(customer3, 30);
              await manual(customer3, -30);
              await bump(customer3, -30);
              await settle();
              const zero = await tx.loyaltyLedgerEntry.create({
                data: {
                  userId: customer3,
                  wallet: 'SPA',
                  kind: 'EARN_REVERSAL',
                  points: 0,
                  shortfallPoints: 30,
                  invoiceId: otherInvoice.id,
                  paidSeq: 1,
                  reversesEntryId: second.id,
                  idempotencyKey: 'REV-ZERO',
                },
                select: { id: true },
              });
              await settle();
              assert.equal(await balanceOf(customer3), 0);
              assert.ok(zero.id);
              // Manual adjustment and correction rules (reason, actor, link, one correction per effect).
              await rejects(
                () => manual(customer3, 10, '   '),
                /loyalty_ledger_entries_kind_shape/,
              );
              await rejects(
                () =>
                  tx.loyaltyLedgerEntry.create({
                    data: {
                      userId: customer3,
                      wallet: 'SPA',
                      kind: 'MANUAL_ADJUSTMENT',
                      points: 5,
                      reason: 'x',
                      idempotencyKey: 'NOACTOR',
                    },
                  }),
                /loyalty_ledger_entries_kind_shape/,
              );
              const mistake = await manual(customer3, 500, 'Nhầm tay');
              await bump(customer3, 500);
              const correct = (key: string) =>
                tx.loyaltyLedgerEntry.create({
                  data: {
                    userId: customer3,
                    wallet: 'SPA',
                    kind: 'MANUAL_CORRECTION',
                    points: -500,
                    reason: 'Sửa nhầm',
                    actorUserId: staff,
                    correctsEntryId: mistake.id,
                    idempotencyKey: key,
                  },
                  select: { id: true },
                });
              await correct('FIX-1');
              await bump(customer3, -500);
              await settle();
              await rejects(() => correct('FIX-2'), /corrects_key|Unique constraint/);
              // Entries of the other wallet cannot be corrected from this one.
              await wallet(customer3, 'BEAUTY');
              await rejects(
                () =>
                  tx.loyaltyLedgerEntry.create({
                    data: {
                      userId: customer3,
                      wallet: 'BEAUTY',
                      kind: 'MANUAL_CORRECTION',
                      points: -1,
                      reason: 'x',
                      actorUserId: staff,
                      correctsEntryId: second.id,
                      idempotencyKey: 'FIX-4',
                    },
                  }),
                /another entry of the same wallet/,
              );
              // Permanent history.
              await rejects(
                () =>
                  tx.loyaltyLedgerEntry.update({ where: { id: earned.id }, data: { points: 1 } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.loyaltyLedgerEntry.delete({ where: { id: earned.id } }),
                /cannot be removed or rewritten/,
              );
              await truncateRejected('loyalty_ledger_entries');
            },
          );

          await context.test(
            'no points for an invoice paid before go-live (P5-Q1 backfill guard)',
            async () => {
              await wallet(oldPayer);
              const live = (await tx.loyaltyGoLive.findUniqueOrThrow({ where: { id: 1 } }))
                .goLiveAt;
              assert.ok(oldPaid.id);
              const paidAt = (await tx.invoice.findUniqueOrThrow({ where: { id: oldPaid.id } }))
                .paidAt!;
              assert.ok(
                paidAt.getTime() < live.getTime(),
                'the fixture invoice was paid before go-live',
              );
              await rejects(() => earn(oldPayer, oldPaid.id, 500), /paid before go-live/);
            },
          );

          // ====================================================================== referrals
          await context.test(
            'referrals: customers only, permanent, one award with a Spa and a Beauty entry',
            async () => {
              const a = await user('CUSTOMER');
              const b = await user('CUSTOMER');
              const c = await user('CUSTOMER');
              await rejects(
                () =>
                  tx.referral.create({
                    data: { referredUserId: a, referrerUserId: a, boundVia: 'SIGNUP' },
                  }),
                /referrals_distinct/,
              );
              await rejects(
                () =>
                  tx.referral.create({
                    data: { referredUserId: a, referrerUserId: staff, boundVia: 'SIGNUP' },
                  }),
                /referrer is a customer account/,
              );
              await rejects(
                () =>
                  tx.referral.create({
                    data: { referredUserId: staff, referrerUserId: a, boundVia: 'SIGNUP' },
                  }),
                /referred person is a customer account/,
              );
              await rejects(
                () =>
                  tx.referral.create({
                    data: { referredUserId: b, referrerUserId: a, boundVia: 'COUNTER' },
                  }),
                /referrals_bound_by/,
              );
              await rejects(
                () =>
                  tx.referral.create({
                    data: {
                      referredUserId: b,
                      referrerUserId: a,
                      boundVia: 'SIGNUP',
                      boundByUserId: staff,
                    },
                  }),
                /referrals_bound_by/,
              );
              const referral = await tx.referral.create({
                data: {
                  referredUserId: b,
                  referrerUserId: a,
                  boundVia: 'COUNTER',
                  boundByUserId: staff,
                },
                select: { id: true },
              });
              // Permanent: one referrer per referred customer, never changed, never deleted.
              await rejects(
                () =>
                  tx.referral.create({
                    data: { referredUserId: b, referrerUserId: c, boundVia: 'SIGNUP' },
                  }),
                /referrals_referred_key|Unique constraint/,
              );
              // The referred person and the binding facts never change; the referrer changes only through an Owner history row.
              await rejects(
                () =>
                  tx.referral.update({ where: { id: referral.id }, data: { referredUserId: c } }),
                /relationship is permanent/,
              );
              await rejects(
                () =>
                  tx.referral.update({ where: { id: referral.id }, data: { referrerUserId: c } }),
                /referrer change needs its history row/,
              );
              await rejects(
                () => tx.referral.delete({ where: { id: referral.id } }),
                /cannot be removed or rewritten/,
              );
              // Owner correction before the award (Owner decision 2026-10-04): reason + history, Owner only.
              const ownerRow =
                (await tx.user.findFirst({ where: { kind: 'OWNER' } })) ??
                (await tx.user.create({
                  data: {
                    kind: 'OWNER',
                    status: 'ACTIVE',
                    fullName: 'Chủ spa fixture',
                    preferredLocale: 'vi',
                    emailCanonical: `p55-owner-${run.toLowerCase()}@example.com`,
                    emailDelivery: `p55-owner-${run.toLowerCase()}@example.com`,
                    normalizationVersion: 1,
                    passwordHash: '$argon2id$fixture',
                  },
                }));
              const change = (
                over: Partial<{
                  oldReferrerUserId: string;
                  newReferrerUserId: string;
                  actorUserId: string;
                  reason: string;
                }> = {},
              ) =>
                tx.referralChange.create({
                  data: {
                    referralId: referral.id,
                    oldReferrerUserId: a,
                    newReferrerUserId: c,
                    actorUserId: ownerRow.id,
                    reason: 'Khách nhập nhầm số',
                    ...over,
                  },
                  select: { id: true },
                });
              await rejects(
                () => change({ actorUserId: staff }),
                /Only the Owner changes a referrer/,
              );
              await rejects(
                () => change({ oldReferrerUserId: c }),
                /records the referrer that is current/,
              );
              await rejects(() => change({ newReferrerUserId: b }), /another customer account/);
              await rejects(() => change({ newReferrerUserId: staff }), /another customer account/);
              await rejects(() => change({ newReferrerUserId: a }), /referral_changes_distinct/);
              await rejects(() => change({ reason: '   ' }), /referral_changes_reason/);
              const changeRow = await change();
              await tx.referral.update({ where: { id: referral.id }, data: { referrerUserId: c } });
              assert.equal(
                (await tx.referral.findUniqueOrThrow({ where: { id: referral.id } }))
                  .referrerUserId,
                c,
              );
              // The history is append-only; a second change needs its own row and may go back.
              await rejects(
                () =>
                  tx.referralChange.update({ where: { id: changeRow.id }, data: { reason: 'x' } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.referralChange.delete({ where: { id: changeRow.id } }),
                /cannot be removed or rewritten/,
              );
              await truncateRejected('referral_changes');
              await change({ oldReferrerUserId: c, newReferrerUserId: a, reason: 'Sửa lại' });
              await tx.referral.update({ where: { id: referral.id }, data: { referrerUserId: a } });
              assert.equal(
                await tx.referralChange.count({ where: { referralId: referral.id } }),
                2,
              );
              await truncateRejected('referrals');
              // A chain A -> B -> C is allowed (B is referred and refers).
              const chain = await tx.referral.create({
                data: { referredUserId: c, referrerUserId: b, boundVia: 'SIGNUP' },
                select: { id: true },
              });
              assert.ok(chain.id);
              // The award needs a paid invoice at its current episode.
              const qualifying = await paidInvoice(b);
              const unpaid = await unpaidInvoice(wide, b);
              await rejects(
                () =>
                  tx.referral.update({
                    where: { id: referral.id },
                    data: { awardedAt: new Date(), awardedInvoiceId: unpaid.id, awardedPaidSeq: 1 },
                  }),
                /awarded for a paid invoice at its current paid episode/,
              );
              await rejects(
                () =>
                  tx.referral.update({
                    where: { id: referral.id },
                    data: { awardedAt: new Date() },
                  }),
                /awarded for a paid invoice|referrals_award_facts/,
              );
              await wallet(a, 'SPA');
              await wallet(a, 'BEAUTY');
              const award = (wallet_: 'SPA' | 'BEAUTY', user_ = a, points = 10) =>
                tx.loyaltyLedgerEntry.create({
                  data: {
                    userId: user_,
                    wallet: wallet_,
                    kind: 'REFERRAL_AWARD',
                    points,
                    referralId: referral.id,
                    idempotencyKey: `REFERRAL_AWARD:${referral.id}:${wallet_}`,
                  },
                  select: { id: true },
                });
              // An award entry for another user than the referrer is refused.
              await wallet(b, 'SPA');
              await rejects(() => award('SPA', b), /goes to the referrer of that referral/);
              // Stamped without entries, or with only one wallet, fails at commit.
              const stamp = () =>
                tx.referral.update({
                  where: { id: referral.id },
                  data: {
                    awardedAt: new Date(),
                    awardedInvoiceId: qualifying.id,
                    awardedPaidSeq: 1,
                  },
                });
              await rejectsAtCommit(stamp, /exactly one Spa and one Beauty award entry/);
              await rejectsAtCommit(async () => {
                await stamp();
                await award('SPA');
                await bump(a, 10, 'SPA');
              }, /exactly one Spa and one Beauty award entry/);
              await stamp();
              await award('SPA');
              await bump(a, 10, 'SPA');
              await award('BEAUTY');
              await bump(a, 10, 'BEAUTY');
              await settle();
              assert.equal(await balanceOf(a, 'SPA'), 10);
              assert.equal(await balanceOf(a, 'BEAUTY'), 10);
              // Once per referral and wallet; the award is stamped at most once.
              await rejects(
                () => award('SPA'),
                /referral_award_key|idempotency_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.referral.update({
                    where: { id: referral.id },
                    data: { awardedInvoiceId: qualifying.id, awardedPaidSeq: 2 },
                  }),
                /awarded at most once|referrals_award_facts/,
              );
              // Once the reward is granted the referrer is locked forever (Owner decision 2026-10-04).
              await rejects(() => change(), /locked once the reward has been granted/);
              await rejects(
                () =>
                  tx.referral.update({ where: { id: referral.id }, data: { referrerUserId: c } }),
                /locked once the reward has been granted/,
              );
              // Award entries cannot exist for an unawarded referral.
              await rejectsAtCommit(async () => {
                await tx.loyaltyLedgerEntry.create({
                  data: {
                    userId: b,
                    wallet: 'SPA',
                    kind: 'REFERRAL_AWARD',
                    points: 10,
                    referralId: chain.id,
                    idempotencyKey: `REFERRAL_AWARD:${chain.id}:SPA`,
                  },
                });
                await bump(b, 10, 'SPA');
              }, /exist only for an awarded referral/);
            },
          );

          // ====================================================================== tier snapshot
          await context.test(
            'tier snapshot: the locked table, identified payer, once, immutable',
            async () => {
              const payer = await user('CUSTOMER');
              const invoice = await unpaidInvoice(wide, payer);
              const snapshot = (overrides: Record<string, unknown> = {}) =>
                tx.invoiceLoyaltySnapshot.create({
                  data: {
                    invoiceId: invoice.id,
                    payerUserId: payer,
                    wallet: 'SPA',
                    balanceBefore: 980,
                    tier: 'SILVER',
                    tierTableVersion: 1,
                    memberDiscountBp: 300,
                    calculationVersion: 2,
                    eligibleSpaVnd: 500_000n,
                    candidates: { member: { tier: 'SILVER' }, programs: [] },
                    winnerSource: null,
                    selectionReason: null,
                    memberAmountVnd: 0n,
                    ...overrides,
                  },
                  select: { id: true },
                });
              for (const [tier, balance, bp] of [
                ['NONE', 499, 0],
                ['SILVER', 500, 300],
                ['SILVER', 999, 300],
                ['GOLD', 1000, 400],
                ['PLATINUM', 3000, 500],
                ['DIAMOND', 5000, 700],
                ['RUBY', 10000, 900],
              ] as const) {
                await rejects(
                  () =>
                    snapshot({
                      tier,
                      balanceBefore: balance,
                      memberDiscountBp: bp === 0 ? 300 : 0,
                    }),
                  /invoice_loyalty_snapshots_tier_v1/,
                );
              }
              await rejects(
                () => snapshot({ tier: 'GOLD', balanceBefore: 980 }),
                /invoice_loyalty_snapshots_tier_v1/,
              );
              await rejects(
                () => snapshot({ tier: 'SILVER', balanceBefore: 1000 }),
                /invoice_loyalty_snapshots_tier_v1/,
              );
              await rejects(
                () => snapshot({ tier: 'RUBY', balanceBefore: 9999, memberDiscountBp: 900 }),
                /invoice_loyalty_snapshots_tier_v1/,
              );
              await rejects(
                () => snapshot({ calculationVersion: 1 }),
                /invoice_loyalty_snapshots_values/,
              );
              await rejects(
                () => snapshot({ balanceBefore: -1 }),
                /invoice_loyalty_snapshots_values|tier_v1/,
              );
              await rejects(
                () => snapshot({ payerUserId: customer }),
                /member payer of its invoice/,
              );
              const guestInvoice = await unpaidInvoice(wide, null);
              await rejects(
                () => snapshot({ invoiceId: guestInvoice.id }),
                /identified member payer of its invoice/,
              );
              const stored = await snapshot();
              // A later table version is not constrained by version 1 (a new migration adds its own CHECK).
              await rejects(
                () => snapshot(),
                /invoice_loyalty_snapshots_invoice_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.invoiceLoyaltySnapshot.update({
                    where: { id: stored.id },
                    data: { balanceBefore: 1 },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.invoiceLoyaltySnapshot.delete({ where: { id: stored.id } }),
                /cannot be removed or rewritten/,
              );
              await truncateRejected('invoice_loyalty_snapshots');

              // P5-4: the member amount follows the tier percent (half up) and is the invoice discount only when it won.
              const memberWin = (overrides: Record<string, unknown> = {}) =>
                snapshot({
                  winnerSource: 'MEMBER_TIER',
                  selectionReason: 'MEMBER_ONLY_ELIGIBLE',
                  memberAmountVnd: 15_000n,
                  ...overrides,
                });
              const fresh = await unpaidInvoice(wide, payer);
              const tryOn = (overrides: Record<string, unknown>) =>
                memberWin({ invoiceId: fresh.id, ...overrides });
              await rejects(
                () => tryOn({ memberAmountVnd: 14_999n }),
                /invoice_loyalty_snapshots_member_amount/,
              );
              await rejects(
                () => tryOn({ memberAmountVnd: 0n }),
                /invoice_loyalty_snapshots_member_amount/,
              );
              await rejects(
                () => tryOn({ tier: 'NONE', balanceBefore: 100, memberDiscountBp: 0 }),
                /invoice_loyalty_snapshots_member_amount/,
              );
              await rejects(
                () => tryOn({ winnerSource: 'PROMOTION', memberAmountVnd: 15_000n }),
                /invoice_loyalty_snapshots_member_amount/,
              );
              await rejects(
                () => tryOn({ winnerSource: 'GIFT', memberAmountVnd: 0n }),
                /invoice_loyalty_snapshots_winner/,
              );
              // Half up to 1 VND: 3% of 10,017 = 300.51 -> 301.
              await rejects(
                () => tryOn({ eligibleSpaVnd: 10_017n, memberAmountVnd: 300n }),
                /invoice_loyalty_snapshots_member_amount/,
              );
              // A snapshot saying the member won must match the invoice header discount at commit (here the header is 0).
              await rejectsAtCommit(
                () => tryOn({}),
                /invoice discount total must equal its applied benefit/,
              );
              const cancelled = await unpaidInvoice(wide, payer);
              await cancelUnpaid(cancelled.id);
              await rejects(() => snapshot({ invoiceId: cancelled.id }), /never a cancelled one/);
            },
          );

          // ====================================================================== combos
          const makeCombo = async (
            serviceId: string,
            options: { paid?: number; bonus?: number; price?: bigint; expiryDays?: number } = {},
          ) => {
            const combo = await tx.combo.create({
              data: {
                code: `CB_${randomUUID().slice(0, 8)}_${run}`,
                serviceId,
                createdByUserId: staff,
              },
              select: { id: true },
            });
            const version = await tx.comboVersion.create({
              data: {
                comboId: combo.id,
                version: 1,
                nameVi: 'Mua 5 tặng 1',
                nameEn: 'Buy 5 get 1',
                paidSessions: options.paid ?? 5,
                bonusSessions: options.bonus ?? 1,
                priceVnd: options.price ?? 1_000_000n,
                active: true,
                createdByUserId: staff,
                ...(options.expiryDays
                  ? { expiryMode: 'DAYS_AFTER_ISSUE' as const, expiryDays: options.expiryDays }
                  : {}),
              },
              select: {
                id: true,
                nameVi: true,
                nameEn: true,
                paidSessions: true,
                bonusSessions: true,
                priceVnd: true,
                expiryMode: true,
              },
            });
            return { comboId: combo.id, version, serviceId };
          };
          type ComboFixture = Awaited<ReturnType<typeof makeCombo>>;
          const purchase = async (
            combo: ComboFixture,
            owner: string,
            lineId: string,
            paidSeq = 1,
            sessions: 'ALL' | 'NONE' | 'SHORT' = 'ALL',
          ) => {
            const row = await tx.comboPurchase.create({
              data: {
                comboId: combo.comboId,
                versionId: combo.version.id,
                ownerUserId: owner,
                invoiceLineId: lineId,
                paidSeq,
                serviceId: combo.serviceId,
                nameVi: combo.version.nameVi,
                nameEn: combo.version.nameEn,
                paidSessions: combo.version.paidSessions,
                bonusSessions: combo.version.bonusSessions,
                priceVnd: combo.version.priceVnd,
                expiryMode: combo.version.expiryMode,
              },
              select: { id: true, expiresAt: true },
            });
            const total = combo.version.paidSessions + combo.version.bonusSessions;
            const count = sessions === 'ALL' ? total : sessions === 'SHORT' ? total - 1 : 0;
            for (let no = 1; no <= count; no += 1) {
              await tx.comboSession.create({
                data: {
                  purchaseId: row.id,
                  sessionNo: no,
                  kind: no <= combo.version.paidSessions ? 'PAID' : 'BONUS',
                },
              });
            }
            return row;
          };
          const sessionsOf = async (purchaseId: string) =>
            tx.comboSession.findMany({
              where: { purchaseId },
              orderBy: { sessionNo: 'asc' },
              select: { id: true, kind: true },
            });
          const consume = (
            sessionId: string,
            lineId: string,
            options: {
              branchId?: string;
              usedBy?: 'OWNER' | 'RELATIVE';
              note?: string;
              recipient?: string;
              ktvUserId?: string;
            } = {},
          ) =>
            tx.comboSessionConsumption.create({
              data: {
                sessionId,
                invoiceLineId: lineId,
                branchId: options.branchId ?? branch,
                usedBy: options.usedBy ?? 'OWNER',
                relationshipNote: options.note ?? null,
                recipientParticipantId: options.recipient ?? null,
                ktvUserId: options.ktvUserId ?? ktv,
                performedByUserId: staff,
              },
              select: { id: true },
            });

          await context.test(
            'combo definitions: next version number, no expiry by default, append-only',
            async () => {
              const combo = await makeCombo(wide.id);
              await rejects(
                () =>
                  tx.comboVersion.create({
                    data: {
                      comboId: combo.comboId,
                      version: 3,
                      nameVi: 'a',
                      nameEn: 'a',
                      paidSessions: 1,
                      priceVnd: 1n,
                      active: true,
                      createdByUserId: staff,
                    },
                  }),
                /next number of its combo/,
              );
              const second = await tx.comboVersion.create({
                data: {
                  comboId: combo.comboId,
                  version: 2,
                  nameVi: 'Mua 10 tặng 2',
                  nameEn: 'Buy 10 get 2',
                  paidSessions: 10,
                  bonusSessions: 2,
                  priceVnd: 2_000_000n,
                  active: true,
                  createdByUserId: staff,
                },
                select: { id: true, expiryMode: true, expiryDays: true },
              });
              assert.equal(second.expiryMode, 'NONE');
              assert.equal(second.expiryDays, null);
              for (const bad of [
                { paidSessions: 0 },
                { bonusSessions: -1 },
                { priceVnd: 0n },
                { nameVi: '  ' },
                { expiryMode: 'DAYS_AFTER_ISSUE' as const },
                { expiryDays: 30 },
              ]) {
                await rejects(
                  () =>
                    tx.comboVersion.create({
                      data: {
                        comboId: combo.comboId,
                        version: 3,
                        nameVi: 'x',
                        nameEn: 'x',
                        paidSessions: 1,
                        priceVnd: 1n,
                        active: true,
                        createdByUserId: staff,
                        ...bad,
                      },
                    }),
                  /combo_versions_values|combo_versions_expiry/,
                );
              }
              await rejects(
                () => tx.comboVersion.update({ where: { id: second.id }, data: { active: false } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () =>
                  tx.combo.update({ where: { id: combo.comboId }, data: { serviceId: other.id } }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.combo.delete({ where: { id: combo.comboId } }),
                /cannot be removed or rewritten/,
              );
              await truncateRejected('combo_versions');
            },
          );

          await context.test(
            'combo purchase: paid episode, owner is the member payer, exact snapshot, exact sessions',
            async () => {
              const owner = await user('CUSTOMER');
              const combo = await makeCombo(wide.id);
              const guestPaid = await paidInvoice(null);
              await rejects(
                () => purchase(combo, owner, guestPaid.lines[0]!.id),
                /belongs to the member who paid for it/,
              );
              const unpaid = await unpaidInvoice(wide, owner);
              await rejects(
                () => purchase(combo, owner, unpaid.lines[0]!.id),
                /current paid episode of a paid invoice/,
              );
              const paid = await paidInvoice(owner);
              await rejects(
                () => purchase(combo, owner, paid.lines[0]!.id, 2),
                /current paid episode of a paid invoice/,
              );
              await rejects(
                () => purchase(combo, customer2, paid.lines[0]!.id),
                /belongs to the member who paid for it/,
              );
              // The snapshot must equal the active version exactly.
              await rejects(
                () =>
                  tx.comboPurchase.create({
                    data: {
                      comboId: combo.comboId,
                      versionId: combo.version.id,
                      ownerUserId: owner,
                      invoiceLineId: paid.lines[0]!.id,
                      paidSeq: 1,
                      serviceId: combo.serviceId,
                      nameVi: combo.version.nameVi,
                      nameEn: combo.version.nameEn,
                      paidSessions: 6,
                      bonusSessions: 0,
                      priceVnd: combo.version.priceVnd,
                      expiryMode: 'NONE',
                    },
                  }),
                /snapshots an active version exactly/,
              );
              // Sessions: missing or short fail at commit; the exact set passes and is numbered 1..n.
              await rejectsAtCommit(
                () => purchase(combo, owner, paid.lines[0]!.id, 1, 'SHORT'),
                /exactly its paid and bonus sessions/,
              );
              await rejectsAtCommit(
                () => purchase(combo, owner, paid.lines[0]!.id, 1, 'NONE'),
                /exactly its paid and bonus sessions/,
              );
              const good = await purchase(combo, owner, paid.lines[0]!.id, 1, 'ALL');
              await settle();
              const sessions = await sessionsOf(good.id);
              assert.equal(sessions.length, 6);
              assert.equal(sessions.filter((entry) => entry.kind === 'PAID').length, 5);
              assert.equal(sessions.filter((entry) => entry.kind === 'BONUS').length, 1);
              assert.equal(good.expiresAt, null, 'combos have no expiry (PRD 17.2)');
              await rejects(
                () => purchase(combo, owner, paid.lines[0]!.id),
                /line_episode_key|Unique constraint/,
              );
              await rejectsAtCommit(
                () =>
                  tx.comboSession.create({
                    data: { purchaseId: good.id, sessionNo: 7, kind: 'PAID' },
                  }),
                /exactly its paid and bonus sessions/,
              );
              await rejects(
                () =>
                  tx.comboSession.update({
                    where: { id: sessions[0]!.id },
                    data: { kind: 'BONUS' },
                  }),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.comboPurchase.delete({ where: { id: good.id } }),
                /never deleted/,
              );
              await truncateRejected('combo_purchases');
              // Void once, with reason and actor; nothing else changes.
              await rejects(
                () => tx.comboPurchase.update({ where: { id: good.id }, data: { priceVnd: 1n } }),
                /immutable apart from being voided once/,
              );
              await rejects(
                () =>
                  tx.comboPurchase.update({
                    where: { id: good.id },
                    data: { voidedAt: new Date(), voidedByUserId: staff },
                  }),
                /combo_purchases_void_facts/,
              );
              await tx.comboPurchase.update({
                where: { id: good.id },
                data: { voidedAt: new Date(), voidedByUserId: staff, voidReason: 'Hóa đơn bị đảo' },
              });
              await rejects(
                () =>
                  tx.comboPurchase.update({ where: { id: good.id }, data: { voidReason: 'Khác' } }),
                /voided combo purchase cannot change/,
              );
              // An inactive version cannot be sold; a configured expiry is computed from the issue instant.
              const dated = await makeCombo(wide.id, { expiryDays: 30 });
              const paid2 = await paidInvoice(owner);
              const expiring = await purchase(dated, owner, paid2.lines[0]!.id);
              assert.ok(expiring.expiresAt);
              const issued = await tx.comboPurchase.findUniqueOrThrow({
                where: { id: expiring.id },
                select: { issuedAt: true },
              });
              assert.equal(
                expiring.expiresAt!.getTime() - issued.issuedAt.getTime(),
                30 * 24 * 3600 * 1000,
              );
              await settle();
            },
          );

          await context.test(
            'combo consumption: own service, branch, one active use, release and restoration',
            async () => {
              const owner = await user('CUSTOMER');
              const combo = await makeCombo(wide.id, { paid: 2, bonus: 1 });
              const paid = await paidInvoice(owner);
              const bought = await purchase(combo, owner, paid.lines[0]!.id);
              await settle();
              const [first, second, bonus] = await sessionsOf(bought.id);
              assert.equal(bonus!.kind, 'BONUS');
              // A line for another service, or a line of another branch, cannot consume.
              const wrongService = await unpaidInvoice(other, owner);
              await rejects(
                () => consume(first!.id, wrongService.lines[0]!.id),
                /only for the service of its combo/,
              );
              const otherBranchInvoice = await unpaidInvoice(wide, owner, otherBranch);
              await rejects(
                () => consume(first!.id, otherBranchInvoice.lines[0]!.id),
                /records the branch of its invoice/,
              );
              const usage = await unpaidInvoice(wide, owner);
              // The KTV is an employee; a recipient belongs to the visit; a note is for a relative's use only.
              await rejects(
                () => consume(first!.id, usage.lines[0]!.id, { ktvUserId: customer2 }),
                /KTV of a consumption is an employee/,
              );
              await rejects(
                () => consume(first!.id, usage.lines[0]!.id, { recipient: randomUUID() }),
                /recipient belongs to the visit of the invoice/,
              );
              const strangerVisit = await completedVisit([wide]);
              await rejects(
                () =>
                  consume(first!.id, usage.lines[0]!.id, {
                    recipient: strangerVisit.participantId,
                  }),
                /recipient belongs to the visit of the invoice/,
              );
              await rejects(
                () => consume(first!.id, usage.lines[0]!.id, { note: 'Em gái' }),
                /combo_session_consumptions_note/,
              );
              const used = await consume(first!.id, usage.lines[0]!.id, {
                usedBy: 'RELATIVE',
                note: 'Em gái',
                recipient: usage.visit.participantId,
              });
              await settle();
              // One active use per session; one consumption per invoice line.
              const second_ = await unpaidInvoice(wide, owner);
              await rejects(() => consume(first!.id, second_.lines[0]!.id), /already consumed/);
              await rejects(
                () => consume(second!.id, usage.lines[0]!.id),
                /line_key|Unique constraint/,
              );
              // Not released while the invoice is open; a cancelled invoice must release (deferred).
              const reasonBase = { reason: 'Hóa đơn bị hủy', releasedByUserId: staff };
              await rejects(
                () =>
                  tx.comboSessionRelease.create({
                    data: {
                      consumptionId: used.id,
                      cause: 'INVOICE_CANCELLED_UNPAID',
                      ...reasonBase,
                    },
                  }),
                /released only when its invoice is cancelled/,
              );
              await rejectsAtCommit(
                () => cancelUnpaid(usage.id),
                /releases every combo session it consumed/,
              );
              await cancelUnpaid(usage.id);
              await rejects(
                () =>
                  tx.comboSessionRelease.create({
                    data: {
                      consumptionId: used.id,
                      cause: 'ZERO_BALANCE_CORRECTION',
                      ...reasonBase,
                    },
                  }),
                /cause must match how the invoice was cancelled/,
              );
              await rejects(
                () =>
                  tx.comboSessionRelease.create({
                    data: {
                      consumptionId: used.id,
                      cause: 'INVOICE_CANCELLED_UNPAID',
                      reason: '  ',
                      releasedByUserId: staff,
                    },
                  }),
                /combo_session_releases_reason/,
              );
              await tx.comboSessionRelease.create({
                data: { consumptionId: used.id, cause: 'INVOICE_CANCELLED_UNPAID', ...reasonBase },
              });
              await settle();
              await rejects(
                () =>
                  tx.comboSessionRelease.create({
                    data: {
                      consumptionId: used.id,
                      cause: 'INVOICE_CANCELLED_UNPAID',
                      ...reasonBase,
                    },
                  }),
                /consumption_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.comboSessionRelease.update({
                    where: { consumptionId: used.id },
                    data: { reason: 'x' },
                  }),
                /cannot be removed or rewritten/,
              );
              // After the release the session is free again, and a new line can consume it.
              const again = await unpaidInvoice(wide, owner);
              const reused = await consume(first!.id, again.lines[0]!.id);
              await settle();
              // Restoration (PRD 17.5): reason required, once, never for a released consumption.
              await rejects(
                () =>
                  tx.comboSessionRestoration.create({
                    data: { consumptionId: reused.id, restoredByUserId: staff, reason: ' ' },
                  }),
                /combo_session_restorations_reason/,
              );
              await rejects(
                () =>
                  tx.comboSessionRestoration.create({
                    data: { consumptionId: used.id, restoredByUserId: staff, reason: 'Nhầm' },
                  }),
                /released consumption cannot also be restored/,
              );
              await tx.comboSessionRestoration.create({
                data: {
                  consumptionId: reused.id,
                  restoredByUserId: staff,
                  reason: 'Ghi nhầm khách',
                },
              });
              await rejects(
                () =>
                  tx.comboSessionRestoration.create({
                    data: { consumptionId: reused.id, restoredByUserId: staff, reason: 'Lại' },
                  }),
                /consumption_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.comboSessionRelease.create({
                    data: {
                      consumptionId: reused.id,
                      cause: 'INVOICE_CANCELLED_UNPAID',
                      ...reasonBase,
                    },
                  }),
                /released only when its invoice is cancelled|restored consumption is not released again/,
              );
              await settle();
              // The restored session can be consumed once more; history stays.
              const third = await unpaidInvoice(wide, owner);
              await consume(first!.id, third.lines[0]!.id);
              await settle();
              assert.equal(
                await tx.comboSessionConsumption.count({ where: { sessionId: first!.id } }),
                3,
              );
              // A voided combo cannot be consumed.
              await tx.comboPurchase.update({
                where: { id: bought.id },
                data: { voidedAt: new Date(), voidedByUserId: staff, voidReason: 'Hóa đơn bị đảo' },
              });
              const fourth = await unpaidInvoice(wide, owner);
              await rejects(
                () => consume(second!.id, fourth.lines[0]!.id),
                /voided or expired combo cannot be consumed/,
              );
              await truncateRejected('combo_session_consumptions');
            },
          );

          // ====================================================================== rewards
          await context.test(
            'reward catalog and entitlements: empty framework, audited issue, derived quantity',
            async () => {
              const item = await tx.rewardCatalogItem.create({
                data: {
                  code: `RW_${run}`,
                  kind: 'FREE_SERVICE',
                  serviceId: wide.id,
                  nameVi: 'Dịch vụ tặng',
                  nameEn: 'Free service',
                  createdByUserId: staff,
                },
                select: { id: true, rowVersion: true },
              });
              assert.equal(item.rowVersion, 1);
              await rejects(
                () =>
                  tx.rewardCatalogItem.create({
                    data: {
                      code: `RX_${run}`,
                      kind: 'OTHER',
                      serviceId: wide.id,
                      nameVi: 'a',
                      nameEn: 'a',
                      createdByUserId: staff,
                    },
                  }),
                /reward_catalog_items_service/,
              );
              await rejects(
                () =>
                  tx.rewardCatalogItem.create({
                    data: {
                      code: `RY_${run}`,
                      kind: 'OTHER',
                      nameVi: 'a',
                      nameEn: 'a',
                      expiryMode: 'DAYS_AFTER_ISSUE',
                      createdByUserId: staff,
                    },
                  }),
                /reward_catalog_items_expiry/,
              );
              await rejects(
                () =>
                  tx.rewardCatalogItem.update({
                    where: { id: item.id },
                    data: { kind: 'OTHER', rowVersion: { increment: 1 } },
                  }),
                /identity is immutable/,
              );
              await tx.rewardCatalogItem.update({
                where: { id: item.id },
                data: { nameEn: 'Free service!', rowVersion: { increment: 1 } },
              });
              await rejects(
                () =>
                  tx.rewardCatalogItem.update({ where: { id: item.id }, data: { nameEn: 'x' } }),
                /advance its version by one/,
              );
              await rejects(
                () => tx.rewardCatalogItem.delete({ where: { id: item.id } }),
                /cannot be removed or rewritten/,
              );
              // Entitlement issue rules.
              const owner = await user('CUSTOMER');
              const issue = (overrides: Record<string, unknown> = {}) =>
                tx.rewardEntitlement.create({
                  data: {
                    ownerUserId: owner,
                    catalogItemId: item.id,
                    sourceKind: 'MANUAL',
                    quantityIssued: 2,
                    issuedByUserId: staff,
                    reason: 'Quà tri ân',
                    ...overrides,
                  },
                  select: { id: true, expiresAt: true },
                });
              await rejects(() => issue({ ownerUserId: staff }), /belongs to a customer account/);
              await rejects(() => issue({ issuedByUserId: null }), /reward_entitlements_manual/);
              await rejects(() => issue({ reason: null }), /reward_entitlements_manual/);
              await rejects(() => issue({ quantityIssued: 0 }), /reward_entitlements_values/);
              const entitlement = await issue();
              assert.equal(entitlement.expiresAt, null);
              const campaign = await issue({
                sourceKind: 'CAMPAIGN',
                issuedByUserId: null,
                reason: null,
                sourceReference: 'T10-2027',
              });
              assert.ok(campaign.id);
              await tx.rewardCatalogItem.update({
                where: { id: item.id },
                data: { active: false, rowVersion: { increment: 1 } },
              });
              await rejects(() => issue(), /issued from an active catalog item/);
              await tx.rewardCatalogItem.update({
                where: { id: item.id },
                data: { active: true, rowVersion: { increment: 1 } },
              });
              // Redemption: own service, branch, quantity, void, expiry; releases mirror Phase 4.
              const redeem = (entitlementId: string, lineId: string, branchId = branch) =>
                tx.rewardRedemption.create({
                  data: { entitlementId, invoiceLineId: lineId, branchId, redeemedByUserId: staff },
                  select: { id: true },
                });
              const a = await unpaidInvoice(wide, owner);
              const b = await unpaidInvoice(wide, owner);
              const c = await unpaidInvoice(wide, owner);
              const wrong = await unpaidInvoice(other, owner);
              await rejects(
                () => redeem(entitlement.id, wrong.lines[0]!.id),
                /redeemed only for its own service/,
              );
              const otherBranchInvoice = await unpaidInvoice(wide, owner, otherBranch);
              await rejects(
                () => redeem(entitlement.id, otherBranchInvoice.lines[0]!.id),
                /records the branch of its invoice/,
              );
              const r1 = await redeem(entitlement.id, a.lines[0]!.id);
              await redeem(entitlement.id, b.lines[0]!.id);
              await settle();
              await rejects(() => redeem(entitlement.id, c.lines[0]!.id), /no quantity left/);
              await rejects(
                () => redeem(entitlement.id, a.lines[0]!.id),
                /no quantity left|line_key|Unique constraint/,
              );
              // Cancelling the invoice must release the redemption (deferred), and capacity returns once.
              await rejectsAtCommit(() => cancelUnpaid(a.id), /releases every reward it redeemed/);
              await cancelUnpaid(a.id);
              await tx.rewardRedemptionRelease.create({
                data: {
                  redemptionId: r1.id,
                  cause: 'INVOICE_CANCELLED_UNPAID',
                  reason: 'Hóa đơn bị hủy',
                  releasedByUserId: staff,
                },
              });
              await settle();
              await rejects(
                () =>
                  tx.rewardRedemptionRelease.create({
                    data: {
                      redemptionId: r1.id,
                      cause: 'INVOICE_CANCELLED_UNPAID',
                      reason: 'Lại',
                      releasedByUserId: staff,
                    },
                  }),
                /redemption_key|Unique constraint/,
              );
              await redeem(entitlement.id, c.lines[0]!.id);
              await settle();
              await rejects(
                () =>
                  tx.rewardRedemption.update({
                    where: { id: r1.id },
                    data: { branchId: otherBranch },
                  }),
                /cannot be removed or rewritten/,
              );
              // Void once; a voided entitlement cannot be redeemed.
              await rejects(
                () =>
                  tx.rewardEntitlement.update({
                    where: { id: campaign.id },
                    data: { quantityIssued: 9 },
                  }),
                /immutable apart from being voided once/,
              );
              await tx.rewardEntitlement.update({
                where: { id: campaign.id },
                data: { voidedAt: new Date(), voidedByUserId: staff, voidReason: 'Phát nhầm' },
              });
              const d = await unpaidInvoice(wide, owner);
              await rejects(
                () => redeem(campaign.id, d.lines[0]!.id),
                /voided or expired entitlement cannot be redeemed/,
              );
              await rejects(
                () =>
                  tx.rewardEntitlement.update({
                    where: { id: campaign.id },
                    data: { voidReason: 'Khác' },
                  }),
                /voided entitlement cannot change/,
              );
              await rejects(
                () => tx.rewardEntitlement.delete({ where: { id: campaign.id } }),
                /cannot be removed or rewritten/,
              );
              // A configured expiry is computed from the issue instant and blocks redemption once passed.
              const dated = await tx.rewardCatalogItem.create({
                data: {
                  code: `RD_${run}`,
                  kind: 'FREE_SERVICE',
                  serviceId: wide.id,
                  nameVi: 'Có hạn',
                  nameEn: 'Expiring',
                  expiryMode: 'DAYS_AFTER_ISSUE',
                  expiryDays: 7,
                  createdByUserId: staff,
                },
                select: { id: true },
              });
              const expiring = await tx.rewardEntitlement.create({
                data: {
                  ownerUserId: owner,
                  catalogItemId: dated.id,
                  sourceKind: 'CAMPAIGN',
                  quantityIssued: 1,
                },
                select: { id: true, expiresAt: true, issuedAt: true },
              });
              assert.equal(
                expiring.expiresAt!.getTime() - expiring.issuedAt.getTime(),
                7 * 24 * 3600 * 1000,
              );
              await tx.$executeRawUnsafe('ALTER TABLE reward_entitlements DISABLE TRIGGER USER');
              await tx.$executeRawUnsafe(
                `UPDATE reward_entitlements SET expires_at = clock_timestamp() - interval '1 minute' WHERE id = '${expiring.id}'`,
              );
              await tx.$executeRawUnsafe('ALTER TABLE reward_entitlements ENABLE TRIGGER USER');
              const e = await unpaidInvoice(wide, owner);
              await rejects(
                () => redeem(expiring.id, e.lines[0]!.id),
                /voided or expired entitlement cannot be redeemed/,
              );
              await truncateRejected('reward_entitlements');
              await truncateRejected('reward_redemptions');
              await truncateRejected('reward_redemption_releases');
              await truncateRejected('reward_catalog_items');
            },
          );

          // ====================================================================== no business logic
          await context.test(
            'the foundation adds no business behavior to existing tables',
            async () => {
              // Invoices behave exactly as in Phase 4: a guest invoice finalizes and pays with no loyalty row.
              const guestInvoice = await paidInvoice(null);
              assert.ok(guestInvoice.id);
              assert.equal(
                await tx.loyaltyLedgerEntry.count({ where: { invoiceId: guestInvoice.id } }),
                0,
              );
            },
          );

          throw rollback;
        },
        { timeout: 300_000, maxWait: 30_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});
