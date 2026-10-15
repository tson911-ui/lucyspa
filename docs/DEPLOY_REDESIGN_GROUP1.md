# Hướng dẫn đưa nhóm 1 của đợt thiết kế lại (trang khách theo DESIGN.md, trang thông tin và chính sách, hồ sơ khách) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng**. Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Chưa cài gì cho đến khi Owner duyệt bước C18** (ảnh trước/sau trong `.local/uxui-screens/group1-session8/`). Nhóm 1 chỉ đưa lên **một lần**. Tệp này chưa phải lệnh đã chạy.

**Bản sẽ cài:** commit `__COMMIT_DA_PUSH__` _(Claude điền mã đầy đủ 40 ký tự vào đây và vào dòng `NEW=` trong khối lệnh ngay khi đẩy lên `main` và CI xanh; khối **từ chối chạy** khi dòng `NEW=` còn là `__COMMIT_DA_PUSH__`)_. Các commit tài liệu đẩy sau đó không đổi mã chạy.
**Bản đang chạy (theo báo cáo của Owner):** `04ceaa52fbbdc4ca310a540d53db3aaf336312c1` (**134 migration, 82 quyền**).
**Cơ sở dữ liệu:** từ 134 lên **137 migration**, chỉ **thêm**:

1. `20261214000000_redesign_service_content_photos`: 7 cột mới có thể để trống ở `services` (chữ "gồm những gì", "các bước", "câu hỏi thường gặp" mỗi thứ hai ngôn ngữ, và ảnh), 1 cột ảnh ở `service_categories` và 1 ở `product_categories` (khóa tới thư viện ảnh, không cho xóa ảnh đang dùng), 3 chỉ mục. **Không đổi dòng cũ nào.**
2. `20261215000000_customer_email_change_guard`: thay **một hàm** bảo vệ (`lucy_guard_auth_challenge`) để khách có tài khoản cũng đổi được email đăng nhập bằng mật khẩu hiện tại và mã gửi tới email mới (Owner đã duyệt 15/10/2026). Không đổi bảng hay dòng nào.
3. `20261215000001_website_info_pages`: bảng mới rỗng `website_pages` (trang thông tin: tiêu đề, nội dung, loại, xuất bản), một kiểu liệt kê mới `WebsitePageRole`, và một quy tắc ở cơ sở dữ liệu: **chỉ một** trang "Điều khoản" và **một** trang "Bảo mật" được xuất bản cùng lúc.

**Quyền:** **không đổi, vẫn 82** (quản lý trang thông tin dùng quyền sẵn có `MANAGE_WEBSITE_CONTENT`). Khối kiểm tra số quyền trước và sau.
**Điều gì đổi với người dùng:**

- **Mọi trang khách** theo kiểu mới của `DESIGN.md` (chữ Be Vietnam Pro, nền trắng và xám nhạt, không bóng đổ, nút viên thuốc, chân trang mới, thanh dưới trên điện thoại, chuyển động mềm). Chức năng, giá, đơn hàng, điểm thưởng **không đổi**. Màn hình nhân viên và quầy **không đổi giao diện** (chỉ thêm mục bên dưới).
- **Tám trang chính sách do Owner viết** (Điều khoản sử dụng, thanh toán, giao hàng, đổi trả và hoàn tiền, bảo mật, đặt lịch, thành viên và điểm thưởng, tiếp nhận khiếu nại) hiện ở cột **Chính sách** của chân trang; hai trang Điều khoản và Bảo mật còn nằm ở dòng pháp lý dưới cùng ("Điều khoản sử dụng · Chính sách bảo mật"). Các trang này được **nhập bằng một lệnh chạy một lần** ở cuối khối (bước 8), chữ lấy từ `docs/policies.md`, không sửa một chữ nào.
- Trang **Liên hệ** (`/vi/contact`) có bản đồ; trang **Hồ sơ** của khách (`/vi/account/profile`): sửa tên, đổi email đăng nhập (mật khẩu hiện tại, rồi mã gửi tới email mới); ngày sinh chỉ xem, muốn sửa liên hệ tiệm.
- **Quản trị → Website:** tab mới **Trang thông tin** (tạo, sửa, xem trước, xuất bản, gỡ xuống; không xóa) và mục **Ảnh** cùng ba khung chữ (gồm những gì, các bước, câu hỏi thường gặp) trong form dịch vụ; ô **Ảnh** trong form nhóm dịch vụ và danh mục mỹ phẩm. Khung nào để trống thì trang khách **tự ẩn** phần đó.
  **Biến môi trường (`.env`):** **không bắt buộc đổi gì.** Đổi email của khách dùng đúng khóa mã và khóa gửi thư đã có cho nhân viên. Thư viện mới: `gsap 3.15.0` (chuyển động; miễn phí cho cả dùng thương mại), cài bởi `pnpm install --frozen-lockfile` trong khối. Không có tiến trình pm2 mới, không đổi nginx.
  **Thời gian:** khoảng 30 phút (build web chiếm nhiều nhất). Trong lúc áp migration API và worker **dừng khoảng 1 đến 2 phút**: POS tạm gián đoạn; báo nhân viên trước. Trang khách báo lỗi ngắn trong lúc tải lại web.

## Trước khi dán

- Owner đã duyệt bước C18 (ảnh trước/sau) và nói rõ cho Claude **được đẩy lên**.
- Trên GitHub, tab **Actions**, commit nói ở trên có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- Báo nhân viên thu tiền ở quầy: tạm dừng khoảng 5 phút.
- **Trong lúc khối chạy không bấm Lưu hay Xuất bản** ở trang Website.

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=__COMMIT_DA_PUSH__
OLD=04ceaa52fbbdc4ca310a540d53db3aaf336312c1
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
case "$NEW" in __*) dung "dong NEW= chua duoc dien ma commit that (Claude dien sau khi day len main)";; esac
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: duoc '$2', mong doi tu '$3' tro len"; echo "OK  $1: $2 (>= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
field() { printf '%s\n' "$1" | sed -n "s/.*$2=\([0-9]*\).*/\1/p" | tail -n 1; }
summary() { printf '%s\n' "$1" | grep '^created=' | tail -n 1; }
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
COLS="select count(*) from information_schema.columns where table_schema='public' and ((table_name='services' and column_name in ('included_vi','included_en','steps_vi','steps_en','faq_vi','faq_en','photo_media_id')) or (table_name in ('service_categories','product_categories') and column_name='photo_media_id'))"
PAGES_TABLE="select count(*) from information_schema.tables where table_schema='public' and table_name='website_pages'"
PAGES_ROWS="select count(*) from website_pages"
PAGE_ROLES="select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'WebsitePageRole'"
LEGAL_INDEX="select count(*) from pg_indexes where schemaname='public' and indexname='website_pages_published_legal_key'"
GUARD_NEW="select coalesce((select (prosrc like '%since session 7b%')::text from pg_proc where proname='lucy_guard_auth_challenge'), 'khong co ham')"
PUBLISHED="select count(*)||'|'||count(*) filter (where role::text='TERMS')||'|'||count(*) filter (where role::text='PRIVACY')||'|'||count(*) filter (where role::text='POLICY')||'|'||count(*) filter (where title_en is not null or body_en is not null) from website_pages where is_published"
SLUGS="select string_agg(slug, ',' order by slug collate \"C\") from website_pages"
SLUGS_WANT="chinh-sach-bao-mat,chinh-sach-dat-lich,chinh-sach-doi-tra-hoan-tien,chinh-sach-giao-hang,chinh-sach-thanh-toan,chinh-sach-thanh-vien-diem-thuong,dieu-khoan-su-dung,tiep-nhan-khieu-nai"
SERVICE_TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,''), '#' order by id::text)) from services"
TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products"
echo "=== 0. Dieu kien ==="
expect "migration va quyen truoc" "$(sqlq $DB "$COUNTS")" "134|82"
expect "ma dang chay" "$(git rev-parse HEAD)" "$OLD"
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
expect "chua co cot moi" "$(sqlq $DB "$COLS")" "0"
expect "chua co bang trang thong tin" "$(sqlq $DB "$PAGES_TABLE")" "0"
expect "ham bao ve chua doi" "$(sqlq $DB "$GUARD_NEW")" "false"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 3 ] || dung "o dia con $FREE GB, can it nhat 3 GB"
echo "OK  o dia con trong: $FREE GB"
SERVICE_TEXTS_BEFORE=$(sqlq $DB "$SERVICE_TEXTS")
TEXTS_BEFORE=$(sqlq $DB "$TEXTS")
SERVICES_BEFORE=$(sqlq $DB "select count(*) from services")
PRODUCTS_BEFORE=$(sqlq $DB "select count(*) from products")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
CUSTOMERS_BEFORE=$(sqlq $DB "select count(*) from users where kind::text='CUSTOMER'")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")
FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
echo "Ghi lai: nguoi dung=$USERS_BEFORE (khach=$CUSTOMERS_BEFORE) hoa don=$INVOICES_BEFORE thanh toan=$PAYMENTS_BEFORE dich vu=$SERVICES_BEFORE san pham=$PRODUCTS_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-nhom1-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-nhom1-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp loi"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "sao luu doc ra chi $LISTED dong"
echo "OK  sao luu co so du lieu: $BACKUP ($LISTED dong)"
WEBBACKUP=/root/backups/lucyspa-web-pre-nhom1-$STAMP.tar.gz
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
expect "co tep chinh sach cua Owner" "$(test -f docs/policies.md && echo co)" "co"
expect "co lenh nhap chinh sach" "$(test -f apps/api/dist/website/policy-pages.cli.js && echo co)" "co"
expect "co lenh nhap chinh sach trong package.json" "$(grep -c 'pages:import-policies' apps/api/package.json)" "1"
expect "co thu vien chuyen dong" "$(test -d node_modules/.pnpm && ls node_modules/.pnpm | grep -c '^gsap@3.15.0')" "1"
echo "=== 3. Dien tap tren ban khoi phuc cua co so du lieu that ==="
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong tao duoc co so du lieu tam"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore vao co so du lieu tam loi"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "lenh tu choi ten co so du lieu tam"
expect "dang tro vao co so du lieu tam" "${DATABASE_URL##*/}" "$SCRATCH"
pnpm db:deploy || dung "db:deploy tren ban tam loi"
SYNC=$(pnpm db:permissions:sync 2>&1); echo "$SYNC" | tail -n 1
echo "$SYNC" | grep -q "0 inserted, 82 already present" || dung "danh muc quyen tren ban tam khong phai '0 inserted, 82 already present'"
echo "--- nhap thu tam trang chinh sach tren ban tam (chay thu, ghi, ghi lan hai) ---"
DRY=$(pnpm --filter @lucy-spa/api run pages:import-policies 2>&1) || { echo "$DRY" | tail -n 20; dung "nhap thu (chay thu) tren ban tam loi"; }
echo "$DRY" | grep -v -i "deprecat\|trace-deprecation" | tail -n 11
echo "$DRY" | grep -q "database=$SCRATCH " || dung "lenh nhap khong tro vao co so du lieu tam (xem dong database=)"
expect "ban tam: chay thu thay 8 trang se tao" "$(field "$(summary "$DRY")" wouldCreate)" "8"
APPLY=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$APPLY" | tail -n 20; dung "nhap that tren ban tam loi"; }
expect "ban tam: da tao 8 trang" "$(field "$(summary "$APPLY")" created)" "8"
AGAIN=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$AGAIN" | tail -n 20; dung "nhap lan hai tren ban tam loi"; }
expect "ban tam: chay lai khong tao them, bo qua 8" "$(field "$(summary "$AGAIN")" exists)" "8"
unset DATABASE_URL
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "ban tam: migration va quyen" "$(sqlq $SCRATCH "$COUNTS")" "137|82"
expect "ban tam: 9 cot moi" "$(sqlq $SCRATCH "$COLS")" "9"
expect "ban tam: bang trang thong tin" "$(sqlq $SCRATCH "$PAGES_TABLE")" "1"
expect "ban tam: 4 loai trang" "$(sqlq $SCRATCH "$PAGE_ROLES")" "4"
expect "ban tam: quy tac mot dieu khoan, mot bao mat" "$(sqlq $SCRATCH "$LEGAL_INDEX")" "1"
expect "ban tam: ham bao ve da doi" "$(sqlq $SCRATCH "$GUARD_NEW")" "true"
expect "ban tam: 8 trang da xuat ban (1 dieu khoan, 1 bao mat, 6 chinh sach, khong co ban tieng Anh)" "$(sqlq $SCRATCH "$PUBLISHED")" "8|1|1|6|0"
expect "ban tam: dung 8 dia chi" "$(sqlq $SCRATCH "$SLUGS")" "$SLUGS_WANT"
expect "ban tam: chu dich vu khong doi" "$(sqlq $SCRATCH "$SERVICE_TEXTS")" "$SERVICE_TEXTS_BEFORE"
expect "ban tam: chu san pham khong doi" "$(sqlq $SCRATCH "$TEXTS")" "$TEXTS_BEFORE"
expect "ban tam: so nguoi dung giu nguyen" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "ban tam: so hoa don giu nguyen" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "ban tam: so thanh toan giu nguyen" "$(sqlq $SCRATCH "select count(*) from payments")" "$PAYMENTS_BEFORE"
echo "Thoi gian tung migration tren ban tam (gui Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' giay' from _prisma_migrations where migration_name >= '20261214' order by migration_name"
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
echo "$SYNC" | grep -q "0 inserted, 82 already present" || dung "danh muc quyen that khong phai '0 inserted, 82 already present'"
expect "migration va quyen sau" "$(sqlq $DB "$COUNTS")" "137|82"
expect "9 cot moi" "$(sqlq $DB "$COLS")" "9"
expect "bang trang thong tin rong" "$(sqlq $DB "$PAGES_ROWS")" "0"
expect "4 loai trang" "$(sqlq $DB "$PAGE_ROLES")" "4"
expect "quy tac mot dieu khoan, mot bao mat" "$(sqlq $DB "$LEGAL_INDEX")" "1"
expect "ham bao ve da doi" "$(sqlq $DB "$GUARD_NEW")" "true"
expect "chu dich vu khong doi" "$(sqlq $DB "$SERVICE_TEXTS")" "$SERVICE_TEXTS_BEFORE"
expect "chu san pham khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
expect "so dich vu giu nguyen" "$(sqlq $DB "select count(*) from services")" "$SERVICES_BEFORE"
expect "so san pham giu nguyen" "$(sqlq $DB "select count(*) from products")" "$PRODUCTS_BEFORE"
expect "so nguoi dung giu nguyen" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "so khach giu nguyen" "$(sqlq $DB "select count(*) from users where kind::text='CUSTOMER'")" "$CUSTOMERS_BEFORE"
expect "so hoa don giu nguyen" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "so thanh toan giu nguyen" "$(sqlq $DB "select count(*) from payments")" "$PAYMENTS_BEFORE"
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
for TRANG in "" services products contact account/login account/register; do
  expect "trang /vi/$TRANG" "$(http http://127.0.0.1:3000/vi/$TRANG)" "200"
done
expect "dang nhap nhan vien" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for TRANG in website products services; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
expect "chua nhap chinh sach: /vi/dieu-khoan-su-dung la 404" "$(http http://127.0.0.1:3000/vi/dieu-khoan-su-dung)" "404"
expect "API trang thong tin cong khai: danh sach rong" "$(curl -s http://127.0.0.1:3001/api/v1/public/pages | grep -c '"items":\[\]')" "1"
for DUONG in website/pages me/profile; do
  expect "API $DUONG khi chua dang nhap" "$(http "http://127.0.0.1:3001/api/v1/$DUONG")" "401"
done
expect "lenh ghi can dang nhap va CSRF" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3001/api/v1/website/pages)" "403"
echo "=== 7. Nhap tam trang chinh sach cua Owner vao co so du lieu that ==="
expect "khong co DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
DRY=$(pnpm --filter @lucy-spa/api run pages:import-policies 2>&1) || { echo "$DRY" | tail -n 20; dung "nhap thu (chay thu) loi"; }
echo "$DRY" | grep -v -i "deprecat\|trace-deprecation" | tail -n 11
echo "$DRY" | grep -q "database=$DB " || dung "lenh nhap khong tro vao co so du lieu that (xem dong database=)"
expect "chay thu: 8 trang se tao, khong trang nao co san, khong bi chan" "$(summary "$DRY")" "created=0 wouldCreate=8 exists=0 blocked=0"
APPLY=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$APPLY" | tail -n 20; dung "nhap that loi (khong trang nao duoc tao: ca 8 trang cung mot giao dich)"; }
echo "$APPLY" | grep -v -i "deprecat\|trace-deprecation" | tail -n 11
expect "da tao 8 trang" "$(summary "$APPLY")" "created=8 wouldCreate=0 exists=0 blocked=0"
expect "8 trang da xuat ban (1 dieu khoan, 1 bao mat, 6 chinh sach, khong co ban tieng Anh)" "$(sqlq $DB "$PUBLISHED")" "8|1|1|6|0"
expect "dung 8 dia chi" "$(sqlq $DB "$SLUGS")" "$SLUGS_WANT"
expect "nhat ky: 8 dong tao trang" "$(sqlq $DB "select count(*) from audit_events where action = 'PAGE_CREATED_PUBLISHED'")" "8"
AGAIN=$(pnpm --filter @lucy-spa/api run pages:import-policies --apply 2>&1) || { echo "$AGAIN" | tail -n 20; dung "nhap lan hai loi"; }
expect "chay lai khong lam gi: bo qua 8" "$(summary "$AGAIN")" "created=0 wouldCreate=0 exists=8 blocked=0"
echo "--- doi toi 3 phut cho bo nho tam cua API va web (mot den hai phut) ---"
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
expect "8 trang chinh sach mo duoc (200)" "$OK" "8"
at_least "chan trang co lien ket toi chinh sach giao hang" "$FOOT" 1
expect "trang chinh sach tieng Anh hien chu tieng Viet" "$(http http://127.0.0.1:3000/en/chinh-sach-giao-hang)" "200"
expect "API trang thong tin cong khai: 8 trang" "$(curl -s http://127.0.0.1:3001/api/v1/public/pages | grep -o '"slug"' | wc -l | tr -d ' ')" "8"
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "so lieu: $(sqlq $DB "$COUNTS") (mong doi 137|82)"
echo "trang thong tin: $(sqlq $DB "$PUBLISHED") (mong doi 8|1|1|6|0)"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
)
```

## Sau khi khối chạy xong (Owner xem trên web)

1. **Trang khách** (điện thoại và máy tính): trang chủ, Dịch vụ, một dịch vụ, Mỹ phẩm, một sản phẩm, giỏ hàng, đặt lịch, đăng nhập, tài khoản. Bật chế độ tối bằng nút giao diện ở đầu trang. Chuyển động mềm; nếu máy bật "giảm chuyển động" thì trang đứng yên.
2. **Chân trang:** cột **Chính sách** có tám liên kết; dòng dưới cùng có "Điều khoản sử dụng · Chính sách bảo mật". Mở thử từng trang, kể cả bảng ở trang "Chính sách đổi trả và hoàn tiền" và "Chính sách thành viên và điểm thưởng" (trên điện thoại mỗi dòng bảng thành một khối).
3. **Liên hệ** (`/vi/contact`): bản đồ, giờ mở cửa, ba nút "Gọi ngay", "Nhắn Zalo", "Nhắn Messenger".
4. **Hồ sơ** (đăng nhập bằng tài khoản khách → Hồ sơ): sửa tên; đổi email thử bằng một email của Owner (mật khẩu hiện tại, rồi mã gửi tới email mới; cần worker gửi thư đang chạy).
5. **Quản trị → Website → Trang thông tin:** thấy tám trang đã xuất bản. Sửa chữ thì bấm **Xem trước**, rồi **Lưu**; trang khách đổi sau khoảng **một đến hai phút**. **Quản trị → Website → Dịch vụ:** mở một dịch vụ, mục **Ảnh** và ba khung "gồm những gì", "các bước", "câu hỏi thường gặp" đang trống (trang khách ẩn phần đó cho đến khi có chữ); chưa có ảnh nào nên trang khách vẫn dùng khung xám thay ảnh.
6. Ảnh nên chụp thêm cho tiệm (khung xám sẽ đổi thành ảnh thật): xem danh sách trong `docs/CUSTOMER_SITE_C.md` (mục ảnh) và các khung ảnh trong báo cáo `docs/REDESIGN_GROUP1_S8_REPORT.md`.

## Quay lại nếu có sự cố

Ba migration chỉ **thêm** (cột và bảng mới, một hàm bảo vệ nới ra cho khách đổi email) nên **không cần xóa gì** ở cơ sở dữ liệu: bản cũ bỏ qua cột và bảng mới, không dùng đường đổi email của khách, và số quyền **không đổi** (82). Chỉ cần đổi lại bản chạy.

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=04ceaa52fbbdc4ca310a540d53db3aaf336312c1
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
curl -s -o /dev/null -w 'trang chu: %{http_code}\n' http://127.0.0.1:3000/vi
)
```

**Mong đợi:** ba tiến trình `online`, trang chủ `200`; trang khách trở về kiểu cũ; tám trang chính sách không còn mở được (bản cũ không có đường dẫn đó) nhưng **vẫn nằm trong cơ sở dữ liệu**, nên sau này cài lại không cần nhập lại. _Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`. Muốn trả cả hàm bảo vệ về như cũ (không cần để chạy bản cũ): nội dung hàm cũ nằm ở `packages/database/prisma/migrations/20261003000001_auth_challenge_change_email_guard/migration.sql`.
