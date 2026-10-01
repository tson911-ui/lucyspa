import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  asPublicSlides,
  loadPublicSlides,
  MAX_VISIBLE_SLIDES,
  publicSlidesUrl,
  sliderSlidesOf,
  validSlideUrl,
} from './slider-core';

const image = (n = 1) => ({
  alt: `Ảnh ${n}`,
  width: 1920,
  height: 800,
  sources: [
    { url: `/api/v1/public/media/a${n}/md`, width: 960 },
    { url: `/api/v1/public/media/a${n}/lg`, width: 1920 },
  ],
});

const slide = (n: number, patch: Record<string, unknown> = {}) => ({
  id: `s${n}`,
  title: `Slide ${n}`,
  subtitle: null,
  linkLabel: null,
  linkUrl: null,
  image: image(n),
  mobileImage: null,
  ...patch,
});

test('the public slides request is anonymous and names the language', () => {
  assert.equal(publicSlidesUrl('vi'), '/api/v1/public/website/slides?locale=vi');
  assert.equal(publicSlidesUrl('en'), '/api/v1/public/website/slides?locale=en');
});

test('the link rule is the popup’s: an internal locale path or https, nothing else', () => {
  for (const ok of ['/vi', '/en/account/book', '/{locale}/x', 'https://example.com/a']) {
    assert.equal(validSlideUrl(ok), true, ok);
  }
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://x.com', '//evil.example']) {
    assert.equal(validSlideUrl(bad), false, bad);
  }
});

test('untrusted JSON becomes slides only when it is a list of slides with a picture from the public route', () => {
  assert.deepEqual(asPublicSlides(null), []);
  assert.deepEqual(asPublicSlides('x'), []);
  assert.deepEqual(asPublicSlides({}), []);
  assert.deepEqual(asPublicSlides({ items: 'x' }), []);
  const found = asPublicSlides({
    items: [
      slide(1, { linkLabel: 'Đặt lịch', linkUrl: '/vi/account/book', subtitle: 'Phụ đề' }),
      // No picture, a picture from another origin, no id: nothing to show.
      slide(2, { image: null }),
      slide(3, {
        image: { ...image(3), sources: [{ url: 'https://evil.example/x.png', width: 960 }] },
      }),
      slide(4, { id: '' }),
      'not a slide',
      null,
      // A link that breaks the rule, or has no label, is dropped; the slide stays.
      slide(5, { linkLabel: 'Go', linkUrl: 'javascript:alert(1)' }),
      slide(6, { linkLabel: null, linkUrl: '/vi' }),
      slide(7, { mobileImage: image(70) }),
    ],
  });
  assert.deepEqual(
    found.map((item) => item.id),
    ['s1', 's5', 's6', 's7'],
  );
  assert.equal(found[0]?.linkUrl, '/vi/account/book');
  assert.equal(found[0]?.linkLabel, 'Đặt lịch');
  assert.equal(found[0]?.subtitle, 'Phụ đề');
  assert.equal(found[1]?.linkUrl, null);
  assert.equal(found[1]?.linkLabel, null);
  assert.equal(found[2]?.linkUrl, null);
  assert.equal(found[3]?.mobileImage?.alt, 'Ảnh 70');
  assert.equal(found[0]?.mobileImage, null);
});

test('at most the visible limit is ever shown, in the order given', () => {
  const items = Array.from({ length: 12 }, (_, index) => slide(index + 1));
  const found = asPublicSlides({ items });
  assert.equal(found.length, MAX_VISIBLE_SLIDES);
  assert.equal(found[0]?.id, 's1');
  assert.equal(found[7]?.id, 's8');
});

test('the kit slider gets srcset, the slide description for both pictures, and a button only with label and link', () => {
  const [first, second] = sliderSlidesOf(
    asPublicSlides({
      items: [
        slide(1, { linkLabel: 'Đặt lịch', linkUrl: '/vi/account/book', mobileImage: image(9) }),
        slide(2, {
          image: { ...image(2), sources: [{ url: '/api/v1/public/media/b/md', width: 960 }] },
        }),
      ],
    }),
  );
  assert.equal(first?.image.src, '/api/v1/public/media/a1/md');
  assert.equal(
    first?.image.srcSet,
    '/api/v1/public/media/a1/md 960w, /api/v1/public/media/a1/lg 1920w',
  );
  assert.equal(first?.image.sizes, '100vw');
  assert.equal(first?.image.alt, 'Ảnh 1');
  assert.equal(first?.mobileImage?.alt, 'Ảnh 1', 'the phone picture shares the slide description');
  assert.equal(first?.mobileImage?.src, '/api/v1/public/media/a9/md');
  assert.deepEqual(first?.cta, { label: 'Đặt lịch', href: '/vi/account/book' });
  assert.equal(second?.image.srcSet, undefined, 'one rendition needs no srcset');
  assert.equal(second?.cta, null);
});

test('loading never blocks the page: any failure means no slides, requests carry no cookie', async () => {
  const calls: { url: string; init: { credentials: string; headers: Record<string, string> } }[] =
    [];
  const answer =
    (response: { ok: boolean; status?: number; json: () => Promise<unknown> }) =>
    (url: string, init: { credentials: 'omit'; headers: Record<string, string> }) => {
      calls.push({ url, init });
      return Promise.resolve({ status: 200, ...response });
    };
  const good = await loadPublicSlides(
    answer({ ok: true, json: () => Promise.resolve({ items: [slide(1)] }) }),
    'vi',
  );
  assert.equal(good.length, 1);
  assert.equal(calls[0]?.url, '/api/v1/public/website/slides?locale=vi');
  assert.equal(calls[0]?.init.credentials, 'omit');
  assert.deepEqual(
    await loadPublicSlides(
      answer({ ok: false, status: 500, json: () => Promise.resolve({}) }),
      'en',
    ),
    [],
  );
  assert.deepEqual(
    await loadPublicSlides(
      answer({ ok: true, json: () => Promise.reject(new Error('bad json')) }),
      'en',
    ),
    [],
  );
  assert.deepEqual(await loadPublicSlides(() => Promise.reject(new Error('offline')), 'vi'), []);
});
