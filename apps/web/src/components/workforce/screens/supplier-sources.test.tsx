import type { SupplierSourceItem, SupplierSourceListResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supplierSourcesDictionary } from '../../../i18n/supplier-sources';
import {
  editRequest,
  emptySourceDraft,
  looksLikeSourceUrl,
  NEW_SUPPLIER,
  permissionDraftOf,
  permissionRequest,
  permissionState,
  sourceActions,
  sourceCreateRequest,
  sourceErrorText,
  validateEdit,
  validatePermission,
  validateSource,
} from '../../../lib/workforce/supplier-sources';
import { ApiError } from '../../../lib/workforce/api';
import { employee, owner, render } from '../../../test/support';
import { SourcesView, SupplierSourcesScreen } from './supplier-sources';

const text = supplierSourcesDictionary('vi');
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const noop = () => Promise.resolve();

const source = (patch: Partial<SupplierSourceItem> = {}): SupplierSourceItem => ({
  id: 's1',
  supplier: { id: 'p1', name: 'Haru Ohui' },
  name: 'Website haruohui.com',
  kind: 'WEBSITE',
  baseUrl: 'https://haruohui.com/',
  adapterKey: null,
  status: 'PENDING_VALIDATION',
  isEnabled: false,
  scanCadence: 'MANUAL',
  permission: {
    givenBy: null,
    method: null,
    date: null,
    note: null,
    permitsText: false,
    permitsImages: false,
    permitsPrices: false,
    confirmedAt: null,
    confirmedBy: null,
  },
  gaps: ['PERMISSION_RECORD', 'PERMISSION_COVERAGE', 'PERMISSION_CONFIRMATION', 'TEST_REQUIRED'],
  lastSuccessAt: null,
  rowVersion: 1,
  createdAt: '2026-10-10T03:00:00.000Z',
  ...patch,
});

const recorded = (patch: Partial<SupplierSourceItem['permission']> = {}) =>
  source({
    gaps: ['PERMISSION_CONFIRMATION', 'TEST_REQUIRED'],
    permission: {
      givenBy: 'Chị Hà',
      method: 'Tin nhắn Zalo',
      date: '2026-10-01',
      note: null,
      permitsText: true,
      permitsImages: true,
      permitsPrices: false,
      confirmedAt: null,
      confirmedBy: null,
      ...patch,
    },
  });

/** Permission confirmed but no sample confirmed yet. */
const tested = () =>
  source({
    ...recorded({
      confirmedAt: '2026-10-02T03:00:00.000Z',
      confirmedBy: { id: 'u1', name: 'Chủ' },
    }),
    gaps: ['TEST_REQUIRED'],
  });

/** Permission confirmed and a person confirmed the sample: nothing is missing. */
const ready = () => ({ ...tested(), status: 'READY' as const, gaps: [] });

const list = (
  items: SupplierSourceItem[],
  patch: Partial<SupplierSourceListResponse> = {},
): SupplierSourceListResponse => ({
  items,
  suppliers: [{ id: 'p1', name: 'Haru Ohui' }],
  canManage: true,
  ...patch,
});

const view = (data: SupplierSourceListResponse, locale: 'vi' | 'en' = 'vi') =>
  render(<SourcesView list={data} onChange={() => undefined} reload={noop} />, owner, locale);

test('the page has one primary action, the list with supplier, address, permission and status, and a row menu', () => {
  const html = view(list([source(), { ...ready(), id: 's2', name: 'Bảng giá', isEnabled: true }]));
  assert.match(html, /<h1[^>]*>Nguồn nhà cung cấp<\/h1>/);
  assert.equal((html.match(/ls-btn-primary/g) ?? []).length, 1);
  assert.match(html, /ls-btn-primary[^>]*>(?:<[^>]*>)*[^<]*Thêm nguồn/);
  assert.match(html, /Website haruohui\.com/);
  assert.match(html, /Haru Ohui/);
  assert.match(html, /https:\/\/haruohui\.com\//);
  assert.match(html, re(text.permissionBadge.none));
  assert.match(html, re(text.permissionBadge.confirmed));
  assert.match(html, re(text.enabled));
  assert.match(html, re(text.disabled));
  assert.match(html, /Thao tác với Website haruohui\.com/);
  assert.doesNotMatch(html, /khám/i);
});

test('an empty list says there is no source yet and still offers to add one', () => {
  const html = view(list([]));
  assert.match(html, re(text.empty));
  assert.match(html, re(text.add));
});

test('a reviewer only reads: a notice, the list, no add button and no row menu', () => {
  const html = view(list([source()], { canManage: false }));
  assert.match(html, re(text.readOnly));
  assert.doesNotMatch(html, re(text.add));
  assert.doesNotMatch(html, /Thao tác với/);
  assert.match(html, /Website haruohui\.com/);
});

test('access: the manager and the reviewer see the screen, everyone else is told they have no access', () => {
  assert.doesNotMatch(render(<SupplierSourcesScreen />, owner), re(text.noAccess));
  assert.doesNotMatch(
    render(<SupplierSourcesScreen />, employee([['MANAGE_SUPPLIER_SOURCES']])),
    re(text.noAccess),
  );
  assert.doesNotMatch(
    render(<SupplierSourcesScreen />, employee([['REVIEW_SUPPLIER_IMPORTS']])),
    re(text.noAccess),
  );
  for (const account of [
    employee([['MANAGE_PRODUCTS']]),
    employee([['MANAGE_SUPPLIER_SOURCES', 'A']]),
    employee(),
  ]) {
    const html = render(<SupplierSourcesScreen />, account);
    assert.match(html, re(text.noAccess));
    assert.doesNotMatch(html, re(text.add));
  }
});

test('English renders every text', () => {
  const html = view(list([source()]), 'en');
  assert.match(html, /Supplier sources/);
  assert.match(html, /Add a source/);
  assert.match(html, /Not recorded/);
  assert.doesNotMatch(html, /Nguồn nhà cung cấp/);
});

test('the Vietnamese and English dictionaries have the same shape', () => {
  const shape = (value: unknown, path = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => shape(child, `${path}.${key}`))
      : [path];
  assert.deepEqual(shape(supplierSourcesDictionary('en')), shape(supplierSourcesDictionary('vi')));
  assert.doesNotMatch(JSON.stringify(supplierSourcesDictionary('vi')), /khám/i);
});

test('the permission column reads: not recorded, waiting for confirmation, confirmed', () => {
  assert.equal(permissionState(source()), 'none');
  assert.equal(permissionState(recorded()), 'pending');
  assert.equal(permissionState(ready()), 'confirmed');
});

test('the row menu follows the gate: confirm only when a record waits, enable only when nothing is missing', () => {
  assert.deepEqual(sourceActions(source(), true), ['edit', 'permission']);
  assert.deepEqual(sourceActions(recorded(), true), ['edit', 'permission', 'confirm']);
  assert.deepEqual(sourceActions(tested(), true), ['edit', 'permission', 'test']);
  assert.deepEqual(sourceActions(ready(), true), ['edit', 'permission', 'test', 'enable']);
  assert.deepEqual(sourceActions({ ...ready(), isEnabled: true, gaps: [] }, true), [
    'edit',
    'permission',
    'test',
    'disable',
  ]);
  assert.deepEqual(
    sourceActions({ ...ready(), kind: 'FILE', baseUrl: null }, true),
    ['edit', 'permission', 'enable'],
    'a file source has nothing to read, so no test',
  );
  // A recorded permission that covers neither text nor images can be confirmed but not enabled.
  assert.deepEqual(
    sourceActions(
      {
        ...recorded({ permitsText: false, permitsImages: false }),
        gaps: ['PERMISSION_COVERAGE', 'PERMISSION_CONFIRMATION', 'TEST_REQUIRED'],
      },
      true,
    ),
    ['edit', 'permission', 'confirm'],
  );
  assert.deepEqual(sourceActions(ready(), false), [], 'a reviewer gets no action');
});

test('a source address looks like the server accepts it: https, a host name, nothing else', () => {
  assert.ok(looksLikeSourceUrl('https://haruohui.com/'));
  assert.ok(looksLikeSourceUrl('  https://shop.example.com/danh-muc  '));
  for (const bad of [
    '',
    'haruohui.com',
    'http://haruohui.com/',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://user:pw@shop.example.com/',
    'https://shop.example.com:8443/',
    'https://shop.example.com/?a=1',
    'https://shop.example.com/#a',
    'https://shop example.com/',
  ]) {
    assert.ok(!looksLikeSourceUrl(bad), bad);
  }
});

test('the create form: a supplier by id or by name, a name, a kind and an address (none for a file)', () => {
  assert.equal(emptySourceDraft('p1').supplierId, 'p1');
  assert.equal(emptySourceDraft(null).supplierId, NEW_SUPPLIER);
  const draft = {
    ...emptySourceDraft('p1'),
    name: ' Website ',
    baseUrl: ' https://haruohui.com/ ',
  };
  assert.deepEqual(validateSource(draft), {});
  assert.deepEqual(sourceCreateRequest(draft), {
    supplierId: 'p1',
    name: 'Website',
    kind: 'WEBSITE',
    baseUrl: 'https://haruohui.com/',
  });
  const fresh = {
    ...emptySourceDraft(null),
    supplierName: ' Haru Ohui ',
    name: 'x',
    baseUrl: 'https://a.example.com/',
  };
  assert.deepEqual(sourceCreateRequest(fresh), {
    supplierName: 'Haru Ohui',
    name: 'x',
    kind: 'WEBSITE',
    baseUrl: 'https://a.example.com/',
  });
  assert.deepEqual(validateSource(emptySourceDraft(null)), {
    supplierName: true,
    name: true,
    baseUrl: true,
  });
  const file = { ...emptySourceDraft('p1'), kind: 'FILE' as const, name: 'Tệp' };
  assert.deepEqual(validateSource(file), {});
  assert.equal(sourceCreateRequest(file).baseUrl, null);
});

test('the edit form sends only what changed, with the version it was read at', () => {
  const item = { ...source(), rowVersion: 7 };
  const draft = { name: item.name, baseUrl: item.baseUrl ?? '', scanCadence: item.scanCadence };
  assert.equal(editRequest(draft, item), null);
  assert.deepEqual(editRequest({ ...draft, name: ' Mới ' }, item), {
    expectedVersion: 7,
    name: 'Mới',
  });
  assert.deepEqual(
    editRequest({ ...draft, scanCadence: 'WEEKLY', baseUrl: 'https://b.example.com/' }, item),
    {
      expectedVersion: 7,
      baseUrl: 'https://b.example.com/',
      scanCadence: 'WEEKLY',
    },
  );
  assert.deepEqual(validateEdit({ ...draft, name: ' ' }, item), { name: true });
  assert.deepEqual(validateEdit({ ...draft, baseUrl: 'http://x.example.com/' }, item), {
    baseUrl: true,
  });
});

test('the permission form: who, how and a date that is not in the future; the request equals the record or is null', () => {
  const item = { ...recorded(), rowVersion: 3 };
  const draft = permissionDraftOf(item);
  assert.deepEqual(validatePermission(draft, '2026-10-10'), {});
  assert.equal(permissionRequest(draft, item), null, 'unchanged means nothing to send');
  assert.deepEqual(
    validatePermission({ ...draft, givenBy: ' ', method: '', date: '' }, '2026-10-10'),
    {
      givenBy: true,
      method: true,
      date: true,
    },
  );
  assert.deepEqual(validatePermission({ ...draft, date: '2026-10-11' }, '2026-10-10'), {
    date: true,
  });
  assert.deepEqual(permissionRequest({ ...draft, permitsPrices: true, note: '  ' }, item), {
    expectedVersion: 3,
    givenBy: 'Chị Hà',
    method: 'Tin nhắn Zalo',
    date: '2026-10-01',
    note: null,
    permitsText: true,
    permitsImages: true,
    permitsPrices: true,
  });
});

test('this area has its own words for the refused commands; anything else falls back', () => {
  const fallback = () => 'fallback';
  assert.equal(
    sourceErrorText(new ApiError(409, 'SUPPLIER_SOURCE_NOT_COVERED', undefined), 'vi', fallback),
    text.errors.SUPPLIER_SOURCE_NOT_COVERED,
  );
  assert.equal(
    sourceErrorText(new ApiError(409, 'SUPPLIER_SOURCE_ENABLED', 'baseUrl'), 'en', fallback),
    supplierSourcesDictionary('en').errors.SUPPLIER_SOURCE_ENABLED,
  );
  assert.equal(
    sourceErrorText(new ApiError(500, 'WHATEVER', undefined), 'vi', fallback),
    'fallback',
  );
  assert.equal(sourceErrorText(new Error('x'), 'vi', fallback), 'fallback');
});
