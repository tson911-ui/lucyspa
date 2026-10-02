# UX/UI Step S6e: Mid-Autumn, 30/4-1/5, 2/9 and Vu Lan kits

Status: implemented on top of S6d. Plan and locked decisions: `UXUI_REDESIGN_S6_PLAN.md` (sections 4, 4.1, 11; decision 6 for Vu Lan). With this Step every one of the ten kits has site-wide art. No API behaviour, schema, migration or permission change: Vu Lan is a registry entry (the API accepts any registry key, the database checks only its format).

## What changed

- **Mid-Autumn** (`season-art-autumn.tsx`): star lanterns, carp lanterns and spinning (keo quan) lanterns hanging on a cord; clouds with the jade rabbit and mooncakes (one cut open) in the corners; the full moon by the logo; footer: the full moon with the banyan, Chu Cuoi at its foot and Chi Hang floating beside it, the jade rabbit, a plate of mooncakes, lanterns on sticks, a spinning lantern, a drum and the lion dance. Drifting particles are small star lanterns that **rise** slowly. Yellow allowed (Q-S1).
- **30/4-1/5 and 2/9** (`season-art-national.tsx`, one set, a variant per kit): star-on-red pennant bunting with yellow stars; static fireworks and flags on poles in the corners; a flag (30/4) or a dove (2/9) by the logo; footer: bunting across the top, fireworks, flags on poles, lotus ponds, peace doves; 30/4 puts a big firework in the middle between two doves, 2/9 a large dove with an olive branch between two lotus. No particles. Yellow allowed.
- **Vu Lan** (`season-art-vulan.tsx`), new kit `vu-lan`: calm, no yellow, no fireworks or balloons. Lotus lanterns (hoa dang) floating on a water line along the header; lotus corners; a rose pinned on a shirt (hoa hong cai ao) by the logo; footer: a still pond with lotus, floating lanterns and the rose-on-shirt on a round badge on each side. Registry: accent and frame tokens (teal, contrast tested), ornament thumbnail `lotus-lantern`, lunar holiday (the Owner types the days), `particlesDefault: false`: a new Vu Lan season starts with the particles switch off (slow floating lanterns are an option; the density control applies).
- **S5 band retired**: every kit has site art, so the S5 `SeasonBand` (and its preview copy and `seasonBandSpec`) could never render; removed, with its two tests. The admin "no art" notes stay for an unknown key.
- Registry: palettes (light and dark), footer lines, `vu-lan` key and ornament id; `season.css` regenerated. UI: keyframes `rise`, the header water line.

## Tests and checks

New or extended: all ten kits in the registry/scene/palette tests; yellow exists only in Tet, Mid-Autumn, 30/4-1/5 and 2/9 (Vu Lan and Celebration none); every kit draws every motif of its list; rail cell counts; plaque-line diacritic guard; Vu Lan accent/frame contrast (the existing preset contrast tests); `emptySeasonForm('vu-lan')` starts with particles off; API unit test that `vu-lan` is accepted. Typecheck, lint, `pnpm format:check`, whole-repo `pnpm test` before the push.

## UX gate (real web app over a stub API; images opened)

1. 360/768/1440 light and 1440 dark for each kit; header and footer crops opened; Vu Lan also with particles on.
2. Fixed during the gate: lantern cut by the tablet crop, plaque subs wrapped with an orphan word, Chu Cuoi too small, non la behind the plaque.
3. DOM audit with and without a season: no count above the baseline (see the final chat message).

## Deploy / open questions

Production deploy: `docs/DEPLOY_S6_RUNBOOK.md` (one additive migration from S6b). Open: none.
