import type { ServiceCategoryResponse, ServiceResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterServices,
  normalizeServiceList,
  orderCategories,
  SERVICE_LIST_DEFAULTS,
  serviceSortValue,
} from './services-list';

function service(overrides: Partial<ServiceResponse>): ServiceResponse {
  return {
    id: 's',
    code: 'GEL',
    categoryId: 'c1',
    nameVi: 'Sơn gel',
    nameEn: 'Gel polish',
    descriptionVi: null,
    descriptionEn: null,
    priceVnd: '150000',
    priceMaxVnd: '150000',
    pricingUnit: 'PER_SERVICE',
    maxQuantity: 1,
    durationMinutes: 60,
    estimatedMinMinutes: 60,
    estimatedMaxMinutes: 60,
    isActive: true,
    version: 1,
    availability: [],
    eligibleSkills: [],
    ...overrides,
  };
}

const services = [
  service({ id: 'a', code: 'GEL', categoryId: 'c1' }),
  service({
    id: 'b',
    code: 'SPA',
    nameVi: 'Massage chân',
    nameEn: 'Foot massage',
    categoryId: 'c2',
  }),
  service({
    id: 'c',
    code: 'OLD',
    nameVi: 'Dịch vụ cũ',
    nameEn: 'Retired service',
    categoryId: 'c2',
    isActive: false,
  }),
];

test('search matches code and both names without accents; filters combine', () => {
  const ids = (state: { q: string; category: string; status: string }) =>
    filterServices(services, state).map((entry) => entry.id);
  assert.deepEqual(ids({ q: 'massage chan', category: '', status: '' }), ['b']);
  assert.deepEqual(ids({ q: 'gel pol', category: '', status: '' }), ['a']);
  assert.deepEqual(ids({ q: 'spa', category: '', status: '' }), ['b']);
  assert.deepEqual(ids({ q: '', category: 'c2', status: '' }), ['b', 'c']);
  assert.deepEqual(ids({ q: '', category: 'c2', status: 'inactive' }), ['c']);
  assert.deepEqual(ids({ q: '', category: '', status: 'active' }), ['a', 'b']);
});

test('the address bar cannot put the list in an impossible state', () => {
  const state = normalizeServiceList({
    ...SERVICE_LIST_DEFAULTS,
    tab: 'nope',
    sort: 'estimate',
    status: 'x',
    page: 0,
    cpage: -2,
    pageSize: 7,
  });
  assert.equal(state.tab, 'services');
  assert.equal(state.sort, 'code');
  assert.equal(state.status, '');
  assert.equal(state.page, 1);
  assert.equal(state.cpage, 1);
  assert.equal(state.pageSize, SERVICE_LIST_DEFAULTS.pageSize);
  assert.equal(
    normalizeServiceList({ ...SERVICE_LIST_DEFAULTS, tab: 'categories' }).tab,
    'categories',
  );
});

test('services sort by code, localized name, category name and minimum price', () => {
  const name = (id: string) => (id === 'c1' ? 'Nail' : 'Chăm sóc');
  const a = service({ priceVnd: '9000' });
  const b = service({ priceVnd: '10000', nameVi: 'Ba' });
  assert.ok(
    (serviceSortValue(a, 'price', 'vi', name) as number) <
      (serviceSortValue(b, 'price', 'vi', name) as number),
    'numbers, not text: 9000 < 10000',
  );
  assert.equal(serviceSortValue(b, 'name', 'vi', name), 'Ba');
  assert.equal(serviceSortValue(b, 'name', 'en', name), 'Gel polish');
  assert.equal(serviceSortValue(a, 'category', 'vi', name), 'Nail');
  assert.equal(serviceSortValue(a, 'code', 'vi', name), 'GEL');
});

test('categories follow their configured order, then code', () => {
  const category = (code: string, sortOrder: number): ServiceCategoryResponse => ({
    id: code,
    code,
    nameVi: code,
    nameEn: code,
    sortOrder,
    isActive: true,
    version: 1,
  });
  assert.deepEqual(
    orderCategories([category('B', 2), category('C', 1), category('A', 2)]).map(
      (entry) => entry.code,
    ),
    ['C', 'A', 'B'],
  );
});
