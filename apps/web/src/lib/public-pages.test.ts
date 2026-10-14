import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RESERVED_PAGE_SLUGS, validPageSlug } from '@lucy-spa/contracts';
import { fetchPublicPage, fetchPublicPageIndex } from './public-site';
import { parsePublicPage, parsePublicPageIndex, parsePublicSite } from './public-site-core';
import { pageLead, sitemapEntries } from './seo-core';

const appDir = fileURLToPath(new URL('../app/[locale]', import.meta.url));

/** The first segment of every route under the language: route groups `(x)` are transparent, dynamic segments `[x]` are not names. */
function topSegments(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => statSync(path.join(directory, name)).isDirectory())
    .flatMap((name) => {
      if (name.startsWith('(')) return topSegments(path.join(directory, name));
      return name.startsWith('[') ? [] : [name];
    });
}

test('an information page can never take the name of a route the site already answers', () => {
  const routes = topSegments(appDir);
  // The walk really found the site (a wrong folder would pass an empty list).
  for (const known of [
    'services',
    'products',
    'account',
    'workforce',
    'ticket',
    'contact',
    'cart',
    'checkout',
  ]) {
    assert.ok(routes.includes(known), `the walk did not find /${known}`);
  }
  for (const route of routes) {
    assert.ok(
      RESERVED_PAGE_SLUGS.includes(route),
      `/${route} is a route of the site: add "${route}" to RESERVED_PAGE_SLUGS (packages/contracts/src/website-page.ts)`,
    );
    assert.equal(validPageSlug(route), false, route);
  }
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const answer = {
  slug: 'chinh-sach-bao-mat',
  role: 'PRIVACY',
  title: 'Chính sách bảo mật',
  body: '## Dữ liệu\n\nChúng tôi giữ dữ liệu an toàn.',
  language: 'vi',
  seoTitle: null,
  seoDescription: 'Mô tả',
  updatedAt: '2026-10-14T03:00:00.000Z',
};

test('a page read: the page, "missing" only when the API says there is no such published page, null when it could not be read', async () => {
  const calls: string[] = [];
  const reply = (response: () => Response | Promise<Response>) =>
    ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(response());
    }) as typeof fetch;
  const page = await fetchPublicPage(
    'en',
    'chinh-sach-bao-mat',
    reply(() => json(200, answer)),
  );
  assert.equal(page !== 'missing' && page?.title, 'Chính sách bảo mật');
  assert.match(calls[0] ?? '', /\/api\/v1\/public\/pages\/chinh-sach-bao-mat\?locale=en$/);
  assert.equal(
    await fetchPublicPage(
      'vi',
      'khong-co',
      reply(() => json(404, { code: 'NOT_FOUND' })),
    ),
    'missing',
  );
  // An unreachable or failing API is never a 404 (the page shows the error, not a remembered "not found").
  assert.equal(
    await fetchPublicPage(
      'vi',
      'a',
      reply(() => json(500, {})),
    ),
    null,
  );
  assert.equal(
    await fetchPublicPage(
      'vi',
      'a',
      reply(() => json(503, {})),
    ),
    null,
  );
  assert.equal(
    await fetchPublicPage('vi', 'a', (() => Promise.reject(new Error('down'))) as typeof fetch),
    null,
  );
  assert.equal(
    await fetchPublicPage(
      'vi',
      'a',
      reply(() => json(200, { nonsense: true })),
    ),
    null,
  );
  // An address that cannot be a page is missing without asking the API.
  const before = calls.length;
  for (const slug of ['', 'Co-Hoa', 'a b', 'a/b', '../x', '..', 'a'.repeat(81), 'a--b']) {
    assert.equal(
      await fetchPublicPage(
        'vi',
        slug,
        reply(() => json(200, answer)),
      ),
      'missing',
      slug,
    );
  }
  assert.equal(calls.length, before);
});

test('the page index for the sitemap: the pages, or nothing when it cannot be read', async () => {
  const ok = (() =>
    Promise.resolve(
      json(200, {
        items: [
          { slug: 'gioi-thieu', updatedAt: '2026-10-14T03:00:00.000Z', englishAvailable: true },
          { slug: 'bao-hanh', updatedAt: '2026-10-14T03:00:00.000Z', englishAvailable: false },
        ],
      }),
    )) as typeof fetch;
  assert.deepEqual(
    (await fetchPublicPageIndex(ok)).map((item) => [item.slug, item.englishAvailable]),
    [
      ['gioi-thieu', true],
      ['bao-hanh', false],
    ],
  );
  assert.deepEqual(
    await fetchPublicPageIndex((() => Promise.resolve(json(500, {}))) as typeof fetch),
    [],
  );
  assert.equal(parsePublicPageIndex({ items: [{ slug: 'Bad Slug', updatedAt: 'x' }] }), null);
  assert.equal(parsePublicPageIndex('x'), null);
});

test('the page answer is checked before the page trusts it', () => {
  assert.equal(parsePublicPage(answer)?.title, 'Chính sách bảo mật');
  for (const bad of [
    null,
    'x',
    { ...answer, role: 'ADMIN' },
    { ...answer, language: 'fr' },
    { ...answer, body: 5 },
    { ...answer, seoTitle: 5 },
    { ...answer, updatedAt: undefined },
  ]) {
    assert.equal(parsePublicPage(bad), null, JSON.stringify(bad));
  }
});

test('the shop profile: the footer links are read, a bad entry is left out, an older API without them reads as none', () => {
  const base = {
    tagline: 'T',
    footerBlocks: [],
    facts: [],
    featuredGroups: [],
    why: null,
    address: 'A',
    hotline: '0934',
    hotlineTel: '+84934936101',
    mapUrl: null,
    timezone: 'Asia/Ho_Chi_Minh',
    hours: [],
    heroImage: null,
  };
  const withPages = parsePublicSite({
    ...base,
    pages: [
      { slug: 'doi-tra', title: 'Đổi trả', role: 'POLICY' },
      { slug: 'Bad Slug', title: 'x', role: 'POLICY' },
      { slug: 'khac', title: '   ', role: 'POLICY' },
      { slug: 'la', title: 'x', role: 'ADMIN' },
      'x',
    ],
  });
  assert.deepEqual(withPages?.pages, [{ slug: 'doi-tra', title: 'Đổi trả', role: 'POLICY' }]);
  assert.deepEqual(parsePublicSite(base)?.pages, []);
  assert.deepEqual(parsePublicSite({ ...base, pages: 'x' })?.pages, []);
});

test('a page without a search description is described by its first paragraph', () => {
  assert.equal(pageLead('## Mục\n\nĐoạn **đầu** tiên.\n\nĐoạn hai.'), 'Đoạn đầu tiên.');
  assert.equal(pageLead('## Chỉ có mục\n\n- a'), null);
  assert.equal(pageLead('<b>sai</b>'), null);
});

test('the sitemap lists a published page once per language it has', () => {
  const urls = sitemapEntries('https://lucyspa.vn', [], [], false, [
    { code: 'bao-hanh', english: false },
  ]).map((entry) => entry.url);
  assert.ok(urls.includes('https://lucyspa.vn/vi/bao-hanh'));
  assert.ok(!urls.includes('https://lucyspa.vn/en/bao-hanh'));
});
