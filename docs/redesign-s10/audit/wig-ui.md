# Web Interface Guidelines audit: packages/ui/src (shared UI kit)

Scope: every non-test `*.tsx`, `*.ts`, `*.css` under `packages/ui/src` (129 files, all listed below). Rules: `.local/s10/wig-command.md`, with the project
exception that Title Case does not apply (sentence case is checked instead; the kit carries almost no copy of its own and none is
off sentence case). Component files and the CSS hot spots were read; pure-logic `*-core.ts` helpers and the decorative season-art
drawings were pattern-scanned (grep for handlers, roles, aria, img, Intl, animation) and read where a hit needed confirming.

| Rule section               | Count  |
| -------------------------- | ------ |
| Accessibility              | 6      |
| Focus States               | 6      |
| Forms                      | 2      |
| Animation                  | 8      |
| Typography                 | 9      |
| Content Handling           | 0      |
| Images                     | 11     |
| Performance                | 1      |
| Navigation & State         | 1      |
| Touch & Interaction        | 8      |
| Safe Areas & Layout        | 4      |
| Dark Mode & Theming        | 1      |
| Locale & i18n              | 3      |
| Hydration Safety           | 0      |
| Hover & Interactive States | 4      |
| Content & Copy             | 0      |
| Anti-patterns              | 1      |
| **Total**                  | **65** |

Checked and clean kit-wide (so nobody re-checks them): no `transition: all` / `transition-property: all` anywhere; a global
`prefers-reduced-motion` kill (base.css:86, plus zeroed duration tokens tokens.css:307 and :1262) covers every CSS animation and
transition, and every infinite loop (spinner, skeleton pulse, brand marquee with its pause control, season particles with their
off switch, chat breathe) also stops under reduced motion; every `@keyframes` animates transform/opacity only; one global
`:focus-visible` ring (base.css:76); `color-scheme` set for light and dark (tokens.css:5, :342, :409); native `<select>` gets explicit
`color`/`background` from `.ls-input`; `IconButton` requires `label` and `Icon` is `aria-hidden` unless labelled; no `autoFocus`,
no `onPaste` blocking, no `user-scalable=no`.

## packages/ui/src/base.css

packages/ui/src/base.css:9 - [Touch & Interaction] `touch-action: manipulation` is set nowhere in the kit (only `touch-action: none` on the sortable handle, components.css:3757); add it here for `a, button, input, select, textarea, label, [role='button']` (customer phones, POS tablets)
packages/ui/src/base.css:9 - [Touch & Interaction] `-webkit-tap-highlight-color` is never set; every tap flashes the default grey box over the kit's own pressed states
packages/ui/src/base.css:9 - [Touch & Interaction] no `overscroll-behavior: none` on `html` inside `@media (pointer: fine)` (desktop rubber-band); keep coarse-pointer defaults

## packages/ui/src/tokens.css

packages/ui/src/tokens.css:138 - [Safe Areas & Layout] safe-area tokens exist for bottom/left/right only; there is no `--ls-safe-top`, so the sticky `.ls-topbar` (shell.css:13) and `.ls-site-header` (site.css:119) never clear a top inset (standalone/home-screen mode, notch)

## packages/ui/src/components.css

packages/ui/src/components.css:225 - [Touch & Interaction] `.ls-popover` (every menu, row ⋮ menu, user menu, facet panel) scrolls with no `overscroll-behavior: contain`; only the v2 scope adds it (components-v2.css:200), so staff/POS popovers chain their scroll to the page
packages/ui/src/components.css:590 - [Typography] `.ls-empty-title` lacks `text-wrap: balance` (only the v2 scope sets it, base.css:39)
packages/ui/src/components.css:612 - [Animation] `.ls-progress-fill` transitions `width` (layout every frame); animate `transform: scaleX()` with `transform-origin` at the inline start
packages/ui/src/components.css:635 - [Safe Areas & Layout] `.ls-toast-region` is fixed at `bottom: var(--ls-space-4)` with no `--ls-safe-bottom`; on a phone toasts sit under the home indicator
packages/ui/src/components.css:771 - [Animation] `.ls-input` transitions `outline-offset` (non-compositor; low)
packages/ui/src/components.css:856 - [Touch & Interaction] `.ls-listbox` (combobox popup) scrolls without `overscroll-behavior: contain` outside the v2 scope
packages/ui/src/components.css:1118 - [Typography] `.ls-form-section-title` lacks `text-wrap: balance`
packages/ui/src/components.css:1254 - [Safe Areas & Layout] phone sticky `.ls-form-actions` (`bottom: 0`) has no `--ls-safe-bottom` padding (its customer twin at site.css:1456 has it)
packages/ui/src/components.css:1319 - [Typography] `.ls-dialog-title` lacks `text-wrap: balance`
packages/ui/src/components.css:1388 - [Safe Areas & Layout] full-height side drawers (`.ls-drawer-start/-end`) add no safe-area padding; only `.ls-drawer-bottom` (1429) clears the bottom inset, so a side drawer's footer buttons sit under the home indicator
packages/ui/src/components.css:1633 - [Focus States] `.ls-media-tile:focus-within` draws the focus ring when the tile's ⋮ button is clicked with a mouse; use `:has(:focus-visible)`
packages/ui/src/components.css:2512 - [Hover & Interactive States] `.ls-th-sort` (sortable column header button, `cursor: pointer`) has no `:hover` state
packages/ui/src/components.css:2928 - [Typography] `.ls-pagination-summary` ("Hiển thị x–y trong n") lacks `font-variant-numeric: tabular-nums` (low)
packages/ui/src/components.css:2957 - [Typography] staff `.ls-page-btn` page numbers lack `tabular-nums` (the v2 pager has it, components-v2.css:990)
packages/ui/src/components.css:3326 - [Typography] `.ls-list-section-title` lacks `text-wrap: balance`
packages/ui/src/components.css:3731 - [Touch & Interaction] a dragged sortable item (`[data-dragging='true']`) gets no `user-select: none` (nor `inert`); dragging by mouse or touch selects text around it
packages/ui/src/components.css:4009 - [Typography] `.ls-card-title` lacks `text-wrap: balance`
packages/ui/src/components.css:4452 - [Typography] `.ls-kpi-label` (an `h3`) lacks `text-wrap: balance`
packages/ui/src/components.css:4798 - [Typography] `.ls-page-title` (the staff `h1`) lacks `text-wrap: balance`

## packages/ui/src/components-v2.css

✓ pass

## packages/ui/src/chrome-v2.css

✓ pass

## packages/ui/src/customer.css

✓ pass

## packages/ui/src/customer-pages.css

✓ pass

## packages/ui/src/pages-v2.css

✓ pass (the product gallery thumb at :1605 inherits the missing hover of site.css:3060)

## packages/ui/src/shell.css

packages/ui/src/shell.css:13 - [Focus States] sticky `.ls-topbar`, but the staff document sets no `scroll-padding-top` (only the customer side does: chrome-v2.css:49, site.css:376), so Tab / `focus()` / anchor scrolls can leave the focused control under the bar; same at the bottom for the phone sticky form footer (components.css:1254, no `scroll-padding-bottom`)
packages/ui/src/shell.css:116 - [Focus States] `.ls-content:focus { outline: none }` uses `:focus`; it is the programmatic skip/route focus target (`tabIndex=-1`), so intended, but `:focus:not(:focus-visible)` is the safer form (low)
packages/ui/src/shell.css:144 - [Animation] `.ls-sidebar-slot` transitions `width` on collapse: the whole content column relayouts every frame
packages/ui/src/shell.css:170 - [Touch & Interaction] `.ls-nav` (desktop sidebar, tablet overlay sidebar) scrolls with no `overscroll-behavior: contain`
packages/ui/src/shell.css:197 - [Animation] the sliding sidebar pill transitions `width` (line 199) alongside `translate`; use `scale` or jump the width
packages/ui/src/shell.css:274 - [Animation] `.ls-nav-collapse` animates `grid-template-rows` (layout every frame)
packages/ui/src/shell.css:958 - [Focus States] `.ls-auth-main:focus { outline: none }` uses `:focus` (programmatic target; low, as :116)
packages/ui/src/shell.css:1039 - [Animation] staff sign-in inputs transition `outline-offset` (non-compositor; low)

## packages/ui/src/site.css

packages/ui/src/site.css:20 - [Focus States] `.ls-site-main:focus { outline: none }` uses `:focus` (programmatic skip target; low)
packages/ui/src/site.css:1357 - [Focus States] `.ls-booking-step-title:focus { outline: none }` uses `:focus` (programmatic step target; low)
packages/ui/src/site.css:1620 - [Animation] `.ls-nav-pill` transitions `width` (line 1622); likely dead since site-nav.tsx dropped the sliding pill (session 9), remove or switch to `scale`
packages/ui/src/site.css:3060 - [Hover & Interactive States] `.ls-prod-thumb` (product gallery thumbnail button, `cursor: pointer`) has no `:hover` state (v2 override pages-v2.css:1605 has none either)

## packages/ui/src/staff.css

✓ pass

## packages/ui/src/season.css

✓ pass

## packages/ui/src/season-art.css

packages/ui/src/season-art.css:326 - [Hover & Interactive States] `.ls-art-fx-switch` (the "turn effects off" button) has no `:hover` state

## packages/ui/src/season-decor.css

✓ pass

## packages/ui/src/season-preview.css

packages/ui/src/season-preview.css:60 - [Hover & Interactive States] `.ls-season-card` (clickable season radio card, `cursor: pointer`) has no `:hover` state

## packages/ui/src/toast.tsx

packages/ui/src/toast.tsx:71 - [Accessibility] the toast region is `role="region"` without `aria-live`; each toast mounts as a new `role="status"` node that already holds its text, which screen readers often do not announce. Put `aria-live="polite"` on the persistent region (and `role="alert"` for danger toasts)

## packages/ui/src/form.tsx

packages/ui/src/form.tsx:125 - [Accessibility] the inline field error (`.ls-error`) has no `role`/`aria-live`; an error that appears on blur or after a server reply is only heard on the next visit to the field
packages/ui/src/form.tsx:230 - [Forms] `DateTextInput` placeholder `'dd/mm/yyyy'` does not end with `…` (low)

## packages/ui/src/confirm-dialog.tsx

packages/ui/src/confirm-dialog.tsx:173 - [Forms] the "type the record code to confirm" input lacks `spellCheck={false}` (and `autoCapitalize="off"`)

## packages/ui/src/form-overlay.tsx

packages/ui/src/form-overlay.tsx:69 - [Touch & Interaction] every FormDialog / FormDrawer opening focuses the first field, including the phone bottom sheet, so the on-screen keyboard jumps over the sheet; limit to `(pointer: fine)` and focus the panel on touch

## packages/ui/src/date-range-picker.tsx

packages/ui/src/date-range-picker.tsx:140 - [Accessibility] the desktop panel is a `Popover` with `role="dialog"` but no accessible name (`label` is not passed); add `label={labels.title}`

## packages/ui/src/choice-card.tsx

packages/ui/src/choice-card.tsx:65 - [Accessibility] `extra` renders inside the `<label>`, so it becomes part of the control's accessible name (contrary to the doc comment at :35) and any link/button in it is nested in the label; render it after the label

## packages/ui/src/kpi-card.tsx

packages/ui/src/kpi-card.tsx:51 - [Accessibility] the info `IconButton` is a `<button>` with no action; the explanation lives only in its `aria-label` and a hover/focus tooltip that a tap cannot open; use a toggletip (popover on press)

## packages/ui/src/feedback.tsx

packages/ui/src/feedback.tsx:78 - [Accessibility] `Notice` close button uses `aria-label={dismissLabel}`, but `dismissLabel` is optional (:61), so the icon-only button can render with no name; make it required when `onDismiss` is set
packages/ui/src/feedback.tsx:248 - [Animation] `ProgressBar` drives the fill with inline `width` (pairs with the width transition at components.css:612)

## packages/ui/src/popover.tsx

packages/ui/src/popover.tsx:61 - [Performance] `containingOrigin()` appends a probe and reads `getBoundingClientRect` inside the capture-phase scroll listener (:151), a forced synchronous layout on every scroll event with no rAF throttle; measure once per frame

## packages/ui/src/app-shell.tsx

packages/ui/src/app-shell.tsx:194 - [Anti-patterns] tablet scrim is a `<div onClick>` (low: the menu button and Escape at :105 are the keyboard paths)

## packages/ui/src/image-uploader.tsx

packages/ui/src/image-uploader.tsx:249 - [Images] uploaded-image thumbnail `<img>` has no `width`/`height`

## packages/ui/src/media-grid.tsx

packages/ui/src/media-grid.tsx:39 - [Images] `MediaThumb` image has no `width`/`height` (CSS frame bounds the shift; low)
packages/ui/src/media-grid.tsx:52 - [Images] `MediaPreview` `<img>` has no `width`/`height`; the drawer jumps when the image arrives
packages/ui/src/media-grid.tsx:97 - [Images] `MediaRow` thumbnail has no `width`/`height` (low)
packages/ui/src/media-grid.tsx:148 - [Images] `MediaTile` thumbnail has no `width`/`height` (low)
packages/ui/src/media-grid.tsx:236 - [Images] `PictureReview` image has no `width`/`height`

## packages/ui/src/season-scene.tsx

packages/ui/src/season-scene.tsx:208 - [Images] decorative corner `<img>` without `width`/`height` (CSS-sized; low)
packages/ui/src/season-scene.tsx:245 - [Images] logo accent `<img>` without `width`/`height` (low)
packages/ui/src/season-scene.tsx:463 - [Images] footer art `<img>` without `width`/`height` (low)

## packages/ui/src/season-slot-row.tsx

packages/ui/src/season-slot-row.tsx:35 - [Images] slot thumbnail `<img>` without `width`/`height` (low)

## packages/ui/src/season-site-fx.tsx

packages/ui/src/season-site-fx.tsx:224 - [Images] particle sprite `<img>` without `width`/`height` (low)

## packages/ui/src/pagination.tsx

packages/ui/src/pagination.tsx:73 - [Locale & i18n] `{from}`, `{to}`, `{total}` are interpolated as raw numbers (1234 shows as "1234", not "1.234"); format with `Intl.NumberFormat`

## packages/ui/src/form-core.ts

packages/ui/src/form-core.ts:22 - [Locale & i18n] `formatMoney` groups digits with a hand-written regex and a separator prop instead of `Intl.NumberFormat('vi-VN')`

## packages/ui/src/image-core.ts

packages/ui/src/image-core.ts:43 - [Locale & i18n] `formatBytes` uses `toFixed` plus a manual decimal separator instead of `Intl.NumberFormat`

## packages/ui/src/theme-core.ts

packages/ui/src/theme-core.ts:47 - [Dark Mode & Theming] the theme comes from the `ls-theme` cookie or the local hour, but `<meta name="theme-color">` (apps/web `(site)/layout.tsx:9`) follows `prefers-color-scheme`, so the browser bar is white over a dark page (or black over a light one) whenever they differ; update the meta here and in `themeInitScript` (:72)

## packages/ui/src/data-table.tsx

packages/ui/src/data-table.tsx:157 - [Navigation & State] uncontrolled sort lives only in `useState`; a sorted list cannot be deep-linked or restored on back (callers can pass `sort`, but the default is not URL-backed; low)

## packages/ui/src/accordion.tsx

✓ pass

## packages/ui/src/actions.tsx

✓ pass

## packages/ui/src/auth-layout.tsx

✓ pass

## packages/ui/src/brand-icons.tsx

✓ pass

## packages/ui/src/button-class.ts

✓ pass

## packages/ui/src/button.tsx

✓ pass

## packages/ui/src/card.tsx

✓ pass

## packages/ui/src/chart-core.ts

✓ pass

## packages/ui/src/chart-geometry.ts

✓ pass

## packages/ui/src/chart-parts.tsx

✓ pass

## packages/ui/src/charts.tsx

✓ pass

## packages/ui/src/confirm-core.ts

✓ pass

## packages/ui/src/contact-fab.tsx

✓ pass

## packages/ui/src/count-up.tsx

✓ pass

## packages/ui/src/css-rules-test-helper.ts

✓ pass

## packages/ui/src/cx.ts

✓ pass

## packages/ui/src/date-range-core.ts

✓ pass

## packages/ui/src/date-text-core.ts

✓ pass

## packages/ui/src/description-list.tsx

✓ pass

## packages/ui/src/dom-harness.ts

✓ pass

## packages/ui/src/faceted-filter.tsx

✓ pass

## packages/ui/src/footer-blocks.tsx

✓ pass

## packages/ui/src/form-frame.tsx

✓ pass

## packages/ui/src/heading-level.tsx

✓ pass

## packages/ui/src/icon-picker.tsx

✓ pass

## packages/ui/src/icons.tsx

✓ pass

## packages/ui/src/image-fallback.tsx

✓ pass

## packages/ui/src/image-frame.tsx

✓ pass

## packages/ui/src/index.tsx

✓ pass

## packages/ui/src/info-page.tsx

✓ pass

## packages/ui/src/info-table.tsx

✓ pass

## packages/ui/src/layout.tsx

✓ pass

## packages/ui/src/list-toolbar.tsx

✓ pass

## packages/ui/src/menu-core.ts

✓ pass

## packages/ui/src/menu.tsx

✓ pass

## packages/ui/src/motion-core.ts

✓ pass

## packages/ui/src/motion-gate.tsx

✓ pass

## packages/ui/src/motion-pause.tsx

✓ pass

## packages/ui/src/motion.ts

✓ pass

## packages/ui/src/multi-value.tsx

✓ pass

## packages/ui/src/overlay.tsx

✓ pass

## packages/ui/src/page.tsx

✓ pass

## packages/ui/src/paging-core.ts

✓ pass

## packages/ui/src/promo.tsx

✓ pass

## packages/ui/src/reveal-core.ts

✓ pass

## packages/ui/src/reveal.tsx

✓ pass

## packages/ui/src/route-enter.tsx

✓ pass

## packages/ui/src/route-fade.tsx

✓ pass

## packages/ui/src/schedule-strip.tsx

✓ pass

## packages/ui/src/scroller.ts

✓ pass

## packages/ui/src/season-art-autumn.tsx

✓ pass

## packages/ui/src/season-art-celebration.tsx

✓ pass

## packages/ui/src/season-art-christmas.tsx

✓ pass

## packages/ui/src/season-art-kit.tsx

✓ pass

## packages/ui/src/season-art-lion.tsx

✓ pass

## packages/ui/src/season-art-national.tsx

✓ pass

## packages/ui/src/season-art-shapes.tsx

✓ pass

## packages/ui/src/season-art-tet.tsx

✓ pass

## packages/ui/src/season-art-valentine.tsx

✓ pass

## packages/ui/src/season-art-vulan.tsx

✓ pass

## packages/ui/src/season-art-women.tsx

✓ pass

## packages/ui/src/season-css.ts

✓ pass

## packages/ui/src/season-frame.tsx

✓ pass

## packages/ui/src/season-fx-core.ts

✓ pass

## packages/ui/src/season-kits.tsx

✓ pass

## packages/ui/src/season-live-preview.tsx

✓ pass

## packages/ui/src/season-ornaments.tsx

✓ pass

## packages/ui/src/season-particles.tsx

✓ pass

## packages/ui/src/season-preview.tsx

✓ pass

## packages/ui/src/segmented.tsx

✓ pass

## packages/ui/src/selection-bar.tsx

✓ pass

## packages/ui/src/shell-core.ts

✓ pass

## packages/ui/src/site-header.tsx

✓ pass

## packages/ui/src/site-link.tsx

✓ pass

## packages/ui/src/site-nav.tsx

✓ pass

## packages/ui/src/site.tsx

✓ pass

## packages/ui/src/slider-core.ts

✓ pass

## packages/ui/src/slider.tsx

✓ pass

## packages/ui/src/sliding-pill.ts

✓ pass

## packages/ui/src/sortable-core.ts

✓ pass

## packages/ui/src/sortable.tsx

✓ pass

## packages/ui/src/spinner.tsx

✓ pass

## packages/ui/src/stat.tsx

✓ pass

## packages/ui/src/step-slide.ts

✓ pass

## packages/ui/src/tabs.tsx

✓ pass

## packages/ui/src/theme-cycle.tsx

✓ pass

## packages/ui/src/theme-script.tsx

✓ pass

## packages/ui/src/theme-toggle.tsx

✓ pass

## packages/ui/src/toast-core.ts

✓ pass

## packages/ui/src/tooltip.tsx

✓ pass

## packages/ui/src/url-state-core.ts

✓ pass

## packages/ui/src/use-media-query.ts

✓ pass

## packages/ui/src/use-theme.ts

✓ pass

## packages/ui/src/use-url-state.ts

✓ pass
