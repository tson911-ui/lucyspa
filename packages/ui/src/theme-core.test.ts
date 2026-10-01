import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  themeForHour,
  themeInitScript,
} from './theme-core';

test('theme cookie parsing ignores unknown values and other cookies', () => {
  assert.equal(parseThemeCookie(''), 'auto');
  assert.equal(parseThemeCookie('a=1; ls-theme=dark; b=2'), 'dark');
  assert.equal(parseThemeCookie('ls-theme=light'), 'light');
  assert.equal(parseThemeCookie('ls-theme=purple'), 'auto');
  assert.equal(parseThemeCookie('ls-theme=system'), 'auto', 'an old value falls back to auto');
  assert.equal(parseThemeCookie('not-ls-theme=dark'), 'auto');
});

test('theme cookie is a 1 year SameSite=Lax cookie and auto clears it', () => {
  const dark = serializeThemeCookie('dark');
  assert.match(dark, /^ls-theme=dark; Max-Age=31536000; /);
  assert.match(dark, /SameSite=Lax/);
  assert.doesNotMatch(dark, /HttpOnly/);
  assert.match(serializeThemeCookie('auto'), /Max-Age=0/);
});

test('auto is light from 06:00 to 17:59 and dark from 18:00 to 05:59', () => {
  for (const hour of [6, 9, 12, 17]) assert.equal(themeForHour(hour), 'light', `${hour}:00`);
  for (const hour of [18, 21, 23, 0, 3, 5]) assert.equal(themeForHour(hour), 'dark', `${hour}:00`);
  const at = (hour: number, minute: number) => new Date(2026, 9, 2, hour, minute);
  assert.equal(resolveTheme('auto', at(17, 59)), 'light');
  assert.equal(resolveTheme('auto', at(18, 0)), 'dark');
  assert.equal(resolveTheme('auto', at(5, 59)), 'dark');
  assert.equal(resolveTheme('auto', at(6, 0)), 'light');
  assert.equal(resolveTheme('light', at(23, 0)), 'light', 'a manual choice wins over the time');
  assert.equal(resolveTheme('dark', at(12, 0)), 'dark');
});

type Timer = { fn: () => void; delay: number };

/** Runs the pre-paint script against a fake document, clock and timer. */
function runScript(cookie: string, now: Date) {
  const attributes = new Map<string, string>();
  const timers: Timer[] = [];
  const listeners = new Map<string, () => void>();
  const document = {
    cookie,
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
  };
  class FakeDate extends Date {
    constructor(...args: unknown[]) {
      super(...((args.length === 0 ? [now.getTime()] : args) as [number]));
    }
  }
  new Function('document', 'Date', 'setTimeout', themeInitScript)(
    document,
    FakeDate,
    (fn: () => void, delay: number) => timers.push({ fn, delay }),
  );
  return { attributes, timers, listeners, document };
}

test('pre-paint script: a cookie wins; with none the local hour decides', () => {
  assert.equal(
    runScript('ls-theme=dark', new Date(2026, 9, 2, 12)).attributes.get('data-theme'),
    'dark',
  );
  assert.equal(
    runScript('ls-theme=light', new Date(2026, 9, 2, 23)).attributes.get('data-theme'),
    'light',
  );
  assert.equal(
    runScript('other=1', new Date(2026, 9, 2, 12)).attributes.get('data-theme'),
    'light',
  );
  assert.equal(
    runScript('ls-theme=nope', new Date(2026, 9, 2, 20)).attributes.get('data-theme'),
    'dark',
  );
  assert.equal(runScript('', new Date(2026, 9, 2, 5, 59)).attributes.get('data-theme'), 'dark');
  assert.equal(runScript('', new Date(2026, 9, 2, 6, 0)).attributes.get('data-theme'), 'light');
  assert.equal(runScript('', new Date(2026, 9, 2, 17, 59)).attributes.get('data-theme'), 'light');
  assert.equal(runScript('', new Date(2026, 9, 2, 18, 0)).attributes.get('data-theme'), 'dark');
});

test('pre-paint script: schedules itself for the next 06:00 / 18:00 and when the tab is shown again', () => {
  const minutes = (timer: Timer | undefined) => Math.round((timer?.delay ?? 0) / 60_000);
  assert.equal(minutes(runScript('', new Date(2026, 9, 2, 12, 0)).timers[0]), 6 * 60);
  assert.equal(minutes(runScript('', new Date(2026, 9, 2, 17, 59)).timers[0]), 1);
  assert.equal(minutes(runScript('', new Date(2026, 9, 2, 18, 0)).timers[0]), 12 * 60);
  assert.equal(minutes(runScript('', new Date(2026, 9, 2, 23, 0)).timers[0]), 7 * 60);
  assert.equal(minutes(runScript('', new Date(2026, 9, 2, 2, 0)).timers[0]), 4 * 60);
  const { listeners } = runScript('', new Date(2026, 9, 2, 12));
  assert.ok(listeners.has('visibilitychange'));
});

test('pre-paint script contains no "<" (it is inlined in the HTML) and survives a cookie read error', () => {
  assert.doesNotMatch(themeInitScript, /</);
  const attributes = new Map<string, string>();
  const document = {
    get cookie(): string {
      throw new Error('blocked');
    },
    documentElement: { setAttribute: (n: string, v: string) => attributes.set(n, v) },
    addEventListener: () => undefined,
  };
  assert.doesNotThrow(() =>
    new Function('document', 'setTimeout', themeInitScript)(document, () => 0),
  );
});
