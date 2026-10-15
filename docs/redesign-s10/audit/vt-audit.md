# vercel-react-view-transitions: Step 1 audit (implementation.md "Step 1: Audit the App"), baseline 8001336

Next.js 16.3.5: `transitionTypes` on `<Link>` and `router.push(..., { transitionTypes })` are available (grep of next/dist/client/app-dir/link).

## Existing view-transition code

- `apps/web/src/components/public/page-transition.tsx:32` - layout-level `<ViewTransition name="ls-page" update={{'ls-nav':'ls-fade'}} default="none">` wrapping `{children}` in `(site)/layout.tsx:31`. Persistent parent VT; pages' own VTs (SharedPhoto) mount inside a persistent parent so they still fire (nextjs.md "Layout-Level ViewTransition").
- `apps/web/src/components/public/shared-photo.tsx:13` - named VT `share={{'ls-nav':'ls-morph',default:'ls-morph'}} default="none"`; used by product-card.tsx:63 (`ls-photo-prod-<code>`), product-gallery.tsx:81, services-list.tsx:52 and services-view.tsx:153 (`ls-photo-svc-<code>`). Untyped default morph, so router.back() also pairs.
- `apps/web/src/lib/nav-transition.ts:3` - `NAV_TRANSITION = ['ls-nav']` carried by site-chrome links, account-frame links, cart-link, shop-frame, page-back, account-menu router.push.
- `packages/ui/src/site.css:1527-1590` - persistent isolation for `ls-tab-bar`, `ls-contact` (named, animation none, z-index chrome), root old snapshot hidden + new live (live-root recipe), `::view-transition { pointer-events: none }`, ls-page fade over `--ls-dur-base` (240 ms customer), ls-morph over `--ls-dur-slow` (320 ms), reduced motion under `html[data-ls-motion='reduced']` sets animation none.
- Staff: NO view transitions. `apps/web/src/app/[locale]/workforce/(app)/template.tsx:6` remounts `RouteEnter` (packages/ui/src/route-enter.tsx:31), a CSS keyframe `ls-content-in` over `--ls-dur-slide` = 360 ms with a rise (shell.css:132) plus `.ls-route-fade` `ls-fade-in` over `--ls-dur-base` (shell.css:121). Violates G5 (staff route = 120 ms fade, no tween > 200 ms).

## Suspense boundaries / loading.tsx

- `(site)/(public)/(home)/loading.tsx`, `products/(list)/loading.tsx`, `services/(list)/loading.tsx`, `workforce/(app)/loading.tsx` (implicit Suspense). No VT around fallback or content: skeleton snaps to content (acceptable with live root; candidate: `enter="ls-fade"` content reveal, string props, default none).
- Explicit `<Suspense>`: workforce dashboard widget-host.tsx, workforce login.tsx.

## Persistent elements

- Customer: header (`.ls-site-header`, sticky, backdrop blur, NOT named: flow above the page; no flicker reported), tab bar (named), contact FAB (named), footer (in layout below page; part of root, old hidden/new live).
- Staff: topbar + sidebar (shell.tsx), no VT names (no VT in staff yet).

## Shared visual elements

- Service card photo -> service detail photo (paired, `ls-photo-svc-*`).
- Product card photo -> product detail gallery main image (paired, `ls-photo-prod-*`).
- Not paired: home featured row cards (product-card `sharePhoto` prop must be on), cart line thumbnail -> product detail (no; not hierarchical), account booking row -> booking detail (no media).

## Navigation map (customer)

| Route                                                                       | Navigates to                       | Direction              | Current                                                          | Planned (Step 2)                                                        |
| --------------------------------------------------------------------------- | ---------------------------------- | ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| / , /services, /products (lists)                                            | /services/[code], /products/[code] | forward (hierarchical) | ls-page fade 240 ms + photo morph 320 ms                         | keep: shared-element morph = the page's one main moment (G1); page fade |
| detail                                                                      | list (back chevron, browser back)  | back                   | untyped: morph pairs, fade does not run (update keyed on ls-nav) | same; back chevron uses router.push with type so fade runs              |
| header/tab bar lateral (/, /services, /products, /account)                  | sibling                            | lateral                | ls-page fade                                                     | fade only (no slide)                                                    |
| /account tabs (bookings, invoices, orders, loyalty, notifications, profile) | sibling                            | lateral                | ls-page fade                                                     | fade only                                                               |
| list rows -> /account/bookings/[id] etc.                                    | detail                             | forward                | fade                                                             | fade (no media to share)                                                |
| /cart -> /checkout                                                          | forward                            | sequence               | fade                                                             | fade                                                                    |
| booking stepper (in-page state, book.tsx:120)                               | next/prev step                     | ordered sequence       | none (state only)                                                | GSAP/VT step change along the sequence (G3), URL-synced step            |
| Suspense (loading.tsx)                                                      | content                            | reveal                 | snap                                                             | keep snap (live root)                                                   |

## Navigation map (staff)

| Route            | Navigates to    | Current                                    | Planned                                                                         |
| ---------------- | --------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| any sidebar item | any staff route | RouteEnter 360 ms rise + 200 ms fade (CSS) | one 120 ms opacity fade (route-fade, compact token), no rise; reduced = instant |
| list -> detail   | detail          | same                                       | same 120 ms fade (no slides on work screens, DESIGN 10)                         |

## Findings (to fix)

- VT1 staff route animation exceeds the 200 ms cap and moves (route-enter.tsx:31 + shell.css:132) -> G5.
- VT2 `::view-transition-group(ls-page)` duration token 240 ms on customer; reduced/off are instant (site.css:1583) - OK (G6 allows instant).
- VT3 `ls-morph` uses `--ls-dur-slow` 320 ms: within skill's 300-500 ms for shared morph - OK.
- VT4 GSAP Reveal (reveal.tsx:64) can animate a card whose photo is a SharedPhoto during a route change (G7 risk: same element by GSAP and VT at the same moment) -> removed with G2 (no scroll reveals).
- VT5 header has `backdrop-filter` but is not named; per css-recipes "Backdrop-Blur Workaround" only needed if named. Root old snapshot hidden already. OK.
- VT6 booking stepper step change is not a transition and step is not in the URL (wig-customer finding book.tsx:120) -> Step 2 plan.
