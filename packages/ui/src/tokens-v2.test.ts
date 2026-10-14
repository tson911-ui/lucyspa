import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The v2 scope of tokens.css against DESIGN.md section 6 (light 6.1, dark 6.2, radius and shadows 6.5, sizes 6.6, density 6.7,
// motion 11.3). The ratios are WCAG 2.x; the published values are the ones in the spec, to one decimal.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function declarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

/** The declarations of the first rule whose selector line matches (the body ends at the matching brace). */
function block(selector: RegExp): Record<string, string> {
  const match = selector.exec(css);
  assert.ok(match, `missing block ${selector}`);
  let depth = 1;
  let index = match.index + match[0].length;
  const start = index;
  while (depth > 0 && index < css.length) {
    const char = css[index++];
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  return declarations(css.slice(start, index - 1));
}

const light = block(/^\[data-ui='v2'\]\s*\{/m);
const darkAttribute = block(
  /^:root\[data-theme='dark'\]\s*\[data-ui='v2'\],\s*\[data-preview-theme='dark'\]\s*\[data-ui='v2'\],\s*\[data-preview-theme='dark'\]\[data-ui='v2'\]\s*\{/m,
);
const darkSystem = block(/^\s*:root:not\(\[data-theme='light'\]\)\s*\[data-ui='v2'\]\s*\{/m);
const forcedLight = block(
  /^:root \[data-preview-theme='light'\] \[data-ui='v2'\],\s*:root \[data-preview-theme='light'\]\[data-ui='v2'\]\s*\{/m,
);
const compact = block(/^\[data-density='compact'\]\s*\{/m);
const reducedMotion = block(
  /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root,\s*\[data-ui='v2'\],\s*\[data-density='compact'\]\s*\{/,
);

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const hex = (value: string | undefined, name: string): string => {
  assert.match(value ?? '', /^#[0-9a-f]{6}$/, `${name} must be a 6-digit hex`);
  return value!;
};
const token = (theme: Record<string, string>, name: string): string =>
  hex(theme[`--ls-${name}`], `--ls-${name}`);

function assertRatio(actual: number, published: number, label: string): void {
  assert.ok(
    Math.abs(actual - published) < 0.06,
    `${label}: spec ${published}, measured ${actual.toFixed(2)}`,
  );
}

test('the two dark blocks of the v2 scope are identical', () => {
  assert.deepEqual(darkSystem, darkAttribute);
  assert.ok(Object.keys(darkAttribute).length >= 30);
});

test('the dark and the forced-light blocks only override tokens the light block defines', () => {
  for (const name of Object.keys(darkAttribute)) {
    assert.ok(name in light, `${name} has a light value`);
  }
  for (const name of Object.keys(forcedLight)) {
    assert.ok(name in light, `${name} has a light value`);
  }
});

test('forced light repeats the light value of every token the dark block overrides (and carries colors only)', () => {
  for (const name of Object.keys(darkAttribute)) {
    assert.equal(forcedLight[name], light[name], `${name} differs in the forced-light scope`);
  }
  assert.deepEqual(
    Object.keys(forcedLight).filter((name) => !(name in darkAttribute)),
    [],
  );
});

test('light: bands are #ffffff and #f5f5f7, a card takes the other step', () => {
  assert.equal(light['--ls-bg-page'], '#ffffff');
  assert.equal(light['--ls-bg-sunken'], '#f5f5f7');
  assert.equal(light['--ls-band-base'], '#ffffff');
  assert.equal(light['--ls-band-alt'], '#f5f5f7');
  assert.equal(light['--ls-bg-surface'], '#f5f5f7');
  assert.equal(light['--ls-bg-surface-alt'], '#ffffff');
  assert.equal(light['--ls-brand'], '#782b37');
  assert.equal(light['--ls-brand-fill'], '#782b37');
});

test('light ratios of DESIGN.md 6.1 are reproduced', () => {
  const white = '#ffffff';
  const band = '#f5f5f7';
  assertRatio(ratio(token(light, 'text'), white), 16.83, 'text on white');
  assertRatio(ratio(token(light, 'text'), band), 15.46, 'text on band');
  assertRatio(ratio(token(light, 'text-muted'), white), 7.91, 'muted on white');
  assertRatio(ratio(token(light, 'text-muted'), band), 7.26, 'muted on band');
  assertRatio(ratio(token(light, 'text-subtle'), white), 5.07, 'subtle on white');
  assertRatio(ratio(token(light, 'text-subtle'), band), 4.66, 'subtle on band');
  assertRatio(ratio(token(light, 'border-control'), white), 3.62, 'control border on white');
  assertRatio(ratio(token(light, 'border-control'), band), 3.33, 'control border on band');
  assertRatio(ratio(token(light, 'brand'), white), 9.55, 'accent on white');
  assertRatio(ratio(token(light, 'brand'), band), 8.77, 'accent on band');
  assertRatio(
    ratio(token(light, 'on-brand'), token(light, 'brand-fill')),
    9.55,
    'on-brand on fill',
  );
  assertRatio(
    ratio(token(light, 'on-brand'), token(light, 'brand-fill-hover')),
    11.58,
    'on-brand on fill hover',
  );
  assertRatio(
    ratio(token(light, 'brand-on-soft'), token(light, 'brand-soft')),
    7.92,
    'accent on soft',
  );
});

test('light: every text color is 4.5:1 on both bands, controls and the focus ring are 3:1', () => {
  for (const surface of [token(light, 'bg-page'), token(light, 'bg-sunken')]) {
    for (const name of ['text', 'text-muted', 'text-subtle', 'brand']) {
      assert.ok(ratio(token(light, name), surface) >= 4.5, `${name} on ${surface}`);
    }
    for (const name of ['border-control', 'focus']) {
      assert.ok(ratio(token(light, name), surface) >= 3, `${name} on ${surface}`);
    }
  }
});

test('dark: the base is black, the steps are #1c1c1e, #2c2c2e and #3a3a3c, the accent is #e48f9f', () => {
  const dark = darkAttribute;
  assert.equal(dark['--ls-bg-page'], '#000000');
  assert.equal(dark['--ls-bg-sunken'], '#1c1c1e');
  assert.equal(dark['--ls-bg-surface'], '#1c1c1e');
  assert.equal(dark['--ls-bg-surface-alt'], '#2c2c2e');
  assert.equal(dark['--ls-bg-raised'], '#2c2c2e');
  assert.equal(dark['--ls-bg-pressed'], '#3a3a3c');
  assert.equal(dark['--ls-brand'], '#e48f9f');
  assert.equal(dark['--ls-brand-fill'], '#e48f9f');
  assert.equal(dark['--ls-focus'], '#e48f9f');
  assert.equal(dark['--ls-on-brand'], '#000000', 'text on the accent fill is near-black');
});

test('dark ratios of DESIGN.md 6.2 are reproduced on every elevation step', () => {
  const dark = darkAttribute;
  const [e0, e1, e2, e3] = ['#000000', '#1c1c1e', '#2c2c2e', '#3a3a3c'] as const;
  assertRatio(ratio(token(dark, 'text'), e0), 19.29, 'text on E0');
  assertRatio(ratio(token(dark, 'text'), e2), 12.8, 'text on E2');
  assertRatio(ratio(token(dark, 'text-muted'), e0), 8.16, 'muted on E0');
  assertRatio(ratio(token(dark, 'text-muted'), e1), 6.61, 'muted on E1');
  assertRatio(ratio(token(dark, 'text-muted'), e2), 5.42, 'muted on E2');
  assertRatio(ratio(token(dark, 'border-control'), e0), 5.8, 'control border on E0');
  assertRatio(ratio(token(dark, 'border-control'), e1), 4.7, 'control border on E1');
  assertRatio(ratio(token(dark, 'border-control'), e2), 3.85, 'control border on E2');
  assertRatio(ratio(token(dark, 'brand'), e0), 8.73, 'accent on E0');
  assertRatio(ratio(token(dark, 'brand'), e1), 7.07, 'accent on E1');
  assertRatio(ratio(token(dark, 'brand'), e2), 5.79, 'accent on E2');
  assertRatio(ratio(token(dark, 'brand'), e3), 4.72, 'accent on E3');
  assertRatio(ratio(token(dark, 'on-brand'), token(dark, 'brand-fill')), 8.73, 'black on accent');
  assertRatio(
    ratio(token(dark, 'on-brand'), token(dark, 'brand-fill-hover')),
    10.59,
    'black on accent hover',
  );
  assertRatio(
    ratio(token(dark, 'brand-on-soft'), token(dark, 'brand-soft')),
    6.07,
    'accent on soft',
  );
  for (const surface of [e0, e1, e2]) {
    for (const name of ['text', 'text-muted', 'text-subtle']) {
      assert.ok(ratio(token(dark, name), surface) >= 4.5, `${name} on ${surface}`);
    }
    assert.ok(ratio(token(dark, 'border-control'), surface) >= 3, `control border on ${surface}`);
  }
  // E3 is a neutral hover or pressed surface only: ordinary text stays readable on it, the accent text is never used there.
  assert.ok(ratio(token(dark, 'text'), e3) >= 4.5);
});

test('hover: solid accent with its text in both modes (rule 4); rows and sidebar items use a neutral tint (Q3)', () => {
  for (const theme of [light, darkAttribute]) {
    assert.equal(theme['--ls-hover-bg'], theme['--ls-brand-fill']);
    assert.equal(theme['--ls-hover-text'], theme['--ls-on-brand']);
    assert.equal(theme['--ls-hover-border'], theme['--ls-hover-bg']);
    assert.notEqual(theme['--ls-row-hover-bg'], theme['--ls-hover-bg']);
    assert.notEqual(theme['--ls-nav-hover-bg'], theme['--ls-hover-bg']);
    assert.ok(ratio(token(theme, 'hover-text'), token(theme, 'hover-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'text'), token(theme, 'row-hover-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'nav-hover-text'), token(theme, 'nav-hover-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'nav-active-text'), token(theme, 'nav-active-bg')) >= 4.5);
  }
  assert.equal(light['--ls-row-hover-bg'], '#f5f5f7');
  assert.equal(light['--ls-nav-hover-bg'], '#e2e2e5');
  assert.equal(darkAttribute['--ls-nav-hover-bg'], '#3a3a3c');
});

test('no shadows, radius 8 / 18 / pill, the scrim and the comfortable sizes (DESIGN.md 6.5, 6.6)', () => {
  for (const name of ['sm', 'md', 'lg']) assert.equal(light[`--ls-shadow-${name}`], 'none');
  assert.equal(light['--ls-radius-sm'], '8px');
  assert.equal(light['--ls-radius-lg'], '18px');
  assert.equal(
    light['--ls-radius-md'],
    light['--ls-radius-lg'],
    'md follows lg until it is retired',
  );
  assert.equal(light['--ls-radius-full'], '980px');
  assert.equal(light['--ls-overlay'], 'rgb(0 0 0 / 0.4)');
  assert.equal(darkAttribute['--ls-overlay'], 'rgb(0 0 0 / 0.6)');
  assert.equal(light['--ls-control-h'], '44px');
  assert.equal(light['--ls-row-h'], '56px');
});

test('text on a photo: white over one flat scrim that holds 4.5:1 even over a pure-white photo (DESIGN.md 9)', () => {
  assert.equal(light['--ls-on-photo'], '#ffffff');
  const alpha = /^rgb\(0 0 0 \/ ([\d.]+)\)$/.exec(light['--ls-scrim'] ?? '');
  assert.ok(alpha, 'the scrim is a flat black with an alpha');
  // The worst case is a white photo: the scrim over white is the grey (1 - alpha) * 255, and the text is white on it.
  const grey = Math.round((1 - Number(alpha[1])) * 255);
  const hexGrey = `#${grey.toString(16).padStart(2, '0').repeat(3)}`;
  assert.ok(
    ratio('#ffffff', hexGrey) >= 4.5,
    `white on the scrim over white: ${ratio('#ffffff', hexGrey).toFixed(2)}`,
  );
  assert.equal(darkAttribute['--ls-scrim'], undefined, 'a photo does not follow the theme');
});

test('Q4: the flat sign-in panel is the accent (dark #1c1c1e) with white text at 4.5:1, and the card on it is a raised surface', () => {
  assert.equal(light['--ls-auth-flat'], '#782b37');
  assert.equal(darkAttribute['--ls-auth-flat'], '#1c1c1e');
  assert.equal(light['--ls-on-auth-flat'], '#ffffff');
  assert.ok(ratio(light['--ls-on-auth-flat']!, light['--ls-auth-flat']!) >= 4.5);
  assert.ok(ratio(light['--ls-on-auth-flat']!, darkAttribute['--ls-auth-flat']!) >= 4.5);
  // The card is told from the panel by its own step: white on the accent, #2c2c2e on #1c1c1e.
  assert.notEqual(light['--ls-bg-raised'], light['--ls-auth-flat']);
  assert.notEqual(darkAttribute['--ls-bg-raised'], darkAttribute['--ls-auth-flat']);
});

test('no gold, yellow or gradient in the v2 scope', () => {
  const v2 = css.slice(css.lastIndexOf('/*', css.indexOf('v2 scope (DESIGN.md')));
  assert.doesNotMatch(v2.replace(/\/\*[\s\S]*?\*\//g, ''), /gold|ivory|amber|yellow|gradient/i);
});

test('density hook: compact is 40 px controls, 48 px rows and shorter motion (DESIGN.md 6.7, 11.3)', () => {
  assert.equal(compact['--ls-control-h'], '40px');
  assert.equal(compact['--ls-row-h'], '48px');
  assert.equal(compact['--ls-dur-fast'], '120ms');
  assert.equal(compact['--ls-dur-base'], '200ms');
  assert.equal(compact['--ls-dur-slow'], '200ms');
  assert.ok(!('--ls-dur-reveal' in compact) && !('--ls-dur-hero' in compact), 'not used in staff');
});

test('motion: customer durations of DESIGN.md 11.3, all zero under reduced motion', () => {
  assert.equal(light['--ls-dur-fast'], '150ms');
  assert.equal(light['--ls-dur-base'], '240ms');
  assert.equal(light['--ls-dur-slow'], '320ms');
  assert.equal(light['--ls-dur-reveal'], '560ms');
  assert.equal(light['--ls-dur-hero'], '800ms');
  // A scope that declares a duration must zero it itself: a custom property set on a descendant beats the root's zero.
  for (const name of Object.keys(light).filter((n) =>
    /^--ls-dur-(fast|base|slow|reveal|hero)$/.test(n),
  )) {
    assert.equal(reducedMotion[name], '0ms', `${name} is zeroed under reduced motion`);
  }
  for (const name of Object.keys(compact).filter((n) => n.startsWith('--ls-dur-'))) {
    assert.equal(reducedMotion[name], '0ms', `${name} (compact) is zeroed under reduced motion`);
  }
});

test('the alternate band hands a card the other step; the document behind the frame takes the base band', () => {
  assert.match(
    css,
    /\[data-ui='v2'\] \.ls-band--alt \{\s*--ls-bg-surface: var\(--ls-bg-surface-alt\);/,
  );
  assert.match(css, /:root:has\(\[data-ui='v2'\]\) \{\s*--ls-bg-page: #ffffff;/);
  assert.match(
    css,
    /:root\[data-theme='dark'\]:has\(\[data-ui='v2'\]\) \{\s*--ls-bg-page: #000000;/,
  );
});
