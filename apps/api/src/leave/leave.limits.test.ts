import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEAVE_LIMITS } from './leave.service.js';

// Production regression: the default read window (today - defaultPastDays through
// today + defaultFutureDays, inclusive) must never exceed the maximum the API enforces,
// or every list request without from/to is rejected with VALIDATION_FAILED "from".
test('the default leave read window fits within the read maximum', () => {
  const defaultWindowDays = LEAVE_LIMITS.defaultPastDays + LEAVE_LIMITS.defaultFutureDays + 1;
  assert.ok(
    defaultWindowDays <= LEAVE_LIMITS.maxRangeDays,
    `${defaultWindowDays} > ${LEAVE_LIMITS.maxRangeDays}`,
  );
  assert.equal(LEAVE_LIMITS.defaultPastDays, 93, 'three months of history stay visible');
  assert.equal(LEAVE_LIMITS.maxRangeDays, 400, 'explicit range validation is unchanged');
});
