# Hướng dẫn cập nhật cách AI viết lại sản phẩm (bản 2) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng**. Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Bản sẽ cài:** commit `c6b85ecc99e2636c459b35cc1a2240be89142a5a`, đã push lên `main`. Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `7e194b338c944a8b30160c051fdf022a0d424f5f` (**127 migration, 79 quyền**).
**Điều gì đổi:** (1) Mục **"Phù hợp với ai"** luôn được điền: nếu nhà cung cấp không nêu loại da, AI viết một câu chung, thận trọng, chỉ suy ra từ loại sản phẩm và công dụng đã nêu (không nói bệnh lý da, không hứa hẹn, không bịa loại da trái với nguồn). Màn hình duyệt ghi rõ **"suy luận từ loại sản phẩm"** trong khung "AI ghi chú". (2) "AI ghi chú" (đã giữ gì, chưa chắc gì) viết **bằng tiếng Việt** và chỉ người duyệt thấy, **không bao giờ hiện trên trang khách** (có kiểm tra tự động). (3) Kiểm tra **thành phần** không còn báo nhầm khi thành phần có trong danh sách của nhà cung cấp (tên tiếng Việt hay tiếng Anh, có dấu hay không dấu, ví dụ natri hyaluronate, oligopeptide); thành phần thật sự không có trong nguồn vẫn bị báo. (4) Ô **"Dùng tên gợi ý"** luôn **tắt** lúc đầu; không tích thì giữ nguyên tên chính thức, và tên gợi ý không làm khóa nút Áp dụng.
**Ba bản nháp đã có không đổi.** Owner áp dụng như bình thường; muốn có câu "Phù hợp với ai" mới thì bấm **Viết lại bản nháp** ở bản đó sau khi cập nhật.
**Không có migration, không đổi quyền, không có thư viện mới, không đổi `.env`, không đổi nginx.** Số migration phải giữ **127**, số quyền **79**. API và worker khởi động lại khoảng 10 giây (POS tạm gián đoạn ngắn); web nạp lại lần lượt. **Thời gian:** khoảng 10 phút.

## Trước khi dán

- Trên GitHub, tab **Actions**, commit `c6b85ecc99e2636c459b35cc1a2240be89142a5a` có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- Không có bản nháp nào đang được viết (trang **Viết lại nội dung** không có dòng "Đang chờ" hoặc "Đang viết"; nếu có, đợi xong).

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=c6b85ecc99e2636c459b35cc1a2240be89142a5a
OLD=7e194b338c944a8b30160c051fdf022a0d424f5f
DB=lucy_spa_dev
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,''), '#' order by id::text)) from products"
SETTINGS="select enabled::text||'|'||rewrite_enabled::text||'|'||coalesce(vnd_per_usd::text,'null')||'|'||monthly_cap_vnd::text||'|'||allow_authenticity_claims::text||'|'||concurrency::text||'|'||rewrite_model from ai_settings"
AI_ROWS="select (select count(*) from ai_runs)||'|'||(select count(*) from ai_items)||'|'||(select count(*) from ai_usage_ledger)||'|'||(select count(*) from ai_items where status='APPLIED')"
echo "=== 0. Dieu kien ==="
expect "migration va quyen truoc" "$(sqlq $DB "$COUNTS")" "127|79"
expect "ma dang chay" "$(git rev-parse HEAD)" "$OLD"
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
expect "web online" "$(count_online lucyspa-web)" "3"
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
expect "khong ban nhap nao dang cho hoac dang viet" "$(sqlq $DB "select count(*) from ai_items where status in ('QUEUED','GENERATING')")" "0"
expect "khong lan chay nao dang mo" "$(sqlq $DB "select count(*) from ai_runs where status in ('QUEUED','RUNNING')")" "0"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 2 ] || dung "o dia con $FREE GB, can it nhat 2 GB"
echo "OK  o dia con trong: $FREE GB"
TEXTS_BEFORE=$(sqlq $DB "$TEXTS")
SETTINGS_BEFORE=$(sqlq $DB "$SETTINGS")
AI_BEFORE=$(sqlq $DB "$AI_ROWS")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
echo "Ghi lai: cai dat AI=$SETTINGS_BEFORE | ai_runs/ai_items/so chi tieu/da ap dung=$AI_BEFORE | nguoi dung=$USERS_BEFORE hoa don=$INVOICES_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu (chu cua san pham co the da duoc ap dung tu ban nhap) ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-viet-lai-v2-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-rewrite-v2-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
echo "OK  sao luu co so du lieu: $BACKUP"
WEBBACKUP=/root/backups/lucyspa-web-pre-rewrite-v2-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "khong nen duoc ban web"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "ban sao luu web qua nho"
echo "OK  sao luu web: $WEBBACKUP"
echo "=== 2. Lay ban moi, cai, build (chua khoi dong lai gi) ==="
git fetch origin || dung "git fetch loi"
git checkout "$NEW" || dung "git checkout loi"
expect "ma moi" "$(git rev-parse HEAD)" "$NEW"
pnpm install --frozen-lockfile || dung "pnpm install loi (phan mem dang chay chua bi dung toi)"
pnpm db:generate || dung "db:generate loi"
pnpm build || dung "pnpm build loi (neu trang web bao loi: xem phan Quay lai)"
expect "ban moi da co loi nhac viet lai v2" "$(grep -c "product-rewrite.v2" packages/server/dist/ai/product-rewrite.js)" "1"
expect "cong thuc moi co muc 'Phu hop voi ai' luon duoc viet" "$(grep -c "WHO IT SUITS" packages/server/dist/ai/product-rewrite.js)" "1"
echo "=== 3. Khoi dong lai (khong co migration) ==="
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
echo "=== 4. Kiem tra bang lenh (khong tao hay sua du lieu that) ==="
expect "migration va quyen sau (khong doi)" "$(sqlq $DB "$COUNTS")" "127|79"
expect "chu cua san pham khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_BEFORE"
expect "cai dat AI khong doi" "$(sqlq $DB "$SETTINGS")" "$SETTINGS_BEFORE"
expect "ban nhap, lan chay, chi tieu khong doi" "$(sqlq $DB "$AI_ROWS")" "$AI_BEFORE"
expect "so nguoi dung giu nguyen" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "so hoa don giu nguyen" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "but toan so quy giu nguyen" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
expect "ban online khong bi doi" "$(sqlq $DB "select enabled from online_sales_settings")" "$ONLINE_BEFORE"
expect "suc khoe" "$(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')" "1"
expect "trang chu /vi" "$(http http://127.0.0.1:3000/vi)" "200"
expect "my pham" "$(http http://127.0.0.1:3000/vi/products)" "200"
expect "dang nhap nhan vien" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for TRANG in product-rewrites ai-settings product-text-cleanup; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
for DUONG in ai/settings ai/product-drafts ai/product-runs; do
  expect "API $DUONG khi chua dang nhap" "$(http "http://127.0.0.1:3001/api/v1/$DUONG")" "401"
done
sleep 10
expect "sau 10 giay van khong co lan chay nao tu bat dau" "$(sqlq $DB "$AI_ROWS")" "$AI_BEFORE"
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "so lieu: $(sqlq $DB "$COUNTS") (mong doi 127|79)"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
)
```

## Sau khi khối chạy xong (Owner xem trên web)

1. **Danh mục → Viết lại nội dung:** ba bản nháp cũ vẫn ở đó, **không đổi**. Áp dụng như bình thường nếu bạn đã ưng.
2. Muốn thử cách mới: mở một bản nháp chưa áp dụng, **Viết lại bản nháp** (menu ⋮), đợi bản mới. Kiểm tra: mục **Phù hợp với ai** có chữ (cả tiếng Việt và English); khung **AI ghi chú** ghi "suy luận từ loại sản phẩm" nếu nhà cung cấp không nêu loại da, các ghi chú viết bằng tiếng Việt; ô **Dùng tên gợi ý** đang tắt; thành phần có trong danh sách của nhà cung cấp không còn bị báo. Mỗi lần viết lại tốn một ít chi phí (xem Cài đặt AI).
3. Trang khách của sản phẩm đã áp dụng không hiện "AI ghi chú" ở bất kỳ chỗ nào.

## Quay lại nếu có sự cố

Không có migration nên quay lại chỉ là đổi bản chạy; cơ sở dữ liệu không cần động tới. Bản nháp viết bằng cách mới vẫn đọc được bằng bản cũ.

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=7e194b338c944a8b30160c051fdf022a0d424f5f
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
)
```

**Mong đợi:** ba tiến trình `online`; trang `https://lucyspa.vn/vi` mở được. _Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.
