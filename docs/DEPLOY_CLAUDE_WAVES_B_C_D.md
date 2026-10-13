# Hướng dẫn đưa Claude Wave B, C, D (chat website, mô tả tìm kiếm, trợ lý báo cáo, thẻ khách cho KTV) và quy trình bản nháp mới lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng**. Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Bản sẽ cài:** commit `0e60254d28940077e78eb5016b82903ed59d810e`, đã push lên `main`. Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `c6b85ecc99e2636c459b35cc1a2240be89142a5a` (**127 migration, 79 quyền**).
**Cơ sở dữ liệu:** từ 127 lên **134 migration**, chỉ **thêm**: bảng `chat_callback_requests` (yêu cầu gọi lại), `ai_seo_drafts` (bản nháp mô tả tìm kiếm), `ai_assistant_questions` (nhật ký câu hỏi của trợ lý, chữ giữ 30 ngày rồi xóa), `ai_customer_briefs` (bộ nhớ đệm thẻ khách, xóa sau 7 ngày kể từ ngày làm dịch vụ); 8 cột mới ở `ai_settings` (công tắc chat, mô tả tìm kiếm, trợ lý, thẻ khách, trần chat 300 tin mỗi ngày, mô hình từng tính năng); 4 cột mô tả tìm kiếm ở `services` và `website_shop_info`; hai giá trị mới được phép ở nhật ký chi tiêu (`REPAIRED`, `REPAIR_FAILED`: chi phí sửa bản nháp tách riêng) và ở cách duyệt hàng loạt (`ALL`); loại thông báo mới "yêu cầu gọi lại". **Không đổi chữ, giá, tồn kho hay tiền nào.**
**Quyền:** 79 → **82**: `MANAGE_CHAT_REQUESTS` (xử lý yêu cầu gọi lại), `USE_AI_ASSISTANT` (hỏi trợ lý báo cáo), `VIEW_CUSTOMER_BRIEF` (xem thẻ khách, theo chi nhánh). **Không cấp cho ai** (chỉ Owner có sẵn mọi quyền).
**Mọi tính năng mới TẮT sau khi cài** (công tắc ở **Cài đặt AI**, mặc định tắt): chat website, mô tả tìm kiếm, trợ lý báo cáo, thẻ khách. Trang khách **không đổi** cho đến khi bạn bật chat (cần nối n8n, xem `docs/N8N_BOT_DATA_GUIDE.md`) hoặc áp dụng một bản nháp.
**Quy trình bản nháp viết lại sản phẩm đổi theo quyết định của Owner ngày 13/10/2026:** bản nháp được **tự sửa trước khi lưu** (sửa bằng mã, miễn phí; chỗ nào mã không sửa được thì **một** lần nhờ AI viết lại **đúng mục đó**); **lưu ý không còn chặn việc duyệt**; trong danh sách có **ô chọn từng bài, "Chọn tất cả" và nút "Duyệt các bài đã chọn"** (một lần xác nhận, có nhật ký); bản nháp **không bao giờ tự đăng**. Khối lệnh cũng **áp dụng cách sửa miễn phí cho mọi bản nháp đang chờ duyệt** và, **chỉ khi còn chỗ thật sự lỗi**, nhờ AI sửa (có tốn tiền, trong hạn mức đã đặt); nó in ra **số bài đã sửa miễn phí, số bài cần AI sửa và chi phí**.
**Bản nháp mô tả tìm kiếm (dịch vụ, trang chủ) cũng theo quy tắc đó (Owner, 13/10/2026):** lưu ý chỉ để tham khảo, **không bao giờ chặn** nút Áp dụng.
**Biến môi trường (`.env`):** **không bắt buộc đổi gì để cài.** Bật chat sau cần thêm `N8N_CHAT_WEBHOOK_URL` và `CHAT_WEBHOOK_SECRET` (`docs/N8N_BOT_DATA_GUIDE.md` mục D). Trợ lý báo cáo và thẻ khách dùng **khóa Anthropic đã có** trong `.env`.
**Mới về hạ tầng:** không có thư viện mới, không có tiến trình pm2 mới, không đổi nginx. Khối lệnh chạy **một lệnh một lần** của worker (`ai-fix-pending`).
**Thời gian:** khoảng 25 phút. Trong lúc áp migration API và worker **dừng khoảng 1 đến 2 phút**: POS tạm gián đoạn; báo nhân viên trước.

## Trước khi dán

- Trên GitHub, tab **Actions**, commit `0e60254d28940077e78eb5016b82903ed59d810e` có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- Trang **Viết lại nội dung**: không có dòng "Đang chờ" hoặc "Đang viết" và lần chạy gần nhất không ở trạng thái đang chạy. Nếu còn, bấm **Tạm dừng** rồi **Hủy** lần chạy đó, hoặc đợi xong.
- **Trong lúc khối chạy, không bấm Duyệt hay Áp dụng** ở bất cứ đâu (khối so chữ của sản phẩm trước và sau).
- Báo nhân viên thu tiền ở quầy: tạm dừng khoảng 5 phút.

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=0e60254d28940077e78eb5016b82903ed59d810e
OLD=c6b85ecc99e2636c459b35cc1a2240be89142a5a
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: duoc '$2', mong doi tu '$3' tro len"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
field() { printf '%s\n' "$1" | sed -n "s/.*$2=\([0-9]*\).*/\1/p" | tail -n 1; }
NEWPERMS="'MANAGE_CHAT_REQUESTS','USE_AI_ASSISTANT','VIEW_CUSTOMER_BRIEF'"
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,'')||'~'||coalesce(seo_title_vi,'')||'~'||coalesce(seo_description_vi,''), '#' order by id::text)) from products"
SERVICE_TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services"
OLD_SETTINGS="select enabled::text||'|'||rewrite_enabled::text||'|'||coalesce(vnd_per_usd::text,'null')||'|'||monthly_cap_vnd::text||'|'||allow_authenticity_claims::text||'|'||concurrency::text||'|'||rewrite_model from ai_settings"
NEW_TABLES="select count(*) from information_schema.tables where table_schema='public' and table_name in ('chat_callback_requests','ai_seo_drafts','ai_assistant_questions','ai_customer_briefs')"
NEW_TABLES_EMPTY="select (select count(*) from chat_callback_requests)+(select count(*) from ai_seo_drafts)+(select count(*) from ai_assistant_questions)+(select count(*) from ai_customer_briefs)"
SWITCHES="select count(*)||'|'||bool_and(not chat_enabled)||'|'||bool_and(not seo_enabled)||'|'||bool_and(not assistant_enabled)||'|'||bool_and(not brief_enabled)||'|'||bool_and(chat_daily_cap = 300) from ai_settings"
SEO_COLUMNS="select count(*) from information_schema.columns where table_schema='public' and column_name in ('seo_description_vi','seo_description_en') and table_name in ('services','website_shop_info')"
LEDGER_RULE="select (pg_get_constraintdef(oid) like '%REPAIRED%' and pg_get_constraintdef(oid) like '%REPAIR_FAILED%')::text from pg_constraint where conname='ai_usage_ledger_outcome'"
VIA_RULE="select (pg_get_constraintdef(oid) like '%ALL%')::text from pg_constraint where conname='ai_items_applied_via'"
PERM_SCOPES="select string_agg(code::text||':'||scope_capability::text||':'||data_classification::text, ',' order by code::text) from permissions where code::text in ($NEWPERMS)"
DRAFTS_READY="select count(*) from ai_items where kind='PRODUCT_TEXT' and status='DRAFT_READY'"
DRAFTS_APPLIED="select count(*) from ai_items where kind='PRODUCT_TEXT' and status='APPLIED'"
DRAFTS_EDITED="select count(*) from ai_items where kind='PRODUCT_TEXT' and status='DRAFT_READY' and edited is not null"
echo "=== 0. Dieu kien ==="
expect "migration va quyen truoc" "$(sqlq $DB "$COUNTS")" "127|79"
expect "ma dang chay" "$(git rev-parse HEAD)" "$OLD"
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
expect "khong ban nhap nao dang cho hoac dang viet" "$(sqlq $DB "select count(*) from ai_items where status in ('QUEUED','GENERATING')")" "0"
expect "khong lan chay nao dang mo" "$(sqlq $DB "select count(*) from ai_runs where status in ('QUEUED','RUNNING')")" "0"
expect "4 bang moi chua co" "$(sqlq $DB "$NEW_TABLES")" "0"
expect "3 quyen moi chua co" "$(sqlq $DB "select count(*) from permissions where code::text in ($NEWPERMS)")" "0"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 2 ] || dung "o dia con $FREE GB, can it nhat 2 GB"
echo "OK  o dia con trong: $FREE GB"
TEXTS_BEFORE=$(sqlq $DB "$TEXTS")
SERVICE_TEXTS_BEFORE=$(sqlq $DB "$SERVICE_TEXTS")
SETTINGS_BEFORE=$(sqlq $DB "$OLD_SETTINGS")
READY_BEFORE=$(sqlq $DB "$DRAFTS_READY")
APPLIED_BEFORE=$(sqlq $DB "$DRAFTS_APPLIED")
EDITED_BEFORE=$(sqlq $DB "$DRAFTS_EDITED")
LEDGER_BEFORE=$(sqlq $DB "select count(*) from ai_usage_ledger")
PRODUCTS_BEFORE=$(sqlq $DB "select count(*) from products")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")
FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
echo "Ghi lai: cai dat AI=$SETTINGS_BEFORE | ban nhap cho duyet=$READY_BEFORE da ap dung=$APPLIED_BEFORE da sua tay=$EDITED_BEFORE | nguoi dung=$USERS_BEFORE hoa don=$INVOICES_BEFORE san pham=$PRODUCTS_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-claude-bcd-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-claude-bcd-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp loi"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "sao luu doc ra chi $LISTED dong"
echo "OK  sao luu co so du lieu: $BACKUP ($LISTED dong)"
WEBBACKUP=/root/backups/lucyspa-web-pre-claude-bcd-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "khong nen duoc ban web"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "ban sao luu web qua nho"
[ "$(tar -tzf "$WEBBACKUP" | wc -l)" -gt 500 ] || dung "ban sao luu web it tep bat thuong"
echo "OK  sao luu web: $WEBBACKUP"
echo "=== 2. Lay ban moi, cai, build (chua khoi dong lai gi) ==="
git fetch origin || dung "git fetch loi"
git checkout "$NEW" || dung "git checkout loi"
expect "ma moi" "$(git rev-parse HEAD)" "$NEW"
pnpm install --frozen-lockfile || dung "pnpm install loi (phan mem dang chay chua bi dung toi)"
pnpm db:generate || dung "db:generate loi"
pnpm build || dung "pnpm build loi (neu trang web bao loi: xem phan Quay lai)"
expect "ban moi co tro ly bao cao" "$(grep -c "assistant.v1" packages/server/dist/ai/assistant.js)" "1"
expect "ban moi co the khach" "$(grep -c "CUSTOMER_BRIEF_VIEWED" apps/api/dist/brief/brief.core.js)" "1"
expect "ban moi co lenh sua ban nhap dang cho" "$(test -f apps/worker/dist/ai-fix-pending.js && echo co)" "co"
expect "ban moi: ban nhap mo ta tim kiem khong con bi chan boi luu y" "$(grep -c "acknowledgeWarnings" apps/api/dist/ai/ai-seo.core.js)" "0"
expect "ban moi co buoc sua bang ma truoc khi luu" "$(grep -c "fixDraft" packages/server/dist/ai/rewrite-engine.js | awk '{print ($1>0)?"co":"khong"}')" "co"
echo "=== 3. Dien tap tren ban khoi phuc cua co so du lieu that ==="
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong tao duoc co so du lieu tam"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore vao co so du lieu tam loi"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "lenh tu choi ten co so du lieu tam"
expect "dang tro vao co so du lieu tam" "${DATABASE_URL##*/}" "$SCRATCH"
pnpm db:deploy || dung "db:deploy tren ban tam loi"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "3 inserted, 79 already present" || dung "danh muc quyen tren ban tam khong phai '3 inserted, 79 already present'"
unset DATABASE_URL
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "ban tam: migration va quyen" "$(sqlq $SCRATCH "$COUNTS")" "134|82"
expect "ban tam: 4 bang moi" "$(sqlq $SCRATCH "$NEW_TABLES")" "4"
expect "ban tam: 4 bang moi deu rong" "$(sqlq $SCRATCH "$NEW_TABLES_EMPTY")" "0"
expect "ban tam: 4 cong tat moi dang tat, tran chat 300" "$(sqlq $SCRATCH "$SWITCHES")" "1|true|true|true|true|true"
expect "ban tam: 4 cot mo ta tim kiem" "$(sqlq $SCRATCH "$SEO_COLUMNS")" "4"
expect "ban tam: nhat ky chi tieu nhan REPAIRED va REPAIR_FAILED" "$(sqlq $SCRATCH "$LEDGER_RULE")" "true"
expect "ban tam: duyet hang loat ALL duoc phep" "$(sqlq $SCRATCH "$VIA_RULE")" "true"
expect "ban tam: 3 quyen dung pham vi" "$(sqlq $SCRATCH "$PERM_SCOPES")" "MANAGE_CHAT_REQUESTS:GLOBAL_ONLY:STANDARD,USE_AI_ASSISTANT:GLOBAL_ONLY:STANDARD,VIEW_CUSTOMER_BRIEF:BRANCH_CAPABLE:STANDARD"
expect "ban tam: cai dat AI cu khong doi" "$(sqlq $SCRATCH "$OLD_SETTINGS")" "$SETTINGS_BEFORE"
expect "ban tam: chu cua san pham khong doi" "$(sqlq $SCRATCH "$TEXTS")" "$TEXTS_BEFORE"
expect "ban tam: chu cua dich vu khong doi" "$(sqlq $SCRATCH "$SERVICE_TEXTS")" "$SERVICE_TEXTS_BEFORE"
expect "ban tam: ban nhap cho duyet khong doi" "$(sqlq $SCRATCH "$DRAFTS_READY")" "$READY_BEFORE"
expect "ban tam: ban nhap da ap dung khong doi" "$(sqlq $SCRATCH "$DRAFTS_APPLIED")" "$APPLIED_BEFORE"
expect "ban tam: so nguoi dung giu nguyen" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "ban tam: so hoa don giu nguyen" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "ban tam: so thanh toan giu nguyen" "$(sqlq $SCRATCH "select count(*) from payments")" "$PAYMENTS_BEFORE"
expect "ban tam: so san pham giu nguyen" "$(sqlq $SCRATCH "select count(*) from products")" "$PRODUCTS_BEFORE"
echo "Thoi gian tung migration tren ban tam (gui Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' giay' from _prisma_migrations where migration_name >= '20261213' order by migration_name"
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong xoa duoc co so du lieu tam"
expect "da xoa co so du lieu tam" "$(sqlq $DB "select count(*) from pg_database where datname = '$SCRATCH'")" "0"
echo "=== 4. Dung API va worker, ap migration vao co so du lieu that ==="
pm2 stop lucyspa-api lucyspa-worker >/dev/null 2>&1
sleep 3
expect "api da dung" "$(count_online lucyspa-api)" "0"
expect "worker da dung" "$(count_online lucyspa-worker)" "0"
expect "khong co DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
pnpm db:deploy || dung "db:deploy that loi: KHONG chay lai, hoi Claude (API va worker dang dung)"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "3 inserted, 79 already present" || dung "danh muc quyen that khong phai '3 inserted, 79 already present'"
expect "migration va quyen sau" "$(sqlq $DB "$COUNTS")" "134|82"
expect "4 bang moi" "$(sqlq $DB "$NEW_TABLES")" "4"
expect "4 bang moi deu rong" "$(sqlq $DB "$NEW_TABLES_EMPTY")" "0"
expect "4 cong tat moi dang tat, tran chat 300" "$(sqlq $DB "$SWITCHES")" "1|true|true|true|true|true"
expect "4 cot mo ta tim kiem" "$(sqlq $DB "$SEO_COLUMNS")" "4"
expect "nhat ky chi tieu nhan REPAIRED va REPAIR_FAILED" "$(sqlq $DB "$LEDGER_RULE")" "true"
expect "duyet hang loat ALL duoc phep" "$(sqlq $DB "$VIA_RULE")" "true"
expect "3 quyen dung pham vi" "$(sqlq $DB "$PERM_SCOPES")" "MANAGE_CHAT_REQUESTS:GLOBAL_ONLY:STANDARD,USE_AI_ASSISTANT:GLOBAL_ONLY:STANDARD,VIEW_CUSTOMER_BRIEF:BRANCH_CAPABLE:STANDARD"
expect "3 quyen moi chua cap cho ai" "$(sqlq $DB "select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in ($NEWPERMS)")" "0"
expect "cai dat AI cu khong doi" "$(sqlq $DB "$OLD_SETTINGS")" "$SETTINGS_BEFORE"
expect "chu cua san pham khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
expect "chu cua dich vu khong doi" "$(sqlq $DB "$SERVICE_TEXTS")" "$SERVICE_TEXTS_BEFORE"
expect "ban nhap cho duyet khong doi" "$(sqlq $DB "$DRAFTS_READY")" "$READY_BEFORE"
expect "so nguoi dung giu nguyen" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "so hoa don giu nguyen" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "so thanh toan giu nguyen" "$(sqlq $DB "select count(*) from payments")" "$PAYMENTS_BEFORE"
expect "so san pham giu nguyen" "$(sqlq $DB "select count(*) from products")" "$PRODUCTS_BEFORE"
expect "but toan so quy giu nguyen" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
expect "ban online khong bi doi" "$(sqlq $DB "select enabled from online_sales_settings")" "$ONLINE_BEFORE"
echo "=== 5. Khoi dong lai ==="
pm2 restart lucyspa-api lucyspa-worker --update-env >/dev/null 2>&1
sleep 10
pm2 reload lucyspa-web --update-env >/dev/null 2>&1
sleep 20
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online (dung 1)" "$(count_online lucyspa-worker)" "1"
echo "--- 15 dong loi gan nhat cua API va worker (khong duoc co dong moi sau luc khoi dong lai) ---"
pm2 logs lucyspa-api --err --lines 15 --nostream 2>&1 | tail -n 15
pm2 logs lucyspa-worker --err --lines 15 --nostream 2>&1 | tail -n 15
echo "=== 6. Kiem tra bang lenh (khong tao hay sua du lieu that) ==="
expect "suc khoe" "$(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')" "1"
expect "trang chu /vi" "$(http http://127.0.0.1:3000/vi)" "200"
expect "dich vu" "$(http http://127.0.0.1:3000/vi/services)" "200"
expect "my pham" "$(http http://127.0.0.1:3000/vi/products)" "200"
expect "dang nhap nhan vien" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for TRANG in product-rewrites seo-drafts chat-requests ai-settings my-services reports/revenue; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
for DUONG in ai/seo-drafts chat-requests ai/assistant ai/product-drafts/approve-all briefs/lines/00000000-0000-4000-8000-000000000000; do
  expect "API $DUONG khi chua dang nhap" "$(http "http://127.0.0.1:3001/api/v1/$DUONG")" "401"
done
expect "chat website con tat (chua co N8N_CHAT_WEBHOOK_URL)" "$(curl -s http://127.0.0.1:3001/api/v1/public/site | grep -c '"chatEnabled":false')" "1"
KQ=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"message":"xin chao","sessionId":"thu"}' http://127.0.0.1:3001/api/v1/public/chat/messages)
case "$KQ" in 400|403|404|503) echo "OK  gui tin chat khi chua co dau CSRF/khi chat tat bi tu choi: $KQ";; *) dung "gui tin chat tra $KQ (mong doi 400, 403, 404 hoac 503)";; esac
sleep 10
expect "khong ban nhap nao tu bat dau viet" "$(sqlq $DB "select count(*) from ai_items where status in ('QUEUED','GENERATING')")" "0"
echo "=== 7. Sua cac ban nhap dang cho duyet (mien phi truoc, AI chi khi con loi that) ==="
FREE_OUT=$(pnpm --filter @lucy-spa/worker run ai:fix-pending 2>&1) || { echo "$FREE_OUT" | tail -n 20; dung "lenh sua mien phi loi"; }
FREE_LINE=$(printf '%s\n' "$FREE_OUT" | grep '^pending=' | tail -n 1)
echo "KET QUA LAN SUA MIEN PHI: $FREE_LINE"
[ -n "$FREE_LINE" ] || dung "lenh sua mien phi khong in ket qua"
at_least "so ban nhap duoc xet" "$(field "$FREE_LINE" pending)" "$READY_BEFORE"
expect "ban nhap sua tay khong bi dung toi (ban dau $EDITED_BEFORE)" "$(field "$FREE_LINE" skippedEdited)" "$EDITED_BEFORE"
expect "ban nhap cho duyet van la ban nhap" "$(sqlq $DB "$DRAFTS_READY")" "$READY_BEFORE"
expect "ban nhap da ap dung khong doi" "$(sqlq $DB "$DRAFTS_APPLIED")" "$APPLIED_BEFORE"
expect "chu cua san pham van khong doi (khong gi bi dang)" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
expect "lan sua mien phi khong ton tien" "$(sqlq $DB "select count(*) from ai_usage_ledger")" "$LEDGER_BEFORE"
NEED=$(field "$FREE_LINE" needRepair)
echo "So ban nhap con loi that, can AI sua: $NEED"
if [ "$NEED" -gt 0 ]; then
  [ "$NEED" -le 120 ] || dung "$NEED ban nhap can AI sua (nhieu hon 120): KHONG tu sua, hoi Claude"
  KEYS=$(grep -c '^ANTHROPIC_API_KEY=.' /opt/lucyspa/.env || true)
  ENABLED=$(sqlq $DB "select (enabled and rewrite_enabled and vnd_per_usd is not null)::text from ai_settings")
  if [ "$KEYS" = "1" ] && [ "$ENABLED" = "true" ]; then
    REPAIR_OUT=$(pnpm --filter @lucy-spa/worker run ai:fix-pending --repair 2>&1) || { echo "$REPAIR_OUT" | tail -n 20; dung "lenh sua bang AI loi"; }
    REPAIR_LINE=$(printf '%s\n' "$REPAIR_OUT" | grep '^pending=' | tail -n 1)
    echo "KET QUA LAN SUA BANG AI: $REPAIR_LINE"
    expect "ban nhap cho duyet van la ban nhap" "$(sqlq $DB "$DRAFTS_READY")" "$READY_BEFORE"
    expect "chu cua san pham van khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
    echo "Chi phi sua bang AI (tu nhat ky chi tieu, ca hai ket cuc): $(sqlq $DB "select count(*)||' lan goi, '||coalesce(round(sum(cost_micro_usd)/1000000.0, 4), 0)||' USD' from ai_usage_ledger where outcome in ('REPAIRED','REPAIR_FAILED')")"
  else
    echo "Chua sua bang AI: khoa Anthropic hoac cong tat AI/viet lai/ty gia chua san sang (khoa=$KEYS, san sang=$ENABLED). Cac bai con loi that van nam trong danh sach, kem ghi chu cho Owner."
  fi
fi
AGAIN=$(pnpm --filter @lucy-spa/worker run ai:fix-pending 2>&1 | grep '^pending=' | tail -n 1)
echo "KET QUA LAN CHAY LAI MIEN PHI (phai khong doi them gi): $AGAIN"
expect "chay lai khong sua them bai nao mien phi" "$(field "$AGAIN" fixedFree)" "0"
echo "--- chi tieu AI thang nay (xem them o Cai dat AI) ---"
sqlq $DB "select feature||' '||outcome||' '||count(*)||' lan '||round(sum(cost_micro_usd)/1000000.0, 4)||' USD' from ai_usage_ledger where occurred_at >= date_trunc('month', now()) group by feature, outcome order by 1"
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "so lieu: $(sqlq $DB "$COUNTS") (mong doi 134|82)"
echo "sua mien phi: $FREE_LINE"
echo "sua bang AI: ${REPAIR_LINE:-khong chay}"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
)
```

## Sau khi khối chạy xong (Owner xem trên web)

1. Làm theo `docs/OWNER_TEST_SCRIPT_CLAUDE_WAVES_B_C_D.md` (từng bước, có "mong đợi"). Tóm tắt: **Cài đặt AI** có thêm các công tắc (chat, mô tả tìm kiếm, trợ lý, thẻ khách; mặc định **tắt**); **Viết lại nội dung** có ô chọn, "Chọn tất cả" và "Duyệt các bài đã chọn"; mở một bản nháp thấy khung **Lưu ý của hệ thống** và **Đã tự sửa trước khi lưu**.
2. **Quản trị → Vai trò:** có 3 quyền mới, chưa gán cho vai trò nào. `USE_AI_ASSISTANT` chỉ cho người được xem số liệu báo cáo; `MANAGE_CHAT_REQUESTS` cho người sẽ gọi lại khách; `VIEW_CUSTOMER_BRIEF` cho KTV theo chi nhánh (chỉ bật tính năng sau khi luật sư xem).
3. Nối chat website: `docs/N8N_BOT_DATA_GUIDE.md` mục D (cần thêm hai biến `.env`). **Chưa nối thì chat vẫn tắt, trang khách không đổi.**

## Quay lại nếu có sự cố

Các migration chỉ **thêm** nên không cần xóa gì ở cơ sở dữ liệu; bản cũ bỏ qua các bảng và cột mới. Chỉ cần xóa **ba dòng quyền mới** (bản cũ đếm đúng 79 quyền) và đổi lại bản chạy. Bản nháp đã được tự sửa vẫn đọc được bằng bản cũ.

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=c6b85ecc99e2636c459b35cc1a2240be89142a5a
DB=lucy_spa_dev
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 stop lucyspa-api lucyspa-worker >/dev/null 2>&1
sqlq $DB "delete from role_permissions where permission_id in (select id from permissions where code::text in ('MANAGE_CHAT_REQUESTS','USE_AI_ASSISTANT','VIEW_CUSTOMER_BRIEF'))"
sqlq $DB "delete from permissions where code::text in ('MANAGE_CHAT_REQUESTS','USE_AI_ASSISTANT','VIEW_CUSTOMER_BRIEF')"
echo "quyen con lai: $(sqlq $DB "select count(*) from permissions") (mong doi 79)"
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
)
```

**Mong đợi:** `quyen con lai: 79`, ba tiến trình `online`; trang `https://lucyspa.vn/vi` mở được. _Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.
