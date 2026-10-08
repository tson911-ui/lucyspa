# Hướng dẫn đưa Phase 6 Đợt 2 (bán sản phẩm tại quầy, trừ kho, điểm Lucy Beauty) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; kết quả khác thì **DỪNG, không chạy tiếp, chụp màn hình gửi Claude**. Chỉ làm khi Owner quyết (Owner chốt 2026-10-07: deploy từng đợt, sau kiểm tra mốc của mỗi đợt). **Claude không chạm vào máy chủ.**

**Bản sẽ cài:** commit `<MÃ_COMMIT_MỚI>` (điền sau khi Owner push lên `main` và CI xanh; các commit tài liệu đẩy sau đó không đổi mã chạy).
**Bản đang chạy:** `6546c434595cef5c7ab764d8e5e7cc4b62afe256` (Đợt 1, theo `LUCYSPA_HANDOFF.md`).
**Cơ sở dữ liệu:** thêm **7 migration** (`20261107000000` đến `20261110000000`): **73 thành 80**. **Quyền: không thêm quyền nào** (vẫn 65; `SELL_PRODUCTS` đã có từ Đợt 1 và **chưa gán cho ai**).
**Khác Đợt 1:** Đợt 1 chỉ _thêm_ bảng mới. **Đợt 2 sửa chính các bảng đang thu tiền thật**: hóa đơn (thêm 2 cột, thay một ràng buộc tiền), khóa dùng ưu đãi, bảng thông báo (nới 2 ràng buộc), kho (thêm cột và 2 loại phiếu), các hàm kiểm tra của thanh toán. Mọi migration đều **chỉ thêm hoặc nới, không xóa dữ liệu, không ghi lại dòng cũ**; hóa đơn chỉ có dịch vụ vẫn tính bằng bộ tính cũ (bộ mới chạy ngầm để so, không bao giờ đổi số tiền).
**Thay đổi chạy:** API, worker và web đều có mã mới. **Worker có thêm một vòng việc mới** (trừ kho sau khi thanh toán) **nằm trong chính tiến trình `lucyspa-worker`**, không có tiến trình pm2 mới; worker cũng cộng điểm Lucy Beauty. Không có thư viện mới (`pnpm install` không tải gì thêm).
**Sau deploy quầy vẫn như cũ:** **quyền `SELL_PRODUCTS` không gán cho ai** (chưa có sản phẩm thật, các sản phẩm sẽ có sau Phase 9; bán thử có giám sát được hoãn), nên không ai thấy nút bán sản phẩm; thẻ Lucy Beauty của khách đổi chữ "Áp dụng khi Lucy Beauty mở bán" thành phần trăm hạng thật; màn hình giảm giá có thêm ô "Phạm vi".
**Thời gian:** khoảng 40 phút (build vài phút, diễn tập vài phút). Website hiện chỉ dùng nội bộ (chưa có khách), nên **làm lúc nào cũng được**. Lúc khởi động lại API (vài giây) POS gián đoạn ngắn; nếu có nhân viên đang dùng thì báo trước.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `<MÃ_COMMIT_MỚI>` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã đọc `docs/PHASE6_WAVE2_MILESTONE.md` và `docs/PHASE6_WAVE2_ROLLBACK_PROOF.md` (cách quay lại đã thử thật).
- Nếu có nhân viên đang thu tiền ở quầy, báo họ tạm dừng khoảng 10 phút ở Bước 5 và 6.

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
free -m
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `6546c43`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB; `Swap` 0. Ghi lại mã cũ (để quay lại):

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

Lưu danh sách tiến trình hiện tại:

```
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-phase6-dot2-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** một dòng dạng `9|4|2|2|28|65|73` (quyền **65**, migration **73**).

2.2. Tạo và kiểm tra bản sao lưu:

```
export BACKUP=/root/backups/lucyspa-pre-phase6-dot2-$(date -u +%Y%m%dT%H%M%SZ).dump
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

Khôi phục bản sao lưu ở Bước 2 vào một cơ sở dữ liệu tạm cùng container, chạy đúng các lệnh migration lên đó và đo thời gian từng migration.

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

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (in tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 7 migration chờ** (`20261107000000_phase6_wave2_invoice_kinds`, `…07000001_phase6_wave2_product_sales`, `20261108000000_phase6_wave2_discount_scope`, `…08000001_phase6_wave2_pricing_v3`, `20261109000000_phase6_wave2_stock_sale_kinds`, `…09000001_phase6_wave2_stock_consumption`, `20261110000000_phase6_wave2_expired_lot_alert`; báo "chưa áp" ở đây là bình thường); `db:deploy` kết thúc `All migrations have been successfully applied.`; `db:permissions:sync` in `Permission catalog synced: 0 inserted, 65 already present.`

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name >= \$\$20261107\$\$ order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from notifications) as notifications, (select count(*) from invoices) as invoices, (select count(*) from invoices where channel = \$\$COUNTER\$\$ and shipping_fee_vnd = 0 and kind <> \$\$PRODUCT_SALE\$\$) as invoices_untouched"'
```

**Mong đợi:** dòng `grep -c` in `0` (nếu in số khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); 7 dòng `tên|số giây` (**ghi lại cả 7 dòng gửi Claude**); dòng cuối `80|65|<số thông báo như Bước 2.1>|<số hóa đơn như Bước 2.1>|<cùng số hóa đơn>` (mọi hóa đơn cũ vẫn là hóa đơn quầy, phí vận chuyển 0). Diễn tập ở máy thử (bản sao 233 MB: 300.000 thông báo, 20.000 hóa đơn đã thanh toán kèm dòng và thanh toán; mã cũ `6546c43`): mỗi migration dưới 0,2 giây, cả 7 cộng lại khoảng 0,4 giây, lớn nhất là `…10000000` (kiểm lại bảng thông báo) 0,18 giây; `db:deploy` toàn lệnh 3 giây. **Quá 60 giây ở bất kỳ migration nào, hoặc số khác: DỪNG.**

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
```

## Bước 5. Áp migration vào cơ sở dữ liệu thật

Các migration khóa bảng hóa đơn rất ngắn (dưới 1 giây); nếu có người đang thu tiền thì báo họ chờ.

```
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `0`; `db:status` liệt kê đúng 7 tên như 4.2. Khác: **DỪNG**.

```
pnpm db:deploy
pnpm db:status
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from invoice_lines where kind = \$\$PRODUCT\$\$) as product_lines, (select count(*) from invoices where channel <> \$\$COUNTER\$\$ or shipping_fee_vnd <> 0 or kind = \$\$PRODUCT_SALE\$\$) as product_invoices, (select count(*) from stock_movements where kind in (\$\$SALE\$\$, \$\$SALE_REVERSAL\$\$)) as sale_movements"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; dòng cuối `80|65|0|0|0` (80 migration, quyền **vẫn 65**, chưa có dòng sản phẩm nào trên hóa đơn, chưa có hóa đơn sản phẩm, chưa có phiếu xuất kho bán hàng). Có lỗi: **DỪNG, không chạy lại**, xem Bước 9.

## Bước 6. Khởi động lại (API và worker, rồi web), kiểm tra quyền

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

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online`; không có dòng lỗi mới sau lúc khởi động lại (đặc biệt không có chữ `Inventory sales job failed`); `Permission catalog synced: 0 inserted, 65 already present.` **Không bao giờ chạy `pm2 scale lucyspa-worker` hoặc `pm2 scale lucyspa-api`**: lập lịch của worker sẽ chạy hai lần. Báo nhân viên (nếu có) thu tiền lại được.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng `200`; `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`; `Swap` vẫn 0 và `available` còn trên 3000 MB; dòng cuối giống Bước 2.1 (số liệu bằng hoặc nhỉnh hơn) nhưng migration là `80`.

Kiểm tra hai vòng việc nền không còn việc tồn (phải là `0` cả hai; nếu là số khác sau 1 phút, chạy lại; vẫn khác `0` thì **DỪNG** và hỏi Claude):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$loyalty\$\$)"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$inventory\$\$) and exists (select 1 from stock_reservations r where r.invoice_id = e.aggregate_id::uuid)"'
```

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. Quầy (POS): bảng hóa đơn và một hóa đơn cũ mở bình thường; **chưa có nút "Bán sản phẩm"** với bất kỳ ai (chưa ai có quyền `SELL_PRODUCTS`).
2. Tài khoản của một khách hội viên: **Điểm thưởng và ưu đãi**: thẻ Lucy Beauty hiện đúng phần trăm hạng của ví Beauty (hoặc "Chưa có"), không còn chữ "Áp dụng khi Lucy Beauty mở bán".
3. Giảm giá: tạo hoặc mở một chương trình, có ô **Phạm vi** (Dịch vụ, Sản phẩm, Cả hai); chương trình cũ vẫn là "Dịch vụ".
4. Mở nhanh vài trang cũ: Lịch hẹn, Hóa đơn, trang chủ khách. Không có gì đổi.

## Bước 9. Bán thử có giám sát: HOÃN, không làm trong lần deploy này

Chủ quyết (2026-10-08): chưa có sản phẩm thật (sẽ có sau Phase 9), nên **bán thử có giám sát (OQ-60) được hoãn**. **Quyền `SELL_PRODUCTS` vẫn không gán cho ai sau khi deploy.** Kiểm lại rằng đúng như vậy:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id where p.code::text = \$\$SELL_PRODUCTS\$\$) as vai_tro_co_quyen, (select count(*) from user_permission_overrides o join permissions p on p.id = o.permission_id where p.code::text = \$\$SELL_PRODUCTS\$\$) as nguoi_co_quyen_rieng"'
```

**Mong đợi:** `0|0`. (Chủ tài khoản Owner vẫn có mọi quyền theo thiết kế; không tạo hóa đơn bán sản phẩm khi chưa có sản phẩm thật.) Khi nào có sản phẩm thật và Chủ muốn bắt đầu bán, hỏi Claude một hướng dẫn riêng cho lần bán thử đầu tiên (cấp quyền cho một người, bán một sản phẩm, đảo khoản thu, hủy hóa đơn, kiểm tra kho). Lưu ý đến lúc đó: **trả hàng và hoàn tiền sản phẩm chưa có** (Đợt 3), và **sau hóa đơn bán sản phẩm đầu tiên, quay lại phần mềm cũ không còn là lựa chọn** (xem Bước 10).

## Bước 10. Quay lại nếu có sự cố

**Đọc trước (đã thử thật, xem `PHASE6_WAVE2_ROLLBACK_PROOF.md`):** 7 migration chỉ thêm hoặc nới, nên **bản cũ `6546c43` chạy được trên cơ sở dữ liệu đã áp chúng, nhưng chỉ khi chưa có ai dùng Đợt 2**. Chỉ cần một hóa đơn bán sản phẩm, một dòng sản phẩm hoặc một phiếu xuất kho bán hàng, bản cũ báo lỗi 503 ở bảng POS, chi tiết hóa đơn và trang kho; worker cũ còn cộng điểm **Spa** (thay vì Beauty) cho tiền sản phẩm. Vì vậy: **sau lần bán đầu tiên, quay lại phần mềm không còn là lựa chọn**; khi đó chỉ còn sửa tiếp (hỏi Claude) hoặc Cách B (mất giao dịch sau lúc sao lưu).

**Cổng kiểm (chạy trước khi quay lại phần mềm).** Chỉ làm Cách A khi **cả năm số đều bằng 0**:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from invoices where kind = \$\$PRODUCT_SALE\$\$) as hoa_don_san_pham, (select count(*) from invoice_lines where kind = \$\$PRODUCT\$\$) as dong_san_pham, (select count(*) from stock_movements where kind in (\$\$SALE\$\$, \$\$SALE_REVERSAL\$\$)) as phieu_xuat_kho, (select count(*) from discount_versions v join discounts d on d.id = v.discount_id where v.scope <> \$\$SERVICES\$\$ and d.is_active) as chuong_trinh_san_pham_dang_chay, (select count(*) from notifications where type = \$\$EXPIRED_LOT_SOLD\$\$) as thong_bao_lo_het_han"'
```

**Mong đợi để quay lại bằng Cách A:** `0|0|0|0|0`. Ba số đầu khác `0`: **DỪNG**, không đưa bản cũ lên; hỏi Claude. Số thứ tư khác `0`: kết thúc các chương trình giảm giá đó ở màn **Ưu đãi** trước (bản cũ không biết "phạm vi" và sẽ áp chúng cho dịch vụ). Số thứ năm khác `0`: vô hại (bản cũ bỏ qua thông báo loại lạ), nhưng ghi lại.

**Cách A: quay lại phần mềm, giữ nguyên cơ sở dữ liệu** (không xóa quyền nào: Đợt 2 không thêm quyền).

A1. Ngừng bán. Thu hồi quyền **Bán sản phẩm** ở màn **Vai trò** (có hiệu lực ngay), hoặc bằng lệnh; **Owner vẫn bán được** (Owner qua mọi kiểm tra quyền), nên báo Owner không bán sản phẩm trong lúc này:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "delete from role_permissions where permission_id = (select id from permissions where code::text = \$\$SELL_PRODUCTS\$\$)" -c "delete from user_permission_overrides where permission_id = (select id from permissions where code::text = \$\$SELL_PRODUCTS\$\$)"'
```

**Mong đợi:** hai dòng `DELETE <số>` (số có thể là 0 ngay sau lần deploy đầu, khi chưa ai có quyền).

A2. Chờ hai bộ xử lý nền hết việc: chạy hai câu ở cuối Bước 7 cho đến khi **cả hai bằng `0`**. Số khác `0` sau 2 phút: **DỪNG** và hỏi Claude (không đưa bản cũ lên khi còn việc tồn, vì bản cũ không biết trừ kho).

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

**Mong đợi:** ba tiến trình `online` (web 3 dòng); `https://lucyspa.vn/vi` mở được; `Permission catalog synced: 0 inserted, 65 already present.` Cơ sở dữ liệu giữ nguyên 80 migration: bảng, cột và hàm mới ở lại, không hại gì. Lần deploy Đợt 2 sau chỉ cần làm lại từ Bước 3.

**Cách B (chỉ khi cơ sở dữ liệu hỏng, hoặc cổng kiểm báo đã có dữ liệu Đợt 2 mà phải quay lại): khôi phục từ tệp sao lưu ở Bước 2.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất (lịch hẹn, hóa đơn, thanh toán, điểm mới).** Hỏi Claude trước khi làm. Đã thử ở máy thử trên bản sao 45 MB (20.000 hóa đơn, 300.000 thông báo): `dropdb`, `createdb`, `pg_restore` mất 16 giây, thoát 0, về đúng 73 migration, 65 quyền. Các lệnh (chỉ khi đã thống nhất):

```
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

rồi làm A3 (đưa phần mềm về `$OLD_COMMIT`) và khởi động lại cả ba.

**Không thể hoàn tác:** các dòng Đợt 2 đã tạo (hóa đơn bán sản phẩm, phiếu kho, điểm Beauty, bản chụp hạng) không xóa được và bản cũ không đọc được chúng. Chỉ mục "một lần dùng ưu đãi cho mỗi hóa đơn" của Đợt 1 không được dựng lại (khóa đã mở rộng); bản cũ vẫn chạy bình thường.

## Bước 11. Báo lại cho Claude

Gửi: mã commit đang chạy, 7 dòng thời gian migration ở 4.3, dòng `80|65|0|0|0` ở Bước 5, `pm2 status`, kết quả Bước 7 (kể cả hai số `0` của việc tồn), kết quả `0|0` ở Bước 9 và đường dẫn tệp sao lưu. Claude ghi vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Worker có 3 vòng việc nền liên quan: cộng điểm (`loyalty`), cảnh báo kho và quét hạn dùng 08:00, **trừ kho sau thanh toán (`inventory`, mới)**. Vòng mới chỉ đọc hóa đơn _có giữ hàng_, nên không đọc lại lịch sử hóa đơn dịch vụ. Cả ba nằm trong một tiến trình worker; chạy hai worker sẽ làm lập lịch chạy hai lần.
- Tồn kho khi lô đã hết hạn: hàng vẫn được xuất (để tồn khớp sau thanh toán) nhưng **ngay lúc đó hệ thống gửi thông báo trong ứng dụng** cho những người có quyền xem kho ở chi nhánh, nêu hóa đơn, sản phẩm và lô (Chủ đổi OQ-75 ngày 2026-10-08).
- API vẫn **một** tiến trình (OQ-58: chưa chạy nhiều tiến trình API trong Đợt 2).
- Nginx giữ nguyên cấu hình của Đợt 1.
