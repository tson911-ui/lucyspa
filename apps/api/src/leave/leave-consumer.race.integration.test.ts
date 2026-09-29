import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog } from '@lucy-spa/database';
import { leaveRequestedPayload, processLeaveEvent } from '@lucy-spa/server';

/**
 * Real concurrency: several database connections COMMIT and race for the same Leave events.
 * It writes committed rows, so it only runs against an explicitly named scratch database
 * (`NOTIFICATION_RACE_DATABASE_URL`, never the main DATABASE_URL) whose role is a superuser
 * (replica-role cleanup, as the existing Phase 3 race tests do). Otherwise it is skipped.
 */
const raceUrl = process.env['NOTIFICATION_RACE_DATABASE_URL'];
test(
  'leave consumer: concurrent workers process each event exactly once; failures leave nothing behind',
  { skip: raceUrl ? false : 'NOTIFICATION_RACE_DATABASE_URL is not set' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const database = createDatabaseClient(raceUrl!);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const users: string[] = [];
    const roles: string[] = [];
    const leaves: string[] = [];
    const events: string[] = [];
    let branchId = '';
    try {
      await database.$connect();
      const [role] = await database.$queryRaw<
        { rolsuper: boolean }[]
      >`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
      assert.ok(role?.rolsuper, 'the scratch database role must be a superuser for cleanup');
      await database.$transaction((tx) => syncPermissionCatalog(tx));
      const permission = await database.permission.findUniqueOrThrow({
        where: { code: 'APPROVE_LEAVE' },
        select: { id: true },
      });
      branchId = (
        await database.branch.create({ data: { code: `RACE-${run}`, name: 'Race branch' } })
      ).id;
      let sequence = 0;
      const employee = async () => {
        sequence += 1;
        const id = randomUUID();
        users.push(id);
        await database.user.create({
          data: {
            id,
            kind: 'EMPLOYEE',
            status: 'ACTIVE',
            fullName: `Race ${sequence}`,
            preferredLocale: 'vi',
            emailCanonical: `race-${sequence}-${run.toLowerCase()}@example.com`,
            emailDelivery: `race-${sequence}-${run.toLowerCase()}@example.com`,
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            phoneCanonical: `+84912${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
            employeeProfile: {
              create: {
                employeeCodeCanonical: `RACE-${sequence}-${run}`,
                dateOfBirth: new Date('1990-01-01'),
                address: 'Fixture',
              },
            },
          },
        });
        await database.employmentClassificationChange.create({
          data: {
            employeeUserId: id,
            classification: 'OFFICIAL_EMPLOYEE',
            effectiveDate: new Date('2020-01-01'),
          },
        });
        await database.employeeBranchAssignment.create({
          data: { employeeUserId: id, branchId, grantedByUserId: id },
        });
        return id;
      };
      const managers: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const id = await employee();
        managers.push(id);
        const role = await database.role.create({
          data: {
            code: `RACE_${run}_${index}`,
            displayNameVi: 'Vai trò',
            displayNameEn: 'Role',
            permissions: { create: [{ permissionId: permission.id }] },
          },
        });
        roles.push(role.id);
        await database.userRoleAssignment.create({
          data: { userId: id, roleId: role.id, scopeKind: 'BRANCH', branchId },
        });
        await database.organizationAssignment.create({
          data: {
            employeeUserId: id,
            level: 'DEPUTY_STORE_MANAGER',
            scopeKind: 'BRANCH',
            branchId,
            assignedByUserId: id,
          },
        });
      }
      const pendingEvent = async () => {
        const staff = await employee();
        const leave = await database.leaveRequest.create({
          data: {
            employeeUserId: staff,
            leaveType: 'ANNUAL',
            startDate: new Date('2031-01-05'),
            endDate: new Date('2031-01-06'),
            reason: 'Race fixture',
          },
        });
        leaves.push(leave.id);
        const event = await database.outboxEvent.create({
          data: {
            aggregateType: 'LeaveRequest',
            aggregateId: leave.id,
            eventType: 'LEAVE_REQUESTED',
            schemaVersion: 1,
            payload: leaveRequestedPayload(staff),
          },
        });
        events.push(event.id);
        return event.id;
      };
      const consume = (id: string) =>
        database.$transaction((tx) => processLeaveEvent(tx, id), { timeout: 30_000 });
      const inbox = (id: string) =>
        database.notification.findMany({
          where: { sourceEventId: id },
          orderBy: { recipientUserId: 'asc' },
        });

      // 1. Several workers race for ONE event: exactly one processes it, the rest claim nothing.
      const single = await pendingEvent();
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => consume(single)));
      assert.equal(
        outcomes.filter((outcome) => outcome === 'PUBLISHED').length,
        1,
        outcomes.join(),
      );
      assert.ok(outcomes.every((outcome) => outcome === 'PUBLISHED' || outcome === 'NOT_CLAIMED'));
      assert.deepEqual(
        (await inbox(single)).map((row) => row.recipientUserId),
        [...managers].sort(),
        'one notification per manager, no duplicates',
      );
      assert.ok(
        (await database.outboxEvent.findUniqueOrThrow({ where: { id: single } })).publishedAt,
      );

      // 2. Many events, several workers each scanning all of them: every event exactly once.
      const many: string[] = [];
      for (let index = 0; index < 6; index += 1) many.push(await pendingEvent());
      const sweeps = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const results: string[] = [];
          for (const id of many) results.push(await consume(id));
          return results;
        }),
      );
      for (const [index, id] of many.entries()) {
        const seen = sweeps.map((sweep) => sweep[index]);
        assert.equal(
          seen.filter((outcome) => outcome === 'PUBLISHED').length,
          1,
          `${id}: ${seen.join()}`,
        );
        assert.equal((await inbox(id)).length, managers.length);
      }

      // 3. A failing consumer, on a real connection, commits nothing and leaves the event pending;
      //    a later worker completes it.
      const failing = await pendingEvent();
      await assert.rejects(
        database.$transaction((tx) =>
          processLeaveEvent(tx, failing, {
            resolve: () => Promise.reject(new Error('routing unavailable')),
          }),
        ),
        /routing unavailable/,
      );
      assert.equal(
        (await database.outboxEvent.findUniqueOrThrow({ where: { id: failing } })).publishedAt,
        null,
      );
      assert.equal((await inbox(failing)).length, 0);
      assert.equal(await consume(failing), 'PUBLISHED');
      assert.equal((await inbox(failing)).length, managers.length);
    } finally {
      // Cleanup of exactly this run's committed rows (replica role skips history-guard triggers).
      await database.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.notification.deleteMany({ where: { sourceEventId: { in: events } } });
        await tx.outboxEvent.deleteMany({ where: { id: { in: events } } });
        await tx.leaveRequest.deleteMany({ where: { id: { in: leaves } } });
        await tx.organizationAssignment.deleteMany({ where: { employeeUserId: { in: users } } });
        await tx.userRoleAssignment.deleteMany({ where: { userId: { in: users } } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roles } } });
        await tx.role.deleteMany({ where: { id: { in: roles } } });
        await tx.employeeBranchAssignment.deleteMany({ where: { employeeUserId: { in: users } } });
        await tx.employmentClassificationChange.deleteMany({
          where: { employeeUserId: { in: users } },
        });
        await tx.employeeProfile.deleteMany({ where: { userId: { in: users } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
        if (branchId) await tx.branch.deleteMany({ where: { id: branchId } });
      });
      await database.$disconnect();
    }
  },
);
