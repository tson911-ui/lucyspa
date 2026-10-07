import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_IMPORT_COLUMNS, type ProductImportKindName } from '@lucy-spa/contracts';
import { strFromU8, unzipSync } from 'fflate';
import { mapColumns, normalizeHeader, rowByColumn } from './columns.js';
import { readRows } from './spreadsheet.js';
import { buildTemplate } from './template.js';

const kinds: ProductImportKindName[] = ['CATALOG', 'OPENING_STOCK'];

test('the data sheet of a template holds the header only; examples live on the guide sheet', () => {
  for (const kind of kinds) {
    for (const language of ['vi', 'en'] as const) {
      const xlsx = buildTemplate(kind, 'xlsx', language);
      const rows = readRows(xlsx.bytes, xlsx.filename);
      assert.equal(rows.length, 1, 'a template row would be imported as real data');
      assert.deepEqual(
        rows[0]?.cells,
        PRODUCT_IMPORT_COLUMNS[kind].map((column) => column.header[language]),
      );
      const guide = strFromU8(unzipSync(xlsx.bytes)['xl/worksheets/sheet2.xml']!);
      assert.ok(guide.includes(PRODUCT_IMPORT_COLUMNS[kind][0]!.example));
      const csv = buildTemplate(kind, 'csv', language);
      assert.deepEqual([...csv.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.deepEqual(readRows(csv.bytes, csv.filename)[0]?.cells, rows[0]?.cells);
    }
  }
});

test('the SKU and barcode columns are formatted as text, and the sheet names are in the chosen language', () => {
  const xlsx = unzipSync(buildTemplate('CATALOG', 'xlsx', 'vi').bytes);
  const sheet = strFromU8(xlsx['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /<col min="1" max="1"[^>]*style="1"/);
  assert.match(sheet, /<col min="12" max="12"[^>]*style="1"/);
  assert.match(strFromU8(xlsx['xl/workbook.xml']!), /name="Dữ liệu"[^]*name="Hướng dẫn"/);
  assert.match(
    strFromU8(unzipSync(buildTemplate('CATALOG', 'xlsx', 'en').bytes)['xl/workbook.xml']!),
    /name="Data"/,
  );
});

test('every column is found by its Vietnamese header, its English header and its key, in any case or accent', () => {
  for (const kind of kinds) {
    for (const pick of [
      (c: (typeof PRODUCT_IMPORT_COLUMNS)[typeof kind][number]) => c.header.vi,
      (c: (typeof PRODUCT_IMPORT_COLUMNS)[typeof kind][number]) => c.header.en.toUpperCase(),
      (c: (typeof PRODUCT_IMPORT_COLUMNS)[typeof kind][number]) => c.key,
      (c: (typeof PRODUCT_IMPORT_COLUMNS)[typeof kind][number]) => `${c.header.vi} *`,
    ]) {
      const map = mapColumns(kind, PRODUCT_IMPORT_COLUMNS[kind].map(pick));
      assert.deepEqual(map.unknown, []);
      assert.deepEqual(map.missing, []);
      assert.deepEqual(
        Object.keys(map.index),
        PRODUCT_IMPORT_COLUMNS[kind].map((column) => column.key),
      );
    }
  }
  assert.equal(normalizeHeader('Giá bán (₫)'), 'giaban');
});

test('a header without its unit still matches, unless it would be ambiguous', () => {
  const map = mapColumns('CATALOG', ['SKU', 'Giá bán', 'Chờ tối thiểu', 'Phân loại']);
  assert.deepEqual(map.index, { sku: 0, price: 1, lead_time_min: 2 });
  assert.deepEqual(map.unknown, ['Phân loại']);
});

test('missing required columns, unknown headers and a repeated column are reported', () => {
  const map = mapColumns('OPENING_STOCK', ['Số lượng', 'Màu sắc', 'quantity', '']);
  assert.deepEqual(map.missing, ['sku']);
  assert.deepEqual(map.unknown, ['Màu sắc']);
  assert.deepEqual(map.duplicated, ['quantity']);
  assert.deepEqual(rowByColumn(map, ['5', 'x', '7']), { quantity: '5' });
});
