import type { BranchSummary, ReplacementOptionsResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReassignmentScreen } from '../../components/workforce/screens/reassignment';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import { navigationFor } from './permissions';
import { reassignmentBody, reassignmentBranches, reassignmentError } from './reassignment';

test('reassignment navigation and branch filtering use REASSIGN_SERVICES rather than initial-assignment permission', () => {
  const allowed = employee([['REASSIGN_SERVICES', 'A']]);
  assert.ok(navigationFor(allowed).some((item) => item.key === 'reassignment'));
  assert.ok(
    !navigationFor(employee([['MANAGE_BOOKINGS', 'A']])).some(
      (item) => item.key === 'reassignment',
    ),
  );
  assert.ok(navigationFor(owner).some((item) => item.key === 'reassignment'));
  const branches = new Map(
    ['A', 'B'].map((id) => [id, { id, name: id, isActive: true } as BranchSummary]),
  );
  assert.deepEqual(
    reassignmentBranches(allowed, branches).map((branch) => branch.id),
    ['A'],
  );
  assert.deepEqual(
    reassignmentBranches(
      employee([['REASSIGN_SERVICES', 'A']], [['REASSIGN_SERVICES', 'A']]),
      branches,
    ),
    [],
  );
});

const options = {
  scope: 'PARTICIPANT',
  lines: [
    { id: 'line-a', version: 3, leaveConflict: true },
    { id: 'line-b', version: 4, leaveConflict: false },
  ],
  candidates: [{ id: 'replacement', displayName: 'KTV', preferred: true }],
  suggestedAssignments: [],
  requiresSpecificAcknowledgement: true,
} as unknown as ReplacementOptionsResponse;

test('confirmation sends exact displayed versions; SPECIFIC intent requires acknowledgement and a reason', () => {
  assert.equal(reassignmentBody(options, 'replacement', 'Approved leave', false), null);
  assert.equal(reassignmentBody(options, 'unlisted', 'Approved leave', true), null);
  assert.equal(reassignmentBody(options, 'replacement', '  ', true), null);
  const body = reassignmentBody(options, 'replacement', ' Approved leave ', true)!;
  assert.deepEqual(body.targets, [
    { id: 'line-a', expectedVersion: 3 },
    { id: 'line-b', expectedVersion: 4 },
  ]);
  assert.equal(body.context, 'LEAVE');
  assert.equal(body.reason, 'Approved leave');
  assert.ok(!('assignmentMode' in body));
  assert.ok(!('plannedStartAt' in body));
  assert.ok(!('occurredAt' in body));
});

test('VI/EN render and map safe reassignment outcomes without exposing codes', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getWorkforceDictionary(locale);
    assert.ok(
      render(<ReassignmentScreen />, employee(), locale).includes(
        t.reassignment.title.replaceAll('&', '&amp;'),
      ),
    );
    for (const code of Object.keys(t.reassignment.errors)) {
      const message = reassignmentError(new ApiError(409, code), t);
      assert.ok(message.length > 10);
      assert.ok(!message.includes(code));
    }
  }
});
