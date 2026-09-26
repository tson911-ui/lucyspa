import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BOOKING_SETTINGS,
  createDatabaseClient,
  isValidBookingSetting,
  PERMISSION_CATALOG,
  syncPermissionCatalog,
  type Prisma,
} from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const PHASE3_CODES = [
  'VIEW_BOOKINGS',
  'MANAGE_BOOKINGS',
  'MANAGE_QUEUE',
  'REASSIGN_SERVICES',
  'PERFORM_SERVICES',
  'RESOLVE_SERVICE_EXECUTION',
  'MANAGE_BOOKING_SETTINGS',
];

// Monday 2027-03-01 in Asia/Ho_Chi_Minh (UTC+7): 09:00 local = 02:00Z.
const at = (hhmm: string) => new Date(`2027-03-01T${hhmm}:00+07:00`);
const DATE = new Date('2027-03-01T00:00:00.000Z');

test('Phase 3 Step 2 database foundation invariants (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 3 foundation rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          // Each rejected statement runs in its own savepoint so the fixture transaction survives.
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          let sequence = 0;
          const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
          const user = async (kind: 'CUSTOMER' | 'EMPLOYEE' | 'OWNER') => {
            sequence += 1;
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind,
                status: 'ACTIVE',
                fullName: `P3 fixture ${sequence}`,
                preferredLocale: 'vi',
                emailCanonical: `p3-${sequence}-${run.toLowerCase()}@example.com`,
                emailDelivery: `p3-${sequence}-${run.toLowerCase()}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical:
                  kind === 'OWNER' ? null : `+849${phoneBase}${String(sequence).padStart(3, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                ...(kind === 'CUSTOMER'
                  ? {
                      customerProfile: {
                        create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                      },
                    }
                  : {}),
                ...(kind === 'EMPLOYEE'
                  ? {
                      employeeProfile: {
                        create: {
                          employeeCodeCanonical: `P3_${run}_${sequence}`,
                          dateOfBirth: new Date('1990-01-01'),
                          address: 'Fixture',
                        },
                      },
                    }
                  : {}),
              },
              select: { id: true },
            });
            return id;
          };
          const branch = (
            await tx.branch.create({
              data: { code: `IT-P3-${run}`, name: 'P3 branch', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const category = (
            await tx.serviceCategory.create({
              data: { code: `IT_P3_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
              select: { id: true },
            })
          ).id;
          const service = (
            await tx.service.create({
              data: {
                code: `IT_P3_SVC_${run}`,
                categoryId: category,
                nameVi: 'Gội đầu',
                nameEn: 'Hair wash',
                priceVnd: 100_000n,
                priceMaxVnd: 150_000n,
                durationMinutes: 90,
                estimatedMinMinutes: 60,
                estimatedMaxMinutes: 90,
              },
              select: { id: true, code: true },
            })
          ).id;
          const customer = await user('CUSTOMER');
          const ktvA = await user('EMPLOYEE');
          const ktvB = await user('EMPLOYEE');
          const staff = await user('EMPLOYEE');

          let codeSeq = 0;
          const booking = (
            start: string,
            end: string,
            extra: Partial<Prisma.BookingUncheckedCreateInput> = {},
          ) =>
            tx.booking.create({
              data: {
                code: `BK-${run}-${++codeSeq}`,
                branchId: branch,
                ownerUserId: customer,
                channel: 'ONLINE',
                startsAt: at(start),
                endsAt: at(end),
                serviceDate: DATE,
                idempotencyKey: randomUUID(),
                createdByUserId: customer,
                ...extra,
              },
              select: { id: true, rowVersion: true },
            });
          const self = (bookingId: string) =>
            tx.bookingRecipient.create({
              data: { bookingId, relation: 'SELF' },
              select: { id: true },
            });
          const snapshot = {
            serviceCode: `IT_P3_SVC_${run}`,
            serviceNameVi: 'Gội đầu',
            serviceNameEn: 'Hair wash',
            catalogPriceMinVnd: 100_000n,
            catalogPriceMaxVnd: 150_000n,
            catalogPricingUnit: 'PER_SERVICE' as const,
          };
          const line = (
            bookingId: string,
            recipientId: string,
            seq: number,
            employeeUserId: string,
            start: string,
            minutes: number,
            bufferMinutes = 0,
          ) =>
            tx.bookingServiceLine.create({
              data: {
                bookingId,
                recipientId,
                sequence: seq,
                serviceId: service,
                employeeUserId,
                assignmentMode: 'ANY',
                plannedStartAt: at(start),
                plannedEndAt: new Date(at(start).getTime() + minutes * 60_000),
                durationMinutes: minutes,
                bufferMinutes,
                ...snapshot,
              },
              select: { id: true },
            });
          const occupancies = (employee: string) =>
            tx.$queryRaw<
              { n: bigint }[]
            >`SELECT count(*) AS n FROM ktv_occupancies WHERE employee_user_id = ${employee}::uuid`.then(
              (rows) => Number(rows[0]?.n ?? 0),
            );

          await context.test(
            'settings registry: approved keys and defaults, SQL-validated',
            async () => {
              const rows = await tx.appSetting.findMany({ select: { key: true, value: true } });
              const stored = new Map(rows.map((row) => [row.key, row.value]));
              for (const definition of BOOKING_SETTINGS) {
                assert.equal(stored.get(definition.key), definition.defaultValue, definition.key);
                assert.ok(isValidBookingSetting(definition.key, definition.defaultValue));
              }
              assert.deepEqual(
                Object.fromEntries(BOOKING_SETTINGS.map((d) => [d.key, d.defaultValue])),
                {
                  'booking.maxAdvanceDays': 60,
                  'booking.slotIntervalMinutes': 15,
                  'booking.lateHoldMinutes': 20,
                  'booking.lateCancelAlertMinutes': 15,
                  'service.warningLeadMinutes': 5,
                  'service.startOverdueMinutes': 5,
                  'service.endOverdueMinutes': 5,
                  'booking.checkInWindowMinutes': 60,
                  'booking.serviceBufferMinutes': 0,
                },
              );
              await rejects(
                () =>
                  tx.appSetting.update({
                    where: { key: 'booking.slotIntervalMinutes' },
                    data: { value: 7, rowVersion: { increment: 1 } },
                  }),
                /app_settings_known_values/,
              );
              await rejects(
                () => tx.appSetting.create({ data: { key: 'booking.unknown', value: 1 } }),
                /app_settings_known_values/,
              );
              await rejects(
                () => tx.appSetting.delete({ where: { key: 'booking.maxAdvanceDays' } }),
                /never deleted/,
              );
              await rejects(
                () =>
                  tx.appSetting.update({
                    where: { key: 'booking.maxAdvanceDays' },
                    data: { value: 30 },
                  }),
                /bumps the version/,
              );
              const changed = await tx.appSetting.update({
                where: { key: 'booking.serviceBufferMinutes' },
                data: { value: 10, rowVersion: { increment: 1 } },
              });
              assert.equal(changed.value, 10);
              assert.equal(isValidBookingSetting('booking.slotIntervalMinutes', 7), false);
            },
          );

          await context.test(
            'permission foundation: the seven codes, MANAGE_BOOKING_SETTINGS global-only',
            async () => {
              const labels = (
                await tx.$queryRaw<
                  { labels: string[] }[]
                >`SELECT enum_range(NULL::"PermissionCode")::text[] AS labels`
              )[0]?.labels;
              for (const code of PHASE3_CODES) {
                assert.ok(labels?.includes(code), code);
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
              }
              await syncPermissionCatalog(tx);
              const rows = await tx.permission.findMany({
                where: { code: { in: PHASE3_CODES as never[] } },
                select: { code: true, scopeCapability: true, dataClassification: true },
              });
              assert.equal(rows.length, 7);
              for (const row of rows) {
                assert.equal(
                  row.scopeCapability,
                  row.code === 'MANAGE_BOOKING_SETTINGS' ? 'GLOBAL_ONLY' : 'BRANCH_CAPABLE',
                );
                assert.equal(row.dataClassification, 'STANDARD');
              }
            },
          );

          await context.test(
            'bookings: CONFIRMED only, customer owner, idempotency, branch-local date',
            async () => {
              const first = await booking('09:00', '10:30');
              assert.equal(
                (await tx.booking.findUniqueOrThrow({ where: { id: first.id } })).status,
                'CONFIRMED',
              );
              const key = randomUUID();
              await booking('14:00', '15:00', { idempotencyKey: key });
              await rejects(
                () => booking('16:00', '17:00', { idempotencyKey: key }),
                /bookings_creator_idempotency_key|Unique constraint/,
              );
              await rejects(
                () => booking('09:00', '10:00', { status: 'CANCELLED' }),
                /starts CONFIRMED/,
              );
              await rejects(
                () => booking('09:00', '10:00', { ownerUserId: ktvA }),
                /owner is a customer/,
              );
              await rejects(
                () =>
                  booking('09:00', '10:00', { serviceDate: new Date('2027-03-02T00:00:00.000Z') }),
                /branch-local date/,
              );
              await rejects(() => booking('10:00', '09:00'), /bookings_time_order/);
              await rejects(
                () => booking('09:00', '10:00', { code: 'bad code' }),
                /bookings_code_format/,
              );
            },
          );

          await context.test(
            'lines: sequential multi-service accepted; recipients never accounts (O11)',
            async () => {
              const b = await booking('09:00', '12:00');
              const me = await self(b.id);
              // 09:00–10:30, 10:30–11:30, 11:30–12:00, one KTV (Q3), buffer 0.
              await line(b.id, me.id, 1, ktvA, '09:00', 90);
              await line(b.id, me.id, 2, ktvA, '10:30', 60);
              await line(b.id, me.id, 3, ktvA, '11:30', 30);
              assert.equal(await occupancies(ktvA), 3);
              const users = await tx.user.count();
              const family = await tx.bookingRecipient.create({
                data: { bookingId: b.id, relation: 'CHILD', displayName: 'Bé Na' },
                select: { id: true },
              });
              assert.equal(await tx.user.count(), users, 'no account created for a recipient');
              await line(b.id, family.id, 4, ktvB, '09:00', 60);
              await rejects(() => self(b.id), /booking_recipients_one_self_key|Unique constraint/);
              await rejects(
                () =>
                  tx.bookingRecipient.create({
                    data: { bookingId: b.id, relation: 'SELF', displayName: 'X' },
                  }),
                /booking_recipients_shape/,
              );
              await rejects(
                () => tx.bookingRecipient.create({ data: { bookingId: b.id, relation: 'FAMILY' } }),
                /booking_recipients_shape/,
              );
              // A line's end must equal start + duration.
              await rejects(
                () =>
                  tx.bookingServiceLine.create({
                    data: {
                      bookingId: b.id,
                      recipientId: me.id,
                      sequence: 9,
                      serviceId: service,
                      employeeUserId: ktvB,
                      assignmentMode: 'ANY',
                      plannedStartAt: at('13:00'),
                      plannedEndAt: at('13:45'),
                      durationMinutes: 30,
                      bufferMinutes: 0,
                      ...snapshot,
                    },
                  }),
                /booking_service_lines_shape/,
              );
              // Catalog snapshot is historical reference: fixed after insert.
              const first = await tx.bookingServiceLine.findFirstOrThrow({
                where: { bookingId: b.id, sequence: 1 },
              });
              await rejects(
                () =>
                  tx.bookingServiceLine.update({
                    where: { id: first.id },
                    data: { serviceNameVi: 'Khác', rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );
            },
          );

          await context.test(
            'overlap backstop (btree_gist): same KTV rejected across bookings; buffer counted',
            async () => {
              const other = await booking('11:00', '12:00');
              const r = await self(other.id);
              await rejects(
                () => line(other.id, r.id, 1, ktvA, '11:00', 60),
                /ktv_occupancies_no_overlap/,
              );
              // Another KTV at the same time is fine; adjacent (half-open) is fine.
              await line(other.id, r.id, 1, staff, '11:00', 60);
              const later = await booking('12:00', '13:00');
              const r2 = await self(later.id);
              await line(later.id, r2.id, 1, ktvA, '12:00', 60, 10); // occupies 12:00–13:10
              // O7: planned 12:00–13:00 + 10 min buffer keeps the KTV busy until 13:10, so a
              // service starting at the planned end (13:00) is rejected; 13:10 is allowed below.
              const atEnd = await booking('13:00', '13:30');
              const r0 = await self(atEnd.id);
              await rejects(
                () => line(atEnd.id, r0.id, 1, ktvA, '13:00', 30),
                /ktv_occupancies_no_overlap/,
              );
              const next = await booking('13:05', '13:35');
              const r3 = await self(next.id);
              await rejects(
                () => line(next.id, r3.id, 1, ktvA, '13:05', 30),
                /ktv_occupancies_no_overlap/,
              );
              const ok = await booking('13:10', '13:40');
              const r4 = await self(ok.id);
              await line(ok.id, r4.id, 1, ktvA, '13:10', 30);
              // Cancelling releases the interval; a cancelled booking never comes back.
              await tx.booking.update({
                where: { id: later.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: new Date(),
                  cancelledByUserId: customer,
                  cancelledLate: false,
                  rowVersion: { increment: 1 },
                },
              });
              const retry = await booking('12:00', '12:30');
              const r5 = await self(retry.id);
              await line(retry.id, r5.id, 1, ktvA, '12:00', 30);
              await rejects(
                () =>
                  tx.booking.update({
                    where: { id: later.id },
                    data: { status: 'CONFIRMED', rowVersion: { increment: 2 } },
                  }),
                /cannot be rewritten|bookings_status_facts/,
              );
              await rejects(() => line(later.id, r2.id, 2, ktvB, '15:00', 30), /confirmed booking/);
            },
          );

          await context.test(
            'check-in to visit: occupancy carried over; one visit per booking',
            async () => {
              const b = await booking('15:00', '16:00');
              const me = await self(b.id);
              const bl = await line(b.id, me.id, 1, ktvB, '15:00', 60);
              const visit = await tx.visit.create({
                data: {
                  code: `VS-${run}-1`,
                  branchId: branch,
                  origin: 'BOOKING',
                  bookingId: b.id,
                  ownerUserId: customer,
                  serviceDate: DATE,
                  arrivedAt: at('14:10'),
                  createdByUserId: staff,
                },
                select: { id: true },
              });
              const member = await tx.visitParticipant.create({
                data: {
                  visitId: visit.id,
                  kind: 'MEMBER',
                  customerUserId: customer,
                  bookingRecipientId: me.id,
                },
                select: { id: true },
              });
              const vl = await tx.visitServiceLine.create({
                data: {
                  visitId: visit.id,
                  participantId: member.id,
                  sequence: 1,
                  bookingServiceLineId: bl.id,
                  serviceId: service,
                  employeeUserId: ktvB,
                  assignmentMode: 'ANY',
                  plannedStartAt: at('15:00'),
                  plannedEndAt: at('16:00'),
                  durationMinutes: 60,
                  bufferMinutes: 0,
                  ...snapshot,
                },
                select: { id: true },
              });
              await tx.booking.update({
                where: { id: b.id },
                data: {
                  status: 'CHECKED_IN',
                  checkedInAt: at('14:10'),
                  checkedInByUserId: staff,
                  rowVersion: { increment: 1 },
                },
              });
              const occ = await tx.$queryRaw<{ v: string | null; b: string | null }[]>`
              SELECT visit_service_line_id::text AS v, booking_service_line_id::text AS b
              FROM ktv_occupancies WHERE visit_service_line_id = ${vl.id}::uuid OR booking_service_line_id = ${bl.id}::uuid`;
              assert.deepEqual(
                occ,
                [{ v: vl.id, b: null }],
                'the interval moved to the visit line',
              );
              await rejects(
                () =>
                  tx.visit.create({
                    data: {
                      code: `VS-${run}-2`,
                      branchId: branch,
                      origin: 'BOOKING',
                      bookingId: b.id,
                      ownerUserId: customer,
                      serviceDate: DATE,
                      arrivedAt: at('14:20'),
                      createdByUserId: staff,
                    },
                  }),
                /visits_booking_id_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.visit.create({
                    data: {
                      code: `VS-${run}-3`,
                      branchId: branch,
                      origin: 'WALK_IN',
                      bookingId: b.id,
                      serviceDate: DATE,
                      arrivedAt: at('14:20'),
                      createdByUserId: staff,
                    },
                  }),
                /visits_origin|booking visit keeps/,
              );
              // Execution: START, one open execution per KTV, no auto-END, resolution needs a reason.
              await tx.visitServiceLine.update({
                where: { id: vl.id },
                data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
              });
              await tx.visit.update({
                where: { id: visit.id },
                data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
              });
              const execution = await tx.serviceExecution.create({
                data: {
                  visitServiceLineId: vl.id,
                  employeeUserId: ktvB,
                  startedAt: at('15:02'),
                  expectedEndAt: at('16:02'),
                },
                select: { id: true },
              });
              await rejects(
                () =>
                  tx.serviceExecution.create({
                    data: {
                      visitServiceLineId: vl.id,
                      employeeUserId: ktvB,
                      startedAt: at('15:03'),
                      expectedEndAt: at('16:03'),
                    },
                  }),
                /service_executions_visit_service_line_id_key|service_executions_one_open_per_employee_key|Unique constraint/,
              );
              await rejects(
                () =>
                  tx.serviceExecution.update({
                    where: { id: execution.id },
                    data: {
                      status: 'ENDED',
                      endedAt: at('16:00'),
                      endKind: 'NORMAL',
                      rowVersion: { increment: 1 },
                    },
                  }),
                /service_executions_status_facts/,
              );
              await rejects(
                () =>
                  tx.serviceExecution.update({
                    where: { id: execution.id },
                    data: {
                      status: 'ENDED',
                      endedAt: at('16:00'),
                      endKind: 'MANAGER_RESOLVED',
                      endedByUserId: staff,
                      rowVersion: { increment: 1 },
                    },
                  }),
                /service_executions_status_facts/,
              );
              await tx.serviceExecution.update({
                where: { id: execution.id },
                data: { preEndWarnedAt: at('15:57'), rowVersion: { increment: 1 } },
              });
              await rejects(
                () =>
                  tx.serviceExecution.update({
                    where: { id: execution.id },
                    data: { preEndWarnedAt: at('15:58'), rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );
              await tx.serviceExecution.update({
                where: { id: execution.id },
                data: {
                  status: 'ENDED',
                  endedAt: at('16:00'),
                  endKind: 'NORMAL',
                  endedByUserId: ktvB,
                  rowVersion: { increment: 1 },
                },
              });
              await tx.visitServiceLine.update({
                where: { id: vl.id },
                data: { status: 'DONE', rowVersion: { increment: 1 } },
              });
              assert.equal(
                await tx.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*) AS n FROM ktv_occupancies WHERE visit_service_line_id = ${vl.id}::uuid`.then(
                  (r) => Number(r[0]?.n),
                ),
                0,
              );
              await rejects(
                () =>
                  tx.visitServiceLine.update({
                    where: { id: vl.id },
                    data: { status: 'PLANNED', rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );
              await rejects(
                () =>
                  tx.serviceExecution.update({
                    where: { id: execution.id },
                    data: { endedAt: at('16:05'), rowVersion: { increment: 1 } },
                  }),
                /cannot be rewritten/,
              );
            },
          );

          await context.test(
            'walk-in participants: guests and children without accounts; one service at a time',
            async () => {
              const visit = await tx.visit.create({
                data: {
                  code: `VS-${run}-9`,
                  branchId: branch,
                  origin: 'WALK_IN',
                  serviceDate: DATE,
                  arrivedAt: at('17:00'),
                  createdByUserId: staff,
                  idempotencyKey: randomUUID(),
                },
                select: { id: true },
              });
              const guest = await tx.visitParticipant.create({
                data: {
                  visitId: visit.id,
                  kind: 'GUEST',
                  displayName: 'Chị Lan',
                  phone: '0905000111',
                },
                select: { id: true },
              });
              await tx.visitParticipant.create({
                data: {
                  visitId: visit.id,
                  kind: 'CHILD',
                  displayName: 'Bé Bi',
                  guardianParticipantId: guest.id,
                },
              });
              await rejects(
                () => tx.visitParticipant.create({ data: { visitId: visit.id, kind: 'GUEST' } }),
                /visit_participants_shape/,
              );
              await rejects(
                () =>
                  tx.visitParticipant.create({
                    data: { visitId: visit.id, kind: 'CHILD', displayName: 'X' },
                  }),
                /visit_participants_shape/,
              );
              await rejects(
                () =>
                  tx.visitParticipant.create({
                    data: { visitId: visit.id, kind: 'MEMBER', customerUserId: ktvA },
                  }),
                /customer account/,
              );
              const vl = (seq: number, employee: string, start: string) =>
                tx.visitServiceLine.create({
                  data: {
                    visitId: visit.id,
                    participantId: guest.id,
                    sequence: seq,
                    serviceId: service,
                    employeeUserId: employee,
                    assignmentMode: 'SPECIFIC',
                    plannedStartAt: at(start),
                    plannedEndAt: new Date(at(start).getTime() + 30 * 60_000),
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    ...snapshot,
                  },
                  select: { id: true },
                });
              const one = await vl(1, ktvA, '17:00');
              const two = await vl(2, ktvB, '17:30');
              await tx.visitServiceLine.update({
                where: { id: one.id },
                data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
              });
              await rejects(
                () =>
                  tx.visitServiceLine.update({
                    where: { id: two.id },
                    data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
                  }),
                /visit_service_lines_one_in_progress_key|Unique constraint/,
              );
              // Walk-in lines join the same KTV overlap backstop.
              const b = await booking('17:10', '17:40');
              const r = await self(b.id);
              await rejects(
                () => line(b.id, r.id, 1, ktvA, '17:10', 30),
                /ktv_occupancies_no_overlap/,
              );
            },
          );

          await context.test(
            'history and catalog integrity: no deletes, append-only reassignment, RESTRICT',
            async () => {
              const b = await tx.booking.findFirstOrThrow({
                where: { branchId: branch },
                select: { id: true },
              });
              await rejects(() => tx.booking.delete({ where: { id: b.id } }), /never deleted/);
              const bl = await tx.bookingServiceLine.findFirstOrThrow({
                where: { employeeUserId: ktvA, booking: { status: 'CONFIRMED' } },
                select: { id: true },
              });
              const change = await tx.serviceLineAssignmentChange.create({
                data: {
                  bookingServiceLineId: bl.id,
                  fromEmployeeUserId: ktvA,
                  toEmployeeUserId: ktvB,
                  reason: 'MANAGER',
                  actorUserId: staff,
                },
                select: { id: true },
              });
              await rejects(
                () =>
                  tx.serviceLineAssignmentChange.update({
                    where: { id: change.id },
                    data: { note: 'x' },
                  }),
                /append-only/,
              );
              await rejects(
                () =>
                  tx.serviceLineAssignmentChange.create({
                    data: {
                      bookingServiceLineId: bl.id,
                      fromEmployeeUserId: ktvA,
                      toEmployeeUserId: ktvA,
                      reason: 'LEAVE',
                      actorUserId: staff,
                    },
                  }),
                /assignment_changes_shape/,
              );
              await rejects(
                () => tx.service.delete({ where: { id: service } }),
                /Foreign key|foreign key|violates|P2003/,
              );
            },
          );

          await context.test(
            'occupancy is derived only and always matches its source lines',
            async () => {
              // Never written directly.
              const any = await tx.$queryRaw<
                { id: string }[]
              >`SELECT id::text AS id FROM ktv_occupancies LIMIT 1`;
              const claim = any[0]?.id;
              assert.ok(claim);
              await rejects(
                () =>
                  tx.$executeRaw`INSERT INTO ktv_occupancies (employee_user_id, period, booking_service_line_id)
                    SELECT employee_user_id, tstzrange(now(), now() + interval '1 minute'), gen_random_uuid()
                    FROM ktv_occupancies LIMIT 1`,
                /never written directly/,
              );
              await rejects(
                () =>
                  tx.$executeRaw`UPDATE ktv_occupancies SET period = tstzrange(now(), now() + interval '1 minute') WHERE id = ${claim}::uuid`,
                /never written directly/,
              );
              await rejects(
                () => tx.$executeRaw`DELETE FROM ktv_occupancies WHERE id = ${claim}::uuid`,
                /never written directly/,
              );
              await rejects(
                () => tx.$executeRawUnsafe('TRUNCATE ktv_occupancies'),
                /cannot be removed or rewritten/,
              );
              await rejects(
                () => tx.$executeRawUnsafe('TRUNCATE booking_service_lines CASCADE'),
                /cannot be removed or rewritten/,
              );

              // Reassigning a planned booking line moves its claim with it.
              const b = await booking('19:00', '19:30');
              const me = await self(b.id);
              const bl = await line(b.id, me.id, 1, ktvA, '19:00', 30, 5);
              await tx.bookingServiceLine.update({
                where: { id: bl.id },
                data: { employeeUserId: ktvB, rowVersion: { increment: 1 } },
              });
              assert.deepEqual(
                await tx.$queryRaw`SELECT employee_user_id::text AS e FROM ktv_occupancies WHERE booking_service_line_id = ${bl.id}::uuid`,
                [{ e: ktvB }],
              );

              // A visit cannot close over a planned line, and a closed visit takes no new line.
              const visit = await tx.visit.create({
                data: {
                  code: `VS-${run}-20`,
                  branchId: branch,
                  origin: 'WALK_IN',
                  serviceDate: DATE,
                  arrivedAt: at('20:00'),
                  createdByUserId: staff,
                },
                select: { id: true },
              });
              const guest = await tx.visitParticipant.create({
                data: {
                  visitId: visit.id,
                  kind: 'GUEST',
                  displayName: 'Anh Minh',
                  phone: '0905000222',
                },
                select: { id: true },
              });
              const walkIn = (seq: number) =>
                tx.visitServiceLine.create({
                  data: {
                    visitId: visit.id,
                    participantId: guest.id,
                    sequence: seq,
                    serviceId: service,
                    employeeUserId: ktvA,
                    assignmentMode: 'ANY',
                    plannedStartAt: at('20:00'),
                    plannedEndAt: at('20:30'),
                    durationMinutes: 30,
                    bufferMinutes: 0,
                    ...snapshot,
                  },
                  select: { id: true },
                });
              const planned = await walkIn(1);
              const cancelVisit = () =>
                tx.visit.update({
                  where: { id: visit.id },
                  data: {
                    status: 'CANCELLED',
                    cancelledAt: at('20:05'),
                    cancelledByUserId: staff,
                    rowVersion: { increment: 1 },
                  },
                });
              await rejects(cancelVisit, /closes only after each of its lines/);
              await tx.visitServiceLine.update({
                where: { id: planned.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: at('20:04'),
                  cancelledByUserId: staff,
                  rowVersion: { increment: 1 },
                },
              });
              await cancelVisit();
              await rejects(() => walkIn(2), /open or in-service visit/);

              // Whole-table reconciliation: every claim, and only those, derived from its source.
              const drift = await tx.$queryRaw<{ n: bigint }[]>`
                WITH expected AS (
                  SELECT l.employee_user_id, tstzrange(l.planned_start_at, l.planned_end_at + make_interval(mins => l.buffer_minutes), '[)') AS period,
                         l.id AS booking_service_line_id, NULL::uuid AS visit_service_line_id
                  FROM booking_service_lines l JOIN bookings b ON b.id = l.booking_id
                  WHERE b.status = 'CONFIRMED'
                    AND NOT EXISTS (SELECT 1 FROM visit_service_lines v WHERE v.booking_service_line_id = l.id)
                  UNION ALL
                  SELECT v.employee_user_id, tstzrange(v.planned_start_at, v.planned_end_at + make_interval(mins => v.buffer_minutes), '[)'),
                         NULL::uuid, v.id
                  FROM visit_service_lines v WHERE v.status IN ('PLANNED', 'IN_PROGRESS')
                ),
                actual AS (
                  SELECT employee_user_id, period, booking_service_line_id, visit_service_line_id FROM ktv_occupancies
                )
                SELECT count(*) AS n FROM ((TABLE expected EXCEPT ALL TABLE actual) UNION ALL (TABLE actual EXCEPT ALL TABLE expected)) d`;
              assert.equal(Number(drift[0]?.n), 0);
            },
          );

          throw rollback;
        },
        { timeout: 120_000 },
      ),
      (error: unknown) => error === rollback,
    );
    assert.equal(await database.branch.count({ where: { code: `IT-P3-${run}` } }), 0);
  } finally {
    await database.$disconnect();
  }
});
