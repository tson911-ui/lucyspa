import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bookingTotals,
  formatFixedTotal,
  bookingPrefillFromSearch,
  groupByCategory,
  prefillBranchId,
  prefillDate,
  preselectServiceIds,
  serviceCodesFromSearch,
  type BranchService,
} from './booking-view';

function service(code: string, overrides: Partial<BranchService> = {}): BranchService {
  return {
    id: `id-${code}`,
    code,
    nameVi: `Dịch vụ ${code}`,
    nameEn: `Service ${code}`,
    categoryNameVi: 'Massage',
    categoryNameEn: 'Massage',
    durationMinutes: 60,
    priceMinVnd: '150000',
    priceMaxVnd: '150000',
    pricingUnit: 'PER_SERVICE',
    ...overrides,
  };
}

test('the deep link names services by code: trimmed, repeated parameters and commas, no repeats, at most ten', () => {
  assert.deepEqual(serviceCodesFromSearch(''), []);
  assert.deepEqual(serviceCodesFromSearch('?service=SV001'), ['SV001']);
  assert.deepEqual(serviceCodesFromSearch('?service=SV001, SV002&service=SV001&service='), [
    'SV001',
    'SV002',
  ]);
  const many = Array.from({ length: 14 }, (_, n) => `S${n}`).join(',');
  assert.equal(serviceCodesFromSearch(`?service=${many}`).length, 10);
  assert.deepEqual(serviceCodesFromSearch(`?service=${'x'.repeat(65)}`), []);
});

test('preselect keeps the order of the codes and drops a code the branch does not offer', () => {
  const services = [service('A'), service('B'), service('C')];
  assert.deepEqual(preselectServiceIds(['C', 'GONE', 'A', 'C'], services), ['id-C', 'id-A']);
  assert.deepEqual(preselectServiceIds([], services), []);
});

test('services group by category in the order met, cheapest first and then by name', () => {
  const groups = groupByCategory(
    [
      service('N1', { categoryNameVi: 'Nail', categoryNameEn: 'Nails', priceMinVnd: '80000' }),
      service('M2', { priceMinVnd: '200000', nameVi: 'Massage cổ' }),
      service('M1', { priceMinVnd: '150000', nameVi: 'Massage chân' }),
      service('M3', { priceMinVnd: '150000', nameVi: 'Massage body' }),
    ],
    'vi',
  );
  assert.deepEqual(
    groups.map((group) => group.name),
    ['Nail', 'Massage'],
  );
  assert.deepEqual(
    groups[1]?.services.map((entry) => entry.code),
    ['M3', 'M1', 'M2'],
  );
  assert.equal(
    groupByCategory([service('N1', { categoryNameEn: 'Nails' })], 'en')[0]?.name,
    'Nails',
  );
});

test('totals add the fixed prices; per-nail services add time but no figure, only the note', () => {
  const fixed = service('F', { durationMinutes: 45, priceMinVnd: '150000', priceMaxVnd: '150000' });
  const range = service('R', { durationMinutes: 30, priceMinVnd: '50000', priceMaxVnd: '80000' });
  const nail = service('P', {
    durationMinutes: 20,
    priceMinVnd: '5000',
    priceMaxVnd: '30000',
    pricingUnit: 'PER_NAIL',
  });

  const one = bookingTotals([fixed]);
  assert.deepEqual([one.count, one.minutes, one.hasPerNail], [1, 45, false]);
  assert.equal(formatFixedTotal(one, 'vi'), '150.000 ₫');

  const mixed = bookingTotals([fixed, range, nail]);
  assert.deepEqual([mixed.count, mixed.minutes, mixed.hasPerNail], [3, 95, true]);
  assert.equal(formatFixedTotal(mixed, 'en'), '200,000 ₫ – 230,000 ₫');

  const onlyNail = bookingTotals([nail]);
  assert.equal(formatFixedTotal(onlyNail, 'vi'), null);
  assert.equal(formatFixedTotal(bookingTotals([]), 'vi'), '0 ₫');
});

test('the chat booking link names services with services=, and the old service= links still work', () => {
  assert.deepEqual(serviceCodesFromSearch('?services=goi-dau,massage'), ['goi-dau', 'massage']);
  assert.deepEqual(serviceCodesFromSearch('?service=A&services=B,A'), ['A', 'B']);
});

test('the booking link names a branch, a real day and a start time; anything malformed is left out', () => {
  assert.deepEqual(
    bookingPrefillFromSearch('?branch=hai-chau&services=a&date=2026-11-05&time=14%3A30'),
    { branchCode: 'hai-chau', date: '2026-11-05', time: '14:30' },
  );
  assert.deepEqual(bookingPrefillFromSearch(''), { branchCode: null, date: null, time: null });
  assert.deepEqual(
    bookingPrefillFromSearch('?branch=https%3A%2F%2Fevil.example&date=2026-02-30&time=25:00'),
    { branchCode: null, date: null, time: null },
  );
  assert.deepEqual(bookingPrefillFromSearch('?date=05/11/2026&time=2pm'), {
    branchCode: null,
    date: null,
    time: null,
  });
});

test('the linked branch and day are used only when the customer has that branch and the day is bookable', () => {
  const branches = [
    { id: 'b1', code: 'hai-chau' },
    { id: 'b2', code: 'son-tra' },
  ];
  assert.equal(prefillBranchId('son-tra', branches), 'b2');
  assert.equal(prefillBranchId('gone', branches), null);
  assert.equal(prefillBranchId(null, branches), null);
  assert.equal(prefillDate('2026-11-05', '2026-11-01', '2026-12-31'), '2026-11-05');
  assert.equal(prefillDate('2026-11-01', '2026-11-01', '2026-12-31'), '2026-11-01');
  assert.equal(prefillDate('2026-10-31', '2026-11-01', '2026-12-31'), null);
  assert.equal(prefillDate('2027-01-01', '2026-11-01', '2026-12-31'), null);
  assert.equal(prefillDate(null, '2026-11-01', '2026-12-31'), null);
});
