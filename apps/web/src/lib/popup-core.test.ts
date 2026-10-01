import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicPopupResponse } from '@lucy-spa/contracts';
import {
  asPublicPopup,
  loadPublicPopup,
  markSessionSeen,
  popupSeenKey,
  publicPopupContent,
  publicPopupUrl,
  sessionSeen,
  validPopupUrl,
  type PopupFetchResponse,
} from './popup-core';

const popup: PublicPopupResponse = {
  id: 'p-1',
  rowVersion: 3,
  title: 'Khuyến mãi Tết',
  body: 'Giảm 20%',
  ctaLabel: 'Đặt lịch',
  ctaUrl: '/vi/account/book',
  image: {
    alt: 'Ảnh khuyến mãi',
    width: 1920,
    height: 800,
    sources: [
      { url: '/api/v1/public/media/m-1/md', width: 960 },
      { url: '/api/v1/public/media/m-1/lg', width: 1920 },
    ],
  },
};

const answer = (status: number, body: unknown = null): PopupFetchResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
});

test('popup link rule: internal locale paths and https only, the same as the server', () => {
  for (const ok of [
    '/vi',
    '/en/account/book?x=1',
    '/{locale}/account/book',
    'https://example.com/a',
  ]) {
    assert.equal(validPopupUrl(ok), true, ok);
  }
  for (const bad of [
    '',
    'javascript:alert(1)',
    'data:text/html,x',
    'http://example.com',
    '//evil.example',
    '/vimeo',
    '/vi/a b',
    'https://user:pw@example.com',
    `https://example.com/${'a'.repeat(500)}`,
  ]) {
    assert.equal(validPopupUrl(bad), false, bad);
  }
});

test('the "seen" key names the popup and its version, so an edit shows it again (Q-CM4)', () => {
  assert.equal(popupSeenKey(popup), 'ls-popup-seen:p-1:3');
  assert.notEqual(popupSeenKey(popup), popupSeenKey({ ...popup, rowVersion: 4 }));
  assert.equal(publicPopupUrl('en'), '/api/v1/public/website/popup?locale=en');
});

test('popup card: the image carries its size and a srcset of the public renditions', () => {
  const card = publicPopupContent(popup);
  assert.equal(card.title, 'Khuyến mãi Tết');
  assert.deepEqual(card.cta, { label: 'Đặt lịch', href: '/vi/account/book' });
  assert.equal(card.image?.src, '/api/v1/public/media/m-1/md');
  assert.equal(
    card.image?.srcSet,
    '/api/v1/public/media/m-1/md 960w, /api/v1/public/media/m-1/lg 1920w',
  );
  assert.ok(card.image?.sizes);
  assert.deepEqual([card.image?.width, card.image?.height], [1920, 800]);
  // One rendition: no srcset, no sizes.
  const single = publicPopupContent({
    ...popup,
    image: { ...popup.image!, sources: [{ url: '/api/v1/public/media/m-1/md', width: 8 }] },
  });
  assert.equal(single.image?.srcSet, undefined);
  assert.equal(single.image?.sizes, undefined);
  // A text-only popup has no image and no button without a link.
  const text = publicPopupContent({ ...popup, image: null, ctaLabel: null, ctaUrl: null });
  assert.equal(text.image, null);
  assert.equal(text.cta, null);
});

test('an untrusted answer becomes a popup only if it is shaped like one and points at our own routes', () => {
  assert.deepEqual(asPublicPopup(JSON.parse(JSON.stringify(popup))), popup);
  for (const bad of [null, 'x', 5, [], {}, { id: 'p' }, { id: 'p', rowVersion: 1.5 }]) {
    assert.equal(asPublicPopup(bad), null, JSON.stringify(bad));
  }
  // Neither image nor title: nothing to show.
  assert.equal(asPublicPopup({ id: 'p', rowVersion: 1, title: null, image: null }), null);
  // An image on another origin or route is dropped, not shown.
  const foreign = asPublicPopup({
    ...popup,
    image: { ...popup.image, sources: [{ url: 'https://evil.example/x.png', width: 960 }] },
  });
  assert.equal(foreign?.image, null);
  // A link that breaks the rule is dropped together with its label.
  const link = asPublicPopup({ ...popup, ctaUrl: 'javascript:alert(1)' });
  assert.deepEqual([link?.ctaUrl, link?.ctaLabel], [null, null]);
  assert.equal(asPublicPopup({ ...popup, ctaLabel: null })?.ctaUrl, null);
  // Only strings are text.
  assert.equal(asPublicPopup({ ...popup, title: 5, image: null }), null);
});

test('loading: 204, errors, a bad body and an already-seen popup all mean "no popup"', async () => {
  const seen = new Set<string>();
  const calls: { url: string; credentials: string }[] = [];
  const load = (response: PopupFetchResponse | Error) =>
    loadPublicPopup(
      (url, init) => {
        calls.push({ url, credentials: init.credentials });
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      },
      'vi',
      (key) => seen.has(key),
    );
  assert.deepEqual(await load(answer(200, popup)), popup);
  assert.deepEqual(calls[0], {
    url: '/api/v1/public/website/popup?locale=vi',
    credentials: 'omit',
  });
  assert.equal(await load(answer(204)), null);
  assert.equal(await load(answer(500)), null);
  assert.equal(await load(answer(200, { nonsense: true })), null);
  assert.equal(await load(new Error('offline')), null);
  assert.equal(
    await load({ status: 200, ok: true, json: () => Promise.reject(new Error('not json')) }),
    null,
  );
  seen.add(popupSeenKey(popup));
  assert.equal(await load(answer(200, popup)), null, 'seen in this browser session');
  seen.clear();
  seen.add(popupSeenKey({ ...popup, rowVersion: 2 }));
  assert.deepEqual(
    await load(answer(200, popup)),
    popup,
    'an older version was seen, not this one',
  );
});

test('session memory: works, and a blocked or full storage never breaks the page', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.equal(sessionSeen(storage)('k'), false);
  markSessionSeen(storage, 'k');
  assert.equal(sessionSeen(storage)('k'), true);
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  assert.equal(sessionSeen(blocked)('k'), false, 'unreadable storage: show the popup');
  assert.doesNotThrow(() => markSessionSeen(blocked, 'k'));
  assert.equal(sessionSeen(null)('k'), false);
  assert.doesNotThrow(() => markSessionSeen(null, 'k'));
});
