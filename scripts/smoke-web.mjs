import assert from 'node:assert/strict';

const baseUrl = new URL(process.env.WEB_SMOKE_URL ?? 'http://127.0.0.1:3000');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'WEB_SMOKE_URL must use HTTP or HTTPS.');

async function request(path) {
  return fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}

async function checkLocale(locale, heading) {
  const response = await request(`/${locale}`);
  assert.equal(response.status, 200, `/${locale} must return HTTP 200.`);
  assert.ok(
    response.headers.get('content-type')?.includes('text/html'),
    `/${locale} must return HTML.`,
  );

  const html = await response.text();
  assert.ok(
    new RegExp(`<html\\b[^>]*\\blang="${locale}"`).test(html),
    `/${locale} must set the HTML language.`,
  );
  assert.ok(heading.test(html), `/${locale} must render its translated heading.`);
  assert.ok(/<a\b[^>]*href="\/vi"/.test(html), `/${locale} must link to Vietnamese.`);
  assert.ok(/<a\b[^>]*href="\/en"/.test(html), `/${locale} must link to English.`);
}

async function main() {
  const root = await request('/');
  assert.equal(root.status, 307, '/ must temporarily redirect to the default locale.');
  const location = root.headers.get('location');
  assert.ok(location, '/ must include a redirect location.');
  assert.equal(
    new URL(location, baseUrl).href,
    new URL('/vi', baseUrl).href,
    '/ must redirect to /vi.',
  );
  await root.body?.cancel();

  await Promise.all([
    checkLocale('vi', /<h1\b[^>]*>Một khoảng lặng\.\s*Dành riêng cho bạn\.<\/h1>/u),
    checkLocale('en', /<h1\b[^>]*>A quiet moment\.\s*Just for you\.<\/h1>/u),
  ]);

  const health = await request('/health');
  assert.equal(health.status, 200, '/health must return HTTP 200.');
  assert.ok(
    health.headers.get('content-type')?.includes('application/json'),
    '/health must return JSON.',
  );
  assert.ok(
    health.headers.get('cache-control')?.includes('no-store'),
    '/health must disable caching.',
  );
  assert.deepEqual(await health.json(), { status: 'ok', service: 'web' });

  for (const path of ['/fr', '/vi/phase-zero-missing']) {
    const response = await request(path);
    assert.equal(response.status, 404, `${path} must return HTTP 404.`);
    await response.body?.cancel();
  }

  console.log(
    'Web smoke passed: default redirect, Vietnamese/English content and language links, health, and 404 routes.',
  );
}

await main();
