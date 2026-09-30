import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const here = new URL('.', import.meta.url);
const uiSrc = decodeURIComponent(here.pathname).replace(/^\/([A-Za-z]:)/, '$1');
const webSrc = join(uiSrc, '..', '..', '..', 'apps', 'web', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// The shell stylesheet (Step 5) follows the same rules, so both are checked as one.
const css = ['components.css', 'shell.css']
  .map((name) => readFileSync(new URL(name, here), 'utf8'))
  .join('\n');
const tokens = readFileSync(new URL('tokens.css', here), 'utf8');

test('components.css uses tokens only: no color literals', () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/i);
  assert.doesNotMatch(css, /gold|ivory/i);
});

test('every token the component styles read is defined', () => {
  const defined = new Set([...tokens.matchAll(/(--ls-[\w-]+)\s*:/g)].map((match) => match[1]));
  const used = new Set([...css.matchAll(/var\((--ls-[\w-]+)/g)].map((match) => match[1]));
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], 'undefined tokens');
});

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `rule ${selector} exists`);
  return match[1] ?? '';
}

test('text-bearing controls never fix width or forbid wrapping (long Vietnamese labels)', () => {
  for (const selector of [
    '.ls-btn',
    '.ls-btn-label',
    '.ls-badge',
    '.ls-menu-item',
    '.ls-option',
    '.ls-check',
    '.ls-switch',
    '.ls-notice',
    '.ls-toast',
    '.ls-dialog-title',
  ]) {
    const body = rule(selector);
    assert.doesNotMatch(
      body,
      /(?<![-\w])width:\s*\d+(?:px|rem|em|ch)/,
      `${selector} has a fixed width`,
    );
    assert.doesNotMatch(body, /white-space:\s*nowrap/, `${selector} cannot wrap`);
    assert.doesNotMatch(body, /text-overflow:\s*ellipsis/, `${selector} truncates text`);
  }
  assert.match(rule('.ls-btn'), /min-height:\s*var\(--ls-control-h\)/, '44 px target on touch');
});

test('classes used by the components exist in the stylesheet', () => {
  const declared = new Set([...css.matchAll(/\.(ls-[\w-]+)/g)].map((match) => match[1]));
  const used = new Set<string>();
  for (const file of sourceFiles(uiSrc)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/['"`]((?:ls-[\w-]+)(?:\s+ls-[\w-]+)*)['"`]/g)) {
      // `ls-theme` is the theme cookie name, not a class.
      for (const name of match[1]!.split(/\s+/)) if (name !== 'ls-theme') used.add(name);
    }
  }
  // Classes built from a variant/tone/size/side are checked by their prefix.
  const dynamic = ['ls-btn-', 'ls-badge-', 'ls-notice-', 'ls-toast-', 'ls-dialog-', 'ls-drawer-'];
  const missing = [...used].filter(
    (name) => !declared.has(name) && !dynamic.some((prefix) => name === prefix.slice(0, -1)),
  );
  assert.deepEqual(missing, [], 'classes with no CSS rule');
  for (const variant of ['primary', 'secondary', 'ghost', 'danger-outline', 'danger']) {
    assert.ok(declared.has(`ls-btn-${variant}`), variant);
  }
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral', 'brand']) {
    assert.ok(declared.has(`ls-badge-${tone}`), tone);
  }
  for (const size of ['sm', 'md', 'lg'])
    assert.ok(declared.has(`ls-dialog-${size}`) || size === 'md', size);
});

test('the solid danger button is used in confirmation dialogs only', () => {
  const allowed = new Set(['confirm-dialog.tsx', 'button.tsx']);
  const offenders: string[] = [];
  for (const file of [...sourceFiles(uiSrc), ...sourceFiles(webSrc)]) {
    const name = file.split(/[\\/]/).at(-1)!;
    if (allowed.has(name)) continue;
    const text = readFileSync(file, 'utf8');
    if (/variant\s*[=:]\s*\{?\s*(?:[^}\n]*\?\s*)?['"]danger['"]/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'variant "danger" outside ConfirmDialog');
});

test('mobile: components adapt at the phone breakpoint', () => {
  assert.match(css, /@media \(max-width: 639px\)[^{]*\{[^@]*\.ls-actionbar-inline/);
  assert.match(css, /bottom sheet/i);
  assert.match(css, /\.ls-form-actions[^}]*position:\s*sticky/);
});

test('data components: text wraps, touch targets are 44 px, the phone gets a card list', () => {
  for (const selector of [
    '.ls-chip',
    '.ls-chip-text',
    '.ls-tab',
    '.ls-th-sort',
    '.ls-dl-term',
    '.ls-pagination-summary',
  ]) {
    const body = rule(selector);
    assert.doesNotMatch(
      body,
      /(?<![-\w])width:\s*\d+(?:px|rem|em|ch)/,
      `${selector} has a fixed width`,
    );
    assert.doesNotMatch(body, /white-space:\s*nowrap/, `${selector} cannot wrap`);
    assert.doesNotMatch(body, /text-overflow:\s*ellipsis/, `${selector} truncates text`);
  }
  for (const selector of ['.ls-page-btn', '.ls-chip-remove', '.ls-tab', '.ls-th-sort']) {
    assert.match(rule(selector), /min-height:\s*var\(--ls-control-h\)/, `${selector} target size`);
  }
  assert.match(rule('.ls-table thead th'), /position:\s*sticky/, 'sticky header');
  const phone =
    /@media \(max-width: 639px\) \{([\s\S]*?)\n\}\n\n\/\* Pagination/.exec(css)?.[1] ?? '';
  assert.match(
    phone,
    /\.ls-table td\[data-label\]::before[^}]*content:\s*attr\(data-label\)/,
    'labels in the card list',
  );
  assert.match(phone, /\.ls-table tbody tr[^}]*border:/, 'each row is a card');
  assert.match(
    phone,
    /\.ls-table thead[^}]*clip-path/,
    'the header row stays for assistive technology',
  );
  assert.match(
    css,
    /@media \(min-width: 640px\) and \(max-width: 767px\)[^{]*\{\s*\.ls-hide-md/,
    'tablet hiding',
  );
  assert.match(
    css,
    /@media \(min-width: 768px\) and \(max-width: 1023px\)[^{]*\{\s*\.ls-hide-lg/,
    'tablet hiding',
  );
});
