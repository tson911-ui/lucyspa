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
// No theme switch (session 10, A1): dark is the system preference, or the admin season preview forcing it (`data-preview-theme`).
const darkPreview = block(
  /^:root\[data-preview-theme='dark'\]\s*\[data-ui='v2'\],\s*\[data-preview-theme='dark'\]\s*\[data-ui='v2'\],\s*\[data-preview-theme='dark'\]\[data-ui='v2'\]\s*\{/m,
);
const darkSystem = block(
  /^\s*:root:not\(\[data-preview-theme='light'\]\)\s*\[data-ui='v2'\]\s*\{/m,
);
const forcedLight = block(
  /^:root\[data-preview-theme='light'\] \[data-ui='v2'\],\s*:root \[data-preview-theme='light'\] \[data-ui='v2'\],\s*:root \[data-preview-theme='light'\]\[data-ui='v2'\]\s*\{/m,
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
  assert.deepEqual(darkSystem, darkPreview);
  assert.ok(Object.keys(darkPreview).length >= 30);
});

test('the dark and the forced-light blocks only override tokens the light block defines', () => {
  for (const name of Object.keys(darkPreview)) {
    assert.ok(name in light, `${name} has a light value`);
  }
  for (const name of Object.keys(forcedLight)) {
    assert.ok(name in light, `${name} has a light value`);
  }
});

test('forced light repeats the light value of every token the dark block overrides (and carries colors only)', () => {
  for (const name of Object.keys(darkPreview)) {
    assert.equal(forcedLight[name], light[name], `${name} differs in the forced-light scope`);
  }
  assert.deepEqual(
    Object.keys(forcedLight).filter((name) => !(name in darkPreview)),
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
  // Owner B1 (session 10): captions were too faint; the light subtle text is gray 10, the same step as muted.
  'text-subtle': ['gray-10', 'gray-10'],
  border: ['gray-5', 'gray-5'],
  'border-control': ['gray-7', 'gray-7'],
  // Session 10 (A3/A4): accent text, link and focus are burgundy 11 in light and the neutral high-contrast text in dark (no pink).
  brand: ['burgundy-11', 'gray-12'],
  link: ['burgundy-11', 'gray-12'],
  'brand-fill': ['burgundy-9', 'burgundy-9'],
  'brand-fill-hover': ['burgundy-10', 'burgundy-10'],
  'brand-fill-pressed': ['burgundy-11', 'burgundy-8'],
  'brand-soft': ['burgundy-3', 'burgundy-3'],
  'brand-on-soft': ['burgundy-11', 'gray-12'],
  focus: ['burgundy-11', 'gray-12'],
  wordmark: ['burgundy-9', 'gray-12'],
  'outline-border': ['burgundy-11', 'gray-10'],
  'outline-border-hover': ['burgundy-12', 'gray-12'],
  'secondary-hover-bg': ['burgundy-3', 'gray-3'],
  'secondary-pressed-bg': ['burgundy-4', 'gray-4'],
  // A transparent control hovers one grey step and presses the next; the hover text is the ordinary text.
  'hover-bg': ['gray-3', 'gray-3'],
  'hover-text': ['gray-12', 'gray-12'],
  'hover-border': ['gray-5', 'gray-6'],
  'hover-ghost-border': ['gray-5', 'gray-6'],
  'pressed-bg': ['gray-4', 'gray-4'],
  'row-hover-bg': ['gray-2', 'gray-3'],
  'nav-hover-bg': ['gray-3', 'gray-3'],
  'nav-hover-text': ['gray-12', 'gray-12'],
  'nav-active-bg': ['burgundy-9', 'burgundy-9'],
  'auth-flat': ['gray-1', 'gray-1'],
  'on-auth-flat': ['gray-12', 'gray-12'],
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
  for (const theme of [light, darkPreview, forcedLight]) {
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
  assert.equal(darkPreview['--ls-bg-page'], '#000000');
  assert.equal(darkPreview['--ls-bg-sunken'], '#1c1c1e');
  assert.equal(darkPreview['--ls-bg-raised'], '#2c2c2e');
  assert.equal(darkPreview['--ls-bg-pressed'], '#3a3a3c');
  for (const retired of ['#e48f9f', '#eca5b2', '#3a2227']) {
    assert.ok(
      !v2Css.includes(retired),
      `${retired} (the old candy pink) is gone from the v2 scope`,
    );
  }
  // White text on the dark fill, as on the light one; a neutral hover keeps the ordinary text.
  assert.equal(darkPreview['--ls-on-brand'], '#ffffff');
  assert.equal(darkPreview['--ls-hover-text'], '#f5f5f7');
});

test('A3/A4 role values (light / dark) and no role points at the pink steps in dark', () => {
  const expected: Record<string, [string, string]> = {
    brand: ['#60212a', '#f5f5f7'],
    'brand-on-soft': ['#60212a', '#f5f5f7'],
    focus: ['#60212a', '#f5f5f7'],
    link: ['#60212a', '#f5f5f7'],
    'link-rest-decoration': ['none', 'underline'],
    'outline-border': ['#60212a', '#a1a1a6'],
    'outline-border-hover': ['#521b24', '#f5f5f7'],
    'brand-fill-pressed': ['#60212a', '#873742'],
    'secondary-hover-bg': ['#f9eced', '#2c2c2e'],
    'secondary-pressed-bg': ['#f7e1e2', '#3a3a3c'],
    'hover-bg': ['#ececef', '#2c2c2e'],
    'hover-text': ['#1d1d1f', '#f5f5f7'],
    'hover-border': ['#d2d2d7', '#58585b'],
    'hover-ghost-border': ['#d2d2d7', '#58585b'],
    'pressed-bg': ['#e2e2e5', '#3a3a3c'],
    'nav-hover-bg': ['#ececef', '#2c2c2e'],
    'auth-flat': ['#ffffff', '#000000'],
    'on-auth-flat': ['#1d1d1f', '#f5f5f7'],
    'text-subtle': ['#515154', '#a1a1a6'],
  };
  for (const [role, [lightValue, darkValue]] of Object.entries(expected)) {
    assert.equal(light[`--ls-${role}`], lightValue, `${role} (light)`);
    assert.equal(darkPreview[`--ls-${role}`], darkValue, `${role} (dark)`);
    assert.equal(forcedLight[`--ls-${role}`], lightValue, `${role} (forced light)`);
  }
  for (const [name, value] of Object.entries(darkPreview)) {
    if (/^--ls-burgundy-\d+$/.test(name)) continue;
    assert.ok(!['#dcadb0', '#f8ddde'].includes(value), `${name} is a pink step (${value}) in dark`);
  }
  // Link contrast (WCAG 2.x): light on both bands, dark on black.
  assert.equal(ratio(token(light, 'link'), '#ffffff').toFixed(2), '12.01');
  assert.equal(ratio(token(light, 'link'), '#f5f5f7').toFixed(2), '11.03');
  assert.equal(ratio(token(darkPreview, 'link'), '#000000').toFixed(2), '19.29');
  // Subtle text (B1): the same contrast as the muted text on both light bands.
  assert.equal(light['--ls-text-subtle'], light['--ls-text-muted']);
  assert.equal(ratio(token(light, 'text-subtle'), '#ffffff').toFixed(2), '7.91');
  assert.equal(ratio(token(light, 'text-subtle'), '#f5f5f7').toFixed(2), '7.26');
});

test('the secondary-button hover movement tokens are gone; the staff route fade is a compact token', () => {
  for (const name of ['--ls-btn-lift', '--ls-btn-zoom', '--ls-btn-nudge']) {
    assert.ok(!css.includes(name), `${name} is deleted`);
  }
  assert.equal(compact['--ls-dur-route'], '120ms');
  assert.equal(reducedMotion['--ls-dur-route'], '0ms');
});

test('each role token is the documented step of its scale, in both modes', () => {
  for (const [role, [lightStep, darkStep]] of Object.entries(ROLE_STEPS)) {
    assert.equal(
      light[`--ls-${role}`],
      light[`--ls-${lightStep}`],
      `${role} (light) = ${lightStep}`,
    );
    assert.equal(
      darkPreview[`--ls-${role}`],
      darkPreview[`--ls-${darkStep}`],
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

test('dark: text, accent text and status text hold on every elevation step; the accent text is the neutral high-contrast text, 7:1 on E0 and E1', () => {
  const dark = darkPreview;
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
  // No pink in dark (A3): the accent text is the neutral text itself, with no chroma.
  assert.equal(dark['--ls-brand'], dark['--ls-text']);
  const [, a, b] = oklab(token(dark, 'brand'));
  assert.ok(Math.hypot(a, b) < 0.01, `accent text chroma ${Math.hypot(a, b).toFixed(3)} < 0.01`);
});

test('dark: white text on the accent fill and its hover, dark text on the danger fill, status text on its tint', () => {
  const dark = darkPreview;
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
    ['dark', darkPreview],
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

test('hover: never a vivid colour; one grey step on hover, the next on press; the secondary tint and the primary press keep the accent', () => {
  for (const theme of [light, darkPreview]) {
    assert.notEqual(theme['--ls-hover-bg'], theme['--ls-brand-fill']);
    assert.equal(theme['--ls-hover-text'], theme['--ls-text']);
    assert.equal(theme['--ls-hover-bg'], theme['--ls-gray-3']);
    assert.equal(theme['--ls-pressed-bg'], theme['--ls-gray-4']);
    assert.equal(
      theme['--ls-nav-hover-bg'],
      theme['--ls-hover-bg'],
      'the sidebar hovers like the rest',
    );
    assert.notEqual(theme['--ls-nav-active-bg'], theme['--ls-nav-hover-bg']);
    assert.ok(ratio(token(theme, 'hover-text'), token(theme, 'hover-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'text'), token(theme, 'pressed-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'text'), token(theme, 'row-hover-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'nav-hover-text'), token(theme, 'nav-hover-bg')) >= 4.5);
    assert.ok(ratio(token(theme, 'nav-active-text'), token(theme, 'nav-active-bg')) >= 4.5);
    // The secondary label (the accent text) holds on its hover and pressed tints; white holds on the pressed primary fill.
    for (const tint of ['secondary-hover-bg', 'secondary-pressed-bg']) {
      assert.ok(ratio(token(theme, 'brand'), token(theme, tint)) >= 4.5, tint);
    }
    assert.ok(ratio(token(theme, 'on-brand'), token(theme, 'brand-fill-pressed')) >= 4.5);
    assert.ok(ratio(token(theme, 'outline-border'), token(theme, 'bg-page')) >= 3);
  }
  assert.equal(light['--ls-row-hover-bg'], '#f5f5f7');
  assert.notEqual(light['--ls-row-hover-bg'], light['--ls-hover-bg']);
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
  assert.equal(darkPreview['--ls-overlay'], 'rgb(0 0 0 / 0.6)');
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
  assert.equal(darkPreview['--ls-scrim'], undefined, 'a photo does not follow the theme');
});

test('Q4 (session 10): the flat sign-in panel is the base colour (white / black) with the ordinary text, and the staff card is a raised step on the sunken canvas', () => {
  assert.equal(light['--ls-auth-flat'], '#ffffff');
  assert.equal(darkPreview['--ls-auth-flat'], '#000000');
  assert.equal(light['--ls-on-auth-flat'], light['--ls-text']);
  assert.equal(darkPreview['--ls-on-auth-flat'], darkPreview['--ls-text']);
  for (const theme of [light, darkPreview]) {
    assert.ok(ratio(token(theme, 'on-auth-flat'), token(theme, 'auth-flat')) >= 4.5);
    // The staff sign-in canvas is the sunken band (foundation-v2.css .ls-auth); the card on it is the raised step with a hairline.
    assert.notEqual(theme['--ls-bg-raised'], theme['--ls-bg-sunken']);
  }
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
    /:root\[data-preview-theme='dark'\]:has\(\[data-ui='v2'\]\) \{\s*--ls-bg-page: #000000;/,
  );
  assert.match(
    css,
    /:root:not\(\[data-preview-theme='light'\]\):has\(\[data-ui='v2'\]\) \{\s*--ls-bg-page: #000000;/,
  );
});
