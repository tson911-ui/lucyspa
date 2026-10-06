import type { BranchSummary, ServiceExecutionWork } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MyServicesScreen } from '../../components/workforce/screens/my-services';
import { fill, getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import { navigationFor } from './permissions';
import {
  executionActionAllowed,
  executionBranches,
  executionErrorMessage,
} from './service-execution';

test('own-work navigation uses PERFORM_SERVICES, never booking/reassignment permissions or Owner impersonation', () => {
  const ktv = employee([['PERFORM_SERVICES', 'A']]);
  assert.ok(navigationFor(ktv).some((item) => item.key === 'myServices'));
  for (const account of [
    owner,
    employee([['MANAGE_BOOKINGS', 'A']]),
    employee([['REASSIGN_SERVICES', 'A']]),
  ]) {
    assert.ok(!navigationFor(account).some((item) => item.key === 'myServices'));
  }
  const branches = new Map(['A', 'B'].map((id) => [id, { id, name: id } as BranchSummary]));
  assert.deepEqual(
    executionBranches(ktv, branches).map((b) => b.id),
    ['A'],
  );
  assert.deepEqual(
    executionBranches(employee([['PERFORM_SERVICES', 'A']], [['PERFORM_SERVICES', 'A']]), branches),
    [],
  );
});

test('invalid states remain disabled even if stale server hints would offer an action', () => {
  for (const status of ['WAITING', 'DONE', 'CANCELLED'] as const) {
    const line = {
      status,
      execution: null,
      actions: { start: true, end: true },
    } as ServiceExecutionWork;
    assert.equal(executionActionAllowed(line, 'start'), false);
    assert.equal(executionActionAllowed(line, 'end'), false);
  }
  const planned = {
    status: 'PLANNED',
    execution: null,
    actions: { start: false },
  } as ServiceExecutionWork;
  assert.equal(executionActionAllowed(planned, 'start'), false);
  planned.actions.start = true;
  assert.equal(executionActionAllowed(planned, 'start'), true);
});

test('execution outcomes are localized in VI/EN without exposing raw domain codes', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getWorkforceDictionary(locale);
    for (const code of Object.keys(t.execution.errors)) {
      const error = new ApiError(409, code, 'unsafe raw text', null);
      const message = executionErrorMessage(error, t);
      assert.ok(message.length > 10);
      assert.ok(!message.includes(code));
      assert.ok(!message.includes('unsafe raw text'));
    }
    assert.ok(render(<MyServicesScreen />, employee(), locale).includes(t.execution.title));
  }
});

test('early START: the label and the block reasons exist in VI/EN, are plain, and the old "not ready" code is gone', () => {
  const vi = getWorkforceDictionary('vi');
  const en = getWorkforceDictionary('en');
  for (const [dictionary, word] of [
    [vi, 'sớm'],
    [en, 'early'],
  ] as const) {
    for (const label of [dictionary.execution.startedEarly, dictionary.bookingBoard.startedEarly]) {
      const text = fill(label, { minutes: 15 });
      assert.ok(text.includes('15') && text.includes(word), text);
    }
    const errors: Record<string, string> = dictionary.execution.errors;
    for (const code of ['SERVICE_EARLY_START_CONFLICT', 'SERVICE_EARLY_START_OUTSIDE_SHIFT']) {
      assert.ok((errors[code] ?? '').length > 20, code);
    }
    assert.equal(errors['SERVICE_NOT_READY'], undefined);
  }
  assert.ok(!JSON.stringify(vi.execution).toLowerCase().includes('khám'));
  assert.equal(fill(vi.execution.startedEarly, { minutes: 15 }), 'Bắt đầu sớm 15 phút');
});
