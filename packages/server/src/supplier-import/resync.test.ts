import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentDiff,
  hasChanges,
  imageDiff,
  inOffHours,
  isScanDue,
  isSuspectCount,
  nextMissing,
  REMOVAL_AFTER_SCANS,
  returnedAfterRemoval,
  type StoredRecordView,
} from './resync.js';
import type { SourceProductRecord } from './woocommerce-store.js';

test('a scan is suspect below 70% of the last healthy scan, never without a baseline', () => {
  assert.equal(isSuspectCount(0, null), false, 'a first scan has no baseline');
  assert.equal(isSuspectCount(0, 0), false);
  assert.equal(isSuspectCount(14, 20), false, '70% exactly is healthy');
  assert.equal(isSuspectCount(13, 20), true);
  assert.equal(isSuspectCount(20, 20), false);
  assert.equal(isSuspectCount(0, 20), true, 'an empty answer is the typical outage');
  assert.equal(isSuspectCount(2, 3), true, '67% of 3 is below 70%');
});

test('a product is raised as removed once, at the third healthy scan in a row without it', () => {
  assert.equal(REMOVAL_AFTER_SCANS, 3);
  assert.deepEqual(nextMissing(0), { missingScans: 1, removed: false });
  assert.deepEqual(nextMissing(1), { missingScans: 2, removed: false });
  assert.deepEqual(nextMissing(2), { missingScans: 3, removed: true });
  assert.deepEqual(nextMissing(3), { missingScans: 4, removed: false });
  assert.equal(returnedAfterRemoval(2), false, 'seen again before it was raised: nothing to say');
  assert.equal(returnedAfterRemoval(3), true);
});

const stored: StoredRecordView = {
  name: 'Kem A',
  sku: 'KD-A',
  brandText: 'OHUI',
  categoryPath: ['Chăm sóc da'],
  descriptionText: 'Mô tả cũ',
  attributes: { 'Dung tích': ['50ml'] },
  imageUrls: ['https://x.test/a.png', 'https://x.test/b.png'],
};

const incoming = (patch: Partial<SourceProductRecord> = {}): SourceProductRecord =>
  ({
    name: 'Kem A',
    sku: 'KD-A',
    brandText: 'OHUI',
    categoryNames: ['Chăm sóc da'],
    descriptionText: 'Mô tả cũ',
    attributes: [{ name: 'Dung tích', values: ['50ml'] }],
    images: [{ url: 'https://x.test/a.png' }, { url: 'https://x.test/b.png' }],
    ...patch,
  }) as unknown as SourceProductRecord;

test('a content diff lists only the stored fields that differ, with short before and after', () => {
  assert.deepEqual(contentDiff(stored, incoming(), true).fields, []);
  const renamed = contentDiff(stored, incoming({ name: 'Kem A mới', sku: null }), true);
  assert.deepEqual(renamed.fields, ['name', 'sku']);
  assert.equal(renamed.before['name'], 'Kem A');
  assert.equal(renamed.after['name'], 'Kem A mới');
  assert.equal(renamed.after['sku'], null);
  const long = contentDiff(stored, incoming({ descriptionText: 'x'.repeat(1000) }), true);
  assert.deepEqual(long.fields, ['description']);
  assert.equal(String(long.after['description']).length, 301, 'clipped, never a whole page');
  const more = contentDiff(
    stored,
    incoming({ categoryNames: ['Chăm sóc da', 'Mặt nạ'], brandText: 'THE WHOO' }),
    true,
  );
  assert.deepEqual(more.fields, ['brand', 'categories']);
});

test('without permission for text only the name and the SKU are compared (nothing else is stored)', () => {
  const diff = contentDiff(
    { ...stored, brandText: null, categoryPath: [], descriptionText: null, attributes: {} },
    incoming({ descriptionText: 'Mô tả mới', brandText: 'OHUI' }),
    false,
  );
  assert.deepEqual(diff.fields, []);
});

test('a picture diff reports counts and which addresses came and went', () => {
  const diff = imageDiff(stored.imageUrls, ['https://x.test/b.png', 'https://x.test/c.png']);
  assert.deepEqual(diff, {
    before: 2,
    after: 2,
    added: ['https://x.test/c.png'],
    removed: ['https://x.test/a.png'],
  });
});

test('a notice is worth sending only when something changed', () => {
  const none = { created: 0, priceChanged: 0, contentChanged: 0, imageChanged: 0, removed: 0 };
  assert.equal(hasChanges(none), false);
  assert.equal(hasChanges({ ...none, removed: 1 }), true);
});

test('the schedule runs only in the off-hours window of Vietnam, never for MANUAL, and not before the cadence has passed', () => {
  // 02:30 in Vietnam is 19:30 UTC the day before.
  const night = new Date('2026-10-12T19:30:00Z');
  const noon = new Date('2026-10-12T05:00:00Z');
  assert.equal(inOffHours(night), true);
  assert.equal(inOffHours(noon), false);
  assert.equal(inOffHours(new Date('2026-10-12T17:59:00Z')), false, '00:59 is before the window');
  assert.equal(inOffHours(new Date('2026-10-12T18:00:00Z')), true, '01:00 opens the window');
  assert.equal(inOffHours(new Date('2026-10-12T22:00:00Z')), false, '05:00 closes it');
  assert.equal(isScanDue('MANUAL', null, night), false);
  assert.equal(isScanDue('WEEKLY', null, noon), false, 'daytime');
  assert.equal(isScanDue('WEEKLY', null, night), true);
  const day = 86_400_000;
  assert.equal(isScanDue('WEEKLY', new Date(night.getTime() - 3 * day), night), false);
  assert.equal(isScanDue('WEEKLY', new Date(night.getTime() - 6.5 * day), night), false);
  assert.equal(isScanDue('WEEKLY', new Date(night.getTime() - 7 * day), night), true);
  assert.equal(isScanDue('DAILY', new Date(night.getTime() - 0.5 * day), night), false);
  assert.equal(isScanDue('DAILY', new Date(night.getTime() - 1 * day), night), true);
});
