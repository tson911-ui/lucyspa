import assert from 'node:assert/strict';

const baseUrl = new URL(process.env.WEB_SMOKE_URL ?? 'http://127.0.0.1:3000');
assert.ok(['http:', 'https:'].includes(baseUrl.protocol), 'WEB_SMOKE_URL must use HTTP or HTTPS.');

async function request(path) {
  return fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}

// The home page draws the shop's own data (tagline, catalogue) from the API; this probe has no API behind the web
// server, so the headline falls back to the brand name. What it must always show is one non-empty h1 and the texts that
// are translated in the app itself.
async function checkLocale(locale, lead, cta) {
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
  assert.equal(html.match(/<h1\b/g)?.length, 1, `/${locale} must have exactly one h1.`);
  assert.ok(/<h1\b[^>]*>[^<]+<\/h1>/u.test(html), `/${locale} must render a non-empty heading.`);
  assert.ok(lead.test(html), `/${locale} must render its translated introduction.`);
  assert.ok(cta.test(html), `/${locale} must render its translated booking button.`);
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
    checkLocale('vi', /Chọn dịch vụ, chọn giờ còn trống/u, />Đặt lịch</u),
    checkLocale('en', /Choose your services, pick a free time/u, />Book now</u),
  ]);

  // The services page renders (with a notice when the catalogue cannot be read) and keeps its single heading.
  for (const [path, heading] of [
    ['/vi/services', 'Dịch vụ'],
    ['/en/services', 'Services'],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} must return HTTP 200.`);
    const html = await response.text();
    assert.ok(
      new RegExp(`<h1\\b[^>]*>${heading}</h1>`, 'u').test(html),
      `${path} must render its heading.`,
    );
  }

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
