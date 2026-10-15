# Deploying group 1 of the redesign (customer site in the DESIGN.md look, information and policy pages, customer profile, brand band) to production

For the Owner. Paste each numbered block into the iNET web terminal (logged in to the server) **one at a time**, in order, and wait for the last line before the next. Every block is wrapped in `( ... )`: copy from the `(` on the first line to the `)` on the last line. Every block checks itself and **stops with a `STOP:` line** when anything differs from what is expected. When you see `STOP:`: do **not** rerun, take a screenshot from the `STOP:` line upwards, and send it to Claude. Claude never touches the server; only the Owner runs commands.

**Code to install:** commit `8afcb6f864af80ea28498e41f6c3f99ea5548565` (full 40 characters, already filled into every block that needs it). Docs-only commits pushed after it do not change running code.
**Code running now (Owner report 2026-10-14):** `4f2ced4bab798ca52138f3bf527cab4b61d67730` (code of `04ceaa5` plus the favicon), **134 migrations, 82 permissions**.
**Database:** 134 to **138** migrations, additive only:

1. `20261214000000_redesign_service_content_photos`: 7 new nullable columns on `services` (what is included, steps, FAQ, each in two languages, and a photo), 1 photo column on `service_categories` and 1 on `product_categories` (keys into the media library, a photo in use cannot be deleted), 3 indexes. No existing row changes.
2. `20261215000000_customer_email_change_guard`: replaces **one function** (`lucy_guard_auth_challenge`) so a customer can also change the sign-in email (current password, then a code sent to the new email). No table or row changes.
3. `20261215000001_website_info_pages`: new empty table `website_pages`, a new enum `WebsitePageRole`, and a database rule: at most one published "Terms" and one published "Privacy" page.
4. `20261215000002_brand_logo_home_band`: 3 new columns on `brands` (`logo_media_id`, `show_on_home` default **false**, `home_sort_order` default 0). The brand band under the home hero stays **hidden** until you upload a logo and switch it on for at least one brand.

**Permissions:** unchanged, still 82. **`.env`:** nothing to change. New library `gsap 3.15.0` (installed by `pnpm install --frozen-lockfile`). No new pm2 process, no nginx change.
**What changes for people:** every customer page takes the new look; features, prices, orders and points are unchanged. Staff and POS screens keep their look; they only gain the admin items listed in "What staff see" below.
**Time:** about 30 to 40 minutes (the web build is the longest). Between block 4 and block 5 the API and worker are **stopped for 1 to 2 minutes**: POS is briefly unavailable, so tell the cashier first. Customer pages may show a short error while web reloads.

## Before you paste

- GitHub Actions shows a **green** run for commit `8afcb6f864af80ea28498e41f6c3f99ea5548565`. Red or still running: do not start.
- Tell the cashier POS pauses for about 5 minutes (blocks 4 and 5).
- While the blocks run, **do not press Save or Publish** in the admin Website pages.

## Block 1: checks, state and backups (read-only except the backup files)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=8afcb6f864af80ea28498e41f6c3f99ea5548565
OLD=4f2ced4bab798ca52138f3bf527cab4b61d67730
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
case "$NEW" in __*) dung "the NEW= line still holds the placeholder; ask Claude for the filled block";; esac
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
COLS="select count(*) from information_schema.columns where table_schema='public' and ((table_name='services' and column_name in ('included_vi','included_en','steps_vi','steps_en','faq_vi','faq_en','photo_media_id')) or (table_name in ('service_categories','product_categories') and column_name='photo_media_id') or (table_name='brands' and column_name in ('logo_media_id','show_on_home','home_sort_order')))"
echo "=== 1a. Preconditions ==="
expect "migrations and permissions before" "$(sqlq $DB "$COUNTS")" "134|82"
expect "running code" "$(git rev-parse HEAD)" "$OLD"
expect "server working tree clean" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
expect "new columns not there yet" "$(sqlq $DB "$COLS")" "0"
expect "no website_pages table yet" "$(sqlq $DB "select count(*) from information_schema.tables where table_schema='public' and table_name='website_pages'")" "0"
expect "guard function not changed yet" "$(sqlq $DB "select coalesce((select (prosrc like '%since session 7b%')::text from pg_proc where proname='lucy_guard_auth_challenge'), 'no function')")" "false"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 3 ] || dung "disk has $FREE GB free, need at least 3 GB"
echo "OK  free disk: $FREE GB"
echo "=== 1b. Backups ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-pre-group1-$STAMP.pm2 || dung "could not back up the pm2 list"
BACKUP=/root/backups/lucyspa-pre-group1-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump failed"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "the database backup is too small"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp failed"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "the backup lists only $LISTED entries"
echo "OK  database backup: $BACKUP ($LISTED entries)"
WEBBACKUP=/root/backups/lucyspa-web-pre-group1-$STAMP.tar.gz
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
  echo "BRANDS_BEFORE=$(sqlq $DB "select count(*) from brands")"
  echo "USERS_BEFORE=$(sqlq $DB "select count(*) from users")"
  echo "CUSTOMERS_BEFORE=$(sqlq $DB "select count(*) from users where kind::text='CUSTOMER'")"
  echo "INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")"
  echo "PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")"
  echo "FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")"
  echo "ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")"
} > /root/backups/group1-state.env
chmod 600 /root/backups/group1-state.env
. /root/backups/group1-state.env
echo "Recorded: users=$USERS_BEFORE (customers=$CUSTOMERS_BEFORE) invoices=$INVOICES_BEFORE payments=$PAYMENTS_BEFORE services=$SERVICES_BEFORE products=$PRODUCTS_BEFORE brands=$BRANDS_BEFORE online sales on=$ONLINE_BEFORE"
echo "=== BLOCK 1 DONE: no STOP. Next: block 2 ==="
)
```

**Expect:** a list of `OK` lines (`134|82`, running code `4f2ced4...`, `0`, `1`, `1`, `false`, free disk, the two backup paths), one `Recorded:` line, and `=== BLOCK 1 DONE`. About 1 to 3 minutes. **If different:** any `STOP:` means the server is not in the state this guide was written for (another commit running, a change in the working tree, a pm2 process down, disk low): send the screenshot, do nothing else. The backups made here stay on disk; they are harmless.

## Block 2: fetch the code, install, build (nothing is restarted; the database is not touched)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=8afcb6f864af80ea28498e41f6c3f99ea5548565
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun unless the text below says you may."; exit 1; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
case "$NEW" in __*) dung "the NEW= line still holds the placeholder";; esac
test -f /root/backups/group1-state.env || dung "block 1 has not been run (no state file)"
git fetch origin || dung "git fetch failed"
git checkout "$NEW" || dung "git checkout failed"
expect "new code" "$(git rev-parse HEAD)" "$NEW"
pnpm install --frozen-lockfile || dung "pnpm install failed (the running software was not touched)"
pnpm db:generate || dung "db:generate failed"
pnpm build || dung "pnpm build failed. If the error mentions downloading fonts (it happened once on 2026-10-14), it is the network: you may rerun THIS block once. Any other error: do not rerun, send it. The site may need block R2."
expect "policy text file present" "$(test -f docs/policies.md && echo yes)" "yes"
expect "policy import command built" "$(test -f apps/api/dist/website/policy-pages.cli.js && echo yes)" "yes"
expect "policy import script in package.json" "$(grep -c 'pages:import-policies' apps/api/package.json)" "1"
expect "brand band migration present" "$(test -d packages/database/prisma/migrations/20261215000002_brand_logo_home_band && echo yes)" "yes"
expect "gsap 3.15.0 installed" "$(ls node_modules/.pnpm | grep -c '^gsap@3.15.0')" "1"
expect "138 migration folders" "$(ls -d packages/database/prisma/migrations/2* | wc -l | tr -d ' ')" "138"
echo "=== BLOCK 2 DONE: no STOP. Next: block 3 ==="
)
```

**Expect:** `OK` lines, long install and build output above them, `=== BLOCK 2 DONE`. About 10 to 15 minutes. The old site keeps running while it builds; customer pages may show an error for a minute or two near the end, when the new build replaces the old files. **If different:** the `pnpm build` STOP line says whether you may rerun (font download only, once). If the site shows errors and the block stopped, run **block R2** (puts the previous build back) and send me the screenshot. `pnpm install` failing leaves the site untouched.

## Block 3: rehearsal on a throwaway copy of the real database (touches only a scratch database)

Recommended: it proves the four migrations and the policy import on a restored copy of your real data before the real database is touched. It takes about 5 minutes and deletes its scratch database at the end.

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
field() { printf '%s\n' "$1" | sed -n "s/.*$2=\([0-9]*\).*/\1/p" | tail -n 1; }
summary() { printf '%s\n' "$1" | grep '^created=' | tail -n 1; }
test -f /root/backups/group1-state.env || dung "block 1 has not been run"
. /root/backups/group1-state.env
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
COLS="select count(*) from information_schema.columns where table_schema='public' and ((table_name='services' and column_name in ('included_vi','included_en','steps_vi','steps_en','faq_vi','faq_en','photo_media_id')) or (table_name in ('service_categories','product_categories') and column_name='photo_media_id') or (table_name='brands' and column_name in ('logo_media_id','show_on_home','home_sort_order')))"
PUBLISHED="select count(*)||'|'||count(*) filter (where role::text='TERMS')||'|'||count(*) filter (where role::text='PRIVACY')||'|'||count(*) filter (where role::text='POLICY')||'|'||count(*) filter (where title_en is not null or body_en is not null) from website_pages where is_published"
SLUGS_WANT="chinh-sach-bao-mat,chinh-sach-dat-lich,chinh-sach-doi-tra-hoan-tien,chinh-sach-giao-hang,chinh-sach-thanh-toan,chinh-sach-thanh-vien-diem-thuong,dieu-khoan-su-dung,tiep-nhan-khieu-nai"
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "could not create the scratch database"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore into the scratch database failed"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "the helper refused the scratch database name"
expect "pointing at the scratch database" "${DATABASE_URL##*/}" "$SCRATCH"
pnpm db:deploy || dung "db:deploy on the scratch copy failed"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "0 inserted, 82 already present" || dung "permission catalogue on the copy is not '0 inserted, 82 already present'"
DRY=$(pnpm --filter @lucy-spa/api run pages:import-policies 2>&1) || { echo "$DRY" | tail -n 20; dung "policy import dry run on the copy failed"; }
echo "$DRY" | grep -q "database=$SCRATCH " || dung "the import command does not point at the scratch database (see the database= line)"
expect "copy: dry run would create 8 pages" "$(field "$(summary "$DRY")" wouldCreate)" "8"
APPLY=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$APPLY" | tail -n 20; dung "policy import on the copy failed"; }
expect "copy: 8 pages created" "$(field "$(summary "$APPLY")" created)" "8"
AGAIN=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$AGAIN" | tail -n 20; dung "second import on the copy failed"; }
expect "copy: second run creates nothing, skips 8" "$(field "$(summary "$AGAIN")" exists)" "8"
unset DATABASE_URL
expect "no DATABASE_URL left in the environment" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "copy: migrations and permissions" "$(sqlq $SCRATCH "$COUNTS")" "138|82"
expect "copy: 12 new columns" "$(sqlq $SCRATCH "$COLS")" "12"
expect "copy: pages table exists" "$(sqlq $SCRATCH "select count(*) from information_schema.tables where table_schema='public' and table_name='website_pages'")" "1"
expect "copy: 4 page roles" "$(sqlq $SCRATCH "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'WebsitePageRole'")" "4"
expect "copy: one-terms-one-privacy rule" "$(sqlq $SCRATCH "select count(*) from pg_indexes where schemaname='public' and indexname='website_pages_published_legal_key'")" "1"
expect "copy: guard function replaced" "$(sqlq $SCRATCH "select coalesce((select (prosrc like '%since session 7b%')::text from pg_proc where proname='lucy_guard_auth_challenge'), 'no function')")" "true"
expect "copy: 8 published (1 terms, 1 privacy, 6 policy, none in English)" "$(sqlq $SCRATCH "$PUBLISHED")" "8|1|1|6|0"
expect "copy: exactly 8 addresses" "$(sqlq $SCRATCH "select string_agg(slug, ',' order by slug collate \"C\") from website_pages")" "$SLUGS_WANT"
expect "copy: no brand shown on home" "$(sqlq $SCRATCH "select count(*) from brands where show_on_home")" "0"
expect "copy: brand count unchanged" "$(sqlq $SCRATCH "select count(*) from brands")" "$BRANDS_BEFORE"
expect "copy: service texts unchanged" "$(sqlq $SCRATCH "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services")" "$SERVICE_TEXTS_BEFORE"
expect "copy: product texts unchanged" "$(sqlq $SCRATCH "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products")" "$TEXTS_BEFORE"
expect "copy: users unchanged" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "copy: invoices unchanged" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "copy: payments unchanged" "$(sqlq $SCRATCH "select count(*) from payments")" "$PAYMENTS_BEFORE"
echo "Time per migration on the copy (send to Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' s' from _prisma_migrations where migration_name >= '20261214' order by migration_name"
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "could not drop the scratch database"
expect "scratch database dropped" "$(sqlq $DB "select count(*) from pg_database where datname = '$SCRATCH'")" "0"
echo "=== BLOCK 3 DONE: no STOP. The real database was not touched. Next: block 4 ==="
)
```

**Expect:** `OK` lines, 4 migration timing lines (each well under a second or a few seconds), `=== BLOCK 3 DONE`. About 5 minutes. **If different:** `STOP:` here is the cheapest place to fail: the real database and the running site are untouched. Send the screenshot. If it stopped before the last `dropdb`, the scratch database `lucy_spa_rehearsal_scratch` stays; harmless, Claude will tell you how to drop it.

## Block 4: stop API and worker, migrate the real database (134 to 138)

Tell the cashier now: POS pauses until block 5 ends (1 to 2 minutes).

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=8afcb6f864af80ea28498e41f6c3f99ea5548565
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
test -f /root/backups/group1-state.env || dung "block 1 has not been run"
. /root/backups/group1-state.env
expect "code on disk is the new commit" "$(git rev-parse HEAD)" "$NEW"
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
COLS="select count(*) from information_schema.columns where table_schema='public' and ((table_name='services' and column_name in ('included_vi','included_en','steps_vi','steps_en','faq_vi','faq_en','photo_media_id')) or (table_name in ('service_categories','product_categories') and column_name='photo_media_id') or (table_name='brands' and column_name in ('logo_media_id','show_on_home','home_sort_order')))"
expect "real database still at 134|82" "$(sqlq $DB "$COUNTS")" "134|82"
pm2 stop lucyspa-api lucyspa-worker >/dev/null 2>&1
sleep 3
expect "api stopped" "$(count_online lucyspa-api)" "0"
expect "worker stopped" "$(count_online lucyspa-worker)" "0"
expect "no DATABASE_URL in the environment" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
pnpm db:deploy || dung "db:deploy on the real database failed: do NOT rerun; API and worker are stopped; ask Claude"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "0 inserted, 82 already present" || dung "permission catalogue is not '0 inserted, 82 already present'"
expect "migrations and permissions after" "$(sqlq $DB "$COUNTS")" "138|82"
expect "12 new columns" "$(sqlq $DB "$COLS")" "12"
expect "pages table empty" "$(sqlq $DB "select count(*) from website_pages")" "0"
expect "4 page roles" "$(sqlq $DB "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'WebsitePageRole'")" "4"
expect "one-terms-one-privacy rule" "$(sqlq $DB "select count(*) from pg_indexes where schemaname='public' and indexname='website_pages_published_legal_key'")" "1"
expect "guard function replaced" "$(sqlq $DB "select coalesce((select (prosrc like '%since session 7b%')::text from pg_proc where proname='lucy_guard_auth_challenge'), 'no function')")" "true"
expect "no brand shown on home" "$(sqlq $DB "select count(*) from brands where show_on_home")" "0"
expect "brand count unchanged" "$(sqlq $DB "select count(*) from brands")" "$BRANDS_BEFORE"
expect "service texts unchanged" "$(sqlq $DB "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services")" "$SERVICE_TEXTS_BEFORE"
expect "product texts unchanged" "$(sqlq $DB "select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products")" "$TEXTS_BEFORE"
expect "services count unchanged" "$(sqlq $DB "select count(*) from services")" "$SERVICES_BEFORE"
expect "products count unchanged" "$(sqlq $DB "select count(*) from products")" "$PRODUCTS_BEFORE"
expect "users unchanged" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "customers unchanged" "$(sqlq $DB "select count(*) from users where kind::text='CUSTOMER'")" "$CUSTOMERS_BEFORE"
expect "invoices unchanged" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "payments unchanged" "$(sqlq $DB "select count(*) from payments")" "$PAYMENTS_BEFORE"
expect "fund entries unchanged" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
expect "online sales switch unchanged" "$(sqlq $DB "select enabled from online_sales_settings")" "$ONLINE_BEFORE"
echo "=== BLOCK 4 DONE: database is at 138. API and worker are STOPPED. Run block 5 now ==="
)
```

**Expect:** `db:deploy` output ("4 migrations found / applied" in Prisma's wording), a permissions line `0 inserted, 82 already present`, `OK` lines (`138|82`, `12`, `0`, `4`, `1`, `true`, unchanged counts), `=== BLOCK 4 DONE`. About 1 to 2 minutes. **If different:** `STOP:` before `db:deploy` means nothing changed, but API and worker are stopped: run **block R1** at once to bring the old code back up (or ask me). `STOP:` at `db:deploy` itself: do not rerun anything except R1 if I say so; the migrations are additive and were rehearsed on a copy in block 3, and Prisma reports which one failed; the ones before it stay applied. A failed `OK` line after the migration (a count that moved) is serious: send the screenshot before block 5.

## Block 5: restart API, worker and web, and check the site

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
NEW=8afcb6f864af80ea28498e41f6c3f99ea5548565
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
expect "code on disk is the new commit" "$(git rev-parse HEAD)" "$NEW"
expect "database at 138|82" "$(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)")" "138|82"
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
for PAGE in "" services products contact account/login account/register; do
  expect "page /vi/$PAGE" "$(http http://127.0.0.1:3000/vi/$PAGE)" "200"
done
expect "page /en" "$(http http://127.0.0.1:3000/en)" "200"
expect "staff login" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for PAGE in website products services; do
  R=$(http http://127.0.0.1:3000/vi/workforce/$PAGE)
  case "$R" in 200|307) echo "OK  screen $PAGE: $R";; *) dung "screen $PAGE answered $R (expected 200 or 307)";; esac
done
expect "policy page does not exist yet (404 until block 7)" "$(http http://127.0.0.1:3000/vi/dieu-khoan-su-dung)" "404"
expect "public pages API: empty list" "$(curl -s http://127.0.0.1:3001/api/v1/public/pages | grep -c '"items":\[\]')" "1"
for PATH_ in website/pages me/profile; do
  expect "API $PATH_ without login" "$(http "http://127.0.0.1:3001/api/v1/$PATH_")" "401"
done
expect "write needs login and CSRF" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3001/api/v1/website/pages)" "403"
echo "=== BLOCK 5 DONE: site is up on the new code. Next: block 6 ==="
pm2 status
)
```

**Expect:** `OK` lines for the three processes, health `1`, every page `200`, staff screens `200` or `307`, then `=== BLOCK 5 DONE` and the pm2 table (web several `online`, api and worker `online`). About 1 to 2 minutes. The pm2 error log lines printed in the middle are the **old** history; only lines timestamped after the restart matter. **If different:** a page that is not 200 right after the restart can be web still warming up: wait 30 seconds and rerun **only this block** (it changes nothing). Still wrong, or an API process `errored`: send the screenshot; if the site is down, run block R1.

## Block 6: policy import, dry run (writes nothing)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
summary() { printf '%s\n' "$1" | grep '^created=' | tail -n 1; }
expect "no DATABASE_URL in the environment" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
DRY=$(pnpm --filter @lucy-spa/api run pages:import-policies 2>&1) || { echo "$DRY" | tail -n 20; dung "dry run failed"; }
echo "$DRY" | grep -v -i "deprecat\|trace-deprecation" | tail -n 11
echo "$DRY" | grep -q "database=$DB " || dung "the import does not point at the real database (see the database= line)"
expect "dry run: 8 pages would be created, none exist, none blocked" "$(summary "$DRY")" "created=0 wouldCreate=8 exists=0 blocked=0"
echo "=== BLOCK 6 DONE: nothing was written. Next: block 7 ==="
)
```

**Expect:** a table of the 8 pages (Terms, Payment, Delivery, Returns and refunds, Privacy, Booking, Membership and points, Complaints) marked "would create", the line `created=0 wouldCreate=8 exists=0 blocked=0`, and `=== BLOCK 6 DONE`. About 20 seconds. **If different:** any other numbers (for example `exists=` above 0 or `blocked=` above 0) mean pages already exist or something is in the way: do not run block 7, send me the screenshot.

## Block 7: policy import, apply, and check the 8 pages (writes the 8 pages, all in one transaction)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
dung() { echo; echo "STOP: $1"; echo "Screenshot from the STOP line upwards, send to Claude. Do NOT rerun."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: got '$2', expected '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: got '$2', expected $3 or more"; echo "OK  $1: $2 (>= $3)"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
summary() { printf '%s\n' "$1" | grep '^created=' | tail -n 1; }
SLUGS_WANT="chinh-sach-bao-mat,chinh-sach-dat-lich,chinh-sach-doi-tra-hoan-tien,chinh-sach-giao-hang,chinh-sach-thanh-toan,chinh-sach-thanh-vien-diem-thuong,dieu-khoan-su-dung,tiep-nhan-khieu-nai"
expect "no DATABASE_URL in the environment" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
APPLY=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$APPLY" | tail -n 20; dung "apply failed (no page is created: all 8 are one transaction)"; }
echo "$APPLY" | grep -v -i "deprecat\|trace-deprecation" | tail -n 11
echo "$APPLY" | grep -q "database=$DB " || dung "the import does not point at the real database"
expect "8 pages created" "$(summary "$APPLY")" "created=8 wouldCreate=0 exists=0 blocked=0"
expect "8 published (1 terms, 1 privacy, 6 policy, none in English)" "$(sqlq $DB "select count(*)||'|'||count(*) filter (where role::text='TERMS')||'|'||count(*) filter (where role::text='PRIVACY')||'|'||count(*) filter (where role::text='POLICY')||'|'||count(*) filter (where title_en is not null or body_en is not null) from website_pages where is_published")" "8|1|1|6|0"
expect "exactly the 8 addresses" "$(sqlq $DB "select string_agg(slug, ',' order by slug collate \"C\") from website_pages")" "$SLUGS_WANT"
expect "audit log: 8 page-created rows" "$(sqlq $DB "select count(*) from audit_events where action = 'PAGE_CREATED_PUBLISHED'")" "8"
AGAIN=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$AGAIN" | tail -n 20; dung "second run failed"; }
expect "second run does nothing: skips 8" "$(summary "$AGAIN")" "created=0 wouldCreate=0 exists=8 blocked=0"
echo "--- waiting up to 3 minutes for the API and web caches (1 to 2 minutes) ---"
LEFT=36
while [ "$LEFT" -gt 0 ]; do
  OK=0
  for SLUG in $(echo "$SLUGS_WANT" | tr ',' ' '); do
    [ "$(http http://127.0.0.1:3000/vi/$SLUG)" = "200" ] && OK=$((OK+1))
  done
  FOOT=$(curl -s http://127.0.0.1:3000/vi | grep -c 'href="/vi/chinh-sach-giao-hang"')
  [ "$OK" = "8" ] && [ "$FOOT" -ge 1 ] && break
  LEFT=$((LEFT-1)); sleep 5
done
expect "8 policy pages open (200)" "$OK" "8"
at_least "home footer links to the delivery policy" "$FOOT" 1
expect "English page shows the Vietnamese text (200)" "$(http http://127.0.0.1:3000/en/chinh-sach-giao-hang)" "200"
expect "public pages API: 8 pages" "$(curl -s http://127.0.0.1:3001/api/v1/public/pages | grep -o '"slug"' | wc -l | tr -d ' ')" "8"
echo "=== BLOCK 7 DONE: the 8 policy pages are live. Next: block 8 ==="
)
```

**Expect:** the import table, `created=8 wouldCreate=0 exists=0 blocked=0`, `OK` lines (`8|1|1|6|0`, the address list, `8`, then the second-run `exists=8`), the waiting line, then `8 policy pages open (200): 8` and `=== BLOCK 7 DONE`. About 1 to 3 minutes. **If different:** `apply failed` creates no page (single transaction): send me the screenshot, nothing to undo. If only the final page checks fail, the cache is still warming: wait one minute and run **block 8**; if still failing, send the screenshot. Do not run this block twice (the second run would only skip, but a `STOP` here should be looked at first).

## Block 8: final numbers and the log (read-only; send the output to Claude)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
DB=lucy_spa_dev
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
. /root/backups/group1-state.env
echo "running code:      $(git rev-parse HEAD)"
echo "migrations|perms:  $(sqlq $DB "select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)") (expected 138|82)"
echo "published pages:   $(sqlq $DB "select count(*)||'|'||count(*) filter (where role::text='TERMS')||'|'||count(*) filter (where role::text='PRIVACY')||'|'||count(*) filter (where role::text='POLICY')||'|'||count(*) filter (where title_en is not null or body_en is not null) from website_pages where is_published") (expected 8|1|1|6|0)"
echo "users/invoices/payments now vs before: $(sqlq $DB "select count(*) from users")/$(sqlq $DB "select count(*) from invoices")/$(sqlq $DB "select count(*) from payments") vs $USERS_BEFORE/$INVOICES_BEFORE/$PAYMENTS_BEFORE"
echo "home /vi: $(http http://127.0.0.1:3000/vi)  /vi/contact: $(http http://127.0.0.1:3000/vi/contact)  /vi/services: $(http http://127.0.0.1:3000/vi/services)  /vi/products: $(http http://127.0.0.1:3000/vi/products)"
echo "database backup:   $BACKUP"
echo "web backup:        $WEBBACKUP"
pm2 status
echo "--- last 10 error lines of API, worker, web (only lines after the restart matter) ---"
pm2 logs lucyspa-api --err --lines 10 --nostream 2>&1 | tail -n 10
pm2 logs lucyspa-worker --err --lines 10 --nostream 2>&1 | tail -n 10
pm2 logs lucyspa-web --err --lines 10 --nostream 2>&1 | tail -n 10
echo "=== BLOCK 8 DONE ==="
)
```

**Expect:** the code hash, `138|82`, `8|1|1|6|0`, user, invoice and payment counts equal to the "before" counts (invoices and payments may be higher only if the cashier worked during the deploy), pages `200`, three backup paths, pm2 with everything `online`, and no new error lines. Send Claude this whole output: it is what gets recorded in `LUCYSPA_HANDOFF.md` as the production report.

## After the blocks (you, in a browser)

1. Customer pages on phone and desktop: home, Services, a service, Products, a product, cart, booking, sign in, account. Switch to dark mode with the theme button in the header. Motion is soft; with "reduce motion" on the device the pages stay still.
2. Footer: the **Policies** column has 8 links; the bottom line has "Terms of use · Privacy policy". Open each page, including the tables on the returns-and-refunds and membership-and-points pages.
3. **Contact** (`/vi/contact`): map, opening hours (production hours are 09:00 to 21:00), "Call now", "Zalo", "Messenger". The round contact button stays fixed at the bottom right.
4. **Profile** (sign in as a customer, Profile): edit the name; try changing the email to one of yours (current password, then a code sent to the new email; the worker must be running).
5. **Admin, Website, Information pages:** the 8 published pages. **Admin, Website, Services:** open a service: the Photo section and the three boxes (what is included, steps, FAQ) are empty, and the customer page hides each empty part. **Admin, Products, Brands:** a brand now has Logo, Show on home and Order. The brand band under the home hero appears only after you upload a logo (transparent PNG or WebP; SVG is not accepted by the media library) and switch it on.
6. Photos to take for the shop (grey placeholders become real photos): see the photo list in `docs/CUSTOMER_SITE_C.md` and the photo slots in `docs/REDESIGN_GROUP1_S8_REPORT.md`.

## What staff see (POS and admin)

Sessions 1 to 9 changed **no POS or counter screen**, no sidebar or table row hover, and no staff colour token. All the new look sits under a `data-ui="v2"` scope that only the customer frame sets; a test fails if a style rule leaks outside it. What staff gain: the Website Information pages tab and editor, the service Photo and content boxes, the photo field in the service group and product category forms, the logo, show-on-home and order fields in the brand form, new labels for where a media photo is used, and Cancel buttons in confirmation dialogs now use the "neutral" variant (it looks the same as before outside the customer frame). The season preview stage in the admin now renders with the customer frame, so it looks like the new customer site.

## Rollback blocks

The four migrations only **add** (columns, an empty table, a loosened guard function), so **no database rollback is needed**: the previous code ignores the new columns and table, does not use the new customer email-change path, and the permission count is unchanged (82). The eight policy pages stay in the database, so installing the new code again later needs no re-import. Rolling back therefore means putting the previous code back. A database restore from the backup is **not** part of these blocks: it would erase everything entered after the backup (orders, bookings, payments), so it is only done on Claude's instruction.

### Block R1: put the previous code back (API, worker and web)

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
OLD=4f2ced4bab798ca52138f3bf527cab4b61d67730
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "STOP: the rebuild failed; send a screenshot (then block R2 may bring the old build back)"; exit 1; }
[ "$(git rev-parse HEAD)" = "$OLD" ] || { echo "STOP: not on the previous code"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
echo "home: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/vi)  health: $(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')"
)
```

**Expect:** the rebuild output, the pm2 table with `lucyspa-api`, `lucyspa-worker`, `lucyspa-web` all `online`, then `home: 200  health: 1`. About 10 to 15 minutes. The customer site returns to the previous look. The eight policy pages stop opening (the old code has no such route) but stay in the database. **If different:** a `STOP:` line or a red process: send the screenshot; do not try anything else.

### Block R2: only the web files are broken, put the previous build back from the backup (no rebuild, about 2 minutes)

Use when a `pnpm build` died halfway and the site shows errors, or a restart leaves web `errored`. It restores the build files saved in block 1 (the previous code's `.next`, `dist` folders) and restarts.

```bash
(
set -u
cd /opt/lucyspa || { echo "STOP: no /opt/lucyspa"; exit 1; }
test -f /root/backups/group1-state.env || { echo "STOP: no state file (block 1 never ran)"; exit 1; }
. /root/backups/group1-state.env
[ -s "$WEBBACKUP" ] || { echo "STOP: backup file $WEBBACKUP is missing"; exit 1; }
tar -xzf "$WEBBACKUP" -C /opt/lucyspa || { echo "STOP: could not unpack the backup"; exit 1; }
git checkout 4f2ced4bab798ca52138f3bf527cab4b61d67730 || { echo "STOP: git checkout failed"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
echo "home: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/vi)  health: $(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')"
)
```

**Expect:** pm2 table all `online`, `home: 200  health: 1`. **If different:** send the screenshot. (If the database is already at 138 this is fine: the previous code runs on it, see above.)
