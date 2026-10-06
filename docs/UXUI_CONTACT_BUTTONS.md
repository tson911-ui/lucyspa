# Contact buttons: Zalo / Messenger / phone (2026-10-06)

Owner-approved. Public site and member pages only; the staff area is untouched.

## What changed

- **Shop info** (Admin > Website > Shop info > section "Liên hệ"): two optional fields, **Trang Facebook** (page link) and
  **Zalo** (number or `https://zalo.me/...` link). Validated in the form and again in the API (`facebookPageLinks`,
  `zaloLink` in `packages/contracts/src/contact-links.ts`, one source for both). The public site gets derived links:
  `facebookUrl`, `messengerUrl` (`https://m.me/<page or id>`), `zaloUrl` (`https://zalo.me/<number>`). The hotline is reused.
- **Floating button** (`ContactFab`, `packages/ui`): round brand-red "Liên hệ" button, bottom-right on every public and
  member page. Click opens Zalo, Messenger, "Gọi Lucy Spa" (`tel:`); Esc or a click outside closes. An empty link is left
  out; no widget when none is left (the hotline always exists once the profile is read). Zalo and Messenger links open in a new tab.
- **Placement.** A sticky row with its own slot (button height + 16 px above and below) just before the footer: it stays
  bottom-right while scrolling and, at the end of the page, rests in its slot between the content (an action bar included)
  and the footer, so at rest it covers nothing. Lifted above the phone tab bar (css) and above the booking action bar
  (height measured). Layer: `--ls-z-sticky`; checked in the browser that a popover and a dialog backdrop draw above it.
  Only the button and links take the pointer. There is no customer pay bar (PayOS is staff-side); the only sticky bottom
  bars of the public site are the tab bar and the booking action bar.
- **Motion** (tokens only, 0 under reduced motion): one attention pulse on the first page of a visit (never looping),
  fade + slight scale unfold with a stagger. **Colours:** Zalo and Messenger in official colours (tokens, same in both themes),
  the call button and the toggle in the site's brand fill: red with a white icon in light mode, the site's pink with a dark
  icon in dark mode (the Owner can ask for white on red in both). Labels (VI/EN): "Nhắn Zalo", "Nhắn Messenger", "Gọi Lucy Spa".
- **Footer:** Facebook and Zalo icons under the contact lines, footer-link grey, official colour on hover; hidden when empty.

## Migration

`20261104000000_shop_info_contact_links`: two nullable columns on `website_shop_info` (`facebook_url`, `zalo_contact`) with a
length CHECK. Additive, nothing seeded. Applied to the scratch DB only, which was filled with sample links.
**Production: apply it before or with the API deploy, and deploy the API and the admin web together** (the strict API body
now requires the two fields, so an old admin form could not save). The Owner then types the links himself.

## Tests

Full `pnpm test`; the two shop info DB suites (columns, CHECK, API flow) were also run on a fresh throw-away scratch
database with all migrations applied. New: link rules (API and form), shop info HTTP strictness, public parser, footer icons,
widget items, `ContactFab` behaviour and css contract.

## UX gate

Rendered 360/768/1440 light and dark on a stub API and on the real API + scratch DB: home, Dịch vụ, booking flow (a service
picked so the action bar shows), Hóa đơn, Tài khoản, widget collapsed and open, top, scrolled and bottom of the page, the
footer icons and their hover colours, Tết (light and dark). The admin Shop info section at 360/768/1440 light and 1440 dark,
an invalid Facebook link and Zalo value (Vietnamese errors), a real save through the form, read back from the API and the
public site, then cleared. Measured: at rest (bottom of every page) the button touches no bar and no control; popover and
dialog layers draw above it. Opened and read: booking 360 bottom, booking 768 dark open, Dịch vụ 360 light open, Hóa đơn
360 dark open, Tài khoản 1440 light open, home bottom (real app, 1440 dark and 360 light), Tết 360 light and dark, the
admin section (error 1440, 360, 1440 dark). The other combinations were measured, not opened. DOM audit (home, website): same single
pre-existing finding as before this change.

## Open

- While the button is expanded it is a menu laid over the page, like the bell panel: on the booking flow on a phone it can
  cover the "Tiếp tục" button until it is closed. While scrolling, the collapsed button can sit over the right edge of a row.
- At the bottom of a page with a tall footer (phones, seasons) the button has scrolled away above the footer, which repeats
  the hotline and the icons.
