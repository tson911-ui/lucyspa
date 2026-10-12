# Hướng dẫn đưa Claude Wave 0 + A (dọn lời đánh giá nhà cung cấp, viết lại sản phẩm bằng AI, cổng dữ liệu cho bot) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng** (không chạy tiếp, không làm gì nguy hiểm). Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Bản sẽ cài:** commit `__NEW__`, đã push lên `main`. Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `06badcf1ab922c4240f67f1c43481f9d9ce549f4` (Phase 7, 8, 9: **122 migration, 77 quyền**).
**Cơ sở dữ liệu:** từ 122 lên **127 migration**, chỉ **thêm**: **5 bảng mới rỗng** (`ai_settings` có sẵn **một dòng, mọi thứ tắt**; `ai_usage_ledger`, `ai_reservations`, `ai_runs`, `ai_items`), 8 cột mới ở bảng `products` (nguồn chữ, tiêu đề/mô tả tìm kiếm, bốn mục mô tả), 2 cột ở `ai_items`/`discounts` (`applied_via`, `bot_visible`), các quy tắc bảo vệ ở cơ sở dữ liệu (nhật ký chi tiêu AI chỉ thêm, không sửa; chữ đã viết lại không bị nhập Excel ghi đè). Migration cũng **đánh dấu** các sản phẩm nhập từ nhà cung cấp là "bản sao của nhà cung cấp" (cập nhật số phiên bản của các dòng đó); **không đổi chữ, giá hay tồn kho nào.**
**Quyền:** 77 → **79**: `MANAGE_AI_SETTINGS` (Cài đặt AI), `USE_AI_CONTENT` (xem và duyệt bản nháp AI). **Không cấp cho ai** (chỉ tài khoản Owner có sẵn mọi quyền). Sau triển khai Owner vào Quản trị → Vai trò để gán cho quản lý nào cần.
**Điều gì đổi với người dùng:** (1) Owner thấy thêm **Dọn lời đánh giá**, **Viết lại nội dung** (menu Danh mục) và **Cài đặt AI** (Quản trị); nhân viên không có quyền mới **không thấy gì thêm**. (2) Trang khách **chưa đổi gì** cho đến khi bạn bấm **Áp dụng** cho một bản nháp (khi đó trang sản phẩm đó có thêm bốn mục Công dụng, Thành phần, Cách dùng, Phù hợp với ai và tiêu đề tìm kiếm riêng). Trang sản phẩm khai báo cho Google "chỉ bán tại cửa hàng" khi Bán online đang tắt (đúng với trang). (3) **Nhập Excel**: với sản phẩm có chữ do Lucy Spa viết, hai cột tên và mô tả trong tệp **bị bỏ qua** (có dòng cảnh báo); ghi đè cần tích ô và nhập lý do. (4) Ở lần quét nhà cung cấp kế tiếp sẽ có **một lần** dòng "nội dung đổi" cho các sản phẩm đã dọn lời đánh giá: bình thường.
**Biến môi trường (`.env`):** **không bắt buộc đổi gì để triển khai.** Khóa Anthropic dán sau, do chính Owner làm (`docs/HUONG_DAN_DAN_KHOA_ANTHROPIC.md`); cổng bot bật sau (`docs/N8N_BOT_DATA_GUIDE.md`). Chưa có khóa thì mọi tính năng AI **tắt**, hệ thống chạy như cũ.
**Mới về hạ tầng:** **một thư viện mới** `@anthropic-ai/sdk` (bản chính thức của Anthropic, đã ghim phiên bản `0.129.0`, nên `pnpm install` cần mạng) và **một địa chỉ ra ngoài mới** `api.anthropic.com` (chỉ dùng khi có khóa). **Không** có tiến trình pm2 mới, không đổi nginx. API có thể mở thêm **một cổng nội bộ** cho bot (tắt cho đến khi có `BOT_DATA_KEY`).
**Thời gian:** khoảng 25 phút. Trong lúc áp migration API và worker **dừng khoảng 1 đến 2 phút**: POS tạm gián đoạn; báo nhân viên trước.

## Trước khi dán

- Trên GitHub, tab **Actions**, commit `__NEW__` có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- Báo nhân viên thu tiền ở quầy: tạm dừng khoảng 5 phút.

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=__NEW__
OLD=06badcf1ab922c4240f67f1c43481f9d9ce549f4
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
AI_TABLES="select count(*) from information_schema.tables where table_schema='public' and table_name in ('ai_settings','ai_usage_ledger','ai_reservations','ai_runs','ai_items')"
AI_EMPTY="select (select count(*) from ai_usage_ledger)+(select count(*) from ai_reservations)+(select count(*) from ai_runs)+(select count(*) from ai_items)"
AI_SETTINGS="select count(*)||'|'||bool_and(not enabled)||'|'||bool_and(not rewrite_enabled)||'|'||bool_and(vnd_per_usd is null)||'|'||bool_and(monthly_cap_vnd = 3000000)||'|'||bool_and(not allow_authenticity_claims) from ai_settings"
PRODUCT_COLUMNS="select count(*) from information_schema.columns where table_schema='public' and table_name='products' and column_name in ('content_origin','content_origin_at','seo_title_vi','seo_title_en','seo_description_vi','seo_description_en','description_sections_vi','description_sections_en')"
OTHER_COLUMNS="select count(*) from information_schema.columns where table_schema='public' and ((table_name='ai_items' and column_name='applied_via') or (table_name='discounts' and column_name='bot_visible'))"
SUPPLIER_RULE="select count(*) from products where source is not null and source ->> 'supplierId' is not null"
CODES="'MANAGE_AI_SETTINGS','USE_AI_CONTENT'"
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products"
echo "=== 0. Dieu kien ==="
START=$(sqlq $DB "$COUNTS")
expect "migration va quyen truoc" "$START" "122|77"
expect "ma dang chay" "$(git rev-parse HEAD)" "$OLD"
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
expect "web online" "$(count_online lucyspa-web)" "3"
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 2 ] || dung "o dia con $FREE GB, can it nhat 2 GB"
echo "OK  o dia con trong: $FREE GB"
expect "5 bang AI chua co" "$(sqlq $DB "$AI_TABLES")" "0"
expect "quyen moi chua co" "$(sqlq $DB "select count(*) from permissions where code::text in ($CODES)")" "0"
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")
PRODUCTS_BEFORE=$(sqlq $DB "select count(*) from products")
FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")
SUPPLIER_BEFORE=$(sqlq $DB "$SUPPLIER_RULE")
TEXTS_BEFORE=$(sqlq $DB "$TEXTS")
echo "Ghi lai: nguoi dung=$USERS_BEFORE hoa don=$INVOICES_BEFORE thanh toan=$PAYMENTS_BEFORE san pham=$PRODUCTS_BEFORE (tu nha cung cap=$SUPPLIER_BEFORE) but toan so quy=$FUNDS_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-claude-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-claude-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp loi"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "sao luu doc ra chi $LISTED dong"
echo "OK  sao luu co so du lieu: $BACKUP ($LISTED dong)"
WEBBACKUP=/root/backups/lucyspa-web-pre-claude-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "khong nen duoc ban web"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "ban sao luu web qua nho"
[ "$(tar -tzf "$WEBBACKUP" | wc -l)" -gt 500 ] || dung "ban sao luu web it tep bat thuong"
echo "OK  sao luu web: $WEBBACKUP"
echo "=== 2. Lay ban moi, cai, build (chua khoi dong lai gi) ==="
git fetch origin || dung "git fetch loi"
git checkout "$NEW" || dung "git checkout loi"
expect "ma moi" "$(git rev-parse HEAD)" "$NEW"
pnpm install --frozen-lockfile || dung "pnpm install loi (can mang de tai thu vien moi; phan mem dang chay chua bi dung toi)"
pnpm db:generate || dung "db:generate loi"
pnpm build || dung "pnpm build loi (neu trang web bao loi: xem phan Quay lai)"
echo "=== 3. Dien tap tren ban khoi phuc cua co so du lieu that ==="
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong tao duoc co so du lieu tam"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore vao co so du lieu tam loi"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "lenh tu choi ten co so du lieu tam"
expect "dang tro vao co so du lieu tam" "${DATABASE_URL##*/}" "$SCRATCH"
pnpm db:deploy || dung "db:deploy tren ban tam loi"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "2 inserted, 77 already present" || dung "danh muc quyen tren ban tam khong phai '2 inserted, 77 already present'"
unset DATABASE_URL
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "ban tam: migration va quyen" "$(sqlq $SCRATCH "$COUNTS")" "127|79"
expect "ban tam: 5 bang AI" "$(sqlq $SCRATCH "$AI_TABLES")" "5"
expect "ban tam: 4 bang AI rong" "$(sqlq $SCRATCH "$AI_EMPTY")" "0"
expect "ban tam: cai dat AI (1 dong, moi thu tat)" "$(sqlq $SCRATCH "$AI_SETTINGS")" "1|true|true|true|true|true"
expect "ban tam: 8 cot moi o san pham" "$(sqlq $SCRATCH "$PRODUCT_COLUMNS")" "8"
expect "ban tam: 2 cot moi con lai" "$(sqlq $SCRATCH "$OTHER_COLUMNS")" "2"
expect "ban tam: san pham 'ban sao nha cung cap' khop quy tac nguon" "$(sqlq $SCRATCH "select count(*) from products where content_origin='SUPPLIER_COPY'")" "$SUPPLIER_BEFORE"
expect "ban tam: moi khong co san pham nao co sua chu" "$(sqlq $SCRATCH "select count(*) from products where content_origin='LUCY_AI'")" "0"
expect "ban tam: chu cua san pham khong doi" "$(sqlq $SCRATCH "$TEXTS")" "$TEXTS_BEFORE"
expect "ban tam: khong chuong trinh nao cho bot nhac" "$(sqlq $SCRATCH "select count(*) from discounts where bot_visible")" "0"
expect "ban tam: so nguoi dung giu nguyen" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "ban tam: so hoa don giu nguyen" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "ban tam: so thanh toan giu nguyen" "$(sqlq $SCRATCH "select count(*) from payments")" "$PAYMENTS_BEFORE"
expect "ban tam: so san pham giu nguyen" "$(sqlq $SCRATCH "select count(*) from products")" "$PRODUCTS_BEFORE"
echo "Thoi gian tung migration tren ban tam (gui Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' giay' from _prisma_migrations where migration_name >= '20261212' order by migration_name"
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
echo "$SYNC" | grep -q "2 inserted, 77 already present" || dung "danh muc quyen that khong phai '2 inserted, 77 already present'"
expect "migration va quyen sau" "$(sqlq $DB "$COUNTS")" "127|79"
expect "5 bang AI co mat" "$(sqlq $DB "$AI_TABLES")" "5"
expect "4 bang AI deu rong" "$(sqlq $DB "$AI_EMPTY")" "0"
expect "cai dat AI (1 dong, moi thu tat)" "$(sqlq $DB "$AI_SETTINGS")" "1|true|true|true|true|true"
expect "8 cot moi o san pham" "$(sqlq $DB "$PRODUCT_COLUMNS")" "8"
expect "2 cot moi con lai" "$(sqlq $DB "$OTHER_COLUMNS")" "2"
expect "san pham 'ban sao nha cung cap' khop quy tac nguon" "$(sqlq $DB "select count(*) from products where content_origin='SUPPLIER_COPY'")" "$SUPPLIER_BEFORE"
expect "chu cua san pham khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
expect "2 quyen moi chua cap cho ai" "$(sqlq $DB "select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in ($CODES)")" "0"
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
expect "web online" "$(count_online lucyspa-web)" "3"
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
for TRANG in product-text-cleanup product-rewrites ai-settings; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
for DUONG in ai/settings ai/product-drafts ai/product-drafts/page ai/product-runs "ai/product-runs/preview?scope=FIRST_THREE" product-text-cleanup/preview; do
  expect "API $DUONG khi chua dang nhap" "$(http "http://127.0.0.1:3001/api/v1/$DUONG")" "401"
done
expect "lenh ghi can dang nhap va CSRF" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3001/api/v1/ai/product-runs)" "403"
expect "cong bot chua bat (khong co BOT_DATA_KEY)" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3101/bot/v1/health)" "000"
expect "web khong chuyen tiep /bot" "$(http http://127.0.0.1:3000/bot/v1/health)" "404"
sleep 10
expect "khong lan chay AI nao tu bat dau" "$(sqlq $DB "$AI_EMPTY")" "0"
expect "chu cua san pham van khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
expect "but toan so quy khong tu ghi gi" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
echo "--- worker: dong 'AI features stay off' la binh thuong khi chua co khoa ---"
pm2 logs lucyspa-worker --out --lines 40 --nostream 2>&1 | grep -c "AI features stay off" || true
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "so lieu sau: $(sqlq $DB "$COUNTS") (mong doi 127|79)"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
)
```

## Sau khi khối chạy xong (Owner xem trên web)

1. Đăng nhập Owner: menu **Danh mục** có **Dọn lời đánh giá** và **Viết lại nội dung**; **Quản trị** có **Cài đặt AI** (khung "Kết nối" ghi "Máy chủ chưa có khóa": đúng, chưa dán khóa).
2. **Quản trị → Vai trò:** có 2 quyền mới, chưa gán cho vai trò nào. Gán `USE_AI_CONTENT` cho quản lý nào sẽ duyệt bản nháp (người đó **còn cần** quyền sửa sản phẩm để bấm Áp dụng); `MANAGE_AI_SETTINGS` nên chỉ Owner.
3. Trang khách (Trang chủ, Dịch vụ, Mỹ phẩm, một sản phẩm) mở bình thường, **không đổi**; "Bán online" như trước.
4. Làm theo `docs/OWNER_TEST_SCRIPT_CLAUDE_WAVE_A.md` (bước 1 **không cần khóa**; từ bước 2 cần dán khóa theo `docs/HUONG_DAN_DAN_KHOA_ANTHROPIC.md`).

## Quay lại nếu có sự cố

**Đọc trước:** mọi migration chỉ **thêm**; không có dữ liệu cũ nào bị đổi ngoài số phiên bản của các sản phẩm nhà cung cấp (đánh dấu nguồn chữ). Bản cũ `06badcf` chạy được trên cơ sở dữ liệu 127 migration **sau khi xóa 2 hàng quyền mới** (xem `docs/CLAUDE_WAVE_A_ROLLBACK_PROOF.md`: đã thử trên máy này, mục "Kết quả"). Bản nháp AI, nhật ký chi tiêu và lần chạy đã tạo là **lịch sử** (cơ sở dữ liệu không cho xóa hay sửa): quay lui chỉ làm chúng đứng yên, bản mới đọc lại được. **Chữ sản phẩm đã áp dụng** (nếu Owner đã bấm Áp dụng) vẫn nằm trên sản phẩm; bản cũ không làm mất chúng, và nhật ký giữ chữ cũ.

**Cách A: quay về bản cũ `06badcf`, giữ cơ sở dữ liệu** (dán nguyên khối):

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=06badcf1ab922c4240f67f1c43481f9d9ce549f4
pm2 stop lucyspa-api lucyspa-worker
CODES="'MANAGE_AI_SETTINGS','USE_AI_CONTENT'"
printf '%s\n' "delete from role_permissions where permission_id in (select id from permissions where code::text in ($CODES)); delete from user_permission_overrides where permission_id in (select id from permissions where code::text in ($CODES)); delete from permissions where code::text in ($CODES);" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_dev -At'
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pnpm db:permissions:sync
pm2 status
)
```

**Mong đợi:** ba tiến trình `online`; `Permission catalog synced: 0 inserted, 77 already present.`; `https://lucyspa.vn/vi` mở được. (2 quyền được thêm lại, vẫn chưa cấp cho ai, khi sau này triển khai lại bản mới.)

_Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.

**Cách B (chỉ khi cơ sở dữ liệu hỏng): khôi phục từ tệp sao lưu `lucyspa-pre-claude-….dump`.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất** (hóa đơn, thanh toán, bản nháp). **Hỏi Claude trước khi làm.**
