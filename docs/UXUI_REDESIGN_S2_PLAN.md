# UX/UI Step S2 plan: season decoration kit

Status: PLAN APPROVED 2026-10-02 (1 = A, 2 = as recommended, 3 = OK). Base `796cdf1` (S1 approved, CI green). Contract: `UXUI_REDESIGN_DESIGN.md`
20.1-20.3, 20.5, 20.8 and the decisions in 20.10 (Q-S1 yellow only in Tet and Mid-Autumn ornaments; Q-S5 particles on, at most 24,
fewer on phones, "Turn off effects").

## Scope (S2 only)

Presentational kit in `packages/ui`: ornaments, banner frame, greeting strip, particles, and the effects switch. **Not in S2:** reading
the schedule or setting `data-season` (S5), mounting in the public and customer shells (S5), the admin greeting chip (S5), schema and API
(S3), admin screens (S4). Nothing ships visibly until S5; the kit is only exercised by tests and a temporary specimen.

## Components and files

| File (`packages/ui/src` unless noted)               | Content                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `season-ornaments.tsx`                              | One inline-SVG motif per registry `ornament.id` (8: `mai-blossom`, `pine-branch`, `hearts`, `orchid`, `pink-lotus`, `lantern`, `line-star`, `lotus`); `SeasonOrnament` renders a corner or a row of the motif. Fills only `var(--ls-season-ornament-1..3)`; no hex, no image, no request.                      |
| `season-frame.tsx`                                  | `SeasonFrame` (gradient banner from the frame tokens, ornaments in reserved side gutters, content never under an ornament) and `GreetingStrip` (one thin strip, frame text, wraps to two lines on phones). Optional `presetKey` sets `data-season` on the frame itself, so previews scope to one block (20.2). |
| `season-fx-core.ts`                                 | Pure: `ls-fx` cookie parse/serialize (same pattern as the theme cookie: 1 year, Lax, no personal data), particle pool size (24 desktop, 12 phone), deterministic particle layout from the index (no `Math.random`, so no hydration mismatch).                                                                  |
| `season-particles.tsx`                              | `SeasonParticles` (petals, snow, lanterns, hearts) and `SeasonFxToggle` (real button, `aria-pressed`, labels passed in as props so VI/EN stay in the dictionaries). Renders nothing on the server and first paint; mounts after paint.                                                                         |
| `season-decor.css` (+ `./season-decor.css` export)  | Layout for the above, tokens only; keyframes use `transform` and `opacity` only. New tokens in `tokens.css`: `--ls-dur-drift` (slow drift, the only long loop besides the skeleton) and `--ls-z-fx` (below sticky and dialogs).                                                                                |
| `packages/contracts/src/season-registry.ts`         | Adds `particle` per preset (kind or `none`); registry test extended. No CSS change.                                                                                                                                                                                                                            |
| `index.tsx`, `package.json`, `apps/web` root layout | Exports; layout imports `season-decor.css` (inert without `data-season`).                                                                                                                                                                                                                                      |
| `apps/web/src/test/ui-ratchet*`                     | New counter for `season-decor.css` spacing literals, pinned at 0.                                                                                                                                                                                                                                              |

## Behavior rules (from 20.2, made testable)

- Ornaments, particles: `aria-hidden`, `pointer-events: none`, no focusable child, never under readable text; ornaments hide on phones
  except the frame corners; no external image, no third-party script, no layout shift (fixed footprint).
- Particles: pool of at most 24 (12 under 640 px); `transform`/`opacity` only; paused while the tab is hidden (`visibilitychange`);
  **render nothing** under `prefers-reduced-motion` (checked in the component and re-checked when the setting changes) and when
  `ls-fx=off`. `ls-fx=off` hides particles only; ornaments and the greeting stay.
- Colors come only from season tokens; yellow stays inside the Tet and Mid-Autumn ornament tokens (Q-S1).

## Tests (all in `packages/ui`)

1. **Ornaments:** every registry id has a motif; output is `aria-hidden`, has no `<image>`, `<script>`, `<title>`, external URL or hex
   literal, and uses only season ornament tokens.
2. **fx-core:** cookie parse and serialize (unknown value = on), pool size by width, layout is deterministic and inside the box.
3. **Particles (jsdom):** nothing on server render and before mount; at most 24 on desktop and 12 on phone; reduced motion renders null and
   reacts to a change; `ls-fx=off` renders null; the toggle writes the cookie and removes the particles; hidden tab sets the paused
   state; presets with `particle: none` render nothing; no element is focusable.
4. **Frame and greeting:** longest greeting (80 characters, VI) wraps without overflow; text uses `frame-text` on the frame stops;
   `presetKey` sets `data-season`; the toggle is a button with an accessible name and a 40/44 px target.
5. **CSS:** `season-decor.css` has no hex, no word "gold", no px/rem literal, only `transform` and `opacity` in keyframes, and a
   `prefers-reduced-motion` rule.
6. **Specimen guard:** a test fails if the temporary specimen route still exists.
7. Also: contracts and ui typecheck, `pnpm season:css --check`, web `styles.test.ts` and `ui-ratchet.test.ts`, `pnpm lint`,
   `pnpm format:check`; whole-repo `pnpm test` before the push.

## Screenshots and gate

A **temporary** route in `apps/web` (not committed, removed before the commit; guard test above) renders all 8 presets: frame with
ornaments, greeting strip, particles, toggle. Render with `node scripts/uxui-screens.mjs` at 360, 768, 1440 light and 1440 dark, with a
wait so particles are mid-flight, plus one capture after clicking the toggle. Review against the 21 checklist (spacing on the 4 px grid,
aligned edges, no overlap with text, no horizontal scroll, 44/40 px targets), fix, re-render. Report gets the 5-line UX gate note. DOM audit
(scratch DB, built web and API, servers stopped afterwards) on dashboard and login, since the layout gains a stylesheet; no count may rise.
The Owner reviews the 8 specimens, which are the real approval of the ornament art.

## Decisions I need from the Owner

1. **Where particles fall.** (A, recommended) only inside the banner and hero band, so they can never cross body text; (B) over the whole
   page behind a very light layer. Reason for A: 20.2 says decorations never sit under readable text.
2. **Particles per preset.** Recommended: Tet petals, Christmas snow, Valentine hearts, 8/3 and 20/10 petals, Mid-Autumn lanterns,
   30/4-1/5 and 2/9 none (line-art star and lotus ornaments only, no flag red motion). Change any row if you prefer.
3. **Ornament art.** Flat vector shapes in 2-3 colors, simple and small (no illustration assets exist). Approve after seeing the 8
   specimens, not before; I will adjust shapes in the same Step if you ask.

No other open point. Stop for approval before coding.
