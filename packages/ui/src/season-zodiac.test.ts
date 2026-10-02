import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LUNAR_CAN,
  LUNAR_CHI,
  ZODIAC_ANIMALS,
  ZODIAC_KEYS,
  lunarYear,
  lunarYearForSeasonEnd,
} from '@lucy-spa/contracts';

// The Tet season's lunar year (docs/UXUI_REDESIGN_S6_PLAN.md section 11, decision 4): the Vietnamese 12-animal
// cycle and the can-chi name, computed from the window's last day.

const EXPECTED: ReadonlyArray<[number, string, string]> = [
  [2020, 'Canh Tý', 'chuột'],
  [2021, 'Tân Sửu', 'trâu'],
  [2022, 'Nhâm Dần', 'hổ'],
  [2023, 'Quý Mão', 'mèo'],
  [2024, 'Giáp Thìn', 'rồng'],
  [2025, 'Ất Tỵ', 'rắn'],
  [2026, 'Bính Ngọ', 'ngựa'],
  [2027, 'Đinh Mùi', 'dê'],
  [2028, 'Mậu Thân', 'khỉ'],
  [2029, 'Kỷ Dậu', 'gà'],
  [2030, 'Canh Tuất', 'chó'],
  [2031, 'Tân Hợi', 'lợn'],
];

test('2020-2031 map to the right can-chi and the Vietnamese animal', () => {
  for (const [year, canChi, animal] of EXPECTED) {
    const result = lunarYear(year);
    assert.equal(result.canChi, canChi, String(year));
    assert.equal(result.animalName.vi, animal, String(year));
    assert.equal(result.year, year);
  }
});

test('the cycle is the Vietnamese one: the buffalo is Suu and the cat is Mao, never the rabbit', () => {
  assert.equal(ZODIAC_ANIMALS.suu.vi, 'trâu');
  assert.equal(ZODIAC_ANIMALS.suu.en, 'Buffalo');
  assert.equal(ZODIAC_ANIMALS.mao.vi, 'mèo');
  assert.equal(ZODIAC_ANIMALS.mao.en, 'Cat');
  const all = Object.values(ZODIAC_ANIMALS).map((animal) => animal.vi);
  assert.deepEqual(all, [
    'chuột',
    'trâu',
    'hổ',
    'mèo',
    'rồng',
    'rắn',
    'ngựa',
    'dê',
    'khỉ',
    'gà',
    'chó',
    'lợn',
  ]);
  assert.ok(!all.includes('thỏ'));
});

test('the 60-year cycle repeats and the tables are complete', () => {
  assert.equal(LUNAR_CAN.length, 10);
  assert.equal(LUNAR_CHI.length, 12);
  assert.equal(ZODIAC_KEYS.length, 12);
  for (let year = 1900; year <= 2100; year++) {
    assert.equal(lunarYear(year).canChi, lunarYear(year + 60).canChi);
  }
  // 1984 was Giap Ty, the start of a cycle; 4 CE too.
  assert.equal(lunarYear(1984).canChi, 'Giáp Tý');
  assert.equal(lunarYear(4).canChi, 'Giáp Tý');
  assert.equal(lunarYear(2000).canChi, 'Canh Thìn');
});

test('the season year is the Gregorian year of the last day inclusive, in Vietnam time', () => {
  // Tet 2027 window: 30 Jan to 12 Feb 2027; the form stores 13 Feb 00:00 Vietnam time (12 Feb 17:00 UTC) as the end.
  assert.equal(lunarYearForSeasonEnd('2027-02-12T17:00:00.000Z')?.canChi, 'Đinh Mùi');
  assert.equal(lunarYearForSeasonEnd('2028-01-31T17:00:00.000Z')?.canChi, 'Mậu Thân');
  // A window that starts in the previous December still names the year of its end.
  assert.equal(lunarYearForSeasonEnd('2027-02-05T17:00:00.000Z')?.year, 2027);
  // A last day of 31 December belongs to that year, not the next (the end instant is already 1 January locally).
  assert.equal(lunarYearForSeasonEnd('2027-12-31T17:00:00.000Z')?.year, 2027);
  assert.equal(lunarYearForSeasonEnd('2027-12-31T16:59:59.999Z')?.year, 2027);
  // The instant just past midnight in Vietnam on 1 January is the next year's first day: last day 1 Jan 2028.
  assert.equal(lunarYearForSeasonEnd('2028-01-01T17:00:00.000Z')?.year, 2028);
  assert.equal(lunarYearForSeasonEnd('not a date'), null);
});
