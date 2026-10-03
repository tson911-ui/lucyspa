# Part 2 follow-up: Owner review of the live site (2026-10-04)

Eight review items plus the "Vì sao chọn" addition, in one pass. The Lovable site now answers "No published build", so the reference screenshots are the ones taken on 2026-10-03 (`.local/uxui-screens/ref-home-*`). Only layout and type were copied, never its text or data.

## What changed

1. **Header hover:** the pill behind the current menu entry turns the solid hover fill with it (light `#782b37` + white, dark pink + dark text); before, white text sat on the pale pill.
2. **Theme button:** three states again, Light (sun) → Dark (moon) → Auto (clock) → Light; Auto is light 06:00-17:59 and dark 18:00-05:59, the staff rule.
3. **Tooltips:** header tooltips open below the button and stay hidden while the account menu is open.
4. **Facts strip:** equal columns across the content width, each fact centred; Admin > Shop info: show/hide the strip, hide each built-in item, add/edit/delete custom lines (VI/EN text, icon), reorder everything. Address opens the Owner's map link, hotline dials.
5. **Cards:** group cards, service cards and booking choices share one motion (lift, 1.5% zoom, deeper shadow, dip on press, soft settle); tokens `--ls-card-lift/zoom`, zero under reduced motion.
6. **Featured groups:** matches the reference (centred title, 3 cards per row from 1024 px, description under the name, 3 services, muted regular-weight right-aligned prices, "từ 5.000 ₫/ngón" on one line, "Xem tất cả →" under the list, cards as tall as their content, whole card clickable). Admin: choose groups, order, description VI/EN. None chosen = every group, no descriptions (the old behaviour).
7. **"Ghé thăm Lucy Spa" section removed** (hours/address/hotline stay in the facts strip and footer).
8. **Footer and logo:** serif logo (header and footer), three equal columns (brand + tagline, Liên hệ, Liên kết), serif headings, real data.
9. **"Vì sao chọn" section** (supersedes decision Q-P2-3 at the Owner's request): below the groups, 3 cards per row, icon in a soft round badge, serif heading, text. Off and empty until the Owner writes it (nothing seeded). Admin: on/off, title VI/EN, cards (heading + text VI/EN, 12 line icons that follow light/dark), reorder, delete. Turning it on needs both titles and one card.

## Database

**One additive migration, `20261025000000_uxui_part2_facts_groups`:** 7 columns on `website_shop_info` (all defaulted: strip visible, lists `[]`, section off) and one CHECK on list shape and size. No data change, no permission change, no new env var. Run `db:deploy` before restarting API and web; rollback = redeploy the previous commit (columns can stay).

## Checks

- `pnpm check` (format, lint, typecheck, tests, build): UI 418, web 437, API 207 (+ integration skipped), server 35, worker 15, all pass. `pnpm smoke` run separately.
- Integration on the throw-away DB: shop info 10/10 (new subtest: defaults, saved lists, per-language public view, refusals by name), database foundation 1/1 (new CHECK cases).
- Real app (scratch DB): pointer checks (hover colours as computed values, tooltip position, theme cycle, dialogs never save the page form, add/hide/save/reload round trip, public API per language); DOM audit and axe 0 on home VI/EN, service detail, services, Shop info tab at 360/768/1440 light and dark.

## UX gate

Screens at 360/768/1440 light and 360/768/1440 dark were opened and compared next to the Lovable captures (header, groups, why-us, footer; sheets `cmp-*`): same structure, spacing and type roles. Differences kept on purpose: our facts strip (the reference has none), our nav (VI/EN switch, no cosmetics entry), real shop data. The reference has no dark mode, so dark was reviewed on its own. At 768 three cards fall 2 + 1 (a third column would squeeze prices).

## Open for the Owner

- Headless-browser note for the tooling: a long-lived tab sometimes measures a page before React swaps in its loading fallback (the page is complete after a frame); run the gate one render per start for exact heights.

## Round 3 (same day, Owner's local review)

- **Nothing is seeded on production.** The migration only adds columns with defaults (strip visible, groups `[]`, why-us off and empty); no seed script or code writes a description, a featured group or why-us text. The sample texts exist only in unit/integration test fixtures (rolled back) and in the git-ignored scratch script `.local/p2-fu-states.mjs`, which now matches each description to its group by name. Migration unchanged since the first commit.
- **Headings and subtitles are left-aligned** (the centred variant is gone); the card block stays centred on the page.
- **Cards in a row are exactly one size** (equal columns, equal height, "Xem tất cả →" at the same distance from the bottom of every card); service names stop at two lines with an ellipsis (full name as tooltip), prices stay in one right-aligned column. Same for the why-us cards. Measured in the real app at 360/768/1440, light and dark.
- **Facts strip is one row, never wrapping:** 4+ items spread evenly at 1440 (equal gaps, flush edges); from 768 the address and custom lines shrink with an ellipsis (hours and hotline never shrink); phones keep each item whole and scroll the row sideways.
- **One hover/press style for every button and link-button of the public site** (CTAs, outline/ghost, round tools, account button, slider arrows, menu entries, pills, tab bar): smooth colour change, lift 2 px and zoom 3% on hover, 2% dip on press; tokens `--ls-ctl-lift/zoom`, off under reduced motion (measured). Text links keep colour/arrow motion only.
