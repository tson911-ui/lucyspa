import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasQualifyingPhoto, windowEndsAt, windowStatus } from './return.rules.js';

/**
 * Phase 6 P6-12 (T23, OQ-22, OQ-40): the return windows are measured in elapsed hours from hand-over, the end is inclusive, a skin
 * irritation has no window, and a wrong or damaged product needs a photo taken inside its 48 hours.
 */
const HOUR = 3_600_000;
const handover = new Date('2026-10-01T03:00:00.000Z');
const at = (hours: number, extraMs = 0) => new Date(handover.getTime() + hours * HOUR + extraMs);

test('a personal preference has 168 elapsed hours, a wrong or damaged product 48', () => {
  assert.equal(windowEndsAt('PERSONAL_PREFERENCE', handover)?.getTime(), at(168).getTime());
  assert.equal(windowEndsAt('WRONG_OR_DAMAGED', handover)?.getTime(), at(48).getTime());
  assert.equal(windowEndsAt('SKIN_IRRITATION', handover), null);
});

test('the end of the window is inclusive and one millisecond later it is over', () => {
  assert.equal(windowStatus('WRONG_OR_DAMAGED', handover, at(0)).open, true);
  assert.equal(windowStatus('WRONG_OR_DAMAGED', handover, at(47, 59 * 60_000)).open, true);
  assert.equal(windowStatus('WRONG_OR_DAMAGED', handover, at(48)).open, true);
  assert.equal(windowStatus('WRONG_OR_DAMAGED', handover, at(48, 1)).open, false);
  assert.equal(windowStatus('PERSONAL_PREFERENCE', handover, at(168)).open, true);
  assert.equal(windowStatus('PERSONAL_PREFERENCE', handover, at(168, 1)).open, false);
  assert.equal(windowStatus('PERSONAL_PREFERENCE', handover, at(167, 59 * 60_000)).open, true);
});

test('the window is hours, not calendar days: seven days across a clock change is still 168 hours', () => {
  const springForward = new Date('2026-03-08T06:30:00.000Z');
  const end = windowEndsAt('PERSONAL_PREFERENCE', springForward)!;
  assert.equal(end.getTime() - springForward.getTime(), 168 * HOUR);
});

test('the status reports when the window ends, and null for a skin irritation that never closes', () => {
  assert.deepEqual(windowStatus('WRONG_OR_DAMAGED', handover, at(1)), {
    open: true,
    endsAt: at(48).toISOString(),
  });
  assert.deepEqual(windowStatus('SKIN_IRRITATION', handover, at(24 * 400)), {
    open: true,
    endsAt: null,
  });
});

test('a wrong or damaged product needs a photo still present and taken inside the window; other reasons need none', () => {
  const end = at(48);
  const inside = { uploadedAt: at(10), removedAt: null };
  const exactlyAtEnd = { uploadedAt: at(48), removedAt: null };
  const late = { uploadedAt: at(48, 1), removedAt: null };
  const removed = { uploadedAt: at(10), removedAt: at(20) };
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, []), false);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [inside]), true);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [exactlyAtEnd]), true);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [late]), false);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [removed]), false);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [removed, inside]), true);
  assert.equal(hasQualifyingPhoto('PERSONAL_PREFERENCE', at(168), []), true);
  assert.equal(hasQualifyingPhoto('SKIN_IRRITATION', null, []), true);
});

test('a case the Owner opened after its window (an exception) accepts any photo that is still present', () => {
  const end = at(48);
  const late = { uploadedAt: at(300), removedAt: null };
  const removed = { uploadedAt: at(300), removedAt: at(301) };
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [late], false), false);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [late], true), true);
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [], true), false, 'still needs a photo');
  assert.equal(hasQualifyingPhoto('WRONG_OR_DAMAGED', end, [removed], true), false);
});
