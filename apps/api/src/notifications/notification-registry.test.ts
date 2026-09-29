import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedNotificationEntity,
  isNotificationType,
  NOTIFICATION_TYPES,
  notificationMetadata,
  notificationTarget,
  notificationTypesInCategory,
  parseNotificationParams,
} from '@lucy-spa/contracts';

const PHASE3 = [
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'LATE_CANCELLATION',
  'BOOKING_NO_SHOW',
  'CUSTOMER_ARRIVED',
  'BOOKING_KTV_CONFLICT',
  'KTV_REASSIGNED',
  'START_OVERDUE',
  'PRE_END',
  'END_OVERDUE',
];

test('the registry keeps every Phase 3 type unchanged and adds only the two Leave types', () => {
  assert.deepEqual(
    [...NOTIFICATION_TYPES].sort(),
    [...PHASE3, 'LEAVE_REQUESTED', 'LEAVE_DECIDED'].sort(),
  );
  for (const type of PHASE3) {
    assert.ok(isNotificationType(type));
    const meta = notificationMetadata(type as never);
    assert.equal(meta.category, 'OPERATIONS');
    assert.equal(meta.params, 'NONE');
    // Phase 3 rows may reference a Booking or a Visit, exactly as the worker writes them.
    assert.ok(isAllowedNotificationEntity(type as never, 'Booking'));
    assert.ok(isAllowedNotificationEntity(type as never, 'Visit'));
    assert.ok(!isAllowedNotificationEntity(type as never, 'LeaveRequest'));
  }
  for (const type of ['LEAVE_REQUESTED', 'LEAVE_DECIDED'] as const) {
    assert.equal(notificationMetadata(type).category, 'HR');
    assert.deepEqual(notificationMetadata(type).entityTypes, ['LeaveRequest']);
    assert.ok(!isAllowedNotificationEntity(type, 'Booking'));
  }
  assert.ok(!isNotificationType('NOT_A_TYPE'));
  assert.ok(!isNotificationType('toString'));
});

test('category filters are derived from the registry, and targets from the entity', () => {
  assert.deepEqual([...notificationTypesInCategory('HR')].sort(), [
    'LEAVE_DECIDED',
    'LEAVE_REQUESTED',
  ]);
  assert.equal(notificationTypesInCategory('OPERATIONS').length, PHASE3.length);
  assert.equal(notificationTarget('Booking'), 'BOOKING');
  assert.equal(notificationTarget('Visit'), 'VISIT');
  assert.equal(notificationTarget('LeaveRequest'), 'LEAVE_REQUEST');
  for (const type of NOTIFICATION_TYPES) assert.equal(notificationMetadata(type).i18nKey, type);
});

const subject = '11111111-1111-4111-8111-111111111111';

test('params are a strict allowlist of ids, dates and enums; never free text', () => {
  assert.deepEqual(
    parseNotificationParams('LEAVE_REQUESTED', {
      subjectUserId: subject.toUpperCase(),
      startDate: '2026-10-05',
      endDate: '2026-10-07',
      leaveType: 'ANNUAL',
    }),
    { subjectUserId: subject, startDate: '2026-10-05', endDate: '2026-10-07', leaveType: 'ANNUAL' },
  );
  assert.deepEqual(
    parseNotificationParams('LEAVE_DECIDED', {
      decision: 'REJECTED',
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      leaveType: 'SICK',
    }),
    { decision: 'REJECTED', startDate: '2026-10-05', endDate: '2026-10-05', leaveType: 'SICK' },
  );
  assert.equal(parseNotificationParams('BOOKING_CREATED', null), null);
  const bad = (type: never, value: unknown) =>
    assert.throws(() => parseNotificationParams(type, value));
  bad('BOOKING_CREATED' as never, { anything: 1 });
  bad('LEAVE_DECIDED' as never, null);
  bad('LEAVE_DECIDED' as never, [] as unknown);
  // Extra keys (a reason, a name) and missing keys are refused.
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
    reason: 'sick child',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'MAYBE',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-07',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-13-05',
    endDate: '2026-13-06',
    leaveType: 'ANNUAL',
  });
  bad('LEAVE_DECIDED' as never, {
    decision: 'APPROVED',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'HOLIDAY',
  });
  bad('LEAVE_REQUESTED' as never, {
    subjectUserId: 'Nguyen Van A',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    leaveType: 'ANNUAL',
  });
});
