import {
  PRODUCT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_ISSUE_CODES,
  type ProductImportRowResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importDictionary } from '../../i18n/imports';
import { ApiError } from './api';
import {
  applyRequest,
  applySummary,
  columnLabel,
  filterImportRows,
  importErrorText,
  issueText,
  normalizeImportRows,
  precheckImportFile,
  rowNotes,
  rowOutcome,
  templateUrl,
  validateUpload,
  emptyUploadDraft,
} from './imports';

const row = (patch: Partial<ProductImportRowResponse> = {}): ProductImportRowResponse => ({
  rowNo: 2,
  status: 'VALID',
  action: 'CREATE',
  sku: 'KEM-50',
  title: 'Kem dưỡng',
  errors: [],
  warnings: [],
  changes: [],
  cells: {},
  ...patch,
});

test('every row problem code has a Vietnamese and an English text, with the same placeholders', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const code of PRODUCT_IMPORT_ISSUE_CODES) {
    const vi = importDictionary('vi').issues[code];
    const en = importDictionary('en').issues[code];
    assert.ok(vi && en, code);
    assert.deepEqual(placeholders(vi), placeholders(en), code);
    assert.ok(!/khám/i.test(vi), `${code}: a spa, not a clinic`);
    assert.ok(vi.length <= 90, `${code} fits two lines of the notes column`);
  }
  assert.equal(
    Object.keys(importDictionary('vi').issues).length,
    PRODUCT_IMPORT_ISSUE_CODES.length,
    'no text without a code',
  );
});

test('a problem names the column exactly as the template shows it, in the chosen language', () => {
  const issue = { code: 'PRICE_INVALID', field: 'price' } as const;
  assert.equal(
    issueText(issue, 'CATALOG', 'vi'),
    'Cột "Giá bán (₫)" phải là số tiền nguyên lớn hơn 0.',
  );
  assert.equal(
    issueText(issue, 'CATALOG', 'en'),
    'Column "List price (VND)" must be a whole amount above 0.',
  );
  assert.equal(
    issueText({ code: 'SKU_DUPLICATE_IN_FILE', field: 'sku', params: { row: 7 } }, 'CATALOG', 'vi'),
    'Mã SKU trùng với dòng 7 của tệp.',
  );
  assert.equal(columnLabel('OPENING_STOCK', 'quantity', 'vi'), 'Số lượng');
  assert.equal(columnLabel('CATALOG', 'unknown_key', 'vi'), 'unknown_key');
  for (const kind of ['CATALOG', 'OPENING_STOCK'] as const) {
    for (const column of PRODUCT_IMPORT_COLUMNS[kind]) {
      assert.ok(!/khám/i.test(column.header.vi + column.note.vi));
    }
  }
});

test('row notes: errors, then warnings, then the columns an update changes', () => {
  const notes = rowNotes(
    row({
      status: 'INVALID',
      action: 'NONE',
      errors: [{ code: 'BRAND_NOT_FOUND', field: 'brand', params: { text: 'Hãng X' } }],
      warnings: [{ code: 'PRODUCT_NAME_EXISTS', field: 'name_vi' }],
    }),
    'CATALOG',
    'vi',
  );
  assert.deepEqual(
    notes.map((note) => note.tone),
    ['error', 'warning'],
  );
  assert.match(notes[0]!.text, /Hãng X/);
  const update = rowNotes(
    row({ action: 'UPDATE', changes: ['label_vi', 'price'] }),
    'CATALOG',
    'vi',
  );
  assert.equal(update[0]!.text, 'Sẽ đổi: Phân loại (VI), Giá bán (₫)');
  assert.equal(rowOutcome(row({ status: 'INVALID', action: 'NONE' })), 'INVALID');
  assert.equal(rowOutcome(row({ action: 'NONE' })), 'NONE');
});

test('rows filter by outcome and by SKU or name without accents', () => {
  const rows = [
    row({ rowNo: 2, sku: 'KEM-50', title: 'Kem dưỡng da' }),
    row({ rowNo: 3, sku: 'SRM-1', title: 'Tinh chất', status: 'INVALID', action: 'NONE' }),
  ];
  assert.deepEqual(filterImportRows(rows, 'all', '').length, 2);
  assert.deepEqual(
    filterImportRows(rows, 'invalid', '').map((r) => r.rowNo),
    [3],
  );
  assert.deepEqual(
    filterImportRows(rows, 'valid', '').map((r) => r.rowNo),
    [2],
  );
  assert.deepEqual(
    filterImportRows(rows, 'all', 'duong').map((r) => r.rowNo),
    [2],
  );
  assert.deepEqual(
    filterImportRows(rows, 'all', 'srm').map((r) => r.rowNo),
    [3],
  );
  assert.deepEqual(normalizeImportRows({ q: 'x', filter: 'weird', page: 0, pageSize: 7 }), {
    q: 'x',
    filter: 'all',
    page: 1,
    pageSize: 20,
  });
});

test('the upload form: kind and branch rules, file prechecks, template links', () => {
  assert.deepEqual(validateUpload(emptyUploadDraft()), { file: 'required' });
  assert.deepEqual(validateUpload({ ...emptyUploadDraft(), kind: 'OPENING_STOCK' }), {
    file: 'required',
    branchId: 'required',
  });
  assert.equal(precheckImportFile({ name: 'a.XLSX', size: 10 }, 100), null);
  assert.equal(precheckImportFile({ name: 'a.csv', size: 101 }, 100), 'size');
  assert.equal(precheckImportFile({ name: 'a.xls', size: 10 }, 100), 'type');
  assert.equal(precheckImportFile({ name: 'a.pdf', size: 10 }, 100), 'type');
  assert.equal(
    templateUrl('OPENING_STOCK', 'csv', 'en'),
    '/api/v1/product-imports/template?kind=OPENING_STOCK&format=csv&lang=en',
  );
});

test('the apply request always carries the version the person saw and an explicit skip choice', () => {
  const job = { rowVersion: 4, createCount: 3, updateCount: 2, invalidCount: 5 };
  assert.deepEqual(applyRequest(job, true), { expectedRowVersion: 4, skipInvalid: true });
  assert.deepEqual(applySummary(job), { entering: 5, create: 3, update: 2, skipped: 5 });
});

test('error texts: the file reasons, the import codes and the shared fallback', () => {
  const fallback = () => 'generic';
  const limits = { maxBytes: 5_000_000, maxRows: 2_000 };
  assert.match(
    importErrorText(new ApiError(422, 'IMPORT_FILE_INVALID', 'xls'), 'vi', fallback, limits),
    /\.xlsx/,
  );
  assert.match(
    importErrorText(
      new ApiError(422, 'IMPORT_FILE_INVALID', 'tooManyRows'),
      'vi',
      fallback,
      limits,
    ),
    /2\.000/,
  );
  assert.match(
    importErrorText(new ApiError(422, 'IMPORT_FILE_INVALID', 'encoding'), 'vi', fallback, limits),
    /CSV UTF-8/,
  );
  assert.equal(
    importErrorText(new ApiError(422, 'IMPORT_FILE_INVALID', 'missingSku'), 'vi', fallback, limits),
    'Tệp thiếu cột "Mã SKU". Hãy dùng tệp mẫu.',
  );
  assert.equal(
    importErrorText(new ApiError(409, 'IMPORT_PREVIEW_STALE', null), 'en', fallback),
    importDictionary('en').errors.IMPORT_PREVIEW_STALE,
  );
  assert.equal(
    importErrorText(new ApiError(409, 'CONFLICT', null), 'vi', fallback),
    importDictionary('vi').errors.conflict,
  );
  assert.equal(
    importErrorText(new ApiError(500, 'SERVICE_UNAVAILABLE', null), 'vi', fallback),
    'generic',
  );
  assert.equal(importErrorText(new Error('x'), 'vi', fallback), 'generic');
});
