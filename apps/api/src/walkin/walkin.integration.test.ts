import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { WalkInCreateRequest, WalkInVisitResponse } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { evaluateSequence } from '../availability/availability.engine.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import { OperationsService } from '../operations/operations.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { WalkInService } from './walkin.service.js';
import { validVnMobile } from '../testing/phone.js';

const code = (error: unknown) => (error instanceof AuthError ? error.code : String(error));
const plus = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Walk-in, guest and waiting visits (Phase 3 Step 6); all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_CSRF_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const rollback = new Error('Intentional walk-in rollback');
    try {
      await assert.rejects(
        database.$transaction(
          async (tx: Prisma.TransactionClient) => {
            let savepoints = 0;
            const isolated = async <T>(work: () => Promise<T>): Promise<T> => {
              const name = `command_${++savepoints}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work();
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const walkIns = new WalkInService(runner, throttle);
            const operations = new OperationsService(runner, throttle);
            const fails = async (work: () => Promise<unknown>, expected: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(code(error), expected);
                return true;
              });
            };

            // ---------------------------------------------------------------- fixtures
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            // A zone where it is about noon now: the whole test stays on one branch-local day.
            const [clock] = await tx.$queryRaw<{ now: Date; hour: number }[]>`
              SELECT now() AS now, extract(hour FROM now() AT TIME ZONE 'UTC')::int AS hour`;
            const now = clock!.now;
            const offset = 12 - clock!.hour;
            const zone =
              offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
            const localDay = (instant: Date) =>
              new Date(instant.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
            const today = localDay(now);

            let sequence = 0;
            // 0992xxxxxx is not an allocated VN mobile range, so normalizePhone rejects it (1% of runs).
            const phones = new Map<number, string>();
            // One valid, unique number per fixture index, the same every time it is asked for.
            const phoneOf = (n: number) => {
              const known = phones.get(n);
              if (known) return known;
              const created = validVnMobile();
              phones.set(n, created);
              return created;
            };
            const user = async (kind: 'CUSTOMER' | 'EMPLOYEE') => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Walk-in fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `wi-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailDelivery: `wi-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: phoneOf(sequence),
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture-password-hash',
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-01-01'), address: 'F' },
                        },
                      }
                    : {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `WI_${run}_${String(sequence).padStart(3, '0')}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'F',
                          },
                        },
                      }),
                },
              });
              return { id, number: sequence };
            };
            const branch = async (label: string) =>
              (
                await tx.branch.create({
                  data: { code: `IT-WI-${label}-${run}`, name: `WI ${label}`, timezone: zone },
                  select: { id: true },
                })
              ).id;
            const B = await branch('B');
            const C = await branch('C');
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday += 1) {
              await tx.branchOperatingHours.create({
                data: { branchId: B, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
              });
            }
            const grant = async (userId: string, codes: PermissionCode[], branchId: string) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `IT_WI_${run}_${sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((c) => ({ permissionId: permissions.get(c)! })),
                  },
                },
                select: { id: true },
              });
              await tx.userRoleAssignment.create({
                data: { userId, roleId: role.id, scopeKind: 'BRANCH', branchId },
              });
            };
            const staffAt = async (codes: PermissionCode[], branchId: string) => {
              const { id } = await user('EMPLOYEE');
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: id, branchId, grantedByUserId: id },
              });
              if (codes.length) await grant(id, codes, branchId);
              return id;
            };
            const skill = async (label: string) =>
              (
                await tx.skill.create({
                  data: { code: `WI_${label}_${run}`, nameVi: label, nameEn: label },
                  select: { id: true },
                })
              ).id;
            const massage = await skill('MASSAGE');
            const nails = await skill('NAILS');
            const category = (
              await tx.serviceCategory.create({
                data: { code: `WI_CAT_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
                select: { id: true },
              })
            ).id;
            const service = async (label: string, minutes: number, skillId: string) => {
              const id = (
                await tx.service.create({
                  data: {
                    code: `WI_${label}_${run}`,
                    categoryId: category,
                    nameVi: `Dịch vụ ${label}`,
                    nameEn: `Service ${label}`,
                    priceVnd: 100_000n,
                    priceMaxVnd: 120_000n,
                    durationMinutes: minutes,
                    estimatedMinMinutes: minutes,
                    estimatedMaxMinutes: minutes,
                  },
                  select: { id: true },
                })
              ).id;
              await tx.serviceSkill.create({ data: { serviceId: id, skillId } });
              await tx.serviceBranchAvailability.create({ data: { serviceId: id, branchId: B } });
              return id;
            };
            const svcA = await service('A', 60, massage);
            const svcN = await service('N', 30, nails);
            const ktv = async (skills: string[], checkedIn = true) => {
              const id = await staffAt([], B);
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2026-01-01'),
                },
              });
              for (const skillId of skills) {
                await tx.employeeSkill.create({
                  data: { employeeUserId: id, skillId, grantedByUserId: id },
                });
              }
              if (checkedIn) {
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: id,
                    branchId: B,
                    businessDate: new Date(today),
                    checkInAt: plus(now, -60),
                  },
                });
              }
              return id;
            };
            // Codes order k1 < k2 < k3 (the tie-break's second key).
            const k1 = await ktv([massage, nails]);
            const k2 = await ktv([massage]);
            const k3 = await ktv([nails]);
            const kAbsent = await ktv([massage], false);
            const desk = await staffAt(['VIEW_BOOKINGS', 'MANAGE_BOOKINGS'], B);
            const manager = await staffAt(['VIEW_BOOKINGS', 'MANAGE_BOOKINGS', 'MANAGE_QUEUE'], B);
            const viewer = await staffAt(['VIEW_BOOKINGS'], B);
            const elsewhere = await staffAt(['VIEW_BOOKINGS', 'MANAGE_BOOKINGS'], C);
            const member = await user('CUSTOMER');
            const login = async (userId: string) => {
              const row = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              return (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
                  {
                    userId,
                    passwordHash: row.passwordHash!,
                    credentialVersion: row.credentialVersion,
                    authzVersion: row.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const [deskS, managerS, viewerS, elsewhereS] = await Promise.all(
              [desk, manager, viewer, elsewhere].map(login),
            );
            const request = (
              participants: WalkInCreateRequest['participants'],
              lines: WalkInCreateRequest['lines'],
            ): WalkInCreateRequest => ({ idempotencyKey: randomUUID(), participants, lines });
            const lineOf = (result: WalkInVisitResponse, participant = 0, line = 0) =>
              result.participants[participant]!.lines[line]!;
            const claims = (lineId: string) =>
              tx.$queryRaw<
                { n: bigint }[]
              >`SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${lineId}::uuid`.then(
                (rows) => Number(rows[0]?.n ?? 0),
              );

            // ---------------------------------------------------------------- tests
            await context.test(
              'member lookup: exact match, masked fields, no account ever',
              async () => {
                const found = await walkIns.lookup(deskS, B, {
                  phone: `0${phoneOf(member.number).slice(3)}`,
                });
                assert.equal(found.members.length, 1);
                assert.deepEqual(Object.keys(found.members[0]!).sort(), [
                  'displayName',
                  'emailMasked',
                  'id',
                  'phoneMasked',
                ]);
                assert.equal(found.members[0]!.id, member.id);
                assert.match(found.members[0]!.phoneMasked ?? '', /^•+\d{3}$/);
                assert.match(found.members[0]!.emailMasked ?? '', /^w•••@example\.invalid$/);
                const byEmail = await walkIns.lookup(deskS, B, {
                  email: `WI-${member.number}-${run.toLowerCase()}@example.invalid`,
                });
                assert.equal(byEmail.members[0]?.id, member.id);
                assert.deepEqual(
                  (await walkIns.lookup(deskS, B, { phone: '0999999999' })).members,
                  [],
                );
                // Staff (employee) accounts are never returned as members.
                assert.deepEqual(
                  (await walkIns.lookup(deskS, B, { phone: phoneOf(3) })).members,
                  [],
                );
                await fails(() => walkIns.lookup(deskS, B, { phone: '09' }), 'VALIDATION_FAILED');
                await fails(() => walkIns.lookup(deskS, B, {}), 'VALIDATION_FAILED');
                await fails(
                  () => walkIns.lookup(viewerS, B, { phone: phoneOf(member.number) }),
                  'FORBIDDEN',
                );
                await fails(
                  () => walkIns.lookup(elsewhereS, B, { phone: phoneOf(member.number) }),
                  'FORBIDDEN',
                );
                assert.equal(
                  await tx.user.count({ where: { phoneCanonical: '+84999999999' } }),
                  0,
                  'a lookup never creates an account',
                );
              },
            );

            let memberVisit: WalkInVisitResponse | null = null;
            await context.test(
              'member walk-in with capacity: direct visit, assigned now, idempotent',
              async () => {
                const body = request(
                  [{ key: 'm', kind: 'MEMBER', customerUserId: member.id }],
                  [{ participantKey: 'm', serviceId: svcA, requestedEmployeeUserId: null }],
                );
                // OP-1: give the service a non-default per-service limit for this scenario.
                await tx.service.update({
                  where: { id: svcA },
                  data: { pricingUnit: 'PER_NAIL', maxQuantity: 9, rowVersion: { increment: 1 } },
                });
                const result = await walkIns.create(deskS, B, body);
                memberVisit = result;
                const visit = await tx.visit.findUniqueOrThrow({ where: { id: result.visitId } });
                assert.equal(visit.origin, 'WALK_IN');
                assert.equal(visit.bookingId, null, 'no booking is invented');
                assert.equal(
                  visit.ownerUserId,
                  null,
                  'a member recipient is never an inferred owner',
                );
                assert.equal(visit.status, 'OPEN');
                assert.ok(
                  visit.arrivedAt.getTime() >= now.getTime(),
                  'the server clock is the arrival time',
                );
                assert.equal(result.participants[0]!.kind, 'MEMBER');
                assert.equal(result.participants[0]!.state, 'ASSIGNED');
                const line = lineOf(result);
                assert.equal(line.status, 'PLANNED');
                assert.equal(
                  line.employee?.id,
                  k1,
                  'Any: equal minutes → the earliest employee code',
                );
                assert.equal(line.assignmentMode, 'ANY');
                const row = await tx.visitServiceLine.findUniqueOrThrow({ where: { id: line.id } });
                assert.equal(row.durationMinutes, 60);
                assert.equal(
                  row.bufferMinutes,
                  0,
                  'buffer snapshot of the current setting at assignment',
                );
                assert.equal(row.serviceCode, `WI_A_${run}`);
                // OP-1: the limit is snapshotted with the price range and never re-read.
                assert.equal(row.maxQuantitySnapshot, 9);
                assert.equal(row.catalogPricingUnit, 'PER_NAIL');
                // Phase 4 Step 6: the service category is snapshotted too, and a later category move never alters it.
                const categoryThen = (await tx.service.findUniqueOrThrow({ where: { id: svcA } }))
                  .categoryId;
                assert.equal(row.serviceCategoryId, categoryThen);
                const movedTo = await tx.serviceCategory.create({
                  data: {
                    code: `MV_${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
                    nameVi: 'Chuyển',
                    nameEn: 'Moved',
                  },
                });
                await tx.service.update({
                  where: { id: svcA },
                  data: { categoryId: movedTo.id, rowVersion: { increment: 1 } },
                });
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: row.id } }))
                    .serviceCategoryId,
                  categoryThen,
                  'a later category move never alters the historical category',
                );
                await tx.service.update({
                  where: { id: svcA },
                  data: { categoryId: categoryThen, rowVersion: { increment: 1 } },
                });
                await tx.service.update({
                  where: { id: svcA },
                  data: { maxQuantity: 20, rowVersion: { increment: 1 } },
                });
                assert.equal(
                  (await tx.visitServiceLine.findUniqueOrThrow({ where: { id: line.id } }))
                    .maxQuantitySnapshot,
                  9,
                  'a later catalog change never alters an existing visit line',
                );
                await tx.service.update({
                  where: { id: svcA },
                  data: {
                    pricingUnit: 'PER_SERVICE',
                    maxQuantity: 1,
                    rowVersion: { increment: 1 },
                  },
                });
                // Planned from the exact database clock of the intake: never in the past.
                assert.equal(row.plannedStartAt!.getTime(), visit.arrivedAt.getTime());
                assert.equal(
                  row.plannedEndAt!.getTime() - row.plannedStartAt!.getTime(),
                  60 * 60_000,
                );
                assert.equal(await claims(line.id), 1);
                assert.deepEqual(
                  (
                    await tx.outboxEvent.findMany({
                      where: { aggregateId: result.visitId },
                      orderBy: { eventType: 'desc' },
                    })
                  ).map((e) => e.eventType),
                  ['WALK_IN_CREATED', 'VISIT_LINE_SCHEDULED'],
                );
                assert.equal(
                  await tx.auditEvent.count({
                    where: { entityId: result.visitId, action: 'WALK_IN_CREATED' },
                  }),
                  1,
                );
                const replay = await walkIns.create(deskS, B, body);
                assert.equal(replay.visitId, result.visitId);
                assert.equal(
                  await tx.visit.count({ where: { idempotencyKey: body.idempotencyKey } }),
                  1,
                );
              },
            );

            await context.test(
              'guest and child: no account; sequences per participant; split only when needed',
              async () => {
                const result = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [
                      {
                        key: 'g',
                        kind: 'GUEST',
                        displayName: '  Chị   Hoa ',
                        phone: '0905 000 111',
                      },
                      { key: 'c', kind: 'CHILD', displayName: 'Bé Bin', guardianKey: 'g' },
                    ],
                    [
                      { participantKey: 'g', serviceId: svcA, requestedEmployeeUserId: null },
                      { participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: null },
                      { participantKey: 'c', serviceId: svcN, requestedEmployeeUserId: null },
                    ],
                  ),
                );
                assert.equal(
                  await tx.user.count({
                    where: {
                      OR: [
                        { fullName: { in: ['Chị Hoa', 'Bé Bin'] } },
                        { phoneCanonical: '+84905000111' },
                      ],
                    },
                  }),
                  0,
                  'no account for a guest or child',
                );
                // Participants created in one transaction can share a createdAt, so response order is not
                // guaranteed: pick them by kind.
                // Creation order is stable: adults first (request order), then children; createdAt strictly
                // increases, so every (createdAt, id) reader returns exactly this order.
                assert.deepEqual(
                  result.participants.map((p) => p.kind),
                  ['GUEST', 'CHILD'],
                );
                const created = await tx.visitParticipant.findMany({
                  where: { visitId: result.visitId },
                  orderBy: { createdAt: 'asc' },
                  select: { kind: true, createdAt: true },
                });
                assert.deepEqual(
                  created.map((row) => row.kind),
                  ['GUEST', 'CHILD'],
                );
                assert.ok(created[0]!.createdAt < created[1]!.createdAt, 'strictly increasing');
                const guest = result.participants.find((p) => p.kind === 'GUEST');
                const child = result.participants.find((p) => p.kind === 'CHILD');
                assert.equal(result.participants.length, 2);
                assert.equal(guest!.displayName, 'Chị Hoa');
                assert.equal(child!.displayName, 'Bé Bin');
                const participants = await tx.visitParticipant.findMany({
                  where: { visitId: result.visitId },
                });
                const guestRow = participants.find((p) => p.kind === 'GUEST')!;
                assert.equal(
                  participants.find((p) => p.kind === 'CHILD')!.guardianParticipantId,
                  guestRow.id,
                );
                assert.equal(guestRow.phone, '0905000111');
                assert.equal(
                  (await tx.visit.findUniqueOrThrow({ where: { id: result.visitId } })).ownerUserId,
                  null,
                );
                // k1 is busy now, so the guest sequence splits: massage → k2, nails after it → k1 (free again, earlier code).
                assert.deepEqual(
                  guest!.lines.map((line) => [line.sequence, line.status, line.employee?.id]),
                  [
                    [1, 'PLANNED', k2],
                    [2, 'PLANNED', k1],
                  ],
                );
                assert.equal(
                  new Date(guest!.lines[1]!.plannedStartAt!).getTime(),
                  new Date(guest!.lines[0]!.plannedEndAt!).getTime(),
                  'lines follow each other',
                );
                assert.deepEqual(
                  [child!.lines[0]!.status, child!.lines[0]!.employee?.id],
                  ['PLANNED', k3],
                );
                await fails(
                  () =>
                    walkIns.create(
                      deskS,
                      B,
                      request(
                        [{ key: 'c', kind: 'CHILD', displayName: 'Bé' }],
                        [{ participantKey: 'c', serviceId: svcN, requestedEmployeeUserId: null }],
                      ),
                    ),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () =>
                    walkIns.create(
                      deskS,
                      B,
                      request(
                        [{ key: 'x', kind: 'MEMBER', customerUserId: k1 }],
                        [{ participantKey: 'x', serviceId: svcN, requestedEmployeeUserId: null }],
                      ),
                    ),
                  'VALIDATION_FAILED',
                );
              },
            );

            let waitingVisit: WalkInVisitResponse | null = null;
            await context.test(
              'no capacity: intake succeeds, lines WAIT with intent, no KTV, no occupancy',
              async () => {
                // Massage KTVs: k1 and k2 busy now, kAbsent not checked in.
                const any = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [{ key: 'g', kind: 'GUEST', displayName: 'Anh Tú' }],
                    [{ participantKey: 'g', serviceId: svcA, requestedEmployeeUserId: null }],
                  ),
                );
                assert.equal(any.participants[0]!.state, 'WAITING');
                assert.equal(any.participants[0]!.waitReason, 'NO_CAPACITY');
                const waitingLine = lineOf(any);
                assert.deepEqual(
                  [waitingLine.status, waitingLine.employee, waitingLine.plannedStartAt],
                  ['WAITING', null, null],
                );
                assert.equal(await claims(waitingLine.id), 0);
                const row = await tx.visitServiceLine.findUniqueOrThrow({
                  where: { id: waitingLine.id },
                });
                assert.deepEqual(
                  [row.employeeUserId, row.plannedEndAt, row.bufferMinutes, row.durationMinutes],
                  [null, null, null, 60],
                );
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: any.visitId, eventType: 'VISIT_LINE_SCHEDULED' },
                  }),
                  0,
                );
                // A specific KTV not checked in (O6) is never replaced: the line waits for them.
                const absent = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [{ key: 'g', kind: 'GUEST', displayName: 'Chị Mai' }],
                    [{ participantKey: 'g', serviceId: svcA, requestedEmployeeUserId: kAbsent }],
                  ),
                );
                assert.equal(absent.participants[0]!.waitReason, 'REQUESTED_KTV_UNAVAILABLE');
                assert.equal(lineOf(absent).requestedEmployee?.id, kAbsent);
                assert.equal(lineOf(absent).employee, null);
                // Unqualified specific KTV (k3 has no massage skill): stays waiting, not substituted.
                const unqualified = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [{ key: 'g', kind: 'GUEST', displayName: 'Cô Lan' }],
                    [{ participantKey: 'g', serviceId: svcA, requestedEmployeeUserId: k3 }],
                  ),
                );
                assert.equal(unqualified.participants[0]!.waitReason, 'REQUESTED_KTV_UNAVAILABLE');
                waitingVisit = any;
                // Step 3: waiting intent does not occupy anybody.
                const engine = await evaluateSequence(tx, {
                  branchId: B,
                  serviceDate: today,
                  startMinute: Math.floor(
                    ((plus(now, 200).getTime() + offset * 3_600_000) % 86_400_000) / 60_000,
                  ),
                  serviceIds: [svcA],
                  context: 'REVALIDATION',
                  now,
                  employeeUserIds: [kAbsent, k3],
                });
                for (const verdict of engine.lines[0]!.verdicts)
                  assert.ok(!verdict.reasons.includes('CONFLICT'));
              },
            );

            await context.test(
              'future booking protected; assign when capacity is genuinely free; idempotent',
              async () => {
                const kF = await ktv([nails]);
                // A booking for kF starting in 20 minutes: a 30-minute walk-in cannot fit before it.
                const booking = await tx.booking.create({
                  data: {
                    code: `BK-WI-${run}`,
                    branchId: B,
                    ownerUserId: member.id,
                    channel: 'DESK',
                    startsAt: plus(now, 20),
                    endsAt: plus(now, 50),
                    serviceDate: new Date(today),
                    idempotencyKey: randomUUID(),
                    createdByUserId: desk,
                  },
                  select: { id: true },
                });
                const recipient = await tx.bookingRecipient.create({
                  data: { bookingId: booking.id, relation: 'SELF' },
                  select: { id: true },
                });
                await tx.bookingServiceLine.create({
                  data: {
                    bookingId: booking.id,
                    recipientId: recipient.id,
                    sequence: 1,
                    serviceId: svcN,
                    employeeUserId: kF,
                    assignmentMode: 'SPECIFIC',
                    plannedStartAt: plus(now, 20),
                    plannedEndAt: plus(now, 50),
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    serviceCode: 'N',
                    serviceNameVi: 'N',
                    serviceNameEn: 'N',
                    catalogPriceMinVnd: 1n,
                    catalogPriceMaxVnd: 1n,
                    catalogPricingUnit: 'PER_SERVICE',
                  },
                });
                const waitingForF = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [{ key: 'g', kind: 'GUEST', displayName: 'Chị Nga' }],
                    [{ participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: kF }],
                  ),
                );
                assert.equal(
                  waitingForF.participants[0]!.state,
                  'WAITING',
                  'the protected booking wins',
                );
                await tx.booking.update({
                  where: { id: booking.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: now,
                    cancelledByUserId: member.id,
                    cancelledLate: false,
                    rowVersion: { increment: 1 },
                  },
                });
                const participantId = waitingForF.participants[0]!.participantId;
                const assigned = await walkIns.assign(deskS, waitingForF.visitId, participantId);
                assert.equal(assigned.participants[0]!.state, 'ASSIGNED');
                assert.equal(lineOf(assigned).employee?.id, kF, 'the requested KTV, never another');
                assert.equal(lineOf(assigned).requestedEmployee?.id, kF);
                assert.equal(await claims(lineOf(assigned).id), 1);
                const again = await walkIns.assign(deskS, waitingForF.visitId, participantId);
                assert.equal(lineOf(again).employee?.id, kF);
                assert.equal(await claims(lineOf(assigned).id), 1, 'no double claim');
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: waitingForF.visitId, eventType: 'VISIT_LINE_SCHEDULED' },
                  }),
                  1,
                );
                await fails(
                  () => walkIns.assign(viewerS, waitingForF.visitId, participantId),
                  'FORBIDDEN',
                );
              },
            );

            await context.test(
              'waiting intent: ANY ↔ SPECIFIC and A → B, audited; never on assigned lines',
              async () => {
                const visit = waitingVisit!;
                const lineId = lineOf(visit).id;
                const change = (requested: string | null, session = deskS) =>
                  walkIns.changeIntent(session, visit.visitId, lineId, {
                    requestedEmployeeUserId: requested,
                  });
                let result = await change(kAbsent);
                assert.deepEqual(
                  [lineOf(result).assignmentMode, lineOf(result).requestedEmployee?.id],
                  ['SPECIFIC', kAbsent],
                );
                result = await change(k2);
                assert.equal(lineOf(result).requestedEmployee?.id, k2);
                result = await change(null);
                assert.deepEqual(
                  [lineOf(result).assignmentMode, lineOf(result).requestedEmployee],
                  ['ANY', null],
                );
                assert.equal(lineOf(result).status, 'WAITING');
                assert.equal(await claims(lineId), 0, 'changing intent claims nothing');
                assert.equal(
                  await tx.auditEvent.count({
                    where: { entityId: lineId, action: 'WAITING_INTENT_CHANGED' },
                  }),
                  3,
                );
                await fails(() => change(elsewhere), 'VALIDATION_FAILED'); // not assigned at this branch
                await fails(() => change(k2, viewerS), 'FORBIDDEN');
                await fails(() => change(k2, elsewhereS), 'FORBIDDEN');
                const assignedLine = lineOf(memberVisit!).id;
                await fails(
                  () =>
                    walkIns.changeIntent(deskS, memberVisit!.visitId, assignedLine, {
                      requestedEmployeeUserId: k2,
                    }),
                  'WALKIN_LINE_NOT_WAITING',
                );
              },
            );

            await context.test(
              'board: branch waiting pool by arrival, advance first; assigned lines in KTV queues',
              async () => {
                const board = await operations.today(managerS, B);
                const pool = board.waitingPool;
                assert.ok(pool.length >= 3);
                assert.ok(pool.every((entry) => entry.group === 'WALK_IN'));
                const arrivals = pool.map((entry) => entry.arrivedAt);
                assert.deepEqual(arrivals, [...arrivals].sort(), 'actual arrival order');
                assert.ok(pool.every((entry) => entry.lines.every((line) => line.id)));
                const last = pool[pool.length - 1]!;
                await operations.advance(managerS, last.visitId, { reason: 'Khách chờ lâu' });
                const advanced = (await operations.today(managerS, B)).waitingPool;
                assert.equal(advanced[0]!.visitId, last.visitId);
                assert.equal(advanced[0]!.group, 'OVERRIDE');
                // The member's assigned walk-in line sits in k1's queue in the WALK_IN group.
                const k1Queue = board.queue.find((entry) => entry.employee.id === k1)!;
                assert.ok(
                  k1Queue.waiting.some(
                    (entry) => entry.visitId === memberVisit!.visitId && entry.group === 'WALK_IN',
                  ),
                );
                assert.equal(k1Queue.freeNow, false);
                assert.ok(
                  !board.queue.some((entry) => entry.employee.id === kAbsent),
                  'no fake KTV for waiting lines',
                );
              },
            );

            await context.test(
              'owner is never inferred from participants or their order',
              async () => {
                const guestFirst = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [
                      { key: 'g', kind: 'GUEST', displayName: 'Khách' },
                      { key: 'm', kind: 'MEMBER', customerUserId: member.id },
                    ],
                    [{ participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: kAbsent }],
                  ),
                );
                const memberFirst = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [
                      { key: 'm', kind: 'MEMBER', customerUserId: member.id },
                      { key: 'g', kind: 'GUEST', displayName: 'Khách' },
                    ],
                    [{ participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: kAbsent }],
                  ),
                );
                for (const visitId of [guestFirst.visitId, memberFirst.visitId]) {
                  assert.equal(
                    (await tx.visit.findUniqueOrThrow({ where: { id: visitId } })).ownerUserId,
                    null,
                  );
                }
              },
            );

            await context.test(
              'cancel a waiting walk-in: lines and visit cancelled, no occupancy, audited',
              async () => {
                const waiting = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [
                      { key: 'g', kind: 'GUEST', displayName: 'Chị Rời' },
                      { key: 'c', kind: 'CHILD', displayName: 'Bé Rời', guardianKey: 'g' },
                    ],
                    [
                      { participantKey: 'g', serviceId: svcA, requestedEmployeeUserId: kAbsent },
                      { participantKey: 'c', serviceId: svcA, requestedEmployeeUserId: kAbsent },
                    ],
                  ),
                );
                assert.ok(waiting.participants.every((p) => p.state === 'WAITING'));
                await fails(
                  () => walkIns.cancel(deskS, waiting.visitId, { reason: '  ' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  () => walkIns.cancel(viewerS, waiting.visitId, { reason: 'x' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => walkIns.cancel(elsewhereS, waiting.visitId, { reason: 'x' }),
                  'FORBIDDEN',
                );
                const cancelled = await walkIns.cancel(deskS, waiting.visitId, {
                  reason: 'Khách không chờ nữa',
                });
                assert.ok(
                  cancelled.participants.every((p) =>
                    p.lines.every((line) => line.status === 'CANCELLED'),
                  ),
                );
                const visit = await tx.visit.findUniqueOrThrow({
                  where: { id: waiting.visitId },
                  include: { lines: true },
                });
                assert.equal(visit.status, 'CANCELLED');
                assert.equal(visit.cancelReason, 'Khách không chờ nữa');
                assert.ok(
                  visit.lines.every(
                    (line) => line.status === 'CANCELLED' && line.employeeUserId === null,
                  ),
                );
                for (const line of visit.lines) assert.equal(await claims(line.id), 0);
                const pool = (await operations.today(managerS, B)).waitingPool;
                assert.ok(
                  !pool.some((entry) => entry.visitId === waiting.visitId),
                  'gone from the waiting pool',
                );
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { entityId: waiting.visitId, action: 'WALK_IN_CANCELLED' },
                });
                assert.equal(audit.reason, 'Khách không chờ nữa');
                await walkIns.cancel(deskS, waiting.visitId, { reason: 'again' });
                assert.equal(
                  await tx.auditEvent.count({
                    where: { entityId: waiting.visitId, action: 'WALK_IN_CANCELLED' },
                  }),
                  1,
                  'a repeat is harmless',
                );
                await fails(
                  () =>
                    walkIns.assign(deskS, waiting.visitId, waiting.participants[0]!.participantId),
                  'WALKIN_NOT_ASSIGNABLE',
                );

                // An assigned walk-in that has not started can also leave: its planned time is released.
                const kFree = await ktv([nails]);
                const assigned = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [{ key: 'g', kind: 'GUEST', displayName: 'Anh Đi' }],
                    [{ participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: kFree }],
                  ),
                );
                assert.equal(assigned.participants[0]!.state, 'ASSIGNED');
                const lineId = lineOf(assigned).id;
                assert.equal(await claims(lineId), 1);
                await walkIns.cancel(deskS, assigned.visitId, { reason: 'Đổi ý' });
                assert.equal(await claims(lineId), 0);

                // Once a service started, the walk-in can no longer be cancelled here.
                const kRun = await ktv([nails]);
                const running = await walkIns.create(
                  deskS,
                  B,
                  request(
                    [{ key: 'g', kind: 'GUEST', displayName: 'Chị Làm' }],
                    [{ participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: kRun }],
                  ),
                );
                const runningLine = lineOf(running).id;
                await tx.visitServiceLine.update({
                  where: { id: runningLine },
                  data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                });
                await tx.visit.update({
                  where: { id: running.visitId },
                  data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
                });
                await fails(
                  () => walkIns.cancel(deskS, running.visitId, { reason: 'x' }),
                  'WALKIN_CANCEL_NOT_ALLOWED',
                );
              },
            );

            await context.test('permissions and branch scope for intake', async () => {
              const body = request(
                [{ key: 'g', kind: 'GUEST', displayName: 'X' }],
                [{ participantKey: 'g', serviceId: svcN, requestedEmployeeUserId: null }],
              );
              await fails(() => walkIns.create(viewerS, B, body), 'FORBIDDEN');
              await fails(() => walkIns.create(elsewhereS, B, body), 'FORBIDDEN');
              await fails(() => walkIns.create(undefined, B, body), 'AUTHENTICATION_REQUIRED');
              await fails(() => walkIns.options(viewerS, B), 'FORBIDDEN');
              const options = await walkIns.options(deskS, B);
              const massageService = options.services.find((entry) => entry.id === svcA)!;
              assert.deepEqual(
                massageService.employees.map((entry) => [entry.id, entry.checkedIn]).sort(),
                [
                  [k1, true],
                  [k2, true],
                  [kAbsent, false],
                ].sort(),
              );
            });

            throw rollback;
          },
          { timeout: 120_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);
