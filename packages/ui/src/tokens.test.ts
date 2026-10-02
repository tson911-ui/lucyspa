import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The CSS file is the source of truth; these tests assert the contract in
// docs/UXUI_REDESIGN_DESIGN.md 6.2 and 6.5 against it (WCAG 2.x contrast).
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function declarations(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]!] = match[2]!.replace(/\s+/g, ' ').trim();
  }
  return tokens;
}

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

const light = block(/^:root\s*\{/m);
const darkAttribute = block(/^:root\[data-theme=['"]dark['"]\]\s*\{/m);
const darkSystem = block(/:root:not\(\[data-theme=['"]light['"]\]\)\s*\{/m);
const dark = darkAttribute;

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

const color = (theme: Record<string, string>, name: string): string => {
  const value = theme[`--ls-${name}`];
  assert.match(value ?? '', /^#[0-9a-f]{6}$/, `--ls-${name} must be a 6-digit hex`);
  return value!;
};

const themes = { light, dark } as const;

test('dark tokens are declared identically for the toggle and for system preference', () => {
  assert.deepEqual(darkSystem, darkAttribute);
  // Every color token that has a light value has a dark value.
  const colorTokens = Object.keys(light).filter(
    (name) =>
      /^--ls-(?!font|text-(xs|sm|md|lg|xl|2xl))/.test(name) && /^#|^rgb|^none/.test(light[name]!),
  );
  for (const name of colorTokens) assert.ok(name in dark, `${name} missing in dark`);
});

test('no gold or yellow token remains', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, /gold|ivory|amber|yellow/i);
});

for (const [themeName, theme] of Object.entries(themes)) {
  test(`${themeName}: text is at least 4.5:1 on every surface it appears on`, () => {
    const surfaces = ['bg-page', 'bg-surface', 'bg-raised', 'bg-sunken'];
    for (const text of ['text', 'text-muted', 'text-subtle', 'brand']) {
      for (const surface of surfaces) {
        const value = ratio(color(theme, text), color(theme, surface));
        assert.ok(value >= 4.5, `${themeName} ${text} on ${surface} = ${value.toFixed(2)}`);
      }
    }
    for (const text of ['text', 'text-muted', 'text-subtle', 'brand-on-soft']) {
      const value = ratio(color(theme, text), color(theme, 'brand-soft'));
      assert.ok(value >= 4.5, `${themeName} ${text} on brand-soft = ${value.toFixed(2)}`);
    }
  });

  test(`${themeName}: brand fills carry readable text`, () => {
    for (const fill of ['brand-fill', 'brand-fill-hover']) {
      const value = ratio(color(theme, 'on-brand'), color(theme, fill));
      assert.ok(value >= 4.5, `${themeName} on-brand on ${fill} = ${value.toFixed(2)}`);
    }
    assert.ok(ratio(color(theme, 'on-danger'), color(theme, 'danger')) >= 4.5);
  });

  test(`${themeName}: status colors are readable on their tint and on surfaces`, () => {
    for (const status of ['danger', 'success', 'warning', 'info']) {
      for (const surface of [`${status}-bg`, 'bg-surface', 'bg-page']) {
        const value = ratio(color(theme, status), color(theme, surface));
        assert.ok(value >= 4.5, `${themeName} ${status} on ${surface} = ${value.toFixed(2)}`);
      }
    }
  });

  test(`${themeName}: control boundary and focus ring are at least 3:1`, () => {
    for (const surface of ['bg-page', 'bg-surface', 'bg-sunken']) {
      for (const boundary of ['border-control', 'focus']) {
        const value = ratio(color(theme, boundary), color(theme, surface));
        assert.ok(value >= 3, `${themeName} ${boundary} on ${surface} = ${value.toFixed(2)}`);
      }
    }
  });

  test(`${themeName}: hover text is at least 4.5:1 on the solid hover fill, which is itself 3:1 on every surface`, () => {
    const value = ratio(color(theme, 'hover-text'), color(theme, 'hover-bg'));
    assert.ok(value >= 4.5, `${themeName} hover-text on hover-bg = ${value.toFixed(2)}`);
    for (const surface of ['bg-surface', 'bg-page', 'bg-sunken', 'bg-raised']) {
      const edge = ratio(color(theme, 'hover-bg'), color(theme, surface));
      assert.ok(edge >= 3, `${themeName} hover-bg on ${surface} = ${edge.toFixed(2)}`);
    }
    // A destructive hover is the same solid rule in the danger color.
    assert.ok(ratio(color(theme, 'on-danger'), color(theme, 'danger')) >= 4.5);
    // The hover border is the fill itself; its boundary is the same 3:1.
    assert.ok(ratio(color(theme, 'hover-border'), color(theme, 'hover-bg')) >= 1);
    // A whole table row keeps a subtle tint: ordinary text and the brand link both stay readable on it.
    for (const text of ['text', 'brand']) {
      const row = ratio(color(theme, text), color(theme, 'row-hover-bg'));
      assert.ok(row >= 4.5, `${themeName} ${text} on row-hover-bg = ${row.toFixed(2)}`);
    }
  });

  test(`${themeName}: the six chart series clear 3:1 on the chart surface`, () => {
    const surface = color(theme, 'chart-surface');
    for (let slot = 1; slot <= 6; slot++) {
      const value = ratio(color(theme, `chart-${slot}`), surface);
      assert.ok(value >= 3, `${themeName} chart-${slot} = ${value.toFixed(2)}`);
    }
    assert.ok(ratio(color(theme, 'chart-other'), surface) >= 3);
  });
}

test('contract 6.2 ratios are reproduced (one decimal, as published)', () => {
  const published: Array<[Record<string, string>, string, string, number]> = [
    [light, 'text', 'bg-surface', 17.0],
    [dark, 'text', 'bg-surface', 15.3],
    [light, 'text-muted', 'bg-surface', 7.9],
    [dark, 'text-muted', 'bg-surface', 9.0],
    [light, 'text-subtle', 'bg-surface', 5.9],
    [dark, 'text-subtle', 'bg-surface', 6.2],
    [light, 'border-control', 'bg-surface', 3.9],
    [dark, 'border-control', 'bg-surface', 3.6],
    [light, 'brand', 'bg-surface', 9.6],
    [dark, 'brand', 'bg-surface', 7.0],
    [light, 'on-brand', 'brand-fill-hover', 11.6],
    [dark, 'on-brand', 'brand-fill-hover', 8.6],
    [light, 'danger', 'bg-surface', 6.5],
    [dark, 'danger', 'bg-surface', 8.3],
    [light, 'danger', 'danger-bg', 5.7],
    [dark, 'danger', 'danger-bg', 7.1],
    [light, 'warning', 'warning-bg', 6.2],
    [dark, 'warning', 'warning-bg', 8.1],
    [light, 'info', 'info-bg', 7.0],
    [dark, 'info', 'info-bg', 7.6],
  ];
  for (const [theme, foreground, background, expected] of published) {
    const actual = ratio(color(theme, foreground), color(theme, background));
    assert.ok(
      Math.abs(actual - expected) < 0.1,
      `${foreground} on ${background}: expected ${expected}, got ${actual.toFixed(2)}`,
    );
  }
});

test('hover, whole app: solid brand fill with on-brand text (light #782b37 + white, dark primary fill + on-primary)', () => {
  assert.equal(light['--ls-hover-bg'], '#782b37');
  assert.equal(light['--ls-hover-text'], '#ffffff');
  assert.equal(light['--ls-hover-bg'], light['--ls-brand-fill']);
  assert.equal(light['--ls-hover-text'], light['--ls-on-brand']);
  assert.equal(dark['--ls-hover-bg'], dark['--ls-brand-fill']);
  assert.equal(dark['--ls-hover-text'], dark['--ls-on-brand']);
  for (const theme of [light, dark]) {
    assert.equal(theme['--ls-hover-border'], theme['--ls-hover-bg']);
    assert.equal(theme['--ls-hover-ghost-border'], theme['--ls-hover-bg']);
    // The sidebar tokens are the same fill; one rule everywhere.
    assert.equal(theme['--ls-nav-hover-bg'], theme['--ls-hover-bg']);
    assert.equal(theme['--ls-nav-hover-text'], theme['--ls-hover-text']);
  }
  // The one exception: a whole table row keeps a subtle tint, never the solid fill.
  assert.notEqual(light['--ls-row-hover-bg'], light['--ls-hover-bg']);
  assert.notEqual(dark['--ls-row-hover-bg'], dark['--ls-hover-bg']);
  assert.deepEqual(darkSystem, darkAttribute);
});

test('sidebar items: solid brand fill with its on-brand text in both themes (light red + white, dark primary fill + on-primary)', () => {
  assert.equal(light['--ls-nav-hover-bg'], '#782b37', 'the Owner brand red');
  assert.equal(light['--ls-nav-hover-text'], '#ffffff');
  assert.equal(light['--ls-nav-active-bg'], light['--ls-nav-hover-bg']);
  assert.equal(light['--ls-nav-active-text'], '#ffffff');
  assert.equal(dark['--ls-nav-hover-bg'], dark['--ls-brand-fill'], 'the primary button fill');
  assert.equal(dark['--ls-nav-hover-text'], dark['--ls-on-brand'], 'the primary button text');
  assert.equal(dark['--ls-nav-active-bg'], dark['--ls-nav-hover-bg']);
  assert.equal(dark['--ls-nav-active-text'], dark['--ls-nav-hover-text']);
  assert.equal(dark['--ls-nav-active-bar'], 'transparent', 'the fill carries it');
  assert.deepEqual(darkSystem, darkAttribute);
  for (const [name, theme] of Object.entries(themes)) {
    for (const state of ['hover', 'active']) {
      const value = ratio(color(theme, `nav-${state}-text`), color(theme, `nav-${state}-bg`));
      assert.ok(value >= 4.5, `${name} nav ${state} = ${value.toFixed(2)}`);
    }
    // The group header (brand text) reads on the sidebar surface, and on its own hover fill.
    for (const surface of ['bg-surface', 'nav-hover-bg']) {
      const text = surface === 'nav-hover-bg' ? 'nav-hover-text' : 'brand';
      assert.ok(
        ratio(color(theme, text), color(theme, surface)) >= 4.5,
        `${name} ${text}/${surface}`,
      );
    }
  }
});

test('brand red and danger red stay distinct in both themes (contract 6.4)', () => {
  for (const theme of [light, dark]) {
    assert.notEqual(color(theme, 'brand'), color(theme, 'danger'));
    assert.notEqual(color(theme, 'brand-soft'), color(theme, 'danger-bg'));
  }
});

test('auth brand panel: text is at least 4.5:1 on both gradient stops in both themes', () => {
  for (const [themeName, theme] of Object.entries(themes)) {
    for (const text of ['auth-panel-text', 'auth-panel-text-muted']) {
      for (const stop of ['auth-panel-from', 'auth-panel-to']) {
        const value = ratio(color(theme, text), color(theme, stop));
        assert.ok(value >= 4.5, `${themeName} ${text} on ${stop} = ${value.toFixed(2)}`);
      }
    }
  }
});
