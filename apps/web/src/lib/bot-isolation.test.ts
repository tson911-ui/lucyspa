import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Claude integration CI-B1: the bot data listener is a separate port of the API process. The web proxy forwards `/api/*` to the API's own
// port only, so nothing of the bot listener can be reached through the site; this pins that no rewrite, redirect or header rule mentions it.
const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');

test('the web proxy forwards /api only and never names the bot listener', () => {
  const sources = [...config.matchAll(/source:\s*'([^']+)'/g)].map((match) => match[1]);
  const rewriteSection = config.slice(
    config.indexOf('async rewrites()'),
    config.indexOf('async redirects()'),
  );
  assert.deepEqual(
    [...rewriteSection.matchAll(/source:\s*'([^']+)'/g)].map((match) => match[1]),
    ['/api/:path*'],
    'one rewrite, for /api',
  );
  assert.ok(!/\/bot|bot-data|botdata/i.test(config), 'no mention of the bot listener');
  assert.ok(!sources.some((source) => source?.startsWith('/bot')), 'no /bot route');
  assert.ok(!/BOT_DATA/.test(config));
});
