import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebsiteShopInfoResponse } from '@lucy-spa/contracts';
import {
  formOfShopInfo,
  shopInfoChanged,
  shopInfoInputOf,
  shopInfoRequest,
  shopInfoServerProblem,
  type ShopInfoForm,
} from './shop-info';

const response: WebsiteShopInfoResponse = {
  taglineVi: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  taglineEn: 'Heartfelt Relaxation – Elevated Beauty',
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  mapUrl: null,
  hoursBranchId: null,
  heroMediaId: null,
  rowVersion: 3,
  updatedAt: '2026-10-03T00:00:00.000Z',
  branches: [],
  hoursBranch: null,
  hours: [],
  timezone: null,
};

const base = formOfShopInfo(response);
const problem = (patch: Partial<ShopInfoForm>) => {
  const result = shopInfoInputOf({ ...base, ...patch });
  return 'problem' in result ? result.problem : null;
};

test('the form mirrors the stored profile and sends null for what is empty', () => {
  assert.equal(base.mapUrl, '');
  assert.equal(base.hoursBranchId, '');
  const result = shopInfoInputOf(base);
  assert.ok('body' in result);
  assert.deepEqual(result.body, {
    taglineVi: response.taglineVi,
    taglineEn: response.taglineEn,
    address: response.address,
    hotline: '0934 936 101',
    mapUrl: null,
    hoursBranchId: null,
    heroMediaId: null,
  });
  assert.deepEqual(shopInfoRequest(result.body, 3), { ...result.body, expectedVersion: 3 });
});

test('text is trimmed and collapsed, the optional link and branch are sent when set', () => {
  const result = shopInfoInputOf({
    ...base,
    taglineVi: '  Thư   Giãn ',
    mapUrl: ' https://maps.example.com/?q=Lucy+Spa ',
    hoursBranchId: 'b1',
    heroMediaId: 'm1',
  });
  assert.ok('body' in result);
  assert.equal(result.body.taglineVi, 'Thư Giãn');
  assert.equal(result.body.mapUrl, 'https://maps.example.com/?q=Lucy+Spa');
  assert.equal(result.body.hoursBranchId, 'b1');
  assert.equal(result.body.heroMediaId, 'm1');
});

test('the first invalid field is named', () => {
  assert.equal(problem({ taglineVi: '  ' }), 'taglineVi');
  assert.equal(problem({ taglineEn: 'x'.repeat(121) }), 'taglineEn');
  assert.equal(problem({ address: '' }), 'address');
  assert.equal(problem({ hotline: 'call us' }), 'hotline');
  assert.equal(problem({ hotline: '12345' }), 'hotline');
  assert.equal(problem({ mapUrl: 'http://maps.example.com' }), 'mapUrl');
  assert.equal(problem({ mapUrl: 'https://' }), 'mapUrl');
  assert.equal(problem({ taglineVi: '', address: '' }), 'taglineVi');
});

test('changed ignores whitespace-only edits', () => {
  assert.equal(shopInfoChanged(base, { ...base, address: `  ${base.address}  ` }), false);
  assert.equal(shopInfoChanged(base, { ...base, hotline: '0934 936 102' }), true);
  assert.equal(shopInfoChanged(base, { ...base, heroMediaId: 'm1' }), true);
});

test('server refusals map to a field', () => {
  assert.equal(shopInfoServerProblem({ code: 'VALIDATION_FAILED', field: 'hotline' }), 'hotline');
  assert.equal(
    shopInfoServerProblem({ code: 'MEDIA_ALT_REQUIRED', field: 'heroMediaId' }),
    'heroMediaId',
  );
  assert.equal(
    shopInfoServerProblem({ code: 'VALIDATION_FAILED', field: 'expectedVersion' }),
    null,
  );
  assert.equal(shopInfoServerProblem({ code: 'CONFLICT' }), null);
  assert.equal(shopInfoServerProblem(new Error('x')), null);
  assert.equal(shopInfoServerProblem(null), null);
});
