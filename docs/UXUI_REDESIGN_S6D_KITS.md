# UX/UI Step S6d: Valentine, 8/3 and 20/10 kits (plus the shared kit engine)

Status: implemented on base `d3ac883`. Plan and locked decisions: `UXUI_REDESIGN_S6_PLAN.md` (sections 3, 4, 4.1, 11). Web UI only: no API, schema, migration or permission change (a kit is a registry entry plus art; `preset_key` is validated by the API against the registry).

## What changed

- **Shared engine**: `season-kits.tsx` is one table (`KIT_ART`) that gives every new kit a header rail, corner, logo accent, divider centrepiece, footer scene and particle glyph; `season-scene.tsx` and `season-site-fx.tsx` look a kit up there, Tet, Christmas and Celebration keep their own placed pieces. `season-art-shapes.tsx` holds the shared drawing primitives (heart, rose, lotus, leaf, bow, gift box, star, sparkle, flag, the rail row and cord). New CSS: `.ls-art-rail` (nine equal columns; a cell that a smaller screen drops carries `ls-art-hide-narrow` or `ls-art-hide-medium`), `.ls-art-scene`, logo accents, non-spinning particles for the petal and heart kits.
- **Footer scene = one SVG** (1440 x 300) cropped to its centre (`xMidYMax slice`): the middle 400 units are a complete picture for a phone, a tablet sees more, a desktop everything. Nothing is positioned per breakpoint.
- **Valentine** (`season-art-valentine.tsx`): heart bunting with roses and love letters on a cord; rose branches with a bow in the corners; a heart tied with a bow by the logo; a heart pierced by an arrow between two rosebuds as the divider; the footer has cupid in flight with his bow, a heart-shaped box of chocolates, a bundle of love letters, rose bouquets and heart balloons. Motifs: roses, chocolates, love-letters, cupid.
- **8/3** and **20/10** (`season-art-women.tsx`, one set, a variant per kit): flower garland with gift boxes and hanging non la (orchids for 8/3, inverted lotus lanterns for 20/10); flower spray corners; small bouquet or lotus bud by the logo; footer with a wrapped bouquet, gift boxes, a non la, two women in ao dai (stylised, faceless; one in a non la, one with flowers) and flower beds (tulips, or lotus patches). Motifs: bouquets, ao-dai, non-la, gift-boxes.
- **Plaque lines** avoid circumflex plus tone marks (Georgia italic on Windows draws those accents detached); a test guards every kit. Subs are short so they do not wrap on a phone.
- Registry: art palettes (light and dark, no yellow) and footer lines for the three kits; `season.css` regenerated.

## Tests and checks

New or extended: art palettes and "no unused or missing color" for the three kits, no yellow, plaque contrast, plaque-line diacritic guard, motif coverage per kit (`data-motif`), rail cell counts (nine cells, 3-4 on a phone, 5-7 on a tablet), decorative-only markup for every kit, `season-art.css` token test. Typecheck, lint, `pnpm format:check`, whole-repo `pnpm test` before the push (see the commit and CI).

## UX gate (real web app over a stub API with an active season; images opened)

1. Rendered 360/768/1440 light and 1440 dark for each kit; header and footer crops of every render opened and checked: rows on the 4 px unit, no horizontal scroll, text never on art (greeting on its plaque), phone drops pieces and never shrinks text, dark theme legible.
2. Fixed during the gate: rose swirl read as a face (redrawn), hat and gifts hidden behind the plaque on a phone, plaque sub wrapped with an orphan word, "Quốc tế" drew a detached accent (line reworded).
3. DOM audit with and without a season (all kits): no count above the no-season baseline (see the final chat message).

## Deploy / open questions

Web only. Open: none (the Owner reviews the art; changing a motif is a drawing edit, no data change).
