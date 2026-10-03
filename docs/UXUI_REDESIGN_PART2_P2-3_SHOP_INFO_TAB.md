# UX/UI Part 2, Step P2-3: admin "Shop info" tab

Contract: `UXUI_REDESIGN_PART2_DESIGN.md` 6.3. API: `UXUI_REDESIGN_PART2_P2-2_BACKEND.md`.

## What changed

- **New tab "Thông tin tiệm / Shop info"** on the website content page (`/workforce/website?tab=shop`, last tab; `tab` is part of the URL
  state): `components/workforce/screens/website-shop-info.tsx`. One `Card` with `FormSection`s: Tagline (VI/EN), Contact (address,
  hotline, optional https map link), Home page image (`MediaPicker`, remove allowed), Opening hours (branch select, "first active
  branch" by default, read-only hours come from the branch with a button to its screen). Below: a preview card of what visitors read
  (tagline in the admin language, address, hotline, grouped hours). Footer: "Hoàn tác thay đổi" (disabled while clean) then primary "Lưu".
- Row version on save (`CONFLICT` reloads), field errors named by the API (`MEDIA_ALT_REQUIRED` is shown under the image), unsaved-change guard,
  success toast. The tab shows "no access" for anyone without the global website permission.
- `lib/hours.ts` turns the API's hour groups into lines ("Mỗi ngày: 09:00 – 21:00", "Thứ Hai – Thứ Sáu", closed days); shared with the public site (P2-4).
- `lib/workforce/shop-info.ts` (form state, request, client checks), VI/EN texts (`shopInfo`, `website.shop`), media detail names the new
  usage ("Thông tin tiệm"). The page header shows no action on this tab (the form saves itself).

## Migrations, permissions

None (P2-2 added the table; `MANAGE_WEBSITE_CONTENT` reused).

## Tests

- `lib/hours.test.ts`, `lib/workforce/shop-info.test.ts` (form <-> request, trimming, first problem, changed, server problem mapping),
  `lib/workforce/shop-info-panel.test.tsx` (tab for the global permission only, panel loads then shows the form, VI/EN parity).
- Real API round trip on the scratch DB (`.local/p2-shop-e2e.mjs`): GET, save (version 1 to 2), stale version `CONFLICT`, bad hotline
  `VALIDATION_FAILED`, public `/public/site` and `/public/services` read the saved values.
- Web suite 382+ green; format, lint, typecheck clean.

## UX gate

- Real app, `gate14.mjs website-shop-tab`: 360/768/1440 light and dark, axe 0 on all six; DOM audit 0 at 768 and 1440; at 360 one FR3 note
  (the phone sticky form bar has no card radius), the same finding that `popup-new` and `season-new` already carry (kit bar, not new).
- Opened 1440 light and dark, 768 light, 360 light and dark: tab strip with the new tab selected (scrolls into view on phones), single-column
  form on phones, preview card, sticky footer with Cancel-style then primary, no horizontal scroll.
- The scratch branch happens to open 00:00 to 24:00, so the preview shows that; the production default is 09:00 to 21:00.

## Open questions

None.
