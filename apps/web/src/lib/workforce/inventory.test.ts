import type {
  InventoryContextResponse,
  InventoryItem,
  InventoryLotResponse,
  StockCountResponse,
  StockReceiptResponse,
  SupplierResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventoryDictionary } from '../../i18n/inventory';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import {
  adjustRequest,
  availableTabs,
  branchesForTab,
  changedCountLines,
  countAddRequest,
  countDifference,
  countLinesRequest,
  countValues,
  defaultLot,
  differenceText,
  draftFromReceipt,
  draftFromSupplier,
  emptyAdjustDraft,
  emptyLineDraft,
  emptyReceiptDraft,
  emptySupplierDraft,
  filterReceipts,
  filterStock,
  INVENTORY_LIST_DEFAULTS,
  inventoryErrorText,
  isCalendarDate,
  isConflict,
  matchesStockStatus,
  normalizeInventoryList,
  receiptCreateRequest,
  receiptEditRequest,
  resolveBranch,
  resolveTab,
  stockFlags,
  stockSortValue,
  supplierCreateRequest,
  supplierEditRequest,
  todayInShop,
  validateAdjustDraft,
  validateReceiptDraft,
  validateSupplierDraft,
  variantOptionLabel,
} from './inventory';
import { errorMessage } from './workflows';

const TODAY = '2026-10-07';
const branch = (
  id: string,
  flags: Partial<{ view: boolean; receipts: boolean; adjust: boolean }> = {},
) => ({
  id,
  code: id,
  name: `Chi nhánh ${id}`,
  view: false,
  receipts: false,
  adjust: false,
  ...flags,
});
const context = (
  branches: InventoryContextResponse['branches'],
  extra: Partial<InventoryContextResponse> = {},
): InventoryContextResponse => ({ branches, manageProducts: false, cost: false, ...extra });

const item = (patch: Partial<InventoryItem> = {}): InventoryItem => ({
  variantId: 'v1',
  sku: 'KEM-50',
  productId: 'p1',
  productNameVi: 'Kem dưỡng ẩm',
  productNameEn: 'Moisturizer',
  labelVi: '50 ml',
  labelEn: '50 ml',
  coverMediaId: null,
  variantActive: true,
  onHand: 10,
  reserved: 0,
  available: 10,
  expiredQuantity: 0,
  lowStockThreshold: 3,
  lowStock: false,
  lotCount: 1,
  nextExpiry: null,
  expiryAlert: false,
  ...patch,
});

test('the tabs and the branch follow what the context allows', () => {
  const viewer = context([branch('A', { view: true })]);
  assert.deepEqual(availableTabs(viewer), ['stock', 'counts']);
  assert.deepEqual(availableTabs(context([branch('A', { receipts: true })])), [
    'receipts',
    'suppliers',
  ]);
  assert.deepEqual(availableTabs(context([branch('A', { adjust: true })])), ['counts']);
  assert.deepEqual(availableTabs(context([], { manageProducts: true })), ['suppliers']);
  assert.deepEqual(availableTabs(context([])), []);
  assert.equal(
    resolveTab(viewer, 'receipts'),
    'stock',
    'an unusable tab falls back to the first usable one',
  );
  assert.equal(resolveTab(viewer, 'counts'), 'counts');
  assert.equal(resolveTab(context([]), 'stock'), null);

  const many = context([
    branch('A', { view: true }),
    branch('B', { receipts: true }),
    branch('C', { view: true, receipts: true }),
  ]);
  assert.deepEqual(
    branchesForTab(many, 'stock').map((b) => b.id),
    ['A', 'C'],
  );
  assert.deepEqual(
    branchesForTab(many, 'receipts').map((b) => b.id),
    ['B', 'C'],
  );
  assert.equal(resolveBranch(many, 'C', 'stock')?.id, 'C');
  assert.equal(
    resolveBranch(many, 'B', 'stock')?.id,
    'A',
    'a branch that does not serve the tab is replaced by the first that does',
  );
  assert.equal(
    resolveBranch(many, '', 'receipts')?.id,
    'B',
    'default: the first branch where the tab works',
  );
  assert.equal(resolveBranch(context([branch('A', { view: true })]), '', 'receipts'), null);
});

test('the list state keeps only valid values', () => {
  const state = normalizeInventoryList({
    ...INVENTORY_LIST_DEFAULTS,
    tab: 'x',
    status: 'weird',
    rstatus: 'CONFIRMED',
    sort: 'nope',
    dir: 'sideways',
    page: -3,
    q: 'a'.repeat(300),
  });
  assert.equal(state.tab, 'stock');
  assert.equal(state.status, '');
  assert.equal(state.rstatus, 'CONFIRMED');
  assert.equal(state.sort, 'name');
  assert.equal(state.dir, 'asc');
  assert.equal(state.page, 1);
  assert.equal(state.q.length, 100);
});

test('stock flags and filters: out, low, expired, expiring, fine', () => {
  const fine = item();
  const low = item({
    variantId: 'v2',
    sku: 'SRM-30',
    productNameVi: 'Tinh chất',
    onHand: 2,
    lowStock: true,
  });
  const out = item({ variantId: 'v3', sku: 'MSK-1', onHand: 0, available: 0, lowStock: true });
  const expiring = item({
    variantId: 'v4',
    sku: 'TNR-1',
    expiryAlert: true,
    nextExpiry: '2026-11-01',
  });
  const expired = item({
    variantId: 'v5',
    sku: 'OLD-1',
    expiryAlert: true,
    expiredQuantity: 2,
    nextExpiry: '2026-09-01',
  });
  assert.deepEqual(stockFlags(fine), { out: false, low: false, expired: false, expiring: false });
  assert.equal(stockFlags(out).low, false, 'out of stock is not also "low"');
  assert.equal(stockFlags(out).out, true);
  assert.deepEqual([stockFlags(expiring).expiring, stockFlags(expiring).expired], [true, false]);
  assert.deepEqual([stockFlags(expired).expiring, stockFlags(expired).expired], [false, true]);
  const all = [fine, low, out, expiring, expired];
  const ids = (status: string, q = '') => filterStock(all, { status, q }).map((i) => i.variantId);
  assert.deepEqual(ids('low'), ['v2', 'v3']);
  assert.deepEqual(ids('out'), ['v3']);
  assert.deepEqual(ids('expiry'), ['v4', 'v5']);
  assert.deepEqual(ids('ok'), ['v1']);
  assert.deepEqual(ids(''), ['v1', 'v2', 'v3', 'v4', 'v5']);
  assert.deepEqual(ids('', 'tinh chat'), ['v2'], 'search ignores case and accents');
  assert.deepEqual(ids('', 'msk'), ['v3'], 'search by SKU');
  assert.equal(matchesStockStatus(fine, 'unknown'), true);
  assert.equal(stockSortValue(fine, 'onHand', 'vi'), 10);
  assert.equal(stockSortValue(fine, 'expiry', 'vi'), '9999-12-31', 'no expiry sorts last');
  assert.equal(stockSortValue(fine, 'name', 'en'), 'Moisturizer (50 ml)');
});

test('today is the shop date and a calendar date must exist', () => {
  assert.equal(
    todayInShop(new Date('2026-10-06T18:30:00.000Z')),
    '2026-10-07',
    'Ho Chi Minh is UTC+7',
  );
  assert.equal(todayInShop(new Date('2026-10-07T16:59:00.000Z')), '2026-10-07');
  assert.equal(todayInShop(new Date('2026-10-07T17:01:00.000Z')), '2026-10-08');
  for (const good of ['2026-02-28', '2028-02-29']) assert.ok(isCalendarDate(good), good);
  for (const bad of ['2027-02-29', '2026-13-01', '26-01-01', '', '1999-12-31', '2026-1-1']) {
    assert.ok(!isCalendarDate(bad), bad);
  }
});

const draftWith = (lines = [{ ...emptyLineDraft('l1'), variantId: 'v1', quantity: '5' }]) => ({
  ...emptyReceiptDraft(TODAY),
  lines,
});

test('a receipt draft is validated: item, quantity, lot code, expiry not in the past, cost only when allowed', () => {
  const ok = validateReceiptDraft(draftWith(), { cost: false, today: TODAY });
  assert.deepEqual(ok, { lines: {} });
  const empty = validateReceiptDraft(emptyReceiptDraft(TODAY), { cost: false, today: TODAY });
  assert.equal(empty.lines['line-1']?.variantId, 'required');
  assert.equal(empty.lines['line-1']?.quantity, 'required');
  assert.equal(
    validateReceiptDraft({ ...draftWith(), lines: [] }, { cost: false, today: TODAY }).noLines,
    true,
  );
  const line = (patch: object) => draftWith([{ ...draftWith().lines[0]!, ...patch }]);
  const issues = (patch: object, cost = false) =>
    validateReceiptDraft(line(patch), { cost, today: TODAY }).lines['l1'];
  assert.equal(issues({ quantity: '0' })?.quantity, 'invalid');
  assert.equal(issues({ quantity: '1.5' })?.quantity, 'invalid');
  assert.equal(issues({ quantity: '1000001' })?.quantity, 'invalid');
  assert.equal(issues({ lotCode: 'x'.repeat(65) })?.lotCode, 'invalid');
  assert.equal(issues({ expiryDate: '2026-10-06' })?.expiryDate, 'invalid', 'yesterday');
  assert.equal(issues({ expiryDate: TODAY }), undefined, 'today is allowed');
  assert.equal(issues({ expiryDate: '2026-02-30' })?.expiryDate, 'invalid');
  assert.equal(
    issues({ unitCost: 'abc' }),
    undefined,
    'a cost is not even looked at without the permission',
  );
  assert.equal(issues({ unitCost: 'abc' }, true)?.unitCost, 'invalid');
  assert.equal(issues({ unitCost: '0' }, true), undefined);
  assert.equal(
    validateReceiptDraft(
      { ...draftWith(), receiptDate: '2026-31-01' },
      { cost: false, today: TODAY },
    ).receiptDate,
    'invalid',
  );
});

test('a receipt request never carries a cost key without the cost permission', () => {
  const draft = draftWith([
    {
      ...emptyLineDraft('l1'),
      variantId: 'v1',
      quantity: '5',
      unitCost: '120000',
      lotCode: ' LOT-1 ',
      expiryDate: '2027-01-01',
    },
    { ...emptyLineDraft('l2'), variantId: 'v2', quantity: '2' },
  ]);
  const without = receiptCreateRequest(draft, 'A', { cost: false, today: TODAY })!;
  assert.ok(
    without.lines.every((line) => !('unitCostVnd' in line)),
    'no cost key at all',
  );
  assert.deepEqual(without.lines[0], {
    variantId: 'v1',
    quantity: 5,
    lotCode: 'LOT-1',
    expiryDate: '2027-01-01',
  });
  assert.equal(without.supplierId, null);
  assert.equal(without.notes, null);
  const withCost = receiptCreateRequest(draft, 'A', { cost: true, today: TODAY })!;
  assert.equal(withCost.lines[0]!.unitCostVnd, '120000');
  assert.equal(withCost.lines[1]!.unitCostVnd, null, 'an empty cost is sent as null, to clear it');
  assert.equal(withCost.branchId, 'A');
  assert.equal(receiptCreateRequest(draftWith([]), 'A', { cost: false, today: TODAY }), null);
  assert.equal(
    receiptCreateRequest(draftWith([{ ...emptyLineDraft('l1'), quantity: '1' }]), 'A', {
      cost: false,
      today: TODAY,
    }),
    null,
    'no item chosen',
  );
  const edit = receiptEditRequest({ ...draft, supplierId: 's1', notes: ' ghi chú ' }, 7, {
    cost: false,
    today: TODAY,
  })!;
  assert.equal(edit.expectedRowVersion, 7);
  assert.equal(edit.supplierId, 's1');
  assert.equal(edit.notes, 'ghi chú');
  assert.ok(!('branchId' in edit), 'the branch of a receipt never changes');
});

test('a receipt draft starts from the saved receipt', () => {
  const receipt = {
    supplierId: 's1',
    receiptDate: '2026-10-01',
    notes: null,
    lines: [
      {
        lineNo: 1,
        variantId: 'v1',
        quantity: 4,
        lotCode: null,
        expiryDate: '2027-01-01',
        unitCostVnd: '5000',
        sku: 'A',
        productNameVi: 'a',
        productNameEn: 'a',
        labelVi: null,
        labelEn: null,
      },
    ],
  } as unknown as StockReceiptResponse;
  const draft = draftFromReceipt(receipt);
  assert.deepEqual(draft.lines[0], {
    key: 'line-1',
    variantId: 'v1',
    quantity: '4',
    lotCode: '',
    expiryDate: '2027-01-01',
    unitCost: '5000',
  });
  assert.equal(draft.notes, '');
  assert.equal(variantOptionLabel(receipt.lines[0]!, 'vi'), 'A · a');
});

const lot = (patch: Partial<InventoryLotResponse>): InventoryLotResponse => ({
  id: 'L1',
  lotCode: 'LOT-1',
  expiryDate: null,
  quantityOnHand: 5,
  receivedQuantity: 5,
  expired: false,
  receiptCode: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

test('an adjustment takes out of one lot with a reason, within what the lot holds', () => {
  const lots = [
    lot({ id: 'L0', quantityOnHand: 0 }),
    lot({ id: 'L1', quantityOnHand: 5 }),
    lot({ id: 'L2', quantityOnHand: 9 }),
  ];
  assert.equal(defaultLot(lots)?.id, 'L1', 'the first lot that still holds stock');
  assert.equal(defaultLot([lot({ quantityOnHand: 0 })]), null);
  const start = emptyAdjustDraft(lots);
  assert.equal(start.lotId, 'L1');
  assert.deepEqual(validateAdjustDraft(start, lots), { quantity: 'required', reason: 'required' });
  const ready = { ...start, quantity: '5', reason: 'LOSS' };
  assert.deepEqual(validateAdjustDraft(ready, lots), {});
  assert.equal(
    validateAdjustDraft({ ...ready, quantity: '6' }, lots).quantity,
    'invalid',
    'more than the lot holds',
  );
  assert.equal(validateAdjustDraft({ ...ready, quantity: '0' }, lots).quantity, 'invalid');
  assert.equal(
    validateAdjustDraft({ ...ready, lotId: 'L0' }, lots).lotId,
    'required',
    'an empty lot cannot be chosen',
  );
  assert.equal(
    validateAdjustDraft({ ...ready, reason: 'COUNT_CORRECTION' }, lots).reason,
    'required',
    'only the five reasons',
  );
  const target = { requestKey: 'k-1', branchId: 'A', variantId: 'v1' };
  assert.deepEqual(adjustRequest({ ...ready, note: ' vỡ ' }, lots, target), {
    ...target,
    lotId: 'L1',
    quantity: 5,
    reason: 'LOSS',
    note: 'vỡ',
  });
  assert.equal(adjustRequest({ ...ready, quantity: '' }, lots, target), null);
  assert.equal(adjustRequest(ready, lots, target)?.requestKey, 'k-1', 'the same key for a retry');
});

const count = (patch: Partial<StockCountResponse> = {}): StockCountResponse => ({
  id: 'c1',
  code: 'KK000001',
  branchId: 'A',
  branchName: 'Chi nhánh A',
  status: 'OPEN',
  notes: null,
  rowVersion: 4,
  createdByName: 'Lan',
  createdAt: '2026-10-07T01:00:00.000Z',
  approvedByName: null,
  approvedAt: null,
  cancelledAt: null,
  canAdjust: true,
  lines: [
    {
      variantId: 'v1',
      sku: 'A',
      productNameVi: 'a',
      productNameEn: 'a',
      labelVi: null,
      labelEn: null,
      countedQuantity: 10,
      systemQuantity: null,
      difference: null,
      currentOnHand: 10,
    },
    {
      variantId: 'v2',
      sku: 'B',
      productNameVi: 'b',
      productNameEn: 'b',
      labelVi: null,
      labelEn: null,
      countedQuantity: 3,
      systemQuantity: null,
      difference: null,
      currentOnHand: 5,
    },
  ],
  ...patch,
});

test('count edits send only what changed and refuse a value that is not a whole number', () => {
  const c = count();
  const values = countValues(c);
  assert.deepEqual(values, { v1: '10', v2: '3' });
  assert.deepEqual(changedCountLines(c, values), []);
  assert.deepEqual(changedCountLines(c, { ...values, v2: '4' }), [
    { variantId: 'v2', countedQuantity: 4 },
  ]);
  assert.equal(changedCountLines(c, { ...values, v2: '' }), null);
  assert.equal(changedCountLines(c, { ...values, v2: '-1' }), null);
  assert.equal(changedCountLines(c, { ...values, v2: '1.5' }), null);
  assert.deepEqual(countLinesRequest(c, { ...values, v1: '9' }, ['v2']), {
    expectedRowVersion: 4,
    lines: [{ variantId: 'v1', countedQuantity: 9 }],
    removeVariantIds: ['v2'],
  });
  assert.deepEqual(
    countLinesRequest(c, { ...values, v2: '7' }, ['v2'])!.lines,
    [],
    'a removed line is never also sent as an edit',
  );
  assert.equal(countLinesRequest(c, { ...values, v1: 'x' }), null);
  assert.deepEqual(countAddRequest(c, 'v3', '2'), {
    expectedRowVersion: 4,
    lines: [{ variantId: 'v3', countedQuantity: 2 }],
    removeVariantIds: [],
  });
  assert.equal(countAddRequest(c, 'v1', '2'), null, 'already in the count');
  assert.equal(countAddRequest(c, '', '2'), null);
  assert.equal(countAddRequest(c, 'v3', ''), null);
});

test('the difference is counted minus the quantity the system holds, shown with its sign', () => {
  const [line] = count().lines;
  assert.equal(countDifference(line!, 12), 2, 'against the live quantity while open');
  assert.equal(countDifference(line!, 7), -3);
  assert.equal(countDifference(line!, null), null);
  assert.equal(
    countDifference({ ...line!, currentOnHand: null, systemQuantity: 8, difference: 2 }, 10),
    2,
    'against the stamped quantity once approved',
  );
  assert.deepEqual(
    [differenceText(2), differenceText(-3), differenceText(0), differenceText(null)],
    ['+2', '-3', '0', '—'],
  );
});

const supplier = (patch: Partial<SupplierResponse> = {}): SupplierResponse => ({
  id: 's1',
  name: 'NCC Hoa Sen',
  contactName: null,
  phone: '0900',
  email: null,
  address: null,
  notes: null,
  isActive: true,
  rowVersion: 3,
  receiptCount: 2,
  ...patch,
});

test('a supplier needs a name and a plausible email; edits carry the version and the active switch', () => {
  assert.equal(validateSupplierDraft(emptySupplierDraft()).name, 'required');
  assert.deepEqual(validateSupplierDraft({ ...emptySupplierDraft(), name: 'NCC' }), {});
  assert.equal(
    validateSupplierDraft({ ...emptySupplierDraft(), name: 'NCC', email: 'nope' }).email,
    'invalid',
  );
  assert.equal(
    validateSupplierDraft({ ...emptySupplierDraft(), name: 'x'.repeat(201) }).name,
    'invalid',
  );
  assert.equal(supplierCreateRequest(emptySupplierDraft()), null);
  assert.deepEqual(
    supplierCreateRequest({
      ...emptySupplierDraft(),
      name: ' NCC ',
      phone: ' 0900 ',
      email: 'a@b.vn',
    }),
    { name: 'NCC', contactName: null, phone: '0900', email: 'a@b.vn', address: null, notes: null },
  );
  const draft = { ...draftFromSupplier(supplier()), isActive: false };
  const edit = supplierEditRequest(draft, supplier())!;
  assert.equal(edit.expectedRowVersion, 3);
  assert.equal(edit.isActive, false);
  assert.equal(edit.name, 'NCC Hoa Sen');
});

test('receipts filter by code, supplier and status', () => {
  const receipts = [
    { id: 'r1', code: 'PN000001', status: 'DRAFT', supplierName: 'Hoa Sen' },
    { id: 'r2', code: 'PN000002', status: 'CONFIRMED', supplierName: null },
  ] as never[];
  const ids = (q: string, rstatus: string) =>
    filterReceipts(receipts, { q, rstatus }).map((r: { id: string }) => r.id);
  assert.deepEqual(ids('', ''), ['r1', 'r2']);
  assert.deepEqual(ids('pn000002', ''), ['r2']);
  assert.deepEqual(ids('hoa sen', ''), ['r1']);
  assert.deepEqual(ids('', 'CONFIRMED'), ['r2']);
});

test("failed commands say what happened in the shop's words", () => {
  const t = getWorkforceDictionary('vi');
  const fallback = (cause: unknown) => errorMessage(cause, t);
  const text = inventoryDictionary('vi').errors;
  const failure = (code: string, field: string | null = null) => new ApiError(409, code, field);
  assert.equal(
    inventoryErrorText(failure('INVENTORY_INSUFFICIENT_STOCK'), 'vi', fallback),
    text.INVENTORY_INSUFFICIENT_STOCK,
  );
  assert.equal(
    inventoryErrorText(failure('INVENTORY_RECEIPT_NOT_DRAFT'), 'vi', fallback),
    text.INVENTORY_RECEIPT_NOT_DRAFT,
  );
  assert.equal(
    inventoryErrorText(failure('INVENTORY_COUNT_NOT_OPEN'), 'vi', fallback),
    text.INVENTORY_COUNT_NOT_OPEN,
  );
  assert.equal(
    inventoryErrorText(failure('INVENTORY_VARIANT_UNAVAILABLE'), 'vi', fallback),
    text.INVENTORY_VARIANT_UNAVAILABLE,
  );
  assert.equal(inventoryErrorText(failure('CONFLICT'), 'vi', fallback), text.conflict);
  assert.equal(inventoryErrorText(failure('CONFLICT', 'name'), 'vi', fallback), text.name);
  assert.equal(
    inventoryErrorText(failure('CONFLICT', 'requestKey'), 'vi', fallback),
    text.requestKey,
  );
  assert.equal(
    inventoryErrorText(failure('VALIDATION_FAILED', 'expiryDate'), 'vi', fallback),
    text.fields.expiryDate,
  );
  assert.equal(
    inventoryErrorText(failure('VALIDATION_FAILED', 'unknownField'), 'vi', fallback),
    fallback(failure('VALIDATION_FAILED', 'unknownField')),
  );
  assert.equal(inventoryErrorText(new Error('boom'), 'vi', fallback), t.errors.unexpected);
  assert.equal(isConflict(failure('CONFLICT')), true);
  assert.equal(isConflict(failure('CONFLICT', 'name')), false);
  assert.equal(isConflict(failure('FORBIDDEN')), false);
});

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

test('Vietnamese and English inventory texts have the same keys, and no Vietnamese text says "khám"', () => {
  assert.deepEqual(keys(inventoryDictionary('vi')).sort(), keys(inventoryDictionary('en')).sort());
  const all = JSON.stringify(inventoryDictionary('vi')).toLowerCase();
  assert.ok(!all.includes('khám'), 'a spa, not a clinic');
});
