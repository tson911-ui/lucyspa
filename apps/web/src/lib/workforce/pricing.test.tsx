import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PriceFields } from '../../components/workforce/screens/service-price-fields';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { formatServicePrice, priceProblem, type PriceForm } from './pricing';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const price = (min: string, max: string, unit: PriceForm['pricingUnit']): PriceForm => ({
  priceVnd: min,
  priceMaxVnd: max,
  pricingUnit: unit,
});

test('menu prices display as one amount when exact and a range otherwise', () => {
  assert.equal(formatServicePrice(price('40000', '40000', 'PER_SERVICE'), vi, 'vi'), '40.000 ₫');
  assert.equal(formatServicePrice(price('5000', '5000', 'PER_NAIL'), vi, 'vi'), '5.000 ₫/ngón');
  assert.equal(
    formatServicePrice(price('5000', '10000', 'PER_NAIL'), vi, 'vi'),
    '5.000–10.000 ₫/ngón',
  );
  assert.equal(
    formatServicePrice(price('5000', '30000', 'PER_NAIL'), vi, 'vi'),
    '5.000–30.000 ₫/ngón',
  );
  assert.equal(
    formatServicePrice(price('5000', '10000', 'PER_NAIL'), en, 'en'),
    '5,000–10,000 ₫/nail',
  );
  assert.equal(formatServicePrice(price('6000', '6000', 'PER_NAIL'), en, 'en'), '6,000 ₫/nail');
  assert.equal(formatServicePrice(price('40000', '40000', 'PER_SERVICE'), en, 'en'), '40,000 ₫');
  // Beyond Number.MAX_SAFE_INTEGER: grouping works on the string, never through floats.
  assert.equal(
    formatServicePrice(price('9007199254740993', '9007199254740993', 'PER_SERVICE'), vi, 'vi'),
    '9.007.199.254.740.993 ₫',
  );
});

test('the price form mirrors the API rule 0 <= min <= max in whole VND', () => {
  assert.equal(priceProblem(price('5000', '10000', 'PER_NAIL')), null);
  assert.equal(priceProblem(price('40000', '40000', 'PER_SERVICE')), null);
  assert.equal(priceProblem(price('0', '0', 'PER_SERVICE')), null);
  assert.equal(priceProblem(price('10000', '5000', 'PER_NAIL')), 'maxBeforeMin');
  // Compared as integers: "9" < "10" numerically although it sorts after it as text.
  assert.equal(priceProblem(price('9', '10', 'PER_NAIL')), null);
  for (const bad of ['', '-1', '5.000', '5000.5', '1e4', '05000']) {
    assert.equal(priceProblem(price(bad, '10000', 'PER_NAIL')), 'invalid', bad);
  }
});

test('the service form offers minimum, maximum and the pricing unit', () => {
  const render = (value: PriceForm) =>
    renderToStaticMarkup(
      <PriceFields idPrefix="svc" value={value} onChange={() => undefined} t={vi} locale="vi" />,
    );
  const markup = render(price('5000', '10000', 'PER_NAIL'));
  for (const label of [vi.services.priceMin, vi.services.priceMax, vi.services.pricingUnit]) {
    assert.ok(markup.includes(label), label);
  }
  assert.match(markup, /<option value="PER_SERVICE">Theo dịch vụ<\/option>/);
  assert.match(markup, /<option value="PER_NAIL" selected="">Theo ngón<\/option>/);
  assert.ok(markup.includes('5.000–10.000 ₫/ngón'), 'live preview of the displayed price');
  const reversed = render(price('10000', '5000', 'PER_NAIL'));
  assert.ok(reversed.includes(vi.services.priceMaxBeforeMin));
});
