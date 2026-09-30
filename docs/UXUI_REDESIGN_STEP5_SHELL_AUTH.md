# UX/UI Redesign Step 5: App shell, navigation, auth layout

Status: CLOSED / OWNER APPROVED (tagline kept). Not deployed. Contract: `UXUI_REDESIGN_DESIGN.md` 4, 12.6 (updated), 13. Owner feedback included: workforce auth pages use a split layout.

## What changed

- `packages/ui` (new, tokens only, text via props): `AppShell` (desktop sidebar collapsible to icons, remembered in `localStorage` as a convenience; tablet icon rail that expands as an overlay with scrim and Escape; phone drawer; sticky topbar with a reserved gap for a later search), `SidebarNav` (groups, empty groups hidden, one-item group flat, `aria-current="page"` plus fill and edge bar), `UserMenu` (avatar, name, title, links, sign out; closes on Escape, outside press or link), `ThemeToggle` (Light/Dark/System radio group, cookie from Step 2), `Breadcrumbs` (component only; wired on detail pages in Steps 8-10), `shell.css`, 13 nav icons.
- **Auth layout** (`AuthLayout`, `BotanicalPattern`): from 768 px a left brand panel (deep brand-red gradient, inline-SVG botanical line art at 9% opacity, faded diagonally, wordmark, tagline) and the form on the right with language + theme controls top right; below 768 px only the form with the wordmark above. New tokens `--ls-auth-panel-*` (light and dark, contrast tested). No image file, no external request, no animation. Panel is `aria-hidden` (decoration). A photo can replace the panel background later.
- Web: `WorkforceShell` now renders `AppShell`; groups and icons come from `lib/workforce/nav-groups.ts`. Personal pages (My account, My income) moved to the user menu; theme and language are in the topbar from 640 px and inside the user menu on phones. Login and forgot-password (the only workforce auth pages) use `AuthLayout`; the language switch moved to `LanguageSwitch`. Tagline in VI/EN is a proposal (`auth.tagline`): edit freely.
- Regrouped navigation per contract 4.2: Overview, Operations, Sales & payments, People, Catalog, Administration (Website group arrives in Step 11). Dead `wf-topbar/nav/body/menu-button` CSS removed; `.wf-app`, `.wf-main`, `wf-login*` stay (pages and customer auth still use them until Step 10 / Part 2).

## Migrations / permissions / API

None. `navigationFor` rules and order are untouched; only `NavItem.group` values changed (`home/operations/management` to the seven task groups). The dashboard shortcut grid keeps the same pages through `isManagementItem` until Step 7 removes it.

## Tests run

- `@lucy-spa/ui`: 108 pass (17 new): nav arrangement, active-path match, initials, storage failure; jsdom for desktop collapse, phone drawer, tablet overlay (Escape, scrim, focus return), theme radio keys + cookie, user menu; auth markup and CSS contract (phone form-only, 768 split, tokens gradient, subtle art, no `url()`/animation); panel contrast 4.5:1 both themes.
- `apps/web` unit: 200 pass. New `nav-groups.test.ts` asserts sidebar + user menu hold exactly `navigationFor` for five accounts (visibility unchanged). Two assertions in `my-account/my-income.test.tsx` changed `group: 'home'` to `'personal'`. `recovery.test.tsx` covers the forgot-password split layout in both languages.
- Typecheck (ui, web), eslint 0 warnings, boundaries, prettier: clean on touched paths.
- Visual (static markup + real CSS in Edge): login at 1440 light and dark, 768, 360 dark; shell at 1440 light and 800 dark (rail). Not checked against the running app (needs API/DB) and not tested on a real phone.

## Open questions

- Approve the tagline wording ("Chăm sóc từng khách hàng, mỗi ngày." / "Caring for every guest, every day.")?
- `Card`, `Avatar` (full), `Stat` are not in this Step; they come with the dashboard (Step 7).
- Customer login/register still use the old centered card (Part 2).
