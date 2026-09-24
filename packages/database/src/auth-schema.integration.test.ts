import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

const migrationPaths = [
  '../prisma/migrations/20260916000000_phase0_foundation/migration.sql',
  '../prisma/migrations/20260923000000_phase1_auth_identity_authorization_audit/migration.sql',
];

function identifier(value: string): string {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

// No Prisma migrate/db push, migration-ledger writes, shared-table fixtures or
// commits: both the DDL and every test row live in this one rollback transaction.
test('Phase 1 schema invariants in an isolated, rolled-back schema', async (context) => {
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

  const schemaName = `auth_schema_test_${randomUUID().replaceAll('-', '')}`;
  const schema = identifier(schemaName);
  const runtimeRoleName = `auth_runtime_test_${randomUUID().replaceAll('-', '')}`;
  let savepointSequence = 0;
  let fixtureSequence = 0;
  const now = new Date();
  const future = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

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

  async function flushDeferredConstraints() {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  }

  async function check(name: string, run: (child: TestContext) => Promise<void>) {
    await context.test(name, async (child) => {
      const point = identifier(`test_case_${++savepointSequence}`);
      await client.query(`SAVEPOINT ${point}`);
      try {
        await run(child);
        // Exercise the same deferred constraints COMMIT would execute, without
        // ever committing fixture data or the temporary schema.
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT ${point}`);
        await client.query(`RELEASE SAVEPOINT ${point}`);
      }
    });
  }

  async function user(
    kind: 'CUSTOMER' | 'EMPLOYEE' | 'OWNER',
    overrides: Record<string, unknown> = {},
  ) {
    const number = ++fixtureSequence;
    const id = await insert('users', {
      kind,
      status: kind === 'EMPLOYEE' ? 'PENDING_SETUP' : 'ACTIVE',
      full_name: 'Schema fixture',
      preferred_locale: 'vi',
      normalization_version: 1,
      email_canonical: `fixture-${number}@example.invalid`,
      email_delivery: `Fixture-${number}@example.invalid`,
      email_verified_at: kind === 'CUSTOMER' ? now : null,
      phone_canonical: `+849${String(number).padStart(8, '0')}`,
      password_hash: kind === 'EMPLOYEE' ? null : '$argon2id$fixture-password-hash',
      ...overrides,
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
        [id, `FIXTURE_${number}`, '2000-01-01', 'Fixture address'],
      );
    }
    return id;
  }

  async function intent(overrides: Record<string, unknown> = {}) {
    const number = ++fixtureSequence;
    return insert('registration_intents', {
      full_name: 'Pending schema fixture',
      preferred_locale: 'vi',
      normalization_version: 1,
      date_of_birth: '2000-01-01',
      address: 'Fixture address',
      email_canonical: `pending-${number}@example.invalid`,
      email_delivery: `Pending-${number}@example.invalid`,
      phone_canonical: `+849${String(number).padStart(8, '0')}`,
      password_hash: '$argon2id$fixture-password-hash',
      created_at: now,
      expires_at: future(15),
      ...overrides,
    });
  }

  async function challenge(registrationIntentId: string, overrides: Record<string, unknown> = {}) {
    const candidate = await client.query<{ email_delivery: string }>(
      'SELECT email_delivery FROM registration_intents WHERE id = $1',
      [registrationIntentId],
    );
    return insert('auth_challenges', {
      purpose: 'ACTIVATE_CUSTOMER',
      flow_token_hash: randomBytes(32),
      identity_key: randomBytes(32),
      identity_key_version: 1,
      registration_intent_id: registrationIntentId,
      verifier_digest: randomBytes(32),
      key_version: 1,
      max_attempts: 5,
      delivery_email_snapshot: candidate.rows[0]?.email_delivery,
      created_at: now,
      flow_expires_at: future(15),
      code_generated_at: now,
      code_expires_at: future(5),
      ...overrides,
    });
  }

  async function phase0Snapshot() {
    const snapshot: Record<string, unknown> = {};
    for (const table of ['branches', 'outbox_events', '_prisma_migrations']) {
      const relation = `public.${identifier(table)}`;
      const exists = await client.query<{ exists: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [relation],
      );
      snapshot[table] = exists.rows[0]?.exists
        ? (await client.query<{ count: string }>(`SELECT count(*) FROM ${relation}`)).rows[0]?.count
        : null;
    }
    snapshot['schemas'] = (
      await client.query<{ schemas: string[] }>(
        "SELECT array_agg(nspname::text ORDER BY nspname) AS schemas FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'",
      )
    ).rows[0]?.schemas;
    snapshot['temporaryRoleCount'] = (
      await client.query<{ count: string }>('SELECT count(*) FROM pg_roles WHERE rolname = $1', [
        runtimeRoleName,
      ])
    ).rows[0]?.count;
    return snapshot;
  }

  try {
    const before = await phase0Snapshot();
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
      for (const migrationPath of migrationPaths) {
        await client.query(await readFile(new URL(migrationPath, import.meta.url), 'utf8'));
      }

      // Constraint-focused cases follow. Application authentication behavior is
      // intentionally deferred to its later implementation step.
      await check('both migrations preserve the Phase 0 branch and outbox contract', async () => {
        const branchId = await insert('branches', { code: 'FIXTURE', name: 'Fixture branch' });
        await insert('outbox_events', {
          branch_id: branchId,
          aggregate_type: 'SchemaTest',
          aggregate_id: randomUUID(),
          event_type: 'schema.fixture',
          payload: { fixture: true },
        });
        await rejects(
          () => client.query('DELETE FROM branches WHERE id = $1', [branchId]),
          '23503',
        );
        await rejects(() => client.query('UPDATE outbox_events SET schema_version = 0'));
      });

      await check(
        'canonical identifiers share one unique namespace across account kinds',
        async () => {
          const customer = await user('CUSTOMER', {
            email_canonical: 'shared@example.invalid',
            email_delivery: 'Shared@example.invalid',
            phone_canonical: '+84912345678',
          });
          await rejects(
            () =>
              user('EMPLOYEE', {
                email_canonical: 'shared@example.invalid',
                email_delivery: 'shared@example.invalid',
              }),
            '23505',
          );
          await rejects(() => user('EMPLOYEE', { phone_canonical: '+84912345678' }), '23505');
          await user('EMPLOYEE', { email_canonical: null, email_delivery: null });
          await user('EMPLOYEE', { email_canonical: null, email_delivery: null });
          await rejects(() =>
            client.query('UPDATE users SET kind = $1 WHERE id = $2', ['EMPLOYEE', customer]),
          );
          await rejects(() => user('CUSTOMER', { email_verified_at: null }));
          await rejects(() => user('CUSTOMER', { password_hash: null }));
          await rejects(() => user('EMPLOYEE', { status: 'ACTIVE', password_hash: null }));
          await rejects(() => user('EMPLOYEE', { phone_canonical: null }));
        },
      );

      await check(
        'exact profiles are enforced at transaction boundaries and salary stays nullable',
        async () => {
          const customer = await user('CUSTOMER');
          const employee = await user('EMPLOYEE');
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          await client.query('SET CONSTRAINTS ALL DEFERRED');
          for (const [table, userId] of [
            ['customer_profiles', customer],
            ['employee_profiles', employee],
          ]) {
            assert.ok(table && userId);
            await rejects(async () => {
              await client.query(`DELETE FROM ${identifier(table)} WHERE user_id = $1`, [userId]);
              await client.query('SET CONSTRAINTS ALL IMMEDIATE');
            });
          }
          await rejects(async () => {
            await client.query(
              'INSERT INTO customer_profiles (user_id, date_of_birth, address) VALUES ($1, $2, $3)',
              [employee, '2000-01-01', 'Fixture address'],
            );
            await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          });
          const salary = await client.query<{ base_salary_vnd: string | null }>(
            'SELECT base_salary_vnd FROM employee_profiles WHERE user_id = $1',
            [employee],
          );
          assert.equal(salary.rows[0]?.base_salary_vnd, null);
          await rejects(() =>
            client.query('UPDATE employee_profiles SET base_salary_vnd = -1 WHERE user_id = $1', [
              employee,
            ]),
          );
          await rejects(
            () =>
              client.query('UPDATE employee_profiles SET base_salary_vnd = $1 WHERE user_id = $2', [
                '1.5',
                employee,
              ]),
            '22P02',
          );
          await client.query(
            'UPDATE employee_profiles SET base_salary_vnd = 5000000 WHERE user_id = $1',
            [employee],
          );
          await rejects(() =>
            client.query(
              "UPDATE employee_profiles SET employee_code_canonical = 'invalid lower' WHERE user_id = $1",
              [employee],
            ),
          );
          await rejects(async () => {
            await client.query('TRUNCATE customer_profiles');
            await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          });
        },
      );

      await check(
        'Owner is unique, permanent, ACTIVE and absent from employee authorization rows',
        async () => {
          const owner = await user('OWNER');
          await rejects(() => user('OWNER'), '23505');
          await rejects(() => client.query('DELETE FROM users WHERE id = $1', [owner]));
          await rejects(() =>
            client.query("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [owner]),
          );
          await rejects(() =>
            client.query("UPDATE users SET kind = 'EMPLOYEE' WHERE id = $1", [owner]),
          );
          await flushDeferredConstraints();
          await rejects(() => client.query('TRUNCATE users CASCADE'));
          await rejects(async () => {
            await client.query(
              'INSERT INTO customer_profiles (user_id, date_of_birth, address) VALUES ($1, $2, $3)',
              [owner, '2000-01-01', 'Fixture address'],
            );
            await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          });
        },
      );

      await check(
        'memberships and grants enforce account kinds, scopes and partial uniqueness',
        async () => {
          const employee = await user('EMPLOYEE');
          const customer = await user('CUSTOMER');
          const owner = await user('OWNER');
          const branch = await insert('branches', { code: 'SCOPE', name: 'Scope fixture' });
          const roleValues = {
            code: 'TEST_STAFF',
            display_name_vi: 'Fixture',
            display_name_en: 'Fixture',
          };
          const role = await insert('roles', roleValues);
          await rejects(() => insert('roles', { ...roleValues, code: 'OWNER' }));
          const permission = await insert('permissions', {
            code: 'VIEW_EMPLOYEES',
            scope_capability: 'BRANCH_CAPABLE',
            data_classification: 'STANDARD',
          });
          await rejects(
            () =>
              insert('permissions', {
                code: 'UNKNOWN_ACTION',
                scope_capability: 'BRANCH_CAPABLE',
                data_classification: 'STANDARD',
              }),
            '22P02',
          );
          await client.query(
            'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
            [role, permission],
          );
          await rejects(
            () =>
              client.query(
                'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
                [role, permission],
              ),
            '23505',
          );
          const membership = {
            employee_user_id: employee,
            branch_id: branch,
            granted_by_user_id: owner,
          };
          const membershipId = await insert('employee_branch_assignments', membership);
          await rejects(() => insert('employee_branch_assignments', membership), '23505');
          await client.query(
            'UPDATE employee_branch_assignments SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1',
            [membershipId],
          );
          await insert('employee_branch_assignments', membership);
          await rejects(
            () =>
              insert('employee_branch_assignments', { ...membership, employee_user_id: customer }),
            '23503',
          );

          const assignment = { user_id: employee, role_id: role, scope_kind: 'GLOBAL' };
          await insert('user_role_assignments', assignment);
          await rejects(() => insert('user_role_assignments', assignment), '23505');
          await insert('user_role_assignments', {
            ...assignment,
            scope_kind: 'BRANCH',
            branch_id: branch,
          });
          await rejects(
            () =>
              insert('user_role_assignments', {
                ...assignment,
                scope_kind: 'BRANCH',
                branch_id: branch,
              }),
            '23505',
          );
          await rejects(() =>
            insert('user_role_assignments', { ...assignment, branch_id: branch }),
          );
          await rejects(() =>
            insert('user_role_assignments', { ...assignment, scope_kind: 'BRANCH' }),
          );
          for (const userId of [owner, customer]) {
            await rejects(() =>
              insert('user_role_assignments', { ...assignment, user_id: userId }),
            );
          }
          const override = {
            user_id: employee,
            permission_id: permission,
            effect: 'ALLOW',
            scope_kind: 'GLOBAL',
          };
          await insert('user_permission_overrides', override);
          await rejects(
            () => insert('user_permission_overrides', { ...override, effect: 'DENY' }),
            '23505',
          );
          await insert('user_permission_overrides', {
            ...override,
            scope_kind: 'BRANCH',
            branch_id: branch,
            effect: 'DENY',
          });
          await rejects(
            () =>
              insert('user_permission_overrides', {
                ...override,
                scope_kind: 'BRANCH',
                branch_id: branch,
              }),
            '23505',
          );
          await rejects(() =>
            insert('user_permission_overrides', { ...override, branch_id: branch }),
          );
          await rejects(() =>
            insert('user_permission_overrides', { ...override, scope_kind: 'BRANCH' }),
          );
          for (const userId of [owner, customer]) {
            await rejects(() =>
              insert('user_permission_overrides', { ...override, user_id: userId }),
            );
          }
          await rejects(() => client.query('DELETE FROM roles WHERE id = $1', [role]), '23503');
          await rejects(() => client.query('DELETE FROM users WHERE id = $1', [employee]));
          await rejects(() =>
            client.query('UPDATE employee_branch_assignments SET revoked_at = NULL WHERE id = $1', [
              membershipId,
            ]),
          );
          await rejects(() =>
            client.query('DELETE FROM employee_branch_assignments WHERE id = $1', [membershipId]),
          );
          await rejects(() =>
            client.query("UPDATE permissions SET code = 'CREATE_EMPLOYEES' WHERE id = $1", [
              permission,
            ]),
          );
          await rejects(() =>
            insert('permissions', {
              code: 'VIEW_EMPLOYEE_PAY',
              scope_capability: 'BRANCH_CAPABLE',
              data_classification: 'STANDARD',
            }),
          );
        },
      );

      await check(
        'registration intents do not reserve identities and cannot be revived or retargeted',
        async () => {
          const values = {
            email_canonical: 'pending@example.invalid',
            email_delivery: 'Pending@example.invalid',
            phone_canonical: '+84912345678',
          };
          const first = await intent(values);
          await intent(values);
          await rejects(() =>
            client.query('UPDATE registration_intents SET password_hash = $1 WHERE id = $2', [
              '$argon2id$replacement-fixture-hash',
              first,
            ]),
          );
          await rejects(() =>
            client.query(
              "UPDATE registration_intents SET expires_at = expires_at + INTERVAL '1 minute' WHERE id = $1",
              [first],
            ),
          );
          await client.query(
            'UPDATE registration_intents SET invalidated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [first],
          );
          await rejects(() =>
            client.query('UPDATE registration_intents SET invalidated_at = NULL WHERE id = $1', [
              first,
            ]),
          );
          await rejects(() =>
            client.query(
              'UPDATE registration_intents SET completed_at = CURRENT_TIMESTAMP WHERE id = $1',
              [first],
            ),
          );
        },
      );

      await check(
        'completed registration intents require their matching customer and remain terminal',
        async () => {
          const contact = {
            email_canonical: 'completion@example.invalid',
            email_delivery: 'Completion@example.invalid',
            phone_canonical: '+84987654321',
          };
          const candidate = await intent(contact);
          const matchingCustomer = await user('CUSTOMER', contact);
          const otherCustomer = await user('CUSTOMER');
          await rejects(() =>
            client.query(
              'UPDATE registration_intents SET completed_at = CURRENT_TIMESTAMP, completed_user_id = $1 WHERE id = $2',
              [otherCustomer, candidate],
            ),
          );
          await client.query(
            'UPDATE registration_intents SET completed_at = CURRENT_TIMESTAMP, completed_user_id = $1 WHERE id = $2',
            [matchingCustomer, candidate],
          );
          await rejects(() =>
            client.query(
              'UPDATE registration_intents SET completed_at = NULL, completed_user_id = NULL WHERE id = $1',
              [candidate],
            ),
          );
          await rejects(() => challenge(candidate));
          const expiredCandidate = await intent({
            ...contact,
            created_at: future(-20),
            expires_at: future(-5),
          });
          await rejects(() =>
            client.query(
              'UPDATE registration_intents SET completed_at = $1, completed_user_id = $2 WHERE id = $3',
              [future(-6), matchingCustomer, expiredCandidate],
            ),
          );
        },
      );

      await check(
        'reset and recovery email challenges accept their distinct valid principal shapes',
        async () => {
          const candidate = await intent();
          const customer = await user('CUSTOMER', {
            email_canonical: 'reset@example.invalid',
            email_delivery: 'Reset@example.invalid',
          });
          await challenge(candidate, {
            purpose: 'RESET_PASSWORD',
            registration_intent_id: null,
            user_id: customer,
            credential_version: 1,
            delivery_email_snapshot: 'Reset@example.invalid',
          });
          const employee = await user('EMPLOYEE', {
            status: 'ACTIVE',
            password_hash: '$argon2id$fixture-password-hash',
            email_canonical: 'recovery@example.invalid',
            email_delivery: 'Recovery@example.invalid',
          });
          const recovery = {
            purpose: 'VERIFY_RECOVERY_EMAIL',
            registration_intent_id: null,
            user_id: employee,
            credential_version: 1,
            delivery_email_snapshot: 'Recovery@example.invalid',
          };
          await challenge(candidate, recovery);
          await rejects(() =>
            challenge(candidate, {
              ...recovery,
              user_id: customer,
              delivery_email_snapshot: 'Reset@example.invalid',
            }),
          );
          await rejects(() =>
            challenge(candidate, { ...recovery, delivery_email_snapshot: 'other@example.invalid' }),
          );
        },
      );

      await check(
        'challenges have purpose-bound XOR subjects and one actionable identity per purpose',
        async () => {
          const candidate = await intent();
          const employee = await user('EMPLOYEE');
          const identity = randomBytes(32);
          const flow = await challenge(candidate, { identity_key: identity });
          await rejects(() => challenge(candidate, { identity_key: identity }), '23505');
          await rejects(() => challenge(candidate, { user_id: employee }));
          await rejects(() => challenge(candidate, { registration_intent_id: null }));
          await rejects(() => challenge(candidate, { purpose: 'RESET_PASSWORD' }));
          await rejects(() => challenge(candidate, { failed_attempts: 6 }));
          await rejects(() => challenge(candidate, { flow_token_hash: Buffer.alloc(1) }));
          await rejects(() =>
            client.query('UPDATE auth_challenges SET delivery_email_snapshot = $1 WHERE id = $2', [
              'other@example.invalid',
              flow,
            ]),
          );
          await client.query(
            'UPDATE auth_challenges SET invalidated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [flow],
          );
          await challenge(candidate, { identity_key: identity });
          await rejects(() =>
            client.query('UPDATE auth_challenges SET invalidated_at = NULL WHERE id = $1', [flow]),
          );

          const setupValues = {
            purpose: 'EMPLOYEE_SETUP',
            registration_intent_id: null,
            user_id: employee,
            credential_version: 1,
            authz_version: 1,
            verifier_digest: null,
            key_version: null,
            delivery_email_snapshot: null,
            code_generated_at: null,
            code_expires_at: null,
          };
          await challenge(candidate, setupValues);
          await rejects(() =>
            challenge(candidate, {
              ...setupValues,
              delivery_email_snapshot: 'forbidden@example.invalid',
            }),
          );
          const customer = await user('CUSTOMER');
          await rejects(() => challenge(candidate, { ...setupValues, user_id: customer }));
        },
      );

      await check(
        'challenge resend cannot reset attempts, extend the flow or revive terminal flows',
        async () => {
          const candidate = await intent();
          const flow = await challenge(candidate);
          await client.query('UPDATE auth_challenges SET failed_attempts = 2 WHERE id = $1', [
            flow,
          ]);
          await rejects(() =>
            client.query(
              'UPDATE auth_challenges SET generation = generation + 1, failed_attempts = 0 WHERE id = $1',
              [flow],
            ),
          );
          await rejects(() =>
            client.query(
              "UPDATE auth_challenges SET flow_expires_at = flow_expires_at + INTERVAL '1 minute' WHERE id = $1",
              [flow],
            ),
          );
          await client.query(
            'UPDATE auth_challenges SET generation = generation + 1, verifier_digest = $1 WHERE id = $2',
            [randomBytes(32), flow],
          );
          const attempts = await client.query<{ failed_attempts: number }>(
            'SELECT failed_attempts FROM auth_challenges WHERE id = $1',
            [flow],
          );
          assert.equal(attempts.rows[0]?.failed_attempts, 2);
          await client.query(
            'UPDATE auth_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
            [flow],
          );
          await rejects(() =>
            client.query('UPDATE auth_challenges SET consumed_at = NULL WHERE id = $1', [flow]),
          );
          await rejects(() =>
            client.query('UPDATE auth_challenges SET generation = generation + 1 WHERE id = $1', [
              flow,
            ]),
          );
          const exhausted = await challenge(candidate, { failed_attempts: 5, invalidated_at: now });
          await rejects(() =>
            client.query('UPDATE auth_challenges SET failed_attempts = 0 WHERE id = $1', [
              exhausted,
            ]),
          );
          const expiredCandidate = await intent({
            created_at: future(-20),
            expires_at: future(-5),
          });
          const expired = await challenge(expiredCandidate, {
            created_at: future(-20),
            flow_expires_at: future(-5),
            code_generated_at: future(-10),
            code_expires_at: future(-5),
          });
          await rejects(() =>
            client.query('UPDATE auth_challenges SET consumed_at = $1 WHERE id = $2', [
              future(-6),
              expired,
            ]),
          );
          await rejects(() =>
            client.query(
              'UPDATE auth_challenges SET generation = generation + 1, verifier_digest = $1 WHERE id = $2',
              [randomBytes(32), expired],
            ),
          );
        },
      );

      await check(
        'terminal delivery states require ciphertext erasure and cannot become pending again',
        async () => {
          const flow = await challenge(await intent());
          const deliveryValues = {
            challenge_id: flow,
            generation: 1,
            encrypted_payload: randomBytes(24),
            nonce: randomBytes(12),
            tag: randomBytes(16),
            key_version: 1,
            created_at: now,
            expires_at: future(5),
            next_attempt_at: now,
          };
          const delivery = await insert('auth_deliveries', deliveryValues);
          await rejects(() => insert('auth_deliveries', deliveryValues), '23505');
          await rejects(() =>
            client.query(
              "UPDATE auth_deliveries SET state = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = $1",
              [delivery],
            ),
          );
          await client.query(
            "UPDATE auth_deliveries SET state = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP, encrypted_payload = NULL, nonce = NULL, tag = NULL, key_version = NULL WHERE id = $1",
            [delivery],
          );
          await rejects(() =>
            client.query(
              "UPDATE auth_deliveries SET state = 'PENDING', encrypted_payload = $1, nonce = $2, tag = $3, key_version = 1, delivered_at = NULL WHERE id = $4",
              [randomBytes(24), randomBytes(12), randomBytes(16), delivery],
            ),
          );
          for (const state of ['FAILED', 'INVALIDATED', 'EXPIRED']) {
            const terminalDelivery = await insert('auth_deliveries', {
              ...deliveryValues,
              challenge_id: await challenge(await intent()),
            });
            await rejects(() =>
              client.query('UPDATE auth_deliveries SET state = $1 WHERE id = $2', [
                state,
                terminalDelivery,
              ]),
            );
            await client.query(
              'UPDATE auth_deliveries SET state = $1, encrypted_payload = NULL, nonce = NULL, tag = NULL, key_version = NULL WHERE id = $2',
              [state, terminalDelivery],
            );
          }
        },
      );

      await check('sessions require authentication snapshots iff a user is attached', async () => {
        const customer = await user('CUSTOMER');
        const values = {
          token_hash: randomBytes(32),
          kind: 'ANONYMOUS',
          csrf_key_version: 1,
          created_at: now,
          last_activity_at: now,
          absolute_expires_at: future(15),
        };
        await insert('sessions', values);
        await rejects(() => insert('sessions', values), '23505');
        await rejects(() =>
          insert('sessions', { ...values, token_hash: randomBytes(32), user_id: customer }),
        );
        await rejects(() =>
          insert('sessions', { ...values, token_hash: randomBytes(32), kind: 'AUTHENTICATED' }),
        );
        const authenticated = {
          ...values,
          token_hash: randomBytes(32),
          kind: 'AUTHENTICATED',
          user_id: customer,
          credential_version: 1,
          authz_version: 1,
        };
        await insert('sessions', authenticated);
        await rejects(() =>
          insert('sessions', {
            ...authenticated,
            token_hash: randomBytes(32),
            credential_version: null,
          }),
        );
        await rejects(() =>
          insert('sessions', {
            ...values,
            token_hash: randomBytes(32),
            absolute_expires_at: new Date(now.getTime() - 1000),
          }),
        );
      });

      await check(
        'pseudonymous fixed windows and epoch cooldown buckets have independent uniqueness',
        async () => {
          const values = {
            operation_bucket: 'EMAIL_ISSUANCE',
            pseudonymous_key: randomBytes(32),
            key_version: 1,
            window_started_at: now,
            window_seconds: 3600,
            expires_at: future(120),
          };
          await insert('auth_throttle_buckets', values);
          await rejects(() => insert('auth_throttle_buckets', values), '23505');
          await insert('auth_throttle_buckets', { ...values, window_started_at: future(60) });
          const cooldown = {
            ...values,
            window_seconds: 0,
            window_started_at: new Date(0),
            next_allowed_at: future(1),
          };
          await insert('auth_throttle_buckets', cooldown);
          await rejects(() => insert('auth_throttle_buckets', cooldown), '23505');
          await rejects(() =>
            insert('auth_throttle_buckets', { ...cooldown, window_started_at: now }),
          );
          await rejects(() => insert('auth_throttle_buckets', { ...values, count: -1 }));
        },
      );

      await check(
        'audit history is append-only, protects references and validates actor shape',
        async () => {
          const owner = await user('OWNER');
          const auditValues = {
            action: 'OWNER_BOOTSTRAPPED',
            actor_kind: 'BOOTSTRAP',
            subject_user_id: owner,
            entity_type: 'User',
            entity_id: owner,
            data_classification: 'STANDARD',
            correlation_id: randomUUID(),
          };
          const audit = await insert('audit_events', auditValues);
          await rejects(() =>
            client.query("UPDATE audit_events SET reason = 'changed' WHERE id = $1", [audit]),
          );
          await rejects(() => client.query('DELETE FROM audit_events WHERE id = $1', [audit]));
          await rejects(() => client.query('TRUNCATE audit_events'));
          await rejects(() =>
            insert('audit_events', { ...auditValues, actor_kind: 'USER', actor_user_id: null }),
          );
          await rejects(() => insert('audit_events', { ...auditValues, actor_user_id: owner }));
          await rejects(() =>
            insert('audit_events', { ...auditValues, action: 'BASE_SALARY_CHANGED' }),
          );
          await rejects(() =>
            insert('audit_events', { ...auditValues, after: JSON.stringify(['not-an-object']) }),
          );
          await rejects(
            () => insert('audit_events', { ...auditValues, subject_user_id: randomUUID() }),
            '23503',
          );
        },
      );

      await check(
        'a restricted database role needs explicit bootstrap capability and cannot disable guards',
        async (child) => {
          const privileges = await client.query<{ can_create_role: boolean; quoted_user: string }>(
            'SELECT rolsuper OR rolcreaterole AS can_create_role, quote_ident(current_user) AS quoted_user FROM pg_roles WHERE rolname = current_user',
          );
          if (!privileges.rows[0]?.can_create_role) {
            child.skip(
              'Database credentials lack CREATEROLE; restricted-role bootstrap/DDL boundary was not exercised.',
            );
            return;
          }
          const runtimeRole = identifier(runtimeRoleName);
          await client.query(
            `CREATE ROLE ${runtimeRole} NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT`,
          );
          await client.query(
            `GRANT ${runtimeRole} TO ${privileges.rows[0].quoted_user} WITH SET TRUE`,
          );
          await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
          await client.query(
            `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA ${schema} TO ${runtimeRole}`,
          );
          await client.query(`SET LOCAL ROLE ${runtimeRole}`);
          try {
            await rejects(() => user('OWNER'), '42501');
            await flushDeferredConstraints();
            await rejects(() => client.query('ALTER TABLE users DISABLE TRIGGER ALL'), '42501');
            await rejects(
              () => client.query('ALTER TABLE audit_events DISABLE TRIGGER ALL'),
              '42501',
            );
            await rejects(() => client.query('TRUNCATE audit_events'));
          } finally {
            await client.query('RESET ROLE');
          }
          await client.query(
            `GRANT EXECUTE ON FUNCTION ${schema}.lucy_owner_bootstrap_capability() TO ${runtimeRole}`,
          );
          await client.query(`SET LOCAL ROLE ${runtimeRole}`);
          try {
            const owner = await user('OWNER');
            await rejects(() => client.query('DELETE FROM users WHERE id = $1', [owner]));
            await flushDeferredConstraints();
            await rejects(() => client.query('TRUNCATE users CASCADE'));
          } finally {
            await client.query('RESET ROLE');
          }
        },
      );
    } finally {
      await client.query('ROLLBACK');
    }
    assert.deepEqual(
      await phase0Snapshot(),
      before,
      'Existing Phase 0 tables and migration ledger must be unchanged.',
    );
    const remaining = await client.query<{ count: string }>(
      'SELECT count(*) FROM pg_namespace WHERE nspname = $1',
      [schemaName],
    );
    assert.equal(remaining.rows[0]?.count, '0', 'The isolated test schema must be rolled back.');
    const remainingRole = await client.query<{ count: string }>(
      'SELECT count(*) FROM pg_roles WHERE rolname = $1',
      [runtimeRoleName],
    );
    assert.equal(
      remainingRole.rows[0]?.count,
      '0',
      'The transient runtime role must be rolled back.',
    );
  } finally {
    await client.end();
  }
});
