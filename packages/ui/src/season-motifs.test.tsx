import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEASON_MOTIFS, SEASON_PRESETS } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SEASON_ART_KITS,
  SeasonDivider,
  SeasonFooterScene,
  SeasonHeaderRow,
  SeasonLogoAccent,
} from './season-scene';
import type { SeasonArtKit } from './season-scene';

// Owner addition 2026-10-02 (docs/UXUI_REDESIGN_S6_PLAN.md 4.1): every kit draws its iconic motifs as scenes, not just
// flowers. The list is registry data (SEASON_MOTIFS); every drawing is tagged `data-motif`; a shipped kit that lacks
// one fails here, and the kits that have no art yet already carry their list for the Step that builds them.
function motifsOf(kit: SeasonArtKit, zodiac: string | null): Set<string> {
  const html = renderToStaticMarkup(
    <>
      <SeasonHeaderRow kit={kit} />
      <SeasonLogoAccent kit={kit}>
        <span>Lucy Spa</span>
      </SeasonLogoAccent>
      <SeasonDivider kit={kit} />
      <SeasonFooterScene kit={kit} line="Lời chúc" sub="Dòng phụ" zodiac={zodiac} />
    </>,
  );
  return new Set(
    [...html.matchAll(/data-motif="([^"]+)"/g)].flatMap((match) => match[1]!.split(' ')),
  );
}

test('every preset and the two new kits carry a motif list', () => {
  for (const preset of SEASON_PRESETS) {
    assert.ok((SEASON_MOTIFS[preset.key]?.length ?? 0) >= 3, preset.key);
  }
  assert.deepEqual(SEASON_MOTIFS['vu-lan'], ['rose-on-shirt', 'hoa-dang', 'lotus']);
  assert.deepEqual(SEASON_MOTIFS['celebration'], ['balloons', 'confetti', 'ribbons', 'cake']);
  assert.deepEqual(SEASON_MOTIFS['valentine'], ['roses', 'chocolates', 'love-letters', 'cupid']);
  assert.equal(SEASON_MOTIFS['mid-autumn']?.length, 8);
});

test('Tet draws li xi, cau doi, mai, dao, banh chung, banh tet, mam ngu qua, dua hau, firecrackers, lanterns and the zodiac animal', () => {
  const drawn = motifsOf('tet', 'mui');
  for (const motif of SEASON_MOTIFS['tet']!) assert.ok(drawn.has(motif), `tet lacks ${motif}`);
});

test('Tet draws no zodiac animal for a year without art, and everything else stays', () => {
  const drawn = motifsOf('tet', 'than');
  assert.ok(!drawn.has('zodiac'));
  for (const motif of SEASON_MOTIFS['tet']!.filter((id) => id !== 'zodiac')) {
    assert.ok(drawn.has(motif), `tet lacks ${motif}`);
  }
});

test('Christmas draws Santa, snowman, sleigh with reindeer, gifts, stockings, candy canes, wreath, bells and a tree', () => {
  const drawn = motifsOf('christmas', null);
  for (const motif of SEASON_MOTIFS['christmas']!) {
    assert.ok(drawn.has(motif), `christmas lacks ${motif}`);
  }
});

test('Celebration draws balloons, confetti, ribbons and a cake', () => {
  const drawn = motifsOf('celebration', null);
  for (const motif of SEASON_MOTIFS['celebration']!) {
    assert.ok(drawn.has(motif), `celebration lacks ${motif}`);
  }
});

test('every shipped kit draws every motif of its list: Valentine, 8/3 and 20/10 too', () => {
  for (const kit of SEASON_ART_KITS) {
    const drawn = motifsOf(kit, kit === 'tet' ? 'mui' : null);
    for (const motif of SEASON_MOTIFS[kit]!) assert.ok(drawn.has(motif), `${kit} lacks ${motif}`);
  }
});

test('the header rails of the S6d kits hang nine pieces, keep a subset on tablets and fewer on phones', () => {
  const railKits = SEASON_ART_KITS.filter(
    (kit) => !['tet', 'christmas', 'celebration'].includes(kit),
  );
  assert.equal(railKits.length, 3);
  for (const kit of railKits) {
    const html = renderToStaticMarkup(<SeasonHeaderRow kit={kit} />);
    const cells = [...html.matchAll(/class="ls-art-rail-cell([^"]*)"/g)].map((match) => match[1]!);
    assert.equal(cells.length, 9, `${kit}: nine cells`);
    const phone = cells.filter((cell) => !cell.includes('ls-art-hide')).length;
    const tablet = cells.filter((cell) => !cell.includes('ls-art-hide-medium')).length;
    assert.ok(phone >= 3 && phone <= 4, `${kit}: ${phone} pieces on a phone`);
    assert.ok(tablet >= 5 && tablet <= 7, `${kit}: ${tablet} pieces on a tablet`);
  }
});

test('the phone and tablet tiers keep a subset: hidden pieces are hidden by class, never absent from the markup', () => {
  const html = renderToStaticMarkup(<SeasonFooterScene kit="tet" line="x" zodiac="mui" />);
  for (const cls of ['ls-art-couplet', 'ls-art-tray', 'ls-art-cakes', 'ls-art-melons']) {
    assert.match(html, new RegExp(`${cls}[^"]*ls-art-hide-medium`), `${cls} drops on tablets`);
  }
  assert.match(
    html,
    /ls-art-pile-start ls-art-only-compact/,
    'the left li xi shows on compact only',
  );
  assert.match(html, /ls-art-animal/, 'the zodiac animal stays at every width');
  const xmas = renderToStaticMarkup(<SeasonFooterScene kit="christmas" line="x" />);
  assert.match(xmas, /ls-art-snowman[^"]*ls-art-hide-medium/);
  assert.match(xmas, /ls-art-santa[^"]*ls-art-hide-medium/);
  assert.match(xmas, /ls-art-sleigh"/, 'the sleigh stays at every width');
});
