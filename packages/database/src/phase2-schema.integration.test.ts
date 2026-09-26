import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { PERMISSION_CATALOG } from './permission-catalog.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

const phase1Migrations = [
  '../prisma/migrations/20260916000000_phase0_foundation/migration.sql',
  '../prisma/migrations/20260923000000_phase1_auth_identity_authorization_audit/migration.sql',
];
const phase2Migration =
  '../prisma/migrations/20260925000000_phase2_services_skills_operations/migration.sql';
// Later additive Phase 2 migrations, applied in order after the foundation.
const phase2FollowUps = [
  '../prisma/migrations/20260926000000_phase2_branch_row_version/migration.sql',
  '../prisma/migrations/20260927000000_phase2_leave_type/migration.sql',
];
// Applied after a pre-existing service row is inserted, to prove the backfill.
const serviceDurationMigration =
  '../prisma/migrations/20260928000000_phase2_service_duration_estimate/migration.sql';
const servicePricingMigration =
  '../prisma/migrations/20260929000000_phase2_service_price_range_unit/migration.sql';
const PHASE1_CODES = PERMISSION_CATALOG.slice(0, 10);

function identifier(value: string): string {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

// Same isolation as the Phase 1 schema test: every migration and fixture lives in one
// rolled-back transaction in a temporary schema. No migrate/db push, no commits.
test('Phase 2 schema invariants in an isolated, rolled-back schema', async (context) => {
  const databaseUrl = process.env['DATABASE_URL'];
  assert.ok(databaseUrl, 'DATABASE_URL is required for database integration tests.');
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch (error) {
    await client.end();
    // eslint-disable-next-line preserve-caught-error -- Connection causes can expose configuration.
    throw new Error(
      `Cannot connect for schema integration tests (${sqlState(error) ?? 'connection error'}).`,
    );
  }

  const schemaName = `phase2_schema_test_${randomUUID().replaceAll('-', '')}`;
  const schema = identifier(schemaName);
  let savepointSequence = 0;
  let fixtureSequence = 0;

  async function insert(table: string, values: Record<string, unknown>): Promise<string> {
    const entries = Object.entries({ id: randomUUID(), ...values });
    const result = await client.query<{ id: string }>(
      `INSERT INTO ${identifier(table)} (${entries.map(([key]) => identifier(key)).join(', ')})
       VALUES (${entries.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
      entries.map(([, value]) => value),
    );
    assert.ok(result.rows[0]);
    return result.rows[0].id;
  }

  async function rejects(operation: () => Promise<unknown>, expectedState = '23514') {
    const point = identifier(`expected_failure_${++savepointSequence}`);
    await client.query(`SAVEPOINT ${point}`);
    try {
      await assert.rejects(operation, (error: unknown) => {
        assert.equal(sqlState(error), expectedState);
        return true;
      });
    } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${point}`);
      await client.query(`RELEASE SAVEPOINT ${point}`);
    }
  }

  async function check(name: string, run: (child: TestContext) => Promise<void>) {
    await context.test(name, async (child) => {
      const point = identifier(`test_case_${++savepointSequence}`);
      await client.query(`SAVEPOINT ${point}`);
      try {
        await run(child);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${point}`);
        await client.query(`RELEASE SAVEPOINT ${point}`);
      }
    });
  }

  async function user(kind: 'CUSTOMER' | 'EMPLOYEE' | 'OWNER') {
    const number = ++fixtureSequence;
    const id = await insert('users', {
      kind,
      status: kind === 'EMPLOYEE' ? 'PENDING_SETUP' : 'ACTIVE',
      full_name: 'Schema fixture',
      preferred_locale: 'vi',
      normalization_version: 1,
      email_canonical: `phase2-${number}@example.invalid`,
      email_delivery: `Phase2-${number}@example.invalid`,
      email_verified_at: kind === 'CUSTOMER' ? new Date() : null,
      phone_canonical: kind === 'OWNER' ? null : `+849${String(number).padStart(8, '0')}`,
      password_hash: kind === 'EMPLOYEE' ? null : '$argon2id$fixture-password-hash',
    });
    if (kind === 'CUSTOMER') {
      await client.query(
        'INSERT INTO customer_profiles (user_id, date_of_birth, address) VALUES ($1, $2, $3)',
        [id, '2000-01-01', 'Fixture address'],
      );
    } else if (kind === 'EMPLOYEE') {
      await client.query(
        `INSERT INTO employee_profiles (user_id, employee_code_canonical, date_of_birth, address)
         VALUES ($1, $2, $3, $4)`,
        [id, `PHASE2_${number}`, '2000-01-01', 'Fixture address'],
      );
    }
    return id;
  }

  const branch = (code: string) => insert('branches', { code, name: `Branch ${code}` });
  const category = (code = `CAT_${++fixtureSequence}`) =>
    insert('service_categories', { code, name_vi: 'Gội đầu', name_en: 'Hair wash' });
  // Default estimate: exact (min = max = the scheduling duration) unless overridden.
  const service = async (overrides: Record<string, unknown> = {}) => {
    const duration = overrides['duration_minutes'] ?? 90;
    return insert('services', {
      code: `SVC_${++fixtureSequence}`,
      category_id: await category(),
      name_vi: 'Gội dưỡng sinh',
      name_en: 'Herbal hair wash',
      price_vnd: 120000,
      duration_minutes: 90,
      estimated_min_minutes: duration,
      estimated_max_minutes: duration,
      price_max_vnd: overrides['price_vnd'] ?? 120000,
      ...overrides,
    });
  };
  const skill = (code = `SKILL_${++fixtureSequence}`) =>
    insert('skills', { code, name_vi: 'Gội đầu', name_en: 'Hair wash' });

  try {
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
      for (const path of phase1Migrations) {
        await client.query(await readFile(new URL(path, import.meta.url), 'utf8'));
      }
      // Rows that exist in production before Phase 2 must survive the enum rebuild.
      const phase1Ids = new Map<string, string>();
      for (const entry of PHASE1_CODES) {
        phase1Ids.set(
          entry.code,
          await insert('permissions', {
            code: entry.code,
            scope_capability: entry.scopeCapability,
            data_classification: entry.dataClassification,
          }),
        );
      }
      await client.query(await readFile(new URL(phase2Migration, import.meta.url), 'utf8'));
      for (const path of phase2FollowUps) {
        await client.query(await readFile(new URL(path, import.meta.url), 'utf8'));
      }
      // A service that exists before the duration-estimate migration (production shape).
      await insert('services', {
        code: 'LEGACY_DURATION',
        category_id: await category('CAT_LEGACY'),
        name_vi: 'Gội thường',
        name_en: 'Regular hair wash',
        price_vnd: 80000,
        duration_minutes: 45,
      });
      await client.query(
        await readFile(new URL(serviceDurationMigration, import.meta.url), 'utf8'),
      );
      // The same pre-existing service then receives the pricing migration.
      await client.query(await readFile(new URL(servicePricingMigration, import.meta.url), 'utf8'));

      await check('Phase 1 permission rows survive the PermissionCode rebuild', async () => {
        const rows = await client.query<{ id: string; code: string }>(
          'SELECT id, code::text AS code FROM permissions',
        );
        assert.equal(rows.rows.length, 10);
        for (const row of rows.rows) assert.equal(phase1Ids.get(row.code), row.id);
        const types = await client.query<{ count: string }>(
          "SELECT count(*) FROM pg_type WHERE typname = 'PermissionCode_phase1'",
        );
        assert.equal(types.rows[0]?.count, '0', 'temporary enum type removed');
      });

      await check('the code-owned catalog matches the database semantics exactly', async () => {
        // This isolated schema stops at Phase 2: the first 17 codes. Later codes come from
        // enum-only migrations (checked against the fully migrated database elsewhere).
        const phase2Catalog = PERMISSION_CATALOG.slice(0, 17);
        for (const entry of phase2Catalog.slice(10)) {
          await insert('permissions', {
            code: entry.code,
            scope_capability: entry.scopeCapability,
            data_classification: entry.dataClassification,
          });
        }
        const labels = await client.query<{ labels: string[] }>(
          'SELECT enum_range(NULL::"PermissionCode")::text[] AS labels',
        );
        assert.deepEqual(
          labels.rows[0]?.labels,
          phase2Catalog.map((entry) => entry.code),
        );
        // Service prices are GLOBAL_ONLY; every other Phase 2 code is BRANCH_CAPABLE.
        await client.query("DELETE FROM permissions WHERE code = 'MANAGE_SERVICE_PRICES'");
        await rejects(() =>
          insert('permissions', {
            code: 'MANAGE_SERVICE_PRICES',
            scope_capability: 'BRANCH_CAPABLE',
            data_classification: 'STANDARD',
          }),
        );
        await client.query("DELETE FROM permissions WHERE code = 'MANAGE_SERVICES'");
        await rejects(() =>
          insert('permissions', {
            code: 'MANAGE_SERVICES',
            scope_capability: 'GLOBAL_ONLY',
            data_classification: 'STANDARD',
          }),
        );
        await client.query("DELETE FROM permissions WHERE code = 'APPROVE_LEAVE'");
        await rejects(() =>
          insert('permissions', {
            code: 'APPROVE_LEAVE',
            scope_capability: 'BRANCH_CAPABLE',
            data_classification: 'EMPLOYEE_PAY',
          }),
        );
        // Phase 1 pay semantics are unchanged.
        await rejects(() =>
          client.query(
            "UPDATE permissions SET data_classification = 'STANDARD' WHERE code = 'VIEW_EMPLOYEE_PAY'",
          ),
        );
      });

      await check('a GLOBAL_ONLY permission cannot be overridden at branch scope', async () => {
        const price = await insert('permissions', {
          code: 'MANAGE_SERVICE_PRICES',
          scope_capability: 'GLOBAL_ONLY',
          data_classification: 'STANDARD',
        });
        const leave = await insert('permissions', {
          code: 'APPROVE_LEAVE',
          scope_capability: 'BRANCH_CAPABLE',
          data_classification: 'STANDARD',
        });
        const employee = await user('EMPLOYEE');
        const branchId = await branch('OVR');
        await rejects(() =>
          insert('user_permission_overrides', {
            user_id: employee,
            permission_id: price,
            effect: 'DENY',
            scope_kind: 'BRANCH',
            branch_id: branchId,
          }),
        );
        await insert('user_permission_overrides', {
          user_id: employee,
          permission_id: price,
          effect: 'ALLOW',
          scope_kind: 'GLOBAL',
        });
        await insert('user_permission_overrides', {
          user_id: employee,
          permission_id: leave,
          effect: 'ALLOW',
          scope_kind: 'BRANCH',
          branch_id: branchId,
        });
      });

      await check(
        'services: estimated duration range backfilled and bounded by scheduling',
        async () => {
          const legacy = await client.query<{ min: number; max: number; duration: number }>(
            `SELECT estimated_min_minutes AS min, estimated_max_minutes AS max,
                    duration_minutes AS duration FROM services WHERE code = 'LEGACY_DURATION'`,
          );
          assert.deepEqual(legacy.rows[0], { min: 45, max: 45, duration: 45 });
          // Exact, a range equal to the slot, and a range with scheduling slack.
          await service({
            duration_minutes: 60,
            estimated_min_minutes: 60,
            estimated_max_minutes: 60,
          });
          await service({
            duration_minutes: 45,
            estimated_min_minutes: 30,
            estimated_max_minutes: 45,
          });
          await service({
            duration_minutes: 90,
            estimated_min_minutes: 60,
            estimated_max_minutes: 80,
          });
          await rejects(() => service({ estimated_min_minutes: 0, estimated_max_minutes: 30 }));
          await rejects(() =>
            service({ duration_minutes: 60, estimated_min_minutes: 60, estimated_max_minutes: 45 }),
          );
          await rejects(() =>
            service({ duration_minutes: 60, estimated_min_minutes: 30, estimated_max_minutes: 70 }),
          );
          await rejects(() => service({ estimated_min_minutes: null }), '23502');
          await rejects(() => service({ estimated_max_minutes: null }), '23502');
        },
      );

      await check('services: price range and pricing unit backfilled and bounded', async () => {
        const legacy = await client.query<{ min: string; max: string; unit: string }>(
          `SELECT price_vnd::text AS min, price_max_vnd::text AS max, pricing_unit::text AS unit
             FROM services WHERE code = 'LEGACY_DURATION'`,
        );
        assert.deepEqual(legacy.rows[0], { min: '80000', max: '80000', unit: 'PER_SERVICE' });
        const units = await client.query<{ labels: string[] }>(
          'SELECT enum_range(NULL::"ServicePricingUnit")::text[] AS labels',
        );
        assert.deepEqual(units.rows[0]?.labels, ['PER_SERVICE', 'PER_NAIL']);
        await service({ price_vnd: 40000, price_max_vnd: 40000 });
        await service({ price_vnd: 5000, price_max_vnd: 5000, pricing_unit: 'PER_NAIL' });
        await service({ price_vnd: 5000, price_max_vnd: 30000, pricing_unit: 'PER_NAIL' });
        await rejects(() => service({ price_vnd: 10000, price_max_vnd: 5000 }));
        await rejects(() => service({ price_vnd: -1, price_max_vnd: 5000 }));
        await rejects(() => service({ pricing_unit: 'PER_HOUR' }), '22P02');
        await rejects(() => service({ price_max_vnd: null }), '23502');
      });

      await check(
        'services: canonical codes, VND and duration bounds, restrictive FKs',
        async () => {
          await service();
          await rejects(() => service({ price_vnd: -1 }));
          await rejects(() => service({ duration_minutes: 0 }));
          await rejects(() => service({ duration_minutes: 1441 }));
          await rejects(() => service({ code: 'lowercase' }));
          await rejects(() => service({ name_en: '   ' }));
          await rejects(() => service({ description_vi: ' ' }));
          await service({ code: 'FOOT_30', duration_minutes: 30, price_vnd: 0 });
          await rejects(() => service({ code: 'FOOT_30' }), '23505');
          const categoryId = await category('CAT_RESTRICT');
          await service({ category_id: categoryId });
          await rejects(
            () => client.query('DELETE FROM service_categories WHERE id = $1', [categoryId]),
            '23503',
          );
          await rejects(() => category('CAT_RESTRICT'), '23505');
          await rejects(() =>
            insert('service_categories', {
              code: 'NEG',
              name_vi: 'a',
              name_en: 'b',
              sort_order: -1,
            }),
          );
          await rejects(() => skill('bad code'));
        },
      );

      await check('service skills and branch availability are explicit relations', async () => {
        const serviceId = await service();
        const skillId = await skill();
        await client.query('INSERT INTO service_skills (service_id, skill_id) VALUES ($1, $2)', [
          serviceId,
          skillId,
        ]);
        await rejects(
          () =>
            client.query('INSERT INTO service_skills (service_id, skill_id) VALUES ($1, $2)', [
              serviceId,
              skillId,
            ]),
          '23505',
        );
        await rejects(
          () =>
            client.query('INSERT INTO service_skills (service_id, skill_id) VALUES ($1, $2)', [
              serviceId,
              randomUUID(),
            ]),
          '23503',
        );
        const branchId = await branch('SBA');
        await client.query(
          'INSERT INTO service_branch_availability (service_id, branch_id) VALUES ($1, $2)',
          [serviceId, branchId],
        );
        await rejects(
          () =>
            client.query(
              'INSERT INTO service_branch_availability (service_id, branch_id) VALUES ($1, $2)',
              [serviceId, branchId],
            ),
          '23505',
        );
        await client.query(
          'UPDATE service_branch_availability SET is_active = false WHERE service_id = $1',
          [serviceId],
        );
        await rejects(() => client.query('DELETE FROM skills WHERE id = $1', [skillId]), '23503');
      });

      await check('employee skills keep one active grant and immutable history', async () => {
        const employee = await user('EMPLOYEE');
        const owner = await user('OWNER');
        const skillId = await skill();
        const grant = () =>
          insert('employee_skills', {
            employee_user_id: employee,
            skill_id: skillId,
            granted_by_user_id: owner,
          });
        const first = await grant();
        await rejects(grant, '23505');
        await client.query(
          "UPDATE employee_skills SET revoked_at = granted_at + interval '1 minute' WHERE id = $1",
          [first],
        );
        const second = await grant();
        assert.notEqual(first, second, 'history keeps the revoked grant');
        await rejects(() =>
          client.query(
            "UPDATE employee_skills SET revoked_at = now() + interval '1 day' WHERE id = $1",
            [first],
          ),
        );
        await rejects(() =>
          client.query('UPDATE employee_skills SET skill_id = $2 WHERE id = $1', [
            second,
            randomUUID(),
          ]),
        );
        await rejects(() => client.query('DELETE FROM employee_skills WHERE id = $1', [second]));
        await rejects(() =>
          client.query(
            "UPDATE employee_skills SET revoked_at = granted_at - interval '1 minute' WHERE id = $1",
            [second],
          ),
        );
        // Only employee profiles can hold skills.
        const customer = await user('CUSTOMER');
        await rejects(
          () =>
            insert('employee_skills', {
              employee_user_id: customer,
              skill_id: skillId,
              granted_by_user_id: owner,
            }),
          '23503',
        );
      });

      await check(
        'operating hours are branch-local wall-clock minutes per ISO weekday',
        async () => {
          const branchId = await branch('HRS');
          const hours = (overrides: Record<string, unknown>) =>
            insert('branch_operating_hours', { branch_id: branchId, ...overrides });
          await hours({ iso_weekday: 1, opens_at_minute: 540, closes_at_minute: 1260 });
          await hours({ iso_weekday: 7, is_closed: true });
          await hours({ iso_weekday: 2, opens_at_minute: 0, closes_at_minute: 1440 });
          await rejects(() => hours({ iso_weekday: 1, is_closed: true }), '23505');
          await rejects(() => hours({ iso_weekday: 0, is_closed: true }));
          await rejects(() => hours({ iso_weekday: 8, is_closed: true }));
          await rejects(() => hours({ iso_weekday: 3 }));
          await rejects(() =>
            hours({
              iso_weekday: 3,
              is_closed: true,
              opens_at_minute: 540,
              closes_at_minute: 1260,
            }),
          );
          await rejects(() =>
            hours({ iso_weekday: 3, opens_at_minute: 1260, closes_at_minute: 540 }),
          );
          await rejects(() =>
            hours({ iso_weekday: 3, opens_at_minute: 540, closes_at_minute: 540 }),
          );
          await rejects(() =>
            hours({ iso_weekday: 3, opens_at_minute: -1, closes_at_minute: 540 }),
          );
          await rejects(() =>
            hours({ iso_weekday: 3, opens_at_minute: 540, closes_at_minute: 1441 }),
          );
        },
      );

      await check('attendance: branch-timezone business date, one record per day', async () => {
        const employee = await user('EMPLOYEE');
        const hcm = await branch('ATT');
        const utc = await insert('branches', {
          code: 'ATT_UTC',
          name: 'UTC branch',
          timezone: 'UTC',
        });
        // 17:30Z on 24 Sep is 00:30 on 25 Sep in Asia/Ho_Chi_Minh.
        const checkIn = new Date('2026-09-24T17:30:00Z');
        const record = (overrides: Record<string, unknown>) =>
          insert('attendance_records', {
            employee_user_id: employee,
            branch_id: hcm,
            business_date: '2026-09-25',
            check_in_at: checkIn,
            ...overrides,
          });
        await rejects(() => record({ business_date: '2026-09-24' }));
        const id = await record({});
        await rejects(() => record({}), '23505');
        await insert('attendance_records', {
          employee_user_id: employee,
          branch_id: utc,
          business_date: '2026-09-24',
          check_in_at: checkIn,
        });
        await rejects(() =>
          client.query('UPDATE attendance_records SET check_out_at = check_in_at WHERE id = $1', [
            id,
          ]),
        );
        await rejects(() =>
          client.query(
            "UPDATE attendance_records SET check_out_at = check_in_at - interval '1 hour' WHERE id = $1",
            [id],
          ),
        );
        await client.query(
          "UPDATE attendance_records SET check_out_at = check_in_at + interval '8 hours' WHERE id = $1",
          [id],
        );
        // A manager correction may change times, but the date must follow the check-in.
        await rejects(() =>
          client.query(
            "UPDATE attendance_records SET check_in_at = check_in_at + interval '1 day' WHERE id = $1",
            [id],
          ),
        );
        const other = await user('EMPLOYEE');
        await rejects(() =>
          client.query('UPDATE attendance_records SET employee_user_id = $2 WHERE id = $1', [
            id,
            other,
          ]),
        );
        const owner = await user('OWNER');
        await rejects(
          () =>
            insert('attendance_records', {
              employee_user_id: owner,
              branch_id: hcm,
              business_date: '2026-09-25',
              check_in_at: checkIn,
            }),
          '23503',
        );
      });

      await check('leave: whole days, status facts and allowed transitions only', async () => {
        const employee = await user('EMPLOYEE');
        const manager = await user('EMPLOYEE');
        const request = (overrides: Record<string, unknown> = {}) =>
          insert('leave_requests', {
            employee_user_id: employee,
            start_date: '2026-10-01',
            end_date: '2026-10-02',
            reason: 'Family matter',
            leave_type: 'PERSONAL',
            ...overrides,
          });
        await rejects(() => request({ end_date: '2026-09-30' }));
        // A controlled, required leave type; no paid/unpaid code exists.
        await rejects(() => request({ leave_type: null }), '23502');
        await rejects(() => request({ leave_type: 'UNPAID' }), '22P02');
        const types = await client.query<{ labels: string[] }>(
          'SELECT enum_range(NULL::"LeaveType")::text[] AS labels',
        );
        assert.deepEqual(types.rows[0]?.labels, [
          'ANNUAL',
          'SICK',
          'PERSONAL',
          'FAMILY_EVENT',
          'MATERNITY',
          'OTHER',
        ]);
        await rejects(() => request({ reason: '  ' }));
        await rejects(() => request({ decided_by_user_id: manager, decided_at: new Date() }));
        await rejects(() => request({ status: 'APPROVED' }));
        await rejects(() =>
          request({ status: 'APPROVED', decided_by_user_id: employee, decided_at: new Date() }),
        );
        await request({ start_date: '2026-10-05', end_date: '2026-10-05' });

        // PENDING may be edited, then approved; the request facts are then frozen.
        const approved = await request();
        await client.query(
          "UPDATE leave_requests SET end_date = '2026-10-03', leave_type = 'SICK' WHERE id = $1",
          [approved],
        );
        const decide = (id: string, status: string, extra = '') =>
          client.query(
            `UPDATE leave_requests SET status = '${status}', decided_by_user_id = $2,
             decided_at = requested_at + interval '1 hour'${extra} WHERE id = $1`,
            [id, manager],
          );
        await rejects(() =>
          client.query(
            `UPDATE leave_requests SET status = 'APPROVED', decided_by_user_id = $2,
             decided_at = requested_at + interval '1 hour', end_date = '2026-10-04' WHERE id = $1`,
            [approved, manager],
          ),
        );
        await decide(approved, 'APPROVED');
        await rejects(() =>
          client.query("UPDATE leave_requests SET status = 'REJECTED' WHERE id = $1", [approved]),
        );
        await rejects(() =>
          client.query("UPDATE leave_requests SET reason = 'Changed' WHERE id = $1", [approved]),
        );
        await rejects(() =>
          client.query("UPDATE leave_requests SET leave_type = 'OTHER' WHERE id = $1", [approved]),
        );
        // APPROVED -> CANCELLED stays possible for a later authorized workflow.
        await client.query(
          `UPDATE leave_requests SET status = 'CANCELLED', cancelled_by_user_id = $2,
           cancelled_at = decided_at + interval '1 hour', cancellation_reason = 'Plans changed'
           WHERE id = $1`,
          [approved, manager],
        );
        await rejects(() =>
          client.query("UPDATE leave_requests SET cancellation_reason = 'Edited' WHERE id = $1", [
            approved,
          ]),
        );

        // Employee cancels their own PENDING request; REJECTED is terminal.
        const pending = await request();
        await client.query(
          `UPDATE leave_requests SET status = 'CANCELLED', cancelled_by_user_id = employee_user_id,
           cancelled_at = requested_at WHERE id = $1`,
          [pending],
        );
        const rejected = await request();
        await decide(rejected, 'REJECTED', ", decision_reason = 'Short staffed'");
        await rejects(() =>
          client.query(
            `UPDATE leave_requests SET status = 'CANCELLED', cancelled_by_user_id = $2,
             cancelled_at = decided_at WHERE id = $1`,
            [rejected, manager],
          ),
        );
        await rejects(() => client.query('DELETE FROM leave_requests WHERE id = $1', [rejected]));
        await rejects(() =>
          client.query('UPDATE leave_requests SET employee_user_id = $2 WHERE id = $1', [
            pending,
            manager,
          ]),
        );
      });
    } finally {
      await client.query('ROLLBACK');
    }
    const remaining = await client.query<{ count: string }>(
      'SELECT count(*) FROM pg_namespace WHERE nspname = $1',
      [schemaName],
    );
    assert.equal(remaining.rows[0]?.count, '0', 'The isolated test schema must be rolled back.');
  } finally {
    await client.end();
  }
});
