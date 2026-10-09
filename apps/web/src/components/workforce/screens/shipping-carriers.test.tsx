import type { ShippingCarrierResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onlineFulfilmentDictionary } from '../../../i18n/online-fulfilment';
import { employee, owner, render } from '../../../test/support';
import { CarriersView, ShippingCarriersScreen } from './shipping-carriers';

const text = onlineFulfilmentDictionary('vi').carriers;
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const noop = () => Promise.resolve();

const carrier = (patch: Partial<ShippingCarrierResponse> = {}): ShippingCarrierResponse => ({
  id: 'c1',
  name: 'Giao Hàng Nhanh',
  trackingUrlTemplate: 'https://track.example.vn/?code={code}',
  isActive: true,
  rowVersion: 2,
  ...patch,
});

const view = (carriers: ShippingCarrierResponse[], locale: 'vi' | 'en' = 'vi') =>
  render(
    <CarriersView carriers={carriers} onChange={() => undefined} reload={noop} />,
    owner,
    locale,
  );

test('the page has one primary action, the list with its template and status, and a row menu', () => {
  const html = view([
    carrier(),
    carrier({ id: 'c2', name: 'Viettel Post', trackingUrlTemplate: null, isActive: false }),
  ]);
  assert.match(html, /<h1[^>]*>Đơn vị vận chuyển<\/h1>/);
  assert.equal((html.match(/ls-btn-primary/g) ?? []).length, 1);
  assert.match(html, /ls-btn-primary[^>]*>(?:<[^>]*>)*[^<]*Thêm đơn vị/);
  assert.match(html, /Giao Hàng Nhanh/);
  assert.match(html, /https:\/\/track\.example\.vn\/\?code=\{code\}/);
  assert.match(html, re(text.noTemplate));
  assert.match(html, re(text.active));
  assert.match(html, re(text.inactive));
  assert.match(html, /Thao tác với Viettel Post/);
  assert.doesNotMatch(html, /khám/i);
});

test('an empty list says that no carrier is invented', () => {
  assert.match(view([]), re(text.empty));
});

test('only a person with the global product permission may manage carriers', () => {
  const allowed = render(<ShippingCarriersScreen />, owner);
  assert.doesNotMatch(allowed, re(text.noAccess));
  const denied = render(<ShippingCarriersScreen />, employee([['MANAGE_PRODUCTS', 'A']]));
  assert.match(denied, re(text.noAccess));
  assert.doesNotMatch(denied, re(text.add));
});

test('English renders every text', () => {
  const html = view([carrier()], 'en');
  assert.match(html, /Add a carrier/);
  assert.match(html, /Tracking link/);
});
