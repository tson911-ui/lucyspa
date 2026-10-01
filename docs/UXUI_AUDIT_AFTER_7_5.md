# UX/UI Step 7.5f: DOM audit after Step 7.5 (before/after table)

Same method as the 7.5a baseline (`UXUI_AUDIT_BASELINE_7_5A.md`): real app (built API 3101 + web 3100) on scratch DB `lucy_spa_uxaudit_20261001`, 26 pages x 1440/768/360, light, `scripts/uxui-page-audit.js`. Light/dark were also run once: identical except 8 legacy runs where dark has one finding less. Snapshot saved as `docs/uxui-audit-after-7_5.json`. A finding is one distinct (type, element, detail) per run; hits add the element counts.

## Totals per check (all 78 runs)

| check                  | rule |   before |   after |     delta | hits before -> after |
| ---------------------- | ---- | -------: | ------: | --------: | -------------------- |
| border-collision       | FR3  |       12 |       0 |       -12 | 12 -> 0              |
| border-width-mix       | FR3  |       15 |       9 |        -6 | 15 -> 9              |
| content-overflow       | FR11 |       98 |      28 |       -70 | 98 -> 28             |
| edge-left              | FR6  |        4 |       4 |         0 | 4 -> 4               |
| heading-equals-control | FR10 |       15 |       9 |        -6 | 15 -> 9              |
| icon-text-misaligned   | FR6  |        2 |       2 |         0 | 2 -> 2               |
| inner-offset-mismatch  | FR2  |        1 |       0 |        -1 | 1 -> 0               |
| list-height-uneven     | FR8  |       11 |      11 |         0 | 11 -> 11             |
| nested-border-box      | FR3  |       47 |       7 |       -40 | 83 -> 27             |
| off-grid-spacing       | FR1  |     1202 |     207 |      -995 | 12986 -> 1665        |
| off-scale-font         | T    |      423 |       3 |      -420 | 5514 -> 27           |
| orphan-action          | FR5  |        3 |       0 |        -3 | 3 -> 0               |
| page-horizontal-scroll | FR11 |        1 |       0 |        -1 | 1 -> 0               |
| row-height-uneven      | FR8  |       24 |      18 |        -6 | 24 -> 18             |
| sibling-gap-uneven     | FR2  |      159 |      57 |      -102 | 159 -> 57            |
| small-target           | TGT  |       43 |      23 |       -20 | 1081 -> 182          |
| surface-style-mix      | FR3  |       36 |      31 |        -5 | 73 -> 54             |
| toolbar-label-above    | FR6  |       40 |      36 |        -4 | 40 -> 36             |
| unpaged-list           | FR8  |        3 |       3 |         0 | 3 -> 3               |
| wrapped-label          | FR8  |      157 |      40 |      -117 | 278 -> 112           |
| **all checks**         |      | **2296** | **488** | **-1808** |                      |

## Per page (distinct findings, all runs)

| page                  | before | after |
| --------------------- | -----: | ----: |
| account               |    105 |    13 |
| attendance            |     71 |    17 |
| booking-board         |    123 |    27 |
| branch-detail         |     89 |    18 |
| branches              |     72 |     8 |
| collaborator-schedule |     95 |    13 |
| dashboard             |     86 |    15 |
| discount-detail       |     78 |    12 |
| discounts             |     56 |    11 |
| employee-detail       |    238 |    48 |
| employees             |     54 |    18 |
| forgot                |     11 |     5 |
| income                |     40 |     3 |
| leave                 |     80 |    21 |
| login                 |     11 |     5 |
| notifications         |     31 |     9 |
| organization          |     67 |    15 |
| pos                   |     42 |     4 |
| reassignment          |     58 |    12 |
| roles                 |    176 |    66 |
| service-detail        |    135 |    16 |
| services              |    128 |    46 |
| skills                |    142 |    17 |
| team-detail           |    153 |    42 |
| teams                 |     93 |    17 |
| walk-in               |     62 |    10 |

## Reading it

- 2296 -> 488 findings (-79 %). **No check is above its baseline.** Retired: border collisions, orphan actions, page scroll, off-scale fonts (423 -> 3), the uneven stat offset.
- small-target 43 -> 23 (hits 1081 -> 182): the raw checkboxes on Roles, Service detail and Team detail are now `CheckField` (Review 7.5d-f, item 2). The audit script treats an input inside a kit `.ls-check-field` as one row-wide target and measures the row (at least 40 px desktop, 44 px touch, full width); a raw checkbox is still measured by its own box. Roles, Service detail and Team detail were re-run after the change.
- Still open by design: list-height-uneven (dashboard widget sizes differ), content-overflow and the Roles/Team/Service detail counts (raw `wf-table`, `<details>`, native fieldsets; Steps 8-10), toolbar-label-above on legacy filter forms.

## Reference comparison (8 questions, plan section 5) against docs/references/shadcn-admin-*.png

| #   | Question                                              | Skills (list + dialog)                                                | Branches                     | Dashboard                           |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------- | ----------------------------------- |
| 1   | Gutter 16 and header-to-content 24                    | No: gutter 32 on desktop by token (16 on phone); header to content 24 | same                         | same                                |
| 2   | Title 24/600, one-line muted description              | Title yes; no description on this page                                | Title yes; no description    | Yes (greeting + muted line)         |
| 3   | Actions right and bottom aligned                      | Yes (primary last)                                                    | Yes                          | Yes (select + layout button)        |
| 4   | Toolbar one row of equal-height controls              | Yes (search, filter, count, reload)                                   | n/a (4 rows, no toolbar)     | n/a                                 |
| 5   | One single-border table surface, uniform rows (48/56) | Yes                                                                   | Yes                          | n/a (cards)                         |
| 6   | Pagination one footer row                             | Yes                                                                   | Yes (summary only, one page) | n/a                                 |
| 7   | Create opens in a sheet or dialog                     | Yes (dialog; bottom sheet on phone)                                   | Yes                          | n/a                                 |
| 8   | No element touches another surface                    | Yes                                                                   | Yes                          | Yes (notice is a tint inside cards) |

Differences from the reference that are intended: wine brand color, 40/44 px controls, sidebar with groups, no inset-card main area.
