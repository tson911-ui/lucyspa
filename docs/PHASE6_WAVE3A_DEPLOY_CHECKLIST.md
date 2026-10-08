# Hướng dẫn đưa Phase 6 Đợt 3a (trả hàng, hoàn tiền, đổi hàng sản phẩm) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; kết quả khác thì **DỪNG, không chạy tiếp, chụp màn hình gửi Claude**. Chỉ làm khi Owner quyết (deploy từng mốc, sau kiểm tra mốc 3a). **Claude không chạm vào máy chủ.**

**Bản sẽ cài:** commit `<MÃ_COMMIT_MỚI>` (điền sau khi Owner đẩy lên `main` và CI xanh; **chưa có mã, chưa được làm**). Các commit tài liệu đẩy sau đó không được cài và không đổi mã chạy.
**Bản đang chạy:** `135872558838e00436fa5ce829e70f0517d7be68` (Đợt 2, `1358725`, theo `LUCYSPA_HANDOFF.md`).
**Cơ sở dữ liệu:** thêm **9 migration** (`20261111000000` đến `20261115000002`): **80 thành 89**. **Quyền: không thêm quyền nào** (vẫn 65). Hai quyền của đợt này, `MANAGE_PRODUCT_RETURNS` (mở hồ sơ trả hàng) và `REFUND_PRODUCTS` (duyệt, hoàn tiền, đổi hàng), **đã có từ Đợt 1 và chưa gán cho ai**; deploy xong vẫn không ai làm được các việc này (trừ tài khoản Chủ, qua mọi kiểm tra quyền).
**Khác Đợt 2:** Đợt 3a thêm **9 bảng mới** (hồ sơ trả hàng, lịch sử, ảnh bằng chứng, phiếu hoàn tiền, sửa mã chuyển khoản, phiếu đổi hàng, hoàn tất đổi, sửa mã đổi hàng, các lần dùng mật khẩu), **7 kiểu enum mới** (và thêm giá trị `REFUND_RETURN`, `EXCHANGE_RETURN` vào loại phiếu kho, `REFUND_REVERSAL` vào loại sổ điểm), 21 hàm kiểm tra mới, 28 trigger mới và **thay thân 4 hàm đang chạy** (`lucy_guard_loyalty_ledger` sổ điểm, `lucy_guard_stock_movement` chuyển kho, `lucy_guard_inventory_lot` lô, `lucy_check_invoice_pricing_v3` giá bản 3). Số này đo bằng cách so cơ sở dữ liệu 80 và 89 migration (bảng 128 thành 137, hàm 322 thành 343, trigger 307 thành 335). Mọi migration **chỉ thêm hoặc nới, không xóa dữ liệu, không ghi lại dòng cũ**. Bảng thông báo được nới thêm hai loại (hồ sơ trả hàng mới, hoàn tiền); ràng buộc cũ không bị thu hẹp.
**Thay đổi chạy:** API, worker và web đều có mã mới. Không có tiến trình pm2 mới; worker xử lý thêm một loại sự kiện (thu hồi điểm khi hoàn tiền) trong vòng cộng điểm có sẵn. Không có thư viện mới (`pnpm install` không tải gì thêm). **Có một thư mục mới trên máy chủ: ảnh bằng chứng trả hàng (riêng tư), Bước 6.**
**Sau deploy quầy vẫn như cũ:** không ai thấy mục "Trả hàng" ngoài Chủ (quyền chưa gán). Owner tự quyết khi nào gán quyền, và gán cho ai.
**Thời gian:** khoảng 40 phút (build vài phút, diễn tập vài giây). Website hiện chỉ dùng nội bộ, nên **làm lúc nào cũng được**. Lúc khởi động lại API (vài giây) POS gián đoạn ngắn; nếu có nhân viên đang dùng thì báo trước.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `<MÃ_COMMIT_MỚI>` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã đọc `docs/PHASE6_WAVE3A_MILESTONE.md` và `docs/PHASE6_WAVE3A_ROLLBACK_PROOF.md` (cách quay lại đã thử thật).
- Owner đã trả lời các mục chờ duyệt của P6-12 đến P6-14 (hoặc chấp nhận chạy với cách hiểu hiện có: chúng nằm ở `PHASE6_OWNER_DECISIONS_VI.md`). Deploy không bắt buộc phải có câu trả lời; nhưng **gán quyền cho nhân viên thì nên đợi**.
- Nếu có nhân viên đang thu tiền ở quầy, báo họ tạm dừng khoảng 10 phút ở Bước 5 và 6.

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
free -m
ls -ld /opt/lucyspa-media
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `1358725`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB; `Swap` 0; thư mục `/opt/lucyspa-media` có thật. Ghi lại mã cũ (để quay lại):

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

Lưu danh sách tiến trình hiện tại:

```
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-phase6-dot3a-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** một dòng dạng `9|4|2|2|28|65|80` (quyền **65**, migration **80**).

2.2. Tạo và kiểm tra bản sao lưu:

```
export BACKUP=/root/backups/lucyspa-pre-phase6-dot3a-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
chmod 600 "$BACKUP"
echo "$BACKUP"
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` lớn hơn 1000; có dòng `Format: CUSTOM`. **Sai: DỪNG.** Ghi lại đường dẫn tệp sao lưu.

## Bước 3. Lấy bản mới, cài, build (chưa khởi động lại gì)

3.1. Lấy đúng bản mới:

```
cd /opt/lucyspa
git fetch origin
git checkout <MÃ_COMMIT_MỚI>
git rev-parse HEAD
```

**Mong đợi:** in đúng mã 40 ký tự (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện (không có thư viện mới) và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`.

3.3. Build (vài phút), **không** đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG** (cơ sở dữ liệu chưa bị đụng tới). Trong lúc build, vài trang có thể báo lỗi tạm thời vì `.next` đang được ghi đè: bình thường.

## Bước 4. Diễn tập trên bản khôi phục của cơ sở dữ liệu thật (không đụng dữ liệu thật)

4.1. Tạo cơ sở dữ liệu tạm và khôi phục:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" --if-exists lucy_spa_rehearsal_scratch && createdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

**Mong đợi:** `pg_restore exit=0`.

4.2. Trỏ lệnh vào cơ sở dữ liệu tạm (lệnh dưới **từ chối** mọi tên không phải cơ sở dữ liệu tạm) rồi áp migration:

```
eval "$(node scripts/scratch-db-env.mjs lucy_spa_rehearsal_scratch)" && echo "DB=${DATABASE_URL##*/}"
pnpm db:status
pnpm db:deploy
pnpm db:permissions:sync
```

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 9 migration chờ** (`20261111000000_phase6_wave3_product_returns`, `20261112000000_phase6_wave3_return_exception_kind`, `20261112000001_phase6_wave3_return_window_exception`, `20261113000000_phase6_wave3_refund_kinds`, `20261113000001_phase6_wave3_product_refunds`, `20261114000000_phase6_wave3_refund_password_notice`, `20261115000000_phase6_wave3_exchange_kinds`, `20261115000001_phase6_wave3_product_exchanges`, `20261115000002_phase6_wave3_exchange_return_guard`; báo "chưa áp" ở đây là bình thường); `db:deploy` kết thúc `All migrations have been successfully applied.`; `db:permissions:sync` in `Permission catalog synced: 0 inserted, 65 already present.`

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name >= \$\$20261111\$\$ order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from notifications) as notifications, (select count(*) from invoices) as invoices, (select count(*) from invoices where channel = \$\$COUNTER\$\$ and shipping_fee_vnd = 0 and kind <> \$\$PRODUCT_SALE\$\$) as invoices_untouched"'
```

**Mong đợi:** dòng `grep -c` in `0` (khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); 9 dòng `tên|số giây` (**ghi lại cả 9 dòng gửi Claude**); dòng cuối `89|65|<số thông báo như Bước 2.1>|<số hóa đơn như Bước 2.1>|<cùng số hóa đơn>`. Diễn tập ở máy thử (bản sao 234 MB: 300.000 thông báo, 20.000 hóa đơn đã thanh toán; mã cũ `1358725`): 9 migration cộng lại khoảng 0,54 giây (`…11000000` 0,277 vì kiểm lại 300.000 thông báo; `…14000000` 0,137 vì cùng lý do; các migration còn lại dưới 0,05 giây); `db:deploy` toàn lệnh 4 giây. **Quá 60 giây ở bất kỳ migration nào, hoặc số khác: DỪNG.**

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
```

## Bước 5. Áp migration vào cơ sở dữ liệu thật

Các migration chạm bảng hóa đơn và thông báo rất ngắn (dưới 1 giây); nếu có người đang thu tiền thì báo họ chờ.

```
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `0`; `db:status` liệt kê đúng 9 tên như 4.2. Khác: **DỪNG**.

```
pnpm db:deploy
pnpm db:status
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from product_return_cases) as ho_so_tra_hang, (select count(*) from product_refunds) as phieu_hoan, (select count(*) from product_exchanges) as phieu_doi, (select count(*) from stock_movements where kind in (\$\$REFUND_RETURN\$\$, \$\$EXCHANGE_RETURN\$\$)) as nhap_kho_tra_hang, (select count(*) from loyalty_ledger_entries where kind = \$\$REFUND_REVERSAL\$\$) as thu_hoi_diem, (select count(*) from notifications where type in (\$\$PRODUCT_RETURN_OPENED\$\$, \$\$PRODUCT_REFUND_MADE\$\$)) as thong_bao_moi"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; dòng cuối `89|65|0|0|0|0|0|0` (89 migration, quyền **vẫn 65**, chưa có hồ sơ trả hàng, phiếu hoàn, phiếu đổi, phiếu nhập kho trả hàng, dòng thu hồi điểm hay thông báo mới). Có lỗi: **DỪNG, không chạy lại**, xem Bước 10.

## Bước 6. Thư mục ảnh bằng chứng (riêng tư), rồi khởi động lại

Ảnh bằng chứng của hồ sơ trả hàng nằm trong thư mục con `returns` của thư mục ảnh hiện có. Nó **không bao giờ được máy chủ web phục vụ công khai**: chỉ API đọc, qua đường có kiểm quyền. Tạo thư mục, đặt quyền, và **kiểm chứng không có cấu hình nginx nào trỏ vào thư mục ảnh**:

```
grep -n '^MEDIA_STORAGE_DIR=' .env
ps -o user= -p "$(pm2 pid lucyspa-api)"
mkdir -p /opt/lucyspa-media/returns
chmod 700 /opt/lucyspa-media/returns
ls -ld /opt/lucyspa-media /opt/lucyspa-media/returns
nginx -T > /tmp/nginx-hieu-luc.txt 2>&1; echo "nginx -T exit=$?"
wc -l /tmp/nginx-hieu-luc.txt
grep -nE "^[[:space:]]*(root|alias)[[:space:]]" /tmp/nginx-hieu-luc.txt
grep -c "lucyspa-media" /tmp/nginx-hieu-luc.txt
```

**Mong đợi:** dòng `MEDIA_STORAGE_DIR=/opt/lucyspa-media`; tên người dùng chạy API (thường `root`) **trùng** chủ sở hữu hai thư mục ở lệnh `ls -ld`; `nginx -T exit=0` và `wc -l` lớn hơn vài chục dòng (cấu hình đầy đủ đang chạy); lệnh `grep -nE` liệt kê mọi dòng `root` hoặc `alias` của nginx: **không dòng nào được là `/`, `/opt`, `/opt/` hay bắt đầu bằng `/opt/lucyspa-media`** (các thư mục khác như `/usr/share/nginx/html` hoặc `/var/www/...` là bình thường; không có dòng nào cũng được vì nginx chỉ chuyển tiếp sang web và API); số cuối (`grep -c lucyspa-media`) phải là `0`. **Nếu `nginx -T` báo lỗi hoặc không có lệnh `nginx` (exit khác 0), hoặc có dòng `root`/`alias` trỏ vào `/opt`: DỪNG**, chưa kiểm chứng được là ảnh không bị lộ; chụp màn hình gửi Claude, chưa mở quyền cho ai. (Ảnh nằm trong `returns`, khóa tệp của website luôn bắt đầu bằng năm nên không với tới được thư mục này qua API; nginx là đường duy nhất còn lại.) Nếu chủ sở hữu khác người dùng chạy API: `chown` lại cho đúng người dùng đó (hỏi Claude).

Khởi động lại (API và worker, rồi web), kiểm tra quyền:

```
pm2 restart lucyspa-api lucyspa-worker --update-env
sleep 10
pm2 reload lucyspa-web --update-env
sleep 20
pm2 status
pm2 logs lucyspa-api --err --lines 30 --nostream
pm2 logs lucyspa-worker --err --lines 30 --nostream
pnpm db:permissions:sync
```

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online`; không có dòng lỗi mới sau lúc khởi động lại; `Permission catalog synced: 0 inserted, 65 already present.` **Không bao giờ chạy `pm2 scale lucyspa-worker` hoặc `pm2 scale lucyspa-api`**: lập lịch của worker sẽ chạy hai lần. Báo nhân viên (nếu có) thu tiền lại được.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "anh bang chung khi chua dang nhap: %{http_code}\n" http://127.0.0.1:3001/api/v1/product-returns/cases/00000000-0000-4000-8000-000000000000/photos/00000000-0000-4000-8000-000000000000/thumb
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng `200`; dòng "anh bang chung" in **`401`** (chưa đăng nhập thì không xem được; `200` ở đây là sự cố, **DỪNG**); `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`; `Swap` vẫn 0 và `available` còn trên 3000 MB; dòng cuối giống Bước 2.1 (bằng hoặc nhỉnh hơn) nhưng migration là `89`.

Hai vòng việc nền không còn việc tồn (phải là `0` cả hai; số khác sau 1 phút thì chạy lại; vẫn khác `0` thì **DỪNG** và hỏi Claude):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$loyalty\$\$)"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$inventory\$\$) and exists (select 1 from stock_reservations r where r.invoice_id = e.aggregate_id::uuid)"'
```

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. Menu **Thanh toán** có mục **Trả hàng**; mở vào, danh sách trống ("chưa có hồ sơ"). **Không mở hồ sơ thật khi chưa có sản phẩm thật.**
2. Quầy (POS): bảng hóa đơn và một hóa đơn cũ mở bình thường.
3. Thông báo: chuông vẫn mở được.
4. Mở nhanh vài trang cũ: Lịch hẹn, Hóa đơn, Giảm giá, trang chủ khách. Không có gì đổi.

## Bước 9. Quyền: không gán cho ai

Kiểm lại rằng đúng như vậy:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in (\$\$REFUND_PRODUCTS\$\$, \$\$MANAGE_PRODUCT_RETURNS\$\$)) as vai_tro_co_quyen, (select count(*) from user_permission_overrides o join permissions p on p.id = o.permission_id where p.code::text in (\$\$REFUND_PRODUCTS\$\$, \$\$MANAGE_PRODUCT_RETURNS\$\$)) as nguoi_co_quyen_rieng, (select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text = \$\$SELL_PRODUCTS\$\$) as ban_san_pham"'
```

**Mong đợi:** `0|0|0`. Khi Owner muốn bắt đầu dùng (có sản phẩm thật, đã duyệt các mục chờ), hỏi Claude một hướng dẫn riêng cho lần thử đầu tiên: ai nhận quyền nào (`MANAGE_PRODUCT_RETURNS` cho người mở hồ sơ ở quầy; `REFUND_PRODUCTS` chỉ cho Chủ hoặc quản lý cấp cao), thử một hồ sơ trả hàng, một lần hoàn tiền nhỏ và một lần đổi hàng với dữ liệu thử, rồi kiểm kho, điểm và thông báo.

## Bước 10. Quay lại nếu có sự cố

**Đọc trước (đã thử thật, xem `PHASE6_WAVE3A_ROLLBACK_PROOF.md`):** 9 migration chỉ thêm hoặc nới, nên **bản cũ `1358725` chạy được trên cơ sở dữ liệu đã áp chúng, nhưng chỉ khi chưa có ai dùng Đợt 3a**. Có dữ liệu 3a thì bản cũ **không đọc được** trang kho của sản phẩm có phiếu nhập trả hàng, sổ điểm có dòng thu hồi, và hộp thông báo; worker cũ **không** xử lý sự kiện hoàn tiền (điểm chỉ được thu hồi khi đưa bản mới lên lại). Vì vậy: **sau lần dùng đầu tiên, quay lại phần mềm không còn là lựa chọn**; khi đó chỉ còn sửa tiếp (hỏi Claude) hoặc Cách B (mất giao dịch sau lúc sao lưu).

**Cổng kiểm (chạy trước khi quay lại phần mềm).** Chỉ làm Cách A khi **cả sáu số đều bằng 0**:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from product_return_cases) as ho_so_tra_hang, (select count(*) from product_refunds) as phieu_hoan, (select count(*) from product_exchanges) as phieu_doi, (select count(*) from stock_movements where kind in (\$\$REFUND_RETURN\$\$, \$\$EXCHANGE_RETURN\$\$)) as nhap_kho_tra_hang, (select count(*) from loyalty_ledger_entries where kind = \$\$REFUND_REVERSAL\$\$) as thu_hoi_diem, (select count(*) from notifications where type in (\$\$PRODUCT_RETURN_OPENED\$\$, \$\$PRODUCT_REFUND_MADE\$\$)) as thong_bao_moi"'
```

**Mong đợi để quay lại bằng Cách A:** `0|0|0|0|0|0`. Số nào khác `0`: **DỪNG**, không đưa bản cũ lên; hỏi Claude (sửa tiếp) hoặc dùng Cách B.

**Cách A: quay lại phần mềm, giữ nguyên cơ sở dữ liệu** (không xóa quyền nào: Đợt 3a không thêm quyền).

A1. Ngừng dùng. Nếu đã gán `MANAGE_PRODUCT_RETURNS` hoặc `REFUND_PRODUCTS` cho ai, thu hồi ở màn **Vai trò** (hoặc bằng lệnh; Owner vẫn làm được vì qua mọi kiểm tra quyền, báo Owner không mở hồ sơ trả hàng trong lúc này):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "delete from role_permissions where permission_id in (select id from permissions where code::text in (\$\$REFUND_PRODUCTS\$\$, \$\$MANAGE_PRODUCT_RETURNS\$\$))" -c "delete from user_permission_overrides where permission_id in (select id from permissions where code::text in (\$\$REFUND_PRODUCTS\$\$, \$\$MANAGE_PRODUCT_RETURNS\$\$))"'
```

**Mong đợi:** hai dòng `DELETE <số>` (số có thể là 0).

A2. Chờ hai bộ xử lý nền hết việc: chạy hai câu ở cuối Bước 7 cho đến khi **cả hai bằng `0`**; số khác `0` sau 2 phút: **DỪNG** và hỏi Claude.

A3. Dừng, đưa phần mềm về bản cũ và khởi động lại:

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
pnpm db:permissions:sync
```

**Mong đợi:** ba tiến trình `online` (web 3 dòng); `https://lucyspa.vn/vi` mở được; `Permission catalog synced: 0 inserted, 65 already present.` Cơ sở dữ liệu giữ nguyên 89 migration: bảng, cột, hàm mới ở lại, không hại gì (thư mục `returns` cũng để nguyên). Lần deploy 3a sau chỉ cần làm lại từ Bước 3.

**Cách B (chỉ khi cơ sở dữ liệu hỏng, hoặc cổng kiểm báo đã có dữ liệu 3a mà phải quay lại): khôi phục từ tệp sao lưu ở Bước 2.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất (lịch hẹn, hóa đơn, thanh toán, điểm mới, hồ sơ trả hàng).** Hỏi Claude trước khi làm. Đã thử ở máy thử trên bản sao 45 MB: `dropdb`, `createdb`, `pg_restore` khoảng 8 giây, thoát 0. Các lệnh (chỉ khi đã thống nhất):

```
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

rồi làm A3 (đưa phần mềm về `$OLD_COMMIT`) và khởi động lại cả ba. **Ảnh bằng chứng trong `/opt/lucyspa-media/returns` nằm ngoài cơ sở dữ liệu** (không mất khi khôi phục, nhưng sẽ không còn hồ sơ nào trỏ tới): hỏi Claude trước khi xóa.

**Không thể hoàn tác:** các dòng 3a đã tạo (hồ sơ, ảnh, phiếu hoàn, phiếu đổi, lô nhập lại, thu hồi điểm, thông báo) không xóa được và bản cũ không đọc được hết chúng.

## Bước 11. Báo lại cho Claude

Gửi: mã commit đang chạy, 9 dòng thời gian migration ở 4.3, dòng `89|65|0|0|0|0|0|0` ở Bước 5, `pm2 status`, kết quả Bước 6 (kể cả `KHONG_CO_ALIAS_NGINX`), kết quả Bước 7 (kể cả `401` và hai số `0` của việc tồn), kết quả `0|0|0` ở Bước 9 và đường dẫn tệp sao lưu. Claude ghi vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Worker có 3 vòng việc nền liên quan: cộng và thu hồi điểm (`loyalty`, **thêm sự kiện `PRODUCT_REFUNDED`**), cảnh báo kho và quét hạn dùng 08:00, trừ kho sau thanh toán (`inventory`). Cả ba nằm trong một tiến trình worker; chạy hai worker sẽ làm lập lịch chạy hai lần.
- Hóa đơn của một lần đổi hàng là hóa đơn bán sản phẩm tại quầy bình thường, nên phần chênh được thu bằng màn hình thu tiền và PayOS có sẵn; kho giữ khi tạo và trừ khi hóa đơn được thanh toán.
- Mật khẩu: mỗi lần hoàn tiền hoặc đổi hàng cần một lần nhập mật khẩu riêng (không còn cửa sổ 5 phút); mỗi lần hoàn tiền gửi thông báo trong ứng dụng cho Chủ.
- Nginx giữ nguyên cấu hình; API vẫn **một** tiến trình.
