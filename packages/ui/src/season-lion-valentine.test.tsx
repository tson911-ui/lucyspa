import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SEASON_MOTIFS } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutumnScene } from './season-art-autumn';
import { LionDance, OngDia } from './season-art-lion';
import { ValentineScene } from './season-art-valentine';
import {
  SeasonDivider,
  SeasonFooterScene,
  SeasonHeaderRow,
  SeasonLogoAccent,
} from './season-scene';

// Owner follow-up 2026-10-03: the Mid-Autumn lion is a proper Vietnamese lion dance (one horn, a mirror, big eyes,
// open mouth with a tongue, a beard, a cloth body over two dancers whose four human legs are all that shows) with
// Ong Dia, a drum and cymbals; Valentine has no Cupid any more: teddy bears hugging a heart and a heart with an arrow.
const count = (html: string, part: string): number =>
  [...html.matchAll(new RegExp(`data-part="${part}"`, 'g'))].length;

test('the lion dance has one horn, one mirror, two eyes, a beard, a tongue and exactly four human legs', () => {
  const html = renderToStaticMarkup(
    <svg>
      <LionDance />
    </svg>,
  );
  assert.match(html, /data-motif="lion-dance"/);
  assert.equal(count(html, 'horn'), 1, 'a single horn');
  assert.equal(count(html, 'mirror'), 1, 'a mirror on the forehead');
  assert.equal(count(html, 'eye'), 2, 'two big eyes');
  assert.ok(count(html, 'beard') >= 5, 'a long beard of several strands');
  assert.equal(count(html, 'tongue'), 1, 'a red tongue in the open mouth');
  assert.equal(count(html, 'leg'), 4, 'two dancers, two legs each, and no animal legs');
});

test('Ong Dia, a drum and cymbals stand beside the lion in the Mid-Autumn scene', () => {
  assert.match(
    renderToStaticMarkup(
      <svg>
        <OngDia />
      </svg>,
    ),
    /data-motif="ong-dia"/,
  );
  const scene = renderToStaticMarkup(<AutumnScene />);
  for (const motif of ['lion-dance', 'ong-dia', 'drum-cymbals']) {
    assert.ok(scene.includes(`data-motif="${motif}"`), `Mid-Autumn scene: ${motif}`);
    assert.ok(SEASON_MOTIFS['mid-autumn']!.includes(motif), `registry lists ${motif}`);
  }
});

test('Valentine has no Cupid anywhere; it draws teddy bears hugging a heart and a heart with an arrow', () => {
  assert.ok(!SEASON_MOTIFS['valentine']!.includes('cupid'));
  assert.deepEqual(SEASON_MOTIFS['valentine'], [
    'roses',
    'chocolates',
    'love-letters',
    'teddy-bears',
    'arrow-heart',
  ]);
  const html = renderToStaticMarkup(
    <>
      <SeasonHeaderRow kit="valentine" />
      <SeasonLogoAccent kit="valentine">
        <span>Lucy Spa</span>
      </SeasonLogoAccent>
      <SeasonDivider kit="valentine" />
      <SeasonFooterScene kit="valentine" line="x" />
      <ValentineScene />
    </>,
  );
  assert.doesNotMatch(html, /cupid/i);
  assert.match(html, /data-motif="teddy-bears"/);
  assert.match(html, /data-motif="arrow-heart"/);
  assert.equal(
    readFileSync(new URL('./season-art-valentine.tsx', import.meta.url), 'utf8').match(/cupid/i),
    null,
    'no Cupid drawing is left in the source',
  );
});

test('the Valentine arrow ends in a heart that points into the big heart (tip rotated to the arrow direction)', () => {
  const source = readFileSync(new URL('./season-art-valentine.tsx', import.meta.url), 'utf8');
  const arrow = source.slice(
    source.indexOf('function ArrowHeart'),
    source.indexOf('/** A heart-shaped box'),
  );
  assert.match(arrow, /rotate\(143\.13\)/, 'the arrow comes in from the upper right');
  assert.match(
    arrow,
    /<Heart fill="rose3"[^>]*r=\{-90\}/,
    'the tip is a heart turned to point along the shaft',
  );
});
