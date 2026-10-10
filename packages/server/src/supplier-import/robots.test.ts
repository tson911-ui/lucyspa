import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretRobotsResponse, parseRobots, robotsAllows } from './robots.js';

test('a file with only a Googlebot group restricts nothing for our token', () => {
  const rules = parseRobots('User-agent: Googlebot\nAllow: /\n');
  assert.equal(robotsAllows(rules, '/wp-json/wc/store/v1/products?page=1'), true);
  assert.equal(robotsAllows(rules, '/anything'), true);
});

test('our own group beats the * group; without one the * group applies', () => {
  const text = [
    'User-agent: *',
    'Disallow: /private/',
    '',
    'User-agent: LucySpaCatalogBot',
    'Disallow: /wp-json/',
    'Allow: /wp-json/wc/store/',
  ].join('\n');
  const own = parseRobots(text);
  assert.equal(
    robotsAllows(own, '/private/x'),
    true,
    'the * group is not used when our group exists',
  );
  assert.equal(robotsAllows(own, '/wp-json/wp/v2/users'), false);
  assert.equal(robotsAllows(own, '/wp-json/wc/store/v1/products'), true, 'longest match wins');
  const other = parseRobots(text, 'SomeoneElse');
  assert.equal(robotsAllows(other, '/private/x'), false);
  assert.equal(robotsAllows(other, '/wp-json/wp/v2/users'), true);
});

test('wildcards, the end anchor, comments, blank Disallow and ties', () => {
  const rules = parseRobots(
    [
      'User-agent: *',
      'Disallow: /*.json$ # no json',
      'Disallow: /tmp*/',
      'Disallow:',
      'Allow: /tmp1/ok/',
      'Disallow: /tmp1/ok/',
    ].join('\n'),
  );
  assert.equal(robotsAllows(rules, '/a/b.json'), false);
  assert.equal(robotsAllows(rules, '/a/b.json?x=1'), true, '$ anchors the end of the path');
  assert.equal(robotsAllows(rules, '/tmpfoo/x'), false);
  assert.equal(robotsAllows(rules, '/tmp1/ok/page'), true, 'Allow wins a tie of equal length');
  assert.equal(robotsAllows(rules, '/shop'), true);
});

test('consecutive User-agent lines share one group; Crawl-delay is read', () => {
  const rules = parseRobots(
    'User-agent: a\nUser-agent: lucyspacatalogbot\nCrawl-delay: 7\nDisallow: /x',
  );
  assert.equal(rules.crawlDelaySeconds, 7);
  assert.equal(robotsAllows(rules, '/x/y'), false);
});

test('a disallow-all file blocks everything', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /');
  assert.equal(robotsAllows(rules, '/wp-json/wc/store/v1/products'), false);
});

test('missing file allows, an unreachable one does not (RFC 9309)', () => {
  assert.equal(interpretRobotsResponse(404, '')?.rules.length, 0);
  assert.equal(interpretRobotsResponse(403, '')?.rules.length, 0);
  assert.equal(interpretRobotsResponse(410, '')?.rules.length, 0);
  assert.equal(interpretRobotsResponse(500, ''), null);
  assert.equal(interpretRobotsResponse(503, ''), null);
  assert.equal(interpretRobotsResponse(429, ''), null);
  assert.equal(interpretRobotsResponse(302, ''), null);
  assert.equal(interpretRobotsResponse(200, 'User-agent: *\nDisallow: /a')?.rules.length, 1);
});
