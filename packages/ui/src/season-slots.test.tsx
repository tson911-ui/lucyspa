import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SeasonDivider,
  SeasonFooterScene,
  SeasonHeaderRow,
  SeasonLogoAccent,
  SeasonStrip,
  SeasonTintImage,
  safeImageUrl,
} from './season-scene';
import { previewScale, SEASON_PREVIEW_WIDTH } from './season-live-preview';

// Per-event slot options (docs/UXUI_REDESIGN_S6_PLAN.md section 6, S6b): a switched-off slot draws nothing and takes no
// room, a media-library image replaces a slot's drawing, and a bad address never becomes a request.
const id = '2f1b2d8e-5c3a-4b7a-9d2e-1a2b3c4d5e6f';
const url = (variant: string) => `/api/v1/public/media/${id}/${variant}`;
const kits = ['tet', 'christmas', 'celebration'] as const;

test('safeImageUrl accepts only a same-origin path of plain URL characters', () => {
  assert.equal(safeImageUrl(url('lg')), url('lg'));
  for (const bad of [
    undefined,
    null,
    '',
    'https://evil.example/x.png',
    '//evil.example/x.png',
    'javascript:alert(1)',
    '/x"onerror="alert(1)',
    '/x.png)',
    '/x y.png',
    '/a\\b.png',
    "/x'.png",
    'data:image/png;base64,AAAA',
  ]) {
    assert.equal(safeImageUrl(bad), undefined, String(bad));
  }
});

test('the header row: header and corners switch independently; both off render nothing', () => {
  for (const kit of kits) {
    const both = renderToStaticMarkup(<SeasonHeaderRow kit={kit} />);
    assert.match(both, /ls-art-corner-start/);
    assert.match(both, /ls-art-corner-end/);
    const noCorners = renderToStaticMarkup(<SeasonHeaderRow kit={kit} corners={false} />);
    assert.doesNotMatch(noCorners, /ls-art-corner/);
    assert.match(noCorners, /ls-art-row ls-art-header/, `${kit}: the rail alone keeps its row`);
    const noHeader = renderToStaticMarkup(<SeasonHeaderRow kit={kit} header={false} />);
    assert.match(noHeader, /ls-art-corner-start/);
    assert.doesNotMatch(noHeader, /ls-art-lanterns|ls-art-lights|ls-art-bunting/);
    assert.equal(
      renderToStaticMarkup(<SeasonHeaderRow kit={kit} header={false} corners={false} />),
      '',
      `${kit}: no row, no height`,
    );
  }
});

test('images replace drawings: header repeats, corners are one picture mirrored, all aria-hidden and lazy', () => {
  const html = renderToStaticMarkup(
    <SeasonHeaderRow kit="tet" images={{ header: url('lg'), corners: url('md') }} />,
  );
  assert.match(
    html,
    new RegExp(`ls-art-header-image" style="background-image:url\\(&quot;${url('lg')}`),
  );
  assert.doesNotMatch(html, /ls-art-lanterns|ls-art-corner-start/, 'the drawings are replaced');
  assert.equal([...html.matchAll(/<img /g)].length, 2, 'one corner picture, used twice');
  assert.match(html, /ls-art-corner-image-top-start/);
  assert.match(html, /ls-art-corner-image-top-end/);
  assert.match(html, /alt=""/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /aria-hidden="true"/);
  // A bad address falls back to the kit's own art, never a request.
  const bad = renderToStaticMarkup(
    <SeasonHeaderRow kit="tet" images={{ header: 'https://evil.example/x.png' }} />,
  );
  assert.doesNotMatch(bad, /evil|<img |background-image/);
  assert.match(bad, /ls-art-lanterns/);
});

test('the logo accent: off draws the plain wordmark; an image replaces the drawing', () => {
  const word = <span>Lucy Spa</span>;
  for (const kit of kits) {
    assert.equal(
      renderToStaticMarkup(
        <SeasonLogoAccent kit={kit} enabled={false}>
          {word}
        </SeasonLogoAccent>,
      ),
      '<span>Lucy Spa</span>',
    );
    assert.match(
      renderToStaticMarkup(<SeasonLogoAccent kit={kit}>{word}</SeasonLogoAccent>),
      /ls-art-logo-art/,
    );
  }
  const image = renderToStaticMarkup(
    <SeasonLogoAccent kit="celebration" image={url('md')}>
      {word}
    </SeasonLogoAccent>,
  );
  assert.match(image, /data-image="true"/);
  assert.match(image, /<img class="ls-art-logo-image"/);
  assert.doesNotMatch(image, /data-motif/);
});

test('dividers: off keeps one plain rule (the rhythm stays); an image repeats along the rule', () => {
  for (const kit of kits) {
    const plain = renderToStaticMarkup(<SeasonDivider kit={kit} plain />);
    assert.equal([...plain.matchAll(/ls-art-divider-line/g)].length, 1);
    assert.doesNotMatch(plain, /ls-art-divider-art|data-motif/);
    const drawn = renderToStaticMarkup(<SeasonDivider kit={kit} />);
    assert.equal([...drawn.matchAll(/ls-art-divider-line/g)].length, 2);
    assert.match(drawn, /ls-art-divider-art/);
  }
  const image = renderToStaticMarkup(<SeasonDivider kit="tet" image={url('lg')} />);
  assert.match(image, /ls-art-divider-image/);
  assert.doesNotMatch(image, /ls-art-divider-art/);
  assert.equal(
    renderToStaticMarkup(<SeasonDivider kit="tet" plain image={url('lg')} />).includes(
      'divider-image',
    ),
    false,
    'plain wins over an image',
  );
});

test('the strip: no greeting keeps only the effects switch, bare; nothing at all without a switch', () => {
  const full = renderToStaticMarkup(
    <SeasonStrip greeting="Chúc mừng" label="Mùa lễ" tools={<button>Tắt</button>} />,
  );
  assert.match(full, /ls-art-strip"/);
  assert.match(full, /Chúc mừng/);
  const bare = renderToStaticMarkup(
    <SeasonStrip greeting={null} label="Mùa lễ" tools={<button>Tắt</button>} />,
  );
  assert.match(bare, /ls-art-strip-bare/);
  assert.doesNotMatch(bare, /ls-art-strip"|Chúc mừng/);
  assert.equal(renderToStaticMarkup(<SeasonStrip greeting={null} label="Mùa lễ" />), '');
});

test('the footer scene: art and greeting switch independently; both off render nothing; a corner image fills the bottom corners', () => {
  for (const kit of kits) {
    const full = renderToStaticMarkup(<SeasonFooterScene kit={kit} line="Chúc" sub="mừng" />);
    assert.match(full, /ls-art-footer-art/);
    assert.match(full, /ls-art-plaque-line/);
    const noGreeting = renderToStaticMarkup(
      <SeasonFooterScene kit={kit} line="Chúc" greeting={false} />,
    );
    assert.match(noGreeting, /ls-art-footer-art/);
    assert.doesNotMatch(noGreeting, /ls-art-plaque|Chúc/);
    const noArt = renderToStaticMarkup(<SeasonFooterScene kit={kit} line="Chúc" art={false} />);
    assert.match(noArt, /data-compact="true"/);
    assert.doesNotMatch(noArt, /ls-art-footer-art/);
    assert.match(noArt, /data-plaque="card"/, `${kit}: a plaque with no scene is a card`);
    assert.equal(
      renderToStaticMarkup(
        <SeasonFooterScene kit={kit} line="Chúc" art={false} greeting={false} />,
      ),
      '',
    );
  }
  const corners = renderToStaticMarkup(
    <SeasonFooterScene
      kit="christmas"
      line="x"
      art={false}
      corners
      images={{ corners: url('md') }}
    />,
  );
  assert.match(corners, /ls-art-corner-image-bottom-start/);
  assert.match(corners, /ls-art-corner-image-bottom-end/);
  const image = renderToStaticMarkup(
    <SeasonFooterScene kit="tet" line="x" images={{ footer: url('lg') }} zodiac="mui" />,
  );
  assert.match(image, /ls-art-footer-image/);
  assert.doesNotMatch(image, /ls-art-band|ls-art-animal/, 'the drawing is replaced');
  assert.match(
    image,
    /data-plaque="card"/,
    'the Tet band is part of the drawing, so the plaque becomes a card',
  );
});

test('the tint image is a decorative background; a bad address draws nothing', () => {
  assert.match(renderToStaticMarkup(<SeasonTintImage image={url('lg')} />), /aria-hidden="true"/);
  assert.equal(renderToStaticMarkup(<SeasonTintImage image="https://evil.example/x" />), '');
  assert.equal(renderToStaticMarkup(<SeasonTintImage />), '');
});

test('every drawing of the three kits stays decorative: aria-hidden, nothing focusable, no link or script', () => {
  for (const kit of kits) {
    const html = renderToStaticMarkup(
      <>
        <SeasonHeaderRow kit={kit} />
        <SeasonDivider kit={kit} />
        <SeasonFooterScene kit={kit} line="x" />
      </>,
    );
    assert.doesNotMatch(html, /<a |<button|tabindex|<script|href=/);
    assert.ok(html.includes('aria-hidden="true"'));
  }
});

test('the live preview frame fits to the column and never grows past true size', () => {
  assert.equal(SEASON_PREVIEW_WIDTH.desktop, 1440);
  assert.equal(SEASON_PREVIEW_WIDTH.phone, 390);
  assert.equal(previewScale(720, 1440), 0.5);
  assert.equal(previewScale(2000, 1440), 1);
  assert.equal(previewScale(0, 1440), 1, 'unmeasured: true size');
  assert.equal(previewScale(300, 390), 300 / 390);
});
