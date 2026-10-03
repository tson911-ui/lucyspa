import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { groupOperatingHours, hotlineTel, parseShopInfoFields } from './shop-info.core.js';

const day = (
  isoWeekday: number,
  opens: number | null,
  closes: number | null,
  isClosed = false,
) => ({
  isoWeekday,
  isClosed,
  opensAtMinute: opens,
  closesAtMinute: closes,
});

const valid = {
  taglineVi: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
  taglineEn: 'Heartfelt Relaxation – Elevated Beauty',
  introVi: null,
  introEn: null,
  address: '04 Nguyễn Quang Bích, Đà Nẵng',
  hotline: '0934 936 101',
  mapUrl: null,
  hoursBranchId: null,
  heroMediaId: null,
};

const refused = (patch: object, field: string) =>
  assert.throws(
    () => parseShopInfoFields({ ...valid, ...patch } as typeof valid),
    (error: unknown) =>
      error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
  );

test('opening hours: equal days share one group, closed days form their own', () => {
  const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => day(weekday, 540, 1260));
  assert.deepEqual(groupOperatingHours(everyDay), [
    { weekdays: [1, 2, 3, 4, 5, 6, 7], closed: false, opensAt: '09:00', closesAt: '21:00' },
  ]);

  const mixed = [
    ...[1, 2, 3, 4, 5].map((weekday) => day(weekday, 540, 1260)),
    day(6, 600, 1200),
    day(7, null, null, true),
  ];
  assert.deepEqual(groupOperatingHours(mixed), [
    { weekdays: [1, 2, 3, 4, 5], closed: false, opensAt: '09:00', closesAt: '21:00' },
    { weekdays: [6], closed: false, opensAt: '10:00', closesAt: '20:00' },
    { weekdays: [7], closed: true, opensAt: null, closesAt: null },
  ]);
});

test('opening hours: a weekday with no row is closed, a gap in the week keeps its group', () => {
  const groups = groupOperatingHours([day(1, 540, 1260), day(3, 540, 1260)]);
  assert.deepEqual(groups[0], {
    weekdays: [1, 3],
    closed: false,
    opensAt: '09:00',
    closesAt: '21:00',
  });
  assert.deepEqual(groups[1], {
    weekdays: [2, 4, 5, 6, 7],
    closed: true,
    opensAt: null,
    closesAt: null,
  });
  assert.deepEqual(groupOperatingHours([]), [
    { weekdays: [1, 2, 3, 4, 5, 6, 7], closed: true, opensAt: null, closesAt: null },
  ]);
});

test('hotline link: a Vietnamese local number becomes +84, a plus number stays international', () => {
  assert.equal(hotlineTel('0934 936 101'), '+84934936101');
  assert.equal(hotlineTel('(0234) 3.822.100'), '+842343822100');
  assert.equal(hotlineTel('+84 934 936 101'), '+84934936101');
  assert.equal(hotlineTel('+1 (415) 555-0100'), '+14155550100');
});

test('shop info fields: text is normalized, the hotline and the map link are strict', () => {
  const parsed = parseShopInfoFields({
    ...valid,
    taglineVi: '  Thư   Giãn  ',
    mapUrl: 'https://maps.example.com/?q=Lucy+Spa',
    hoursBranchId: '0F6E0A52-2F0C-4A1B-9C55-1F4E2D6A7B8C',
  });
  assert.equal(parsed.taglineVi, 'Thư Giãn');
  assert.equal(parsed.hoursBranchId, '0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c');
  assert.equal(parseShopInfoFields({ ...valid, mapUrl: '  ' }).mapUrl, null);

  // The introduction is optional: empty or blank becomes null, text is normalized, 200 characters at most.
  assert.equal(parseShopInfoFields({ ...valid, introVi: '   ' }).introVi, null);
  assert.equal(parseShopInfoFields({ ...valid, introEn: '' }).introEn, null);
  assert.equal(parseShopInfoFields({ ...valid, introVi: '  Mở   cửa  ' }).introVi, 'Mở cửa');
  assert.equal(parseShopInfoFields({ ...valid, introEn: 'x'.repeat(200) }).introEn?.length, 200);
  refused({ introVi: 'x'.repeat(201) }, 'introVi');
  refused({ introEn: 'x'.repeat(201) }, 'introEn');
  refused({ introVi: 7 }, 'introVi');

  refused({ taglineVi: '' }, 'taglineVi');
  refused({ taglineEn: '   ' }, 'taglineEn');
  refused({ taglineVi: 'x'.repeat(121) }, 'taglineVi');
  refused({ address: '' }, 'address');
  refused({ address: 'a'.repeat(301) }, 'address');
  refused({ hotline: 'call us' }, 'hotline');
  refused({ hotline: '12345' }, 'hotline');
  refused({ hotline: '+84 (0) abc' }, 'hotline');
  refused({ hotline: null }, 'hotline');
  refused({ mapUrl: 'http://maps.example.com/x' }, 'mapUrl');
  refused({ mapUrl: 'javascript:alert(1)' }, 'mapUrl');
  refused({ mapUrl: '//evil.example/x' }, 'mapUrl');
  refused({ mapUrl: '/vi/account/book' }, 'mapUrl');
  refused({ mapUrl: 'https://user:pass@maps.example.com/' }, 'mapUrl');
  refused({ hoursBranchId: 'not-a-uuid' }, 'hoursBranchId');
  refused({ heroMediaId: 7 }, 'heroMediaId');
});
