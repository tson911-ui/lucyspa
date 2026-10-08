# Hướng dẫn đưa Phase 6 Đợt 3b (hàng đặt trước tại quầy, phiếu hẹn nhận hàng, quà tặng trừ kho) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; kết quả khác thì **DỪNG, không chạy tiếp, chụp màn hình gửi Claude**. Chỉ làm khi Owner quyết (deploy từng mốc, sau kiểm tra mốc 3b). **Claude không chạm vào máy chủ.**

**Bản sẽ cài:** commit `@@COMMIT@@` (viết tắt `@@COMMIT7@@`), đã push lên `main`, **CI xanh**. Các commit tài liệu đẩy sau đó (kể cả commit điền mã này) **không** được cài và không đổi mã chạy.
**Bản đang chạy:** `2076cc58ed7fd062f4b05576a67d8625e325c038` (Đợt 3a, `2076cc5`, Chủ báo triển khai 2026-10-08).
**Cơ sở dữ liệu:** thêm **6 migration** (`20261116000000` đến `20261119000001`): **89 thành 95**. **Quyền: thêm đúng một quyền, `MANAGE_PRODUCT_ORDERS` (65 thành 66)**; quyền này **chưa gán cho ai**. Các quyền có sẵn mà đợt này dùng: `SELL_PRODUCTS` (bán đặt trước ở quầy), `REFUND_PRODUCTS` (hủy dòng hàng và hoàn tiền), `MANAGE_REWARD_CATALOG` (gắn sản phẩm cho quà) và `ISSUE_REWARDS` (bấm "đã dùng"); **`SELL_PRODUCTS` và `REFUND_PRODUCTS` cũng chưa gán cho ai**, nên sau deploy chỉ tài khoản Chủ làm được các việc này.
**Khác Đợt 3a:** 4 bảng mới (đơn đặt trước, dòng đơn, lịch sử dòng đơn, phiếu hẹn nhận hàng) cộng bảng ghi nhận lần quét hằng ngày; 3 cột mới (nhà cung cấp quen thuộc của biến thể, sản phẩm gắn với quà, lượt dùng quà của phát sinh kho) và vài cột chế độ bán, nguồn giữ hàng; các giá trị mới cho loại phát sinh kho (`GIFT_OUT`, `GIFT_RETURN`), nguồn giữ hàng (`ORDER_LINE`) và quyền; thay thân các hàm kiểm tra đang chạy của dòng hóa đơn, giữ hàng, phát sinh kho, hoàn tiền và danh mục quà; bảng thông báo được **nới** thêm hai loại (hàng đặt trước đã về, nhắc hằng ngày) và một đối tượng. Mọi migration **chỉ thêm hoặc nới, không xóa dữ liệu, không ghi lại dòng cũ**.
**Thay đổi chạy:** API, worker và web đều có mã mới. Không có tiến trình pm2 mới; worker có thêm **một lần quét mỗi sáng 08:00 theo giờ chi nhánh** (nhắc đơn trễ hẹn, hàng chờ nhận quá 7 ngày) trong vòng cảnh báo kho có sẵn. **Có một thư viện mới** (`qrcode`, vẽ mã QR ngay trong trình duyệt của nhân viên): `pnpm install` sẽ tải thêm nó, nên máy chủ cần có mạng ở Bước 3. Không có thư mục, biến môi trường hay cấu hình nginx mới.
**Trang công khai mới:** `/vi/ticket/<mã bí mật>` (phiếu hẹn nhận hàng của khách vãng lai): chỉ đọc, không lưu bộ nhớ đệm, không lập chỉ mục, giới hạn tần suất như các trang công khai khác. Mã sai, đã thu hồi hay không có đều ra cùng trang "không tìm thấy phiếu".
**Sau deploy quầy vẫn như cũ:** không ai bán được hàng đặt trước, xử lý đơn hay hoàn tiền ngoài tài khoản Chủ (quyền chưa gán). Quà tặng đã có không đổi: chỉ quà **được gắn sản phẩm** mới trừ kho, và hiện chưa quà nào được gắn. Owner tự quyết khi nào gán quyền, và gán cho ai.
**Thời gian:** khoảng 40 phút (cài và build vài phút, diễn tập vài giây). Website hiện chỉ dùng nội bộ, nên **làm lúc nào cũng được**. Lúc khởi động lại API (vài giây) POS gián đoạn ngắn; nếu có nhân viên đang dùng thì báo trước.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `@@COMMIT@@` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã đọc `docs/PHASE6_WAVE3B_MILESTONE.md` và `docs/PHASE6_WAVE3B_ROLLBACK_PROOF.md` (cách quay lại đã thử thật).
- Các cách hiểu kỹ thuật P15-1 đến P18-5 (`docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`, mục 2.30 đến 2.33) và bốn câu hỏi mở (liên kết phiếu có hết hạn không; có gửi email báo hàng về không; hoàn đủ hay trừ phí khi khách đổi ý sau khi đã đặt hàng; có cho "người dùng hệ thống" tự cấp hàng chạy ngầm không) **chưa được Chủ duyệt, nhưng không ảnh hưởng việc deploy**: các quyền chưa gán cho ai. **Chỉ gán quyền cho nhân viên sau khi Chủ trả lời.**
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

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `2076cc5`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB; `Swap` 0; thư mục `/opt/lucyspa-media` có thật. Ghi lại mã cũ (để quay lại):

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

Lưu danh sách tiến trình hiện tại:

```
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-phase6-dot3b-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** một dòng dạng `9|4|2|2|29|65|89` (quyền **65**, migration **89**; số người dùng, lịch hẹn, hóa đơn có thể nhỉnh hơn nếu đã dùng thêm).

2.2. Tạo và kiểm tra bản sao lưu:

```
export BACKUP=/root/backups/lucyspa-pre-phase6-dot3b-$(date -u +%Y%m%dT%H%M%SZ).dump
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
git checkout @@COMMIT@@
git rev-parse HEAD
```

**Mong đợi:** in đúng mã 40 ký tự (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện (**có một thư viện mới, `qrcode`**: cần có mạng) và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`; phần cài có thể in `+ qrcode`. Báo `ERR` ở bước cài (mất mạng, hết chỗ): **DỪNG** (cơ sở dữ liệu chưa bị đụng tới).

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

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 6 migration chờ** (`20261116000000_phase6_wave3b_order_kinds`, `20261116000001_phase6_wave3b_product_orders`, `20261117000000_phase6_wave3b_order_tickets`, `20261118000000_phase6_wave3b_order_actions`, `20261119000000_phase6_wave3b_gift_kinds`, `20261119000001_phase6_wave3b_gift_stock`; báo "chưa áp" ở đây là bình thường); `db:deploy` kết thúc `All migrations have been successfully applied.`; `db:permissions:sync` in `Permission catalog synced: 1 inserted, 65 already present.` (đúng **1** quyền mới).

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name >= \$\$20261116\$\$ order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from notifications) as notifications, (select count(*) from invoices) as invoices, (select count(*) from invoices where channel = \$\$COUNTER\$\$ and shipping_fee_vnd = 0 and kind <> \$\$PRODUCT_SALE\$\$) as invoices_untouched"'
```

**Mong đợi:** dòng `grep -c` in `0` (khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); 6 dòng `tên|số giây` (**ghi lại cả 6 dòng gửi Claude**); dòng cuối `95|66|<số thông báo như Bước 2.1>|<số hóa đơn như Bước 2.1>|<cùng số hóa đơn>`. Diễn tập ở máy thử (bản sao 234 MB: 300.000 thông báo, 20.000 hóa đơn đã thanh toán; mã cũ `2076cc5`): 6 migration cộng lại khoảng 0,43 giây (chậm nhất `20261118000000` 0,235 giây vì kiểm lại thông báo và hoàn tiền; còn lại dưới 0,09 giây); `db:deploy` toàn lệnh 3 giây. **Quá 60 giây ở bất kỳ migration nào, hoặc số khác: DỪNG.**

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
```

## Bước 5. Áp migration vào cơ sở dữ liệu thật

Các migration ngắn (dưới 1 giây); nếu có người đang thu tiền thì báo họ chờ.

```
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `0`; `db:status` liệt kê đúng 6 tên như 4.2. Khác: **DỪNG**.

```
pnpm db:deploy
pnpm db:status
pnpm db:permissions:sync
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from product_orders) as don_dat_truoc, (select count(*) from product_order_tickets) as phieu_hen, (select count(*) from product_refunds where order_line_id is not null) as hoan_tien_theo_don, (select count(*) from stock_movements where kind in (\$\$GIFT_OUT\$\$, \$\$GIFT_RETURN\$\$)) as phat_sinh_qua, (select count(*) from stock_reservations where source = \$\$ORDER_LINE\$\$) as giu_hang_don, (select count(*) from invoice_line_products where fulfilment_mode = \$\$PRE_ORDER\$\$) as dong_dat_truoc, (select count(*) from reward_catalog_items where variant_id is not null) as qua_gan_san_pham, (select count(*) from product_variants where usual_supplier_id is not null) as nha_cung_cap_quen, (select count(*) from notifications where type in (\$\$PRODUCT_ORDER_ARRIVED\$\$, \$\$PRODUCT_ORDER_ALERT\$\$) or entity_type = \$\$ProductOrder\$\$) as thong_bao_moi"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; `Permission catalog synced: 1 inserted, 65 already present.`; dòng cuối `95|66|0|0|0|0|0|0|0|0|0` (95 migration, **66** quyền, chưa có đơn đặt trước, phiếu hẹn, hoàn tiền theo đơn, phát sinh kho của quà, giữ hàng cho đơn, dòng đặt trước, quà gắn sản phẩm, nhà cung cấp quen thuộc hay thông báo mới). Có lỗi: **DỪNG, không chạy lại**, xem Bước 10.

## Bước 6. Khởi động lại

Không có thư mục mới và không có cấu hình nginx mới. Khởi động lại (API và worker, rồi web), kiểm tra quyền:

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

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online`; không có dòng lỗi mới sau lúc khởi động lại (**ngoại lệ vô hại:** tối đa vài dòng `Booking notification job failed` với `could not obtain lock on row in relation "visits"` ở **giây đầu** của worker, nếu có sự kiện đặt lịch tồn hoặc lượt đến đang làm dịch vụ; hành vi đã có từ trước, tự hết sau 1 đến 2 giây, không mất gì; dòng lỗi **lặp lại mãi** hoặc lỗi khác thì **DỪNG**); `Permission catalog synced: 0 inserted, 66 already present.` **Không bao giờ chạy `pm2 scale lucyspa-worker` hoặc `pm2 scale lucyspa-api`**: lập lịch của worker sẽ chạy hai lần. Báo nhân viên (nếu có) thu tiền lại được.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "phieu sai ma (web): %{http_code}\n" http://127.0.0.1:3000/vi/ticket/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
curl -s -o /dev/null -w "phieu sai ma (API): %{http_code}\n" http://127.0.0.1:3001/api/v1/public/product-order-tickets/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
curl -s -o /dev/null -w "hang doi khi chua dang nhap: %{http_code}\n" "http://127.0.0.1:3001/api/v1/product-orders/context"
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng `200`; **hai dòng "phieu sai ma" đều in `404`** (mã giả không có phiếu; `200` ở đây là sự cố, **DỪNG**; nếu dòng của API in `429` thì chờ 1 phút rồi chạy lại riêng dòng đó); dòng "hang doi khi chua dang nhap" in **`401`**; `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`; `Swap` vẫn 0 và `available` còn trên 3000 MB; dòng cuối giống Bước 2.1 (bằng hoặc nhỉnh hơn) nhưng quyền `66` và migration `95`.

Hai vòng việc nền không còn việc tồn (phải là `0` cả hai; số khác sau 1 phút thì chạy lại; vẫn khác `0` thì **DỪNG** và hỏi Claude):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$loyalty\$\$)"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$inventory\$\$) and exists (select 1 from stock_reservations r where r.invoice_id = e.aggregate_id::uuid)"'
```

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. Menu **Thanh toán** có mục mới **Hàng đặt trước** (giữa "Điểm thưởng" và "Trả hàng"); mở vào, các nhóm Cần đặt, Đã đặt, Hàng đã về, Đã giao, Đã hủy đều trống. **Chưa bán đặt trước thật khi chưa có sản phẩm thật và chưa quyết các câu hỏi mở.**
2. **Điểm thưởng, Danh mục quà, Thêm quà:** chọn loại "Quà hiện vật" thì có ô **"Sản phẩm trừ kho"** (để trống thì không trừ kho). **Chưa gắn sản phẩm cho quà thật** trước khi Owner xác nhận cách trừ kho (mục 2.33).
3. **Sản phẩm, sửa biến thể:** có ô **"Nhà cung cấp quen thuộc"** (không bắt buộc).
4. Quầy (POS): bảng hóa đơn và một hóa đơn cũ mở bình thường. Thông báo: chuông vẫn mở được.
5. Mở nhanh vài trang cũ: Lịch hẹn, Hóa đơn, Giảm giá, Trả hàng, trang chủ khách. Không có gì đổi.

## Bước 9. Quyền: không gán cho ai

Kiểm lại rằng đúng như vậy:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text in (\$\$MANAGE_PRODUCT_ORDERS\$\$, \$\$REFUND_PRODUCTS\$\$, \$\$MANAGE_PRODUCT_RETURNS\$\$, \$\$SELL_PRODUCTS\$\$)) as vai_tro_co_quyen, (select count(*) from user_permission_overrides o join permissions p on p.id = o.permission_id where p.code::text in (\$\$MANAGE_PRODUCT_ORDERS\$\$, \$\$REFUND_PRODUCTS\$\$, \$\$MANAGE_PRODUCT_RETURNS\$\$, \$\$SELL_PRODUCTS\$\$)) as nguoi_co_quyen_rieng"'
```

**Mong đợi:** `0|0`. Khi Owner muốn bắt đầu dùng (có sản phẩm thật, đã trả lời các câu hỏi mở), hỏi Claude một hướng dẫn riêng cho lần thử đầu tiên: ai nhận quyền nào (`SELL_PRODUCTS` cho thu ngân bán đặt trước; `MANAGE_PRODUCT_ORDERS` cho người đặt hàng và giao hàng; `REFUND_PRODUCTS` chỉ cho Chủ hoặc quản lý cấp cao), thử một đơn đặt trước từ lúc bán đến lúc giao, một lần hủy và hoàn tiền nhỏ, và một quà gắn sản phẩm, rồi kiểm kho, điểm và thông báo.

## Bước 10. Quay lại nếu có sự cố

**Đọc trước (đã thử thật, xem `PHASE6_WAVE3B_ROLLBACK_PROOF.md`):** 6 migration chỉ thêm hoặc nới, nên **bản cũ `2076cc5` chạy được trên cơ sở dữ liệu đã áp chúng, nhưng chỉ khi chưa có ai dùng Đợt 3b** và sau khi **xóa dòng quyền mới `MANAGE_PRODUCT_ORDERS`** (bước A1; bản cũ chỉ biết 65 quyền). Có dữ liệu 3b thì bản cũ **không đọc được** nhiều chỗ (phát sinh kho của quà, giữ hàng cho đơn, dòng đặt trước của hóa đơn, thông báo mới) và không có chỗ nào để xử lý đơn đặt trước. Vì vậy: **sau lần dùng đầu tiên, quay lại phần mềm không còn là lựa chọn**; khi đó chỉ còn sửa tiếp (hỏi Claude) hoặc Cách B (mất giao dịch sau lúc sao lưu).

**Cổng kiểm (chạy trước khi quay lại phần mềm).** Chỉ làm Cách A khi **cả chín số đều bằng 0**:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from product_orders) as don_dat_truoc, (select count(*) from product_order_tickets) as phieu_hen, (select count(*) from product_refunds where order_line_id is not null) as hoan_tien_theo_don, (select count(*) from stock_movements where kind in (\$\$GIFT_OUT\$\$, \$\$GIFT_RETURN\$\$)) as phat_sinh_qua, (select count(*) from stock_reservations where source = \$\$ORDER_LINE\$\$) as giu_hang_don, (select count(*) from invoice_line_products where fulfilment_mode = \$\$PRE_ORDER\$\$) as dong_dat_truoc, (select count(*) from reward_catalog_items where variant_id is not null) as qua_gan_san_pham, (select count(*) from product_variants where usual_supplier_id is not null) as nha_cung_cap_quen, (select count(*) from notifications where type in (\$\$PRODUCT_ORDER_ARRIVED\$\$, \$\$PRODUCT_ORDER_ALERT\$\$) or entity_type = \$\$ProductOrder\$\$) as thong_bao_moi"'
```

**Mong đợi để quay lại bằng Cách A:** `0|0|0|0|0|0|0|0|0`. Số nào khác `0`: **DỪNG**, không đưa bản cũ lên; hỏi Claude (sửa tiếp) hoặc dùng Cách B.

**Cách A: quay lại phần mềm, giữ nguyên cơ sở dữ liệu.**

A1. Ngừng dùng. Xóa mọi gán của quyền mới và **dòng quyền mới** (bản cũ chỉ biết 65 quyền; Owner vẫn làm được mọi việc vì qua mọi kiểm tra quyền). Nếu đã gán `SELL_PRODUCTS` hoặc `REFUND_PRODUCTS` cho ai thì thu hồi ở màn **Vai trò** (hai quyền này bản cũ vẫn biết):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "delete from role_permissions where permission_id in (select id from permissions where code::text = \$\$MANAGE_PRODUCT_ORDERS\$\$)" -c "delete from user_permission_overrides where permission_id in (select id from permissions where code::text = \$\$MANAGE_PRODUCT_ORDERS\$\$)" -c "delete from permissions where code::text = \$\$MANAGE_PRODUCT_ORDERS\$\$" -c "select count(*) from permissions"'
```

**Mong đợi:** ba dòng `DELETE <số>` (số đầu và số hai có thể là 0, số thứ ba là `1`) và cuối cùng `65`.

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

**Mong đợi:** ba tiến trình `online` (web 3 dòng); `https://lucyspa.vn/vi` mở được; `Permission catalog synced: 0 inserted, 65 already present.` Cơ sở dữ liệu giữ nguyên 95 migration: bảng, cột, hàm mới ở lại, không hại gì. Lần deploy 3b sau chỉ cần làm lại từ Bước 3 (quyền mới sẽ được thêm lại ở Bước 5).

**Cách B (chỉ khi cơ sở dữ liệu hỏng, hoặc cổng kiểm báo đã có dữ liệu 3b mà phải quay lại): khôi phục từ tệp sao lưu ở Bước 2.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất (lịch hẹn, hóa đơn, thanh toán, điểm mới, đơn đặt trước, hoàn tiền).** Hỏi Claude trước khi làm. Đã thử ở máy thử trên bản sao 45 MB: `dropdb`, `createdb`, `pg_restore` khoảng 11 giây, thoát 0. Các lệnh (chỉ khi đã thống nhất):

```
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

rồi làm A3 (đưa phần mềm về `$OLD_COMMIT`) và khởi động lại cả ba. Ảnh bằng chứng trả hàng trong `/opt/lucyspa-media/returns` nằm ngoài cơ sở dữ liệu và không bị đụng tới.

**Không thể hoàn tác:** các dòng 3b đã tạo (đơn, dòng đơn, lịch sử, phiếu hẹn, hoàn tiền theo đơn, giữ hàng, phát sinh kho của quà, thông báo) không xóa được và bản cũ không đọc được hết chúng.

## Bước 11. Báo lại cho Claude

Gửi: mã commit đang chạy, 6 dòng thời gian migration ở 4.3, dòng `95|66|0|0|0|0|0|0|0|0|0` ở Bước 5, `pm2 status`, kết quả Bước 7 (kể cả hai số `404`, số `401` và hai số `0` của việc tồn), kết quả `0|0` ở Bước 9 và đường dẫn tệp sao lưu. Claude ghi vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Worker có 3 vòng việc nền liên quan: cộng và thu hồi điểm (`loyalty`), cảnh báo kho và quét hạn dùng 08:00 **cộng quét đơn đặt trước 08:00** (cùng vòng, một dòng ghi nhận mỗi chi nhánh mỗi ngày), trừ kho sau thanh toán và sau khi giao hàng đặt trước (`inventory`, thêm sự kiện `INVOICE_ORDER_HANDED_OVER`). Cả ba nằm trong một tiến trình worker; chạy hai worker sẽ làm lập lịch chạy hai lần.
- Hàng về không do worker cấp: xác nhận phiếu nhập kho giữ hàng cho đơn trả tiền sớm nhất ngay trong giao dịch đó; hủy một dòng đã giữ hàng chuyển hàng cho đơn kế; nút "Cấp hàng" cho các trường hợp khác.
- Trang phiếu công khai đọc API qua địa chỉ nội bộ và chuyển tiếp địa chỉ khách (`X-Forwarded-For`) để giới hạn tần suất tính theo từng khách: cần nginx đã gửi `X-Forwarded-For` (đã yêu cầu từ Đợt 1, OQ-57).
- Nginx giữ nguyên cấu hình; API vẫn **một** tiến trình.
