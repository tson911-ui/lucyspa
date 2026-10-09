# Hướng dẫn đưa Phase 6 Đợt 4 (bán hàng online, gửi hàng, giao thất bại, khuyến mãi) lên máy chủ thật

> **CHƯA TRIỂN KHAI.** Mã commit và lần chạy CI đã điền (Claude, 2026-10-09).

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG** và gửi cho Claude kết quả. Mọi lệnh dưới đây Claude **chưa** chạy trên máy chủ thật (chỉ diễn tập trên bản sao ở máy phát triển).

**Bản sẽ cài:** commit `4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44`, đã push lên `main`, **CI xanh** (2026-10-09, lần chạy `37893962042`). Các commit tài liệu đẩy sau đó (kể cả commit điền mã này) không đổi mã chạy.
**Bản đang chạy:** `43a1b29cef128d5555e1fd69b927d62c0ab276e5` (Đợt 3b, `43a1b29`, Chủ báo triển khai 2026-10-09).
**Một lần triển khai duy nhất** (Chủ chọn ngày 2026-10-09: không tách 4a và 4b), kèm phần bổ sung 3b chưa đẩy lên (migration 96).
**Cơ sở dữ liệu:** thêm **6 migration**: `20261120000000_phase6_wave3b_changed_mind_refund`, `20261121000000_phase6_wave4_kinds`, `20261121000001_phase6_wave4_online_checkout`, `20261122000000_phase6_wave4_fulfilment`, `20261123000000_phase6_wave4_refunds_returns`, `20261124000000_phase6_wave4_campaigns`: **95 thành 101**. **Quyền: không thêm quyền nào (vẫn 66).** Tất cả chỉ thêm hoặc nới; không xóa, không sửa dòng dữ liệu nào đang có (một dòng cài đặt mới: **"Bán online" TẮT**). Trên bản sao 20.000 hóa đơn, cả sáu migration chạy trong khoảng 1,5 giây.
**Không có thư viện mới, không có tiến trình pm2 mới, không đổi nginx, không đổi `.env`.** PayOS đã chạy từ trước nên webhook và khóa giữ nguyên.
**Thay đổi chạy:** API, worker và web đều có mã mới. Worker có thêm hai việc nền (hủy đơn online quá hạn 30 phút, mỗi 30 giây; quét đơn online mỗi sáng 08:00 theo giờ chi nhánh). **Worker vẫn đúng một tiến trình** (hai worker làm lập lịch chạy hai lần).
**Sau khi triển khai, cửa hàng online VẪN ĐÓNG:** công tắc **"Bán online" tắt**. Khách thấy sản phẩm như cũ, nút mua ghi "Mua tại cửa hàng". Chỉ Owner mở khi sẵn sàng (Bước 9).
**Thời gian:** khoảng 45 phút. Trong lúc áp migration (Bước 5) API và worker **dừng khoảng 2 phút**: POS tạm gián đoạn; báo nhân viên.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã đọc `docs/PHASE6_WAVE4_ROLLBACK_PROOF.md` (cách quay lại đã thử thật: **chỉ quay lui được khi chưa có đơn online nào**) và danh sách "chờ Chủ xem lại" ở cuối `docs/PHASE6_OWNER_DECISIONS_VI.md` (các cách hiểu kỹ thuật W4-1 đến W4-12 và 4 câu hỏi mở).
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

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `43a1b29`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB; `Swap` bằng 0 là bình thường.

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-phase6-dot4-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations where finished_at is not null) as migrations"'
```

**Mong đợi:** một dòng dạng `…|…|…|…|…|66|95` (quyền **66**, migration **95**).

2.2. Tạo và kiểm tra bản sao lưu:

```
export BACKUP=/root/backups/lucyspa-pre-phase6-dot4-$(date -u +%Y%m%dT%H%M%SZ).dump
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
git checkout 4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44
git rev-parse HEAD
```

**Mong đợi:** in đúng mã 40 ký tự (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện (không có thư viện mới) và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`. Lỗi ở bước này: **DỪNG** (cơ sở dữ liệu chưa bị đụng tới).

3.3. Build (vài phút), **không** đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG** (cơ sở dữ liệu chưa bị đụng tới). Trong lúc build, vài trang có thể báo lỗi tạm thời vì `.next` đang được ghi lại.

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

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 6 migration chờ** (tên ở đầu tệp này); `db:deploy` in `All migrations have been successfully applied.`; `Permission catalog synced: 0 inserted, 66 already present.`

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name >= \$\$20261120\$\$ order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select enabled from online_sales_settings) as ban_online_bat, (select count(*) from product_orders where channel = \$\$ONLINE\$\$) as don_online, (select count(*) from product_campaigns) as khuyen_mai"'
```

**Mong đợi:** dòng `grep -c` in `0` (khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); 6 dòng `tên|số giây` (**ghi lại cả 6 dòng gửi Claude**; mỗi dòng dưới vài giây, trên bản giống thật tổng khoảng 1,5 giây); dòng cuối `101|66|f|0|0`.

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
```

## Bước 5. Dừng API và worker, áp migration vào cơ sở dữ liệu thật

**Dừng hai tiến trình ghi** (web và nginx vẫn chạy; khách vẫn xem được trang) để migration không tranh khóa với việc nền. (Một lần thử khi dịch vụ vẫn chạy và có người đọc liên tục mất 43 giây thay vì 4 giây.)

```
pm2 stop lucyspa-api lucyspa-worker
sleep 3
pm2 status
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `lucyspa-api` và `lucyspa-worker` ở trạng thái `stopped`; `0`; `db:status` liệt kê đúng 6 tên như 4.2. Khác: **DỪNG** (khởi động lại hai tiến trình bằng `pm2 restart lucyspa-api lucyspa-worker` rồi hỏi Claude).

```
pnpm db:deploy
pnpm db:status
pnpm db:permissions:sync
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select enabled from online_sales_settings) as ban_online_bat, (select count(*) from product_orders where channel = \$\$ONLINE\$\$) as don_online, (select count(*) from product_campaigns) as khuyen_mai"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; `Permission catalog synced: 0 inserted, 66 already present.`; dòng cuối `101|66|f|0|0`. Một migration chạy quá 60 giây hoặc báo lỗi (`P3018`, `deadlock`): **DỪNG**, không chạy lại, gửi Claude nguyên văn.

## Bước 6. Khởi động lại

Không có thư mục mới và không có cấu hình nginx mới.

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

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online`; không có dòng lỗi mới sau lúc khởi động lại (tối đa vài dòng cũ từ trước khi dừng); `0 inserted, 66 already present`.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "cua hang online (cong khai): %{http_code}\n" http://127.0.0.1:3001/api/v1/online-sales
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
curl -s -o /dev/null -w "gio hang khi chua dang nhap: %{http_code}\n" http://127.0.0.1:3001/api/v1/me/cart
curl -s -o /dev/null -w "hang doi online khi chua dang nhap: %{http_code}\n" "http://127.0.0.1:3001/api/v1/online-orders/context"
curl -s -o /dev/null -w "chien dich dang chay (cong khai): %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/campaigns?locale=vi"
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng `200` (vi, dịch vụ, mỹ phẩm, đăng nhập nhân viên); `cua hang online` là `200` và dòng tiếp theo in `"enabled":false`; **giỏ hàng và hàng đợi online khi chưa đăng nhập đều `401`**; chiến dịch công khai `200`; `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`. Khác: **DỪNG** và hỏi Claude.

Hai vòng việc nền không còn việc tồn (phải là `0` cả hai; số khác sau 1 phút thì chạy lại; vẫn khác `0` thì **DỪNG** và hỏi Claude):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$loyalty\$\$)"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from outbox_events e where e.aggregate_type = \$\$Invoice\$\$ and e.event_type = any(string_to_array(\$\$INVOICE_PAID,INVOICE_REOPENED,INVOICE_CANCELLED\$\$, \$\$,\$\$)) and not exists (select 1 from outbox_consumptions c where c.event_id = e.id and c.consumer = \$\$inventory\$\$) and exists (select 1 from stock_reservations r where r.invoice_id = e.aggregate_id::uuid)"'
```

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem; chưa bật gì)

1. Menu bán hàng có mục mới **Đơn online** và **Bán online** (công tắc), mục danh mục có **Đơn vị vận chuyển** và **Chiến dịch** (tên có thể hơi khác; nếu không thấy, đăng xuất đăng nhập lại). Mở **Bán online**: công tắc **đang tắt**; mở **Đơn online**: các nhóm đều trống.
2. Trang `https://lucyspa.vn/vi/products`: sản phẩm hiện như cũ, nút ghi **"Mua tại cửa hàng"**; không có biểu tượng giỏ hàng.
3. Quầy (POS): bảng hóa đơn và một hóa đơn cũ mở bình thường. Thông báo: chuông mở được. Mở nhanh vài trang cũ: Lịch hẹn, Hóa đơn, Giảm giá, Trả hàng, Hàng đặt trước, trang chủ khách. Không có gì đổi.
4. **Chưa đăng chiến dịch nào, chưa bật bán online** trước khi làm Bước 9.

## Bước 9. Mở cửa hàng online (khi Owner sẵn sàng; có thể để ngày khác)

Làm theo thứ tự, bằng tài khoản Owner, trên web:

1. **Quyền cho nhân viên** (màn Vai trò): `MANAGE_PRODUCT_ORDERS` cho người đóng gói và gửi hàng; `REFUND_PRODUCTS` chỉ cho Chủ hoặc quản lý cấp cao (hủy dòng đã trả tiền và quyết toán giao thất bại); `MANAGE_PRODUCTS` cho người cài đặt; `MANAGE_PRODUCT_PRICES` cho người làm chiến dịch. Khuyên: chỉ Owner trong tuần đầu.
2. **Đơn vị vận chuyển:** thêm ít nhất một hãng (tên; liên kết theo dõi nếu có, dùng `{code}` cho mã vận đơn).
3. **Bán online:** chọn **chi nhánh giao hàng**; đọc và sửa **chính sách giao hàng và đổi trả** (VI và EN; mỗi lần sửa là một phiên bản mới, khách phải đồng ý bản hiện hành); xem lại các con số (30 phút thanh toán, tối đa 3 đơn chưa trả, giỏ 20 dòng, hẹn gửi trong 2 ngày làm việc, giao 2–5 ngày). Phí giao hàng **để tắt** (miễn phí giao hàng, lời Chủ).
4. **Sản phẩm:** mỗi biến thể có ô **"Bán online"** (mặc định bật). Tắt cho món chỉ bán tại cửa hàng.
5. **Thử một đơn thật nhỏ trước khi mở rộng:** bật công tắc, đăng nhập một tài khoản khách của chính Owner, đặt một món rẻ, trả bằng PayOS thật, rồi ở **Đơn online** nhập hãng và mã vận đơn, đánh dấu đã giao; thử cả một lần hủy dòng và hoàn tiền nhỏ. Kiểm kho, điểm và thông báo. Nếu có gì lạ: **tắt công tắc** (đơn đang chờ vẫn xử lý được; webhook PayOS không bao giờ bị công tắc chặn).
6. Khi muốn làm khuyến mãi: **Chiến dịch** > tạo > thêm nhóm giảm giá > chọn sản phẩm > xem lại > đăng. Chiến dịch phải bắt đầu **sau** lúc đăng; đăng rồi không sửa được thời gian, quy tắc và sản phẩm (kết thúc sớm được, có lý do).

## Bước 10. Quay lại nếu có sự cố

**Đọc trước (đã thử thật, xem `PHASE6_WAVE4_ROLLBACK_PROOF.md`):** bản cũ `43a1b29` chạy được trên cơ sở dữ liệu 101 migration **chỉ khi chưa có đơn online nào và không có chiến dịch đã đăng còn hiệu lực**. Chỉ cần **một** đơn online (kể cả chưa trả hay đã hủy) là bản cũ lỗi ở hóa đơn online, bảng POS của chi nhánh đó và hàng đợi đặt trước, và kho của hàng đã gửi không bao giờ được trừ. Vì vậy: **sau đơn online đầu tiên, quay lại phần mềm không còn là lựa chọn**; chỉ còn sửa tiếp (hỏi Claude) hoặc Cách B (mất giao dịch sau lúc sao lưu). Không có bước xóa quyền (Đợt 4 không thêm quyền).

**Cổng kiểm (chạy trước khi quay lại phần mềm).** Chỉ làm Cách A khi **cả mười một số đều bằng 0**:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from product_orders where channel = \$\$ONLINE\$\$) as don_online, (select count(*) from invoices where channel = \$\$ONLINE\$\$) as hoa_don_online, (select count(*) from invoice_line_products where seller_user_id is null) as dong_khong_nguoi_ban, (select count(*) from product_order_lines where status = \$\$SHIPPED\$\$ or cancel_cause = \$\$DELIVERY_FAILED\$\$ or shipped_at is not null or delivered_at is not null) as dong_da_giao, (select count(*) from online_shipments) as van_don, (select count(*) from online_order_logs) as nhat_ky_giao_hang, (select count(*) from online_failed_delivery_settlements) as quyet_toan_giao_that_bai, (select count(*) from online_return_costs) as phi_tra_hang, (select count(*) from product_refunds where settlement_id is not null) as hoan_tien_quyet_toan, (select count(*) from product_campaigns where published_at is not null and coalesce(ended_early_at, ends_at) > now()) as khuyen_mai_con_hieu_luc, (select count(*) from notifications where type like \$\$ONLINE_ORDER_%\$\$) as thong_bao_online"'
```

**Mong đợi để quay lại bằng Cách A:** `0|0|0|0|0|0|0|0|0|0|0`. Nếu **chỉ** số thứ mười một (khuyến mãi còn hiệu lực) khác `0`: kết thúc sớm chiến dịch ở màn Chiến dịch (bản mới) rồi chạy lại cổng. Số khác `0` còn lại: **DỪNG**, không đưa bản cũ lên; hỏi Claude (sửa tiếp) hoặc dùng Cách B.

**Cách A: quay lại phần mềm, giữ nguyên cơ sở dữ liệu.**

A1. Tắt công tắc **Bán online** ở màn Bán online (chặn đơn mới). Chạy cổng kiểm **lần 1**: phải `0|…|0`.

A2. Dừng `lucyspa-api` và `lucyspa-web`, **giữ worker**; chạy hai câu cuối Bước 7 cho đến khi **cả hai bằng `0`** (số khác `0` sau 2 phút: **DỪNG**, hỏi Claude). Rồi dừng `lucyspa-worker` và chạy cổng kiểm **lần 2**: vẫn phải `0|…|0`.

```
pm2 stop lucyspa-api lucyspa-web
```

(chờ hai số về 0)

```
pm2 stop lucyspa-worker
```

A3. Đưa phần mềm về bản cũ và khởi động lại:

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

**Mong đợi:** ba tiến trình `online` (web 3 dòng); `https://lucyspa.vn/vi` mở được; `Permission catalog synced: 0 inserted, 66 already present.` Cơ sở dữ liệu giữ nguyên 101 migration: bảng, cột, hàm mới ở lại (chỉ thêm), không hại gì; lần triển khai Đợt 4 sau không cần migration. Còn lại vô hại: bảng rỗng, giỏ và địa chỉ đã lưu, hãng vận chuyển, bản nháp hay chiến dịch đã hết hạn, hàng ghi nhận lần quét hằng ngày.

**Cách B (chỉ khi cơ sở dữ liệu hỏng, hoặc cổng kiểm báo đã có dữ liệu Đợt 4 mà phải quay lại): khôi phục từ tệp sao lưu ở Bước 2.** **Dữ liệu phát sinh sau lúc sao lưu sẽ mất (lịch hẹn, hóa đơn, thanh toán, điểm mới, đơn online, hoàn tiền).** Hỏi Claude trước khi làm. Đã thử trên bản giống thật: `pg_dump` 10 giây (45 MB), `dropdb`, `createdb`, `pg_restore` 16 giây, thoát 0, về đúng 95 migration, 66 quyền, 20.000 hóa đơn; API và worker cũ chạy sạch. Các lệnh (chỉ khi đã thống nhất):

```
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

rồi làm A3 (đưa phần mềm về `$OLD_COMMIT`) và khởi động lại cả ba. Ảnh bằng chứng trả hàng trong `/opt/lucyspa-media/returns` nằm ngoài cơ sở dữ liệu và không bị đụng tới.

**Không thể hoàn tác:** đơn online đã có (đơn, dòng, vận đơn, nhật ký giao hàng, quyết toán, phí trả hàng, thông báo) không xóa được và bản cũ không đọc được hết chúng.

## Bước 11. Báo lại cho Claude

Gửi: mã commit đang chạy, 6 dòng thời gian migration ở 4.3, dòng `101|66|f|0|0` ở Bước 5, `pm2 status`, kết quả Bước 7 (kể cả các số `200`, `401`, dòng `"enabled":false` và hai số `0` của việc tồn) và đường dẫn tệp sao lưu. Sau Bước 9 (khi đã mở cửa hàng), báo ngày giờ mở và kết quả đơn thử. Claude ghi vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Worker có thêm hai việc nền: hủy đơn online quá hạn (cùng vòng PayOS 30 giây: kiểm tra lại với PayOS trước khi hủy, đơn đang chờ tiền không bị hủy) và quét đơn online 08:00 (cùng vòng kho, một dòng ghi nhận mỗi chi nhánh mỗi ngày). Trừ kho của hàng online chỉ xảy ra khi nhân viên bấm "Đã gửi" (sự kiện `INVOICE_ORDER_SHIPPED`, bộ xử lý `inventory`). Chạy hai worker sẽ làm lập lịch chạy hai lần.
- Webhook PayOS (`POST /api/v1/webhooks/payos`) không đổi, không bị công tắc chặn, giới hạn tần suất chỉ cho yêu cầu giả.
- Mỗi hội viên có ngân sách **120 yêu cầu thành công mỗi phút** cho các đường online (429 nếu quá). Đo tải (`scripts/load-online.mjs`, `docs/PHASE6_STEP22_ONLINE_LOAD_SECURITY.md`): một tiến trình API đủ; không thêm tiến trình.
- Trang công khai chiến dịch và giá cache khoảng 65 giây (API 5 giây cộng web 60 giây); giá khách trả luôn là giá cơ sở dữ liệu tại lúc chốt đơn.
- Nginx giữ nguyên cấu hình; API vẫn **một** tiến trình; web 3 tiến trình.
