import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// components-v2.css (DESIGN.md section 8, redesign group 1): the kit parts for the v2 look. It is shared CSS, so it must not leak to the staff areas
// (every rule sits under the v2 attribute) and it follows the v2 rules: tokens only, no shadow, no gradient.
const css = readFileSync(new URL('components-v2.css', import.meta.url), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  body: string;
}

/** Style rules of the file, including those inside @media / @supports; @keyframes bodies are skipped. */
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  let index = 0;
  function block(skip: boolean): void {
    while (index < source.length) {
      const open = source.indexOf('{', index);
      const close = source.indexOf('}', index);
      if (close !== -1 && (open === -1 || close < open)) {
        index = close + 1;
        return;
      }
      if (open === -1) return;
      const head = source.slice(index, open).trim();
      index = open + 1;
      if (head.startsWith('@')) {
        block(skip || head.startsWith('@keyframes'));
        continue;
      }
      const end = source.indexOf('}', index);
      if (!skip) out.push({ selector: head, body: source.slice(index, end) });
      index = end + 1;
    }
  }
  block(false);
  return out;
}

const all = rules(stripped);

/** Comma-separated selectors, split outside parentheses (`:is(a, b)` is one selector). */
function selectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, at).trim());
      start = at + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

test('components-v2.css has rules, and every selector sits under the v2 attribute', () => {
  assert.ok(all.length > 40, `rules found: ${all.length}`);
  const loose = all.flatMap((rule) =>
    selectors(rule.selector).filter((part) => !part.startsWith("[data-ui='v2']")),
  );
  assert.deepEqual(loose, [], 'selectors outside the v2 scope would change the staff screens');
});

test('components-v2.css follows the v2 rules: tokens only, no shadow, no gradient, no !important', () => {
  assert.doesNotMatch(stripped, /#[0-9a-f]{3,8}\b/i, 'no hex color');
  assert.doesNotMatch(stripped, /\b(?:rgb|rgba|hsl|hsla)\(/i, 'no color function');
  assert.doesNotMatch(stripped, /gradient\(/, 'no gradient');
  assert.doesNotMatch(stripped, /!important/, 'no !important');
  assert.doesNotMatch(stripped, /\bwf-/, 'no wf-* class');
  for (const rule of all) {
    for (const match of rule.body.matchAll(/box-shadow:\s*([^;]+);/g)) {
      assert.equal(match[1]!.trim(), 'none', `${rule.selector}: box-shadow`);
    }
    for (const match of rule.body.matchAll(
      /(?:^|[\s;])(margin|padding|gap|row-gap|column-gap)[\w-]*:\s*([^;]+);/g,
    )) {
      const value = match[2]!.replace(/var\([^)]*\)/g, 'var');
      assert.doesNotMatch(
        value,
        /(?:^|[\s(,+\-*/])-?\d*\.?\d+(?:px|rem|em)\b/,
        `${rule.selector}: spacing literal`,
      );
    }
    for (const match of rule.body.matchAll(/border-radius:\s*([^;]+);/g)) {
      assert.match(
        match[1]!.trim(),
        /^(?:0|var\(--ls-radius-(?:sm|lg|full)\))(?:\s+(?:0|var\(--ls-radius-(?:sm|lg|full)\)))*$/,
        `${rule.selector}: radius is 8 / 18 / pill only`,
      );
    }
  }
});

test('buttons: v2 sizes, the neutral and compact variants, disabled is a fill and not an opacity', () => {
  const body = (selector: string) => all.find((rule) => rule.selector === selector)?.body ?? '';
  const button = body("[data-ui='v2'] .ls-btn");
  assert.match(button, /min-height:\s*var\(--ls-control-h\)/);
  assert.match(button, /padding:\s*var\(--ls-space-2\) var\(--ls-space-6\)/);
  assert.match(button, /border-radius:\s*var\(--ls-radius-full\)/);
  assert.match(button, /font-weight:\s*var\(--ls-weight-label\)/);
  assert.match(body("[data-ui='v2'] .ls-btn-secondary"), /border-color:\s*var\(--ls-brand\)/);
  assert.match(body("[data-ui='v2'] .ls-btn-neutral"), /background:\s*var\(--ls-bg-field\)/);
  const disabled = body("[data-ui='v2'] .ls-btn:is(:disabled, [aria-disabled='true'])");
  assert.match(disabled, /background:\s*var\(--ls-bg-pressed\)/);
  assert.match(disabled, /color:\s*var\(--ls-text-subtle\)/);
  assert.match(disabled, /opacity:\s*1/);
  assert.match(css, /\.ls-btn-compact[\s\S]*font-size:\s*var\(--ls-type-label\)/);
  assert.match(css, /\.ls-btn-sheen::after \{\s*display: none;/);
});

test('fields: boxed 8 px, the opposite-band fill, 44 px, a 6 rem textarea, the native select arrow', () => {
  const input = all.find((rule) => rule.selector === "[data-ui='v2'] .ls-input")?.body ?? '';
  assert.match(input, /border-radius:\s*var\(--ls-radius-sm\)/);
  assert.match(input, /background:\s*var\(--ls-bg-field\)/);
  assert.match(input, /min-height:\s*var\(--ls-control-h\)/);
  assert.match(css, /\.ls-textarea \{\s*min-height: 6rem;/);
  assert.match(css, /\.ls-select \{\s*appearance: auto;/);
  assert.match(css, /\.ls-switch-track \{\s*width: 2\.75rem;\s*height: 1\.75rem;/);
  assert.match(
    css,
    /@media \(forced-colors: active\) \{\s*\[data-ui='v2'\] \.ls-check input \{\s*appearance: auto;/,
  );
});

test('the field fill tokens: a field is the step its container is not, in a card, a dialog and on either band', () => {
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  assert.match(
    tokens,
    /--ls-bg-field: var\(--ls-band-alt\);\s*--ls-bg-field-in-card: var\(--ls-band-base\);/,
  );
  assert.match(
    tokens,
    /\[data-ui='v2'\] \.ls-band--alt \{[^}]*--ls-bg-field: var\(--ls-band-base\);\s*--ls-bg-field-in-card: var\(--ls-band-alt\);/,
  );
  assert.match(
    tokens,
    /\[data-ui='v2'\] \.ls-card \{\s*--ls-bg-field: var\(--ls-bg-field-in-card\);/,
  );
  assert.match(tokens, /\.ls-dialog, \.ls-drawer[^{]*\{\s*--ls-bg-field: var\(--ls-band-alt\);/);
  assert.match(tokens, /--ls-control-h-compact: 40px;/);
});
