import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SEASON_PRESETS } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeasonPresetPicker, SeasonPreview, type SeasonPreviewLabels } from './index';

// The admin season preview and preset picker (docs/UXUI_REDESIGN_DESIGN.md 20.7): two pictures (desktop and phone,
// light only since 2026-10-18), each scoped to the preset, none of them a control; and one radio card per preset.
const labels: SeasonPreviewLabels = {
  desktop: 'Desktop',
  phone: 'Phone',
  frame: (device) => device,
  accentSample: 'Accent',
  buttonSample: 'Book now',
};

const render = (presetKey: string, ornamentId: Parameters<typeof SeasonPreview>[0]['ornamentId']) =>
  renderToStaticMarkup(
    <SeasonPreview
      presetKey={presetKey}
      ornamentId={ornamentId}
      title="Lucy Spa"
      greeting="Happy New Year"
      labels={labels}
    />,
  );

test('season preview: desktop and phone, light only, scoped to the preset', () => {
  const preset = SEASON_PRESETS[0]!;
  const html = render(preset.key, preset.ornament.id);
  assert.equal([...html.matchAll(/<figure/g)].length, 2);
  const stages = [...html.matchAll(/<div class="ls-season-pstage"[^>]*>/g)].map(
    (match) => match[0],
  );
  assert.equal(stages.length, 2);
  for (const tag of stages) {
    assert.match(tag, /data-preview-theme="light"/);
    assert.match(tag, new RegExp(`data-season="${preset.key}"`));
  }
  assert.doesNotMatch(html, /data-preview-theme="dark"/);
  assert.doesNotMatch(html, /<figure[^>]*data-preview-theme/);
  for (const device of ['desktop', 'phone']) {
    assert.equal([...html.matchAll(new RegExp(`ls-season-pframe-${device}`, 'g'))].length, 1);
  }
  for (const caption of ['Desktop', 'Phone']) {
    assert.ok(html.includes(`>${caption}</figcaption>`), caption);
  }
  // The real frame and the strip are drawn in every picture, with the greeting and the brand heading.
  assert.equal([...html.matchAll(/ls-season-frame-banner/g)].length, 2);
  assert.equal([...html.matchAll(/ls-season-frame-strip/g)].length, 2);
  assert.equal([...html.matchAll(/Happy New Year/g)].length, 4);
  assert.equal([...html.matchAll(/Lucy Spa/g)].length, 2);
});

test('season preview: a picture, not a control (nothing focusable, nothing interactive, decorations hidden)', () => {
  for (const preset of SEASON_PRESETS) {
    const html = render(preset.key, preset.ornament.id);
    assert.doesNotMatch(html, /<(button|a|input|select|textarea)\b/, preset.key);
    assert.doesNotMatch(html, /tabindex|onclick/i, preset.key);
    assert.doesNotMatch(html, /<img\b/, 'no external image, no request');
    assert.ok(html.includes('aria-hidden="true"'), `${preset.key} ornaments are decorative`);
  }
});

test('season preview css: tokens only, no hex, no px/rem/em length, no motion', () => {
  const css = readFileSync(new URL('./season-preview.css', import.meta.url), 'utf8');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(code, /animation|transition|@keyframes/);
  assert.doesNotMatch(
    // Allowed: the picker's minimum card width, the 2px outline of the selected / focused card, the phone breakpoint.
    code
      .replace(/min\(100%, \d+rem\)/g, '')
      .replace(/outline(-offset)?: 2px/g, '')
      .replace(/@media \(max-width: \d+px\)/g, ''),
    /(^|[\s(,+\-*/])-?\d*\.?\d+(px|rem|em)\b/,
  );
  for (const name of new Set([...code.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!))) {
    assert.match(
      name,
      // hover-bg / pressed-bg: the card's hover and press steps (WIG interactive states), the shared tokens.
      /^--ls-(season-|space-|text|radius-|live-|bg-page$|bg-sunken$|brand$|brand-soft$|focus$|control-h$|leading-sm$|hover-bg$|pressed-bg$)/,
      `${name} is not an allowed token`,
    );
  }
  // FR1: nothing is bordered inside a card, so the picker draws its state with a tint and an outline.
  assert.doesNotMatch(code, /(^|[\s;{])border(-width|-color)?\s*:/m, 'no border declaration');
});

test('season preview: the brand button keeps the brand look; only the chip reads the accent', () => {
  const html = render('tet', 'mai-blossom');
  assert.match(html, /class="ls-btn ls-btn-primary[^"]*"[^>]*>Book now</);
  assert.match(html, /class="ls-season-pchip">Accent</);
});

test('season picker: one native radio per preset, the checked one is the value, each card is scoped to its preset', () => {
  const options = SEASON_PRESETS.map((preset) => ({
    key: preset.key,
    name: preset.name.en,
    ornamentId: preset.ornament.id,
  }));
  const html = renderToStaticMarkup(
    <SeasonPresetPicker
      name="preset"
      label="Season theme"
      options={options}
      value="christmas"
      onChange={() => undefined}
    />,
  );
  assert.match(html, /role="radiogroup" aria-label="Season theme"/);
  const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
  assert.equal(inputs.length, SEASON_PRESETS.length);
  assert.ok(inputs.every((tag) => tag.includes('type="radio"') && tag.includes('name="preset"')));
  assert.deepEqual(
    inputs.filter((tag) => tag.includes('checked')).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]),
    ['christmas'],
  );
  for (const preset of SEASON_PRESETS) {
    assert.ok(html.includes(`data-season="${preset.key}"`), preset.key);
  }
  assert.equal([...html.matchAll(/class="ls-season-card-name"/g)].length, SEASON_PRESETS.length);
  assert.doesNotMatch(html, /<(button|a)\b/);
});
