import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

/**
 * Phase 6 P6-4 database rules (migration 20261106000007): the one definition of "available" (branch-local expiry), the low-stock alert
 * raised by the movement trigger (fires once on crossing, re-arms above the threshold, never on a receipt), the alert and expiry-scan
 * history rows (immutable once handled, never deleted) and the two code sequences. Every fixture rolls back.
 */
test('Phase 6 P6-4 availability, low-stock alerts and scan history (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 6 inventory alerts rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8);
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
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const exec = (sql: string) => tx.$executeRawUnsafe(sql);
          const rows = <T>(sql: string) => tx.$queryRawUnsafe<T[]>(sql);
          const one = async <T>(sql: string): Promise<T> => (await rows<T>(sql))[0]!;

          const actor = randomUUID();
          await tx.user.create({
            data: {
              id: actor,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'P6-4 fixture',
              preferredLocale: 'vi',
              emailCanonical: `p64-${run}@example.com`,
              emailDelivery: `p64-${run}@example.com`,
              emailVerifiedAt: new Date(),
              phoneCanonical: `+8479${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture-password-hash',
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `P64_${run.toUpperCase()}`,
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          const newBranch = async (code: string, timezone: string) =>
            (
              await tx.branch.create({
                data: { code: `IT-P64${code}-${run}`, name: `P64 ${code}`, timezone },
                select: { id: true },
              })
            ).id;
          const branch = await newBranch('A', 'Asia/Ho_Chi_Minh');
          const product = await one<{ id: string }>(
            `INSERT INTO products (code, name_vi, name_en, created_by_user_id)
             VALUES ('p64-${run}', 'Kem', 'Cream', '${actor}'::uuid) RETURNING id`,
          );
          let skuNo = 0;
          const variant = async (threshold: number | null) =>
            (
              await one<{ id: string }>(
                `INSERT INTO product_variants (product_id, sku, low_stock_threshold)
                 VALUES ('${product.id}'::uuid, 'P64-${run.toUpperCase()}-${++skuNo}', ${threshold ?? 'NULL'}) RETURNING id`,
              )
            ).id;
          let receiptNo = 0;
          /** A confirmed receipt of `quantity` units, its lot and the RECEIPT movement. Returns the lot id. */
          const receive = async (
            variantId: string,
            quantity: number,
            expiry: string | null = null,
            branchId = branch,
          ) => {
            const receipt = await one<{ id: string }>(
              `INSERT INTO stock_receipts (code, branch_id, receipt_date, created_by_user_id)
               VALUES ('R64-${run}-${++receiptNo}', '${branchId}'::uuid, '2027-03-01', '${actor}'::uuid) RETURNING id`,
            );
            const line = await one<{ id: string }>(
              `INSERT INTO stock_receipt_lines (receipt_id, line_no, variant_id, quantity, expiry_date)
               VALUES ('${receipt.id}'::uuid, 1, '${variantId}'::uuid, ${quantity}, ${expiry ? `'${expiry}'` : 'NULL'}) RETURNING id`,
            );
            await exec(
              `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = '${actor}'::uuid, row_version = row_version + 1
               WHERE id = '${receipt.id}'::uuid`,
            );
            const lot = await one<{ id: string }>(
              `INSERT INTO inventory_lots (branch_id, variant_id, lot_code, expiry_date, source_receipt_line_id, created_by_user_id)
               VALUES ('${branchId}'::uuid, '${variantId}'::uuid, 'L-${receiptNo}', ${expiry ? `'${expiry}'` : 'NULL'},
                 '${line.id}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            await exec(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
               VALUES ('${branchId}'::uuid, '${variantId}'::uuid, '${lot.id}'::uuid, 'RECEIPT', ${quantity}, '${line.id}'::uuid,
                 'RECEIPT:${line.id}', '${actor}'::uuid)`,
            );
            return lot.id;
          };
          const take = (variantId: string, lotId: string, quantity: number, branchId = branch) =>
            exec(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, reason, idempotency_key, actor_user_id)
               VALUES ('${branchId}'::uuid, '${variantId}'::uuid, '${lotId}'::uuid, 'ADJUSTMENT', -${quantity}, 'LOSS',
                 '${randomUUID()}', '${actor}'::uuid)`,
            );
          const level = (variantId: string, branchId = branch) =>
            one<{ on_hand: number; low_stock_alerted: boolean }>(
              `SELECT on_hand, low_stock_alerted FROM stock_levels
               WHERE branch_id = '${branchId}'::uuid AND variant_id = '${variantId}'::uuid`,
            );
          const alerts = (variantId: string) =>
            rows<{
              id: string;
              on_hand: number;
              threshold: number;
              handled_at: Date | null;
              outcome: string | null;
            }>(
              `SELECT id, on_hand, threshold, handled_at, outcome FROM inventory_low_stock_alerts
               WHERE variant_id = '${variantId}'::uuid ORDER BY created_at, id`,
            );

          await context.test(
            'available stock is the non-expired lots in the BRANCH-LOCAL calendar',
            async () => {
              // A branch 14 hours ahead of UTC (its calendar day differs from the UTC day for 14 hours a day) and one 11 hours behind.
              const ahead = await newBranch('E', 'Pacific/Kiritimati');
              const behind = await newBranch('W', 'Pacific/Pago_Pago');
              const v = await variant(null);
              const dateIn = (zone: string, offsetDays: number) =>
                one<{ d: string }>(
                  `SELECT to_char((clock_timestamp() AT TIME ZONE '${zone}')::date + ${offsetDays}, 'YYYY-MM-DD') AS d`,
                ).then((row) => row.d);
              const available = async (branchId: string) =>
                (
                  await one<{ n: number }>(
                    `SELECT lucy_available_stock('${branchId}'::uuid, '${v}'::uuid) AS n`,
                  )
                ).n;
              assert.equal(await available(branch), 0, 'no stock row: zero, never an error');
              // Branch A (Vietnam): sellable through its expiry date, expired from the next local day; no expiry never expires.
              await receive(v, 5, await dateIn('Asia/Ho_Chi_Minh', 0));
              await receive(v, 7, await dateIn('Asia/Ho_Chi_Minh', -1));
              await receive(v, 11, null);
              await receive(v, 13, await dateIn('Asia/Ho_Chi_Minh', 40));
              assert.equal(
                await available(branch),
                5 + 11 + 13,
                'the lot expiring today is still sellable, yesterday is not',
              );
              assert.equal(
                (await level(v)).on_hand,
                5 + 7 + 11 + 13,
                'on hand still counts the expired lot',
              );
              // The two far branches: the lot that expires on the branch-local "today" is sellable, "yesterday" is not.
              for (const [branchId, zone] of [
                [ahead, 'Pacific/Kiritimati'],
                [behind, 'Pacific/Pago_Pago'],
              ] as const) {
                await receive(v, 2, await dateIn(zone, 0), branchId);
                await receive(v, 3, await dateIn(zone, -1), branchId);
                assert.equal(await available(branchId), 2, zone);
              }
            },
          );

          await context.test(
            'low stock fires once when a movement takes stock to the threshold, and re-arms above it',
            async () => {
              const v = await variant(3);
              const lotA = await receive(v, 2);
              assert.deepEqual(
                await level(v),
                { on_hand: 2, low_stock_alerted: false },
                'a receipt never raises an alert, even below the threshold',
              );
              assert.equal((await alerts(v)).length, 0);
              await take(v, lotA, 1);
              const first = await alerts(v);
              assert.equal(first.length, 1, 'taking stock out while low raises one alert');
              assert.deepEqual(
                [first[0]!.on_hand, first[0]!.threshold, first[0]!.outcome],
                [1, 3, null],
              );
              assert.equal((await level(v)).low_stock_alerted, true);
              await take(v, lotA, 1);
              assert.equal((await alerts(v)).length, 1, 'still low: no second alert');
              // A restock that stays low keeps the flag; one above the threshold re-arms it.
              await receive(v, 1);
              assert.equal(
                (await level(v)).low_stock_alerted,
                true,
                'restocked to 1, still at or below 3',
              );
              const lotC = await receive(v, 10);
              assert.deepEqual(await level(v), { on_hand: 11, low_stock_alerted: false });
              await take(v, lotC, 7);
              assert.equal((await alerts(v)).length, 1, '4 is above the threshold');
              await take(v, lotC, 1);
              const second = await alerts(v);
              assert.equal(
                second.length,
                2,
                'reaching exactly the threshold alerts again after the re-arm',
              );
              assert.deepEqual([second[1]!.on_hand, second[1]!.threshold], [3, 3]);
              // A threshold changed on its own fires nothing; the next movement decides.
              await exec(
                `UPDATE product_variants SET low_stock_threshold = 20, row_version = row_version + 1 WHERE id = '${v}'::uuid`,
              );
              assert.equal((await alerts(v)).length, 2);
              await receive(v, 30);
              assert.equal(
                (await level(v)).low_stock_alerted,
                false,
                'above the new threshold: re-armed',
              );
              await exec(
                `UPDATE product_variants SET low_stock_threshold = NULL, row_version = row_version + 1 WHERE id = '${v}'::uuid`,
              );
              await take(v, lotC, 1);
              assert.equal((await alerts(v)).length, 2, 'no threshold: never an alert');
            },
          );

          await context.test(
            'a threshold of zero alerts when the stock runs out; no threshold never alerts',
            async () => {
              const zero = await variant(0);
              const lot = await receive(zero, 2);
              await take(zero, lot, 1);
              assert.equal((await alerts(zero)).length, 0, '1 is above 0');
              await take(zero, lot, 1);
              const rowsOut = await alerts(zero);
              assert.equal(rowsOut.length, 1);
              assert.deepEqual([rowsOut[0]!.on_hand, rowsOut[0]!.threshold], [0, 0]);
              const none = await variant(null);
              const lotN = await receive(none, 3);
              await take(none, lotN, 3);
              assert.equal((await alerts(none)).length, 0);
              assert.equal((await level(none)).low_stock_alerted, false);
            },
          );

          await context.test(
            'an alert is handled once and is history; scans are insert-only',
            async () => {
              const v = await variant(5);
              const lot = await receive(v, 6);
              await take(v, lot, 2);
              const [alert] = await alerts(v);
              assert.ok(alert);
              await rejects(
                () =>
                  exec(
                    `UPDATE inventory_low_stock_alerts SET on_hand = 9 WHERE id = '${alert.id}'::uuid`,
                  ),
                /changes only by being handled/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE inventory_low_stock_alerts SET outcome = 'SENT' WHERE id = '${alert.id}'::uuid`,
                  ),
                /inventory_low_stock_alerts_handled/,
              );
              await exec(
                `UPDATE inventory_low_stock_alerts SET outcome = 'PUBLISHED' WHERE id = '${alert.id}'::uuid`,
              );
              const [handled] = await alerts(v);
              assert.equal(handled!.outcome, 'PUBLISHED');
              assert.ok(handled!.handled_at instanceof Date, 'the database stamps the time');
              await rejects(
                () =>
                  exec(
                    `UPDATE inventory_low_stock_alerts SET outcome = 'STALE' WHERE id = '${alert.id}'::uuid`,
                  ),
                /handled stock alert is immutable/,
              );
              await rejects(
                () => exec(`DELETE FROM inventory_low_stock_alerts WHERE id = '${alert.id}'::uuid`),
                /never deleted/,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO inventory_low_stock_alerts (branch_id, variant_id, on_hand, threshold, handled_at, outcome)
                   VALUES ('${branch}'::uuid, '${v}'::uuid, 1, 2, now(), 'STALE')`,
                  ),
                /starts unhandled/,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO inventory_low_stock_alerts (branch_id, variant_id, on_hand, threshold)
                   VALUES ('${branch}'::uuid, '${v}'::uuid, -1, 2)`,
                  ),
                /inventory_low_stock_alerts_values/,
              );

              const insertScan = (date: string, outcome = 'PUBLISHED') =>
                exec(
                  `INSERT INTO inventory_expiry_scans (branch_id, business_date, warning_days, expiring_lots, expired_lots, outcome)
                 VALUES ('${branch}'::uuid, '${date}', 90, 2, 1, '${outcome}')`,
                );
              await insertScan('2027-03-01');
              await rejects(() => insertScan('2027-03-01'), /inventory_expiry_scans_pkey/);
              await insertScan('2027-03-02', 'NOTHING_TO_REPORT');
              await rejects(
                () => insertScan('2027-03-03', 'SENT'),
                /inventory_expiry_scans_outcome/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE inventory_expiry_scans SET expired_lots = 0 WHERE business_date = '2027-03-01'`,
                  ),
                /never changed or deleted/,
              );
              await rejects(
                () => exec(`DELETE FROM inventory_expiry_scans WHERE business_date = '2027-03-01'`),
                /never changed or deleted/,
              );
            },
          );

          await context.test(
            'the receipt and count codes come from sequences that only move forward',
            async () => {
              const first = await one<{ n: bigint }>(
                `SELECT nextval('stock_receipt_code_seq') AS n`,
              );
              const next = await one<{ n: bigint }>(
                `SELECT nextval('stock_receipt_code_seq') AS n`,
              );
              assert.equal(next.n, first.n + 1n);
              const count = await one<{ n: bigint }>(`SELECT nextval('stock_count_code_seq') AS n`);
              assert.ok(count.n >= 1n);
            },
          );

          throw rollback;
        },
        { timeout: 120_000, maxWait: 20_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});
