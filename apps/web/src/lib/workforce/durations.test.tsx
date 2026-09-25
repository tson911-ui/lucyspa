import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DurationFields } from '../../components/workforce/screens/service-durations';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { durationNumbers, durationProblem, formatEstimate } from './durations';

const form = (min: string, max: string, slot: string) => ({
  estimatedMinMinutes: min,
  estimatedMaxMinutes: max,
  durationMinutes: slot,
});

test('duration form rules mirror the API invariant (min <= max <= scheduling)', () => {
  assert.equal(durationProblem(form('30', '45', '45')), null, 'hair wash 30–45, slot 45');
  assert.equal(durationProblem(form('60', '80', '90')), null, 'herbal 60–80, slot 90');
  assert.equal(durationProblem(form('60', '60', '60')), null, 'exact 60 minutes');
  assert.equal(durationProblem(form('60', '45', '60')), 'maxBeforeMin');
  assert.equal(durationProblem(form('60', '120', '90')), 'slotTooShort');
  for (const bad of ['0', '', '1441', '30.5', '-5', 'abc']) {
    assert.equal(durationProblem(form(bad, '60', '60')), 'invalid', bad);
  }
  assert.deepEqual(durationNumbers(form(' 30', '45 ', '60')), {
    estimatedMinMinutes: 30,
    estimatedMaxMinutes: 45,
    durationMinutes: 60,
  });
});

test('the customer-facing estimate is a range, or one value when exact', () => {
  const vi = getWorkforceDictionary('vi');
  const en = getWorkforceDictionary('en');
  assert.equal(formatEstimate(30, 45, vi), '30–45 phút');
  assert.equal(formatEstimate(60, 60, en), '60 min');
});

test('the service form offers the estimate range and the scheduling duration', () => {
  const t = getWorkforceDictionary('vi');
  const markup = renderToStaticMarkup(
    <DurationFields
      idPrefix="svc"
      value={form('60', '120', '90')}
      onChange={() => undefined}
      t={t}
    />,
  );
  for (const label of [t.services.estimatedMin, t.services.estimatedMax, t.services.duration]) {
    assert.ok(markup.includes(label), label);
  }
  assert.ok(markup.includes(t.services.durationSlotTooShort), 'explains the invalid slot');
  const valid = renderToStaticMarkup(
    <DurationFields
      idPrefix="svc"
      value={form('30', '45', '45')}
      onChange={() => undefined}
      t={t}
    />,
  );
  assert.ok(!valid.includes('role="alert"'));
});
