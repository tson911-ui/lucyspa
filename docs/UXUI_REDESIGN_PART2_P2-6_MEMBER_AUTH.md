# Part 2, P2-6: member auth and the account control in the site chrome

Contract 3.1, 3.3, 5.4. Scope: sign-in, registration, forgot password inside the shared site frame; the header account menu; the member area moved onto the same frame.

## What changed

- **One frame.** `SitePageFrame` (server, `components/public/site-page-frame.tsx`) is the header + footer + phone tab bar + season frame. `(public)/layout.tsx` and `account/layout.tsx` both use it, so the member pages and the sign-in pages now sit in the same chrome (the old `cu-shell` header, `wf-app` shell and red-panel look are gone). Staff pages are untouched.
- **Auth card.** Login, register, forgot password: one centered `Card` (26 rem) on the page band with a `SegmentedControl` (Đăng nhập / Đăng ký, route based, the `next` parameter travels between them), Playfair h1, kit `Field` / `TextInput` / `PasswordInput` (show/hide), "Quên mật khẩu?" as the label-row action, required in words, kit `Notice`, kit `Button` (secondary first, primary last). Behaviour, validation and API calls are unchanged; the activation step keeps the wanted `next` through to sign-in.
- **Account menu** (`components/public/account-menu.tsx`): signed out (or a staff session) = Đăng nhập, Đăng ký; signed in = Lịch hẹn, Hóa đơn, Thông báo, Đăng xuất, with the unread bell beside it. Sign-in/out announce a window event so the header updates without a reload.
- **Member shell** = shared frame + `SiteSubNav` row (Tổng quan, Lịch hẹn, Hóa đơn, Thông báo; new kit piece, `ls-subnav`) + the session-lost notice. The guard's loading/error/staff states use kit components.
- `customer.css`: removed the shell, header and `wf-login*` rules and the flex/min-height of `wf-app`. `wf-app` stays only on the member content wrapper until P2-8.
- i18n: `SiteText.member` (menu and row labels), customer `auth.modes/registerTab/showPassword/hidePassword`, `common.required`.

## Not changed / decisions

- `next` stays restricted to the member area (`safeCustomerNext`, stricter than "same origin"); the open-redirect test exists and passes.
- The card has no wordmark of its own (the header directly above it already shows it).
- Below 480 px the bell is hidden from the header (four round tools plus the wordmark do not fit 360 px); the menu and the member row lead to Thông báo.
- No migration, no permission, no API change.

## Tests and gate

- New: `auth.test.tsx` (4), `account-menu.test.tsx` (3), `accountTabItems` in `site-nav.test.ts`, `SiteSubNav` in `site-frame.test.tsx`. Ratchet `wfClassUses` 80 -> 65.
- `pnpm check` and `pnpm smoke`: see the commit; whole-repo tests green.
- UX gate: login/register/forgot rendered at 360/768/1440 light and dark (all opened and reviewed: card width and centring, switch, label row, 44 px targets, nothing bordered inside the card, season frame seats around it). DOM gate on the three auth pages + home + member pages: axe 0, no horizontal scroll, auth pages 0 audit findings. The member pages still carry their legacy findings (P2-8 removes them); their counts were not in the baseline before.

## Open

- The unread count is not shown in the header below 480 px.
