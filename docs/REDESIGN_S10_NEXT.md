# Redesign session 10: what is left after the deploy decision (2026-10-17)

The Owner decided on 2026-10-17 to deploy Session 10 now. The evidence runs below were not finished and move to next week.
Done so far, with evidence: `docs/REDESIGN_S10_REPORT.md` section 9. Deploy guide: `docs/DEPLOY_S10.md`.

## 1. Owner approvals still pending (the code already uses the text; nothing here was approved by anyone but the Owner)

1. **`docs/redesign-s10/copy-review.md`**: every new or changed Vietnamese (and English) string. Approve, or send the rows to change.
2. **`docs/redesign-s10/privacy-deletion-draft.md`**: the account-deletion text for the privacy policy page. It is a draft; the
   published policy page is not changed. After approval the Owner enters it in the admin Website editor (section 5 of the policy).
3. **Report section 0 questions** (R22 focus ring, B15 vs C4 primary on cards, A2 readings: unused combo sessions and delivery copies,
   dark fill, layout changes, C15 vs FR8) and the open readings listed in sections 6 and 8 of the report. Until answered, what was built
   on them stays provisional.

## 2. Evidence runs not done (Owner, 2026-10-17: next week)

| #   | Run                                                                                                                                                                                                                                             | How / where                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Final capture of every page (E1 shots + E2 measurement), customer, admin, POS, light and dark, 5 modes                                                                                                                                          | `.local/s10/` rig, scratch DB `lucy_spa_polish1_scratch` (web 3100, API 3101); the last complete run was `s10final` (one build older than the deployed code); `s10final2` stopped after 4 customer pages |
| 2   | Motion evidence (G8): motion probe and morph frames                                                                                                                                                                                             | `.local/s10/` motion probe scripts; results to `docs/REDESIGN_S10_REPORT.md` section 5                                                                                                                   |
| 3   | DOM audit against the real app: `node scripts/uxui-audit-capture.mjs --all`, then `node scripts/uxui-audit-summary.mjs --compare docs/uxui-audit-baseline.json`; no count may rise; lower the ratchet (`UPDATE_RATCHET=1`) for what was retired | scratch DB `lucy_spa_uxaudit_20261001`, never the dev DB                                                                                                                                                 |
| 4   | States rerun (B23: hover, focus, disabled, error, loading, empty) after the last CSS changes, the before/after pairs and the DNA board                                                                                                          | `.local/s10/` states script                                                                                                                                                                              |
| 5   | Check that what the E4 review fixed (`.local/s10/e4-review.md`, summarised in the report) still holds on the deployed build, and look at the pages the review could not see in the scratch data (`my-payslip-detail`, `product-rewrite-detail`) | scratch stack                                                                                                                                                                                            |

Run them one at a time (the machine ran out of memory when several ran together); no background agents.

## 3. Housekeeping

- **Remove `D:/lucy-base`** (git worktree of `8001336`, the baseline build served on port 3102 for before/after pairs) once run 4 is
  finished: stop anything serving from it, then `git worktree remove D:/lucy-base`. `D:/lucy-spa-p9-old` is an older worktree
  (`d42ab4e`) from Phase 9; remove it the same way if the Owner agrees.
- Drop the scratch databases made for this deploy check: `lucy_spa_s10deploy_scratch` (and `lucy_spa_s10final_scratch` when run 1 is done).
- After the deploy, record the Owner's deploy report in `LUCYSPA_HANDOFF.md` (commit, migrations, date) as the rules require.
