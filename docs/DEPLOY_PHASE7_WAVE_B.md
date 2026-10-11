# Hướng dẫn đưa Phase 7 (sổ quỹ, tiền tour, hoa hồng, tip, mã nhân viên, bảng lương, tạm ứng) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng** (không chạy tiếp, không làm gì nguy hiểm). Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Khối này đưa cả Đợt A (sổ quỹ) và Đợt B (lương) lên một lần**, vì `handoff` chưa ghi Đợt A đã triển khai. Nếu Owner đã triển khai Đợt A bằng `docs/DEPLOY_PHASE7_WAVE_A.md` rồi, khối tự nhận ra (đang ở `110|73`) và chỉ làm phần của Đợt B. Đang ở số khác hai số đó: khối dừng.

**Bản sẽ cài:** commit `1cd8ffb48949a5d6a4ee3e328c49b296c015fb5e`, đã push lên `main`. Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `ac74013bb6a9ef681c7d4e306216de1a3565e639` (Phase 9, **108 migration, 68 quyền**) hoặc bản Đợt A `b11c21e09803cbd22c1789918b35664d5dea9b2f` (**110 migration, 73 quyền**).
**Cơ sở dữ liệu:** từ 108 lên **118 migration** (hoặc 110 lên 118), chỉ **thêm**: **19 bảng mới rỗng** (5 của sổ quỹ, 14 của lương và tip), vài giá trị kiểu mới, 5 giá trị quyền mới, **không đổi, không xóa dòng dữ liệu cũ nào**. Migration `20261203000000`, `20261208000000` và `20261209000000` (tip do khách chọn: thêm cột `payment_id` để trống vào `tips`) thêm khóa ngoại và một cột để trống vào bảng cũ (`pay_earnings`/`tips` đều rỗng, bảng công CTV thêm cột `pay_run_id` để trống).
**Tip:** chỉ do khách chọn khi thanh toán PayOS (tiền mặt không ghi vào hệ thống); chỉ hiện sau khi Chủ bắt đầu sổ quỹ. Xem `docs/PHASE7_PAYROLL_FUNDS.md` mục 15.
**Quyền:** 68 → **73**: `MANAGE_PAY_RULES`, `MANAGE_PAYROLL`, `APPROVE_PAYROLL`, `VIEW_CASH`, `MANAGE_CASH`. **Không cấp cho ai** (chỉ tài khoản Owner có sẵn mọi quyền). Sau triển khai Owner vào Quản trị → Vai trò để gán.
**Chưa có gì chạy sau khi triển khai:** chưa có ngày bắt đầu sổ quỹ và lương nên **không ghi gì**: không tour, không hoa hồng, không tip, không bảng lương. Chỉ khi Owner đếm tiền thật và bấm "Bắt đầu sổ quỹ" (`docs/OWNER_TEST_SCRIPT_PHASE7_A.md`) thì mọi thứ mới bắt đầu, **không nhập bù ngày cũ**. **Không có gì tự trả tiền**: chốt bảng lương, trả lương, chi tạm ứng đều do chính Owner bấm và nhập lại mật khẩu.
**Biến môi trường (`.env`) mới:** không có. Không đổi nginx, không có tiến trình pm2 mới, không có thư viện mới, worker **không** cần ra internet thêm. **Worker phải khởi động lại** (có hai việc mới, nằm im tới khi sổ quỹ bắt đầu). **"Bán online" không bị đụng tới**; ô "Mã nhân viên giới thiệu" ở trang thanh toán đơn online chỉ có tác dụng sau khi Owner tạo mã.
**Thời gian:** khoảng 30 phút. Trong lúc áp migration API và worker **dừng khoảng 1 đến 2 phút**: POS tạm gián đoạn; báo nhân viên trước.

## Trước khi dán

- Trên GitHub, tab **Actions**, commit `1cd8ffb48949a5d6a4ee3e328c49b296c015fb5e` có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- Báo nhân viên thu tiền ở quầy: tạm dừng khoảng 5 phút.

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=1cd8ffb48949a5d6a4ee3e328c49b296c015fb5e
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
TABLES="select count(*) from information_schema.tables where table_schema='public' and table_name in ('finance_go_live','reauth_uses','cash_funds','fund_entries','cash_day_closings','employee_salary_versions','tour_rules','commission_rules','pay_earnings','pay_seller_overrides','tips','employee_referral_codes','order_referrals','pay_runs','pay_run_lines','pay_run_items','salary_advances','payslips','payment_tip_pledges')"
EMPTY="select (select count(*) from tour_rules)+(select count(*) from commission_rules)+(select count(*) from employee_salary_versions)+(select count(*) from pay_earnings)+(select count(*) from tips)+(select count(*) from employee_referral_codes)+(select count(*) from order_referrals)+(select count(*) from pay_runs)+(select count(*) from salary_advances)+(select count(*) from payslips)+(select count(*) from payment_tip_pledges)"
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
echo "=== 0. Dieu kien ==="
START=$(sqlq $DB "$COUNTS")
case "$START" in
  "108|68") OLD=ac74013bb6a9ef681c7d4e306216de1a3565e639; TABLES_BEFORE=0; NEWPERM="5 inserted, 68 already present";;
  "110|73") OLD=b11c21e09803cbd22c1789918b35664d5dea9b2f; TABLES_BEFORE=5; NEWPERM="0 inserted, 73 already present";;
  *) dung "migration va quyen truoc la '$START', chi chap nhan 108|68 hoac 110|73";;
esac
echo "OK  diem xuat phat: $START (ban dang chay phai la $OLD)"
expect "ma dang chay" "$(git rev-parse HEAD)" "$OLD"
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
expect "web online" "$(count_online lucyspa-web)" "3"
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 2 ] || dung "o dia con $FREE GB, can it nhat 2 GB"
echo "OK  o dia con trong: $FREE GB"
expect "so bang moi truoc" "$(sqlq $DB "$TABLES")" "$TABLES_BEFORE"
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
PRODUCTS_BEFORE=$(sqlq $DB "select count(*) from products")
echo "Ghi lai: nguoi dung=$USERS_BEFORE hoa don=$INVOICES_BEFORE san pham=$PRODUCTS_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-p7-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-p7-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp loi"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "sao luu doc ra chi $LISTED dong"
echo "OK  sao luu co so du lieu: $BACKUP ($LISTED dong)"
WEBBACKUP=/root/backups/lucyspa-web-pre-p7-$STAMP.tar.gz
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
echo "$SYNC" | grep -q "$NEWPERM" || dung "danh muc quyen tren ban tam khong phai '$NEWPERM'"
unset DATABASE_URL
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
expect "ban tam: migration va quyen" "$(sqlq $SCRATCH "$COUNTS")" "118|73"
expect "ban tam: 19 bang moi" "$(sqlq $SCRATCH "$TABLES")" "19"
expect "ban tam: 14 bang cua dot B deu rong" "$(sqlq $SCRATCH "$EMPTY")" "0"
expect "ban tam: so nguoi dung giu nguyen" "$(sqlq $SCRATCH "select count(*) from users")" "$USERS_BEFORE"
expect "ban tam: so hoa don giu nguyen" "$(sqlq $SCRATCH "select count(*) from invoices")" "$INVOICES_BEFORE"
echo "Thoi gian tung migration tren ban tam (gui Claude):"
sqlq $SCRATCH "select migration_name||' '||round(extract(epoch from finished_at - started_at)::numeric, 3)||' giay' from _prisma_migrations where migration_name >= '20261201' order by migration_name"
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
echo "$SYNC" | grep -q "$NEWPERM" || dung "danh muc quyen that khong phai '$NEWPERM'"
expect "migration va quyen sau" "$(sqlq $DB "$COUNTS")" "118|73"
expect "19 bang moi co mat" "$(sqlq $DB "$TABLES")" "19"
expect "14 bang cua dot B deu rong" "$(sqlq $DB "$EMPTY")" "0"
if [ "$TABLES_BEFORE" = "0" ]; then
  expect "so quy chua bat dau (cash_funds)" "$(sqlq $DB "select count(*) from cash_funds")" "0"
  expect "so quy chua bat dau (finance_go_live)" "$(sqlq $DB "select count(*) from finance_go_live")" "0"
fi
if [ "$TABLES_BEFORE" = "0" ]; then
  expect "quyen moi chua cap cho ai" "$(sqlq $DB "select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code in ('MANAGE_PAY_RULES','MANAGE_PAYROLL','APPROVE_PAYROLL','VIEW_CASH','MANAGE_CASH')")" "0"
fi
expect "so nguoi dung giu nguyen" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "so hoa don giu nguyen" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "so san pham giu nguyen" "$(sqlq $DB "select count(*) from products")" "$PRODUCTS_BEFORE"
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
for TRANG in cash pay payroll advances my-payslips; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
for DUONG in cash/overview pay/tour-rules pay/commission-rules pay/salaries pay/referral-codes pay/runs pay/advances me/payslips; do
  expect "API $DUONG khi chua dang nhap" "$(http http://127.0.0.1:3001/api/v1/$DUONG)" "401"
done
sleep 10
if [ "$(sqlq $DB "select count(*) from finance_go_live")" = "0" ]; then
  expect "worker khong tu ghi gi khi so quy chua bat dau (pay_earnings)" "$(sqlq $DB "select count(*) from pay_earnings")" "0"
  expect "worker khong tu ghi gi khi so quy chua bat dau (fund_entries)" "$(sqlq $DB "select count(*) from fund_entries")" "0"
fi
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "so lieu sau: $(sqlq $DB "$COUNTS") (mong doi 118|73)"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
)
```

## Sau khi khối chạy xong (Owner xem trên web, chỉ để xem)

1. Đăng nhập Owner: menu **Thanh toán → Sổ quỹ** (chưa bắt đầu; **đừng bấm** "Bắt đầu sổ quỹ" trong lúc triển khai), **Nhân sự → Lương và hoa hồng**, **Bảng lương**, **Tạm ứng lương** có mặt và trống.
2. **Quản trị → Vai trò:** có 5 quyền mới, chưa gán cho vai trò nào.
3. Quầy (POS) và vài trang cũ mở bình thường; "Bán online" như trước.
4. Khi sẵn sàng bắt đầu dùng thật: làm theo `docs/OWNER_TEST_SCRIPT_PHASE7_A.md` (sổ quỹ) rồi `docs/OWNER_TEST_SCRIPT_PHASE7_B.md` (lương).

## Quay lại nếu có sự cố

**Đọc trước:** mọi migration chỉ **thêm**. Bản cũ chạy được trên cơ sở dữ liệu 118 migration **sau khi xóa 5 hàng quyền mới** nếu bản cũ là Phase 9 (`ac74013`); nếu bản cũ là Đợt A (`b11c21e`) thì **không cần xóa gì** (đã thử: `docs/PHASE7_WAVE_B_ROLLBACK_PROOF.md`; Phase 9 trên 110 migration đã thử ở `docs/PHASE7_WAVE_A_ROLLBACK_PROOF.md`, 7 migration sau chỉ thêm bảng nên cùng kết luận, **chưa thử riêng** Phase 9 trên 117). Nếu sổ quỹ hoặc bảng lương **đã bắt đầu**, quay lại chỉ làm chúng đứng yên; dữ liệu vẫn nguyên.

**Cách A1: quay về Phase 9 (`ac74013`), giữ cơ sở dữ liệu** (dán nguyên khối):

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=ac74013bb6a9ef681c7d4e306216de1a3565e639
pm2 stop lucyspa-api lucyspa-worker
CODES="'MANAGE_PAY_RULES','MANAGE_PAYROLL','APPROVE_PAYROLL','VIEW_CASH','MANAGE_CASH'"
printf '%s\n' "delete from role_permissions where permission_id in (select id from permissions where code in ($CODES)); delete from user_permission_overrides where permission_id in (select id from permissions where code in ($CODES)); delete from permissions where code in ($CODES);" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_dev -At'
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pnpm db:permissions:sync
pm2 status
)
```

**Mong đợi:** ba tiến trình `online`; `Permission catalog synced: 0 inserted, 68 already present.`; `https://lucyspa.vn/vi` mở được.

**Cách A2: quay về Đợt A (`b11c21e`), giữ cơ sở dữ liệu** (chỉ khi trước đó đang chạy Đợt A): như A1 nhưng **bỏ dòng `CODES=` và dòng `printf`**, đặt `OLD=b11c21e09803cbd22c1789918b35664d5dea9b2f`; mong đợi `0 inserted, 73 already present.`

_Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.

**Cách B (chỉ khi cơ sở dữ liệu hỏng): khôi phục từ tệp sao lưu `lucyspa-pre-p7-….dump`.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất.** **Hỏi Claude trước khi làm.**

## Báo lại cho Claude

Gửi các dòng cuối của khối ("XONG…": mã đang chạy, số liệu `118|73`, đường dẫn hai tệp sao lưu), các dòng thời gian migration và `pm2 status`. Claude ghi vào `LUCYSPA_HANDOFF.md`: commit, các migration đã áp, ngày giờ.
