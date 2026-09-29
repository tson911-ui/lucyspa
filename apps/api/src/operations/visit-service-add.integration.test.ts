import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { loadTimingSettings, operationalToday } from './operations.core.js';
import { ServiceExecutionService } from './service-execution.service.js';

/**
 * Phase 4 Step 3: staff-added service against real PostgreSQL. Every fixture (and every command)
 * rolls back with the outer transaction; concurrency is covered by the separate race suite.
 */
test(
  'Phase 4 Step 3 staff-added service; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_KEYS: ring(),
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const rollback = new Error('Phase 4 Step 3 fixture rollback');
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let n = 0;
            let savepoint = 0;
            const isolated = async <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => {
              const name = `visit_add_${++savepoint}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work(tx);
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const executions = new ServiceExecutionService(
              {
                withTransaction: isolated,
                withExclusiveTransaction: isolated,
                resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              },
              new AuthThrottleService(environment),
            );
            const fails = async (work: () => Promise<unknown>, code: string, field?: string) => {
              await assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            };
            const [clock] = await tx.$queryRaw<{ now: Date; hour: number }[]>`
          SELECT clock_timestamp() AS now, extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::int AS hour`;
            const now = clock!.now;
            const offset = 12 - clock!.hour;
            const zone =
              offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
            const today = new Date(now.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
            const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
            const branch = await tx.branch.create({
              data: { code: `VA_${run}`, name: 'Add fixture', timezone: zone },
            });
            const elsewhere = await tx.branch.create({
              data: { code: `VA_OTHER_${run}`, name: 'Other', timezone: zone },
            });
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday++) {
              await tx.branchOperatingHours.create({
                data: { branchId: branch.id, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
              });
            }
            await syncPermissionCatalog(tx);
            type Code = 'PERFORM_SERVICES' | 'MANAGE_BOOKINGS';
            const permissionId = async (code: Code) =>
              (await tx.permission.findUniqueOrThrow({ where: { code } })).id;
            const makeRole = async (name: string, codes: Code[]) =>
              tx.role.create({
                data: {
                  code: `VA_${name}_${run}`,
                  displayNameVi: name,
                  displayNameEn: name,
                  permissions: {
                    create: await Promise.all(
                      codes.map(async (code) => ({ permissionId: await permissionId(code) })),
                    ),
                  },
                },
              });
            const performerRole = await makeRole('PERFORM', ['PERFORM_SERVICES']);
            const deskRole = await makeRole('DESK', ['MANAGE_BOOKINGS']);
            const category = await tx.serviceCategory.create({
              data: { code: `VA_${run}`, nameVi: 'Group', nameEn: 'Group' },
            });
            const skill = await tx.skill.create({
              data: { code: `VA_${run}`, nameVi: 'Skill', nameEn: 'Skill' },
            });
            const specialSkill = await tx.skill.create({
              data: { code: `VA_SPECIAL_${run}`, nameVi: 'Special', nameEn: 'Special' },
            });
            const makeService = async (
              code: string,
              skillId: string,
              price = 100_000n,
              categoryId = category.id,
            ) => {
              const service = await tx.service.create({
                data: {
                  code: `VA_${code}_${run}`,
                  categoryId,
                  nameVi: `Dịch vụ ${code}`,
                  nameEn: `Service ${code}`,
                  priceVnd: price,
                  priceMaxVnd: price + 50_000n,
                  durationMinutes: 10,
                  estimatedMinMinutes: 10,
                  estimatedMaxMinutes: 10,
                },
              });
              await tx.serviceBranchAvailability.create({
                data: { serviceId: service.id, branchId: branch.id },
              });
              await tx.serviceSkill.create({ data: { serviceId: service.id, skillId } });
              return service;
            };
            const service = await makeService('BASE', skill.id);
            const extra = await makeService('EXTRA', skill.id, 80_000n);
            const special = await makeService('SPECIAL', specialSkill.id);

            type Person = { id: string; token: string };
            const person = async (
              roles: { roleId: string; branchId: string }[],
              options: { skills?: string[]; checkedIn?: boolean } = {},
            ): Promise<Person> => {
              n++;
              const user = await tx.user.create({
                data: {
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Add ${n}`,
                  preferredLocale: 'vi',
                  phoneCanonical: `+849${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `VA_${run}_${n}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
              });
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: user.id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: user.id, branchId: branch.id, grantedByUserId: user.id },
              });
              for (const skillId of options.skills ?? [skill.id])
                await tx.employeeSkill.create({
                  data: { employeeUserId: user.id, skillId, grantedByUserId: user.id },
                });
              for (const role of roles)
                await tx.userRoleAssignment.create({
                  data: {
                    userId: user.id,
                    roleId: role.roleId,
                    scopeKind: 'BRANCH',
                    branchId: role.branchId,
                  },
                });
              if (options.checkedIn !== false)
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: user.id,
                    branchId: branch.id,
                    businessDate: new Date(today),
                    checkInAt: at(-180),
                  },
                });
              const token = (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  {
                    userId: user.id,
                    passwordHash: user.passwordHash!,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
              return { id: user.id, token };
            };
            const ktv = (options: { skills?: string[]; checkedIn?: boolean } = {}) =>
              person([{ roleId: performerRole.id, branchId: branch.id }], options);
            const desk = () => person([{ roleId: deskRole.id, branchId: branch.id }]);
            const key = () => randomUUID();

            /** A walk-in visit with one PLANNED line for `employee`, planned in the past. */
            const visit = async (employeeId: string, base = -120) => {
              const row = await tx.visit.create({
                data: {
                  code: `VA-${run}-${++n}`,
                  branchId: branch.id,
                  origin: 'WALK_IN',
                  serviceDate: new Date(today),
                  arrivedAt: at(-180),
                  createdByUserId: employeeId,
                },
              });
              const participant = await tx.visitParticipant.create({
                data: { visitId: row.id, kind: 'GUEST', displayName: 'Guest' },
              });
              const line = await tx.visitServiceLine.create({
                data: {
                  visitId: row.id,
                  participantId: participant.id,
                  sequence: 1,
                  serviceId: service.id,
                  employeeUserId: employeeId,
                  assignmentMode: 'SPECIFIC',
                  plannedStartAt: at(base),
                  plannedEndAt: at(base + 10),
                  durationMinutes: 10,
                  bufferMinutes: 0,
                  serviceCode: service.code,
                  serviceNameVi: 'Service',
                  serviceNameEn: 'Service',
                  catalogPriceMinVnd: 100_000n,
                  catalogPriceMaxVnd: 150_000n,
                  catalogPricingUnit: 'PER_SERVICE',
                },
              });
              return { row, participantId: participant.id, line };
            };
            const claims = async (lineId: string) => {
              const [row] = await tx.$queryRaw<
                { n: bigint }[]
              >`SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${lineId}::uuid`;
              return Number(row!.n);
            };
            const audits = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });

            await suite.test(
              'a desk actor adds a catalog service to an in-service visit: snapshot, assignment, audit, event',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const boss = await desk();
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id); // visit IN_SERVICE, A is occupied
                const k = key();
                const added = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  idempotencyKey: k,
                });
                assert.equal(added.replayed, false);
                assert.equal(added.visitId, row.id);
                assert.equal(added.sequence, 2);
                assert.equal(added.assignmentMode, 'ANY');
                assert.equal(added.status, 'PLANNED');
                assert.equal(added.employee?.id, b.id, 'the only free qualified KTV is assigned');
                assert.equal(added.waitReason, null);
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: added.lineId },
                });
                assert.equal(stored.status, 'PLANNED');
                assert.equal(stored.addedOnBehalf, true);
                assert.equal(stored.addedByUserId, boss.id);
                assert.ok(stored.addedAt);
                assert.equal(stored.serviceId, extra.id);
                assert.equal(stored.serviceCode, extra.code);
                assert.equal(stored.durationMinutes, 10);
                assert.equal(stored.catalogPriceMinVnd, 80_000n);
                assert.equal(stored.catalogPriceMaxVnd, 130_000n);
                assert.equal(stored.catalogPricingUnit, 'PER_SERVICE');
                assert.equal(stored.maxQuantitySnapshot, 1, 'a flat service is exactly one unit');
                assert.equal(await claims(added.lineId), 1);
                assert.equal(
                  await tx.visitLineAddRequest.count({
                    where: { visitServiceLineId: added.lineId },
                  }),
                  1,
                );
                const [audit] = await audits(added.lineId, 'VISIT_LINE_ADDED');
                assert.ok(audit);
                assert.equal(audit.actorUserId, boss.id);
                assert.equal(audit.branchId, branch.id);
                assert.equal(audit.dataClassification, 'STANDARD');
                const after = audit.after as Record<string, unknown>;
                assert.equal(after['visitId'], row.id);
                assert.equal(after['serviceId'], extra.id);
                assert.equal(after['catalogPriceMinVnd'], '80000');
                assert.equal(after['via'], 'DESK');
                assert.equal(after['addedOnBehalf'], true);
                assert.ok(
                  await tx.auditEvent.findFirst({
                    where: { entityId: row.id, action: 'VISIT_LINE_ASSIGNED' },
                  }),
                );
                assert.ok(
                  await tx.outboxEvent.findFirst({
                    where: { aggregateId: row.id, eventType: 'VISIT_LINE_SCHEDULED' },
                  }),
                  'the existing scheduling event is reused',
                );
                // The catalog moving later never rewrites the visit line snapshot.
                await tx.service.update({
                  where: { id: extra.id },
                  data: { priceVnd: 999_000n, priceMaxVnd: 999_000n, rowVersion: { increment: 1 } },
                });
                const after2 = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: added.lineId },
                });
                assert.equal(after2.catalogPriceMinVnd, 80_000n);
                assert.equal(after2.catalogPriceMaxVnd, 130_000n);
                // Restore the shared fixture catalog for the following scenarios.
                await tx.service.update({
                  where: { id: extra.id },
                  data: { priceVnd: 80_000n, priceMaxVnd: 130_000n, rowVersion: { increment: 1 } },
                });
                // OP-1: a per-nail service carries its limit, snapshotted at that moment and never re-read.
                await tx.service.update({
                  where: { id: extra.id },
                  data: { pricingUnit: 'PER_NAIL', maxQuantity: 10, rowVersion: { increment: 1 } },
                });
                const limited = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  idempotencyKey: key(),
                });
                const limitedRow = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: limited.lineId },
                });
                assert.equal(limitedRow.maxQuantitySnapshot, 10);
                assert.equal(limitedRow.catalogPricingUnit, 'PER_NAIL');
                assert.equal(stored.maxQuantitySnapshot, 1, 'the earlier line keeps its own limit');
                await tx.service.update({
                  where: { id: extra.id },
                  data: { maxQuantity: 20, rowVersion: { increment: 1 } },
                });
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: limited.lineId } }))
                    .maxQuantitySnapshot,
                  10,
                  'a later catalog change never alters an existing visit line',
                );
                const [limitedAudit] = await audits(limited.lineId, 'VISIT_LINE_ADDED');
                assert.equal(
                  (limitedAudit?.after as Record<string, unknown>)['maxQuantitySnapshot'],
                  10,
                );
                await tx.service.update({
                  where: { id: extra.id },
                  data: {
                    pricingUnit: 'PER_SERVICE',
                    maxQuantity: 1,
                    rowVersion: { increment: 1 },
                  },
                });
              },
            );

            await suite.test(
              'the added line follows the normal lifecycle and holds the visit open until it is performed',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const boss = await desk();
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id);
                const added = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  requestedEmployeeUserId: b.id,
                  idempotencyKey: key(),
                });
                assert.equal(added.employee?.id, b.id);
                // Sequence: the participant's first service must finish first.
                await fails(
                  () => executions.start(b.token, added.lineId),
                  'SERVICE_SEQUENCE_BLOCKED',
                );
                const ended = await executions.end(a.token, line.id);
                assert.equal(
                  ended.visitStatus,
                  'IN_SERVICE',
                  'the new open line prevents completion',
                );
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: row.id } })).status,
                  'IN_SERVICE',
                );
                assert.equal((await executions.start(b.token, added.lineId)).status, 'IN_PROGRESS');
                const done = await executions.end(b.token, added.lineId);
                assert.equal(done.status, 'DONE');
                assert.equal(done.visitStatus, 'COMPLETED');
                assert.equal(await claims(added.lineId), 0);
              },
            );

            await suite.test(
              'an unstarted added line can be cancelled with the Step 2 command',
              async () => {
                const a = await ktv();
                await ktv();
                const boss = await desk();
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id);
                const added = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  idempotencyKey: key(),
                });
                const cancelled = await executions.cancelLine(boss.token, added.lineId, {
                  reason: 'Khách đổi ý',
                });
                assert.equal(cancelled.visitStatus, 'IN_SERVICE');
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: added.lineId },
                });
                assert.equal(stored.status, 'CANCELLED');
                assert.equal(
                  stored.addedOnBehalf,
                  true,
                  'the added-on-behalf facts stay in the history',
                );
                assert.equal(await claims(added.lineId), 0);
                const ended = await executions.end(a.token, line.id);
                assert.equal(ended.visitStatus, 'COMPLETED');
              },
            );

            await suite.test(
              'closed visits are never reopened; invalid services are refused',
              async () => {
                const a = await ktv();
                const boss = await desk();
                const done = await visit(a.id);
                await executions.start(a.token, done.line.id);
                await executions.end(a.token, done.line.id);
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: done.row.id } })).status,
                  'COMPLETED',
                );
                await fails(
                  () =>
                    executions.addLine(boss.token, done.row.id, {
                      participantId: done.participantId,
                      serviceId: extra.id,
                      idempotencyKey: key(),
                    }),
                  'VISIT_LINE_ADD_NOT_ALLOWED',
                );
                assert.equal(
                  await tx.visitServiceLine.count({ where: { visitId: done.row.id } }),
                  1,
                );
                const gone = await visit(a.id, -300);
                await executions.cancelLine(boss.token, gone.line.id, { reason: 'r' });
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: gone.row.id } })).status,
                  'CANCELLED',
                );
                await fails(
                  () =>
                    executions.addLine(boss.token, gone.row.id, {
                      participantId: gone.participantId,
                      serviceId: extra.id,
                      idempotencyKey: key(),
                    }),
                  'VISIT_LINE_ADD_NOT_ALLOWED',
                );
                // Catalog rules: inactive service, service not offered here, inactive category, unknown service.
                const open = await visit(a.id, -500);
                const add = (serviceId: string) =>
                  executions.addLine(boss.token, open.row.id, {
                    participantId: open.participantId,
                    serviceId,
                    idempotencyKey: key(),
                  });
                const inactive = await makeService('INACTIVE', skill.id);
                await tx.service.update({
                  where: { id: inactive.id },
                  data: { isActive: false, rowVersion: { increment: 1 } },
                });
                await fails(() => add(inactive.id), 'BOOKING_SERVICE_UNAVAILABLE');
                const other = await makeService('ELSEWHERE', skill.id);
                await tx.serviceBranchAvailability.updateMany({
                  where: { serviceId: other.id },
                  data: { isActive: false, rowVersion: { increment: 1 } },
                });
                await fails(() => add(other.id), 'BOOKING_SERVICE_UNAVAILABLE');
                const hiddenCategory = await tx.serviceCategory.create({
                  data: { code: `VA_HIDDEN_${run}`, nameVi: 'x', nameEn: 'x', isActive: false },
                });
                const hidden = await makeService('HIDDEN', skill.id, 100_000n, hiddenCategory.id);
                await fails(() => add(hidden.id), 'BOOKING_SERVICE_UNAVAILABLE');
                await fails(() => add(randomUUID()), 'BOOKING_SERVICE_UNAVAILABLE');
                // A participant of another visit is not a valid recipient.
                await fails(
                  () =>
                    executions.addLine(boss.token, open.row.id, {
                      participantId: done.participantId,
                      serviceId: extra.id,
                      idempotencyKey: key(),
                    }),
                  'VALIDATION_FAILED',
                  'participantId',
                );
                assert.equal(
                  await tx.visitServiceLine.count({ where: { visitId: open.row.id } }),
                  1,
                );
              },
            );

            await suite.test(
              'authority: desk permission, performer serving the visit, branch, others',
              async () => {
                const a = await ktv();
                const b = await ktv();
                const stranger = await ktv();
                const boss = await desk();
                const plain = await person([]);
                const wrongBranch = await person([{ roleId: deskRole.id, branchId: elsewhere.id }]);
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id);
                const body = (serviceId = extra.id, requested?: string) => ({
                  participantId,
                  serviceId,
                  ...(requested ? { requestedEmployeeUserId: requested } : {}),
                  idempotencyKey: key(),
                });
                await fails(() => executions.addLine(plain.token, row.id, body()), 'FORBIDDEN');
                await fails(
                  () => executions.addLine(wrongBranch.token, row.id, body()),
                  'FORBIDDEN',
                );
                await fails(() => executions.addLine(stranger.token, row.id, body()), 'FORBIDDEN');
                await fails(
                  () => executions.addLine('missing-token', row.id, body()),
                  'AUTHENTICATION_REQUIRED',
                );
                await fails(
                  () => executions.addLine(boss.token, randomUUID(), body()),
                  'NOT_FOUND',
                );
                await fails(() => executions.addLine(boss.token, 'nope', body()), 'NOT_FOUND');
                // The performer serving this visit may add, but never names another KTV.
                await fails(
                  () => executions.addLine(a.token, row.id, body(extra.id, b.id)),
                  'FORBIDDEN',
                );
                const viaPerformer = await executions.addLine(
                  a.token,
                  row.id,
                  body(extra.id, a.id),
                );
                assert.equal(viaPerformer.assignmentMode, 'SPECIFIC');
                const [audit] = await audits(viaPerformer.lineId, 'VISIT_LINE_ADDED');
                assert.equal((audit!.after as { via: string }).via, 'PERFORMER');
                // Options: desk sees qualified KTVs; the performer sees the catalog only.
                const deskOptions = await executions.addOptions(boss.token, row.id);
                assert.ok(
                  deskOptions.services
                    .find((s) => s.id === extra.id)!
                    .employees.some((e) => e.id === b.id),
                );
                const performerOptions = await executions.addOptions(a.token, row.id);
                assert.ok(performerOptions.services.length >= 2);
                assert.ok(performerOptions.services.every((s) => s.employees.length === 0));
                await fails(() => executions.addOptions(stranger.token, row.id), 'FORBIDDEN');
                // Adding grants no price power: nothing about the line is billable or editable here.
                const stored = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: viaPerformer.lineId },
                });
                assert.equal(stored.catalogPriceMinVnd, 80_000n);
              },
            );

            await suite.test(
              'qualification, requested KTV and occupancy follow the Phase 3 engine',
              async () => {
                const a = await ktv();
                const b = await ktv({ skills: [skill.id, specialSkill.id] });
                const busy = await ktv();
                const boss = await desk();
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id);
                // Only B holds the special skill: ANY picks B.
                const any = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: special.id,
                  idempotencyKey: key(),
                });
                assert.equal(any.employee?.id, b.id);
                // A requested KTV without the skill is never assigned: the line waits.
                const other = await visit(a.id, -500);
                const unqualified = await executions.addLine(boss.token, other.row.id, {
                  participantId: other.participantId,
                  serviceId: special.id,
                  requestedEmployeeUserId: busy.id,
                  idempotencyKey: key(),
                });
                assert.equal(unqualified.status, 'WAITING');
                assert.equal(unqualified.employee, null);
                assert.equal(unqualified.assignmentMode, 'SPECIFIC');
                assert.equal(unqualified.waitReason, 'REQUESTED_KTV_UNAVAILABLE');
                assert.equal(await claims(unqualified.lineId), 0);
                // A requested KTV outside the branch is a validation error, nothing is created.
                const outsider = await person([]);
                await tx.employeeBranchAssignment.updateMany({
                  where: { employeeUserId: outsider.id },
                  data: { revokedAt: new Date() },
                });
                await fails(
                  () =>
                    executions.addLine(boss.token, other.row.id, {
                      participantId: other.participantId,
                      serviceId: extra.id,
                      requestedEmployeeUserId: outsider.id,
                      idempotencyKey: key(),
                    }),
                  'VALIDATION_FAILED',
                  'requestedEmployeeUserId',
                );
                // C is busy with an overlapping planned line: requesting C keeps the line WAITING.
                const c = await ktv();
                const blocker = await visit(c.id, -5);
                assert.equal(await claims(blocker.line.id), 1);
                const clash = await visit(a.id, -800);
                const conflicted = await executions.addLine(boss.token, clash.row.id, {
                  participantId: clash.participantId,
                  serviceId: extra.id,
                  requestedEmployeeUserId: c.id,
                  idempotencyKey: key(),
                });
                assert.equal(conflicted.status, 'WAITING');
                assert.equal(conflicted.employee, null);
              },
            );

            await suite.test(
              'no capacity keeps the line waiting; it still holds the visit and can be cancelled',
              async () => {
                const a = await ktv();
                const boss = await desk();
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id);
                // The requested KTV is running a service, so nobody suitable is free for this line.
                const waiting = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  requestedEmployeeUserId: a.id,
                  idempotencyKey: key(),
                });
                assert.equal(waiting.status, 'WAITING');
                assert.equal(waiting.employee, null);
                assert.ok(waiting.waitReason);
                assert.equal(await claims(waiting.lineId), 0);
                const ended = await executions.end(a.token, line.id);
                assert.equal(ended.visitStatus, 'IN_SERVICE');
                const cancelled = await executions.cancelLine(boss.token, waiting.lineId, {
                  reason: 'r',
                });
                assert.equal(cancelled.visitStatus, 'COMPLETED');
              },
            );

            await suite.test(
              'replay by the same actor returns the same line; a reused key for another request conflicts',
              async () => {
                const a = await ktv();
                await ktv();
                const boss = await desk();
                const other = await desk();
                const { row, participantId, line } = await visit(a.id);
                await executions.start(a.token, line.id);
                const k = key();
                const first = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  idempotencyKey: k,
                });
                const again = await executions.addLine(boss.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  idempotencyKey: k,
                });
                assert.equal(again.replayed, true);
                assert.equal(again.lineId, first.lineId);
                assert.equal(await tx.visitServiceLine.count({ where: { visitId: row.id } }), 2);
                assert.equal((await audits(first.lineId, 'VISIT_LINE_ADDED')).length, 1);
                await fails(
                  () =>
                    executions.addLine(boss.token, row.id, {
                      participantId,
                      serviceId: service.id,
                      idempotencyKey: k,
                    }),
                  'CONFLICT',
                );
                // The key is per actor: another actor's identical key is a new request.
                const second = await executions.addLine(other.token, row.id, {
                  participantId,
                  serviceId: extra.id,
                  idempotencyKey: k,
                });
                assert.notEqual(second.lineId, first.lineId);
                // Malformed input never reaches the database.
                for (const bad of [
                  { participantId: 'x' },
                  { serviceId: 'x' },
                  { idempotencyKey: 'x' },
                  { requestedEmployeeUserId: 'x' },
                ])
                  await fails(
                    () =>
                      executions.addLine(boss.token, row.id, {
                        participantId,
                        serviceId: extra.id,
                        idempotencyKey: key(),
                        ...bad,
                      }),
                    'VALIDATION_FAILED',
                  );
              },
            );

            await suite.test('a visit holds a bounded number of services', async () => {
              const a = await ktv();
              const boss = await desk();
              const { row, participantId } = await visit(a.id);
              for (let sequence = 2; sequence <= 20; sequence++) {
                await tx.visitServiceLine.create({
                  data: {
                    visitId: row.id,
                    participantId,
                    sequence,
                    serviceId: service.id,
                    status: 'WAITING',
                    assignmentMode: 'ANY',
                    durationMinutes: 10,
                    serviceCode: service.code,
                    serviceNameVi: 'Service',
                    serviceNameEn: 'Service',
                    catalogPriceMinVnd: 1n,
                    catalogPriceMaxVnd: 1n,
                    catalogPricingUnit: 'PER_SERVICE',
                  },
                });
              }
              await fails(
                () =>
                  executions.addLine(boss.token, row.id, {
                    participantId,
                    serviceId: extra.id,
                    idempotencyKey: key(),
                  }),
                'VISIT_LINE_ADD_NOT_ALLOWED',
              );
            });

            await suite.test('the read models offer the action only where it applies', async () => {
              const a = await ktv();
              const boss = await desk();
              const { row, participantId, line } = await visit(a.id);
              await executions.start(a.token, line.id);
              const settings = await loadTimingSettings(tx);
              const board = (canCancelLine: boolean) =>
                operationalToday(tx, {
                  branchId: branch.id,
                  date: new Date(today),
                  now: new Date(),
                  settings,
                  canArrive: false,
                  canManageQueue: false,
                  actorUserId: boss.id,
                  canCancelLine,
                  canResolveExecution: false,
                });
              const withDesk = (await board(true)).activeVisits.find((v) => v.id === row.id)!;
              assert.equal(withDesk.actions.addService, true);
              assert.deepEqual(withDesk.participants, [{ id: participantId, name: 'Guest' }]);
              assert.equal(
                (await board(false)).activeVisits.find((v) => v.id === row.id)!.actions.addService,
                false,
              );
              assert.equal((await executions.get(a.token, line.id)).actions.addService, true);
              await executions.end(a.token, line.id);
              assert.equal(
                (await executions.get(a.token, line.id)).actions.addService,
                false,
                'a completed visit offers nothing',
              );
            });
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
