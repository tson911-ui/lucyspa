import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCatalogRow,
  parseCount,
  parseDay,
  parseFlag,
  parseMoney,
  parseOpeningRow,
} from './import.parse.js';

const all = { prices: true, cost: true };
const none = { prices: false, cost: false };
const codes = (issues: { code: string; field?: string }[]) =>
  issues.map((entry) => `${entry.code}:${entry.field ?? ''}`);

test('amounts: whole VND in the ways people write them, never a fraction', () => {
  assert.equal(parseMoney('150000'), 150000n);
  assert.equal(parseMoney('150.000'), 150000n);
  assert.equal(parseMoney('1,250,000 ₫'), 1250000n);
  assert.equal(parseMoney('150000.0'), 150000n);
  assert.equal(parseMoney('150.00'), 150n);
  assert.equal(parseMoney('150000 VND'), 150000n);
  for (const bad of ['', '12.5', '1,5', '-3', 'abc', '1e6', '1'.repeat(19)]) {
    assert.equal(parseMoney(bad), null, bad);
  }
});

test('counts, yes/no words and dates', () => {
  assert.equal(parseCount('12'), 12);
  assert.equal(parseCount('12.0'), 12);
  assert.equal(parseCount('1.000'), 1000);
  assert.equal(parseCount('10.000'), 10000);
  assert.equal(parseCount('1,000'), 1000);
  assert.equal(parseCount('1.234.567'), 1234567);
  assert.equal(parseCount('12.000.000'), null);
  assert.equal(parseCount('1.00'), 1);
  assert.equal(parseCount('1.5'), null);
  assert.equal(parseCount('-1'), null);
  assert.equal(parseFlag(''), undefined);
  for (const yes of ['Có', 'co', 'YES', 'true', '1', 'x']) assert.equal(parseFlag(yes), true, yes);
  for (const no of ['Không', 'khong', 'No', 'false', '0']) assert.equal(parseFlag(no), false, no);
  assert.equal(parseFlag('maybe'), null);
  assert.equal(parseDay('2027-12-31'), '2027-12-31');
  assert.equal(parseDay('31/12/2027'), '2027-12-31');
  assert.equal(parseDay('1-2-2027'), '2027-02-01');
  for (const bad of ['2027-02-30', '31/02/2027', '12/31/2027', 'tomorrow', '2027/12/31']) {
    assert.equal(parseDay(bad), null, bad);
  }
});

test('a catalog row: blank cells are not given, values are normalized with the catalog rules', () => {
  const { values, issues } = parseCatalogRow(
    {
      sku: ' kem-50 ',
      product_key: 'kem',
      name_vi: 'Kem dưỡng',
      name_en: 'Cream',
      featured: 'Có',
      barcode: '8936000000017',
      low_stock_threshold: '5',
      sell_on_order: 'không',
      lead_time_min: '3',
      lead_time_max: '5',
      price: '250.000',
      cost: '120000',
      description_vi: '',
    },
    all,
  );
  assert.deepEqual(issues, []);
  assert.equal(values.sku, 'KEM-50');
  assert.equal(values.productKey, 'KEM');
  assert.equal(values.featured, true);
  assert.equal(values.sellOnOrder, false);
  assert.equal(values.price, 250000n);
  assert.equal(values.cost, 120000n);
  assert.equal(values.descriptionVi, undefined);
  assert.equal(values.leadTimeDaysMin, 3);
});

test('catalog row problems are codes that name the column', () => {
  const { issues } = parseCatalogRow(
    {
      sku: 'có dấu cách',
      featured: 'có lẽ',
      low_stock_threshold: '-2',
      sell_on_order: '?',
      lead_time_min: '0',
      lead_time_max: '5',
      price: '0',
      cost: 'free',
      barcode: 'a b',
    },
    all,
  );
  assert.deepEqual(codes(issues).sort(), [
    'BARCODE_INVALID:barcode',
    'COST_INVALID:cost',
    'FEATURED_INVALID:featured',
    'LEAD_TIME_INVALID:lead_time_min',
    'PRICE_INVALID:price',
    'SELL_ON_ORDER_INVALID:sell_on_order',
    'SKU_INVALID:sku',
    'THRESHOLD_INVALID:low_stock_threshold',
  ]);
  assert.deepEqual(codes(parseCatalogRow({ sku: '' }, all).issues), ['SKU_REQUIRED:sku']);
  assert.deepEqual(codes(parseCatalogRow({ sku: 'A', lead_time_min: '3' }, all).issues), [
    'LEAD_TIME_INVALID:lead_time_max',
  ]);
  assert.deepEqual(
    codes(parseCatalogRow({ sku: 'A', lead_time_min: '9', lead_time_max: '3' }, all).issues),
    ['LEAD_TIME_INVALID:lead_time_max'],
  );
});

test('a price or cost cell without the authority for it is refused, a blank one is not', () => {
  assert.deepEqual(
    codes(parseCatalogRow({ sku: 'A', price: '5000', cost: '100' }, none).issues).sort(),
    ['COST_NOT_ALLOWED:cost', 'PRICE_NOT_ALLOWED:price'],
  );
  assert.deepEqual(parseCatalogRow({ sku: 'A', price: '', cost: '' }, none).issues, []);
  assert.deepEqual(codes(parseOpeningRow({ sku: 'A', quantity: '2', cost: '9' }, none).issues), [
    'COST_NOT_ALLOWED:cost',
  ]);
});

test('an opening-stock row', () => {
  const ok = parseOpeningRow(
    { sku: 'a-1', quantity: '24', lot_code: 'L2610', expiry_date: '31/12/2027', cost: '1.000' },
    all,
  );
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.values, {
    sku: 'A-1',
    quantity: 24,
    lotCode: 'L2610',
    expiryDate: '2027-12-31',
    cost: 1000n,
  });
  assert.deepEqual(
    codes(
      parseOpeningRow(
        { sku: 'A', quantity: '0', expiry_date: '2027-13-01', lot_code: 'x'.repeat(65) },
        all,
      ).issues,
    ).sort(),
    ['EXPIRY_INVALID:expiry_date', 'LOT_CODE_INVALID:lot_code', 'QUANTITY_INVALID:quantity'],
  );
  assert.deepEqual(codes(parseOpeningRow({ sku: 'A', quantity: '' }, all).issues), [
    'QUANTITY_REQUIRED:quantity',
  ]);
});
