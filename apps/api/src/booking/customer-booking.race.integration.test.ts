import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { createCustomerBooking, type NormalizedBookingRequest } from './booking.core.js';
import { validVnMobile } from '../testing/phone.js';

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The same-slot race (contract section 16), with real concurrent connections. Two customers
 * book the same KTV and time. A third transaction holds that KTV's row lock until both
 * booking transactions are observed waiting on it (pg_stat_activity), then releases it: the
 * order is decided by PostgreSQL's lock queue, not by timing. Exactly one booking must win;
 * the other re-checks under the lock and gets a stable conflict with nothing persisted.
 *
 * The transactions must commit to be visible to each other, so fixtures are committed and
 * removed afterwards. Booking history is protected by guard triggers, so cleanup runs with
 * `session_replication_role = replica` (local superuser test databases only) and deletes
 * exactly the rows this test created.
 */
test(
  'Customer booking race: lock, re-check and one winner (committed fixtures, cleaned up)',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit integration tests.');
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      skill: randomUUID(),
      service: randomUUID(),
      ktv: randomUUID(),
      customers: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    };
    const users = [ids.ktv, ...ids.customers];
    try {
      // ------------------------------------------------------------------ committed fixtures
      await database.branch.create({
        data: {
          id: ids.branch,
          code: `IT-RACE-${run}`,
          name: 'Race branch',
          timezone: 'Asia/Ho_Chi_Minh',
        },
      });
      for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday += 1) {
        await database.branchOperatingHours.create({
          data: { branchId: ids.branch, isoWeekday, opensAtMinute: 540, closesAtMinute: 1260 },
        });
      }
      await database.skill.create({
        data: { id: ids.skill, code: `RACE_${run}`, nameVi: 'Race', nameEn: 'Race' },
      });
      await database.serviceCategory.create({
        data: { id: ids.category, code: `RACE_${run}`, nameVi: 'Race', nameEn: 'Race' },
      });
      await database.service.create({
        data: {
          id: ids.service,
          code: `RACE_${run}`,
          categoryId: ids.category,
          nameVi: 'Race',
          nameEn: 'Race',
          priceVnd: 100_000n,
          priceMaxVnd: 100_000n,
          durationMinutes: 60,
          estimatedMinMinutes: 60,
          estimatedMaxMinutes: 60,
        },
      });
      await database.serviceSkill.create({ data: { serviceId: ids.service, skillId: ids.skill } });
      await database.serviceBranchAvailability.create({
        data: { serviceId: ids.service, branchId: ids.branch },
      });
      for (const [index, id] of users.entries()) {
        const kind = id === ids.ktv ? 'EMPLOYEE' : 'CUSTOMER';
        await database.user.create({
          data: {
            id,
            kind,
            status: 'ACTIVE',
            fullName: `Race ${index}`,
            preferredLocale: 'vi',
            emailCanonical: `race-${index}-${run.toLowerCase()}@example.invalid`,
            emailDelivery: `race-${index}-${run.toLowerCase()}@example.invalid`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture-password-hash',
            ...(kind === 'CUSTOMER'
              ? {
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'Race' },
                  },
                }
              : {
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `RACE_${run}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Race',
                    },
                  },
                }),
          },
        });
      }
      await database.employmentClassificationChange.create({
        data: {
          employeeUserId: ids.ktv,
          classification: 'OFFICIAL_EMPLOYEE',
          effectiveDate: new Date('2026-01-01'),
        },
      });
      await database.employeeBranchAssignment.create({
        data: { employeeUserId: ids.ktv, branchId: ids.branch, grantedByUserId: ids.ktv },
      });
      await database.employeeSkill.create({
        data: { employeeUserId: ids.ktv, skillId: ids.skill, grantedByUserId: ids.ktv },
      });
      const [clock] = await database.$queryRaw<{ today: string }[]>`
        SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS today`;
      const date = addDays(clock!.today, 2);

      const race = async (
        startTime: string,
        employeeUserId: string | null,
        customers: [string, string],
      ) => {
        const requestFor = (): NormalizedBookingRequest => ({
          idempotencyKey: randomUUID(),
          branchId: ids.branch,
          date,
          startMinute: Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)),
          recipients: [{ key: 'me', relation: 'SELF', displayName: null, phone: null }],
          lines: [{ serviceId: ids.service, recipientKey: 'me', employeeUserId }],
        });
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        const holding = new Promise<void>((resolve) => (locked = resolve));
        const holder = database.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${ids.ktv}::uuid FOR UPDATE`;
            locked();
            await released;
          },
          { timeout: 60_000 },
        );
        await holding;
        const attempts = customers.map((customer) =>
          database.$transaction(
            (tx) => createCustomerBooking(tx, customer, requestFor(), new Date()),
            { timeout: 60_000 },
          ),
        );
        // Wait (bounded) until both booking transactions are blocked on the held row lock.
        const deadline = Date.now() + 15_000;
        for (;;) {
          const [row] = await database.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE '%FROM users WHERE id = ANY%FOR UPDATE%'`;
          if (Number(row?.n ?? 0) >= 2) break;
          if (Date.now() > deadline)
            throw new Error('Booking transactions never queued on the lock.');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        release();
        await holder;
        return Promise.allSettled(attempts);
      };
      const outcome = (results: PromiseSettledResult<string>[]) => ({
        won: results.filter((result) => result.status === 'fulfilled').length,
        codes: results.flatMap((result) =>
          result.status === 'rejected'
            ? [result.reason instanceof AuthError ? result.reason.code : String(result.reason)]
            : [],
        ),
      });
      const heldAt = (time: string) =>
        database.bookingServiceLine.count({
          where: {
            employeeUserId: ids.ktv,
            plannedStartAt: new Date(`${date}T${time}:00+07:00`),
            booking: { status: 'CONFIRMED' },
          },
        });

      await context.test(
        'specific KTV: one booking wins, the other gets KTV_UNAVAILABLE',
        async () => {
          const result = outcome(
            await race('10:00', ids.ktv, [ids.customers[0]!, ids.customers[1]!]),
          );
          assert.deepEqual(result, { won: 1, codes: ['BOOKING_KTV_UNAVAILABLE'] });
          assert.equal(await heldAt('10:00'), 1);
          assert.equal(
            await database.booking.count({ where: { branchId: ids.branch } }),
            1,
            'the losing transaction left no partial booking',
          );
        },
      );

      await context.test(
        'Any KTV: the loser gets SLOT_UNAVAILABLE (shown free, then taken)',
        async () => {
          const result = outcome(await race('14:00', null, [ids.customers[2]!, ids.customers[3]!]));
          assert.deepEqual(result, { won: 1, codes: ['BOOKING_SLOT_UNAVAILABLE'] });
          assert.equal(await heldAt('14:00'), 1);
        },
      );
    } finally {
      // Removes every race fixture (this run and any interrupted earlier run): branches
      // `IT-RACE-*`, codes `RACE_*`, users `race-*@example.invalid`, and their booking rows.
      await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        for (const statement of [
          `CREATE TEMP TABLE race_branches ON COMMIT DROP AS SELECT id FROM branches WHERE code LIKE 'IT-RACE-%'`,
          `CREATE TEMP TABLE race_users ON COMMIT DROP AS SELECT id FROM users WHERE email_canonical LIKE 'race-%@example.invalid'`,
          `CREATE TEMP TABLE race_bookings ON COMMIT DROP AS SELECT id FROM bookings WHERE branch_id IN (SELECT id FROM race_branches)`,
          `CREATE TEMP TABLE race_services ON COMMIT DROP AS SELECT id FROM services WHERE code LIKE 'RACE\\_%'`,
        ]) {
          await tx.$executeRawUnsafe(statement);
        }
        for (const statement of [
          `DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id::text FROM race_bookings)`,
          `DELETE FROM ktv_occupancies WHERE employee_user_id IN (SELECT id FROM race_users)`,
          `DELETE FROM booking_service_lines WHERE booking_id IN (SELECT id FROM race_bookings)`,
          `DELETE FROM booking_recipients WHERE booking_id IN (SELECT id FROM race_bookings)`,
          `DELETE FROM bookings WHERE id IN (SELECT id FROM race_bookings)`,
          `DELETE FROM employee_skills WHERE employee_user_id IN (SELECT id FROM race_users)`,
          `DELETE FROM employee_branch_assignments WHERE employee_user_id IN (SELECT id FROM race_users)`,
          `DELETE FROM employment_classification_changes WHERE employee_user_id IN (SELECT id FROM race_users)`,
          `DELETE FROM employee_profiles WHERE user_id IN (SELECT id FROM race_users)`,
          `DELETE FROM customer_profiles WHERE user_id IN (SELECT id FROM race_users)`,
          `DELETE FROM users WHERE id IN (SELECT id FROM race_users)`,
          `DELETE FROM service_branch_availability WHERE service_id IN (SELECT id FROM race_services)`,
          `DELETE FROM service_skills WHERE service_id IN (SELECT id FROM race_services)`,
          `DELETE FROM services WHERE id IN (SELECT id FROM race_services)`,
          `DELETE FROM service_categories WHERE code LIKE 'RACE\\_%'`,
          `DELETE FROM skills WHERE code LIKE 'RACE\\_%'`,
          `DELETE FROM branch_operating_hours WHERE branch_id IN (SELECT id FROM race_branches)`,
          `DELETE FROM branches WHERE id IN (SELECT id FROM race_branches)`,
        ]) {
          await tx.$executeRawUnsafe(statement);
        }
      });
      assert.equal(
        await database.branch.count({ where: { code: { startsWith: 'IT-RACE-' } } }),
        0,
        'cleaned up',
      );
      await database.$disconnect();
    }
  },
);
