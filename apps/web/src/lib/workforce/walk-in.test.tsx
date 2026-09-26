import type { BranchSummary } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WalkInScreen } from '../../components/workforce/screens/walk-in';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { navigationFor } from './permissions';
import { ApiError } from './api';
import { boardErrorMessage } from './booking-board';
import {
  walkInCancelBody,
  waitReasonText,
  walkInBranches,
  walkInProblem,
  walkInRequest,
  type WalkInLine,
  type WalkInPerson,
} from './walk-in';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

const people: WalkInPerson[] = [
  { key: 'm', kind: 'MEMBER', customerUserId: 'member-1', displayName: 'Nguyễn Lan', phone: '' },
  { key: 'g', kind: 'GUEST', displayName: '  Chị Hoa ', phone: ' 0905 000 111 ' },
  { key: 'c', kind: 'CHILD', displayName: 'Bé Bin', phone: '', guardianKey: 'g' },
];
const lines: WalkInLine[] = [
  { key: 'l1', participantKey: 'm', serviceId: 's1', staff: 'ANY' },
  { key: 'l2', participantKey: 'g', serviceId: 's1', staff: 'ktv-2' },
  { key: 'l3', participantKey: 'c', serviceId: 's2', staff: 'ANY' },
  { key: 'l4', participantKey: 'c', serviceId: '', staff: 'ANY' },
];

test('walk-in nav and branches follow MANAGE_BOOKINGS per branch; never role names', () => {
  const desk = employee([['MANAGE_BOOKINGS', 'A']]);
  assert.ok(navigationFor(desk).some((item) => item.key === 'walkIn'));
  assert.ok(
    !navigationFor(employee([['VIEW_BOOKINGS', 'A']])).some((item) => item.key === 'walkIn'),
  );
  const branches = new Map([
    ['A', { id: 'A', name: 'Quận 1', isActive: true } as unknown as BranchSummary],
    ['B', { id: 'B', name: 'Quận 3', isActive: true } as unknown as BranchSummary],
  ]);
  assert.deepEqual(
    walkInBranches(desk, branches).map((branch) => branch.id),
    ['A'],
  );
  assert.deepEqual(
    walkInBranches(owner, branches).map((branch) => branch.id),
    ['A', 'B'],
  );
});

test('request: members by account id only, guests/children by name, no server-owned facts', () => {
  const body = walkInRequest(people, lines, 'key-1');
  assert.deepEqual(body.participants, [
    { key: 'm', kind: 'MEMBER', customerUserId: 'member-1' },
    { key: 'g', kind: 'GUEST', displayName: 'Chị Hoa', phone: '0905 000 111' },
    { key: 'c', kind: 'CHILD', displayName: 'Bé Bin', guardianKey: 'g' },
  ]);
  assert.deepEqual(body.lines, [
    { participantKey: 'm', serviceId: 's1', requestedEmployeeUserId: null },
    { participantKey: 'g', serviceId: 's1', requestedEmployeeUserId: 'ktv-2' },
    { participantKey: 'c', serviceId: 's2', requestedEmployeeUserId: null },
  ]);
  const json = JSON.stringify(body);
  for (const field of [
    'arrivedAt',
    'plannedStartAt',
    'employeeUserId',
    'password',
    'email',
    'ownerUserId',
  ]) {
    assert.ok(!json.includes(`"${field}"`), field);
  }
});

test('draft problems: people and service, names, a child needs an adult', () => {
  assert.equal(walkInProblem([], []), 'people');
  assert.equal(walkInProblem(people, lines), null);
  assert.equal(
    walkInProblem(
      people.map((p) => (p.key === 'g' ? { ...p, displayName: ' ' } : p)),
      lines,
    ),
    'name',
  );
  assert.equal(
    walkInProblem(
      [{ key: 'c', kind: 'CHILD', displayName: 'Bé', phone: '', guardianKey: '' }],
      [lines[2]!],
    ),
    'guardian',
  );
});

test('waiting reasons are localized; first paint loads from the server', () => {
  assert.equal(
    waitReasonText('REQUESTED_KTV_UNAVAILABLE', vi),
    vi.walkIn.waitReasons.REQUESTED_KTV_UNAVAILABLE,
  );
  assert.notEqual(waitReasonText('NO_CAPACITY', en), waitReasonText('NO_CAPACITY', vi));
  assert.equal(waitReasonText(null, en), en.walkIn.waitReasons.NO_CAPACITY);
  const html = render(<WalkInScreen />, employee([['MANAGE_BOOKINGS', 'A']]));
  assert.ok(html.includes(vi.common.loading));
});

test('cancel waiting walk-in: reason required, localized texts and errors, never "no-show"', () => {
  assert.equal(walkInCancelBody('   '), null);
  assert.equal(walkInCancelBody('x'.repeat(501)), null);
  assert.deepEqual(walkInCancelBody('  Khách về  '), { reason: 'Khách về' });
  assert.notEqual(vi.bookingBoard.cancelWalkIn, en.bookingBoard.cancelWalkIn);
  assert.ok(
    !/không đến/i.test(vi.bookingBoard.cancelWalkIn) &&
      !/no-show/i.test(en.bookingBoard.cancelWalkIn),
  );
  const error = new ApiError(409, 'WALKIN_CANCEL_NOT_ALLOWED');
  assert.equal(boardErrorMessage(error, vi), vi.bookingBoard.errors.WALKIN_CANCEL_NOT_ALLOWED);
  assert.equal(boardErrorMessage(error, en), en.bookingBoard.errors.WALKIN_CANCEL_NOT_ALLOWED);
  assert.ok(!boardErrorMessage(error, en).includes('WALKIN'));
});
