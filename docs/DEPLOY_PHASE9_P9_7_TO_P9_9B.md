# Hướng dẫn đưa Phase 9 (P9-7 đến P9-9b: quét lại, giá và ảnh hàng loạt, nhập một lần bấm) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG**, không chạy lại, và gửi cho Claude kết quả (chụp màn hình hoặc chép chữ). Claude **không** đụng tới máy chủ; chỉ Owner chạy các lệnh này.

**Bản sẽ cài:** commit `2b064e9f16ae5d189e43b69ed613fef3be099588` (viết tắt `2b064e9`), đã push lên `main` (CI: xem Bước 0). Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `638afde4980694b9851db2d858c92a227f88065e` (Phase 9 P9-2 đến P9-6, Owner báo triển khai 2026-10-11; **106 migration, 68 quyền**). Máy chủ thật **đã có dữ liệu nhập thử** (Owner đã thử nguồn Haruohui): hướng dẫn này không giả định các bảng nhập còn trống.
**Cơ sở dữ liệu:** thêm **2 migration** (106 → **108**), chỉ **thêm** (một bảng mới, một cột mới, nới rộng các ràng buộc; **không đổi, không xóa dòng dữ liệu cũ nào**):
`20261129000000_phase9_resync_changes` (bảng `source_changes`: ghi chú thay đổi ở nguồn, chỉ thêm; nới danh sách loại thông báo để có thông báo "nguồn có thay đổi") và `20261130000000_phase9_full_scan` (cột `import_scans.scope`: `SAMPLE` mặc định cho mọi lần quét cũ, hoặc `FULL`; nới giới hạn mẫu và trần 2.000 sản phẩm mỗi nguồn). P9-8 (giá và ảnh hàng loạt) **không có migration**.
**Quyền:** vẫn **68**, không quyền mới, không cấp cho ai. Nút "Nhập và đăng tất cả" cần **cả hai** quyền `MANAGE_PRODUCTS` và `MANAGE_PRODUCT_PRICES` (tài khoản Owner có sẵn).
**Biến môi trường (`.env`) mới:** **không có.** Không đổi nginx, không có tiến trình pm2 mới, không có thư viện mới.
**Worker cần ra internet không?** **Có, chỉ khi có người bấm, và chỉ tới `haruohui.com` cổng 443** (như lần trước). Thêm lần này: **"Quét toàn bộ"** đọc cả 352 sản phẩm theo trang 100 sản phẩm (khoảng 5 yêu cầu cho danh sách, rồi **1 yêu cầu mỗi giây cho từng ảnh** nếu giấy phép cho dùng ảnh: khoảng 6 đến 20 phút). **Quét theo lịch** (mới) **TẮT** cho tới khi Owner đặt "Lịch kiểm tra" của nguồn khác "Chạy tay"; khi bật chỉ chạy từ 1 đến 5 giờ sáng.
**Worker phải khởi động lại** (vòng kiểm tra lịch quét mỗi 5 phút, và quét toàn bộ). Bước 6 làm việc này. **Worker vẫn đúng một tiến trình.**
**Sau khi triển khai, "Bán online" VẪN TẮT** (không bước nào đụng tới công tắc). **Chú ý:** "Nhập và đăng tất cả" đặt sản phẩm ở trạng thái **đang bán**, nên sản phẩm đó sẽ hiện ở trang **Mỹ phẩm** của khách (nút "Mua tại cửa hàng") dù Bán online tắt. Đó là việc của buổi thử sau khi triển khai, không phải của lúc triển khai.
**Thời gian:** khoảng 35 phút. Trong lúc áp migration (Bước 5) API và worker **dừng khoảng 2 phút**: POS tạm gián đoạn; báo nhân viên.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `2b064e9` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã xem các báo cáo `docs/PHASE9_P9_7_RESYNC.md`, `docs/PHASE9_P9_8_BULK_PRICES_IMAGES.md`, `docs/PHASE9_P9_9B_ONE_CLICK.md` (mục "Em tự đặt, chờ chủ duyệt" của từng báo cáo: giá khuyến mãi, SKU dạng chữ, thực phẩm chức năng vào "Khác", lịch quét; chúng không chặn việc triển khai nhưng nên duyệt trước khi bấm "Nhập và đăng tất cả" trên máy thật).
- Báo nhân viên đang thu tiền ở quầy: tạm dừng khoảng 5 phút ở Bước 5 và 6.

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
free -m
ls -ld /opt/lucyspa-media
grep -c '^MEDIA_STORAGE_DIR=.' .env
docker exec lucy-spa-postgres-1 sh -c 'echo "$POSTGRES_DB"'
timeout 8 bash -c '</dev/tcp/haruohui.com/443' && echo "cong 443 mo" || echo "cong 443 KHONG ra duoc"
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `638afde`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống ít nhất 2 GB; thư mục `/opt/lucyspa-media` có; `grep -c` in `1`; tên cơ sở dữ liệu `lucy_spa_dev`; dòng cuối `cong 443 mo` (nếu `KHONG ra duoc`: không dừng triển khai, nhưng quét toàn bộ sẽ báo lỗi kết nối; báo Claude). Các mục khác sai: **DỪNG**.

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra ở dòng git rev-parse HEAD>
echo "$OLD_COMMIT"
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-p97-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu và bản web (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from invoices) as invoices, (select count(*) from products) as products, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from supplier_sources) as nguon, (select count(*) from import_scans) as lan_quet, (select count(*) from import_candidates) as ung_vien, (select enabled from online_sales_settings) as ban_online_bat"'
```

**Mong đợi:** một dòng dạng `…|…|…|68|106|…|…|…|f` (quyền **68**, migration **106**, bán online `f` = tắt). **Chép lại số `nguon`, `lan_quet`, `ung_vien`, `products`**: sau triển khai phải **giữ nguyên**.

2.2. Sao lưu cơ sở dữ liệu và kiểm tra:

```
export BACKUP=/root/backups/lucyspa-pre-p97-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
chmod 600 "$BACKUP"
echo "$BACKUP"
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` lớn hơn 1000; có dòng `Format: CUSTOM`. **Sai: DỪNG.** Ghi lại đường dẫn tệp sao lưu.

2.3. Sao lưu bản web và phần mềm đang chạy:

```
cd /opt/lucyspa
export WEBBACKUP=/root/backups/lucyspa-web-pre-p97-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist)
chmod 600 "$WEBBACKUP"
echo "$WEBBACKUP"
ls -l "$WEBBACKUP"
tar -tzf "$WEBBACKUP" | wc -l
```

**Mong đợi:** dung lượng lớn hơn 10 MB; số dòng lớn hơn 500; không báo lỗi. **Sai: DỪNG.**

## Bước 3. Lấy bản mới, cài, build (chưa khởi động lại gì)

3.1. Lấy đúng bản mới:

```
cd /opt/lucyspa
git fetch origin
git checkout 2b064e9f16ae5d189e43b69ed613fef3be099588
git rev-parse HEAD
```

**Mong đợi:** in đúng `2b064e9f16ae5d189e43b69ed613fef3be099588` (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`. (Có thể có thông báo nâng cấp Prisma 8: **bỏ qua**, không nâng cấp.) Lỗi: **DỪNG** (cơ sở dữ liệu và phần mềm đang chạy chưa bị đụng tới).

3.3. Build (vài phút), **không** đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG** (nếu trang web báo lỗi vì `.next` bị ghi dở thì xem Bước 9, "khôi phục nhanh"). Trong lúc build, vài trang có thể báo lỗi tạm thời.

## Bước 4. Diễn tập trên bản khôi phục của cơ sở dữ liệu thật (không đụng dữ liệu thật)

4.1. Tạo cơ sở dữ liệu tạm và khôi phục bản sao lưu vào đó:

```
cd /opt/lucyspa
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" --if-exists lucy_spa_rehearsal_scratch && createdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

**Mong đợi:** `pg_restore exit=0`. Khác: **DỪNG**.

4.2. Trỏ lệnh vào cơ sở dữ liệu tạm (lệnh dưới **từ chối** mọi tên không phải cơ sở dữ liệu tạm) rồi áp migration:

```
eval "$(node scripts/scratch-db-env.mjs lucy_spa_rehearsal_scratch)" && echo "DB=${DATABASE_URL##*/}"
pnpm db:status
pnpm db:deploy
pnpm db:permissions:sync
```

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 2 migration chờ** (hai tên ở đầu tệp này); `db:deploy` in `All migrations have been successfully applied.`; `Permission catalog synced: 0 inserted, 68 already present.`

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name >= \$\$20261129\$\$ order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from information_schema.tables where table_schema = \$\$public\$\$ and table_name = \$\$source_changes\$\$) as bang_moi, (select count(*) from information_schema.columns where table_schema = \$\$public\$\$ and table_name = \$\$import_scans\$\$ and column_name = \$\$scope\$\$) as cot_moi, (select count(*) from import_scans where scope <> \$\$SAMPLE\$\$) as quet_khong_phai_mau, (select count(*) from import_scans) as lan_quet, (select count(*) from import_candidates) as ung_vien, (select count(*) from products) as products, (select enabled from online_sales_settings) as ban_online_bat"'
```

**Mong đợi:** dòng `grep -c` in `0` (khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); **2 dòng** `tên|số giây` (**ghi lại cả hai gửi Claude**; trên máy thử mỗi dòng dưới nửa giây); dòng cuối **`108|68|1|1|0|<lan_quet>|<ung_vien>|<products>|f`**, trong đó `lan_quet`, `ung_vien`, `products` **bằng đúng số ở Bước 2.1** (mọi lần quét cũ là `SAMPLE`). Khác: **DỪNG**.

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from pg_database where datname = \$\$lucy_spa_rehearsal_scratch\$\$"'
```

**Mong đợi:** `DROP DATABASE` không báo lỗi; dòng cuối in `0`.

## Bước 5. Dừng API và worker, áp migration vào cơ sở dữ liệu thật

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker
sleep 3
pm2 status
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `lucyspa-api` và `lucyspa-worker` ở trạng thái `stopped`; `0`; `db:status` liệt kê đúng 2 tên như 4.2. Khác: **DỪNG** (khởi động lại bằng `pm2 restart lucyspa-api lucyspa-worker` rồi hỏi Claude).

```
pnpm db:deploy
pnpm db:status
pnpm db:permissions:sync
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from information_schema.tables where table_schema = \$\$public\$\$ and table_name = \$\$source_changes\$\$) as bang_moi, (select count(*) from information_schema.columns where table_schema = \$\$public\$\$ and table_name = \$\$import_scans\$\$ and column_name = \$\$scope\$\$) as cot_moi, (select count(*) from import_scans where scope <> \$\$SAMPLE\$\$) as quet_khong_phai_mau, (select count(*) from import_scans) as lan_quet, (select count(*) from import_candidates) as ung_vien, (select count(*) from products) as products, (select enabled from online_sales_settings) as ban_online_bat"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; `0 inserted, 68 already present`; dòng cuối **`108|68|1|1|0|…|…|…|f`** với ba số giữ nguyên như Bước 2.1. Một migration chạy quá 60 giây hoặc báo lỗi (`P3018`, `deadlock`): **DỪNG**, không chạy lại, gửi Claude kết quả.

## Bước 6. Khởi động lại (worker bắt buộc phải khởi động lại)

```
cd /opt/lucyspa
pm2 restart lucyspa-api lucyspa-worker --update-env
sleep 10
pm2 reload lucyspa-web --update-env
sleep 20
pm2 status
pm2 logs lucyspa-api --err --lines 30 --nostream
pm2 logs lucyspa-worker --err --lines 30 --nostream
pm2 logs lucyspa-worker --lines 80 --nostream | grep -c "MEDIA_STORAGE_DIR is not usable" || true
pnpm db:permissions:sync
```

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online`; không có dòng lỗi mới sau lúc khởi động lại; `grep -c` in `0`; `0 inserted, 68 already present`.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "man Nguon nha cung cap: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/supplier-sources
curl -s -o /dev/null -w "man San pham nhap: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/supplier-imports
curl -s -o /dev/null -w "man Nhap va dang tat ca: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/supplier-imports/all
curl -s -o /dev/null -w "man Nhap du lieu: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/import
curl -s -o /dev/null -w "API nhap tat ca khi chua dang nhap: %{http_code}\n" http://127.0.0.1:3001/api/v1/supplier-imports/import-all/preview
curl -s -o /dev/null -w "API thay doi khi chua dang nhap: %{http_code}\n" http://127.0.0.1:3001/api/v1/supplier-imports/changes
curl -s -o /dev/null -w "API xuat bang gia khi chua dang nhap: %{http_code}\n" "http://127.0.0.1:3001/api/v1/product-imports/export-prices?format=csv"
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng đầu `200`; bốn màn nhân viên `200` (khi chưa đăng nhập trang tự chuyển về đăng nhập, vẫn `200` hoặc `307`, **không** được là `500`/`404`); **ba dòng API khi chưa đăng nhập đều `401`**; `"enabled":false`; `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`. Khác: **DỪNG** và hỏi Claude.

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. **Danh mục → Nguồn nhà cung cấp:** nguồn Haruohui vẫn còn như trước; menu `⋮` của dòng có **Quét mẫu** và **Quét toàn bộ**; mục **Giấy phép** nhìn rõ khi rê chuột (nền đỏ, chữ trắng).
2. **Sản phẩm nhập:** có tab **Chờ duyệt** và tab **Thay đổi**, và nút **"Nhập và đăng tất cả"** ở đầu trang. Số ứng viên cũ **giữ nguyên** (bằng số Bước 2.1).
3. **Nhập dữ liệu:** có hai nút **"Nhập ảnh từ ZIP"** và **"Tải tệp lên"**; hộp "Tải tệp lên" có loại **"Cập nhật giá bán hàng loạt"** kèm nút tải bảng giá hiện tại.
4. Mục "Lịch kiểm tra" của nguồn (Sửa nguồn) đang là **Chạy tay** (không tự quét).
5. **Chỉ xem, đừng bấm** "Quét toàn bộ", "Nhập và đăng tất cả", "Xác nhận" trong lúc triển khai. Việc đó để buổi thử riêng (xem `docs/OWNER_TEST_SCRIPT_PHASE9.md`).
6. Công tắc **Bán online** vẫn **tắt**; trang khách `https://lucyspa.vn/vi/products` hiện như cũ. Quầy (POS) và vài trang cũ mở bình thường.

## Bước 9. Quay lại nếu có sự cố

**Đọc trước:** hai migration chỉ **thêm** (một bảng, một cột có giá trị mặc định, ràng buộc nới rộng) nên bản cũ `638afde` chạy được trên cơ sở dữ liệu 108 migration. Quyền vẫn 68 nên **không phải xóa hàng quyền nào**. Bản cũ bỏ qua cột `scope`, bỏ qua bảng `source_changes` và bỏ qua thông báo loại mới. **Sản phẩm đã được "Nhập và đăng tất cả" đăng bán (nếu Owner đã dùng) vẫn ở lại là sản phẩm thường**; muốn ẩn thì đặt trạng thái ngừng bán ở màn Sản phẩm (hỏi Claude trước khi xóa bất cứ thứ gì).

**Cách A: quay lại phần mềm, giữ nguyên cơ sở dữ liệu.**

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
pnpm db:permissions:sync
```

**Mong đợi:** ba tiến trình `online` (web 3 dòng); `https://lucyspa.vn/vi` mở được; `Permission catalog synced: 0 inserted, 68 already present.` Cơ sở dữ liệu giữ 108 migration (vô hại).

_Khôi phục nhanh bản web nếu `pnpm build` lỗi (dùng bản sao lưu ở Bước 2.3, sau `git checkout "$OLD_COMMIT"`):_

```
cd /opt/lucyspa
tar -xzf "$WEBBACKUP" -C /opt/lucyspa
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
```

**Cách B (chỉ khi cơ sở dữ liệu hỏng): khôi phục từ tệp sao lưu ở Bước 2.2.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất** (lịch hẹn, hóa đơn, thanh toán, điểm thưởng...). **Hỏi Claude trước khi làm.**

## Bước 10. Báo lại cho Claude

Gửi: mã commit đang chạy (`git rev-parse HEAD`), dòng số liệu cuối Bước 5 (`108|68|1|1|0|…`), 2 dòng thời gian migration (Bước 4.3), `pm2 status` (Bước 6), các dòng của Bước 7, cùng đường dẫn hai tệp sao lưu (`$BACKUP`, `$WEBBACKUP`). Claude ghi vào `LUCYSPA_HANDOFF.md`: commit, 2 migration đã áp, ngày giờ.
