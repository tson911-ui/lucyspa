# Deploying Session 10 (the quality pass on customer, POS and admin screens + customer account deletion) to production

For the Owner. Paste each numbered block into the iNET web terminal (logged in to the server) **one at a time**, in order, and wait for the last line before the next. Every block is wrapped in `( ... )`: copy from the `(` on the first line to the `)` on the last line. Every block checks itself and **stops with a `STOP:` line** when anything differs from what is expected. When you see `STOP:`: do **not** rerun, take a screenshot from the `STOP:` line upwards, and send it to Claude. Claude never touches the server; only the Owner runs commands.

**Code to install:** commit `9c9c7988809c5ef538dd47051acac48fd7c2813a` (full 40 characters, already filled into every block that needs it). Docs-only commits pushed after it do not change running code. GitHub Actions was green on this commit.
**Code running now (Owner report, group 1 deploy of 2026-10-15):** `8afcb6f864af80ea28498e41f6c3f99ea5548565`, **138 migrations, 82 permissions**, 8 published policy pages (`8|1|1|6|0`), users/invoices/payments 9/2/2 at that time. Block 1 stops unless the server is exactly in that state.
**Database:** 138 to **139** migrations, one migration, additive only (nothing is dropped or rewritten):

- `20261216000000_customer_account_deletion` (customer deletes their own account): `users.deleted_at`; a third legal shape of a customer row (inactive, deleted, no email, phone or password, the placeholder name "Tài khoản đã xóa") that the database keeps deleted for good (new trigger `users_deletion_guard`); date of birth and address may be empty **only** for a deleted customer; recipient name and phone of an unpaid, cancelled online order may be cleared once, only when the customer is deleted (paid orders keep them); new table `account_deletion_emails` for the sealed confirmation email. It also replaces the check constraints on `users`, `product_orders` and `online_order_details`, adds one on `customer_profiles` (plus a guard trigger), and replaces two existing guard functions (`lucy_guard_product_order`, `lucy_guard_online_order_details`); the database re-checks every existing row once (block 3 proves they pass on a copy of your data). **No existing row is changed.**

**Permissions:** unchanged, still 82. **`.env`:** nothing to change (the deletion confirmation email uses the same `AUTH_DELIVERY_KEYS` and SMTP settings as the sign-in codes; block 1 checks the key is there). No new library, no new pm2 process, no nginx change. The 8 policy pages are already live; there is **no policy import** in this guide.
**What changes for people:** the POS and admin screens (and the customer pages) take the fixes of the session 10 quality pass; features, prices, orders, points and permissions are unchanged. New for customers: **Profile, Delete account** (password confirmation, upcoming bookings cancelled, points lost, invoices and payments kept without the person's name).
**Time:** about 25 to 35 minutes (the web build is the longest). Between block 4 and block 5 the API and worker are **stopped for 1 to 2 minutes**: POS is briefly unavailable, so tell the cashier first. Customer pages may show a short error while web reloads.

## Before you paste

- GitHub Actions shows a **green** run for commit `9c9c7988809c5ef538dd47051acac48fd7c2813a`. Red or still running: do not start.
- Tell the cashier POS pauses for about 5 minutes (blocks 4 and 5).
- Not yet approved by you, still shipped as built: the new Vietnamese texts (`docs/redesign-s10/copy-review.md`) and the account-deletion rules (`docs/redesign-s10/a2/account-deletion.md`, section "Readings pending Owner"). The privacy policy text for deletion (`docs/redesign-s10/privacy-deletion-draft.md`) is **not** published by this deploy.

## Block 1: checks, state and backups (read-only except the backup files)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=9c9c7988809c5ef538dd47051acac48fd7c2813a
OLD=8afcb6f864af80ea28498e41f6c3f99ea5548565
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
case "$NEW" in __*) dung "the NEW= line still holds the placeholder; ask Claude for the filled block";; esac
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
A2COLS="select (select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name='deleted_at')||'|'||(select count(*) from information_schema.tables where table_schema='public' and table_name='account_deletion_emails')"
echo "=== 1a. Preconditions ==="
expect "running code (exactly the group 1 commit)" "$(git rev-parse HEAD)" "$OLD"
expect "migrations and permissions before" "$(sqlq $DB "$COUNTS")" "138|82"
expect "8 published policy pages" "$(sqlq $DB "select count(*) from website_pages where is_published")" "8"
expect "server working tree clean" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
expect "account deletion not there yet (users.deleted_at | account_deletion_emails)" "$(sqlq $DB "$A2COLS")" "0|0"
expect "email key ring present in .env (count only, nothing printed)" "$(grep -c '^AUTH_DELIVERY_KEYS=' .env)" "1"
expect "email active key version present in .env" "$(grep -c '^AUTH_DELIVERY_ACTIVE_VERSION=' .env)" "1"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 3 ] || dung "disk has $FREE GB free, need at least 3 GB"
echo "OK  free disk: $FREE GB"
echo "=== 1b. Backups ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-pre-s10-$STAMP.pm2 || dung "could not back up the pm2 list"
BACKUP=/root/backups/lucyspa-pre-s10-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump failed"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "the database backup is too small"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp failed"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "the backup lists only $LISTED entries"
echo "OK  database backup: $BACKUP ($LISTED entries)"
WEBBACKUP=/root/backups/lucyspa-web-pre-s10-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "could not pack the web backup"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "the web backup is too small"
[ "$(tar -tzf "$WEBBACKUP" | wc -l)" -gt 500 ] || dung "the web backup has unusually few files"
echo "OK  web backup: $WEBBACKUP"
echo "=== 1c. Record the numbers that must not change ==="
{
  echo "STAMP=$STAMP"
  echo "BACKUP=$BACKUP"
  echo "WEBBACKUP=$WEBBACKUP"
  echo "SERVICE_TEXTS_BEFORE='$(sqlq $DB "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services")'"
  echo "TEXTS_BEFORE='$(sqlq $DB "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products")'"
  echo "SERVICES_BEFORE=$(sqlq $DB "select count(*) from services")"
  echo "PRODUCTS_BEFORE=$(sqlq $DB "select count(*) from products")"
  echo "PAGES_BEFORE=$(sqlq $DB "select count(*) from website_pages")"
  echo "USERS_BEFORE=$(sqlq $DB "select count(*) from users")"
  echo "CUSTOMERS_BEFORE=$(sqlq $DB "select count(*) from users where kind::text='CUSTOMER'")"
  echo "PROFILES_BEFORE=$(sqlq $DB "select count(*) from customer_profiles")"
  echo "ORDERS_BEFORE=$(sqlq $DB "select count(*) from product_orders")"
  echo "INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")"
  echo "PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")"
  echo "FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")"
  echo "ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")"
} > /root/backups/s10-state.env
chmod 600 /root/backups/s10-state.env
. /root/backups/s10-state.env
echo "Recorded: users=$USERS_BEFORE (customers=$CUSTOMERS_BEFORE, profiles=$PROFILES_BEFORE) invoices=$INVOICES_BEFORE payments=$PAYMENTS_BEFORE orders=$ORDERS_BEFORE services=$SERVICES_BEFORE products=$PRODUCTS_BEFORE pages=$PAGES_BEFORE online sales on=$ONLINE_BEFORE"
echo "=== BLOCK 1 DONE: no STOP. Next: block 2 ==="
)
```

**Expect:** a list of `OK` lines (running code `8afcb6f...`, `138|82`, `8`, `0`, `1`, `1`, `0|0`, the two `.env` counts `1`, free disk, the two backup paths), one `Recorded:` line (users/invoices/payments were 9/2/2 at the group 1 deploy; they may be higher now), and `=== BLOCK 1 DONE`. About 1 to 3 minutes. **If different:** any `STOP:` means the server is not in the state this guide was written for (another commit running, a different migration count, a change in the working tree, a pm2 process down, a missing email key, disk low): send the screenshot, do nothing else. The backups made here stay on disk; they are harmless.

## Block 2: fetch the code, install, build (nothing is restarted; the database is not touched)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=9c9c7988809c5ef538dd47051acac48fd7c2813a
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun unless the text below says you may."; exit 1; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
case "$NEW" in __*) dung "the NEW= line still holds the placeholder";; esac
test -f /root/backups/s10-state.env || dung "block 1 has not been run (no state file)"
git fetch origin || dung "git fetch failed"
git checkout "$NEW" || dung "git checkout failed"
expect "new code" "$(git rev-parse HEAD)" "$NEW"
pnpm install --frozen-lockfile || dung "pnpm install failed (the running software was not touched)"
pnpm db:generate || dung "db:generate failed"
pnpm build || dung "pnpm build failed. If the error mentions downloading fonts (it happened once on 2026-10-14), it is the network: you may rerun THIS block once. Any other error: do not rerun, send it. The site may need block R2."
expect "account deletion built in the API" "$(test -f apps/api/dist/account/account-deletion.service.js && echo yes)" "yes"
expect "account deletion email built in the worker" "$(test -f apps/worker/dist/account-deletion-email.js && echo yes)" "yes"
expect "account deletion migration present" "$(test -d packages/database/prisma/migrations/20261216000000_customer_account_deletion && echo yes)" "yes"
expect "139 migration folders" "$(ls -d packages/database/prisma/migrations/2* | wc -l | tr -d ' ')" "139"
echo "=== BLOCK 2 DONE: no STOP. Next: block 3 ==="
)
```

**Expect:** `OK` lines, long install and build output above them, `=== BLOCK 2 DONE`. About 10 to 15 minutes. The old site keeps running while it builds; customer pages may show an error for a minute or two near the end, when the new build replaces the old files. **If different:** the `pnpm build` STOP line says whether you may rerun (font download only, once). If the site shows errors and the block stopped, run **block R2** (puts the previous build back) and send me the screenshot. `pnpm install` failing leaves the site untouched.

## Block 3: rehearsal on a throwaway copy of the real database (touches only a scratch database)

Recommended: it proves the migration, above all its constraint changes, which make the database re-check every existing row, on a restored copy of your real data before the real database is touched. It takes about 5 minutes and deletes its scratch database at the end.

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
test -f /root/backups/s10-state.env || dung "block 1 has not been run"
. /root/backups/s10-state.env
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
A2OBJ="select (select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name='deleted_at')||'|'||(select count(*) from information_schema.tables where table_schema='public' and table_name='account_deletion_emails')||'|'||(select count(*) from pg_trigger where tgname='users_deletion_guard' and not tgisinternal)||'|'||(select count(*) from pg_proc where proname='lucy_guard_user_deletion')"
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "could not create the scratch database"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore into the scratch database failed"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "the helper refused the scratch database name"
expect "pointing at the scratch database" "${DATABASE_URL##*/}" "$SCRATCH"
expect "copy: restored at 138|82" "$(sqlq $SCRATCH "$COUNTS")" "138|82"
pnpm db:deploy || dung "db:deploy on the scratch copy failed"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "0 inserted, 82 already present" || dung "permission catalogue on the copy is not '0 inserted, 82 already present'"
unset DATABASE_URL
expect "no DATABASE_URL left in the environment" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "copy: migrations and permissions" "$(sqlq $SCRATCH "$COUNTS")" "139|82"
expect "copy: account deletion objects (column | table | trigger | function)" "$(sqlq $SCRATCH "$A2OBJ")" "1|1|1|1"
expect "copy: no deleted account" "$(sqlq $SCRATCH "select count(*) from users where deleted_at is not null")" "0"
expect "copy: no deletion email row" "$(sqlq $SCRATCH "select count(*) from account_deletion_emails")" "0"
expect "copy: policy pages unchanged" "$(sqlq $SCRATCH "select count(*) from website_pages")" "$PAGES_BEFORE"
expect "copy: service texts unchanged" "$(sqlq $SCRATCH "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services")" "$SERVICE_TEXTS_BEFORE"
expect "copy: product texts unchanged" "$(sqlq $SCRATCH "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products")" "$TEXTS_BEFORE"
expect "copy: users unchanged" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "copy: customer profiles unchanged" "$(sqlq $SCRATCH "select count(*) from customer_profiles")" "$PROFILES_BEFORE"
expect "copy: product orders unchanged" "$(sqlq $SCRATCH "select count(*) from product_orders")" "$ORDERS_BEFORE"
expect "copy: invoices unchanged" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "copy: payments unchanged" "$(sqlq $SCRATCH "select count(*) from payments")" "$PAYMENTS_BEFORE"
echo "Time of the migration on the copy (send to Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' s' from _prisma_migrations where migration_name >= '20261216' order by migration_name"
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "could not drop the scratch database"
expect "scratch database dropped" "$(sqlq $DB "select count(*) from pg_database where datname = '$SCRATCH'")" "0"
echo "=== BLOCK 3 DONE: no STOP. The real database was not touched. Next: block 4 ==="
)
```

**Expect:** `OK` lines, 1 migration timing line (well under a second or a few seconds), `=== BLOCK 3 DONE`. About 3 to 5 minutes. **If different:** `STOP:` here is the cheapest place to fail: the real database and the running site are untouched. Send the screenshot. If it stopped before the last `dropdb`, the scratch database `lucy_spa_rehearsal_scratch` stays; harmless, Claude will tell you how to drop it.

## Block 4: stop API and worker, migrate the real database (138 to 139)

Tell the cashier now: POS pauses until block 5 ends (1 to 2 minutes).

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=9c9c7988809c5ef538dd47051acac48fd7c2813a
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
test -f /root/backups/s10-state.env || dung "block 1 has not been run"
. /root/backups/s10-state.env
expect "code on disk is the new commit" "$(git rev-parse HEAD)" "$NEW"
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
A2OBJ="select (select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name='deleted_at')||'|'||(select count(*) from information_schema.tables where table_schema='public' and table_name='account_deletion_emails')||'|'||(select count(*) from pg_trigger where tgname='users_deletion_guard' and not tgisinternal)||'|'||(select count(*) from pg_proc where proname='lucy_guard_user_deletion')"
expect "real database still at 138|82" "$(sqlq $DB "$COUNTS")" "138|82"
pm2 stop lucyspa-api lucyspa-worker >/dev/null 2>&1
sleep 3
expect "api stopped" "$(count_online lucyspa-api)" "0"
expect "worker stopped" "$(count_online lucyspa-worker)" "0"
expect "no DATABASE_URL in the environment" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
pnpm db:deploy || dung "db:deploy on the real database failed: do NOT rerun; API and worker are stopped; ask Claude"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "0 inserted, 82 already present" || dung "permission catalogue is not '0 inserted, 82 already present'"
expect "migrations and permissions after" "$(sqlq $DB "$COUNTS")" "139|82"
expect "account deletion objects (column | table | trigger | function)" "$(sqlq $DB "$A2OBJ")" "1|1|1|1"
expect "no deleted account" "$(sqlq $DB "select count(*) from users where deleted_at is not null")" "0"
expect "no deletion email row" "$(sqlq $DB "select count(*) from account_deletion_emails")" "0"
expect "policy pages unchanged" "$(sqlq $DB "select count(*) from website_pages")" "$PAGES_BEFORE"
expect "service texts unchanged" "$(sqlq $DB "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services")" "$SERVICE_TEXTS_BEFORE"
expect "product texts unchanged" "$(sqlq $DB "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products")" "$TEXTS_BEFORE"
expect "services count unchanged" "$(sqlq $DB "select count(*) from services")" "$SERVICES_BEFORE"
expect "products count unchanged" "$(sqlq $DB "select count(*) from products")" "$PRODUCTS_BEFORE"
expect "users unchanged" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "customers unchanged" "$(sqlq $DB "select count(*) from users where kind::text='CUSTOMER'")" "$CUSTOMERS_BEFORE"
expect "customer profiles unchanged" "$(sqlq $DB "select count(*) from customer_profiles")" "$PROFILES_BEFORE"
expect "product orders unchanged" "$(sqlq $DB "select count(*) from product_orders")" "$ORDERS_BEFORE"
expect "invoices unchanged" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "payments unchanged" "$(sqlq $DB "select count(*) from payments")" "$PAYMENTS_BEFORE"
expect "fund entries unchanged" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
expect "online sales switch unchanged" "$(sqlq $DB "select enabled from online_sales_settings")" "$ONLINE_BEFORE"
echo "=== BLOCK 4 DONE: database is at 139. API and worker are STOPPED. Run block 5 now ==="
)
```

**Expect:** `db:deploy` output ("1 migration found / applied" in Prisma's wording), a permissions line `0 inserted, 82 already present`, `OK` lines (`139|82`, `1|1|1|1`, `0`, `0`, unchanged counts), `=== BLOCK 4 DONE`. About 1 to 2 minutes. **If different:** `STOP:` before `db:deploy` means nothing changed, but API and worker are stopped: run **block R1** at once to bring the old code back up (or ask me). `STOP:` at `db:deploy` itself: do not rerun anything except R1 if I say so; the migration was rehearsed on a copy in block 3 and runs in one transaction, so a failure leaves the database at 138. A failed `OK` line after the migration (a count that moved) is serious: send the screenshot before block 5.

## Block 5: restart API, worker and web, and check the site

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=9c9c7988809c5ef538dd47051acac48fd7c2813a
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
expect "code on disk is the new commit" "$(git rev-parse HEAD)" "$NEW"
expect "database at 139|82" "$(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)")" "139|82"
pm2 restart lucyspa-api lucyspa-worker --update-env >/dev/null 2>&1
sleep 10
pm2 reload lucyspa-web --update-env >/dev/null 2>&1
sleep 20
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online (exactly 1)" "$(count_online lucyspa-worker)" "1"
echo "--- last 15 error lines of API and worker (no new lines after the restart time) ---"
pm2 logs lucyspa-api --err --lines 15 --nostream 2>&1 | tail -n 15
pm2 logs lucyspa-worker --err --lines 15 --nostream 2>&1 | tail -n 15
echo "=== Checks that create or change no data ==="
expect "health" "$(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')" "1"
expect "page /vi (no trailing slash)" "$(http http://127.0.0.1:3000/vi)" "200"
for PAGE in services products contact account/login account/register account/deleted dieu-khoan-su-dung chinh-sach-bao-mat; do
  expect "page /vi/$PAGE" "$(http http://127.0.0.1:3000/vi/$PAGE)" "200"
done
expect "page /en" "$(http http://127.0.0.1:3000/en)" "200"
expect "staff login" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for PAGE in website products services; do
  R=$(http http://127.0.0.1:3000/vi/workforce/$PAGE)
  case "$R" in 200|307) echo "OK  screen $PAGE: $R";; *) dung "screen $PAGE answered $R (expected 200 or 307)";; esac
done
R=$(http http://127.0.0.1:3000/vi/account/profile/delete)
case "$R" in 200|307|308) echo "OK  delete-account page without login: $R (sends you to sign in)";; *) dung "delete-account page answered $R (expected 200, 307 or 308)";; esac
expect "public pages API: 8 pages" "$(curl -s http://127.0.0.1:3001/api/v1/public/pages | grep -o '"slug"' | wc -l | tr -d ' ')" "8"
for PATH_ in website/pages me/profile; do
  expect "API $PATH_ without login" "$(http "http://127.0.0.1:3001/api/v1/$PATH_")" "401"
done
expect "write needs login and CSRF" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3001/api/v1/website/pages)" "403"
echo "=== BLOCK 5 DONE: site is up on the new code. Next: block 6 ==="
pm2 status
)
```

**Expect:** `OK` lines for the three processes, health `1`, every page `200`, staff screens `200` or `307`, then `=== BLOCK 5 DONE` and the pm2 table (web several `online`, api and worker `online`). About 1 to 2 minutes. The pm2 error log lines printed in the middle are the **old** history; only lines timestamped after the restart matter. **If different:** a page that is not 200 right after the restart can be web still warming up: wait 30 seconds and rerun **only this block** (it changes nothing). Still wrong, or an API process `errored`: send the screenshot; if the site is down, run block R1.

## Block 6: final numbers and the log (read-only; send the output to Claude Code)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
. /root/backups/s10-state.env
echo "running code:      $(git rev-parse HEAD)"
echo "migrations|perms:  $(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)") (expected 139|82)"
echo "published pages:   $(sqlq $DB "select count(*)||'|'||count(*) filter (where role::text='TERMS')||'|'||count(*) filter (where role::text='PRIVACY')||'|'||count(*) filter (where role::text='POLICY')||'|'||count(*) filter (where title_en is not null or body_en is not null) from website_pages where is_published") (expected 8|1|1|6|0)"
echo "deleted accounts:  $(sqlq $DB "select count(*) from users where deleted_at is not null") (expected 0 unless a customer deleted theirs since)"
echo "users/invoices/payments now vs before: $(sqlq $DB "select count(*) from users")/$(sqlq $DB "select count(*) from invoices")/$(sqlq $DB "select count(*) from payments") vs $USERS_BEFORE/$INVOICES_BEFORE/$PAYMENTS_BEFORE"
echo "home /vi: $(http http://127.0.0.1:3000/vi)  /vi/contact: $(http http://127.0.0.1:3000/vi/contact)  /vi/services: $(http http://127.0.0.1:3000/vi/services)  /vi/products: $(http http://127.0.0.1:3000/vi/products)"
echo "database backup:   $BACKUP"
echo "web backup:        $WEBBACKUP"
pm2 status
echo "--- last 10 error lines of API, worker, web (only lines after the restart matter) ---"
pm2 logs lucyspa-api --err --lines 10 --nostream 2>&1 | tail -n 10
pm2 logs lucyspa-worker --err --lines 10 --nostream 2>&1 | tail -n 10
pm2 logs lucyspa-web --err --lines 10 --nostream 2>&1 | tail -n 10
echo "=== BLOCK 6 DONE ==="
echo ">>> Now paste this whole output to Claude Code and tell it: record the deployed commit and the migration state in LUCYSPA_HANDOFF.md."
)
```

**Expect:** the code hash `9c9c798...`, `139|82`, `8|1|1|6|0`, deleted accounts `0`, user, invoice and payment counts equal to the "before" counts (invoices and payments may be higher only if the cashier worked during the deploy), pages `200`, the backup paths, pm2 with everything `online`, and no new error lines. Send Claude Code this whole output: it is what gets recorded in `LUCYSPA_HANDOFF.md` as the production report.

## After the blocks (you, in a browser)

1. Customer pages on phone and desktop: home, Services, a service, Products, a product, cart, booking, sign in, account. Check light and dark (the page follows the device setting; there is no theme button any more). Motion is soft; with "reduce motion" on the device the pages stay still.
2. **Delete account: look, do not delete a real customer.** Sign in as a test customer, Profile, "Xóa tài khoản": the page shows what is deleted, what is kept and what is lost; the delete button needs the password. Only press the final button with a throwaway account you created for this (it erases that account for good and sends a confirmation email to its address).
3. POS and admin: open the counter, a walk-in, the cash book, the dashboard and one list (for example Inventory) on a phone-sized window and on a desktop; tell Claude about anything cramped, cut off or in the wrong place.

## What staff see (POS and admin)

The session 10 pass changed the look and behaviour details of **every** POS and admin screen (spacing, tables that keep names readable, 200 % text, tab bars, dialogs) without changing business rules, prices, permissions or data.

## Rollback blocks

The migration only **adds** (a column, a table, a trigger, widened checks and two replaced guard functions), so **no database rollback is needed**: the previous code (`8afcb6f`) ignores the new column and table, does not use the new customer paths, and the permission count is unchanged (82). Rolling back therefore means putting the previous code back. A database restore from the backup is **not** part of these blocks: it would erase everything entered after the backup (orders, bookings, payments), so it is only done on Claude's instruction.

One caution for R1/R2: if a customer **deleted their account** after this deploy, that account row is erased in place (no email, no phone, no date of birth). The previous code has never seen such a row, so a staff screen of the old code that lists that customer may show an error. If you have to roll back and some account was deleted since, tell Claude first (block 6 shows the count of deleted accounts).

### Block R1: put the previous code back (API, worker and web)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
OLD=8afcb6f864af80ea28498e41f6c3f99ea5548565
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "STOP: the rebuild failed; send a screenshot (then block R2 may bring the old build back)"; exit 1; }
[ "$(git rev-parse HEAD)" = "$OLD" ] || { echo "STOP: not on the previous code"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
echo "home: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/vi)  health: $(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')"
)
```

**Expect:** the rebuild output, the pm2 table with `lucyspa-api`, `lucyspa-worker`, `lucyspa-web` all `online`, then `home: 200  health: 1`. About 10 to 15 minutes. The site returns to the group 1 code. **If different:** a `STOP:` line or a red process: send the screenshot; do not try anything else.

### Block R2: only the web files are broken, put the previous build back from the backup (no rebuild, about 2 minutes)

Use when a `pnpm build` died halfway and the site shows errors, or a restart leaves web `errored`. It restores the build files saved in block 1 (the previous code's `.next`, `dist` folders) and restarts.

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
test -f /root/backups/s10-state.env || { echo "STOP: no state file (block 1 never ran)"; exit 1; }
. /root/backups/s10-state.env
[ -s "$WEBBACKUP" ] || { echo "STOP: backup file $WEBBACKUP is missing"; exit 1; }
tar -xzf "$WEBBACKUP" -C /opt/lucyspa || { echo "STOP: could not unpack the backup"; exit 1; }
git checkout 8afcb6f864af80ea28498e41f6c3f99ea5548565 || { echo "STOP: git checkout failed"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
echo "home: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/vi)  health: $(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')"
)
```

**Expect:** pm2 table all `online`, `home: 200  health: 1`. **If different:** send the screenshot. (If the database is already at 139 this is fine: the previous code runs on it, see above.)
