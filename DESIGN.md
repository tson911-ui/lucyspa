# Lucy Spa: DESIGN.md

**Status: Approved by the Owner 2026-10-14 (decisions in section 16). Docs only; no app code changed.**

This is the single design spec for the Lucy Spa redesign: customer site, counter/POS and admin. It replaces direction C
(Fraunces and Nunito, rose-cream page, pebble cards, soft rose shadows, waves, brand-red footer).

Contents: 1 Authority and what stays in force. 2 References and their roles. 3 Locked decisions and how conflicts were
resolved. 4 HIG rules applied (H1-H14). 5 Shared design DNA (D1-D9). 6 Design tokens. 7 Layout grid and breakpoints.
8 Core components (default and compact). 9 Customer page patterns (Aevi). 10 Compact patterns for POS and admin.
11 Motion (GSAP). 12 Accessibility. 13 Kept unchanged. 14 Rollout and the per-group screenshot gate. 15 Implementation
notes. 16 Decisions.

---

## 1. Authority and what stays in force

- `UI work must follow DESIGN.md.` (one line in CLAUDE.md). Where DESIGN.md and an older UI document disagree about
  **look, tokens, components, layout or motion**, DESIGN.md wins.
- **Superseded:** in `docs/UXUI_REDESIGN_DESIGN.md`, section 5 (typography), 6.2-6.6 (colors, sizes, motion values) and the
  visual parts of 9, 12 and 13 (their component lists, page anatomy and responsive behavior stay valid); and the visual direction
  in `docs/CUSTOMER_SITE_C.md`. Its photo list (which real photos the shop must take) stays useful.
- **Still in force, not restated here:**
  - `UXUI_REDESIGN_DESIGN.md` 6.1 (theme mechanism: Light, Dark, Auto by time), 20 (seasonal layer) and 21 (UX gate, FR1-FR15,
    DOM audit, ratchets). Section 14 of this file adds to the gate; it does not replace it.
  - Every functional and structural rule: page anatomy (10.1), list and action placement (10.2-10.5), confirmation dialogs
    (11), permissions, money, dates, the no-"khám" rule, VI/EN copy.
- CLAUDE.md sections "Customer site redesign", "Staff screens in direction C" and the fonts/palette of "UI design rules" 1-2
  are marked superseded by this file (Owner, 2026-10-14, Q1). `docs/CUSTOMER_SITE_C.md` is superseded too; its photo list stays valid.

## 2. References and their roles

| #   | Reference                                                                                           | Role                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)   | **The rules.** Web-applicable parts are mandatory (section 4). Platform-only parts (Watch, Vision Pro, CarPlay, Siri, App Store, SF Pro, SF Symbols) are skipped. |
| 2   | [Apple web style (Refero)](https://styles.refero.design/style/aecac5da-f397-4ddf-b71f-de1efc434cb8) | **The look and the level of luxury:** canvas, bands, spacing, pill buttons, hairlines, no shadows, type tracking.                                                 |
| 3   | [Aevi Wellness (Refero)](https://styles.refero.design/style/c2fadeda-8ef3-4ab2-9909-ffdf02ab0a24)   | **The layouts and product presentation** for every page. POS and admin take its visual style in a compact layout.                                                 |
| 4   | [GSAP style page (Refero)](https://styles.refero.design/style/00537a20-e99e-4ef2-b119-c6f532c44cc9) | **Motion reference only.** Its colors, dark canvas, gradients, 3D shapes, fonts and layout are NOT used.                                                          |

How the references were read (so nobody trusts a number that is not there):

- The HIG pages were read from their data endpoints (accessibility, layout, typography, color, dark mode, motion, buttons, text
  fields, modality, feedback, writing). The HIG gives **no durations or easing**, and Apple's Dynamic Type sizes are
  Apple's, not CSS values.
- The Apple web page gives **no motion values**.
- **The GSAP page contains no durations, easing, stagger or scroll values** (it only describes GSAP's brand: a dark canvas,
  3D shapes, and two hover details: an underline by color shift and a 1 px border-opacity shift to 0.8, neither with timing).
  The motion values in section 11 are therefore **set by this file** from the HIG motion principles, the motion tokens already
  in `tokens.css`, and standard GSAP practice. The Owner approved them on 2026-10-14 (Q8).
- The Refero pages disagree with themselves in places (Apple: tracking sign on headings, `#d2d2d7` and `#ffffff` used but not in
  the palette; Aevi: primary-button text white vs black). The resolved value is in section 6.

## 3. Locked decisions and how conflicts were resolved

Locked by the Owner (used exactly; nothing added):

1. Apple HIG rules and the Apple web look on **every** page.
2. Aevi Wellness is the layout reference for **all** pages. Customer pages follow its layouts and presentation. POS and admin
   follow its visual style in a compact work-screen layout.
3. One shared design DNA across customer, POS and admin (section 5). Staff screens may change **density only**.
4. Light: white `#ffffff` base, `#f5f5f7` bands. No shadows, no gradients. Single accent `#782b37`. No yellow or gold except
   holiday decorations. Font Be Vietnam Pro. Keep the "LUCY SPA" text wordmark.
5. Apple-style dark mode: black base, stepped greys, a lighter burgundy accent that passes WCAG AA.
6. GSAP on all pages: full on customer pages; on POS and admin at most 200 ms, never blocks input, global off switch, honours
   `prefers-reduced-motion`.
7. All functions, data, the light/dark toggle and the seasonal decoration layer stay unchanged.
8. Rollout: customer, then POS, then admin; each with before/after screenshots and its own deploy.

Where a reference conflicts with a locked decision, the locked decision wins:

| Reference says                              | Lucy Spa uses                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Apple blue `#0071e3` / Aevi blue `#a3bfdb`  | Accent `#782b37` (light), `#e48f9f` (dark)                                                                                |
| SF Pro                                      | Be Vietnam Pro                                                                                                            |
| Aevi radius 2 px                            | Apple-style rounded corners: 8 px controls, 18 px cards and media, pill for buttons and tags                              |
| Aevi powder-blue bands `#d5e0ea`            | Neutral bands `#f5f5f7`                                                                                                   |
| Apple product-image shadow, any shadow      | No shadows. Depth comes from surface steps, hairlines and scrims                                                          |
| Aevi bottom-line-only inputs                | Apple boxed inputs (8 px), because the HIG and the 3:1 control-border rule need a visible boundary                        |
| Apple/Aevi weight 300 for subheads and body | Not used. HIG: "avoid light font weights". Minimum weight is 400                                                          |
| Apple 1.07 line height, negative tracking   | Heading line height at least 1.2 (stacked Vietnamese marks clip below that); tracking 0 except display sizes              |
| Apple "sections never contain cards"        | Customer bands hold cards only for products, prices, forms and account records. Staff screens keep FR1 (one Card surface) |

## 4. HIG rules applied to Lucy Spa (mandatory)

Each rule has an ID for the screenshot gate (section 14).

- **H1 Clarity and hierarchy.** One primary thing per screen; order by importance, reading order first (most important at the top
  and leading edge). Group with negative space, a band change or a hairline; unrelated items never share a group. Use
  logical CSS properties (`margin-inline-*`) so the layout would survive RTL.
- **H2 Consistency.** Same control, same place, same behavior on every page. An action keeps its name through the whole flow (the
  button says "Lưu", the toast says "Đã lưu"). Terms are listed once (a glossary in the copy review) and reused.
- **H3 Targets.** Every interactive target is at least **44 x 44 px** on touch and coarse pointers. Compact (staff, fine
  pointer only) may be 40 px high; never below 40; running-text links are the only exemption. Keep about 12 px of space around
  bezeled controls and about 24 px around bare icons so neighbours are not hit by mistake.
- **H4 Contrast.** WCAG AA at least: 4.5:1 for text, 3:1 for large text (24 px, or 18.66 px bold) and for the boundary of a
  control or an icon that carries meaning. In dark mode check **every elevation step** a token can sit on (section 6.2).
  Custom colors in dark mode aim for 7:1 on small text where possible (accent text reaches 7.07:1 on `#1c1c1e`).
- **H5 Color is never the only signal.** Status, selection, errors, required, sale and focus also use a word, an icon or a shape.
- **H6 Typography.** One family (Be Vietnam Pro). Weights 400, 500, 600 only. Hierarchy by size, weight and color, and it
  survives text enlargement. Leading is loose for long text; tight leading never for 3 or more lines. Do not lock sizes
  in `px` on text: use `rem` so the browser's text setting works, and the layout must hold at **200 %** text (and the project's
  130 % check). No truncation in a scrolling region unless the full text is reachable.
- **H7 Layout is adaptive.** Base it on available space (breakpoints and container queries), not on device type. Function is
  identical at every size; only how much is visible changes (a sidebar becomes a menu, columns stack). Respect safe areas
  (`env(safe-area-inset-*)`); no critical control at the very bottom edge except the app tab bar. Text lines at most 75
  characters.
- **H8 Color use.** Accent color only for primary actions, the current location, selection and links. Never the same color
  with two meanings: the brand burgundy and the error red stay clearly different (6.4 of the old contract, kept). No colored
  backgrounds on many controls at once.
- **H9 Dark mode is its own appearance, not an inversion.** Black base, stepped elevated greys (brighter = closer to the user),
  semantic tokens only, no hard-coded colors, images with white backgrounds slightly dimmed. The light/dark toggle is kept
  (Auto by time, Light, Dark). Check both modes for every screen.
- **H10 Motion has a purpose.** Only to show what changed, give feedback to an action, or orient navigation. Brief and precise.
  Never the only carrier of information. Interruptible: nothing waits for an animation. No animation on frequent interactions
  (typing, table updates, scanning). Reverse of an entrance leaves the way it came. Reduced motion replaces moves with fades or
  nothing. No animation into or out of blur, no flashing.
- **H11 Feedback.** Status is shown passively, near the thing it describes. Interrupt (dialog) only for critical information or
  irreversible loss. Warn before **unexpected** data loss, not before expected loss. Say what happened and how to fix it. Confirm
  success only for significant actions (payment, booking); usually people expect success. Slow actions show a progress or
  busy state and may change the label ("Đang lưu...").
- **H12 Forms.** Every field has a visible label (a placeholder is a hint, never the label). Size the field to the expected input.
  Stack fields in one column with equal widths per group. Validate on blur for email, on input for username and password
  rules. Error text sits beside the field, names the fix ("Mật khẩu cần ít nhất 8 ký tự"), uses no blame and no "Oops".
  Right keyboard per field (`inputmode`, `autocomplete`, `type`). Never block paste.
- **H13 Modality.** A modal only for a focused, short, narrowly scoped task or a critical choice. Title names the task. Always an obvious
  way out (close button, Escape, Cancel). Confirm before discarding unsaved input. Never stack modals; never two alerts at once.
  Short form = dialog, medium = drawer, long = its own page (FR rule kept).
- **H14 Writing.** Plain, short, natural Vietnamese (and English). Buttons start with a verb ("Đặt lịch", "Lưu thay đổi"), no
  "Nhấn vào đây", links say where they go. One capitalization style: sentence case. Empty states give a next step. No "chúng
  tôi" in error messages ("Không tải được nội dung", not "Chúng tôi gặp sự cố"). Never "khám".

## 5. Shared design DNA (customer, POS, admin)

Staff screens must be instantly recognizable as the same Lucy Spa site. **POS and admin may change density only** (spacing
step, row height, font-size step, control height). They may never change anything below.

| ID  | DNA element               | The one rule                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **One token source**      | `packages/ui/src/tokens.css` is the only place for colors, type scale, radius, borders, motion. `customer.css` and `staff.css` may not redefine a color, radius, border or font. The customer frame and the staff shell read the same tokens; the only per-area difference is the density tokens, which include the shorter staff motion durations (6.7, 11.3). |
| D2  | **Wordmark and header**   | The "LUCY SPA" text wordmark, in Be Vietnam Pro 600, in the same place (leading edge) on every header. Same hairline-bottom, same translucent sticky bar (6.5), same nav-link styling, same current-page treatment, same theme toggle and language switch. The customer header is taller; it is the same component.                                             |
| D3  | **One component set**     | Buttons, inputs, cards, badges, tables, dialogs, drawers, tabs, menus, toasts, pagination come from `packages/ui` once, each with a **default** and a **compact** variant (`data-density="compact"` or a `compact` prop). No separate staff or customer designs of the same component.                                                                          |
| D4  | **Typographic hierarchy** | The same scale (6.3), same roles (display, title, heading, body, caption), same weights. Compact moves a role down one step; it never changes the face, the weights or the ratios.                                                                                                                                                                              |
| D5  | **Accent usage**          | Accent only for: the primary action (at most one per view), the current location, selection, links, focus ring. Everything else is neutral (ink, greys, hairlines). Status colors are separate and always come with a word or icon.                                                                                                                             |
| D6  | **Icon style**            | One outline icon set from `packages/ui/src/icons.tsx`: the stroke the set already uses (1.75 px on a 24 px grid), round caps, no fills, no color except `currentColor`, sizes 16 / 20 / 24. No emoji as icons.                                                                                                                                                  |
| D7  | **Section banding**       | Pages are stacked full-width bands alternating `#ffffff` and `#f5f5f7` (dark: `#000000` and `#1c1c1e`). Separation is the band change and 1 px hairlines, never shadows, never gradients, never a decorative divider ornament.                                                                                                                                  |
| D8  | **Shape language**        | Pill for buttons, tags, badges, chips, segmented controls and search. 8 px for fields and small media. 18 px for cards, dialogs, drawers, large media. No other radius.                                                                                                                                                                                         |
| D9  | **Motion language**       | Same easing family, same direction rules (up to enter, back the way it came to leave, horizontal only for sequences and drawers), same reduced-motion behavior (section 11). Staff screens use shorter durations of the same curves.                                                                                                                            |

A reviewer checks DNA by laying the customer home, a POS screen and an admin list side by side: wordmark, header, button, input,
badge, table header and band colors must look like one family.

## 6. Design tokens

All names keep the existing `--ls-*` namespace; values change. Every color below is a token; screens never use a hex. WCAG
ratios were computed for this draft; `tokens.test.ts` must be updated to assert them (15).

### 6.1 Color: light

| Token                          | Value                    | Use                                                                                                  | Contrast / note                   |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `--ls-bg-page`                 | `#ffffff`                | Base band, header, popovers                                                                          |                                   |
| `--ls-bg-sunken` (band)        | `#f5f5f7`                | Alternate band; staff app canvas                                                                     |                                   |
| `--ls-bg-surface`              | the **other** band color | A card takes the opposite of its container: `#ffffff` on a `#f5f5f7` band, `#f5f5f7` on `#ffffff`    | Scoped by `.ls-band--base/--alt`  |
| `--ls-bg-raised`               | `#ffffff`                | Dialog, drawer, menu, popover (with a hairline and the scrim)                                        |                                   |
| `--ls-bg-pressed`              | `#e2e2e5`                | Pressed/disabled neutral surface                                                                     |                                   |
| `--ls-text`                    | `#1d1d1f`                | Primary text                                                                                         | 16.83 on white, 15.46 on band     |
| `--ls-text-muted`              | `#515154`                | Secondary text                                                                                       | 7.91 white, 7.26 band             |
| `--ls-text-subtle`             | `#6e6e73`                | Captions, placeholders, helper text. **The lightest allowed text color.**                            | 5.07 white, 4.66 band             |
| `--ls-border`                  | `#d2d2d7`                | Hairlines, dividers, card edges (decorative)                                                         | Not for control boundaries        |
| `--ls-border-control`          | `#86868b`                | Input, select, checkbox boundary                                                                     | 3.62 white, 3.33 band (needs 3:1) |
| `--ls-brand` / `--ls-focus`    | `#782b37`                | Accent: links, outline buttons, current item, focus ring                                             | 9.55 white, 8.77 band             |
| `--ls-brand-fill`              | `#782b37`                | Primary button fill                                                                                  | white text 9.55                   |
| `--ls-brand-fill-hover`        | `#632330`                | Primary button hover/press                                                                           | white text 11.58                  |
| `--ls-on-brand`                | `#ffffff`                | Text on accent fill                                                                                  |                                   |
| `--ls-brand-soft` / `-on-soft` | `#f3e7e9` / `#782b37`    | Selected tint, current-state chip                                                                    | 7.92                              |
| `--ls-hover-bg` / `-text`      | `#782b37` / `#ffffff`    | Hover (Owner rule 4, kept: solid accent, white text)                                                 | 9.55                              |
| `--ls-row-hover-bg`            | `#f5f5f7`                | Hover of **every** table row (customer and staff): the next neutral step from the table surface (Q3) |                                   |
| `--ls-nav-hover-bg`            | `#e2e2e5`                | Hover of a staff sidebar item (ink text); the current page stays solid accent (Q3)                   | ink 13+                           |

Status (kept from today, re-verified on both bands): danger `#b3261e` on `#fdecea`, success `#1e6b3c` on `#e6f3ea`, warning
`#8f4300` on `#fdeedd`, info `#22518a` on `#e8f0fa`. Ratios 5.7 to 7.0 on their tints, 6.0 to 7.4 on white or band. Charts keep
their six-slot palette (`--ls-chart-*`) unchanged; `--ls-chart-1` is the accent family.

`#86868b` is **never** used as text in light mode (3.62 on white).

### 6.2 Color: dark (Apple-style)

Dark is stepped, not inverted: the closer a surface is to the user, the lighter it is (HIG base and elevated).

| Token                           | Value                                                                                | Use                                                                           | Contrast / note                                               |
| ------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `--ls-bg-page` (E0, base)       | `#000000`                                                                            | Base band, header                                                             |                                                               |
| `--ls-bg-sunken` (E1, band)     | `#1c1c1e`                                                                            | Alternate band; staff app canvas                                              |                                                               |
| `--ls-bg-surface`               | the **other** step                                                                   | Card on E0 = `#1c1c1e`; card on E1 = `#2c2c2e`                                |                                                               |
| `--ls-bg-raised` (E2)           | `#2c2c2e`                                                                            | Dialog, drawer, menu, popover                                                 |                                                               |
| E3                              | `#3a3a3c`                                                                            | Neutral hover/pressed surface only. **No accent text on E3.**                 |                                                               |
| `--ls-text`                     | `#f5f5f7`                                                                            | Primary text                                                                  | 19.29 on E0, 12.8 on E2                                       |
| `--ls-text-muted`               | `#a1a1a6`                                                                            | Secondary text and captions. **The dimmest allowed dark text.**               | 8.16 E0, 6.61 E1, 5.42 E2                                     |
| `--ls-border`                   | `#38383a`                                                                            | Hairlines (decorative)                                                        |                                                               |
| `--ls-border-control`           | `#86868b`                                                                            | Control boundary                                                              | 5.8 E0, 4.7 E1, 3.85 E2                                       |
| **`--ls-brand` / `--ls-focus`** | **`#e48f9f`**                                                                        | **Dark accent**: links, outlines, current item, focus ring, button fill       | **8.73 E0, 7.07 E1, 5.79 E2, 4.72 E3**: passes AA on all four |
| `--ls-brand-fill`               | `#e48f9f`                                                                            | Primary button fill                                                           |                                                               |
| `--ls-on-brand`                 | `#000000`                                                                            | **Text on the accent fill is near-black, never white** (white on it is 2.4:1) | 8.73                                                          |
| `--ls-brand-fill-hover`         | `#eca5b2`                                                                            | Primary hover/press                                                           | black text 10.59                                              |
| `--ls-brand-soft` / `-on-soft`  | `#3a2227` / `#e48f9f`                                                                | Selected tint                                                                 | 6.07                                                          |
| `--ls-hover-bg` / `-text`       | `#e48f9f` / `#000000`                                                                | Hover (Owner rule 4, dark side)                                               | 8.73                                                          |
| `--ls-row-hover-bg`             | next step up from the table surface (`#1c1c1e` to `#2c2c2e`, `#2c2c2e` to `#3a3a3c`) | Every table row hover, customer and staff (Q3)                                |                                                               |
| `--ls-nav-hover-bg`             | `#3a3a3c`                                                                            | Staff sidebar item hover (text stays `#f5f5f7`; no accent text on E3)         |                                                               |

Status in dark (kept): danger `#ff9484`, success `#7fd39a`, warning `#ffb066`, info `#8ebcf0` on their dark tints
`#3d1c1a`, `#14301d`, `#3a2410`, `#14283f`: 7.1 to 8.1 on the tints, 5.3 to 11.7 on E0 to E3.
Scrim: light `rgb(0 0 0 / 0.4)`, dark `rgb(0 0 0 / 0.6)`. Dim white-background product images by a small brightness filter
in dark mode so they do not glow.

The dark block must stay declared twice (explicit toggle and `prefers-color-scheme`) and identical, as today.

### 6.3 Typography (Be Vietnam Pro, self-hosted through `next/font`, one family)

Weights: **400** body, **500** buttons, labels and nav, **600** headings, product names and the wordmark. 700 only for a promotional
lockup. No 300 or lighter. Sizes in `rem` (16 px root).

| Role     | Customer size / line height | Compact (staff) | Weight | Tracking   | Use                                          |
| -------- | --------------------------- | --------------- | ------ | ---------- | -------------------------------------------- |
| display  | 56 / 1.2 (fluid down to 36) | not used        | 600    | -0.01em    | Home hero only                               |
| title-xl | 40 / 1.2 (fluid down to 32) | not used        | 600    | -0.01em    | Page and band titles (h1 of inner pages: 40) |
| title    | 28 / 1.25                   | 24 / 1.25       | 600    | 0          | h2, band headings, page title on staff       |
| heading  | 21 / 1.3                    | 17 / 1.3        | 600    | 0          | h3, card titles, dialog titles               |
| body     | 17 / 1.6                    | 14 / 1.5        | 400    | 0          | Reading text, form values                    |
| label    | 14 / 1.4                    | 14 / 1.4        | 500    | 0          | Labels, nav, buttons (compact button 14)     |
| caption  | 12 / 1.5                    | 12 / 1.4        | 400    | 0          | Helper, table meta. **12 px is the floor.**  |
| price    | 21 / 1.3                    | 17 / 1.3        | 600    | 0, tabular | Money (VND, integer, `tabular-nums`, nowrap) |

- Heading line height is never below 1.2: stacked Vietnamese marks (for example "Ệ", "Ở") clip below that.
- Inputs are at least 16 px on coarse pointers (prevents the iOS focus zoom); compact inputs are 14 px on fine pointers only.
- Max line length 75 characters; hero and band titles balance their lines (`text-wrap: balance`); no one word alone on a line.
- Numerals: `font-variant-numeric: tabular-nums` in tables, prices, times.
- No decorative number, count or symbol next to a heading (existing Owner rule kept).

### 6.4 Spacing (4 px base)

Scale: 4, 8, 12, 16, 24, 32, 48, 64, 80, 96. Gaps between blocks use 8 / 16 / 24 / 32 / 48 (existing rule); 4 / 12 live inside a
control or between an icon and its text.

| Token / use                 | Customer                                          | Compact (staff)        |
| --------------------------- | ------------------------------------------------- | ---------------------- |
| Band padding (block axis)   | 64 / 80 / 96 (below 768 / 768-1023 / 1024 and up) | 24 / 32 (page padding) |
| Heading block to content    | 32 / 48                                           | 16 / 24                |
| Gap between cards in a grid | 16 (mobile), 24                                   | 16                     |
| Card padding                | 24                                                | 16                     |
| Field to field in a form    | 24                                                | 16                     |
| Page gutter (inline)        | 16 / 24 / 32                                      | 16 / 24                |

### 6.5 Radius, borders, elevation

- **Radius:** `--ls-radius-sm` 8 px (inputs, selects, small thumbnails, menu items); `--ls-radius-lg` 18 px (cards, product media,
  dialogs, drawers, popovers, the table surface); `--ls-radius-full` 980 px (buttons, tags, badges, chips, segmented
  controls, search, avatars' ring). `--ls-radius-md` is removed.
- **Borders:** 1 px hairline `--ls-border` for separation; 1 px `--ls-border-control` for control boundaries; 2 px focus ring in
  `--ls-focus` with a 2 px offset (ring plus a gap of the surface color, so it shows on any band). A card has either a
  surface-step difference **or** a hairline, not both, unless it sits on a same-color surface.
- **No shadows.** `--ls-shadow-*` become `none` and are removed from components. Layers separate by: the scrim (dialogs, drawers),
  one elevation step (dark) or a hairline (light), and z-index. Menus and popovers: raised surface + hairline.
- **No gradients** in the base UI. Placeholders for missing photos are a flat `--ls-bg-sunken` surface with the wordmark or an icon.
- **The sticky header** is the base color at 96 % with a 16 px backdrop blur (kept from the Owner's 2026-10-06 rule that text
  behind the bar must not be readable) and a 1 px bottom hairline. Under `prefers-reduced-transparency` or no `backdrop-filter`
  support it is fully opaque. Blur is not a shadow and not animated (HIG).
- **Exceptions to "no shadow, no gradient"** (and only these): the **seasonal layer** (`--ls-season-*` tokens, season frames,
  ornaments, particles; unchanged by this redesign). The auth panel is flat (Q4).

### 6.6 Sizes

| Item              | Default (customer, touch)                         | Compact (staff, fine pointer)                        |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Control height    | 44                                                | 40 (44 on coarse pointers or below 1024 px)          |
| Table row         | 56                                                | 48 (56 on coarse pointers; one row height per table) |
| Icon              | 20 (24 in nav)                                    | 20 (16 inside badges and dense cells)                |
| Header height     | 64 (52 when compacted on scroll; existing tokens) | 56                                                   |
| Content max width | 1200 (bands full bleed)                           | 1280 (forms 720, auth card 26 rem)                   |
| Dialog widths     | sm 400, md 560, lg 720                            | same; drawer 512                                     |

### 6.7 Density switch

Density (and the shorter motion that goes with it) is the only difference between areas. One attribute decides it:
`data-density="compact"` on the staff shell root (default absent = comfortable). The area-dependent tokens are exactly these: control
height, row height, the spacing and type steps of 6.3 and 6.4, and the motion durations of 11.3 (staff values are shorter, never
a different curve). Nothing else in `tokens.css` is conditioned on the area.

## 7. Layout grid and breakpoints

- **Breakpoints (min-width):** 0 (design floor 360), 640, 768, 1024, 1280. Design and check at **360, 768, 1440**.
- **Columns:** 4 columns below 768, 8 from 768, 12 from 1024. Gutter 16 below 768, 24 from 768. Page margin 16 / 24 / 32.
- **Container:** content max 1200 px centered; bands are always full-bleed and their background goes edge to edge, under the notch
  and safe areas. Hero images are never boxed inside the container. Text blocks inside bands max 680 px (about 75 characters).
- **Customer grids:**
  - Product and service cards: 2 columns below 768, 3 at 768, 4 at 1024 and up. A category grid is 1 / 2 / 3.
  - Horizontal rows (bestsellers): scroll-snap, 1.15 cards visible at 360, 2.3 at 768, 4.2 at 1440, so the next card peeks.
    Left and right peek are symmetrical; arrow buttons (44 px) appear from 1024; keyboard and pointer both work.
  - Split sections: 6 + 6 columns from 1024, stacked below. Image side alternates; on stack the image comes first.
- **App shell below 1024 px** (kept): the scroller and the bottom tab bar stay as built (`.ls-site-scroll`, tab bar in flow);
  they are restyled, not rebuilt.
- **Staff shell:** sidebar 264 (72 collapsed) from 1024, content max 1280, a top bar of 56 px; below 1024 the sidebar becomes a
  drawer and the layout is one column.
- No horizontal page scroll at any width; tables that cannot fit become a card-per-row list below 768 (existing pattern).
- Use `rem` and container queries for components so they respond to their space and to 200 % text.

## 8. Core components (default + compact)

All are in `packages/ui`; the compact variant is the same component. Hover is Owner rule 4 (solid accent, accent-contrast text)
on every interactive surface except staff table rows and staff sidebar items (Q3, below); the primary button, already filled,
darkens instead.

### 8.1 Buttons

| Variant                      | Look                                                                                                                                                    | Use                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Primary** (filled pill)    | `--ls-brand-fill`, `--ls-on-brand` text, label 17/500 (compact 14/500), no border, no shadow. Padding 12 x 24 (compact 8 x 16). Height 44 (compact 40). | **One per view** (HIG: one or two prominent, never two filled side by side). |
| **Secondary** (outline pill) | Transparent, 1 px accent border, accent text. Same size.                                                                                                | Paired with a primary ("Đặt lịch" + "Xem dịch vụ").                          |
| **Tertiary** (text link)     | Accent text, underline on hover and focus. **Customer navigation only** ("Tìm hiểu thêm"); never an action (FR).                                        | Inline navigation.                                                           |
| **Neutral** (pill)           | `--ls-bg-sunken` fill, ink text.                                                                                                                        | Filters, cancel in forms, toolbar actions.                                   |
| **Destructive**              | Outline in `--ls-danger`; filled danger only inside the confirm dialog. Never the primary role. In a confirm dialog, focus starts on Cancel.            | Delete/cancel with confirmation.                                             |
| **Icon button**              | Circle, 44 (compact 40), 20 px icon, accessible name required.                                                                                          | Toolbars, close, row menu `⋮`.                                               |

States: hover (rule 4), **pressed** (scale 0.98, or darker fill; always present), focus-visible (ring), **disabled** (`--ls-bg-pressed`
fill, `--ls-text-subtle` text, no hover, `aria-disabled`; contrast exempt but readable), **busy** (label changes to "Đang
lưu..." with a 16 px spinner; button stays the same width). Equal sizes within a group; the preferred option is distinguished by
style, not size. Footers are Cancel then primary, primary last (kept).

### 8.2 Inputs

- Boxed, 8 px radius, fill = the opposite band color (`#f5f5f7` on white, `#ffffff` on a band), 1 px `--ls-border-control`.
  Height 44 (compact 40). Label above, 14/500; helper below, 12/400 `--ls-text-subtle`; required marked with the word
  "bắt buộc" in the label text or `*` plus `aria-required`.
- Focus: 2 px ring, border becomes accent. Error: border `--ls-danger`, an icon, and the message below it (never color alone);
  `aria-invalid` and `aria-describedby`.
- Select: native element styled; chevron icon. Date and phone inputs keep the existing masks. Search: pill, leading icon,
  trailing clear button at 44 px.
- Checkbox and radio: 20 px box (8 px radius / circle), 44 px hit area. Switch: 44 x 28 hit track with text on or off label.
- Textarea minimum 96 px. Never use a placeholder as the only label.

### 8.3 Cards

- **Customer card:** surface-step color (6.1), 18 px radius, padding 24, no border, no shadow. Whole card is one link when it
  is a link (one target, one accessible name). Hover: accent fill rule applies to its call-to-action pill, not to the whole
  card; the image may scale 1.02 (customer only, section 11).
- **Product card:** media on top, full-bleed, 18 px radius clipped, 1:1 (or 4:5) on `--ls-bg-sunken` with the product centered;
  below it name (heading, 2 lines max, no truncation of price), price (`price` role), optional struck-through old price, and
  an optional badge row over the media's top-left. No add-to-cart button inside the grid card on touch; the card opens the page.
- **Staff Card:** `--ls-bg-surface` on the `--ls-bg-sunken` canvas, 18 px radius, hairline border, padding 16 (24 in wide
  forms). FR1 stays: one Card surface, nothing bordered inside, lists have no outer card.
- **Stat/KPI:** value in `title`, label in `label`, delta with icon + sign + text.

### 8.4 Tables and lists

- One single-border surface (18 px radius, 1 px hairline), header row on `--ls-bg-sunken`, header text `label` 14/500
  `--ls-text-muted`, sticky on scroll, row separator hairline, no zebra, row height per 6.6, numeric columns right-aligned,
  `nowrap`, tabular. Sort indicator is an icon plus `aria-sort`.
- Row hover (customer and staff, Q3): `--ls-row-hover-bg`, a neutral step; never the solid accent. Keyboard focus on a row shows the
  focus ring. Why: a solid accent across a full-width row recolors every cell (status colors, badges and prices lose contrast) and
  hurts scanning, and the HIG says to use color sparingly and not on the background of many controls.
- Row actions: `⋮` icon button at the trailing edge (kept). Selected row: `--ls-brand-soft` plus a check icon.
- Empty: centered icon (24), title (`heading`), one sentence and one action. Loading: skeleton rows of the same height (the one
  allowed repeating animation, pulse). Error: inline message with a retry button.
- Anything that can exceed 20 rows is `DataTable` + `Pagination` (20 per page). Below 768 a customer table becomes a stack of
  rows with label/value pairs.

### 8.5 Navigation and header

- **Customer header:** wordmark at the leading edge; the existing 3-item menu and bell (unchanged function); language switch and theme
  toggle; one **"Đặt lịch" primary pill** at the trailing edge from 640 px (icon + text); below 640 px the booking tab of the phone tab bar is the always-visible call to action (a 360 px member bar has 9 px free; Owner, 2026-10-14). The header is clear (transparent) at the top over the home hero and turns to the translucent surface on scroll (Owner, 2026-10-14). Height 64, compacting to 52 on scroll (existing tokens). Link style: 14/500 ink, current page = accent text + 2 px accent underline offset 8 (never a fill in the bar);
  hover = rule 4 pill.
- **Phone:** the existing app shell with the bottom tab bar (44 px+ items, label under icon, current = accent) stays. Safe-area
  padding included.
- **Staff header (compact):** 56 px, same wordmark and bar styling, breadcrumb/page context at the leading edge, user and
  theme controls at the trailing edge. **Sidebar:** `--ls-bg-sunken`, 264 / 72, grouped by task (existing IA), item 40 px high
  pill, current = solid accent fill + accent-contrast text (the one place the accent marks location), hover = `--ls-nav-hover-bg`, a neutral
  tint with ink text (Q3: the accent is reserved for the current page, so a hover never competes with it).
- **Footer (customer):** `#f5f5f7` band (dark `#1c1c1e`), multi-column link grid (12 columns from 1024, 2 on phone), column
  header 14/600, links 14/400 `--ls-text-muted`, 12 px fine print, hairline above the legal line. Content comes from the
  existing footer blocks (CMS). No brand-red footer, no waves.
- **Tabs:** pill segmented control on a `--ls-bg-sunken` track; selected = surface pill with ink text; keyboard arrows move
  and wrap; hover per rule 4. Scrollable on phone with edge fade replaced by a visible next-tab peek.

### 8.6 Dialogs, drawers, sheets, menus, toasts

- **Dialog:** 18 px radius, `--ls-bg-raised`, hairline, over the scrim; padding 24; title `heading` names the task; body; footer
  Cancel then primary. Widths sm/md/lg. Close icon button top trailing; Escape closes; focus trapped and returned;
  `aria-modal`. Data loss asks first. One at a time.
- **Drawer:** same surface, slides from the trailing edge, 512 wide (full width below 640). **Sheet** (phone): bottom, 18 px top
  radius, a visible Close button (a swipe is never the only way).
- **Menu / popover:** raised surface, hairline, 18 px radius (items 8 px, 40 px high, 44 on touch), opens on click, closes on
  Escape and outside click, arrow-key navigation.
- **Toast:** raised pill-ish card (18 px), bottom center (phone) or bottom trailing, icon + text, 5 s default, 8 s with an action,
  paused on hover and focus, `role="status"` (errors `role="alert"`), dismiss button, stacks at most 3.
- Tooltips appear on hover **and** focus; never carry essential information.

### 8.7 Badges and chips

- Pill, height 24, padding 4 x 12, 12/500 (never wraps, never truncates a word). Optional 16 px leading icon.
- **Shop labels** (one accent family, no second chromatic color): **Bán chạy** = accent fill; **Mới** = accent outline; **-20 %**
  (sale) = `--ls-text` fill (ink on light, `#f5f5f7` on dark) with inverse text. The sale amount is a number plus the percent
  sign; the old price is shown struck through beside the new price.
- **Status badges:** the status tint + the status color text + an icon + the word.
- **Chips** (filters) are 40 / 44 px pills; selected = accent fill; they are controls, not badges.

### 8.8 Pagination

20 per page. Prev/next icon buttons (44, compact 40) and page-number pills (current = accent fill, `aria-current="page"`; others
neutral, hover rule 4). Ellipsis after 5 numbers. The summary "Hiển thị 21-40 trong 132" sits at the leading edge. Below 768 only
prev/next and "Trang 2 / 7". URL state kept (`useUrlState`). Public lists with fewer than 20 items show no pager.

### 8.9 Other kit parts (follow the same rules; no separate design)

Breadcrumbs, avatar (circle, initials fallback), progress bar (4 px, pill, accent), stepper for booking (numbers only because it **is** a
sequence), accordion/FAQ (button + chevron, hairline between, no `<details>` per FR), skeleton, spinner (16 / 24), image
frame (18 px, `object-fit: cover`, `alt` required, flat placeholder when missing), contact button (kept; restyled as a primary
icon pill).

## 9. Customer page patterns (Aevi layouts, Apple look)

Rhythm for every page: **full-bleed hero or title band, then alternating `#ffffff`/`#f5f5f7` bands**, each band one idea, a
`title` heading (28 or 40), one supporting sentence, then content in the grid. One primary action per band. Photography is
the only imagery (no illustration, no 3D, no abstract graphics): full-bleed, tightly cropped, real photos. Where the shop's
photos are missing use the flat placeholder and keep the shop's photo list from `docs/CUSTOMER_SITE_C.md`. A small label
may sit on a photo's bottom-left corner in white 14/500 over a flat `rgb(0 0 0 / x)` scrim (never a gradient) strong enough for 4.5:1.

### 9.1 Home (order is fixed)

1. **Hero** (full viewport width, height about 80 vh, min 560): real photo under a flat `rgb(0 0 0 / x)` scrim (no gradient) that gives the text 4.5:1, `display` headline, one supporting
   sentence, **"Đặt lịch" primary** (accent fill, as everywhere: D5) + "Xem dịch vụ" secondary (on the photo only the secondary switches to the
   outline-white variant, which keeps 4.5:1). The wordmark is not repeated as a decorative overlay.
2. **Trust band** (`#f5f5f7`): 3 to 4 facts from the existing facts-strip data (no invented numbers), `title` figure + caption,
   hairline between on desktop, stacked on phone. Optional press/partner logos strip at uniform height in grey.
3. **Split intro/services** (white): left text (`title`, 2 sentences, link to all services, "Đặt lịch" secondary), right a framed
   photo (18 px); below it a 3-column list of the top services as text + price + arrow link. Services and booking are the most
   prominent content on the page.
4. **Bestsellers row** (`#f5f5f7`): heading "Bán chạy" band, horizontal scroll-snap row of product cards with labels
   **Bán chạy / Mới / -%**, "Xem tất cả" tertiary link, arrows from 1024.
5. **Reviews band** (white): a carousel of short quotes, name initial, service name, stars drawn as 5 icons with a text rating.
   **Rendered only when reviews are public. Today no such switch or policy exists** (reviews are private; the publishing policy is
   an open PRD item). Owner decision Q5: this band is not built until the Owner decides to publish reviews.
6. **Service and cosmetics category grid** (`#f5f5f7` or white by position): 3-column cards, each a full-bleed photo with the
   category name bottom-left (no count or badge beside it: Owner rule, counts live only in the table line and empty states), whole card is one link. Two groups: services,
   cosmetics.
7. **Footer** (8.5).

### 9.2 Inner pages

| Page                                                   | Pattern                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Services list                                          | Title band (`title-xl`, one sentence, search + category chips). Grouped sections by category, each a heading + 3/4-column cards (photo, name, duration, price from, "Đặt lịch" pill). Sticky chips row on scroll. Empty/loading/error states.                                                                                                    |
| Service detail                                         | Split hero: photo left (18 px), right name, duration, price, short copy, **"Đặt lịch" primary** (sticky bottom bar on phone). Bands: what's included, steps, FAQ accordion, related services row, booking CTA band.                                                                                                                              |
| Booking flow (guest and member)                        | One column, max 720, a **stepper** (services, guests, staff and time, confirm; Owner 2026-10-14) as pills; each step one heading + one group of fields; sticky footer with Back (neutral) and Continue (primary); summary card (sticky aside on desktop, collapsible on phone); success state with next steps. Existing logic and API untouched. |
| Cosmetics list (`/products`)                           | Title band + toolbar (search, category chips, sort select, filter drawer on phone). Product grid 2/3/4. Pagination 20 per page. Labels as 8.7. Empty and error states.                                                                                                                                                                           |
| Product detail                                         | Split: gallery left (large image 1:1, thumbnails below; swipe + arrows + buttons), right name, price, labels, short copy, quantity stepper, **primary "Thêm vào giỏ"**, availability text. Bands: description, usage/ingredients accordion, related products row.                                                                                |
| Cart                                                   | Title band; list rows (thumb 80, name, quantity stepper, line total, remove icon) in one surface; summary card (sticky aside on desktop) with total (`price`) and **"Thanh toán"** primary. Empty cart: icon, sentence, "Xem sản phẩm".                                                                                                          |
| Checkout                                               | One column form (max 720): contact, delivery, payment method as radio cards (selected = accent border + check icon + word), order summary; one primary "Đặt hàng"; inline errors beside fields; PayOS handoff keeps today's states.                                                                                                              |
| Auth (login, register, forgot)                         | Centered 26 rem card on a band (flat panel and hairline card, Q4; no gradient), wordmark above, fields, one primary, secondary links as tertiary. Social/help text 14. Errors beside fields.                                                                                                                                                     |
| Account home                                           | Title band with greeting; 2-column grid of summary cards (next booking, points, last invoice, notifications), each one link; account sub-navigation = tabs (desktop) / list (phone), the last entry is "Hồ sơ" (read-only name and language until a customer profile API exists; Owner 2026-10-14).                                              |
| Bookings, orders, invoices (+ detail)                  | List as a customer table (8.4) with status badges, 20 per page; detail as a split: left record, right actions/summary card; timeline as a vertical list with icons (not color alone). Every detail page has a visible "← Quay lại" link to its list (Owner 2026-10-14). Existing PDF/print kept.                                                 |
| Loyalty                                                | Points `display`-sized number in a band, progress bar to the next level (text + bar), rewards as product-style cards, history table.                                                                                                                                                                                                             |
| Notifications                                          | One surface list, unread = ink weight 600 + dot **with** a word for screen readers, mark-all as neutral button.                                                                                                                                                                                                                                  |
| Public ticket (`/ticket/[token]`)                      | Centered single card max 480 with the QR/code large, status badge, details list; printable; no header chrome beyond the wordmark.                                                                                                                                                                                                                |
| Info pages (about, contact, policies, CMS `[...rest]`) | Title band; article column max 680 with `body`, headings h2/h3, images 18 px; contact page: split with map/address left, details + contact pills right; policies: table of contents aside on desktop; a table in the text is one hairline surface that becomes stacked rows under 640 px (the Owner's refund and membership tables, session 8).  |
| 404 / error                                            | Centered: `title`, one sentence, primary "Về trang chủ", secondary "Đặt lịch".                                                                                                                                                                                                                                                                   |
| Season preview (admin-only route)                      | Unchanged behavior; restyled by the same tokens.                                                                                                                                                                                                                                                                                                 |

Every customer page is designed and checked in all states: loading (skeleton), empty, error, success, disabled, long text, many
items, no image.

## 10. Compact patterns for POS and admin

Same DNA (section 5), Aevi's visual style (hairlines, neutral bands, sparing accent, no decoration), **work-screen layout: dense,
fast to scan, keyboard first.** No hero, no display type, no photo frames, no decorative bands, no entrance animation on the
counter.

- **Page anatomy** (existing 10.1, kept): `Page` + `PageHeader` (one h1 in `title` 24 px, one primary action last at the trailing
  edge), optional toolbar, content, then the footer actions inside forms. Canvas `#f5f5f7` (dark `#000000`), cards on it.
- **List page:** toolbar (search pill, faceted filter pills, date range, view switch) above one table surface; 48 px rows
  (56 on coarse), 20 per page, sticky header, row `⋮` menu, bulk-selection bar on the toolbar line, "Hiển thị x-y trong n".
- **Detail page:** header with title + status badge + primary action; two-column from 1024 (record left 8 columns, summary right 4);
  tabs for sections; description lists (label above value, no border inside the card).
- **Form page:** one column max 720, groups separated by a heading and 32 px; footer actions Cancel then primary, sticky on long
  forms. Short form = dialog, medium = drawer.
- **Dashboard:** widget grid of Stat cards and charts (the six-slot chart palette, kept); customize mode unchanged; no gradient
  fills in charts (flat series colors, 2 px lines, direct labels or a legend with shapes, not color alone).
- **Counter / POS (highest density and speed):**
  - Targets stay at least 44 px on tablets (coarse pointer); on fine pointers 40.
  - Invoice board and cart: two panes (catalog/search left, invoice right) from 1024; tabs below. Totals pinned to the bottom of the
    invoice pane in `price` type; **Thanh toán** is the single primary.
  - Keyboard: `/` focuses search, Enter adds, Escape closes the topmost layer, arrows move in lists; visible focus always.
  - No reveal, no stagger, no route animation longer than 120 ms; a payment result or a failure shows inline status near the
    action first (H11), a toast second.
  - Status colors always with icon + word (paid, owing, refunded, cancelled).
- **Booking board / schedule strip:** time grid with hairlines on `#f5f5f7`, appointment blocks as 8 px rectangles using
  neutral surface + 4 px accent leading bar for "selected" and status icon + text; drag has a keyboard/button alternative.
- **Confirmations:** the existing confirmation-dialog rules (cancel/deactivate/correct instead of a fake delete).
- **Admin extras** (settings, roles, audit log, website content, media library, seasons): the same list/detail/form patterns; the
  media library grid is square thumbnails with 8 px radius and a selection check.

## 11. Motion (GSAP)

**Provenance:** the GSAP reference page carries no motion numbers. The values below are set by this file from the HIG motion
principles (H10), the motion tokens that already exist in `tokens.css`, and standard GSAP practice. The Owner approved them
on 2026-10-14 (Q8).

### 11.1 Principles

- Motion explains (what appeared, what moved, what changed), confirms (press, success), and orients (forward/back). It never
  decorates, never repeats on frequent interactions, never blocks.
- Only `transform` and `opacity` are animated. Never layout properties, never blur, never color flashes. No scroll-jacking, no
  smooth-scroll library, no pinned sections, no scrubbed parallax except the hero image's single 24 px drift (existing
  token), because native scrolling must stay native.
- Content is visible in the server HTML and without JavaScript. Animation starts only after mount, only for what is below the fold
  (existing `Reveal` approach), so the first paint and LCP never wait for motion.
- Anything animated is **interruptible** (tweens are killed on unmount, on a new action, and on route change) and never sets
  `pointer-events: none` or delays focus.

### 11.2 Easing and direction (same on every area)

| Intent                 | GSAP ease      | CSS equivalent (tokens)                           | Direction                                                     |
| ---------------------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Enter / reveal         | `power3.out`   | `--ls-ease-premium` (`cubic-bezier(.22,1,.36,1)`) | Fade in and move **up** by 16 px (`--ls-reveal-shift`)        |
| Exit                   | `power2.in`    | `--ls-ease` reversed                              | Back the way it came, shorter (8 px) and faster               |
| Move / reposition      | `power2.inOut` | `--ls-ease`                                       | Along the axis of the change                                  |
| Press / hover feedback | `power2.out`   | `--ls-ease-out`                                   | Scale 0.98 on press; hover as rule 4 (color), image zoom 1.02 |

Horizontal movement only for: carousels and rows, drawers (from the trailing edge), the back/forward page transition. A
forward navigation moves in from the trailing side, back from the leading side (View Transitions; lateral navigation between
tabs only crossfades).

### 11.3 Durations

Read from CSS custom properties in `tokens.css` (GSAP reads them with `getComputedStyle` at init; **no literal durations in
components**, extending the existing ratchet). Reduced motion sets them all to 0 (kept).

| Token (existing name) | Customer pages                        | POS and admin | Used for                                                 |
| --------------------- | ------------------------------------- | ------------- | -------------------------------------------------------- |
| `--ls-dur-fast`       | 150 ms                                | 120 ms        | Press, hover, focus ring, toggles                        |
| `--ls-dur-base`       | 240 ms                                | 200 ms (cap)  | Menus, popovers, tabs, toasts, dialogs, drawers          |
| `--ls-dur-slow`       | 320 ms                                | 200 ms (cap)  | Route fade/transition, page-level changes                |
| `--ls-dur-reveal`     | 560 ms                                | not used      | Band and card reveal on scroll                           |
| `--ls-dur-hero` (new) | 800 ms total                          | not used      | Hero sequence: image settle, headline, sentence, buttons |
| `--ls-stagger`        | 60 ms, max 6 siblings, then in groups | not used      | Cards in a row/grid                                      |

**Staff cap: no tween longer than 200 ms**; route content fade 120 ms; skeleton pulse 1400 ms (the one repeating animation, 0 under
reduced motion).

### 11.4 Where it applies

- **Customer (full):** hero sequence once on load; scroll reveals (`ScrollTrigger`, `once: true`, `start: "top 85%"`, no scrub, no
  pin); row/grid stagger; card image zoom on hover (fine pointers only); header: compact on scroll (height 64 to 52, content
  moves by transform only, layout box unchanged, kept from today); page transitions via React `ViewTransition`
  (`nav-forward`/`nav-back`, shared element from a list card to its detail image); booking stepper step change slides along the
  sequence direction; counters (loyalty points) count up once, under 600 ms, with the final number in the DOM from the start;
  toasts, dialogs, drawers per 11.3.
- **POS and admin (restrained):** press, hover, focus, menu/dialog/drawer open and close, toast in/out, tab underline, route fade
  120 ms, skeleton. Nothing else. Typing, scanning, table data updates, totals and board drags are never animated. Inputs
  accept keystrokes during every transition.
- **Seasonal layer:** unchanged (own particles, own `ls-fx` rules).

### 11.5 Off switch and reduced motion

- One gate: the existing `MotionGate` sets `data-ls-motion="full|reduced"` on `<html>` (reduced motion, data saver, low memory).
  GSAP initializes through one wrapper (`gsap.matchMedia`) that checks that gate; `reduced` means **no tweens at all**: content is
  in its final state, and moves are replaced by a 0 ms or 120 ms fade at most (HIG).
- **Global off switch: required (locked); mechanism approved (Q8).** Extend the same gate with the visitor's `ls-fx=off` cookie (today it turns off the seasonal
  particles through the visible "Turn off effects" control) so one switch turns off GSAP **and** the particles, on customer
  and staff screens, plus a staff setting to turn motion off for the whole counter. A build-time kill flag disables the GSAP chunk
  entirely.
- Videos never autoplay with sound; any autoplay video has a visible pause and honours the gate.
- Seasons, ViewTransition and GSAP never animate the same element in the same moment (View Transitions own the route change;
  GSAP owns in-page choreography).

### 11.6 Delivery

GSAP is **not a dependency today** and is not added by this document. Approved (Q8) for group 1. Plan: `gsap` core + `ScrollTrigger` only, loaded by a
dynamic import after first paint on **every** area (customer, POS, admin), and a thin shared hook in `packages/ui` (`useMotion`) so
components never import GSAP directly. The wrapper reads the area from `data-density` and **clamps every duration to 200 ms in the
compact scope**, so the staff cap is enforced in code, not left to each component; it never sets `pointer-events` and never
starts a tween on an element that holds focus in a text field. When GSAP is added in group 1, check the current license text on gsap.com first (search results say GSAP is free including its former
paid plugins, but no license text was read when this was written; sources: [GSAP README on jsDelivr](https://cdn.jsdelivr.net/npm/gsap@3.15.0/README.md),
[GreenSock forum](https://gsap.com/community/forums/topic/44709-clarification-on-gsap-licensing-for-a-wordpress-plugin/)).
**Bundle budget (Owner approved, 2026-10-14):** the wrapper may add at most 3 KB gzip to the first load, and the lazy GSAP chunks (core + ScrollTrigger) stay at or under 50 KB gzip together. Measured in C7: +2.0 KB first load, 44.6 KB lazy.

## 12. Accessibility

WCAG 2.2 AA is the floor, with the HIG rules of section 4. Applies to every area.

- **Contrast:** section 6 tokens are the only allowed colors; both modes checked on every elevation step; focus ring 3:1 against
  the adjacent colors in both modes; `prefers-contrast: more` swaps hairlines and control borders to `--ls-text`.
- **Targets and spacing:** H3. No two targets closer than 8 px.
- **Keyboard:** everything reachable and operable; logical tab order; visible focus on every element (2 px ring); skip-to-content link;
  no keyboard traps except dialogs (trapped and returned); roving focus in tabs/menus; shortcuts never override browser ones.
- **Semantics:** one `h1` per page, ordered headings, landmarks (`header`, `nav`, `main`, `footer`), real `button` vs `a`,
  `aria-current`, `aria-sort`, `aria-live` for toasts and form results, tables with `th scope`, form fields tied to labels and errors.
- **Text:** `rem` units; usable at 200 % text and 320 px width without loss or horizontal scroll; the project's 130 % text check
  stays in the gate; `lang="vi"/"en"` on the root and on switched fragments; Vietnamese diacritics never clipped (line height
  at least 1.2 on headings).
- **Color:** never the only signal (H5); status and sale always have text or an icon.
- **Motion:** section 11.5; nothing flashes more than 3 times a second; no auto-moving content that cannot be paused for more
  than 5 s (carousels have pause and respect the gate).
- **Images:** meaningful `alt` in the page language, decorative `alt=""`; text on photos only over a flat scrim that passes 4.5:1; photos
  have `width`/`height` to avoid layout shift.
- **Gestures:** every swipe or drag has a button/keyboard alternative (carousel arrows, sheet Close, drag reorder).
- **Time limits:** none that expire silently; the OTP/payment timers show remaining time as text.
- **Reduced transparency and forced colors:** header blur falls back to opaque; `forced-colors` keeps borders and focus visible.
- **Screen reader labels** on every icon button, row menu, carousel, rating ("4,5 trên 5 sao").
- **Input:** correct `type`, `inputmode`, `autocomplete`; paste allowed; OTP fields support `autocomplete="one-time-code"`.

## 13. Kept unchanged (what the redesign does not touch)

All functions, data, API, permissions, routes and IA; the light/dark toggle with its three options (Light, Dark, Auto by time,
`ls-theme` cookie, tokens declared twice in dark) and the `data-theme` mechanism; the **seasonal decoration layer** (registry,
`season.css`, ornaments, kits, particles, preview, `data-season`); the "LUCY SPA" text wordmark; no yellow or gold except holiday
decorations; copy rules (natural Vietnamese, never "khám"); the existing hover rule (Owner rule 4, with the staff row and sidebar exception of section 8); FR1-FR15, the UX gate, the
DOM audit and ratchets; integer VND, branch time zones, VI/EN.

## 14. Rollout and the per-group screenshot gate

**Order: customer, then POS, then admin.** Each group is its own Step set, its own before/after screenshots, its own Owner
review and its own deploy.

**How the groups can ship separately on one token source:** the new values are defined under a scope attribute (`data-ui="v2"`)
using the **same token names**; a group switches on by setting the attribute on its layout root, so components change without
edits. Group 1 sets it on the customer frame (`.ls-site`); group 2 on the counter routes; group 3 on the rest of the workforce
shell. The last Step removes the old values and the attribute. (D1 is met at the end of group 3.)

| Group | Scope                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Customer: home, services, service detail, booking, products, product detail, cart, checkout, auth, account (all), ticket, info/CMS pages, 404, header/footer/tab bar/contact button, fonts, token v2, shared components used there, GSAP wrapper. |
| 2     | POS/counter: pos, invoice board, walk-in, booking-board, product-orders, online-orders, returns, cash, inventory counter views, counter header.                                                                                                   |
| 3     | Admin: dashboard, all lists/details/forms, reports, roles, organization, website/media/seasons, settings, AI/SEO screens, auth for staff, shell; removal of old tokens and direction C CSS.                                                       |

### Per-group checklist (every item answered yes/no in the Step report; any "no" is fixed or explained)

Screenshots: **before** (current production look) and **after** of every changed screen at **360, 768, 1440 px light** and
**1440 px dark** (plus 130 % text and dark 360 for the key screens), in all states (loading, empty, error, success, disabled,
long text, many items, no image). Every image is opened and reviewed (CLAUDE.md rule), not just generated. Tool:
`node scripts/uxui-screens.mjs`; DOM audit: `uxui-audit-capture.mjs` and `-summary.mjs --compare` (no count may rise).

| #   | Check                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | **Follows HIG rules** H1-H14: for each of H1 to H14 note pass or the exact screen/element that fails. Includes 44 px targets (40 compact fine-pointer), contrast table in 6, labels on every input, focus visible, text usable at 200 %.                                                                                                                                                   |
| G2  | **Matches the shared DNA** D1-D9: wordmark and header identical to the other groups; tokens only (no hex, no px/rem spacing literal, no new `wf-*` class); one component set with the compact variant; same scale and weights; accent only where D5 allows; icons from the one set; band colors `#ffffff`/`#f5f5f7` (dark `#000000`/`#1c1c1e`); radius 8/18/pill only; motion from tokens. |
| G3  | **Look:** no shadow, no gradient (except the seasonal layer), hairlines not boxes inside cards, no orphaned elements, aligned edges, one vertical rhythm, sensible max widths, no layout shift.                                                                                                                                                                                            |
| G4  | **Layout:** matches the Aevi pattern of its page (section 9) or the compact pattern (section 10); services and booking most prominent on the customer side; one primary action per view.                                                                                                                                                                                                   |
| G5  | **Dark mode:** stepped surfaces, accent `#e48f9f`, text on accent fill near-black, no accent text on E3, images not glowing, status readable.                                                                                                                                                                                                                                              |
| G6  | **Motion:** values from tokens; staff Steps: nothing over 200 ms, nothing blocks input; reduced-motion and the off switch tested (both produce the final state with no tween); no animation of blur or layout.                                                                                                                                                                             |
| G7  | **Functions unchanged:** no logic/API/DB change; the relevant tests pass; the season layer renders as before; toggle works in three options.                                                                                                                                                                                                                                               |
| G8  | **Copy:** natural Vietnamese, verbs on buttons, sentence case, no "khám", error text says the fix.                                                                                                                                                                                                                                                                                         |
| G9  | **Ratchets and gate:** `ui-ratchet.test.ts` counters only down; DOM audit compared with the baseline; `pnpm format:check` clean; targeted tests and typecheck/lint of touched packages.                                                                                                                                                                                                    |
| G10 | **Before/after pairs** delivered to `.local/uxui-screens/` for Owner approval, with what could not be fixed stated.                                                                                                                                                                                                                                                                        |

## 15. Implementation notes (for the Steps that follow; not done in this change)

- **Fonts:** `next/font` Be Vietnam Pro (weights 400, 500, 600; latin + vietnamese subsets) replaces Fraunces, Nunito Sans and Playfair
  Display; `--ls-font-display`, `--ls-font-staff-title` and the legacy `--lucy-font-*` aliases are removed at the end of group 3.
- **tokens.css:** add the v2 scope with the values of 6; set `--ls-shadow-*` to `none` under v2; add `--ls-dur-hero`, `--ls-bg-pressed`,
  `--ls-band-*`; update `tokens.test.ts` for the new ratios (including dark accent on E0-E3 and the two dark blocks being identical)
  and `customer-tokens.test.ts`.
- **CSS:** `customer.css` (direction C) and `staff.css` shrink to layout and density only; `components.css` loses every shadow,
  gradient, rose color and per-area redefinition; the `ui-ratchet` counters are re-based per group, only down.
- **Density:** `data-density="compact"` on the staff shell.
- **Motion code:** `MotionGate`, `Reveal`, `route-fade`/`route-enter` and the nav ViewTransition stay; `Reveal` and the hero call the
  GSAP wrapper once GSAP is added in group 1; `ls-fx=off` handling is extended in one place.
- **React rules:** follow the installed `react-best-practices` (no waterfalls, dynamic import for GSAP, no re-render storms from
  scroll) and `react-view-transitions` (animate only what communicates a relationship) skills.
- **Tests:** screenshots and DOM audit per section 14; unit tests for token ratios; a test that no CSS outside `tokens.css` declares
  a color, radius or shadow value.

## 16. Decisions (Owner answers, 2026-10-14)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **Approved.** CLAUDE.md "Customer site redesign", "Staff screens in direction C" and the fonts/palette of "UI design rules" 1-2 are marked superseded by DESIGN.md. `docs/CUSTOMER_SITE_C.md` is superseded; its photo list stays valid.                                                                                                                                                                                            |
| Q2  | **Approved.** Dark accent `#e48f9f`.                                                                                                                                                                                                                                                                                                                                                                                                |
| Q3  | **Decided by Claude per Owner delegation.** Staff table rows and staff sidebar items hover with a neutral tint (`--ls-row-hover-bg`, `--ls-nav-hover-bg`), not the solid accent; the sidebar's current page stays solid accent. Owner rule 4 stays everywhere else. Reason: a solid accent across a full-width row recolors every cell and hurts scanning, and the HIG reserves color for primary actions and the current location. |
| Q4  | **Approved.** Flat auth panel (accent `#782b37`; dark `#1c1c1e`) and a hairline card; no gradient, no shadow.                                                                                                                                                                                                                                                                                                                       |
| Q5  | **Agreed.** The home reviews band is not built until the Owner decides to publish reviews.                                                                                                                                                                                                                                                                                                                                          |
| Q6  | **Approved.** 40 px compact controls on fine pointers for staff; 44 px on touch.                                                                                                                                                                                                                                                                                                                                                    |
| Q7  | **Approved.** Radius 8 / 18 / pill.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Q8  | **Approved.** GSAP core + ScrollTrigger, the durations of 11.3, `ls-fx=off` extended into the global off switch, plus a staff-wide motion setting. The license check and the bundle budget are done when GSAP is added in group 1; it is not added now.                                                                                                                                                                             |
| Q9  | **Approved.** Light / Dark / Auto by time is kept.                                                                                                                                                                                                                                                                                                                                                                                  |
| Q10 | **Approved.** Translucent sticky header with blur.                                                                                                                                                                                                                                                                                                                                                                                  |
| Q11 | **Approved.** Ink-filled "-%" label.                                                                                                                                                                                                                                                                                                                                                                                                |
| Q12 | **Approved.** The wordmark changes typeface only; spacing and color stay.                                                                                                                                                                                                                                                                                                                                                           |
| Q13 | **Approved.** `data-ui="v2"` scope per group.                                                                                                                                                                                                                                                                                                                                                                                       |
