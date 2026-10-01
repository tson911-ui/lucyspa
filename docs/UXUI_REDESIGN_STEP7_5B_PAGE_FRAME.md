# UX/UI Step 7.5b: page frame

Status: implemented locally 2026-10-01, **ready for Owner deploy check** (not committed, not deployed). Plan: `UXUI_REDESIGN_STEP7_5_PLAN.md` (7.5b).

## What changed

- **`packages/ui`**: new `Page` (width `default`/`form`/`full`, gutter and max width from tokens, 24 px between blocks), `PageHeader` (breadcrumbs slot, one `h1`, description, actions at the trailing edge, wraps under the title on phone), `Stack`/`Cluster`/`Grid` (named gaps 24/16/8/4, equal-height auto-fit grid). Children of Page/Stack/Cluster/Grid/Card carry no outer margin.
- **`Card` flush context**: `DataTable` wrapper and `EmptyState` lose their own border inside a `Card` (CSS); a `Card` inside a `Card` logs an error in development (tested). `RouteFade` got an opt-in `stack` prop (used by the workforce `template.tsx`) so route content is the page's block container; the customer area is unchanged.
- **Web**: `WorkforceShell` wraps content in `Page`; `ui.tsx` `PageHeader` and `Section` are now the kit `PageHeader` and `Card`+`CardHeader` (one card system; `wf-page-header`, `wf-section*` deleted; `roles.tsx` raw `wf-section` became `Card`). `workforce.css` rewritten on tokens (0 spacing literals, base font `--ls-text-md`, token radii, 40/44 px controls); dead rules removed (`wf-badge*`, `wf-notice*`, `wf-pagination`, `wf-grid`, `wf-segmented`, `wf-link-grid`); block margins dropped from legacy block classes (containers own gaps). Table-as-cards on phones: links in cells are 40/44 px.
- **Nav (#19)**: list gap 2 px -> 4 px token, active bar 3 -> 4 px (still the inset edge bar the shell test requires).
- **Leave (#14)**: its raw table sits in `ls-table-wrap`, so a wide table scrolls inside the card; page horizontal scroll at 768 is gone.
- Two existing web tests searched HTML for `<h2>title</h2>` and for the text "card"; they now ignore the new class names (`employee-directory.test.tsx`, `pos.test.tsx`).

## Migrations / permissions / API

None. `apps/api`, `packages/database`, `packages/contracts`, `next-env.d.ts` untouched.

## Tests

- `packages/ui`: 207/207 pass (new `page-layout.test.tsx`: variants, header order, gap tokens, CSS has no literals, nested Card warning, flush rules, nav gap); typecheck clean.
- `apps/web`: 233/233 pass; typecheck clean; eslint 0 warnings on touched files; prettier clean.
- Ratchet lowered with `UPDATE_RATCHET=1`: `wf-*` uses 726 -> 720, workforce.css spacing literals 80 -> 0, shell.css 1 -> 0.

## UX gate

Rendered Dashboard, Employees, Skills, Branches, Leave at 360/768/1440 light + dark on the real app (scratch DB, production build, `.local/uxui-audit/shots/`). Reviewed Skills 1440 + 360, Dashboard 1440, Branches 768, Leave 768, Employees 1440 dark: one card surface, 24 px rhythm, flush tables/empty states, no page overflow.
DOM audit vs baseline (these 5 pages, light): no type rose. Nested borders 47 -> 37, off-grid spacing 1202 -> 1064, off-scale font 423 -> 378, wrapped labels 157 -> 134, horizontal scroll 1 -> 0, orphan action 3 -> 2, small targets 43 -> 42.
Not fixed here (by plan): duplicate "Thêm kỹ năng" title + `<details>`, `<details>`/raw tables, stray buttons (7.5c/d), dashboard widget titles and the 0-1 chart axis (7.5e). `surface-style-mix` hits rose 73 -> 91 (type count unchanged: legacy `wf-card` rows inside the now-unified cards).

## Look at on the real app (deploy check)

Any workforce page at 360, 768, 1440, light and dark: page gutter and 24 px spacing between header and cards, header actions at the right, tables flush inside cards, sidebar active item and nav gap. Leave at 768 (table scrolls inside its card; the actions column is off-screen until scrolled).

## Open questions / notes

- `Page` is centered (`margin-inline: auto`, max 1280); it was left-aligned at 1152 before. Only visible above about 1600 px.
- `Page width="form"` needs the shell to not wrap in `Page` (no nesting support); 7.5d decides how form pages opt in.
- `wf-card` (11 uses) stays for item cards inside screens that Steps 9c/10a rebuild; plan text said "deleted" but that is screen-internal work.
- A dev API runs on port 3001 (Owner's); `next build` bakes `API_UPSTREAM_ORIGIN`, so the audit build must set it to 3101 (done; both audit servers stopped).
