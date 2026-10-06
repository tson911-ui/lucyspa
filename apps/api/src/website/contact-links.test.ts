import assert from 'node:assert/strict';
import test from 'node:test';
import { facebookPageLinks, zaloLink } from '@lucy-spa/contracts';
import { parseShopInfoFields } from './shop-info.core.js';
import { AuthError } from '../auth/auth.error.js';

// Owner request 2026-10-06: the Facebook page and Zalo links of the shop profile.

test('Facebook page: a page name, a name with its id, a numeric profile and the legacy forms give a page and a Messenger link', () => {
  const page = (text: string) => facebookPageLinks(text);
  assert.deepEqual(page('https://www.facebook.com/lucyspa.danang'), {
    pageUrl: 'https://www.facebook.com/lucyspa.danang',
    messengerUrl: 'https://m.me/lucyspa.danang',
  });
  assert.deepEqual(page('  https://facebook.com/lucyspa.danang/  '), {
    pageUrl: 'https://www.facebook.com/lucyspa.danang',
    messengerUrl: 'https://m.me/lucyspa.danang',
  });
  assert.deepEqual(page('https://m.facebook.com/lucyspa.danang/posts'), {
    pageUrl: 'https://www.facebook.com/lucyspa.danang',
    messengerUrl: 'https://m.me/lucyspa.danang',
  });
  // The numeric id appended to a page name is the stable handle.
  assert.equal(
    page('https://www.facebook.com/Lucy-Spa-Da-Nang-100063123456789')?.messengerUrl,
    'https://m.me/100063123456789',
  );
  assert.equal(
    page('https://www.facebook.com/profile.php?id=100063123456789')?.pageUrl,
    'https://www.facebook.com/profile.php?id=100063123456789',
  );
  assert.equal(
    page('https://www.facebook.com/pages/Lucy-Spa/100063123456789')?.messengerUrl,
    'https://m.me/100063123456789',
  );
  assert.equal(page('https://fb.com/lucyspa.danang')?.messengerUrl, 'https://m.me/lucyspa.danang');
});

test('Facebook page: anything that is not a page is refused', () => {
  for (const text of [
    '',
    'lucyspa',
    'www.facebook.com/lucyspa.danang',
    'http://www.facebook.com/lucyspa.danang',
    'https://example.com/lucyspa.danang',
    'https://facebook.com.evil.example/lucyspa.danang',
    'https://user:pw@facebook.com/lucyspa.danang',
    'https://www.facebook.com/',
    'https://www.facebook.com/sharer/sharer.php?u=x',
    'https://www.facebook.com/groups/12345678',
    'https://www.facebook.com/profile.php?id=abc',
    'https://www.facebook.com/abc',
    'https://www.facebook.com/lucyspa.danang/posts/123456789',
    `https://www.facebook.com/${'a'.repeat(300)}`,
    'javascript:alert(1)',
  ]) {
    assert.equal(facebookPageLinks(text), null, text);
  }
});

test('Zalo: a number (national or international) or a zalo.me link gives the zalo.me link; anything else is refused', () => {
  assert.equal(zaloLink('0934 936 101'), 'https://zalo.me/0934936101');
  assert.equal(zaloLink('+84 934.936.101'), 'https://zalo.me/84934936101');
  assert.equal(zaloLink('(0234) 3822-100'), 'https://zalo.me/02343822100');
  assert.equal(zaloLink('https://zalo.me/0934936101'), 'https://zalo.me/0934936101');
  assert.equal(zaloLink('https://www.zalo.me/lucyspa/?x=1'), 'https://zalo.me/lucyspa');
  assert.equal(zaloLink('https://zalo.me/s/abc123'), 'https://zalo.me/s/abc123');
  for (const text of [
    '',
    'zalo',
    '12345',
    '0934 936 10x',
    '+1234567890123456',
    'http://zalo.me/0934936101',
    'https://zalo.me.evil.example/0934936101',
    'https://zalo.me/',
    'https://example.com/0934936101',
    'zalo.me/0934936101',
  ]) {
    assert.equal(zaloLink(text), null, text);
  }
});

test('shop info fields: both contact links are optional, stored as typed, and refused when malformed', () => {
  const base = {
    taglineVi: 'Thư Giãn',
    taglineEn: 'Relax',
    introVi: null,
    introEn: null,
    address: '04 Nguyễn Quang Bích, Đà Nẵng',
    hotline: '0934 936 101',
    mapUrl: null,
    facebookUrl: null,
    zaloContact: null,
    hoursBranchId: null,
    heroMediaId: null,
    factsVisible: true,
    facts: [],
    featuredGroups: [],
    whyVisible: false,
    whyTitleVi: null,
    whyTitleEn: null,
    whyCards: [],
    footerBlocks: [],
  };
  const parsed = parseShopInfoFields({
    ...base,
    facebookUrl: '  https://www.facebook.com/lucyspa.danang  ',
    zaloContact: ' 0934   936 101 ',
  });
  assert.equal(parsed.facebookUrl, 'https://www.facebook.com/lucyspa.danang');
  assert.equal(parsed.zaloContact, '0934 936 101');
  assert.equal(
    parseShopInfoFields({ ...base, facebookUrl: '  ', zaloContact: '' }).facebookUrl,
    null,
  );
  const refused = (patch: object, field: string) =>
    assert.throws(
      () => parseShopInfoFields({ ...base, ...patch }),
      (error: unknown) =>
        error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
    );
  refused({ facebookUrl: 'https://example.com/x' }, 'facebookUrl');
  refused({ facebookUrl: 'facebook.com/lucyspa.danang' }, 'facebookUrl');
  refused({ zaloContact: 'abc' }, 'zaloContact');
  refused({ zaloContact: 'https://example.com/0934936101' }, 'zaloContact');
});
