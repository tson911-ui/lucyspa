import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  themeInitScript,
} from './theme-core';

test('theme cookie parsing ignores unknown values and other cookies', () => {
  assert.equal(parseThemeCookie(''), 'system');
  assert.equal(parseThemeCookie('a=1; ls-theme=dark; b=2'), 'dark');
  assert.equal(parseThemeCookie('ls-theme=light'), 'light');
  assert.equal(parseThemeCookie('ls-theme=purple'), 'system');
  assert.equal(parseThemeCookie('not-ls-theme=dark'), 'system');
});

test('theme cookie is a 1 year SameSite=Lax cookie and system clears it', () => {
  const dark = serializeThemeCookie('dark');
  assert.match(dark, /^ls-theme=dark; Max-Age=31536000; /);
  assert.match(dark, /SameSite=Lax/);
  assert.doesNotMatch(dark, /HttpOnly/);
  assert.match(serializeThemeCookie('system'), /Max-Age=0/);
});

test('resolveTheme follows the system only when no explicit choice exists', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('pre-paint script sets data-theme only for an explicit cookie', () => {
  const attributes = new Map<string, string>();
  const run = (cookie: string) => {
    attributes.clear();
    const document = {
      cookie,
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    };
    new Function('document', themeInitScript)(document);
  };
  run('ls-theme=dark');
  assert.equal(attributes.get('data-theme'), 'dark');
  run('other=1');
  assert.equal(attributes.size, 0);
  run('ls-theme=nope');
  assert.equal(attributes.size, 0);
});
