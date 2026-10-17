# Deploying S10 hotfix 2 (brand logo: the image description step reloaded the page, real fix) to production

For the Owner. Paste each numbered block into the iNET web terminal (logged in to the server) **one at a time**, in order, and wait for the last line before the next. Every block is wrapped in `( ... )`: copy from the `(` on the first line to the `)` on the last line. Every block checks itself and **stops with a `STOP:` line** when anything differs from what is expected. When you see `STOP:`: do **not** rerun, take a screenshot from the `STOP:` line upwards, and send it to Claude. Claude never touches the server; only the Owner runs commands.

**Code to install:** commit `1ff8ddcdd2f5bb1f55f49314b3142d0a29289097` (full 40 characters, already filled into every block that needs it). Docs-only commits pushed after it do not change running code. Start only when GitHub Actions is green on this commit.
**Code running now (Owner report, hotfix 1 deploy of 2026-10-17):** `f8f75e8544eb96897d258fb8d6b36921c3739dd3`, **139 migrations, 82 permissions**. Block 1 stops unless the server is exactly in that state.
**Database:** no migration, no permission change, nothing written. Block 2 **stops if the new code has any new migration** (or any change outside the web app).
**Why hotfix 1 did not work:** it assumed the "Lưu mô tả và dùng ảnh" click reached the page's code and then also saved the brand form. A real browser run on that build showed otherwise: the description step was a form nested inside the brand form, and Chrome and Edge never hand the submit of a nested form to the page's code, so nothing stopped the browser's own form send: a full page load of `/products?altVi=...` (no save request at all). That is the reload, the lost form and the jump to the Sản phẩm tab. The description step is now a plain group with a Save button (Enter in the field also saves), so no form is nested.
**What changes for people:** admin, Sản phẩm, Thương hiệu, ⋮, Chỉnh sửa…, "Logo trên trang chủ", "Chọn ảnh…": after "Lưu mô tả và dùng ảnh" the brand form stays open with the image in the Logo field; you then press Lưu. The same step is used by categories, service groups, slides, popups, seasons, shop info, footer blocks, products and campaigns, and is fixed everywhere at once. An image that already has a Vietnamese description goes straight back to the form, as before.
**Time:** about 15 minutes (the build is the longest). Only the web process is reloaded; API, worker and POS keep running. Customer pages may show a short error while web reloads.

## Block 1: checks, state and web backup (read-only except the backup files)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=1ff8ddcdd2f5bb1f55f49314b3142d0a29289097
OLD=f8f75e8544eb96897d258fb8d6b36921c3739dd3
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
echo "=== 1a. Preconditions ==="
expect "running code (exactly the hotfix 1 commit)" "$(git rev-parse HEAD)" "$OLD"
expect "migrations and permissions" "$(sqlq $DB "$COUNTS")" "139|82"
expect "server working tree clean" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 3 ] || dung "disk has $FREE GB free, need at least 3 GB"
echo "OK  free disk: $FREE GB"
echo "=== 1b. Web backup ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WEBBACKUP=/root/backups/lucyspa-web-pre-hotfix2-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "could not pack the web backup"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "the web backup is too small"
[ "$(tar -tzf "$WEBBACKUP" | wc -l)" -gt 500 ] || dung "the web backup has unusually few files"
echo "OK  web backup: $WEBBACKUP"
echo "=== 1c. Record the numbers that must not change ==="
{
  echo "STAMP=$STAMP"
  echo "OLD=$OLD"
  echo "WEBBACKUP=$WEBBACKUP"
  echo "USERS_BEFORE=$(sqlq $DB "select count(*) from users")"
  echo "INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")"
  echo "PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")"
  echo "BRANDS_BEFORE=$(sqlq $DB "select count(*) from brands")"
} > /root/backups/hotfix2-state.env
chmod 600 /root/backups/hotfix2-state.env
. /root/backups/hotfix2-state.env
echo "Recorded: running=$OLD users=$USERS_BEFORE invoices=$INVOICES_BEFORE payments=$PAYMENTS_BEFORE brands=$BRANDS_BEFORE"
echo "=== BLOCK 1 DONE: no STOP. Next: block 2 ==="
)
```

**Expect:** `OK` lines (running code `f8f75e8...`, `139|82`, `0`, the three processes, free disk, the backup path), one `Recorded:` line, `=== BLOCK 1 DONE`. About 1 minute. **If different:** any `STOP:` means the server is not in the state this guide was written for: send the screenshot, do nothing else. The backup made here stays on disk; it is harmless.

## Block 2: fetch the code, prove there is no migration, install, build (nothing is restarted; the database is not touched)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=1ff8ddcdd2f5bb1f55f49314b3142d0a29289097
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun unless the text below says you may."; exit 1; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
test -f /root/backups/hotfix2-state.env || dung "block 1 has not been run (no state file)"
. /root/backups/hotfix2-state.env
expect "still running the code block 1 found" "$(git rev-parse HEAD)" "$OLD"
git fetch origin || dung "git fetch failed"
expect "new commit exists" "$(git cat-file -t "$NEW" 2>/dev/null)" "commit"
expect "no new migration (changed files under packages/database)" "$(git diff --name-only "$OLD" "$NEW" -- packages/database | wc -l | tr -d ' ')" "0"
expect "no change to API, worker or shared server code" "$(git diff --name-only "$OLD" "$NEW" -- apps/api apps/worker packages/server packages/contracts packages/config | wc -l | tr -d ' ')" "0"
git checkout "$NEW" || dung "git checkout failed"
expect "new code" "$(git rev-parse HEAD)" "$NEW"
expect "139 migration folders" "$(ls -d packages/database/prisma/migrations/2* | wc -l | tr -d ' ')" "139"
pnpm install --frozen-lockfile || dung "pnpm install failed (the running site was not touched). Run block R to put the code back."
pnpm db:generate || dung "db:generate failed. Run block R."
pnpm build || dung "pnpm build failed. If the error mentions downloading fonts, it is the network: you may rerun THIS block once. Any other error: do not rerun, run block R and send the screenshot."
expect "the fix is in the code on disk (description step is a group, not a form)" "$(grep -c 'role="group" aria-label={text.altTitle}' apps/web/src/components/workforce/screens/media-picker.tsx)" "1"
expect "the old nested form is gone from the picker" "$(grep -c 'onSubmit={(event)' apps/web/src/components/workforce/screens/media-picker.tsx)" "0"
echo "=== BLOCK 2 DONE: no STOP. Next: block 3 ==="
)
```

**Expect:** `OK` lines (`commit`, `0`, `0`, the new code, `139`), long install and build output, the two `the fix` / `the old nested form` lines (`1` and `0`), `=== BLOCK 2 DONE`. About 10 minutes. The old site keeps running while it builds; customer pages may show an error for a minute near the end, when the new build replaces the old files. **If different:** a `STOP:` on the two `0` lines means the new code carries a migration or a server change this guide does not cover: nothing was changed, send the screenshot. A failed build: see the STOP line; if the site shows errors, run **block R**.

## Block 3: reload web and check the /vi pages (creates or changes no data)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=1ff8ddcdd2f5bb1f55f49314b3142d0a29289097
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
test -f /root/backups/hotfix2-state.env || dung "block 1 has not been run"
expect "code on disk is the new commit" "$(git rev-parse HEAD)" "$NEW"
expect "database still at 139|82" "$(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)")" "139|82"
pm2 reload lucyspa-web --update-env >/dev/null 2>&1
sleep 20
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online (not restarted)" "$(count_online lucyspa-api)" "1"
expect "worker online (not restarted)" "$(count_online lucyspa-worker)" "1"
expect "health" "$(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')" "1"
expect "page /vi (no trailing slash)" "$(http http://127.0.0.1:3000/vi)" "200"
for PAGE in services products contact account/login; do
  expect "page /vi/$PAGE" "$(http http://127.0.0.1:3000/vi/$PAGE)" "200"
done
expect "page /en" "$(http http://127.0.0.1:3000/en)" "200"
expect "staff login" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for PAGE in products services website; do
  R=$(http http://127.0.0.1:3000/vi/workforce/$PAGE)
  case "$R" in 200|307) echo "OK  screen /vi/workforce/$PAGE: $R";; *) dung "screen /vi/workforce/$PAGE answered $R (expected 200 or 307)";; esac
done
expect "favicon" "$(http http://127.0.0.1:3000/favicon.ico)" "200"
echo "--- last 10 error lines of web (only lines after the reload time matter) ---"
pm2 logs lucyspa-web --err --lines 10 --nostream 2>&1 | tail -n 10
echo "=== BLOCK 3 DONE: site is up on the new code. Next: block 4 ==="
)
```

**Expect:** `OK` lines (new code, `139|82`, the three processes, health `1`, every page `200`, the three staff screens `200` or `307`, favicon `200`), the web error log, `=== BLOCK 3 DONE`. About 1 minute. The error lines are mostly old history ("Server Reference ID did not match" right after a reload is a browser tab left open; harmless). **If different:** a page that is not 200 right after the reload can be web still warming up: wait 30 seconds and rerun **only this block** (it changes nothing). Still wrong, or web `errored`: run **block R** and send the screenshot.

## Block 4: final numbers (read-only; send the output to Claude Code)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
. /root/backups/hotfix2-state.env
echo "running code:      $(git rev-parse HEAD) (expected 1ff8ddcdd2f5bb1f55f49314b3142d0a29289097)"
echo "previous code:     $OLD"
echo "migrations|perms:  $(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)") (expected 139|82)"
echo "users/invoices/payments now vs before: $(sqlq $DB "select count(*) from users")/$(sqlq $DB "select count(*) from invoices")/$(sqlq $DB "select count(*) from payments") vs $USERS_BEFORE/$INVOICES_BEFORE/$PAYMENTS_BEFORE"
echo "brands now vs before: $(sqlq $DB "select count(*) from brands") vs $BRANDS_BEFORE"
echo "home /vi: $(http http://127.0.0.1:3000/vi)  /vi/products: $(http http://127.0.0.1:3000/vi/products)  /vi/services: $(http http://127.0.0.1:3000/vi/services)"
echo "web backup:        $WEBBACKUP"
pm2 status
echo "=== BLOCK 4 DONE ==="
echo ">>> Now paste this whole output to Claude Code and tell it: record the deployed commit and the migration state in LUCYSPA_HANDOFF.md."
)
```

**Expect:** the code hash `1ff8ddc...`, the previous hash `f8f75e8...`, `139|82`, users/invoices/payments equal to the "before" counts (invoices and payments may be higher only if the cashier worked during the deploy), brands unchanged, pages `200`, the backup path, pm2 all `online`. Send Claude Code this whole output.

## After the blocks (you, in a browser)

Use a fresh incognito window, or press Ctrl+F5 on the admin page first: a tab opened before the reload still runs the old page code.

1. Admin, Sản phẩm, Thương hiệu, ⋮ on BELIF, Chỉnh sửa…, "Logo trên trang chủ", "Chọn ảnh…", pick an image without a description, type the description, press "Lưu mô tả và dùng ảnh". **The brand form stays open, still on the Thương hiệu tab, and shows the image in the Logo field.** Press Lưu: "Đã lưu." appears.
2. Open BELIF again: the logo is shown. Press "Đổi ảnh…" and pick the same image: it goes straight back to the form with no description question.
3. Home page brand band: it appears for a brand that has a logo, "Hiện trong dải thương hiệu" ticked and at least one product on sale. The public product list is cached for up to 60 seconds (measured 58 s on the test copy), so refresh the home page after a minute.

## Rollback

No migration, so the database never needs to change: rolling back puts the hotfix 1 build back (the one block 1 saved) and the hotfix 1 code `f8f75e8`. No rebuild, about 2 minutes. (Hotfix 1 still has the logo bug; rolling back only removes this change.)

### Block R: back to f8f75e8

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
OLD=f8f75e8544eb96897d258fb8d6b36921c3739dd3
test -f /root/backups/hotfix2-state.env || { echo "STOP: no state file (block 1 never ran, so nothing was changed)"; exit 1; }
. /root/backups/hotfix2-state.env
[ "$OLD" = "f8f75e8544eb96897d258fb8d6b36921c3739dd3" ] || { echo "STOP: the state file names another previous commit"; exit 1; }
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

**Expect:** the pm2 table all `online`, `running code: f8f75e8...`, `home: 200  health: 1`. **If different:** send the screenshot; do not try anything else.
