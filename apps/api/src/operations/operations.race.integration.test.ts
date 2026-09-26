import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { AdminActor, AdminContext } from '../authorization/admin-command.js';
import { arriveBooking, markNoShow } from './operations.core.js';

/**
 * Arrival races with real connections (contract §16). A third transaction holds the booking
 * row lock until both operations are observed waiting on it (pg_stat_activity), then releases
 * it: PostgreSQL's lock queue decides the order, never timing. Fixtures are committed (the
 * transactions must see each other) and removed afterwards with replica role (local superuser
 * test databases only), matched by their unique markers: IT-OPR-*, OPR_*, opr-*@example.invalid.
 */
test(
  'Operational arrival races: one visit; arrival vs NO_SHOW serializes (committed, cleaned up)',
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
      service: randomUUID(),
      ktv: randomUUID(),
      staff: randomUUID(),
      customer: randomUUID(),
    };
    try {
      const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
      await database.branch.create({
        data: { id: ids.branch, code: `IT-OPR-${run}`, name: 'Race ops', timezone: 'UTC' },
      });
      await database.serviceCategory.create({
        data: { id: ids.category, code: `OPR_${run}`, nameVi: 'R', nameEn: 'R' },
      });
      await database.service.create({
        data: {
          id: ids.service,
          code: `OPR_${run}`,
          categoryId: ids.category,
          nameVi: 'R',
          nameEn: 'R',
          priceVnd: 1n,
          priceMaxVnd: 1n,
          durationMinutes: 30,
          estimatedMinMinutes: 30,
          estimatedMaxMinutes: 30,
        },
      });
      for (const [index, [id, kind]] of (
        [
          [ids.ktv, 'EMPLOYEE'],
          [ids.staff, 'EMPLOYEE'],
          [ids.customer, 'CUSTOMER'],
        ] as const
      ).entries()) {
        await database.user.create({
          data: {
            id,
            kind,
            status: 'ACTIVE',
            fullName: `Race ${index}`,
            preferredLocale: 'vi',
            emailCanonical: `opr-${index}-${run.toLowerCase()}@example.invalid`,
            emailDelivery: `opr-${index}-${run.toLowerCase()}@example.invalid`,
            emailVerifiedAt: new Date(),
            phoneCanonical: `+849${phoneBase}${String(index).padStart(3, '0')}`,
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture-password-hash',
            ...(kind === 'CUSTOMER'
              ? {
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-01-01'), address: 'R' },
                  },
                }
              : {
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `OPR_${run}_${index}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'R',
                    },
                  },
                }),
          },
        });
      }
      const [clock] = await database.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      let sequence = 0;
      /** A CONFIRMED booking whose hold has expired (arrival and NO_SHOW both possible). */
      const booking = async () => {
        sequence += 1;
        const startsAt = new Date(clock!.now.getTime() - (40 + sequence * 31) * 60_000);
        const created = await database.booking.create({
          data: {
            code: `BK-OPR${sequence}-${run}`,
            branchId: ids.branch,
            ownerUserId: ids.customer,
            channel: 'DESK',
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000),
            serviceDate: new Date(startsAt.toISOString().slice(0, 10)),
            idempotencyKey: randomUUID(),
            createdByUserId: ids.staff,
          },
          select: { id: true },
        });
        const recipient = await database.bookingRecipient.create({
          data: { bookingId: created.id, relation: 'SELF' },
          select: { id: true },
        });
        await database.bookingServiceLine.create({
          data: {
            bookingId: created.id,
            recipientId: recipient.id,
            sequence: 1,
            serviceId: ids.service,
            employeeUserId: ids.ktv,
            assignmentMode: 'SPECIFIC',
            plannedStartAt: startsAt,
            plannedEndAt: new Date(startsAt.getTime() + 30 * 60_000),
            durationMinutes: 30,
            bufferMinutes: 0,
            serviceCode: 'R',
            serviceNameVi: 'R',
            serviceNameEn: 'R',
            catalogPriceMinVnd: 1n,
            catalogPriceMaxVnd: 1n,
            catalogPricingUnit: 'PER_SERVICE',
          },
        });
        return created.id;
      };
      const contextFor = (tx: Prisma.TransactionClient): AdminContext => ({
        tx,
        now: new Date(),
        actor: { userId: ids.staff } as AdminActor,
        requestId: null,
      });
      const allow = () => undefined;

      /** Runs both operations while a third transaction holds the booking lock. */
      const race = async <A, B>(
        bookingId: string,
        first: (tx: Prisma.TransactionClient) => Promise<A>,
        second: (tx: Prisma.TransactionClient) => Promise<B>,
      ) => {
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        const holding = new Promise<void>((resolve) => (locked = resolve));
        const holder = database.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
            locked();
            await released;
          },
          { timeout: 60_000 },
        );
        await holding;
        const attempts = [
          database.$transaction(first, { timeout: 60_000 }),
          database.$transaction(second, { timeout: 60_000 }),
        ] as const;
        const deadline = Date.now() + 15_000;
        for (;;) {
          const [row] = await database.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query ILIKE '%FROM bookings WHERE id =%FOR UPDATE%'`;
          if (Number(row?.n ?? 0) >= 2) break;
          if (Date.now() > deadline) throw new Error('Operations never queued on the lock.');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        release();
        await holder;
        return Promise.allSettled(attempts);
      };
      const reason = (result: PromiseSettledResult<unknown>) =>
        result.status === 'rejected'
          ? result.reason instanceof AuthError
            ? result.reason.code
            : String(result.reason)
          : 'OK';

      await context.test(
        'two devices mark the same arrival: one visit, same id for both',
        async () => {
          const id = await booking();
          const [a, b] = await race(
            id,
            (tx) => arriveBooking(contextFor(tx), id, allow),
            (tx) => arriveBooking(contextFor(tx), id, allow),
          );
          assert.equal(a.status, 'fulfilled');
          assert.equal(b.status, 'fulfilled');
          assert.equal(
            (a as PromiseFulfilledResult<string>).value,
            (b as PromiseFulfilledResult<string>).value,
          );
          assert.equal(await database.visit.count({ where: { bookingId: id } }), 1);
          assert.equal(
            await database.outboxEvent.count({
              where: { aggregateId: id, eventType: 'CUSTOMER_ARRIVED' },
            }),
            1,
          );
        },
      );

      await context.test(
        'arrival vs NO_SHOW: exactly one wins; never NO_SHOW with a visit',
        async () => {
          const id = await booking();
          const [arrival, noShow] = await race(
            id,
            (tx) => arriveBooking(contextFor(tx), id, allow),
            (tx) => markNoShow(contextFor(tx), id, 'race', allow),
          );
          const outcome = [reason(arrival), reason(noShow)];
          const final = await database.booking.findUniqueOrThrow({
            where: { id },
            select: { status: true, visit: { select: { id: true } } },
          });
          const claims = await database.$queryRaw<{ booking: bigint; visit: bigint }[]>`
          SELECT count(o.booking_service_line_id) AS booking, count(o.visit_service_line_id) AS visit
          FROM ktv_occupancies o
          LEFT JOIN booking_service_lines bl ON bl.id = o.booking_service_line_id
          LEFT JOIN visit_service_lines vl ON vl.id = o.visit_service_line_id
          WHERE bl.booking_id = ${id}::uuid OR vl.visit_id IN (SELECT id FROM visits WHERE booking_id = ${id}::uuid)`;
          const held = [Number(claims[0]!.booking), Number(claims[0]!.visit)];
          if (final.status === 'CHECKED_IN') {
            assert.deepEqual(outcome, ['OK', 'BOOKING_NO_SHOW_NOT_ALLOWED']);
            assert.ok(final.visit, 'an arrived booking has its visit');
            assert.deepEqual(held, [0, 1], 'the reservation moved to the visit, not released');
          } else {
            assert.equal(final.status, 'NO_SHOW');
            assert.deepEqual(outcome, ['BOOKING_ARRIVAL_NOT_ALLOWED', 'OK']);
            assert.equal(final.visit, null, 'no visit for a no-show');
            assert.deepEqual(held, [0, 0], 'the reservation is released');
          }
        },
      );
    } finally {
      await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        for (const statement of [
          `CREATE TEMP TABLE opr_branches ON COMMIT DROP AS SELECT id FROM branches WHERE code LIKE 'IT-OPR-%'`,
          `CREATE TEMP TABLE opr_users ON COMMIT DROP AS SELECT id FROM users WHERE email_canonical LIKE 'opr-%@example.invalid'`,
          `CREATE TEMP TABLE opr_bookings ON COMMIT DROP AS SELECT id FROM bookings WHERE branch_id IN (SELECT id FROM opr_branches)`,
          `CREATE TEMP TABLE opr_visits ON COMMIT DROP AS SELECT id FROM visits WHERE branch_id IN (SELECT id FROM opr_branches)`,
          `DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id::text FROM opr_bookings)`,
          `DELETE FROM audit_events WHERE actor_user_id IN (SELECT id FROM opr_users)`,
          `DELETE FROM ktv_occupancies WHERE employee_user_id IN (SELECT id FROM opr_users)`,
          `DELETE FROM visit_service_lines WHERE visit_id IN (SELECT id FROM opr_visits)`,
          `DELETE FROM visit_participants WHERE visit_id IN (SELECT id FROM opr_visits)`,
          `DELETE FROM visits WHERE id IN (SELECT id FROM opr_visits)`,
          `DELETE FROM booking_service_lines WHERE booking_id IN (SELECT id FROM opr_bookings)`,
          `DELETE FROM booking_recipients WHERE booking_id IN (SELECT id FROM opr_bookings)`,
          `DELETE FROM bookings WHERE id IN (SELECT id FROM opr_bookings)`,
          `DELETE FROM employee_profiles WHERE user_id IN (SELECT id FROM opr_users)`,
          `DELETE FROM customer_profiles WHERE user_id IN (SELECT id FROM opr_users)`,
          `DELETE FROM users WHERE id IN (SELECT id FROM opr_users)`,
          `DELETE FROM services WHERE code LIKE 'OPR\\_%'`,
          `DELETE FROM service_categories WHERE code LIKE 'OPR\\_%'`,
          `DELETE FROM branches WHERE id IN (SELECT id FROM opr_branches)`,
        ]) {
          await tx.$executeRawUnsafe(statement);
        }
      });
      assert.equal(
        await database.branch.count({ where: { code: { startsWith: 'IT-OPR-' } } }),
        0,
        'cleaned up',
      );
      await database.$disconnect();
    }
  },
);
