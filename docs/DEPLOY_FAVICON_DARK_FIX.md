# Deploying the dark tab icon fix (web only, no migration) to production

For the Owner. Paste each block into the iNET web terminal (logged in to the server) **one at a time**, in order, and wait for the last line before the next. Every block is wrapped in `( ... )`: copy from the `(` on the first line to the `)` on the last line. Every block checks itself and **stops with a `STOP:` line** when anything differs from what is expected. When you see `STOP:`: do **not** rerun, take a screenshot from the `STOP:` line upwards, and send it to Claude. Claude never touches the server; only the Owner runs commands.

**Code to install:** commit `f528986f0a55e34037106eca80f18e14c840f65a` (full 40 characters, already filled into every block that needs it). Docs-only commits pushed after it do not change running code. Start only when GitHub Actions is green on this commit.
**Code running now (Owner report, hotfix 2 deploy of 2026-10-17 ~22:45 +07, recorded in `LUCYSPA_HANDOFF.md`):** `1ff8ddcdd2f5bb1f55f49314b3142d0a29289097`, **139 migrations, 82 permissions**. Block F1 stops unless the server is exactly in that state. (The favicon code is the same in `7e9bff5` and `1ff8ddc`; if the server really runs another commit, F1 stops and says which.)
**Database:** no migration, no permission change, nothing written. Block F2 **stops if the new code changes anything outside the web app**.
**Why the dark icon did not show:** the page declared `favicon.ico` with `sizes="any"` next to the light PNG, and a script changed the PNG to the dark one. Chrome and Edge keep the ICO and ignore the changed PNG (reproduced in real Chrome 155 and Edge by reading the icon the browser stored for the page; the earlier check only looked at the `<link>` in the page, not at the icon the browser chose).
**What changes:** the page now declares two PNG icons, each with `media="(prefers-color-scheme: ...)"`, dark first and light last. The browser picks by itself, with no script: dark icon in dark mode, light icon in light mode, also when the theme changes while the tab is open. `favicon-theme.js` and its loader are removed; `favicon.ico` stays on the server as the root fallback. Apple-touch icon (light) unchanged. Nothing else changes.
**Time:** about 15 minutes (the build is the longest). Only the web process is reloaded; API, worker and POS keep running. Customer pages may show a short error while web reloads.

## Block F1: checks, state and web backup (read-only except the backup files)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=f528986f0a55e34037106eca80f18e14c840f65a
OLD=1ff8ddcdd2f5bb1f55f49314b3142d0a29289097
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
echo "=== F1a. Preconditions ==="
expect "running code (exactly the hotfix 2 commit)" "$(git rev-parse HEAD)" "$OLD"
expect "migrations and permissions" "$(sqlq $DB "$COUNTS")" "139|82"
expect "server working tree clean" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 3 ] || dung "disk has $FREE GB free, need at least 3 GB"
echo "OK  free disk: $FREE GB"
echo "=== F1b. Web backup ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WEBBACKUP=/root/backups/lucyspa-web-pre-favicon3-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "could not pack the web backup"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "the web backup is too small"
[ "$(tar -tzf "$WEBBACKUP" | wc -l)" -gt 500 ] || dung "the web backup has unusually few files"
echo "OK  web backup: $WEBBACKUP"
echo "=== F1c. Record the numbers that must not change ==="
{
  echo "STAMP=$STAMP"
  echo "OLD=$OLD"
  echo "WEBBACKUP=$WEBBACKUP"
  echo "USERS_BEFORE=$(sqlq $DB "select count(*) from users")"
  echo "INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")"
  echo "PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")"
} > /root/backups/favicon3-state.env
chmod 600 /root/backups/favicon3-state.env
. /root/backups/favicon3-state.env
echo "Recorded: running=$OLD users=$USERS_BEFORE invoices=$INVOICES_BEFORE payments=$PAYMENTS_BEFORE"
echo "=== BLOCK F1 DONE: no STOP. Next: block F2 ==="
)
```

**Expect:** `OK` lines (running code `1ff8ddc...`, `139|82`, `0`, the three processes, free disk, the backup path), one `Recorded:` line, `=== BLOCK F1 DONE`. About 1 minute. **If different:** any `STOP:` means the server is not in the state this guide was written for: send the screenshot, do nothing else. The backup made here stays on disk; it is harmless.

## Block F2: fetch the code, prove it is web only, install, build (nothing is restarted; the database is not touched)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=f528986f0a55e34037106eca80f18e14c840f65a
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun unless the text below says you may."; exit 1; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
test -f /root/backups/favicon3-state.env || dung "block F1 has not been run (no state file)"
. /root/backups/favicon3-state.env
expect "still running the code block F1 found" "$(git rev-parse HEAD)" "$OLD"
git fetch origin || dung "git fetch failed"
expect "new commit exists" "$(git cat-file -t "$NEW" 2>/dev/null)" "commit"
expect "no new migration (changed files under packages/database)" "$(git diff --name-only "$OLD" "$NEW" -- packages/database | wc -l | tr -d ' ')" "0"
expect "no change to API, worker or shared server code" "$(git diff --name-only "$OLD" "$NEW" -- apps/api apps/worker packages/server packages/contracts packages/config packages/ui | wc -l | tr -d ' ')" "0"
git checkout "$NEW" || dung "git checkout failed"
expect "new code" "$(git rev-parse HEAD)" "$NEW"
expect "139 migration folders" "$(ls -d packages/database/prisma/migrations/2* | wc -l | tr -d ' ')" "139"
pnpm install --frozen-lockfile || dung "pnpm install failed (the running site was not touched). Run block FR to put the code back."
pnpm db:generate || dung "db:generate failed. Run block FR."
pnpm build || dung "pnpm build failed. If the error mentions downloading fonts, it is the network: you may rerun THIS block once. Any other error: do not rerun, run block FR and send the screenshot."
expect "the layout has the two media icon links" "$(grep -c 'media="(prefers-color-scheme' 'apps/web/src/app/[locale]/layout.tsx')" "2"
expect "the layout no longer loads the icon script" "$(grep -c 'FaviconTheme' 'apps/web/src/app/[locale]/layout.tsx')" "0"
expect "the icon script file is gone" "$(ls apps/web/public/favicon-theme.js 2>/dev/null | wc -l | tr -d ' ')" "0"
echo "=== BLOCK F2 DONE: no STOP. Next: block F3 ==="
)
```

**Expect:** `OK` lines (`commit`, `0`, `0`, the new code, `139`), long install and build output, then `2`, `0`, `0`, `=== BLOCK F2 DONE`. About 10 minutes. The old site keeps running while it builds; customer pages may show an error for a minute near the end, when the new build replaces the old files. **If different:** a `STOP:` on the two `0` lines means the new code carries a migration or a server change this guide does not cover: nothing was changed, send the screenshot. A failed build: see the STOP line; if the site shows errors, run **block FR**.

## Block F3: reload web, check the pages and the icon links, final numbers (creates or changes no data)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=f528986f0a55e34037106eca80f18e14c840f65a
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
test -f /root/backups/favicon3-state.env || dung "block F1 has not been run"
. /root/backups/favicon3-state.env
expect "code on disk is the new commit" "$(git rev-parse HEAD)" "$NEW"
expect "database still at 139|82" "$(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)")" "139|82"
pm2 reload lucyspa-web --update-env >/dev/null 2>&1
sleep 20
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online (not restarted)" "$(count_online lucyspa-api)" "1"
expect "worker online (not restarted)" "$(count_online lucyspa-worker)" "1"
expect "health" "$(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')" "1"
for PAGE in vi en vi/services vi/products vi/contact vi/account/login vi/workforce/login; do
  expect "page /$PAGE" "$(http http://127.0.0.1:3000/$PAGE)" "200"
done
for LANG in vi en; do
  ICONS=$(curl -s http://127.0.0.1:3000/$LANG | grep -o '<link[^>]*rel="icon"[^>]*>')
  expect "/$LANG: number of rel=icon links" "$(printf '%s\n' "$ICONS" | grep -c 'rel="icon"')" "2"
  expect "/$LANG: first icon is dark, with the dark media" "$(printf '%s\n' "$ICONS" | sed -n 1p | grep -c 'favicon-dark-32.png.*prefers-color-scheme: dark')" "1"
  expect "/$LANG: second icon is light, with the light media" "$(printf '%s\n' "$ICONS" | sed -n 2p | grep -c 'favicon-light-32.png.*prefers-color-scheme: light')" "1"
  expect "/$LANG: no link to favicon.ico, no icon script" "$(curl -s http://127.0.0.1:3000/$LANG | grep -c 'favicon-theme\|href="/favicon.ico"')" "0"
done
for FILE in favicon-dark-32.png favicon-light-32.png favicon-light-180.png favicon.ico; do
  expect "file /$FILE" "$(http http://127.0.0.1:3000/$FILE)" "200"
done
echo "--- last 10 error lines of web (only lines after the reload time matter) ---"
pm2 logs lucyspa-web --err --lines 10 --nostream 2>&1 | tail -n 10
echo "--- final numbers ---"
echo "running code:      $(git rev-parse HEAD) (expected $NEW)"
echo "previous code:     $OLD"
echo "migrations|perms:  $(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)") (expected 139|82)"
echo "users/invoices/payments now vs before: $(sqlq $DB "select count(*) from users")/$(sqlq $DB "select count(*) from invoices")/$(sqlq $DB "select count(*) from payments") vs $USERS_BEFORE/$INVOICES_BEFORE/$PAYMENTS_BEFORE"
echo "web backup:        $WEBBACKUP"
pm2 status
echo "=== BLOCK F3 DONE: site is up on the new code ==="
echo ">>> Paste this whole output to Claude Code and tell it: record the deployed commit and the migration state in LUCYSPA_HANDOFF.md."
)
```

**Expect:** `OK` lines (new code, `139|82`, the three processes, health `1`, every page `200`, for `/vi` and `/en`: `2`, `1`, `1`, `0`, the four files `200`), the web error log, the final numbers (users/invoices/payments equal to the "before" counts; invoices and payments may be higher only if the cashier worked during the deploy), the pm2 table all `online`, `=== BLOCK F3 DONE`. About 2 minutes. The error lines are mostly old history ("Server Reference ID did not match" right after a reload is a browser tab left open; harmless). **If different:** a page that is not 200 right after the reload can be web still warming up: wait 30 seconds and rerun **only this block** (it changes nothing). Still wrong, or web `errored`: run **block FR** and send the screenshot.

## After the blocks (you, in a browser)

Windows and Chrome in dark mode, a **fresh incognito tab**, `lucyspa.vn/vi`: the tab shows the **dark icon (white circle, red L)**. Windows and Chrome in light mode: the **light icon (red circle, white L)**. A normal window may keep the icon it stored earlier for the site for a while: use incognito or press Ctrl+Shift+R on the page. Safari and Firefox were not tested.

## Rollback

No migration, so the database never needs to change: rolling back puts the build saved in F1 and the hotfix 2 code `1ff8ddc` back (the tab icon is then light in dark mode again, as before). No rebuild, about 2 minutes.

### Block FR: back to 1ff8ddc

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
OLD=1ff8ddcdd2f5bb1f55f49314b3142d0a29289097
test -f /root/backups/favicon3-state.env || { echo "STOP: no state file (block F1 never ran, so nothing was changed)"; exit 1; }
. /root/backups/favicon3-state.env
[ "$OLD" = "1ff8ddcdd2f5bb1f55f49314b3142d0a29289097" ] || { echo "STOP: the state file names another previous commit"; exit 1; }
[ -s "$WEBBACKUP" ] || { echo "STOP: backup file $WEBBACKUP is missing"; exit 1; }
git checkout "$OLD" || { echo "STOP: git checkout failed"; exit 1; }
[ "$(git rev-parse HEAD)" = "$OLD" ] || { echo "STOP: not on the previous code"; exit 1; }
tar -xzf "$WEBBACKUP" -C /opt/lucyspa || { echo "STOP: could not unpack the backup"; exit 1; }
pm2 reload lucyspa-web --update-env
sleep 20
pm2 status
echo "running code: $(git rev-parse HEAD) (expected $OLD)"
echo "home: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/vi)  health: $(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')"
echo ">>> Rolled back. Paste this output to Claude Code and tell it: record the deployed commit and the migration state in LUCYSPA_HANDOFF.md."
)
```

**Expect:** the pm2 table all `online`, `running code: 1ff8ddc...`, `home: 200  health: 1`. **If different:** send the screenshot; do not try anything else.
