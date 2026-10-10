import type { SupplierSourceItem, SupplierSourceTestItem } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supplierSourcesDictionary } from '../../../i18n/supplier-sources';
import { canRunTest, statusTone } from '../../../lib/workforce/supplier-sources';
import { owner, render } from '../../../test/support';
import { LatestRun } from './supplier-source-test';

const text = supplierSourcesDictionary('vi');
const copy = text.test;
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

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
    givenBy: 'Chị Hà',
    method: 'Zalo',
    date: '2026-10-01',
    note: null,
    permitsText: true,
    permitsImages: true,
    permitsPrices: false,
    confirmedAt: '2026-10-02T03:00:00.000Z',
    confirmedBy: { id: 'u1', name: 'Chủ' },
  },
  gaps: ['TEST_REQUIRED'],
  lastSuccessAt: null,
  rowVersion: 4,
  createdAt: '2026-10-10T03:00:00.000Z',
  ...patch,
});

const run = (patch: Partial<SupplierSourceTestItem> = {}): SupplierSourceTestItem => ({
  id: 't1',
  status: 'PASSED',
  baseUrl: 'https://haruohui.com/',
  requestedAt: '2026-10-11T03:00:00.000Z',
  requestedBy: { id: 'u1', name: 'Chủ' },
  startedAt: '2026-10-11T03:00:01.000Z',
  finishedAt: '2026-10-11T03:00:04.000Z',
  failure: null,
  summary: {
    total: 352,
    sampled: 20,
    usable: 20,
    withSku: 7,
    withPrice: 20,
    withImages: 19,
    withCategory: 20,
    withDescription: 20,
    robots: 'ALLOWED',
    crawlDelaySeconds: null,
  },
  sample: [
    {
      key: '101',
      name: 'Kem dưỡng ẩm A',
      sku: 'KD-101',
      url: 'https://haruohui.com/san-pham/kem-a/',
      type: 'simple',
      brandText: null,
      categoryNames: ['Chăm sóc da'],
      priceVnd: 350_000,
      promoPriceVnd: 280_000,
      currency: 'VND',
      imageCount: 1,
      firstImageUrl: 'https://haruohui.com/wp-content/uploads/a.jpg',
      descriptionLength: 200,
      variationCount: 0,
      problems: [],
    },
    {
      key: '102',
      name: 'Serum B',
      sku: null,
      url: 'https://haruohui.com/san-pham/serum-b/',
      type: 'simple',
      brandText: null,
      categoryNames: [],
      priceVnd: 500_000,
      promoPriceVnd: null,
      currency: 'VND',
      imageCount: 0,
      firstImageUrl: null,
      descriptionLength: 0,
      variationCount: 0,
      problems: ['SKU_MISSING', 'IMAGE_MISSING'],
    },
  ],
  problems: [
    { code: 'SKU_MISSING', count: 13, keys: ['102'] },
    { code: 'IMAGE_MISSING', count: 1, keys: ['102'] },
  ],
  requestCount: 2,
  confirmedAt: null,
  confirmedBy: null,
  canConfirm: true,
  ...patch,
});

const show = (
  test: SupplierSourceTestItem,
  options: { pricesVisible?: boolean; item?: SupplierSourceItem; locale?: 'vi' | 'en' } = {},
) =>
  render(
    <LatestRun
      item={options.item ?? source()}
      test={test}
      pricesVisible={options.pricesVisible ?? true}
    />,
    owner,
    options.locale ?? 'vi',
  );

test('a passed run shows the notice, the totals, the problems and the sample with source links', () => {
  const html = show(run());
  assert.match(html, /Đạt. Hãy xem mẫu bên dưới./);
  assert.match(html, /352/);
  assert.match(html, /7\/20/);
  assert.match(html, re(copy.summary.robotsAllowed));
  assert.match(html, re('Không có mã SKU (sẽ dùng HARU-mã sản phẩm)'));
  assert.match(html, re(fill13(copy.problemCount)));
  assert.match(html, /Kem dưỡng ẩm A/);
  assert.match(html, /href="https:\/\/haruohui\.com\/san-pham\/kem-a\/"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /KD-101/);
  assert.match(html, re(copy.noSku));
  assert.match(html, re(text.statuses.PENDING_VALIDATION));
  assert.doesNotMatch(html, /khám/i);
});

const fill13 = (template: string) => template.replace('{count}', '13');

test('supplier prices are drawn only when the server sent them, with the matching note', () => {
  const withPrices = show(run(), { pricesVisible: true });
  assert.match(withPrices, /350\.000/);
  assert.match(withPrices, re(copy.columns.price));
  assert.match(withPrices, re(copy.pricesNote));
  const stripped = run({
    sample: run().sample.map((entry) => {
      const copy = { ...entry };
      delete copy.priceVnd;
      delete copy.promoPriceVnd;
      return copy;
    }),
  });
  const without = show(stripped, { pricesVisible: false });
  assert.doesNotMatch(without, /350\.000/);
  assert.doesNotMatch(without, /500\.000/);
  assert.doesNotMatch(without, re(copy.columns.price));
  assert.doesNotMatch(without, re(copy.summary.withPrice));
  assert.match(without, re(copy.pricesHidden));
});

test('queued, running, failed, confirmed and outdated each say what they are', () => {
  assert.match(
    show(run({ status: 'QUEUED', summary: null, sample: [], problems: [], canConfirm: false })),
    re(copy.queued),
  );
  assert.match(
    show(run({ status: 'RUNNING', summary: null, sample: [], problems: [], canConfirm: false })),
    re(copy.running),
  );
  const failed = show(
    run({
      status: 'FAILED',
      summary: null,
      sample: [],
      problems: [],
      canConfirm: false,
      failure: {
        code: 'AUTHENTICATION_REQUIRED',
        detail: '403',
        sourceStatus: 'AUTHENTICATION_REQUIRED',
      },
    }),
  );
  assert.match(failed, re(copy.failedTitle));
  assert.match(failed, re(copy.failures.AUTHENTICATION_REQUIRED));
  const confirmed = show(
    run({
      canConfirm: false,
      confirmedAt: '2026-10-11T04:00:00.000Z',
      confirmedBy: { id: 'u1', name: 'Chủ' },
    }),
  );
  assert.match(confirmed, /Mẫu đã được Chủ xác nhận/);
  assert.match(show(run({ canConfirm: false })), re(copy.outdated));
});

test('every failure the server or the worker can record has plain words in both languages', () => {
  const codes = [
    'AUTHENTICATION_REQUIRED',
    'CHALLENGE_PAGE',
    'API_NOT_FOUND',
    'NOT_JSON',
    'UNEXPECTED_SHAPE',
    'UNEXPECTED_STATUS',
    'RATE_LIMITED',
    'SERVER_ERROR',
    'CONNECTION',
    'ROBOTS_DISALLOWED',
    'ROBOTS_UNAVAILABLE',
    'EMPTY',
    'TOO_FEW_USABLE',
    'TOO_FEW_PRICES',
    'TOO_FEW_IMAGES',
    'WORKER_LOST',
    'PERMISSION_CHANGED',
    'ADDRESS_CHANGED',
  ];
  const problemCodes = [
    'SKU_MISSING',
    'SKU_TOO_LONG',
    'IMAGE_MISSING',
    'IMAGE_OFF_HOST',
    'PRICE_MISSING',
    'PRICE_INVALID',
    'PRICE_NOT_WHOLE_VND',
    'CURRENCY_NOT_VND',
    'CATEGORY_MISSING',
    'DESCRIPTION_EMPTY',
    'NAME_MISSING',
    'URL_MISSING',
    'URL_OFF_HOST',
    'INVALID_PRODUCT',
    'DUPLICATE_KEY',
  ];
  for (const locale of ['vi', 'en'] as const) {
    const dictionary = supplierSourcesDictionary(locale).test;
    for (const code of codes) {
      assert.ok((dictionary.failures as Record<string, string>)[code], `${locale} failure ${code}`);
    }
    for (const code of problemCodes) {
      assert.ok((dictionary.problems as Record<string, string>)[code], `${locale} problem ${code}`);
    }
  }
});

test('English renders the run in English', () => {
  const html = show(run(), { locale: 'en' });
  assert.match(html, /Source price/);
  assert.match(html, /Look at the sample below/);
  assert.doesNotMatch(html, /Sản phẩm trên website/);
});

test('a test may run only after the permission is confirmed, on an address, and never twice at once', () => {
  assert.equal(canRunTest(source(), null), true);
  assert.equal(canRunTest(source(), run()), true);
  assert.equal(canRunTest(source(), run({ status: 'QUEUED' })), false);
  assert.equal(canRunTest(source(), run({ status: 'RUNNING' })), false);
  assert.equal(
    canRunTest(source({ gaps: ['PERMISSION_CONFIRMATION', 'TEST_REQUIRED'] }), null),
    false,
  );
  assert.equal(canRunTest(source({ kind: 'FILE', baseUrl: null }), null), false);
});

test('the status badge tone: ready is good, untested is neutral, faults need attention', () => {
  assert.equal(statusTone('READY'), 'success');
  assert.equal(statusTone('PENDING_VALIDATION'), 'neutral');
  assert.equal(statusTone('SOURCE_ERROR'), 'error');
  assert.equal(statusTone('ADAPTER_REQUIRED'), 'warning');
  assert.equal(statusTone('AUTHENTICATION_REQUIRED'), 'warning');
});
