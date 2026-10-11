# Hướng dẫn đưa Phase 9 (P9-2 đến P9-6: nhập sản phẩm từ nhà cung cấp) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG**, không chạy lại, và gửi cho Claude kết quả (chụp màn hình hoặc chép chữ). Claude **không** đụng tới máy chủ; chỉ Owner chạy các lệnh này.

**Bản sẽ cài:** commit `638afde4980694b9851db2d858c92a227f88065e` (viết tắt `638afde`), đã push lên `main`, **CI xanh** (lần chạy #283, xem Bước 0). Các commit tài liệu đẩy sau đó (kể cả commit của tệp này) không đổi mã chạy.
**Bản đang chạy:** `8b7c3413a0827f21e8973e45be56c94b10e5d9c2` (giao diện nhân viên kiểu C, Owner báo triển khai 2026-10-10; 101 migration, 66 quyền).
**Cơ sở dữ liệu:** thêm **5 migration** (101 → **106**), chỉ **thêm** (10 bảng mới, các kiểu liệt kê mới, hàm và trigger bảo vệ của bảng mới; **không đổi bảng cũ, không đổi dữ liệu cũ**):
`20261125000000_phase9_permission_codes`, `20261125000001_phase9_supplier_sources`, `20261126000000_phase9_source_tests`, `20261127000000_phase9_scans_images`, `20261128000000_phase9_review_decisions`.
**Quyền:** 66 → **68** (`MANAGE_SUPPLIER_SOURCES`, `REVIEW_SUPPLIER_IMPORTS`). **Không cấp cho vai trò hay người nào.** Tài khoản Owner vẫn vào được hai màn hình mới (như mọi lần trước, tài khoản Owner qua mọi kiểm tra quyền); nhân viên thì chưa ai vào được cho đến khi Owner tự cấp ở màn Vai trò.
**Biến môi trường (`.env`) mới:** **không có**. Worker dùng đúng `MEDIA_STORAGE_DIR` đã có sẵn trong `.env` (cùng thư mục API đang lưu ảnh); Bước 1 kiểm tra biến này có giá trị. Không có thay đổi nginx, không có tiến trình pm2 mới. Thư viện mới: chỉ khai báo `sharp` (cùng bản `0.35.4` mà API đã dùng) cho gói `packages/server`; `pnpm install --frozen-lockfile` tự xử lý.
**Worker cần ra internet không?** **Có, nhưng chỉ khi có người bấm.** Chỉ **worker** nói chuyện với website nhà cung cấp (API và web thì không), và chỉ tới **`haruohui.com`**, cổng **HTTPS 443** (kèm tra DNS), khi một người **chạy thử nguồn** (Test Source) hoặc **quét mẫu** (tối đa 20 sản phẩm, 1 yêu cầu mỗi giây, đọc `robots.txt`, chặn địa chỉ nội bộ). **Không có gì chạy tự động**, và sau lần triển khai này chưa có nguồn nào được nhập: không có yêu cầu nào tới `haruohui.com` cho đến khi Owner tự thêm nguồn, ghi giấy phép, xác nhận và bấm chạy thử. Bước 1 kiểm tra đường ra bằng kết nối TCP (không gửi yêu cầu HTTP nào tới website đó).
**Worker phải khởi động lại** (có hai vòng việc nền mới: chạy thử nguồn và quét mẫu). Bước 6 làm việc này. **Worker vẫn đúng một tiến trình** (hai worker làm lập lịch chạy hai lần).
**Sau khi triển khai, "Bán online" VẪN TẮT** (không đổi, không bước nào đụng tới công tắc). Hai quyền mới vẫn **chưa cấp cho ai**.
**Thời gian:** khoảng 40 phút. Trong lúc áp migration (Bước 5) API và worker **dừng khoảng 2 phút**: POS tạm gián đoạn; báo nhân viên.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `638afde` có dấu **xanh** (lần chạy #283). Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã xem các báo cáo `docs/PHASE9_P9_2_SOURCES.md` đến `docs/PHASE9_P9_6_REVIEW_APPROVAL.md` (mục "Em tự đặt" của P9-3, P9-4 và hai điều 2-3 của P9-5 vẫn **chờ Owner duyệt**; chúng chỉ là cách hiểu kỹ thuật, không chặn việc triển khai nhưng nên duyệt trước khi dùng thật).
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
getent hosts haruohui.com
timeout 8 bash -c '</dev/tcp/haruohui.com/443' && echo "cong 443 mo" || echo "cong 443 KHONG ra duoc"
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `8b7c341`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB (cần ít nhất 2 GB); `Swap` bằng 0 là bình thường; thư mục `/opt/lucyspa-media` có; `grep -c` in `1`; tên cơ sở dữ liệu `lucy_spa_dev`; `getent` in một địa chỉ IP; dòng cuối `cong 443 mo`.
Nếu **chỉ** dòng cuối là `KHONG ra duoc`: **không dừng việc triển khai** (phần mềm vẫn chạy bình thường), nhưng ghi lại và báo Claude: sau này chạy thử nguồn sẽ báo lỗi kết nối cho tới khi mở đường ra `haruohui.com:443`. Các mục khác sai: **DỪNG**.

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra ở dòng git rev-parse HEAD>
echo "$OLD_COMMIT"
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-phase9-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu và bản web (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from products) as products, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select enabled from online_sales_settings) as ban_online_bat"'
```

**Mong đợi:** một dòng dạng `…|…|…|…|…|66|101|f` (quyền **66**, migration **101**, bán online `f` = tắt).

2.2. Sao lưu cơ sở dữ liệu và kiểm tra:

```
export BACKUP=/root/backups/lucyspa-pre-phase9-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
chmod 600 "$BACKUP"
echo "$BACKUP"
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` lớn hơn 1000; có dòng `Format: CUSTOM`. **Sai: DỪNG.** Ghi lại đường dẫn tệp sao lưu.

2.3. Sao lưu bản web và phần mềm đang chạy (để quay lại nhanh, vì bước build sẽ ghi đè):

```
cd /opt/lucyspa
export WEBBACKUP=/root/backups/lucyspa-web-pre-phase9-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist)
chmod 600 "$WEBBACKUP"
echo "$WEBBACKUP"
ls -l "$WEBBACKUP"
tar -tzf "$WEBBACKUP" | wc -l
```

**Mong đợi:** dung lượng lớn hơn 10 MB; số dòng lớn hơn 500; không có báo lỗi. **Sai: DỪNG.** Ghi lại đường dẫn tệp.

## Bước 3. Lấy bản mới, cài, build (chưa khởi động lại gì)

3.1. Lấy đúng bản mới:

```
cd /opt/lucyspa
git fetch origin
git checkout 638afde4980694b9851db2d858c92a227f88065e
git rev-parse HEAD
```

**Mong đợi:** in đúng `638afde4980694b9851db2d858c92a227f88065e` (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`. Lỗi: **DỪNG** (cơ sở dữ liệu và phần mềm đang chạy chưa bị đụng tới).

3.3. Build (vài phút), **không** đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG** (cơ sở dữ liệu chưa bị đụng tới; nếu trang web báo lỗi vì `.next` bị ghi dở thì xem Bước 9, Cách A, dòng "khôi phục nhanh"). Trong lúc build, vài trang có thể báo lỗi tạm thời.

## Bước 4. Diễn tập trên bản khôi phục của cơ sở dữ liệu thật (không đụng dữ liệu thật)

4.1. Tạo cơ sở dữ liệu tạm trên máy chủ và khôi phục bản sao lưu vào đó:

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
pnpm db:permissions:sync
```

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 5 migration chờ** (5 tên ở đầu tệp này); `db:deploy` in `All migrations have been successfully applied.`; lần đồng bộ quyền thứ nhất in `Permission catalog synced: 2 inserted, 66 already present.`, lần thứ hai `0 inserted, 68 already present.`

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name >= \$\$20261125\$\$ order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$)) as role_grants, (select count(*) from user_permission_overrides o join permissions p on p.id = o.permission_id where p.code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$)) as overrides, (select enabled from online_sales_settings) as ban_online_bat, (select count(*) from information_schema.tables where table_schema = \$\$public\$\$ and table_name in (\$\$supplier_sources\$\$, \$\$import_scans\$\$, \$\$source_records\$\$, \$\$source_price_observations\$\$, \$\$import_candidates\$\$, \$\$candidate_sources\$\$, \$\$candidate_images\$\$, \$\$source_value_mappings\$\$, \$\$supplier_source_tests\$\$, \$\$candidate_review_decisions\$\$)) as bang_moi"'
```

**Mong đợi:** dòng `grep -c` in `0` (khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); **5 dòng** `tên|số giây` (**ghi lại cả 5 dòng gửi Claude**; trên máy thử của Claude mỗi dòng dưới nửa giây, tổng khoảng 0,7 giây; trên bản giống thật dưới vài giây); dòng cuối **`106|68|0|0|f|10`** (106 migration, 68 quyền, 0 vai trò và 0 ngoại lệ có hai quyền mới, bán online tắt, 10 bảng mới). Khác: **DỪNG**.

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from pg_database where datname = \$\$lucy_spa_rehearsal_scratch\$\$"'
```

**Mong đợi:** `DROP DATABASE` không báo lỗi; dòng cuối in `0`.

## Bước 5. Dừng API và worker, áp migration vào cơ sở dữ liệu thật

**Dừng hai tiến trình ghi** (web và nginx vẫn chạy; khách vẫn xem được trang) để migration không tranh khóa với việc nền.

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker
sleep 3
pm2 status
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `lucyspa-api` và `lucyspa-worker` ở trạng thái `stopped`; `0`; `db:status` liệt kê đúng 5 tên như 4.2. Khác: **DỪNG** (khởi động lại hai tiến trình bằng `pm2 restart lucyspa-api lucyspa-worker` rồi hỏi Claude).

```
pnpm db:deploy
pnpm db:status
pnpm db:permissions:sync
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$)) as role_grants, (select count(*) from user_permission_overrides o join permissions p on p.id = o.permission_id where p.code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$)) as overrides, (select enabled from online_sales_settings) as ban_online_bat, (select count(*) from information_schema.tables where table_schema = \$\$public\$\$ and table_name in (\$\$supplier_sources\$\$, \$\$import_scans\$\$, \$\$source_records\$\$, \$\$source_price_observations\$\$, \$\$import_candidates\$\$, \$\$candidate_sources\$\$, \$\$candidate_images\$\$, \$\$source_value_mappings\$\$, \$\$supplier_source_tests\$\$, \$\$candidate_review_decisions\$\$)) as bang_moi"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; `Permission catalog synced: 2 inserted, 66 already present.`; dòng cuối **`106|68|0|0|f|10`**. Một migration chạy quá 60 giây hoặc báo lỗi (`P3018`, `deadlock`): **DỪNG**, không chạy lại, gửi Claude kết quả.

## Bước 6. Khởi động lại (worker bắt buộc phải khởi động lại)

Không có thư mục mới và không có cấu hình nginx mới.

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

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online`; không có dòng lỗi mới sau lúc khởi động lại (tối đa vài dòng cũ từ trước khi dừng); dòng `grep -c` in `0` (số khác `0` nghĩa là worker không ghi được vào thư mục ảnh: chạy thử nguồn vẫn được nhưng ảnh sẽ không lưu; báo Claude, không cần quay lại); `0 inserted, 68 already present`.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "man Nguon nha cung cap: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/supplier-sources
curl -s -o /dev/null -w "man San pham nhap: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/supplier-imports
curl -s -o /dev/null -w "API nguon khi chua dang nhap: %{http_code}\n" http://127.0.0.1:3001/api/v1/supplier-sources
curl -s -o /dev/null -w "API san pham nhap khi chua dang nhap: %{http_code}\n" http://127.0.0.1:3001/api/v1/supplier-imports/candidates
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng đầu `200` (vi, dịch vụ, mỹ phẩm, đăng nhập nhân viên); **hai màn hình mới (`supplier-sources`, `supplier-imports`) đều `200`** (khi chưa đăng nhập trang tự chuyển về đăng nhập, vẫn `200` hoặc `307`, **không** được là `500`/`404`); **hai dòng API khi chưa đăng nhập đều `401`**; `"enabled":false` (bán online vẫn tắt); `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`. Khác: **DỪNG** và hỏi Claude.

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. Mục **Danh mục** có hai mục mới: **Nguồn nhà cung cấp** và **Sản phẩm nhập** (nếu không thấy, đăng xuất đăng nhập lại). Mở từng mục: **danh sách trống** là đúng (chưa nhập nguồn nào).
2. **Chỉ xem, đừng bấm:** _Thêm nguồn_, _Chạy thử_, _Quét mẫu_, _Duyệt_. Bất cứ thao tác nào trong số đó bắt đầu quy trình nhập thật (chạy thử nguồn sẽ liên hệ website nhà cung cấp). Việc đó để một buổi riêng, sau khi Owner duyệt các cách hiểu còn chờ.
3. Màn **Vai trò**: không vai trò nào có hai quyền mới (đã được kiểm bằng số `0|0` ở Bước 5; chỉ xem lại nếu muốn).
4. Công tắc **Bán online** vẫn **tắt**; trang `https://lucyspa.vn/vi/products` hiện như cũ, nút ghi **"Mua tại cửa hàng"**.
5. Quầy (POS): bảng hóa đơn và một hóa đơn cũ mở bình thường; chuông thông báo mở được; mở nhanh vài trang cũ (Lịch hẹn, Hóa đơn, Sản phẩm, Kho hàng, trang chủ khách). Không có gì đổi.

## Bước 9. Quay lại nếu có sự cố

**Đọc trước:** migration chỉ **thêm** bảng mới nên bản cũ `8b7c341` chạy được trên cơ sở dữ liệu 106 migration, **với một điều kiện**: bản cũ chỉ biết 66 quyền, nên phải **xóa hai hàng quyền mới** trước (nếu để lại, lệnh `db:permissions:sync` của bản cũ báo lỗi và danh sách quyền có thể không đọc được). Hai quyền này chưa cấp cho ai nên xóa không mất gì; nếu Owner đã cấp trong lúc dùng thử, lệnh dưới cũng xóa phần cấp đó. Dữ liệu nhập (nguồn, ứng viên, ảnh nhập) ở lại trong các bảng mới, vô hại với bản cũ. Sản phẩm **nháp** đã được tạo từ màn duyệt (nếu có) vẫn ở lại như sản phẩm nháp thường; hỏi Claude trước khi xóa.

**Cách A: quay lại phần mềm, giữ nguyên cơ sở dữ liệu.**

A1. Dừng API và worker (giữ web), rồi xóa quyền mới:

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "delete from role_permissions where permission_id in (select id from permissions where code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$))" -c "delete from user_permission_overrides where permission_id in (select id from permissions where code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$))" -c "delete from permissions where code::text in (\$\$MANAGE_SUPPLIER_SOURCES\$\$, \$\$REVIEW_SUPPLIER_IMPORTS\$\$)" -c "select count(*) from permissions"'
```

**Mong đợi:** ba dòng `DELETE <số>` (hai số đầu thường là `0`, số thứ ba là `2`) và cuối cùng `66`. Khác: **DỪNG**, hỏi Claude.

A2. Đưa phần mềm về bản cũ và khởi động lại:

```
cd /opt/lucyspa
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
pnpm db:permissions:sync
```

**Mong đợi:** ba tiến trình `online` (web 3 dòng); `https://lucyspa.vn/vi` mở được; `Permission catalog synced: 0 inserted, 66 already present.` Cơ sở dữ liệu giữ 106 migration (bảng mới ở lại, trống hoặc có dữ liệu nhập; vô hại). Triển khai lại sau này không cần migration; `db:permissions:sync` của bản mới thêm lại hai hàng quyền.

_Khôi phục nhanh bản web nếu `pnpm build` ở A2 lỗi (dùng bản đã sao lưu ở Bước 2.3, sau `git checkout "$OLD_COMMIT"`):_

```
cd /opt/lucyspa
tar -xzf "$WEBBACKUP" -C /opt/lucyspa
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
```

**Cách B (chỉ khi cơ sở dữ liệu hỏng): khôi phục từ tệp sao lưu ở Bước 2.2.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất** (lịch hẹn, hóa đơn, thanh toán, điểm thưởng...). **Hỏi Claude trước khi làm.**

## Bước 10. Báo lại cho Claude

Gửi: mã commit đang chạy (`git rev-parse HEAD`), dòng số liệu cuối Bước 5 (`106|68|0|0|f|10`), 5 dòng thời gian migration (Bước 4.3), kết quả `pm2 status` (Bước 6) và các dòng của Bước 7, kết quả dòng kiểm tra cổng 443 (Bước 1), cùng đường dẫn hai tệp sao lưu (`$BACKUP`, `$WEBBACKUP`). Claude ghi vào `LUCYSPA_HANDOFF.md`: commit, 5 migration đã áp, ngày giờ.
