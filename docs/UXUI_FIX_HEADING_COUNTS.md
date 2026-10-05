# Fix: no count next to section headings (2026-10-05)

Owner decision: the small number after a section title ("Sắp tới 0", "Lịch sử điểm 0", "Combo của tôi 0") reads as a stray
"o" or a degree sign. It is removed everywhere.

## Change

- `ListSection` (`packages/ui/src/page.tsx`) no longer has a `count` prop: the title is text only. Its CSS
  (`.ls-list-section-count`, and the public-site variant) is deleted. All 28 callers lost their `count=` argument (the
  type check found each one); `BookingsSection` lost its now unused `board` prop.
- Kept: the table line "Hiển thị x–y trong n" (pagination), the empty-state messages and the toolbar result count.
- Rule added to `CLAUDE.md` (UX gate digest): headings are text only, no decorative number, count, badge or symbol.
- Tests: `ListSection` markup test now asserts no `<span>`; the site CSS test asserts the count class is gone.
- No migration, permission or copy change. No other count-after-heading pattern exists in `apps/web` (searched).

## Tests

`pnpm lint`, `pnpm format:check`, whole-repo `pnpm test` clean (see the commit message for the final run).

## UX gate

Real app on scratch DB, 360/768/1440 in light and dark, DOM check on every page (no `.ls-list-section-count`, no heading
ending in a number) plus screenshots in `.local/uxui-screens/hc-after-headings`, opened and read: customer Lịch hẹn and
Điểm thưởng (all six headings clean, "Hiển thị 1-6 trong 6" kept), admin Hóa đơn (dark 1440), Điểm thưởng > Combo đã bán
(768). Also checked: Danh sách combo, Giới thiệu, Danh mục quà, Bảng điều phối. Spacing under headings is unchanged.
DOM audit on Hóa đơn, Nhóm, Chi tiết nhóm / nhân viên / dịch vụ / ưu đãi and Bảng điều phối: 0 findings; compare with
`docs/uxui-audit-baseline.json`: no count above baseline except the known login-card `edge-left` (see the menu-layer fix).
