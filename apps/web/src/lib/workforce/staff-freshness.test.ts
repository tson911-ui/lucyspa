import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { json } from '../../test/support';
import { WorkforceApi } from './api';

// Staff data must never look old (bookings, POS, invoices, schedules). The navigation can be prefetched and animated
// because a staff page is only its code: every number is fetched from the API when the page opens. These tests pin the
// pieces that keep that true.
const src = join(import.meta.dirname, '..', '..');

const filesUnder = (directory: string, pattern: RegExp): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return filesUnder(path, pattern);
    return pattern.test(name) ? [path] : [];
  });

test('every staff read bypasses the browser and router caches (cache: no-store, fresh on each page open)', async () => {
  const seen: Array<RequestInit | undefined> = [];
  const fetcher: typeof fetch = (_input, init) => {
    seen.push(init);
    return Promise.resolve(json(200, { items: [] }));
  };
  await new WorkforceApi({ fetch: fetcher }).get('/api/v1/bookings');
  assert.equal(seen[0]?.cache, 'no-store');
});

test('a staff route holds no server-side data: nothing a prefetch or the router cache could keep old', () => {
  const routes = filesUnder(
    join(src, 'app', '[locale]', 'workforce'),
    /^(page|layout|template|loading)\.tsx$/,
  );
  assert.ok(routes.length > 20, 'the routes were found');
  for (const file of routes) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /\bfetch\(|\bcookies\(|\bheaders\(|revalidate|unstable_cache|['"]use cache['"]|cacheLife/,
      `${file} must not fetch or cache data on the server`,
    );
  }
});

test('the router keeps no extra copy of a page: staleTimes is not raised', () => {
  const config = readFileSync(join(src, '..', 'next.config.ts'), 'utf8');
  assert.doesNotMatch(config, /staleTimes/);
});

test('the staff area links through PrefetchLink and wraps a navigation in RouteEnter', () => {
  const direct = filesUnder(join(src, 'components', 'workforce'), /\.tsx$/).filter(
    (file) =>
      !file.endsWith('link.tsx') &&
      !file.endsWith('.test.tsx') &&
      /from 'next\/link'/.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(
    direct,
    [],
    'staff screens use PrefetchLink, which skips the prefetch in data saver mode',
  );
  const template = readFileSync(
    join(src, 'app', '[locale]', 'workforce', '(app)', 'template.tsx'),
    'utf8',
  );
  assert.match(template, /<RouteEnter stack>/);
  const link = readFileSync(join(src, 'components', 'workforce', 'link.tsx'), 'utf8');
  assert.match(link, /prefetchAllowed\(readMotionEnvironment\(\)\)/);
  assert.match(link, /prefetch=\{prefetch \?\? mayPrefetch\(\)\}/);
});

test('a page restored from the back/forward cache reloads, and the shell mounts the motion gate', () => {
  const shell = readFileSync(join(src, 'components', 'workforce', 'shell.tsx'), 'utf8');
  assert.match(shell, /addEventListener\('pageshow'/);
  assert.match(shell, /event\.persisted/);
  assert.match(shell, /<FreshOnReturn \/>/);
  assert.match(shell, /<MotionGate \/>/);
});
