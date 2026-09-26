import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
import type { AdminActor, AdminContext } from '../authorization/admin-command.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { arriveBooking, markNoShow } from './operations.core.js';
import { OperationsService } from './operations.service.js';

const code = (error: unknown) => (error instanceof AuthError ? error.code : String(error));
const plus = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Operational booking board, queue and arrival (Phase 3 Step 5); all fixtures roll back',
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
    const rollback = new Error('Intentional operations rollback');
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
            const operations = new OperationsService(runner, new AuthThrottleService(environment));
            const fails = async (work: () => Promise<unknown>, expected: string) => {
              await assert.rejects(work, (error: unknown) => {
                assert.equal(code(error), expected);
                return true;
              });
            };
            /** The transactional cores at an explicit instant (exact boundary tests). */
            const at = (now: Date, actorUserId: string): AdminContext => ({
              tx,
              now,
              actor: { userId: actorUserId } as AdminActor,
              requestId: null,
            });
            const allow = () => undefined;
            const inSavepoint = <T>(work: () => Promise<T>) => isolated(work);

            // ---------------------------------------------------------------- fixtures
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            // A timezone where it is about noon now, so "today" never straddles midnight.
            const [clock] = await tx.$queryRaw<{ now: Date; hour: number }[]>`
              SELECT now() AS now, extract(hour FROM now() AT TIME ZONE 'UTC')::int AS hour`;
            const now = clock!.now;
            const offset = 12 - clock!.hour; // local = UTC + offset
            const zone =
              offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
            const localDay = (instant: Date) =>
              new Date(instant.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
            const today = localDay(now);
            /** A branch-local wall-clock time today (or on another local date). */
            const localAt = (hhmm: string, date = today) =>
              new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - offset * 3_600_000);

            let sequence = 0;
            const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
            const user = async (kind: 'CUSTOMER' | 'EMPLOYEE') => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Ops fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `ops-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailDelivery: `ops-${sequence}-${run.toLowerCase()}@example.invalid`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+849${phoneBase}${String(sequence).padStart(3, '0')}`,
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
                            employeeCodeCanonical: `OPS_${run}_${sequence}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'F',
                          },
                        },
                      }),
                },
              });
              return id;
            };
            const branch = async (label: string, timezone: string) =>
              (
                await tx.branch.create({
                  data: { code: `IT-OPS-${label}-${run}`, name: `Ops ${label}`, timezone },
                  select: { id: true },
                })
              ).id;
            const B = await branch('B', zone);
            const C = await branch('C', zone);
            const grant = async (userId: string, codes: PermissionCode[], branchId: string) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `IT_OPS_${run}_${sequence}`,
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
            const staff = async (codes: PermissionCode[], branchId: string) => {
              const id = await user('EMPLOYEE');
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: id, branchId, grantedByUserId: id },
              });
              if (codes.length) await grant(id, codes, branchId);
              return id;
            };
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
            const viewer = await staff(['VIEW_BOOKINGS'], B);
            const desk = await staff(['VIEW_BOOKINGS', 'MANAGE_BOOKINGS'], B);
            const manager = await staff(['VIEW_BOOKINGS', 'MANAGE_BOOKINGS', 'MANAGE_QUEUE'], B);
            const elsewhere = await staff(['VIEW_BOOKINGS', 'MANAGE_BOOKINGS', 'MANAGE_QUEUE'], C);
            const plain = await staff([], B);
            const ktv1 = await staff([], B);
            const ktv2 = await staff([], B);
            const ktv3 = await staff([], B);
            const customer = await user('CUSTOMER');
            const [viewerS, deskS, managerS, elsewhereS, plainS] = await Promise.all(
              [viewer, desk, manager, elsewhere, plain].map(login),
            );
            const category = (
              await tx.serviceCategory.create({
                data: { code: `OPS_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
                select: { id: true },
              })
            ).id;
            const service = (
              await tx.service.create({
                data: {
                  code: `OPS_SVC_${run}`,
                  categoryId: category,
                  nameVi: 'Gội đầu',
                  nameEn: 'Hair wash',
                  priceVnd: 100_000n,
                  priceMaxVnd: 150_000n,
                  durationMinutes: 30,
                  estimatedMinMinutes: 30,
                  estimatedMaxMinutes: 30,
                },
                select: { id: true },
              })
            ).id;

            // Open all day, service offered here: the engine can evaluate this branch.
            for (let isoWeekday = 1; isoWeekday <= 7; isoWeekday += 1) {
              await tx.branchOperatingHours.create({
                data: { branchId: B, isoWeekday, opensAtMinute: 0, closesAtMinute: 1440 },
              });
            }
            await tx.serviceBranchAvailability.create({
              data: { serviceId: service, branchId: B },
            });
            let codes = 0;
            /** A CONFIRMED booking created directly (Step 4 is tested elsewhere). */
            const booking = async (input: {
              branchId?: string;
              startsAt: Date;
              lines: { ktv: string; recipient: 'self' | 'kid' | 'aunt' }[];
            }) => {
              const branchId = input.branchId ?? B;
              const endsAt = plus(input.startsAt, 30 * input.lines.length);
              const created = await tx.booking.create({
                data: {
                  code: `BK-OPS${++codes}-${run}`,
                  branchId,
                  ownerUserId: customer,
                  channel: 'ONLINE',
                  startsAt: input.startsAt,
                  endsAt,
                  serviceDate: new Date(localDay(input.startsAt)),
                  idempotencyKey: randomUUID(),
                  createdByUserId: customer,
                },
                select: { id: true, code: true },
              });
              const recipients = new Map<string, string>();
              const needed = [...new Set(input.lines.map((line) => line.recipient))];
              for (const key of needed) {
                const row = await tx.bookingRecipient.create({
                  data:
                    key === 'self'
                      ? { bookingId: created.id, relation: 'SELF' }
                      : key === 'kid'
                        ? { bookingId: created.id, relation: 'CHILD', displayName: 'Bé Na' }
                        : {
                            bookingId: created.id,
                            relation: 'FAMILY',
                            displayName: 'Dì Lan',
                            phone: '0905111222',
                          },
                  select: { id: true },
                });
                recipients.set(key, row.id);
              }
              for (const [index, line] of input.lines.entries()) {
                const start = plus(input.startsAt, 30 * index);
                await tx.bookingServiceLine.create({
                  data: {
                    bookingId: created.id,
                    recipientId: recipients.get(line.recipient)!,
                    sequence: index + 1,
                    serviceId: service,
                    employeeUserId: line.ktv,
                    assignmentMode: index === 0 ? 'SPECIFIC' : 'ANY',
                    plannedStartAt: start,
                    plannedEndAt: plus(start, 30),
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    serviceCode: `SNAP_${index}`,
                    serviceNameVi: 'Gội (ảnh chụp)',
                    serviceNameEn: 'Wash (snapshot)',
                    catalogPriceMinVnd: 90_000n,
                    catalogPriceMaxVnd: 90_000n,
                    catalogPricingUnit: 'PER_SERVICE',
                  },
                });
              }
              return created;
            };
            const setSetting = (key: string, value: number) =>
              tx.appSetting.update({
                where: { key },
                data: { value, rowVersion: { increment: 1 } },
              });

            // ---------------------------------------------------------------- tests
            await context.test(
              'board: branch and branch-local day only; read model; view-only actions',
              async () => {
                const early = await booking({
                  startsAt: localAt('00:30'),
                  lines: [{ ktv: ktv3, recipient: 'self' }],
                });
                const late = await booking({
                  startsAt: localAt('23:30'),
                  lines: [{ ktv: ktv3, recipient: 'self' }],
                });
                const tomorrow = await booking({
                  startsAt: localAt('00:10', localDay(plus(now, 24 * 60))),
                  lines: [{ ktv: ktv3, recipient: 'self' }],
                });
                const other = await booking({
                  branchId: C,
                  startsAt: plus(now, 90),
                  lines: [{ ktv: ktv1, recipient: 'self' }],
                });
                const family = await booking({
                  startsAt: plus(now, 120),
                  lines: [
                    { ktv: ktv1, recipient: 'self' },
                    { ktv: ktv2, recipient: 'kid' },
                  ],
                });
                const board = await operations.today(viewerS, B);
                assert.equal(board.date, today);
                assert.equal(board.branch.timezone, zone);
                assert.deepEqual(board.settings, { checkInWindowMinutes: 60, lateHoldMinutes: 20 });
                const codesOnBoard = board.bookings.map((entry) => entry.code);
                assert.ok(codesOnBoard.includes(early.code) && codesOnBoard.includes(late.code));
                assert.ok(!codesOnBoard.includes(tomorrow.code), 'another branch-local date');
                assert.ok(!codesOnBoard.includes(other.code), 'another branch');
                const row = board.bookings.find((entry) => entry.code === family.code)!;
                assert.equal(row.state, 'UPCOMING');
                assert.match(row.owner.phoneMasked ?? '', /^•+\d{3}$/);
                assert.deepEqual(
                  row.lines.map((l) => [l.employee.id, l.recipientRelation, l.recipientName]),
                  [
                    [ktv1, 'SELF', null],
                    [ktv2, 'CHILD', 'Bé Na'],
                  ],
                );
                assert.equal(row.arrivalOpensAt, plus(plus(now, 120), -60).toISOString());
                assert.deepEqual(row.actions, { arrive: false, noShow: false, advance: false });
                assert.deepEqual(board.permissions, { arrive: false, manageQueue: false });
                assert.ok(!('ownerUserId' in row) && !('idempotencyKey' in row));
                await fails(() => operations.today(plainS, B), 'FORBIDDEN');
                await fails(() => operations.today(elsewhereS, B), 'FORBIDDEN');
                await fails(() => operations.today(undefined, B), 'AUTHENTICATION_REQUIRED');
              },
            );

            await context.test(
              'arrival window (O2): 61 min early refused, exactly 60 allowed; setting',
              async () => {
                const start = plus(now, 180);
                const target = await booking({
                  startsAt: start,
                  lines: [{ ktv: ktv1, recipient: 'self' }],
                });
                await fails(
                  () =>
                    inSavepoint(() => arriveBooking(at(plus(start, -61), desk), target.id, allow)),
                  'BOOKING_ARRIVAL_TOO_EARLY',
                );
                assert.equal(
                  (await tx.booking.findUniqueOrThrow({ where: { id: target.id } })).status,
                  'CONFIRMED',
                );
                assert.equal(
                  await tx.visit.count({ where: { bookingId: target.id } }),
                  0,
                  'nothing written',
                );
                await setSetting('booking.checkInWindowMinutes', 90);
                const wider = await booking({
                  startsAt: plus(start, 60),
                  lines: [{ ktv: ktv2, recipient: 'self' }],
                });
                await inSavepoint(() => arriveBooking(at(plus(start, -1), desk), wider.id, allow)); // 61 min early
                await setSetting('booking.checkInWindowMinutes', 60);
                const visitId = await inSavepoint(() =>
                  arriveBooking(at(plus(start, -60), desk), target.id, allow),
                );
                assert.ok(visitId);
              },
            );

            await context.test(
              'arrival: one visit, participants, lines, KTVs, snapshots; no START; repeat',
              async () => {
                const start = plus(now, 30);
                const target = await booking({
                  startsAt: start,
                  lines: [
                    { ktv: ktv3, recipient: 'self' },
                    { ktv: ktv3, recipient: 'kid' },
                    { ktv: ktv2, recipient: 'aunt' },
                  ],
                });
                const claims = () =>
                  tx.$queryRaw<{ booking: bigint; visit: bigint }[]>`
                  SELECT count(o.booking_service_line_id) AS booking, count(o.visit_service_line_id) AS visit
                  FROM ktv_occupancies o
                  LEFT JOIN booking_service_lines bl ON bl.id = o.booking_service_line_id
                  LEFT JOIN visit_service_lines vl ON vl.id = o.visit_service_line_id
                  WHERE bl.booking_id = ${target.id}::uuid
                     OR vl.booking_service_line_id IN (SELECT id FROM booking_service_lines WHERE booking_id = ${target.id}::uuid)`.then(
                    (rows) => [Number(rows[0]!.booking), Number(rows[0]!.visit)],
                  );
                assert.deepEqual(await claims(), [3, 0]);
                const result = await operations.arrive(deskS, target.id);
                const again = await operations.arrive(deskS, target.id);
                assert.equal(again.visitId, result.visitId, 'a repeat returns the same visit');
                assert.equal(await tx.visit.count({ where: { bookingId: target.id } }), 1);
                const visit = await tx.visit.findUniqueOrThrow({
                  where: { id: result.visitId },
                  include: {
                    participants: { orderBy: { createdAt: 'asc' } },
                    lines: { orderBy: [{ plannedStartAt: 'asc' }] },
                  },
                });
                assert.equal(visit.status, 'OPEN');
                assert.equal(visit.origin, 'BOOKING');
                assert.equal(visit.branchId, B);
                assert.equal(visit.ownerUserId, customer);
                const kinds = visit.participants.map((p) => [p.kind, p.displayName, p.phone]);
                assert.deepEqual(kinds, [
                  ['MEMBER', null, null],
                  ['CHILD', 'Bé Na', null],
                  ['GUEST', 'Dì Lan', '0905111222'],
                ]);
                const member = visit.participants[0]!;
                assert.equal(member.customerUserId, customer);
                assert.equal(visit.participants[1]!.guardianParticipantId, member.id);
                const bookingLines = await tx.bookingServiceLine.findMany({
                  where: { bookingId: target.id },
                  orderBy: { sequence: 'asc' },
                });
                assert.deepEqual(
                  visit.lines.map((l) => [
                    l.bookingServiceLineId,
                    l.employeeUserId,
                    l.plannedStartAt?.toISOString(),
                    l.status,
                    l.serviceCode,
                    l.assignmentMode,
                    l.sequence,
                  ]),
                  bookingLines.map((l) => [
                    l.id,
                    l.employeeUserId,
                    l.plannedStartAt.toISOString(),
                    'PLANNED',
                    l.serviceCode,
                    l.assignmentMode,
                    1,
                  ]),
                );
                assert.equal(
                  visit.lines[0]!.serviceNameVi,
                  'Gội (ảnh chụp)',
                  'snapshot carried, not the catalog',
                );
                assert.equal(
                  await tx.serviceExecution.count({
                    where: { visitServiceLineId: { in: visit.lines.map((l) => l.id) } },
                  }),
                  0,
                );
                assert.deepEqual(await claims(), [0, 3], 'occupancy moved, not duplicated');
                const booked = await tx.booking.findUniqueOrThrow({ where: { id: target.id } });
                assert.equal(booked.status, 'CHECKED_IN');
                assert.equal(booked.checkedInByUserId, desk);
                assert.equal(
                  await tx.auditEvent.count({
                    where: { entityId: target.id, action: 'BOOKING_CHECKED_IN' },
                  }),
                  1,
                );
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: target.id, eventType: 'CUSTOMER_ARRIVED' },
                  }),
                  1,
                );
                // A booking only for a child (the owner not a recipient): the child is a GUEST.
                const kidOnly = await booking({
                  startsAt: plus(now, 45),
                  lines: [{ ktv: ktv1, recipient: 'kid' }],
                });
                const kidVisit = await operations.arrive(deskS, kidOnly.id);
                const participant = await tx.visitParticipant.findFirstOrThrow({
                  where: { visitId: kidVisit.visitId },
                });
                assert.deepEqual([participant.kind, participant.displayName], ['GUEST', 'Bé Na']);
                const board = await operations.today(managerS, B);
                const row = board.bookings.find((entry) => entry.id === target.id)!;
                assert.equal(row.state, 'ARRIVED');
                assert.equal(row.visit?.punctuality, 'ON_TIME');
                assert.equal(row.actions.advance, true);
              },
            );

            await context.test(
              'late hold protects capacity; NO_SHOW only after it; release; audit/event',
              async () => {
                const start = plus(now, -15);
                const late = await booking({
                  startsAt: start,
                  lines: [{ ktv: ktv1, recipient: 'self' }],
                });
                const board = await operations.today(managerS, B);
                const row = board.bookings.find((entry) => entry.id === late.id)!;
                assert.equal(row.state, 'LATE_HOLD');
                assert.deepEqual(row.actions, { arrive: true, noShow: false, advance: false });
                const ktvQueue = board.queue.find((entry) => entry.employee.id === ktv1)!;
                assert.equal(ktvQueue.freeNow, false, 'the late booking still reserves the KTV');
                assert.ok(
                  ktvQueue.reserved.some(
                    (entry) => entry.bookingId === late.id && entry.state === 'LATE_HOLD',
                  ),
                );
                const engine = () =>
                  evaluateSequence(tx, {
                    branchId: B,
                    serviceDate: localDay(start),
                    startMinute: Math.floor(
                      ((start.getTime() + offset * 3_600_000) % 86_400_000) / 60_000,
                    ),
                    serviceIds: [service],
                    context: 'REVALIDATION',
                    now,
                    employeeUserIds: [ktv1],
                  });
                assert.deepEqual(
                  (await engine()).lines[0]?.verdicts[0]?.reasons.includes('CONFLICT'),
                  true,
                );
                // Boundaries at an explicit instant: the hold includes its end; the setting decides.
                await fails(
                  () =>
                    inSavepoint(() =>
                      markNoShow(at(plus(start, 20), manager), late.id, 'x', allow),
                    ),
                  'BOOKING_HOLD_ACTIVE',
                );
                await setSetting('booking.lateHoldMinutes', 30);
                await fails(
                  () =>
                    inSavepoint(() =>
                      markNoShow(at(plus(start, 25), manager), late.id, 'x', allow),
                    ),
                  'BOOKING_HOLD_ACTIVE',
                );
                await setSetting('booking.lateHoldMinutes', 20);
                // Nothing automatic: much later the booking is still CONFIRMED and reserved.
                assert.equal(
                  (await tx.booking.findUniqueOrThrow({ where: { id: late.id } })).status,
                  'CONFIRMED',
                );
                await fails(() => operations.noShow(deskS, late.id, { reason: 'x' }), 'FORBIDDEN');
                await fails(
                  () => operations.noShow(elsewhereS, late.id, { reason: 'x' }),
                  'FORBIDDEN',
                );
                await fails(
                  () => operations.noShow(managerS, late.id, { reason: '  ' }),
                  'VALIDATION_FAILED',
                );
                await inSavepoint(() =>
                  markNoShow(at(plus(start, 21), manager), late.id, 'Không đến', allow),
                );
                await inSavepoint(() =>
                  markNoShow(at(plus(start, 22), manager), late.id, 'again', allow),
                );
                const after = await tx.booking.findUniqueOrThrow({ where: { id: late.id } });
                assert.equal(after.status, 'NO_SHOW');
                assert.equal(after.noShowByUserId, manager);
                assert.equal(after.noShowReason, 'Không đến');
                assert.equal(
                  await tx.outboxEvent.count({
                    where: { aggregateId: late.id, eventType: 'BOOKING_NO_SHOW' },
                  }),
                  1,
                );
                const audit = await tx.auditEvent.findFirstOrThrow({
                  where: { entityId: late.id, action: 'BOOKING_NO_SHOW' },
                });
                assert.equal(audit.reason, 'Không đến');
                assert.equal(audit.actorUserId, manager);
                assert.equal(
                  (await engine()).lines[0]?.verdicts[0]?.reasons.includes('CONFLICT'),
                  false,
                  'capacity released',
                );
                await fails(() => operations.arrive(deskS, late.id), 'BOOKING_ARRIVAL_NOT_ALLOWED');
              },
            );

            await context.test('no NO_SHOW once arrived or started', async () => {
              const start = plus(now, -45);
              const arrived = await booking({
                startsAt: start,
                lines: [{ ktv: ktv2, recipient: 'self' }],
              });
              const { visitId } = await operations.arrive(deskS, arrived.id);
              await fails(
                () => operations.noShow(managerS, arrived.id, { reason: 'x' }),
                'BOOKING_NO_SHOW_NOT_ALLOWED',
              );
              const line = await tx.visitServiceLine.findFirstOrThrow({ where: { visitId } });
              await tx.visitServiceLine.update({
                where: { id: line.id },
                data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
              });
              await tx.visit.update({
                where: { id: visitId },
                data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
              });
              await tx.serviceExecution.create({
                data: {
                  visitServiceLineId: line.id,
                  employeeUserId: ktv2,
                  startedAt: now,
                  expectedEndAt: plus(now, 30),
                },
              });
              await fails(
                () => operations.noShow(managerS, arrived.id, { reason: 'x' }),
                'BOOKING_NO_SHOW_NOT_ALLOWED',
              );
              await fails(
                () => operations.advance(managerS, visitId, { reason: 'x' }),
                'QUEUE_ADVANCE_NOT_ALLOWED',
              );
              const board = await operations.today(managerS, B);
              assert.equal(
                board.bookings.find((entry) => entry.id === arrived.id)?.state,
                'IN_SERVICE',
              );
              const queue = board.queue.find((entry) => entry.employee.id === ktv2)!;
              assert.equal(queue.freeNow, false);
              assert.equal(queue.serving.length, 1);
            });

            await context.test(
              'computed queue: on-time before late, Manager override first; deterministic',
              async () => {
                const ktv = await staff([], B);
                const onTime = await booking({
                  startsAt: plus(now, 50),
                  lines: [{ ktv, recipient: 'self' }],
                });
                const lateOne = await booking({
                  startsAt: plus(now, -10),
                  lines: [{ ktv, recipient: 'self' }],
                });
                await operations.arrive(deskS, onTime.id); // arrives before its start
                const lateVisit = await operations.arrive(deskS, lateOne.id); // after its start
                const queueOf = async () =>
                  (await operations.today(managerS, B)).queue.find(
                    (entry) => entry.employee.id === ktv,
                  )!;
                const first = await queueOf();
                assert.deepEqual(
                  first.waiting.map((entry) => [entry.bookingCode, entry.group, entry.position]),
                  [
                    [onTime.code, 'ON_TIME', 1],
                    [lateOne.code, 'LATE_IN_HOLD', 2],
                  ],
                );
                assert.deepEqual((await queueOf()).waiting, first.waiting, 'deterministic');
                await fails(
                  () => operations.advance(deskS, lateVisit.visitId, { reason: 'x' }),
                  'FORBIDDEN',
                );
                await operations.advance(managerS, lateVisit.visitId, {
                  reason: 'Khách VIP đã chờ',
                });
                await operations.advance(managerS, lateVisit.visitId, { reason: 'again' });
                const advanced = await queueOf();
                assert.deepEqual(
                  advanced.waiting.map((entry) => [entry.bookingCode, entry.group]),
                  [
                    [lateOne.code, 'OVERRIDE'],
                    [onTime.code, 'ON_TIME'],
                  ],
                );
                assert.equal(
                  await tx.auditEvent.count({
                    where: { entityId: lateVisit.visitId, action: 'QUEUE_ADVANCED' },
                  }),
                  1,
                );
                const [tables] = await tx.$queryRaw<{ n: bigint }[]>`
                SELECT count(*) AS n FROM information_schema.tables WHERE table_name ILIKE '%queue%'`;
                assert.equal(Number(tables!.n), 0, 'no stored queue table');
              },
            );

            await context.test(
              'after the hold: arrival allowed, priority lost, ordered by arrival; advance overrides',
              async () => {
                const ktv = await staff([], B);
                const one = (startsAt: Date) =>
                  booking({ startsAt, lines: [{ ktv, recipient: 'self' }] });
                const a = await one(plus(now, -160)); // hold ended at now − 140
                const b = await one(plus(now, -120)); // hold ended at now − 100
                const c = await one(plus(now, -80)); // arrives exactly at its hold end
                const d = await one(plus(now, 40)); // arrives before its start
                // Hours after its hold, nothing happened automatically.
                assert.equal(
                  (await tx.booking.findUniqueOrThrow({ where: { id: a.id } })).status,
                  'CONFIRMED',
                );
                await inSavepoint(() => arriveBooking(at(plus(now, -60), desk), c.id, allow)); // start + 20
                await inSavepoint(() => arriveBooking(at(plus(now, -8), desk), b.id, allow));
                const aVisit = await inSavepoint(() =>
                  arriveBooking(at(plus(now, -2), desk), a.id, allow),
                );
                await inSavepoint(() => arriveBooking(at(plus(now, -1), desk), d.id, allow));
                const board = await operations.today(managerS, B);
                const punctual = (id: string) =>
                  board.bookings.find((entry) => entry.id === id)?.visit?.punctuality;
                assert.deepEqual(
                  [punctual(a.id), punctual(b.id), punctual(c.id), punctual(d.id)],
                  ['LATE_AFTER_HOLD', 'LATE_AFTER_HOLD', 'LATE_IN_HOLD', 'ON_TIME'],
                );
                const order = (queue: typeof board.queue) =>
                  queue
                    .find((entry) => entry.employee.id === ktv)!
                    .waiting.map((entry) => [entry.bookingCode, entry.group]);
                // a was planned before b but arrived after b: after the hold, arrival time decides.
                assert.deepEqual(order(board.queue), [
                  [d.code, 'ON_TIME'],
                  [c.code, 'LATE_IN_HOLD'],
                  [b.code, 'LATE_AFTER_HOLD'],
                  [a.code, 'LATE_AFTER_HOLD'],
                ]);
                await operations.advance(managerS, aVisit, { reason: 'Khách chờ lâu' });
                assert.deepEqual(order((await operations.today(managerS, B)).queue), [
                  [a.code, 'OVERRIDE'],
                  [d.code, 'ON_TIME'],
                  [c.code, 'LATE_IN_HOLD'],
                  [b.code, 'LATE_AFTER_HOLD'],
                ]);
              },
            );

            await context.test(
              'permission mapping: view, arrive, manage queue; branch scope',
              async () => {
                const start = plus(now, 20);
                const target = await booking({
                  startsAt: start,
                  lines: [{ ktv: await staff([], B), recipient: 'self' }],
                });
                await fails(() => operations.arrive(viewerS, target.id), 'FORBIDDEN');
                await fails(() => operations.arrive(elsewhereS, target.id), 'FORBIDDEN');
                await fails(() => operations.arrive(plainS, target.id), 'FORBIDDEN');
                const desks = await operations.today(deskS, B);
                assert.deepEqual(desks.permissions, { arrive: true, manageQueue: false });
                await operations.arrive(managerS, target.id);
              },
            );

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
