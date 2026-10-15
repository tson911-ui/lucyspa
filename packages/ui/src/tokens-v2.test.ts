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

// Every role token is one step of a 12-step scale (DESIGN.md 6.1, Radix method). [light, dark]; a literal is not a step.
const ROLE_STEPS: Record<string, [string, string]> = {
  'band-base': ['gray-1', 'gray-1'],
  'band-alt': ['gray-2', 'gray-2'],
  'bg-page': ['gray-1', 'gray-1'],
  'bg-sunken': ['gray-2', 'gray-2'],
  'bg-surface': ['gray-2', 'gray-2'],
  'bg-surface-alt': ['gray-1', 'gray-3'],
  'bg-raised': ['gray-1', 'gray-3'],
  'bg-pressed': ['gray-4', 'gray-4'],
  text: ['gray-12', 'gray-12'],
  'text-muted': ['gray-10', 'gray-10'],
  'text-subtle': ['gray-8', 'gray-10'],
  border: ['gray-5', 'gray-5'],
  'border-control': ['gray-7', 'gray-7'],
  brand: ['burgundy-12', 'burgundy-11'],
  'brand-fill': ['burgundy-9', 'burgundy-9'],
  'brand-fill-hover': ['burgundy-10', 'burgundy-10'],
  'brand-soft': ['burgundy-3', 'burgundy-3'],
  'brand-on-soft': ['burgundy-12', 'burgundy-11'],
  focus: ['burgundy-12', 'burgundy-11'],
  wordmark: ['burgundy-9', 'gray-12'],
  'outline-border': ['burgundy-9', 'burgundy-10'],
  'outline-border-hover': ['burgundy-10', 'burgundy-11'],
  'hover-bg': ['burgundy-9', 'burgundy-9'],
  'hover-border': ['burgundy-9', 'burgundy-9'],
  'hover-ghost-border': ['burgundy-9', 'burgundy-9'],
  'row-hover-bg': ['gray-2', 'gray-3'],
  'nav-hover-bg': ['gray-4', 'gray-4'],
  'nav-hover-text': ['gray-12', 'gray-12'],
  'nav-active-bg': ['burgundy-9', 'burgundy-9'],
  'auth-flat': ['burgundy-9', 'gray-2'],
  danger: ['danger-11', 'danger-11'],
  'danger-bg': ['danger-3', 'danger-3'],
  'danger-fill': ['danger-9', 'danger-9'],
  'danger-fill-hover': ['danger-10', 'danger-10'],
  success: ['success-11', 'success-11'],
  'success-bg': ['success-3', 'success-3'],
  warning: ['warning-11', 'warning-11'],
  'warning-bg': ['warning-3', 'warning-3'],
  info: ['info-11', 'info-11'],
  'info-bg': ['info-3', 'info-3'],
};

const v2Css = css.slice(css.indexOf('v2 scope (DESIGN.md'));
const FAMILIES = ['gray', 'burgundy', 'danger', 'success', 'warning', 'info'];

// OKLab distance (the "delta E OK"): how far apart two colors look. 0.1 is plainly visible, 0.2 is unmistakable.
function oklab(value: string): [number, number, number] {
  const n = parseInt(value.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const deltaE = (a: string, b: string): number => {
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

test('every family has 12 steps in the light, both dark and the forced-light blocks', () => {
  for (const theme of [light, darkAttribute, forcedLight]) {
    for (const family of FAMILIES) {
      for (let step = 1; step <= 12; step++)
        hex(theme[`--ls-${family}-${step}`], `${family}-${step}`);
    }
  }
});

test('the burgundy light solid is #782b37 and the dark solid is a burgundy, not a pink', () => {
  assert.equal(light['--ls-burgundy-9'], '#782b37');
  assert.equal(light['--ls-brand-fill'], '#782b37');
  assert.equal(light['--ls-bg-page'], '#ffffff');
  assert.equal(light['--ls-bg-sunken'], '#f5f5f7');
  assert.equal(darkAttribute['--ls-bg-page'], '#000000');
  assert.equal(darkAttribute['--ls-bg-sunken'], '#1c1c1e');
  assert.equal(darkAttribute['--ls-bg-raised'], '#2c2c2e');
  assert.equal(darkAttribute['--ls-bg-pressed'], '#3a3a3c');
  for (const retired of ['#e48f9f', '#eca5b2', '#3a2227']) {
    assert.ok(
      !v2Css.includes(retired),
      `${retired} (the old candy pink) is gone from the v2 scope`,
    );
  }
  // White text on the dark fill, as on the light one.
  assert.equal(darkAttribute['--ls-on-brand'], '#ffffff');
  assert.equal(darkAttribute['--ls-hover-text'], '#ffffff');
});

test('each role token is the documented step of its scale, in both modes', () => {
  for (const [role, [lightStep, darkStep]] of Object.entries(ROLE_STEPS)) {
    assert.equal(
      light[`--ls-${role}`],
      light[`--ls-${lightStep}`],
      `${role} (light) = ${lightStep}`,
    );
    assert.equal(
      darkAttribute[`--ls-${role}`],
      darkAttribute[`--ls-${darkStep}`],
      `${role} (dark) = ${darkStep}`,
    );
  }
});

test('light: every text color is 4.5:1 on both bands, controls and the focus ring are 3:1', () => {
  for (const surface of [token(light, 'bg-page'), token(light, 'bg-sunken')]) {
    for (const name of [
      'text',
      'text-muted',
      'text-subtle',
      'brand',
      'danger',
      'success',
      'warning',
      'info',
    ]) {
      assert.ok(ratio(token(light, name), surface) >= 4.5, `${name} on ${surface}`);
    }
    for (const name of ['border-control', 'focus']) {
      assert.ok(ratio(token(light, name), surface) >= 3, `${name} on ${surface}`);
    }
  }
  assert.ok(ratio(token(light, 'text'), token(light, 'bg-page')) >= 15);
});

test('light: white on the accent fill, its hover and the danger fill is 4.5:1; status text holds on its own tint', () => {
  assert.ok(ratio(token(light, 'on-brand'), token(light, 'brand-fill')) >= 9);
  assert.ok(ratio(token(light, 'on-brand'), token(light, 'brand-fill-hover')) >= 9);
  assert.ok(ratio(token(light, 'hover-text'), token(light, 'hover-bg')) >= 4.5);
  assert.ok(ratio(token(light, 'brand-on-soft'), token(light, 'brand-soft')) >= 7);
  assert.ok(ratio(token(light, 'on-danger'), token(light, 'danger-fill')) >= 4.5);
  assert.ok(ratio(token(light, 'on-danger'), token(light, 'danger-fill-hover')) >= 4.5);
  for (const name of ['danger', 'success', 'warning', 'info']) {
    assert.ok(ratio(token(light, name), token(light, `${name}-bg`)) >= 4.5, `${name} on its tint`);
  }
});

test('dark: text, accent text and status text hold on every elevation step; the accent is a muted rose, 7:1 on E0 and E1', () => {
  const dark = darkAttribute;
  const [e0, e1, e2, e3] = ['#000000', '#1c1c1e', '#2c2c2e', '#3a3a3c'] as const;
  for (const surface of [e0, e1, e2]) {
    for (const name of [
      'text',
      'text-muted',
      'text-subtle',
      'brand',
      'danger',
      'success',
      'warning',
      'info',
    ]) {
      assert.ok(ratio(token(dark, name), surface) >= 4.5, `${name} on ${surface}`);
    }
    assert.ok(ratio(token(dark, 'border-control'), surface) >= 3, `control border on ${surface}`);
    assert.ok(ratio(token(dark, 'focus'), surface) >= 3, `focus ring on ${surface}`);
  }
  for (const surface of [e0, e1]) {
    assert.ok(ratio(token(dark, 'brand'), surface) >= 7, `accent text on ${surface}`);
  }
  // E3 is a neutral hover or pressed surface only: ordinary text stays readable on it, the accent text is never used there.
  assert.ok(ratio(token(dark, 'text'), e3) >= 4.5);
  // Muted rose: clearly less saturated than the old #e48f9f.
  const [, a, b] = oklab(token(dark, 'brand'));
  assert.ok(Math.hypot(a, b) < 0.07, `accent text chroma ${Math.hypot(a, b).toFixed(3)} < 0.07`);
});

test('dark: white text on the accent fill and its hover, dark text on the danger fill, status text on its tint', () => {
  const dark = darkAttribute;
  assert.ok(ratio(token(dark, 'on-brand'), token(dark, 'brand-fill')) >= 5);
  assert.ok(ratio(token(dark, 'on-brand'), token(dark, 'brand-fill-hover')) >= 4.5);
  assert.ok(ratio(token(dark, 'brand-on-soft'), token(dark, 'brand-soft')) >= 7);
  assert.ok(ratio(token(dark, 'on-danger'), token(dark, 'danger-fill')) >= 4.5);
  assert.ok(ratio(token(dark, 'on-danger'), token(dark, 'danger-fill-hover')) >= 4.5);
  for (const name of ['danger', 'success', 'warning', 'info']) {
    assert.ok(ratio(token(dark, name), token(dark, `${name}-bg`)) >= 4.5, `${name} on its tint`);
  }
  // The accent fill does not sink into black: 3:1 on E0.
  assert.ok(ratio(token(dark, 'brand-fill'), '#000000') >= 3);
  // On E1 and E2 it is 2.7 and 2.2: the white label (6.4) identifies the button there (DESIGN.md 6.1, recorded).
  assert.ok(ratio(token(dark, 'brand-fill'), '#1c1c1e') >= 2.5);
  assert.ok(ratio(token(dark, 'danger-fill'), '#2c2c2e') >= 3);
});

test('the brand and the danger color are never close: solid vs solid and text vs text, in both modes', () => {
  for (const [mode, theme] of [
    ['light', light],
    ['dark', darkAttribute],
  ] as const) {
    assert.ok(
      deltaE(token(theme, 'brand-fill'), token(theme, 'danger-fill')) >= 0.15,
      `${mode} solids: ${deltaE(token(theme, 'brand-fill'), token(theme, 'danger-fill')).toFixed(3)}`,
    );
    assert.ok(
      deltaE(token(theme, 'brand'), token(theme, 'danger')) >= 0.1,
      `${mode} text: ${deltaE(token(theme, 'brand'), token(theme, 'danger')).toFixed(3)}`,
    );
  }
  // The light accent text is plainly colored, not the ink.
  assert.ok(deltaE(token(light, 'brand'), token(light, 'text')) >= 0.1);
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
