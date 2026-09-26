import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import type { AdminActor, AdminContext } from '../authorization/admin-command.js';
import { AuthError } from '../auth/auth.error.js';
import {
  assignWaitingSequence,
  cancelWaitingWalkIn,
  createWalkIn,
  normalizeWalkIn,
} from './walkin.core.js';

/**
 * Walk-in races with real connections. A third transaction holds the contended row lock (the
 * KTV's user row, or the visit row) until both operations are observed waiting on it in
 * pg_stat_activity, then releases it: PostgreSQL's lock queue decides the order, never timing.
 * Fixtures are committed and removed afterwards with replica role (local superuser test
 * databases only), matched by their unique markers: IT-WIR-*, WIR_*, wir-*@example.invalid.
 */
test(
  'Walk-in races: one KTV claim per interval; one assignment per waiting sequence (committed, cleaned up)',
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
      late: randomUUID(),
      leaving: randomUUID(),
      staff: randomUUID(),
    };
    try {
      // A zone where it is about noon now, so the whole test stays on one branch-local day.
      const [clock] = await database.$queryRaw<{ now: Date; hour: number }[]>`
        SELECT now() AS now, extract(hour FROM now() AT TIME ZONE 'UTC')::int AS hour`;
      const offset = 12 - clock!.hour;
      const zone = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
      const today = new Date(clock!.now.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
      const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');

      await database.branch.create({
        data: { id: ids.branch, code: `IT-WIR-${run}`, name: 'Walk-in race', timezone: zone },
      });
      for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday += 1) {
        await database.branchOperatingHours.create({
          data: { branchId: ids.branch, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
        });
      }
      await database.skill.create({
        data: { id: ids.skill, code: `WIR_${run}`, nameVi: 'R', nameEn: 'R' },
      });
      await database.serviceCategory.create({
        data: { id: ids.category, code: `WIR_${run}`, nameVi: 'R', nameEn: 'R' },
      });
      await database.service.create({
        data: {
          id: ids.service,
          code: `WIR_${run}`,
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
      await database.serviceSkill.create({ data: { serviceId: ids.service, skillId: ids.skill } });
      await database.serviceBranchAvailability.create({
        data: { serviceId: ids.service, branchId: ids.branch },
      });
      for (const [index, id] of [ids.ktv, ids.late, ids.staff, ids.leaving].entries()) {
        await database.user.create({
          data: {
            id,
            kind: 'EMPLOYEE',
            status: 'ACTIVE',
            fullName: `WIR ${index}`,
            preferredLocale: 'vi',
            emailCanonical: `wir-${index}-${run.toLowerCase()}@example.invalid`,
            emailDelivery: `wir-${index}-${run.toLowerCase()}@example.invalid`,
            emailVerifiedAt: new Date(),
            phoneCanonical: `+849${phoneBase}${String(index).padStart(3, '0')}`,
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture-password-hash',
            employeeProfile: {
              create: {
                employeeCodeCanonical: `WIR_${run}_${index}`,
                dateOfBirth: new Date('1990-01-01'),
                address: 'R',
              },
            },
          },
        });
        await database.employeeBranchAssignment.create({
          data: { employeeUserId: id, branchId: ids.branch, grantedByUserId: id },
        });
      }
      for (const id of [ids.ktv, ids.late, ids.leaving]) {
        await database.employmentClassificationChange.create({
          data: {
            employeeUserId: id,
            classification: 'OFFICIAL_EMPLOYEE',
            effectiveDate: new Date('2026-01-01'),
          },
        });
        await database.employeeSkill.create({
          data: { employeeUserId: id, skillId: ids.skill, grantedByUserId: id },
        });
      }
      // Only ids.ktv is checked in for now; ids.late checks in during the second race.
      const checkIn = (employeeUserId: string) =>
        database.attendanceRecord.create({
          data: {
            employeeUserId,
            branchId: ids.branch,
            businessDate: new Date(today),
            checkInAt: new Date(clock!.now.getTime() - 60 * 60_000),
          },
        });
      await checkIn(ids.ktv);

      const contextFor = (tx: Prisma.TransactionClient): AdminContext => ({
        tx,
        now: new Date(),
        actor: { userId: ids.staff } as AdminActor,
        requestId: null,
      });
      const walkIn = (requested: string) =>
        normalizeWalkIn({
          idempotencyKey: randomUUID(),
          participants: [{ key: 'g', kind: 'GUEST', displayName: 'Khách' }],
          lines: [
            { participantKey: 'g', serviceId: ids.service, requestedEmployeeUserId: requested },
          ],
        });

      /** Runs both operations while a third transaction holds the given row lock. */
      const race = async <A, B>(
        lockSql: (tx: Prisma.TransactionClient) => Promise<unknown>,
        waitingQuery: string,
        first: (tx: Prisma.TransactionClient) => Promise<A>,
        second: (tx: Prisma.TransactionClient) => Promise<B>,
      ) => {
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let locked!: () => void;
        const holding = new Promise<void>((resolve) => (locked = resolve));
        const holder = database.$transaction(
          async (tx) => {
            await lockSql(tx);
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
              AND query ILIKE ${waitingQuery}`;
          if (Number(row?.n ?? 0) >= 2) break;
          if (Date.now() > deadline) throw new Error('Operations never queued on the lock.');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        release();
        await holder;
        return Promise.allSettled(attempts);
      };
      const lineStates = (employeeUserId: string) =>
        database.visitServiceLine.findMany({
          where: { visit: { branchId: ids.branch }, requestedEmployeeUserId: employeeUserId },
          select: { id: true, status: true, employeeUserId: true },
        });
      const claimsOf = (employeeUserId: string) =>
        database.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM ktv_occupancies WHERE employee_user_id = ${employeeUserId}::uuid`.then(
          (rows) => Number(rows[0]?.n ?? 0),
        );

      await context.test(
        'two walk-ins for the same KTV now: one assigned, the other waits',
        async () => {
          const [a, b] = await race(
            (tx) => tx.$queryRaw`SELECT id FROM users WHERE id = ${ids.ktv}::uuid FOR UPDATE`,
            '%FROM users WHERE id = ANY%FOR UPDATE%',
            (tx) => createWalkIn(contextFor(tx), ids.branch, walkIn(ids.ktv)),
            (tx) => createWalkIn(contextFor(tx), ids.branch, walkIn(ids.ktv)),
          );
          assert.equal(a.status, 'fulfilled', 'intake never fails for lack of capacity');
          assert.equal(b.status, 'fulfilled');
          const lines = await lineStates(ids.ktv);
          assert.deepEqual(lines.map((line) => line.status).sort(), ['PLANNED', 'WAITING']);
          assert.equal(lines.find((line) => line.status === 'WAITING')?.employeeUserId, null);
          assert.equal(await claimsOf(ids.ktv), 1, 'no double claim');
          assert.equal(await database.visit.count({ where: { branchId: ids.branch } }), 2);
        },
      );

      await context.test(
        'two assignments of the same waiting visit: one claim, one event',
        async () => {
          // The KTV is not checked in yet: the walk-in waits for them.
          const created = await database.$transaction((tx) =>
            createWalkIn(contextFor(tx), ids.branch, walkIn(ids.late)),
          );
          const [waitingLine] = await lineStates(ids.late);
          assert.equal(waitingLine?.status, 'WAITING');
          await checkIn(ids.late);
          const participant = await database.visitParticipant.findFirstOrThrow({
            where: { visitId: created.visitId },
            select: { id: true },
          });
          const assign = (tx: Prisma.TransactionClient) =>
            assignWaitingSequence(contextFor(tx), created.visitId, participant.id, () => undefined);
          const [a, b] = await race(
            (tx) =>
              tx.$queryRaw`SELECT id FROM visits WHERE id = ${created.visitId}::uuid FOR UPDATE`,
            '%FROM visits WHERE id =%FOR UPDATE%',
            assign,
            assign,
          );
          assert.equal(a.status, 'fulfilled');
          assert.equal(b.status, 'fulfilled');
          assert.deepEqual(
            [a, b].map(
              (result) => (result as PromiseFulfilledResult<{ assigned: boolean }>).value.assigned,
            ),
            [true, true],
            'the second sees the sequence already assigned',
          );
          const [line] = await lineStates(ids.late);
          assert.deepEqual([line?.status, line?.employeeUserId], ['PLANNED', ids.late]);
          assert.equal(await claimsOf(ids.late), 1);
          assert.equal(
            await database.outboxEvent.count({
              where: { aggregateId: created.visitId, eventType: 'VISIT_LINE_SCHEDULED' },
            }),
            1,
          );
        },
      );

      await context.test(
        'cancel vs assignment of the same waiting walk-in: one valid lifecycle',
        async () => {
          const created = await database.$transaction((tx) =>
            createWalkIn(contextFor(tx), ids.branch, walkIn(ids.leaving)),
          );
          const participant = await database.visitParticipant.findFirstOrThrow({
            where: { visitId: created.visitId },
            select: { id: true },
          });
          await checkIn(ids.leaving);
          const [cancel, assign] = await race(
            (tx) =>
              tx.$queryRaw`SELECT id FROM visits WHERE id = ${created.visitId}::uuid FOR UPDATE`,
            '%FROM visits WHERE id =%FOR UPDATE%',
            (tx) =>
              cancelWaitingWalkIn(contextFor(tx), created.visitId, 'Khách về', () => undefined),
            (tx) =>
              assignWaitingSequence(
                contextFor(tx),
                created.visitId,
                participant.id,
                () => undefined,
              ),
          );
          assert.equal(cancel.status, 'fulfilled', 'the cancellation always succeeds before START');
          if (assign.status === 'rejected') {
            // Cancellation won: the assignment is refused, nothing was ever claimed.
            assert.ok(
              assign.reason instanceof AuthError && assign.reason.code === 'WALKIN_NOT_ASSIGNABLE',
            );
          } else {
            // Assignment won: its planned line was then cancelled before START.
            assert.equal(assign.value.assigned, true);
          }
          const visit = await database.visit.findUniqueOrThrow({
            where: { id: created.visitId },
            select: { status: true, lines: { select: { status: true } } },
          });
          assert.equal(visit.status, 'CANCELLED');
          assert.deepEqual(
            visit.lines.map((line) => line.status),
            ['CANCELLED'],
          );
          assert.equal(await claimsOf(ids.leaving), 0, 'no occupancy survives a cancelled walk-in');
        },
      );
    } finally {
      await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        for (const statement of [
          `CREATE TEMP TABLE wir_branches ON COMMIT DROP AS SELECT id FROM branches WHERE code LIKE 'IT-WIR-%'`,
          `CREATE TEMP TABLE wir_users ON COMMIT DROP AS SELECT id FROM users WHERE email_canonical LIKE 'wir-%@example.invalid'`,
          `CREATE TEMP TABLE wir_visits ON COMMIT DROP AS SELECT id FROM visits WHERE branch_id IN (SELECT id FROM wir_branches)`,
          `CREATE TEMP TABLE wir_services ON COMMIT DROP AS SELECT id FROM services WHERE code LIKE 'WIR\\_%'`,
          `DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id::text FROM wir_visits)`,
          `DELETE FROM audit_events WHERE actor_user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM ktv_occupancies WHERE employee_user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM visit_service_lines WHERE visit_id IN (SELECT id FROM wir_visits)`,
          `DELETE FROM visit_participants WHERE visit_id IN (SELECT id FROM wir_visits)`,
          `DELETE FROM visits WHERE id IN (SELECT id FROM wir_visits)`,
          `DELETE FROM attendance_records WHERE employee_user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM employee_skills WHERE employee_user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM employee_branch_assignments WHERE employee_user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM employment_classification_changes WHERE employee_user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM employee_profiles WHERE user_id IN (SELECT id FROM wir_users)`,
          `DELETE FROM users WHERE id IN (SELECT id FROM wir_users)`,
          `DELETE FROM service_branch_availability WHERE service_id IN (SELECT id FROM wir_services)`,
          `DELETE FROM service_skills WHERE service_id IN (SELECT id FROM wir_services)`,
          `DELETE FROM services WHERE id IN (SELECT id FROM wir_services)`,
          `DELETE FROM service_categories WHERE code LIKE 'WIR\\_%'`,
          `DELETE FROM skills WHERE code LIKE 'WIR\\_%'`,
          `DELETE FROM branch_operating_hours WHERE branch_id IN (SELECT id FROM wir_branches)`,
          `DELETE FROM branches WHERE id IN (SELECT id FROM wir_branches)`,
        ]) {
          await tx.$executeRawUnsafe(statement);
        }
      });
      assert.equal(
        await database.branch.count({ where: { code: { startsWith: 'IT-WIR-' } } }),
        0,
        'cleaned up',
      );
      await database.$disconnect();
    }
  },
);
