import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, PERMISSION_CATALOG, syncPermissionCatalog } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const PHASE7_CODES = [
  ['MANAGE_PAY_RULES', 'GLOBAL_ONLY', 'EMPLOYEE_PAY'],
  ['MANAGE_PAYROLL', 'GLOBAL_ONLY', 'EMPLOYEE_PAY'],
  ['APPROVE_PAYROLL', 'GLOBAL_ONLY', 'EMPLOYEE_PAY'],
  ['VIEW_CASH', 'BRANCH_CAPABLE', 'FINANCIAL'],
  ['MANAGE_CASH', 'BRANCH_CAPABLE', 'FINANCIAL'],
] as const;
const PHASE7_TABLES = [
  'finance_go_live',
  'reauth_uses',
  'cash_funds',
  'fund_entries',
  'cash_day_closings',
] as const;

/**
 * Phase 7 P7-2 database foundation (design PHASE7_PAYROLL_FUNDS.md sections 7 and 9): the five permissions are in the catalog with the
 * right semantics and are granted to nobody, and the five tables exist empty and enforce their own rules (an immutable book, a locked
 * closed day, closing arithmetic, a single go-live instant, a confirmation spent once). All fixtures roll back.
 */
test('Phase 7 P7-2 permissions, tables and guards (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 7 foundation rollback');
  const run = randomUUID().slice(0, 8).toUpperCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              assert.match(String((error as Error).message), pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const rows = <T>(sql: string, ...params: unknown[]) =>
            tx.$queryRawUnsafe<T[]>(sql, ...params);
          const exec = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);

          await context.test(
            'the catalog has 79 codes; the five new ones have the right semantics',
            async () => {
              const labels = (
                await rows<{ labels: string[] }>(
                  `SELECT enum_range(NULL::"PermissionCode")::text[] AS labels`,
                )
              )[0]?.labels;
              for (const [code] of PHASE7_CODES) {
                assert.ok(labels?.includes(code), code);
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
              }
              assert.equal(PERMISSION_CATALOG.length, 79);
              await syncPermissionCatalog(tx);
              for (const [code, scope, classification] of PHASE7_CODES) {
                const stored = await tx.permission.findFirstOrThrow({
                  where: { code },
                  select: { scopeCapability: true, dataClassification: true },
                });
                assert.equal(stored.scopeCapability, scope, code);
                assert.equal(stored.dataClassification, classification, code);
              }
              assert.equal(await tx.permission.count(), 79);
            },
          );

          await context.test(
            'the catalog semantics refuse another scope or class for them',
            async () => {
              for (const [code, scope, classification] of [
                ['MANAGE_PAYROLL', 'BRANCH_CAPABLE', 'EMPLOYEE_PAY'],
                ['APPROVE_PAYROLL', 'GLOBAL_ONLY', 'STANDARD'],
                ['VIEW_CASH', 'GLOBAL_ONLY', 'FINANCIAL'],
                ['MANAGE_CASH', 'BRANCH_CAPABLE', 'STANDARD'],
                ['MANAGE_PAY_RULES', 'GLOBAL_ONLY', 'FINANCIAL'],
              ] as const) {
                await rejects(
                  () =>
                    exec(
                      `INSERT INTO permissions (id, code, scope_capability, data_classification)
                     VALUES (gen_random_uuid(), '${code}'::"PermissionCode", '${scope}'::"ScopeCapability", '${classification}'::"DataClassification")`,
                    ),
                  /permissions_catalog_semantics|duplicate key/,
                );
              }
            },
          );

          await context.test(
            'nobody holds the new permissions after the migration and the sync',
            async () => {
              const granted = await rows<{ count: bigint }>(
                `SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
               WHERE p.code IN ('MANAGE_PAY_RULES'::"PermissionCode", 'MANAGE_PAYROLL'::"PermissionCode", 'APPROVE_PAYROLL'::"PermissionCode",
                                'VIEW_CASH'::"PermissionCode", 'MANAGE_CASH'::"PermissionCode")`,
              );
              assert.equal(granted[0]?.count, 0n);
            },
          );

          await context.test('the five tables exist and start empty', async () => {
            for (const table of PHASE7_TABLES) {
              const found = await rows<{ count: bigint }>(
                `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`,
              );
              assert.equal(found[0]?.count, 1n, table);
              const content = await rows<{ count: bigint }>(`SELECT count(*) FROM "${table}"`);
              assert.equal(content[0]?.count, 0n, `${table} starts empty`);
            }
          });

          // ----- fixtures
          const person = await tx.user.create({
            data: {
              kind: 'OWNER',
              status: 'ACTIVE',
              fullName: 'P7 fixture',
              preferredLocale: 'vi',
              emailCanonical: `p7-${run.toLowerCase()}@example.com`,
              emailDelivery: `p7-${run.toLowerCase()}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
            },
          });
          const branch = await tx.branch.create({ data: { code: `P7A-${run}`, name: 'P7 A' } });
          const other = await tx.branch.create({ data: { code: `P7B-${run}`, name: 'P7 B' } });
          const instant = new Date('2026-10-12T02:00:00.000Z');
          const fund = async (kind: 'CASH' | 'BANK', branchId: string | null, opening = 0) => {
            const id = randomUUID();
            await exec(
              `INSERT INTO cash_funds (id, kind, branch_id, name, opening_balance_vnd, opening_at, opening_by_user_id)
               VALUES ($1::uuid, $2::"FundKind", $3::uuid, 'fixture', $4, $5, $6::uuid)`,
              id,
              kind,
              branchId,
              BigInt(opening),
              instant,
              person.id,
            );
            return id;
          };
          const entry = (
            fundId: string,
            branchId: string,
            date: string,
            direction: 'IN' | 'OUT',
            category: string,
            amount: number,
            extra: {
              sourceType?: string;
              sourceId?: string;
              leg?: number;
              reverses?: string;
              reason?: string;
              actor?: boolean;
            } = {},
          ) => {
            const id = randomUUID();
            return exec(
              `INSERT INTO fund_entries (id, fund_id, branch_id, business_date, direction, category, amount_vnd, source_type, source_id,
                 source_leg, reverses_entry_id, reason, actor_user_id)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::"FundDirection", $6::"FundEntryCategory", $7, $8, $9::uuid, $10, $11::uuid, $12, $13::uuid)`,
              id,
              fundId,
              branchId,
              date,
              direction,
              category,
              BigInt(amount),
              extra.sourceType ?? null,
              extra.sourceId ?? null,
              extra.leg ?? 0,
              extra.reverses ?? null,
              extra.reason ?? null,
              extra.actor ? person.id : null,
            ).then(() => id);
          };

          await context.test('go-live is a single row that never moves', async () => {
            await exec(
              `INSERT INTO finance_go_live (at, set_by_user_id, reauthenticated_at) VALUES ($1, $2::uuid, $1)`,
              instant,
              person.id,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO finance_go_live (id, at, set_by_user_id, reauthenticated_at) VALUES (2, $1, $2::uuid, $1)`,
                  instant,
                  person.id,
                ),
              /finance_go_live_single/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO finance_go_live (at, set_by_user_id, reauthenticated_at) VALUES ($1, $2::uuid, $1)`,
                  instant,
                  person.id,
                ),
              /duplicate key/,
            );
            await rejects(
              () => exec(`UPDATE finance_go_live SET at = at - interval '1 day'`),
              /append-only/,
            );
            await rejects(() => exec(`DELETE FROM finance_go_live`), /append-only/);
          });

          const cashA = await fund('CASH', branch.id, 1_000_000);
          const bank = await fund('BANK', null, 5_000_000);

          await context.test(
            'funds: one cash fund per branch, one bank fund, shapes, immutability',
            async () => {
              await rejects(() => fund('CASH', branch.id), /cash_funds_branch_key|duplicate key/);
              await rejects(() => fund('BANK', null), /cash_funds_one_bank_key|duplicate key/);
              await rejects(() => fund('CASH', null), /cash_funds_kind_branch/);
              await rejects(() => fund('BANK', other.id), /cash_funds_kind_branch/);
              await rejects(() => fund('CASH', other.id, -1), /cash_funds_opening_nonnegative/);
              await rejects(
                () =>
                  exec(`UPDATE cash_funds SET opening_balance_vnd = 1 WHERE id = $1::uuid`, cashA),
                /never change/,
              );
              await rejects(
                () => exec(`DELETE FROM cash_funds WHERE id = $1::uuid`, cashA),
                /never deleted/,
              );
              await exec(`UPDATE cash_funds SET name = 'renamed' WHERE id = $1::uuid`, cashA);
            },
          );

          await context.test(
            'entries: category and direction, fund branch, source idempotency, manual rules',
            async () => {
              const source = randomUUID();
              await entry(cashA, branch.id, '2026-10-12', 'IN', 'SALE_CASH', 100_000, {
                sourceType: 'PAYMENT',
                sourceId: source,
              });
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'IN', 'SALE_CASH', 100_000, {
                    sourceType: 'PAYMENT',
                    sourceId: source,
                  }),
                /fund_entries_source_key|duplicate key/,
              );
              // a different leg of the same source is a different movement
              await entry(cashA, branch.id, '2026-10-12', 'OUT', 'PAYMENT_REVERSAL', 100_000, {
                sourceType: 'PAYMENT',
                sourceId: source,
                leg: 1,
              });
              await rejects(
                () => entry(cashA, branch.id, '2026-10-12', 'OUT', 'SALE_CASH', 1),
                /money in/,
              );
              await rejects(
                () => entry(cashA, branch.id, '2026-10-12', 'IN', 'PRODUCT_REFUND', 1),
                /money out/,
              );
              await rejects(
                () => entry(cashA, branch.id, '2026-10-12', 'IN', 'SALE_BANK', 1),
                /bank sale goes to the bank/,
              );
              await rejects(
                () => entry(bank, other.id, '2026-10-12', 'IN', 'SALE_CASH', 1),
                /cash sale goes to a cash fund/,
              );
              await rejects(
                () => entry(cashA, other.id, '2026-10-12', 'IN', 'TIP_IN', 1),
                /belongs to the branch of its fund/,
              );
              await rejects(
                () => entry(cashA, branch.id, '2026-10-12', 'IN', 'TIP_IN', 0),
                /fund_entries_amount_positive/,
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'IN', 'TIP_IN', 1, { sourceType: 'TIP' }),
                /fund_entries_source_pair/,
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'OUT', 'MANUAL_EXPENSE', 5, {
                    actor: true,
                  }),
                /fund_entries_reason_required/,
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'OUT', 'MANUAL_EXPENSE', 5, {
                    reason: 'x',
                  }),
                /fund_entries_manual_actor/,
              );
              await entry(cashA, branch.id, '2026-10-12', 'OUT', 'MANUAL_EXPENSE', 5, {
                reason: 'nước uống',
                actor: true,
              });
              await entry(bank, branch.id, '2026-10-12', 'IN', 'SALE_BANK', 7);
            },
          );

          await context.test(
            'a correction reverses one earlier entry, once; entries are immutable',
            async () => {
              const first = await entry(
                cashA,
                branch.id,
                '2026-10-12',
                'IN',
                'MANUAL_INCOME',
                50_000,
                { reason: 'góp quỹ', actor: true },
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'OUT', 'CORRECTION', 49_000, {
                    reverses: first,
                    reason: 'sai',
                    actor: true,
                  }),
                /reverses one earlier entry/,
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'IN', 'CORRECTION', 50_000, {
                    reverses: first,
                    reason: 'sai',
                    actor: true,
                  }),
                /reverses one earlier entry/,
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'OUT', 'MANUAL_EXPENSE', 50_000, {
                    reverses: first,
                    reason: 'sai',
                    actor: true,
                  }),
                /fund_entries_correction_shape/,
              );
              const reversal = await entry(
                cashA,
                branch.id,
                '2026-10-12',
                'OUT',
                'CORRECTION',
                50_000,
                { reverses: first, reason: 'sai', actor: true },
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'OUT', 'CORRECTION', 50_000, {
                    reverses: first,
                    reason: 'lại',
                    actor: true,
                  }),
                /fund_entries_reverses_key|duplicate key/,
              );
              await rejects(
                () =>
                  entry(cashA, branch.id, '2026-10-12', 'IN', 'CORRECTION', 50_000, {
                    reverses: reversal,
                    reason: 'lại',
                    actor: true,
                  }),
                /reverses one earlier entry/,
              );
              await rejects(
                () => exec(`UPDATE fund_entries SET amount_vnd = 1 WHERE id = $1::uuid`, first),
                /append-only/,
              );
              await rejects(
                () => exec(`DELETE FROM fund_entries WHERE id = $1::uuid`, first),
                /append-only/,
              );
            },
          );

          await context.test(
            'closing: the numbers come from the book; the day is locked afterwards',
            async () => {
              // The book of 2026-10-12 so far (cash fund A): +100000 -100000 -5 +50000 -50000 = -5 on top of the 1,000,000 opening.
              const id = randomUUID();
              const closing = (over: Record<string, unknown> = {}) => {
                const v = {
                  date: '2026-10-12',
                  opening: 1_000_000,
                  cashIn: 150_000,
                  cashOut: 150_005,
                  expected: 999_995,
                  counted: 999_995,
                  difference: 0,
                  reason: null as string | null,
                  withdrawal: 0,
                  next: 999_995,
                  ...over,
                };
                return exec(
                  `INSERT INTO cash_day_closings (id, fund_id, branch_id, business_date, opening_float_vnd, cash_in_vnd, cash_out_vnd, expected_vnd,
                   counted_vnd, difference_vnd, reason, withdrawal_vnd, next_float_vnd, closed_by_user_id, reauthenticated_at, client_request_id)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15, $16::uuid)`,
                  over['id'] ?? id,
                  cashA,
                  branch.id,
                  v.date,
                  BigInt(v.opening),
                  BigInt(v.cashIn),
                  BigInt(v.cashOut),
                  BigInt(v.expected),
                  BigInt(v.counted),
                  BigInt(v.difference),
                  v.reason,
                  BigInt(v.withdrawal),
                  BigInt(v.next),
                  person.id,
                  instant,
                  randomUUID(),
                );
              };
              await rejects(() => closing({ cashIn: 1 }), /expected|does not match the book/);
              await rejects(
                () => closing({ counted: 900_000 }),
                /cash_day_closings_difference|cash_day_closings_next_float/,
              );
              await rejects(
                () => closing({ withdrawal: 10, next: 999_985 }),
                /After the closing the book must equal the next-day float/,
              );
              // A counted shortfall of 1,000 and the Owner's withdrawal of 400,000 are entries of the day, inserted before the closing row.
              await entry(cashA, branch.id, '2026-10-12', 'OUT', 'COUNT_DIFFERENCE', 1_000, {
                sourceType: 'CASH_CLOSING',
                sourceId: id,
                leg: 0,
                actor: true,
                reason: 'thiếu tiền lẻ',
              });
              await entry(cashA, branch.id, '2026-10-12', 'OUT', 'OWNER_WITHDRAWAL', 400_000, {
                sourceType: 'CASH_CLOSING',
                sourceId: id,
                leg: 1,
                actor: true,
                reason: 'Chủ rút',
              });
              await rejects(
                () => closing({ opening: 900_000 }),
                /opening float is the previous next-day float or the opening balance/,
              );
              await rejects(
                () =>
                  closing({
                    counted: 998_995,
                    difference: -1_000,
                    withdrawal: 400_000,
                    next: 598_995,
                    reason: ' ',
                  }),
                /cash_day_closings_reason/,
              );
              await closing({
                counted: 998_995,
                difference: -1_000,
                reason: 'thiếu tiền lẻ',
                withdrawal: 400_000,
                next: 598_995,
              });
              // The day is locked: no entry for it or for an earlier day; a second closing of the same day or an earlier day is refused.
              await rejects(
                () => entry(cashA, branch.id, '2026-10-12', 'IN', 'TIP_IN', 1),
                /The day is closed/,
              );
              await rejects(
                () => entry(cashA, branch.id, '2026-10-11', 'IN', 'TIP_IN', 1),
                /The day is closed/,
              );
              await rejects(
                () =>
                  closing({
                    id: randomUUID(),
                    opening: 598_995,
                    cashIn: 0,
                    cashOut: 0,
                    expected: 598_995,
                    counted: 598_995,
                    next: 598_995,
                  }),
                /cash_day_closings_fund_date_key|duplicate key|next is closed|A day after the last closing/,
              );
              await rejects(
                () => exec(`UPDATE cash_day_closings SET reason = 'x' WHERE id = $1::uuid`, id),
                /append-only/,
              );
              await rejects(
                () => exec(`DELETE FROM cash_day_closings WHERE id = $1::uuid`, id),
                /append-only/,
              );
              // The next day starts from the next-day float.
              await entry(cashA, branch.id, '2026-10-13', 'IN', 'SALE_CASH', 200_000, {
                sourceType: 'PAYMENT',
                sourceId: randomUUID(),
              });
              await closing({
                id: randomUUID(),
                date: '2026-10-13',
                opening: 598_995,
                cashIn: 200_000,
                cashOut: 0,
                expected: 798_995,
                counted: 798_995,
                next: 798_995,
              });
              await rejects(
                () =>
                  closing({
                    id: randomUUID(),
                    date: '2026-10-12',
                    opening: 598_995,
                    cashIn: 0,
                    cashOut: 0,
                    expected: 598_995,
                    counted: 598_995,
                    next: 598_995,
                  }),
                /A day after the last closing|duplicate key/,
              );
              // The bank fund has no closing.
              await rejects(
                () =>
                  exec(
                    `INSERT INTO cash_day_closings (id, fund_id, branch_id, business_date, opening_float_vnd, cash_in_vnd, cash_out_vnd, expected_vnd, counted_vnd,
                   difference_vnd, withdrawal_vnd, next_float_vnd, closed_by_user_id, reauthenticated_at, client_request_id)
                 VALUES (gen_random_uuid(), $1::uuid, $2::uuid, '2026-10-12', 5000000, 7, 0, 5000007, 5000007, 0, 0, 5000007, $3::uuid, $4, gen_random_uuid())`,
                    bank,
                    branch.id,
                    person.id,
                    instant,
                  ),
                /Only a cash fund of the branch is closed/,
              );
            },
          );

          await context.test(
            'a password confirmation is spent once, also against refunds',
            async () => {
              const at = new Date('2026-10-12T03:00:00.000Z');
              await exec(
                `INSERT INTO reauth_uses (actor_user_id, reauthenticated_at, purpose) VALUES ($1::uuid, $2, 'CASH_CLOSING')`,
                person.id,
                at,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO reauth_uses (actor_user_id, reauthenticated_at, purpose) VALUES ($1::uuid, $2, 'PAYROLL_CLOSE')`,
                    person.id,
                    at,
                  ),
                /duplicate key/,
              );
              await rejects(() => exec(`UPDATE reauth_uses SET purpose = 'X'`), /append-only/);
              const refundAt = new Date('2026-10-12T04:00:00.000Z');
              // A real refund is not needed for this check: drop the owner constraint inside this rolled-back transaction.
              await exec(
                `ALTER TABLE refund_reauthentication_uses DROP CONSTRAINT IF EXISTS refund_reauthentication_uses_owner`,
              );
              await exec(
                `INSERT INTO refund_reauthentication_uses (actor_user_id, reauthenticated_at) VALUES ($1::uuid, $2)`,
                person.id,
                refundAt,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO reauth_uses (actor_user_id, reauthenticated_at, purpose) VALUES ($1::uuid, $2, 'CASH_CLOSING')`,
                    person.id,
                    refundAt,
                  ),
                /already used for a refund/,
              );
            },
          );

          throw rollback;
        },
        { timeout: 60_000 },
      ),
      (error) => error === rollback,
    );
  } finally {
    await database.$disconnect();
  }
});
