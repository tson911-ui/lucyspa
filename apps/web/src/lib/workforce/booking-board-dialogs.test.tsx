import type {
  OperationalActiveVisit,
  OperationalActiveVisitLine,
  OperationalBooking,
  OperationalWaitingEntry,
  ReassignmentLine,
  ReplacementOptionsResponse,
  WalkInOptionsResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AddServiceDialog } from '../../components/workforce/screens/add-service';
import {
  BoardConfirm,
  IntentDialog,
  ResolveEndDialog,
} from '../../components/workforce/screens/booking-board-dialogs';
import {
  activeRows,
  BookingsSection,
} from '../../components/workforce/screens/booking-board-sections';
import { ReassignmentDialog } from '../../components/workforce/screens/reassignment-dialog';
import { MemberLookupDialog } from '../../components/workforce/screens/walk-in-lookup';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, render } from '../../test/support';

const en = getWorkforceDictionary('en');
const vi = getWorkforceDictionary('vi');
const noop = () => undefined;
const staff = employee([['VIEW_BOOKINGS', 'A']]);

const booking = {
  id: 'b1',
  code: 'BK-1',
  owner: { displayName: 'Lan', phoneMasked: null },
} as unknown as OperationalBooking;

const line = (overrides: Partial<OperationalActiveVisitLine> = {}) =>
  ({
    id: 'l1',
    serviceNameVi: 'Massage',
    serviceNameEn: 'Massage',
    participantName: null,
    employee: { id: 'e1', displayName: 'Hoa' },
    status: 'IN_PROGRESS',
    execution: {
      startedAt: '2027-03-01T03:00:00.000Z',
      expectedEndAt: '2027-03-01T04:00:00.000Z',
      overdue: true,
    },
    actions: { resolve: true, cancel: false },
    ...overrides,
  }) as unknown as OperationalActiveVisitLine;

const visit = (lines: OperationalActiveVisitLine[]) =>
  ({
    id: 'v1',
    code: 'V-1',
    participants: [{ id: 'p1', name: null }],
    lines,
    actions: { addService: true },
  }) as unknown as OperationalActiveVisit;

test('arrival is a plain confirmation without a reason; no-show and cancelling are danger with a required reason', () => {
  const run = () => Promise.resolve();
  const props = { serviceName: () => 'Massage', onRun: run, onClose: noop };
  const arrive = render(
    <BoardConfirm command={{ kind: 'arrive', booking }} {...props} />,
    staff,
    'en',
  );
  assert.ok(arrive.includes('role="alertdialog"'));
  assert.ok(arrive.includes('BK-1'));
  assert.ok(!arrive.includes(en.bookingBoard.reasonLabel), 'arrival records no reason');
  assert.ok(!arrive.includes('ls-btn-danger'));
  for (const command of [
    { kind: 'noShow', booking } as const,
    { kind: 'cancelWalkIn', visitId: 'v1', code: 'V-1' } as const,
    { kind: 'cancelLine', visit: visit([line()]), line: line() } as const,
  ]) {
    const html = render(<BoardConfirm command={command} {...props} />, staff, 'en');
    assert.ok(html.includes(en.bookingBoard.reasonLabel), command.kind);
    assert.ok(
      html.includes('ls-btn-danger'),
      `${command.kind} confirms in the one solid red place`,
    );
    assert.ok(html.indexOf(en.common.cancel) < html.indexOf('ls-btn-danger'), 'primary last');
    assert.ok(!html.includes('wf-'));
  }
  const advance = render(
    <BoardConfirm command={{ kind: 'advance', visitId: 'v1', code: 'V-1' }} {...props} />,
    staff,
    'en',
  );
  assert.ok(advance.includes(en.bookingBoard.reasonLabel));
  assert.ok(!advance.includes('ls-btn-danger'), 'priority is not destructive');
});

test('check-in is a button on the row only when the API offers it; the other decisions stay in the menu', () => {
  const row = (code: string, actions: { arrive: boolean; noShow: boolean; advance: boolean }) =>
    ({
      ...booking,
      id: code,
      code,
      startsAt: '2027-03-01T03:00:00.000Z',
      endsAt: '2027-03-01T03:30:00.000Z',
      state: 'ARRIVAL_WINDOW_OPEN',
      arrivalOpensAt: '2027-03-01T02:00:00.000Z',
      holdUntil: '2027-03-01T03:20:00.000Z',
      lines: [],
      visit: null,
      actions,
    }) as unknown as OperationalBooking;
  const html = render(
    <BookingsSection
      loading={false}
      empty={null}
      time={(iso) => iso.slice(11, 16)}
      onCommand={noop}
      bookings={[
        row('BK-OPEN', { arrive: true, noShow: false, advance: false }),
        row('BK-LATE', { arrive: false, noShow: true, advance: false }),
      ]}
    />,
    staff,
    'en',
  );
  assert.equal(html.match(new RegExp(`>${en.bookingBoard.arriveShort}<`, 'g'))?.length, 1);
  assert.ok(html.includes(`aria-label="${en.bookingBoard.arrive}: BK-OPEN"`));
  assert.ok(!html.includes(`${en.bookingBoard.arrive}: BK-LATE`));
  assert.ok(html.includes('Actions for BK-LATE'), 'the menu stays for no-show');
});

test('forgotten END: the expected time is offered only after it passed; minutes only when chosen', () => {
  const base = {
    visit: visit([line()]),
    line: line(),
    serviceName: 'Massage',
    time: (iso: string) => iso.slice(11, 16),
    working: false,
    error: null,
    onResolve: () => Promise.resolve(true),
    onClose: noop,
  };
  const passed = render(<ResolveEndDialog {...base} now="2027-03-01T05:00:00.000Z" />, staff, 'en');
  assert.ok(passed.includes(en.bookingBoard.resolveModeNow));
  assert.ok(passed.includes('04:00'), 'expected time offered once passed');
  assert.ok(passed.includes(en.bookingBoard.resolveModeMinutes));
  assert.ok(passed.includes(en.bookingBoard.reasonLabel));
  assert.ok(!passed.includes('inputMode="numeric"') && !passed.includes('inputmode="numeric"'));
  const early = render(<ResolveEndDialog {...base} now="2027-03-01T03:30:00.000Z" />, staff, 'en');
  assert.ok(!early.includes('04:00'), 'not offered before the expected end');
  assert.ok(!early.includes('wf-'));
});

test('changing a waiting walk-in request: one select per service, nothing to save until one changes', () => {
  const entry = {
    visitId: 'v1',
    visitCode: 'V-1',
    participantId: 'p1',
    participantName: 'Mai',
    lines: [
      {
        id: 'l1',
        serviceId: 's1',
        serviceNameVi: 'Gội đầu',
        serviceNameEn: 'Hair wash',
        durationMinutes: 30,
        requestedEmployee: null,
      },
      {
        id: 'l2',
        serviceId: 's1',
        serviceNameVi: 'Massage',
        serviceNameEn: 'Massage',
        durationMinutes: 60,
        requestedEmployee: { id: 'e1', displayName: 'Hoa' },
      },
    ],
  } as unknown as OperationalWaitingEntry;
  const options = {
    services: [
      {
        id: 's1',
        employees: [
          { id: 'e1', displayName: 'Hoa', checkedIn: true },
          { id: 'e2', displayName: 'Thu', checkedIn: false },
        ],
      },
    ],
  } as unknown as WalkInOptionsResponse;
  const html = render(
    <IntentDialog
      entry={entry}
      options={options}
      working={false}
      error={null}
      onSave={() => Promise.resolve(true)}
      onClose={noop}
    />,
    staff,
    'en',
  );
  assert.equal(html.match(/<select/g)?.length, 2);
  assert.ok(html.includes('Hair wash · 30′') && html.includes('Massage · 60′'));
  assert.ok(html.includes(`Thu ${en.walkIn.notCheckedIn}`));
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
});

test('open visits are listed as service lines; a visit without lines keeps one row for its actions', () => {
  const rows = activeRows([
    visit([line({ id: 'a' }), line({ id: 'b' })]),
    { ...visit([]), id: 'v2' } as OperationalActiveVisit,
  ]);
  assert.deepEqual(
    rows.map((row) => [row.key, row.line?.id ?? null]),
    [
      ['v1:a', 'a'],
      ['v1:b', 'b'],
      ['v2:none', null],
    ],
  );
});

test('member lookup: exact phone or email only, one primary button', () => {
  const html = render(
    <MemberLookupDialog branchId="A" taken={new Set()} onAdd={noop} onClose={noop} />,
    staff,
    'en',
  );
  assert.ok(html.includes(en.walkIn.lookupHint));
  assert.ok(html.includes(en.walkIn.phone) && html.includes(en.walkIn.email));
  assert.ok(html.includes(en.walkIn.search));
  assert.ok(!html.includes(en.walkIn.addMember), 'adding appears only after a member is found');
  assert.ok(html.indexOf(en.common.cancel) < html.lastIndexOf(en.walkIn.search), 'primary last');
});

test('add service dialog: loads the catalog allowed for the visit before showing choices', () => {
  const html = render(
    <AddServiceDialog
      visitId="v1"
      visitCode="V-1"
      participants={[{ id: 'p1', name: null }]}
      onClose={noop}
      onAdded={noop}
    />,
    staff,
    'vi',
  );
  assert.ok(html.includes(vi.common.loading));
  assert.ok(html.includes('V-1'));
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
});

const target = {
  kind: 'ASSIGNMENT',
  id: 'l1',
  parentCode: 'BK-9',
  participantName: null,
  service: { nameVi: 'Massage', nameEn: 'Massage' },
} as unknown as ReassignmentLine;

const options = (overrides: Partial<ReplacementOptionsResponse> = {}) =>
  ({
    scope: 'PARTICIPANT',
    lines: [
      {
        id: 'l1',
        version: 2,
        leaveConflict: true,
        plannedStartAt: '2027-03-01T03:00:00.000Z',
        employee: { displayName: 'Hoa' },
        assignmentMode: 'ANY',
        service: { nameVi: 'Massage', nameEn: 'Massage' },
      },
    ],
    candidates: [{ id: 'c1', displayName: 'Thu', preferred: true }],
    requiresSpecificAcknowledgement: false,
    ...overrides,
  }) as unknown as ReplacementOptionsResponse;

test('reassignment dialog: scope, affected services, candidates, reason; confirm waits for a valid choice', () => {
  const props = {
    anchor: target,
    scope: 'PARTICIPANT' as const,
    loading: false,
    replacement: '',
    reason: '',
    acknowledged: false,
    saving: false,
    error: null,
    serviceName: () => 'Massage',
    timestamp: (iso: string) => iso.slice(11, 16),
    onScope: noop,
    onReplacement: noop,
    onReason: noop,
    onAcknowledged: noop,
    onSubmit: () => Promise.resolve(),
    onClose: noop,
  };
  const html = render(<ReassignmentDialog {...props} options={options()} />, staff, 'en');
  assert.ok(html.includes('BK-9 · Massage'));
  assert.ok(html.includes(en.reassignment.affected) && html.includes('03:00'));
  assert.ok(html.includes(`Thu · ${en.reassignment.preferred}`));
  assert.ok(html.includes(en.reassignment.reasonHint));
  assert.ok(!html.includes(en.reassignment.acknowledge), 'only for a specific-KTV request');
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
  const specific = render(
    <ReassignmentDialog
      {...props}
      options={options({ requiresSpecificAcknowledgement: true, candidates: [] })}
    />,
    staff,
    'en',
  );
  assert.ok(specific.includes(en.reassignment.acknowledge));
  assert.ok(specific.includes(en.reassignment.none));
  const ready = render(
    <ReassignmentDialog
      {...props}
      options={options()}
      replacement="c1"
      reason="Staff on leave that day"
    />,
    staff,
    'en',
  );
  assert.doesNotMatch(ready, /<button[^>]*type="submit"[^>]*disabled/);
  assert.ok(!ready.includes('wf-'));
});
