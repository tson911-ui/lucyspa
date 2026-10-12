# Hướng dẫn đưa Phase 8 (báo cáo, xuất Excel, bảng điều khiển, nhật ký hoạt động, đánh giá của khách) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng** (không chạy tiếp, không làm gì nguy hiểm). Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Khối này đưa cả bốn đợt của Phase 8 lên một lần** (A: doanh thu; B: bán hàng, khách, nhân viên, kho; C: quỹ, lương, lãi tạm tính, nhật ký hoạt động; D: đánh giá của khách), đúng như Owner đã chọn ngày 2026-10-12. Đang ở số migration và quyền khác `118|73`: khối dừng.

**Bản sẽ cài:** commit `06badcf1ab922c4240f67f1c43481f9d9ce549f4`, đã push lên `main`. Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `d42ab4e84814f4fb82c1e0de3c26a1c18ffe3a85` (Phase 7 và Phase 9, **118 migration, 73 quyền**).
**Cơ sở dữ liệu:** từ 118 lên **122 migration**, chỉ **thêm**: **2 bảng mới rỗng** (`customer_reviews`, `customer_review_staff_ratings`, kèm các quy tắc bảo vệ ở cơ sở dữ liệu), **2 chỉ mục mới** trên bảng thanh toán và hóa đơn (để báo cáo nhanh; không đổi dòng dữ liệu nào), 4 giá trị quyền mới. **Không đổi, không xóa dòng dữ liệu cũ nào.**
**Quyền:** 73 → **77**: `EXPORT_REPORTS` (xuất tệp), `VIEW_STAFF_REPORTS` (báo cáo nhân viên), `VIEW_PROFIT` (lãi tạm tính, chỉ Chủ), `VIEW_REVIEWS` (đánh giá của khách). **Không cấp cho ai** (chỉ tài khoản Owner có sẵn mọi quyền). Sau triển khai Owner vào Quản trị → Vai trò để gán cho quản lý nào cần xem.
**Điều gì đổi với người dùng:** (1) **Owner và ai được cấp quyền** thấy thêm mục **Báo cáo** ở menu, **Nhật ký hoạt động** ở Quản trị, ô **Doanh thu** (thay ô "Hóa đơn đã thanh toán") và 5 ô mới ở Tổng quan (Cảnh báo kho, Hoàn tiền hôm nay, Đơn online, Lệch quỹ, Cảnh báo lương; mỗi ô chỉ hiện khi có quyền xem dữ liệu đó). Nhân viên không có các quyền này **không thấy gì mới**. (2) **Khách có tài khoản** thấy ô **"Đánh giá của bạn"** ở cuối trang hóa đơn đã thanh toán (riêng tư, không đăng công khai, bỏ qua được); Owner đã chọn làm việc này và cần duyệt ảnh trước/sau (`docs/PHASE8_P8_16_P8_17_REVIEWS.md`).
**Số điện thoại khách** trong báo cáo và tệp xuất hiện **đầy đủ**, không che (Owner chọn ngày 2026-10-12).
**Biến môi trường (`.env`) mới:** không có. Không đổi nginx, không có tiến trình pm2 mới, không có thư viện mới, không đổi `pnpm-lock`. Phase 8 chỉ **đọc** dữ liệu (báo cáo không sửa gì); việc ghi duy nhất là một dòng nhật ký mỗi lần xuất tệp và các đánh giá của khách.
**Thời gian:** khoảng 25 phút. Trong lúc áp migration API và worker **dừng khoảng 1 đến 2 phút**: POS tạm gián đoạn; báo nhân viên trước.

## Trước khi dán

- Trên GitHub, tab **Actions**, commit `06badcf1ab922c4240f67f1c43481f9d9ce549f4` có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- Báo nhân viên thu tiền ở quầy: tạm dừng khoảng 5 phút.
- Owner đã xem ảnh trước/sau của ô đánh giá và đồng ý (xem `docs/PHASE8_P8_16_P8_17_REVIEWS.md`).

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=06badcf1ab922c4240f67f1c43481f9d9ce549f4
OLD=d42ab4e84814f4fb82c1e0de3c26a1c18ffe3a85
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
TABLES="select count(*) from information_schema.tables where table_schema='public' and table_name in ('customer_reviews','customer_review_staff_ratings')"
EMPTY="select (select count(*) from customer_reviews)+(select count(*) from customer_review_staff_ratings)"
INDEXES="select count(*) from pg_indexes where schemaname='public' and indexname in ('payments_branch_date_idx','invoices_paid_at_idx','customer_reviews_invoice_key','customer_reviews_branch_idx','customer_reviews_customer_idx','customer_review_staff_ratings_employee_idx')"
CODES="'EXPORT_REPORTS','VIEW_STAFF_REPORTS','VIEW_PROFIT','VIEW_REVIEWS'"
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
echo "=== 0. Dieu kien ==="
START=$(sqlq $DB "$COUNTS")
expect "migration va quyen truoc" "$START" "118|73"
expect "ma dang chay" "$(git rev-parse HEAD)" "$OLD"
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
expect "web online" "$(count_online lucyspa-web)" "3"
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 2 ] || dung "o dia con $FREE GB, can it nhat 2 GB"
echo "OK  o dia con trong: $FREE GB"
expect "so bang moi truoc" "$(sqlq $DB "$TABLES")" "0"
expect "quyen moi chua co" "$(sqlq $DB "select count(*) from permissions where code::text in ($CODES)")" "0"
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")
PRODUCTS_BEFORE=$(sqlq $DB "select count(*) from products")
FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")
echo "Ghi lai: nguoi dung=$USERS_BEFORE hoa don=$INVOICES_BEFORE thanh toan=$PAYMENTS_BEFORE san pham=$PRODUCTS_BEFORE but toan so quy=$FUNDS_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-p8-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-p8-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp loi"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "sao luu doc ra chi $LISTED dong"
echo "OK  sao luu co so du lieu: $BACKUP ($LISTED dong)"
WEBBACKUP=/root/backups/lucyspa-web-pre-p8-$STAMP.tar.gz
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
echo "=== 3. Dien tap tren ban khoi phuc cua co so du lieu that ==="
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong tao duoc co so du lieu tam"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore vao co so du lieu tam loi"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "lenh tu choi ten co so du lieu tam"
expect "dang tro vao co so du lieu tam" "${DATABASE_URL##*/}" "$SCRATCH"
pnpm db:deploy || dung "db:deploy tren ban tam loi"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "4 inserted, 73 already present" || dung "danh muc quyen tren ban tam khong phai '4 inserted, 73 already present'"
unset DATABASE_URL
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "ban tam: migration va quyen" "$(sqlq $SCRATCH "$COUNTS")" "122|77"
expect "ban tam: 2 bang moi" "$(sqlq $SCRATCH "$TABLES")" "2"
expect "ban tam: 2 bang moi deu rong" "$(sqlq $SCRATCH "$EMPTY")" "0"
expect "ban tam: 6 chi muc moi" "$(sqlq $SCRATCH "$INDEXES")" "6"
expect "ban tam: so nguoi dung giu nguyen" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "ban tam: so hoa don giu nguyen" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "ban tam: so thanh toan giu nguyen" "$(sqlq $SCRATCH "select count(*) from payments")" "$PAYMENTS_BEFORE"
echo "Thoi gian tung migration tren ban tam (gui Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' giay' from _prisma_migrations where migration_name >= '20261210' order by migration_name"
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
echo "$SYNC" | grep -q "4 inserted, 73 already present" || dung "danh muc quyen that khong phai '4 inserted, 73 already present'"
expect "migration va quyen sau" "$(sqlq $DB "$COUNTS")" "122|77"
expect "2 bang moi co mat" "$(sqlq $DB "$TABLES")" "2"
expect "2 bang moi deu rong" "$(sqlq $DB "$EMPTY")" "0"
expect "6 chi muc moi co mat" "$(sqlq $DB "$INDEXES")" "6"
expect "4 quyen moi chua cap cho ai" "$(sqlq $DB "select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in ($CODES)")" "0"
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
for TRANG in reports/revenue reports/refunds reports/sales reports/customers reports/staff reports/stock reports/cash reports/pay reports/profit reports/reviews audit-log; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
for DUONG in reports reports/revenue reports/refunds reports/revenue/services reports/revenue/products reports/online-orders reports/customers/visits reports/bookings/funnel reports/loyalty reports/customers/top reports/staff reports/stock/low reports/stock/value reports/cash/daily reports/cash/funds reports/tips reports/payroll/monthly reports/profit reports/reviews audit-events me/reviews/invoices/00000000-0000-4000-8000-000000000000; do
  expect "API $DUONG khi chua dang nhap" "$(http http://127.0.0.1:3001/api/v1/$DUONG)" "401"
done
expect "tep xuat can dang nhap va CSRF" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3001/api/v1/reports/export)" "403"
sleep 10
expect "bao cao khong tu ghi gi (so but toan so quy)" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
expect "chua co danh gia nao" "$(sqlq $DB "$EMPTY")" "0"
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "so lieu sau: $(sqlq $DB "$COUNTS") (mong doi 122|77)"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
)
```

## Sau khi khối chạy xong (Owner xem trên web)

1. Đăng nhập Owner: menu **Báo cáo** có 10 mục (Doanh thu, Chi tiết bán hàng, Hoàn tiền, Khách hàng, Hoạt động nhân viên, Báo cáo kho, Báo cáo quỹ, Báo cáo lương, Lãi tạm tính, Đánh giá của khách); **Quản trị → Nhật ký hoạt động** có mặt; Tổng quan có thêm các ô mới.
2. **Quản trị → Vai trò:** có 4 quyền mới, chưa gán cho vai trò nào. Gán `EXPORT_REPORTS` / `VIEW_STAFF_REPORTS` / `VIEW_REVIEWS` cho quản lý nào cần (`VIEW_PROFIT` chỉ Owner).
3. Quầy (POS) và vài trang cũ mở bình thường; "Bán online" như trước.
4. Làm theo `docs/OWNER_TEST_SCRIPT_PHASE8.md` (ngắn, khoảng 20 phút).

## Quay lại nếu có sự cố

**Đọc trước:** mọi migration chỉ **thêm**. Bản cũ `d42ab4e` chạy được trên cơ sở dữ liệu 122 migration: xem `docs/PHASE8_ROLLBACK_PROOF.md` (đã thử trên máy này, mục "Kết quả" nói rõ có phải xóa 4 hàng quyền mới hay không). Đánh giá của khách đã được gửi là **lịch sử**: quay lui chỉ làm chúng đứng yên, cơ sở dữ liệu không cho sửa hay xóa; bản mới đọc lại được.

**Cách A: quay về bản cũ `d42ab4e`, giữ cơ sở dữ liệu** (dán nguyên khối):

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=d42ab4e84814f4fb82c1e0de3c26a1c18ffe3a85
pm2 stop lucyspa-api lucyspa-worker
CODES="'EXPORT_REPORTS','VIEW_STAFF_REPORTS','VIEW_PROFIT','VIEW_REVIEWS'"
printf '%s\n' "delete from role_permissions where permission_id in (select id from permissions where code::text in ($CODES)); delete from user_permission_overrides where permission_id in (select id from permissions where code::text in ($CODES)); delete from permissions where code::text in ($CODES);" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_dev -At'
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pnpm db:permissions:sync
pm2 status
)
```

**Mong đợi:** ba tiến trình `online`; `Permission catalog synced: 0 inserted, 73 already present.`; `https://lucyspa.vn/vi` mở được. (4 quyền được thêm lại, vẫn chưa cấp cho ai, khi sau này triển khai lại bản mới.)

_Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.

**Cách B (chỉ khi cơ sở dữ liệu hỏng): khôi phục từ tệp sao lưu `lucyspa-pre-p8-….dump`.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất** (hóa đơn, thanh toán, đánh giá). **Hỏi Claude trước khi làm.**

## Báo lại cho Claude

Gửi các dòng cuối của khối ("XONG…": mã đang chạy, số liệu `122|77`, đường dẫn hai tệp sao lưu), các dòng thời gian migration và `pm2 status`. Claude ghi vào `LUCYSPA_HANDOFF.md`: commit, các migration đã áp, ngày giờ.
