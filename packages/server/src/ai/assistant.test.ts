import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSISTANT_SYSTEM,
  answerIsClean,
  buildAssistantUserMessage,
  checkAnswerNumbers,
  collectNumbers,
  spokenNumbers,
} from './assistant.js';

const result = {
  totals: { netVnd: '12500000', collectedVnd: '13000000', refundsVnd: '500000' },
  changePercent: 12.3,
  byBranch: [
    { name: 'Chi nhánh 1', netVnd: '7000000', visits: 41 },
    { name: 'Chi nhánh 2', netVnd: '5500000', visits: 30 },
  ],
};
const allowed = collectNumbers(result);

test('numbers of a tool result: values, money strings and the length of each list', () => {
  for (const n of [12_500_000, 13_000_000, 500_000, 12.3, 41, 30, 2])
    assert.ok(allowed.has(n), String(n));
  assert.ok(!allowed.has(99));
});

test('spoken numbers: thousands groups, decimals, units, and no dates, months, hours or list numbers', () => {
  assert.deepEqual(
    spokenNumbers('Doanh thu 12.500.000 đ, tăng 12,3%, hay 12,5 triệu.').map((entry) => [
      entry.value,
      entry.unit,
    ]),
    [
      [12_500_000, 'plain'],
      [12.3, 'pct'],
      [12.5, 'trieu'],
    ],
  );
  assert.deepEqual(
    spokenNumbers('Từ 2026-10-01 đến 01/10/2026, trong tháng 10 năm 2026, lúc 9 giờ.\n1. Một mục'),
    [],
  );
  assert.equal(spokenNumbers('Có 41 lượt đến')[0]?.value, 41);
});

test('an answer passes only when every number it speaks came from a tool', () => {
  const good =
    'Tháng này doanh thu ròng là 12.500.000 đ (tăng 12%), gồm 41 lượt đến ở Chi nhánh 1.';
  assert.deepEqual(checkAnswerNumbers(good, allowed, 'Doanh thu tháng này?'), {
    ok: true,
    unknown: [],
  });
  assert.deepEqual(
    checkAnswerNumbers('Doanh thu là 12,5 triệu, hoàn trả 500 nghìn.', allowed, 'x'),
    { ok: true, unknown: [] },
  );
  const bad = checkAnswerNumbers('Doanh thu là 12.600.000 đ và tăng 20%.', allowed, 'x');
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unknown, ['12.600.000', '20 %']);
  // A figure the model worked out itself is not allowed, even if it is right (7.000.000 + 5.500.000 is returned, 12.500.000 too; 1.500.000 is not).
  assert.equal(checkAnswerNumbers('Chênh lệch 1.500.000 đ.', allowed, 'x').ok, false);
  // A number the question itself carries may be repeated.
  assert.equal(
    checkAnswerNumbers('Không có ngưỡng 3000000 nào.', allowed, 'Có vượt 3000000 không?').ok,
    true,
  );
});

test('the prompt states the rules the check enforces and the clean-answer check finds the clinic word, links and markup', () => {
  assert.match(ASSISTANT_SYSTEM, /ONLY TOOL NUMBERS/);
  assert.match(ASSISTANT_SYSTEM, /at most six calls/);
  assert.doesNotMatch(
    ASSISTANT_SYSTEM,
    /Hôm nay/,
    'the date is in the user turn, so the system prompt stays cacheable',
  );
  assert.match(buildAssistantUserMessage('Doanh thu?', '2026-10-13'), /2026-10-13/);
  assert.equal(answerIsClean('Doanh thu tăng. Khám phá thêm trong báo cáo.'), true);
  assert.equal(answerIsClean('Số lượt khám tăng.'), false);
  assert.equal(answerIsClean('Xem https://x.example'), false);
  assert.equal(answerIsClean('**Doanh thu** tăng'), false);
});
