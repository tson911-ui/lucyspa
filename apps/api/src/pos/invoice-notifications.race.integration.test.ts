import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendOutboxEvent, createDatabaseClient, syncPermissionCatalog } from '@lucy-spa/database';
import { processFinancialNotificationEvent, scheduleRevenueSummaries } from '@lucy-spa/server';

/**
 * Real concurrency: several database connections COMMIT and race for the same financial events and for the
 * same daily-summary schedule. It writes committed rows, so it only runs against an explicitly named scratch
 * database (`NOTIFICATION_RACE_DATABASE_URL`, never the main DATABASE_URL) whose role is a superuser
 * (replica-role cleanup, as the existing race tests do). Otherwise it is skipped.
 */
const raceUrl = process.env['NOTIFICATION_RACE_DATABASE_URL'];
test(
  'financial notification consumer: concurrent workers handle each event once; the scheduler appends one summary per date',
  { skip: raceUrl ? false : 'NOTIFICATION_RACE_DATABASE_URL is not set' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const database = createDatabaseClient(raceUrl!);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const users: string[] = [];
    let roleId = '';
    let branchId = '';
    const other: string[] = [];
    try {
      await database.$connect();
      const [role] = await database.$queryRaw<
        { rolsuper: boolean }[]
      >`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
      assert.ok(role?.rolsuper, 'the scratch database role must be a superuser for cleanup');
      await database.$transaction((tx) => syncPermissionCatalog(tx));
      const permission = await database.permission.findUniqueOrThrow({
        where: { code: 'VIEW_REVENUE' },
        select: { id: true },
      });
      branchId = (
        await database.branch.create({
          data: { code: `RACE-N10-${run}`, name: 'Race branch', timezone: 'Asia/Ho_Chi_Minh' },
        })
      ).id;
      roleId = (
        await database.role.create({
          data: {
            code: `RACE_N10_${run}`,
            displayNameVi: 'Vai trò',
            displayNameEn: 'Role',
            permissions: { create: [{ permissionId: permission.id }] },
          },
        })
      ).id;
      for (let index = 0; index < 2; index += 1) {
        const id = randomUUID();
        users.push(id);
        await database.user.create({
          data: {
            id,
            kind: 'EMPLOYEE',
            status: 'ACTIVE',
            fullName: `Race ${index}`,
            preferredLocale: 'vi',
            emailCanonical: `race-n10-${index}-${run.toLowerCase()}@example.com`,
            emailDelivery: `race-n10-${index}-${run.toLowerCase()}@example.com`,
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            phoneCanonical: `+84913${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
            employeeProfile: {
              create: {
                employeeCodeCanonical: `RACEN10-${index}-${run}`,
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
        await database.userRoleAssignment.create({
          data: { userId: id, roleId, scopeKind: 'BRANCH', branchId },
        });
      }
      const consume = (id: string) =>
        database.$transaction((tx) => processFinancialNotificationEvent(tx, id), {
          timeout: 30_000,
        });
      const summaryEvent = async (businessDate: string) =>
        (
          await database.$transaction((tx) =>
            appendOutboxEvent(tx, {
              branchId,
              aggregateType: 'Branch',
              aggregateId: branchId,
              eventType: 'REVENUE_SUMMARY_DUE',
              schemaVersion: 1,
              payload: { businessDate },
            }),
          )
        ).id;

      // 1. Several workers race for ONE event: exactly one delivers, the rest claim nothing.
      const single = await summaryEvent('2026-03-02');
      other.push(single);
      const outcomes = await Promise.all(Array.from({ length: 6 }, () => consume(single)));
      assert.equal(
        outcomes.filter((outcome) => outcome === 'PUBLISHED').length,
        1,
        outcomes.join(),
      );
      assert.ok(outcomes.every((outcome) => outcome === 'PUBLISHED' || outcome === 'NOT_CLAIMED'));
      const rows = await database.notification.findMany({ where: { sourceEventId: single } });
      const mine = rows.map((row) => row.recipientUserId).filter((id) => users.includes(id));
      assert.deepEqual(
        mine.sort(),
        [...users].sort(),
        'one notification per holder, no duplicates',
      );
      assert.equal(
        await database.outboxConsumption.count({
          where: { eventId: single, consumer: 'notifications' },
        }),
        1,
      );
      assert.equal(
        (await database.outboxEvent.findUniqueOrThrow({ where: { id: single } })).publishedAt,
        null,
        'published_at is never used by financial consumers',
      );

      // 2. Several workers each scanning several events: every event exactly once.
      const many: string[] = [];
      for (const day of ['03', '04', '05', '06']) many.push(await summaryEvent(`2026-03-${day}`));
      other.push(...many);
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
      }

      // 3. A failing event (its payload lacks the business date) commits nothing and stays pending.
      const broken = (
        await database.outboxEvent.create({
          data: {
            branchId,
            aggregateType: 'Branch',
            aggregateId: branchId,
            eventType: 'REVENUE_SUMMARY_DUE',
            schemaVersion: 1,
            payload: {},
          },
        })
      ).id;
      other.push(broken);
      await assert.rejects(consume(broken), /no businessDate/);
      assert.equal(await database.outboxConsumption.count({ where: { eventId: broken } }), 0);
      assert.equal(await database.notification.count({ where: { sourceEventId: broken } }), 0);

      // 4. Concurrent schedulers append exactly one summary event for the branch and date.
      const at = new Date('2026-04-02T14:31:00Z');
      await Promise.all(Array.from({ length: 5 }, () => scheduleRevenueSummaries(database, at)));
      const scheduled = await database.outboxEvent.findMany({
        where: { aggregateId: branchId, eventType: 'REVENUE_SUMMARY_DUE' },
      });
      const forDate = scheduled.filter(
        (event) => Reflect.get(event.payload as object, 'businessDate') === '2026-04-02',
      );
      assert.equal(forDate.length, 1);
      other.push(...forDate.map((event) => event.id));
    } finally {
      // Cleanup of exactly this run's committed rows (replica role skips history-guard triggers). Other
      // branches that the scheduler may have scheduled for in a shared scratch database are left as they are.
      await database.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.notification.deleteMany({ where: { branchId } });
        await tx.outboxConsumption.deleteMany({ where: { event: { branchId } } });
        await tx.outboxEvent.deleteMany({ where: { branchId } });
        await tx.userRoleAssignment.deleteMany({ where: { userId: { in: users } } });
        if (roleId) {
          await tx.rolePermission.deleteMany({ where: { roleId } });
          await tx.role.deleteMany({ where: { id: roleId } });
        }
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
