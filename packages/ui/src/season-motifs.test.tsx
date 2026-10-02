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
import { KIT_ART } from './season-kits';
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
  assert.deepEqual(SEASON_MOTIFS['valentine'], [
    'roses',
    'chocolates',
    'love-letters',
    'teddy-bears',
    'arrow-heart',
  ]);
  assert.equal(SEASON_MOTIFS['mid-autumn']?.length, 10);
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

test('every kit draws every motif of its list: Valentine, 8/3, 20/10, Mid-Autumn, 30/4-1/5, 2/9 and Vu Lan too', () => {
  for (const kit of SEASON_ART_KITS) {
    const drawn = motifsOf(kit, kit === 'tet' ? 'mui' : null);
    for (const motif of SEASON_MOTIFS[kit]!) assert.ok(drawn.has(motif), `${kit} lacks ${motif}`);
  }
});

test('the header rails of the S6d/S6e kits hang nine pieces, keep a subset on tablets and fewer on phones', () => {
  const railKits = SEASON_ART_KITS.filter(
    (kit) => !['tet', 'christmas', 'celebration'].includes(kit),
  );
  assert.equal(railKits.length, 7);
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
  assert.match(xmas, /ls-art-snowman[^"]*ls-art-hide-tablet/);
  assert.match(xmas, /ls-art-santa[^"]*ls-art-hide-tablet/);
  assert.match(xmas, /ls-art-sleigh"/, 'the sleigh stays at every width');
});

// Owner follow-up 2026-10-03: the header stays compact on a phone, but the phone footer shows the full motif set of the
// kit (two rows when needed). A piece is hidden on a phone by one of these classes, or by being the wide-only scene.
const PHONE_HIDDEN = /ls-art-hide-narrow|ls-art-hide-medium|ls-art-show-wide|ls-art-scene-wide/;

function footerMotifs(kit: SeasonArtKit) {
  const html = renderToStaticMarkup(
    <SeasonFooterScene kit={kit} line="x" zodiac={kit === 'tet' ? 'mui' : null} />,
  );
  const all = new Set<string>();
  const phone = new Set<string>();
  for (const tag of html.matchAll(/<svg[^>]*>/g)) {
    const motif = /data-motif="([^"]+)"/.exec(tag[0])?.[1];
    if (!motif) continue;
    const hidden = PHONE_HIDDEN.test(/class="([^"]*)"/.exec(tag[0])?.[1] ?? '');
    for (const id of motif.split(' ')) {
      all.add(id);
      if (!hidden) phone.add(id);
    }
  }
  return { html, all, phone };
}

test('the phone footer of every kit shows every motif its footer draws, none only on wide screens', () => {
  for (const kit of SEASON_ART_KITS) {
    const { all, phone } = footerMotifs(kit);
    assert.ok(all.size >= 3, `${kit}: the footer draws its motifs`);
    for (const id of all) assert.ok(phone.has(id), `${kit}: ${id} is missing on a phone`);
  }
});

test('Tet and Christmas show the pieces the wide scene spreads around: couplets, fruit tray, rice cakes, melons; Santa and snowman', () => {
  const tet = footerMotifs('tet').phone;
  for (const id of [
    'cau-doi',
    'mam-ngu-qua',
    'banh-chung',
    'banh-tet',
    'dua-hau',
    'li-xi',
    'phao-giay',
    'zodiac',
  ]) {
    assert.ok(tet.has(id), `tet phone: ${id}`);
  }
  const xmas = footerMotifs('christmas').phone;
  for (const id of ['santa', 'snowman', 'sleigh-reindeer', 'gifts', 'tree']) {
    assert.ok(xmas.has(id), `christmas phone: ${id}`);
  }
});

test('a panorama kit draws its scene on a phone as a centre row and two side crops that together cover all 1440 units', () => {
  for (const kit of SEASON_ART_KITS.filter((candidate) => KIT_ART[candidate])) {
    const { html } = footerMotifs(kit);
    const windows = (part: string) =>
      [...html.matchAll(new RegExp(`<svg[^>]*ls-art-scene-${part}[^>]*>`, 'g'))].map((match) => {
        const [x, , width] = /viewBox="([^"]+)"/.exec(match[0])![1]!.split(' ').map(Number);
        return { x: x!, width: width! };
      });
    const [mid] = windows('mid');
    const [start, end] = windows('side');
    assert.ok(mid && start && end, `${kit}: a centre row and two side crops`);
    assert.equal(start.x, 0, `${kit}: the start window begins at the left edge`);
    assert.equal(
      start.x + start.width,
      mid.x,
      `${kit}: the start window ends where the centre starts`,
    );
    assert.equal(mid.width, 720, `${kit}: the centre is half the scene`);
    assert.equal(mid.x + mid.width, end.x, `${kit}: the centre ends where the end window starts`);
    assert.equal(end.x + end.width, 1440, `${kit}: the end window reaches the right edge`);
  }
});
