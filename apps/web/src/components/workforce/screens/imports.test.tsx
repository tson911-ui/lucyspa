import type {
  ProductImportDetailResponse,
  ProductImportListResponse,
  ProductImportRowResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importDictionary } from '../../../i18n/imports';
import { owner, render } from '../../../test/support';
import { ImportView } from './import-detail';
import { ImportsView } from './imports';

const text = importDictionary('vi');
const noop = () => Promise.resolve();

const job = (patch: Partial<ProductImportDetailResponse> = {}): ProductImportDetailResponse => ({
  id: 'job-1',
  kind: 'CATALOG',
  status: 'PREVIEWED',
  filename: 'san-pham.xlsx',
  branchId: null,
  branchName: null,
  rowCount: 3,
  validCount: 2,
  invalidCount: 1,
  createCount: 1,
  updateCount: 1,
  unchangedCount: 0,
  warnings: [{ code: 'UNKNOWN_COLUMN', params: { header: 'Màu' } }],
  columns: ['sku', 'name_vi'],
  failureMessage: null,
  createdByName: 'Chủ spa',
  createdAt: '2026-10-07T08:00:00.000Z',
  previewedAt: '2026-10-07T08:00:01.000Z',
  appliedByName: null,
  appliedAt: null,
  rowVersion: 2,
  canApply: true,
  rows: [
    row({ rowNo: 2, sku: 'KEM-50', title: 'Kem dưỡng', action: 'CREATE' }),
    row({ rowNo: 3, sku: 'SRM-1', title: 'Tinh chất', action: 'UPDATE', changes: ['label_vi'] }),
    row({
      rowNo: 4,
      sku: 'BAD',
      title: null,
      status: 'INVALID',
      action: 'NONE',
      errors: [{ code: 'BRAND_NOT_FOUND', field: 'brand', params: { text: 'Hãng Z' } }],
    }),
  ],
  ...patch,
});

function row(patch: Partial<ProductImportRowResponse>): ProductImportRowResponse {
  return {
    rowNo: 2,
    status: 'VALID',
    action: 'CREATE',
    sku: 'X',
    title: null,
    errors: [],
    warnings: [],
    changes: [],
    cells: {},
    ...patch,
  };
}

test('the preview lists every row with its result and its problem in words, and offers the one primary action', () => {
  const markup = render(<ImportView job={job()} reload={noop} />, owner);
  for (const sku of ['KEM-50', 'SRM-1', 'BAD']) assert.ok(markup.includes(sku), sku);
  assert.ok(markup.includes('Không có thương hiệu &quot;Hãng Z&quot;'), 'the error is a sentence');
  assert.ok(markup.includes('Sẽ đổi: Phân loại (VI)'), 'an update names its columns');
  assert.ok(markup.includes(text.detail.apply), 'the primary action');
  assert.ok(markup.includes('Bỏ qua cột &quot;Màu&quot;'), 'an unknown column is a warning');
  for (const result of ['Tạo mới', 'Cập nhật', 'Có lỗi']) assert.ok(markup.includes(result));
  assert.ok(!/khám/i.test(markup));
});

test('nothing to import: a notice instead of the primary action', () => {
  const none = render(
    <ImportView
      job={job({ canApply: false, validCount: 0, createCount: 0, updateCount: 0, invalidCount: 3 })}
      reload={noop}
    />,
    owner,
  );
  assert.ok(none.includes(text.detail.allInvalid));
  assert.ok(!none.includes(`>${text.detail.apply}<`));
  const unchanged = render(
    <ImportView
      job={job({ canApply: false, createCount: 0, updateCount: 0, invalidCount: 1 })}
      reload={noop}
    />,
    owner,
  );
  assert.ok(unchanged.includes(text.detail.nothing));
});

test('an applied import is history: a success notice, no action; a cancelled one says nothing was saved', () => {
  const applied = render(
    <ImportView
      job={job({
        status: 'APPLIED',
        canApply: false,
        appliedAt: '2026-10-07T09:00:00.000Z',
        appliedByName: 'Chủ spa',
      })}
      reload={noop}
    />,
    owner,
  );
  assert.ok(applied.includes('Đã nhập vào hệ thống lúc'));
  assert.ok(!applied.includes(`>${text.detail.apply}<`));
  assert.ok(!applied.includes(text.detail.cancel));
  const cancelled = render(
    <ImportView job={job({ status: 'CANCELLED', canApply: false })} reload={noop} />,
    owner,
  );
  assert.ok(cancelled.includes(text.detail.cancelled));
});

test('opening stock shows the quantity and the lot, the branch and no price or cost column', () => {
  const markup = render(
    <ImportView
      job={job({
        kind: 'OPENING_STOCK',
        branchId: 'b1',
        branchName: '04 Nguyễn Quang Bích',
        rows: [
          row({
            rowNo: 2,
            sku: 'KEM-50',
            cells: { quantity: '24', lot_code: 'L1', expiry_date: '2027-12-31' },
          }),
        ],
        rowCount: 1,
        invalidCount: 0,
      })}
      reload={noop}
    />,
    owner,
  );
  assert.ok(markup.includes('04 Nguyễn Quang Bích'));
  assert.ok(markup.includes('>24<'));
  assert.ok(markup.includes('L1 · 2027-12-31'));
  assert.ok(
    !markup.includes(text.detail.columns.name) || markup.includes(text.detail.columns.quantity),
  );
});

test('the list shows each import with its kind, status and valid rows, and the upload action', () => {
  const data: ProductImportListResponse = {
    jobs: [job(), job({ id: 'job-2', kind: 'OPENING_STOCK', branchName: 'Q1', status: 'APPLIED' })],
    branches: [{ id: 'b1', name: 'Q1' }],
    access: { prices: true, cost: false },
    limits: { maxBytes: 5_000_000, maxRows: 2_000 },
  };
  const markup = render(<ImportsView data={data} />, owner);
  assert.ok(markup.includes(text.upload));
  assert.ok(markup.includes('san-pham.xlsx'));
  assert.ok(markup.includes('2 / 3'));
  assert.ok(markup.includes(text.statuses.PREVIEWED));
  assert.ok(markup.includes(text.statuses.APPLIED));
  assert.ok(markup.includes(text.kinds.OPENING_STOCK));
  const empty = render(<ImportsView data={{ ...data, jobs: [] }} />, owner);
  assert.ok(empty.includes(text.list.empty));
});
