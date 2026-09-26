import type { BranchSummary, OperationalBooking } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookingBoardScreen } from '../../components/workforce/screens/booking-board';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import { boardBranches, boardErrorMessage, matchesSearch, stateTone } from './booking-board';
import { navigationFor } from './permissions';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

const branch = (id: string, name: string, isActive = true) =>
  ({ id, name, isActive }) as unknown as BranchSummary;

const booking: OperationalBooking = {
  id: 'b1',
  code: 'BK-270301-ABCDEF',
  startsAt: '2027-03-01T03:00:00.000Z',
  endsAt: '2027-03-01T03:30:00.000Z',
  state: 'LATE_HOLD',
  arrivalOpensAt: '2027-03-01T02:00:00.000Z',
  holdUntil: '2027-03-01T03:20:00.000Z',
  owner: { displayName: 'Nguyễn Lan', phoneMasked: '•••••••456' },
  recipients: [
    { relation: 'SELF', displayName: null },
    { relation: 'CHILD', displayName: 'Bé Na' },
  ],
  lines: [],
  visit: null,
  actions: { arrive: true, noShow: false, advance: false },
};

test('board nav and branches follow VIEW_BOOKINGS, per branch; never role names', () => {
  const viewer = employee([['VIEW_BOOKINGS', 'A']]);
  assert.ok(navigationFor(viewer).some((item) => item.key === 'bookingBoard'));
  assert.ok(!navigationFor(employee()).some((item) => item.key === 'bookingBoard'));
  assert.ok(navigationFor(owner).some((item) => item.key === 'bookingBoard'));
  const branches = new Map([
    ['A', branch('A', 'Quận 1')],
    ['B', branch('B', 'Quận 3')],
    ['C', branch('C', 'Đóng', false)],
  ]);
  assert.deepEqual(
    boardBranches(viewer, branches).map((entry) => entry.id),
    ['A'],
  );
  assert.deepEqual(
    boardBranches(owner, branches).map((entry) => entry.id),
    ['A', 'B'],
  );
});

test('search: code, booker, recipient, last phone digits', () => {
  assert.ok(matchesSearch(booking, 'abcdef'));
  assert.ok(matchesSearch(booking, 'lan'));
  assert.ok(matchesSearch(booking, 'bé na'));
  assert.ok(matchesSearch(booking, '456'));
  assert.ok(!matchesSearch(booking, '999'));
  assert.ok(matchesSearch(booking, '  '));
});

test('operational errors are localized, never raw codes; states have tones', () => {
  for (const code of Object.keys(vi.bookingBoard.errors)) {
    const text = boardErrorMessage(new ApiError(409, code), vi);
    assert.ok(text.length > 0 && !text.includes(code), code);
    assert.notEqual(boardErrorMessage(new ApiError(409, code), en), text);
  }
  assert.equal(boardErrorMessage(new ApiError(403, 'FORBIDDEN'), vi), vi.errors.forbidden);
  assert.equal(stateTone('LATE_HOLD'), 'warning');
  assert.equal(stateTone('NO_SHOW'), 'error');
  assert.equal(Object.keys(vi.bookingBoard.states).length, 9);
});

test('board first paint loads from the server (no client-side timing rules)', () => {
  const html = render(<BookingBoardScreen />, employee([['VIEW_BOOKINGS', 'A']]));
  assert.ok(html.includes(vi.common.loading));
});
