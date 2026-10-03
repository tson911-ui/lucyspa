# UX/UI Step S6f: Vietnamese display font and the full phone footer

Follow-up to S6d/S6e (Owner, 2026-10-03). Web UI only, no migration, no permission change.

## What changed

- **Font (root cause of the detached accents).** The display token `--lucy-font-display` was Georgia, which stacks
  circumflex + tone marks (ố ế ầ) wrongly on Windows. It is now self-hosted Playfair Display (normal + italic, subsets
  latin + vietnamese, `next/font/google` in `[locale]/layout.tsx`, variable `--font-playfair-display`), falling back to
  Be Vietnam Pro, never a system serif. This also covers the legacy `h1`/`.art-initial` that used the token.
- **Wording restored.** 8/3 plaque line is "Chúc mừng Quốc tế Phụ nữ 8/3" again; the "no circumflex + tone" test is
  replaced by tests for the font token, the wording, and "ố ế ữ ặ ỗ ợ" rendering intact on every kit's plaque (NFC and NFD).
- **Phone footer shows the full motif set** (header stays compact):
  - Seven panorama kits (Valentine, 8/3, 20/10, Mid-Autumn, 30/4-1/5, 2/9, Vu Lan): the same scene is drawn on a phone as
    a centre row (720 units) over two side crops, all at half scale, instead of cropping to the centre. Per-kit `split`
    in `KIT_ART` puts both cuts between motifs (measured with `.local/season-s6/extents.mjs`). Greeting sits under the art.
  - Tet: goat and crackers, then one shelf row (couplets, fruit tray, rice cakes, melons), then the band with the greeting.
  - Christmas: sleigh, then one row (tree, gifts, snowman, Santa, gifts, tree), then the greeting card.
  - Celebration: the two gift piles in a row above the card.
- **Tablets (761-1023 px) get the full footers too**: panorama kits show the whole 1440 x 300 scene at the width of the row (no crop) with the greeting under it; Tet, Christmas and Celebration use the same shelf and rows as phones at tablet sizes (taller footers: Tet 110u, Christmas 94u). Desktop is unchanged.
- **Mid-Autumn lion dance redrawn** (`season-art-lion.tsx`): head with one horn, a mirror, big round eyes with lids and
  thick lashes, open mouth with teeth and a red tongue, long beard, pom-poms; scaled cloth body with tassels over two
  dancers, only four human legs (loose trousers, cloth shoes), no stripes; plus Ong Dia (belly, wide smile, fan) and
  cymbals beside the drum. Registry motifs add `ong-dia` and `drum-cymbals`.
- **Valentine without Cupid**: centrepiece is two teddy bears hugging a heart, under a heart with an arrow whose
  heart-shaped tip points into it (the divider arrow follows). Motifs: `teddy-bears`, `arrow-heart`; the unused `wing`
  palette color is removed and `season.css` regenerated.

## Tests

`pnpm --filter @lucy-spa/ui test` and `pnpm --filter @lucy-spa/web test` (new: phone-visible motifs per kit, panorama
windows cover 0-1440, font token, layout font config, plaque marks); whole-repo `pnpm test` before the push.

## UX gate

Rendered at 360, 768, 1440 light and 1440 dark with `shots.mjs`; screenshots in `.local/uxui-screens/fin-<kit>-*`.
Opened and checked: Tet, Christmas, Mid-Autumn at 360 and 1440 light (see chat for paths); the other kits at 360.

## Open questions

None.
