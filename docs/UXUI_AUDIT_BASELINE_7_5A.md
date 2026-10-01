# UX/UI Step 7.5a: DOM audit baseline (before any Step 7.5 UI change)

Generated from `docs/uxui-audit-baseline.json` (`node scripts/uxui-audit-summary.mjs --write`). Code: `99d77d5` + Step 7.5a tooling only (no UI change).
Real app (built API 3101 + web 3100) on scratch DB `lucy_spa_uxaudit_20261001`, 26 workforce/auth pages x 1440/768/360, light. Dark repeats the same findings (Step 7 audit).
Script: `scripts/uxui-page-audit.js` (rule tags FR1-FR15 of design contract 21.4). A "finding" is one distinct (type, element, detail) per run; hits add the element counts.

## Totals per check (all 78 runs)

| check                  | rule | findings |  hits |
| ---------------------- | ---- | -------: | ----: |
| border-collision       | FR3  |       12 |    12 |
| border-width-mix       | FR3  |       15 |    15 |
| content-overflow       | FR11 |       98 |    98 |
| edge-left              | FR6  |        4 |     4 |
| heading-equals-control | FR10 |       15 |    15 |
| icon-text-misaligned   | FR6  |        2 |     2 |
| inner-offset-mismatch  | FR2  |        1 |     1 |
| list-height-uneven     | FR8  |       11 |    11 |
| nested-border-box      | FR3  |       47 |    83 |
| off-grid-spacing       | FR1  |     1202 | 12986 |
| off-scale-font         | T    |      423 |  5514 |
| orphan-action          | FR5  |        3 |     3 |
| page-horizontal-scroll | FR11 |        1 |     1 |
| row-height-uneven      | FR8  |       24 |    24 |
| sibling-gap-uneven     | FR2  |      159 |   159 |
| small-target           | TGT  |       43 |  1081 |
| surface-style-mix      | FR3  |       36 |    73 |
| toolbar-label-above    | FR6  |       40 |    40 |
| unpaged-list           | FR8  |        3 |     3 |
| wrapped-label          | FR8  |      157 |   278 |

## Per page, 1440 px light (findings per check; "all" = every check, three widths)

| page                  | all | nested | unpaged | gap | dup title | orphan | tb label | wrapped | targets | h-scroll |
| --------------------- | --: | -----: | ------: | --: | --------: | -----: | -------: | ------: | ------: | -------: |
| account               | 105 |      1 |       0 |   3 |         0 |      0 |        0 |       1 |       0 |        0 |
| attendance            |  71 |      0 |       0 |   1 |         0 |      0 |        1 |       0 |       0 |        0 |
| booking-board         | 123 |      1 |       0 |  11 |         0 |      0 |        1 |       0 |       0 |        0 |
| branch-detail         |  89 |      0 |       0 |   0 |         0 |      0 |        0 |       0 |       1 |        0 |
| branches              |  72 |      0 |       0 |   0 |         1 |      0 |        0 |       0 |       0 |        0 |
| collaborator-schedule |  95 |      1 |       0 |   1 |         0 |      0 |        1 |       0 |       1 |        0 |
| dashboard             |  86 |      2 |       0 |   2 |         0 |      1 |        0 |      17 |       0 |        0 |
| discount-detail       |  78 |      1 |       0 |   1 |         1 |      0 |        0 |       0 |       0 |        0 |
| discounts             |  56 |      0 |       0 |   0 |         0 |      1 |        0 |       0 |       0 |        0 |
| employee-detail       | 238 |      2 |       0 |   7 |         0 |      0 |        2 |       1 |       1 |        0 |
| employees             |  54 |      2 |       0 |   0 |         0 |      0 |        1 |       3 |       0 |        0 |
| forgot                |  11 |      0 |       0 |   1 |         0 |      0 |        0 |       0 |       0 |        0 |
| income                |  40 |      0 |       0 |   0 |         0 |      0 |        1 |       0 |       0 |        0 |
| leave                 |  80 |      0 |       0 |   1 |         0 |      0 |        1 |       3 |       0 |        0 |
| login                 |  11 |      0 |       0 |   1 |         0 |      0 |        0 |       0 |       0 |        0 |
| notifications         |  31 |      0 |       0 |   0 |         0 |      0 |        0 |       0 |       1 |        0 |
| organization          |  67 |      0 |       0 |   1 |         0 |      0 |        0 |       1 |       0 |        0 |
| pos                   |  42 |      1 |       0 |   0 |         0 |      1 |        1 |       0 |       0 |        0 |
| reassignment          |  58 |      0 |       0 |   0 |         0 |      0 |        1 |       0 |       1 |        0 |
| roles                 | 176 |      1 |       0 |  12 |         0 |      0 |        0 |       1 |       2 |        0 |
| service-detail        | 135 |      0 |       0 |   1 |         0 |      0 |        0 |       1 |       1 |        0 |
| services              | 128 |      0 |       1 |   3 |         0 |      0 |        0 |       2 |       1 |        0 |
| skills                | 142 |      1 |       0 |   1 |         1 |      0 |        1 |       5 |       0 |        0 |
| team-detail           | 153 |      2 |       0 |   4 |         1 |      0 |        1 |       1 |       2 |        0 |
| teams                 |  93 |      0 |       0 |   1 |         1 |      0 |        1 |       3 |       0 |        0 |
| walk-in               |  62 |      1 |       0 |   2 |         0 |      0 |        1 |       0 |       0 |        0 |

Reading notes: `orphan-action` is a heuristic and only inspects page headers at 1440 px plus lone buttons outside action places (it finds the Invoices "Tải lại");
`sibling-gap-uneven`, `wrapped-label` and `orphan-action` can flag deliberate layouts and are reviewed, not silenced. `unpaged-list` fires only for Services today (64 rows).
