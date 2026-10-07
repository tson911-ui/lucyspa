# Hướng dẫn đưa Phase 6 Đợt 1 (sản phẩm, kho, nhập Excel, trang mỹ phẩm, chịu tải) lên máy chủ thật

> **ĐÃ DEPLOY (Chủ báo, 2026-10-07 khoảng 23:10, UTC+7).** Bản chạy: `6546c434595cef5c7ab764d8e5e7cc4b62afe256` (trước đó `39ad8d1`). Sao lưu `/root/backups/lucyspa-pre-phase6-dot1-20261007T160340Z.dump` (790.983 byte, 1287 dòng mục lục), bản lưu pm2 cũng nằm trong `/root/backups`. Diễn tập trên bản khôi phục của dữ liệu thật: 10 migration đạt, tổng khoảng 0,43 giây (lớn nhất 0,178 giây, `inventory_foundation`). Sau deploy: 73 migration, 65 quyền (11 quyền mới chưa gán cho ai), 0 sản phẩm; số liệu trước và sau không đổi (users 9, bookings 4, invoices 2, payments 2, notifications 28). pm2: `lucyspa-api` 1 (fork), `lucyspa-worker` 1 (fork), `lucyspa-web` 3 (cluster, `ecosystem.config.cjs`), đã `pm2 save`. Health ok (database, redis); `/vi`, `/vi/services`, `/vi/products`, `/vi/workforce/login` đều 200; mục "Mỹ phẩm" ẩn khỏi menu và sitemap. Nginx đã gửi `X-Forwarded-For` (`sites-available/default`); thử giới hạn: 300 lần 200, 400 lần 429. Các dòng lỗi cũ của pm2 (ELIFECYCLE do dừng tiến trình trước đó) là lịch sử, không có lỗi mới. Phần còn lại của tài liệu giữ nguyên để tham khảo khi quay lại bản cũ hoặc lặp lại cho Đợt sau.

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; kết quả khác thì **DỪNG, không chạy tiếp, chụp màn hình gửi Claude**. Chưa có gì của Phase 6 trên máy chủ; chỉ làm khi Owner quyết (Owner chốt 2026-10-07: deploy từng đợt, sau kiểm tra mốc của mỗi đợt).

**Bản sẽ cài:** commit `6546c434595cef5c7ab764d8e5e7cc4b62afe256` (viết tắt `6546c43`), đã push lên `main`, **CI xanh** (2026-10-07). Các commit tài liệu đẩy lên sau đó (kể cả commit điền mã này) **không** được cài và không đổi mã chạy.
**Bản đang chạy:** `39ad8d1` (theo `LUCYSPA_HANDOFF.md`).
**Cơ sở dữ liệu:** thêm **10 migration** (`20261106000000` đến `…09`): **63 thành 73**. Quyền: **54 thành 65** (11 quyền mới, chưa gán cho ai). Chỉ thêm bảng, hàm, cột; không đổi dòng dữ liệu cũ; **không đụng** hóa đơn, thanh toán, điểm thưởng, POS. Ngoại lệ duy nhất: nới 3 ràng buộc của bảng `notifications` (migration `…08`, giữ khóa rất ngắn).
**Thay đổi chạy:** web chuyển từ 1 tiến trình sang **cluster 3 tiến trình** (cấu hình `ecosystem.config.cjs`); API và worker **vẫn đúng một**; giới hạn số lần đọc trang công khai (cần nginx gửi `X-Forwarded-For`); trang `/vi/products` (ẩn khỏi menu cho đến khi có sản phẩm "Đang bán").
**Thời gian:** khoảng 45 phút (build vài phút, diễn tập vài phút). **Chọn buổi tối vắng khách.** Lúc khởi động lại API (vài giây) và chuyển web sang cluster (vài giây), website và POS gián đoạn ngắn; báo nhân viên trước.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `6546c43` có dấu **xanh** (đã xanh lúc Claude kiểm). Đỏ hoặc đang chạy: **DỪNG**.
- Owner đã đọc `docs/PHASE6_WAVE1_MILESTONE.md`; OQ-54..OQ-57 đã duyệt (2026-10-07).

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
free -m
nproc
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `39ad8d1`; 3 dòng `online` (`lucyspa-api`, `lucyspa-web`, `lucyspa-worker`); ổ đĩa còn trống vài GB; `nproc` in `6`; `free -m` dòng `Mem` tổng khoảng 7800 và `Swap` 0. Ghi lại mã cũ (để quay lại):

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

Kết nối cơ sở dữ liệu và cổng đang dùng:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "show max_connections; select count(*) from pg_stat_activity"'
ss -ltnp | grep -E ":3000|:3001"
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name==='lucyspa-web');console.log(Object.keys(p.pm2_env).filter(k=>/^(NODE_ENV|PORT|HOSTNAME|API_|WEB_|NEXT_)/.test(k)).join('\n'))})"
grep -rn "X-Forwarded-For\|proxy_pass" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
```

**Mong đợi:** dòng 1 là `100` (số kết nối tối đa) và dòng 2 một số nhỏ hơn 40; hai cổng `3000` (web) và `3001` (API) đang nghe ở `127.0.0.1`; danh sách tên biến chỉ có `NODE_ENV` (nếu có `PORT`, ghi lại giá trị cổng để đặt `export WEB_PORT=<cổng>` ở Bước 6); nginx có dòng `proxy_pass` và **dòng `proxy_set_header X-Forwarded-For`**. Thiếu dòng `X-Forwarded-For`: **không dừng**, chỉ ghi lại; sau deploy giới hạn số lần đọc sẽ **chưa có tác dụng** cho đến khi kỹ thuật viên thêm `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (OQ-57). Lưu danh sách tiến trình hiện tại để có đường lui:

```
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-phase6-dot1-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu cơ sở dữ liệu (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from notifications) as notifications, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** một dòng dạng `12|345|67|60|890|54|63` (quyền **54**, migration **63**).

2.2. Tạo và kiểm tra bản sao lưu:

```
export BACKUP=/root/backups/lucyspa-pre-phase6-dot1-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
chmod 600 "$BACKUP"
echo "$BACKUP"
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` lớn hơn 200; có dòng `Format: CUSTOM`. **Sai: DỪNG.** Ghi lại đường dẫn tệp sao lưu.

## Bước 3. Lấy bản mới, cài, build (chưa khởi động lại gì)

3.1. Lấy đúng bản mới:

```
cd /opt/lucyspa
git fetch origin
git checkout 6546c434595cef5c7ab764d8e5e7cc4b62afe256
git rev-parse HEAD
```

**Mong đợi:** in đúng mã 40 ký tự (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện (có 2 thư viện mới cho nhập Excel) và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`.

3.3. Build (vài phút), **không** đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG** (cơ sở dữ liệu chưa bị đụng tới; xem Bước 9 nếu website báo lỗi). Trong lúc build, vài trang có thể báo lỗi tạm thời vì `.next` đang được ghi đè: bình thường.

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

**Mong đợi:** dòng đầu in `DB=lucy_spa_rehearsal_scratch` (in tên khác hoặc báo `refusing`: **DỪNG**); `db:status` liệt kê **đúng 10 migration chờ** (`20261106000000` đến `20261106000009`; báo "chưa áp" ở đây là bình thường); `db:deploy` kết thúc `All migrations have been successfully applied.`; `db:permissions:sync` in `Permission catalog synced: 11 inserted, 54 already present.`

4.3. **Bắt buộc, ngay sau đó**, xóa biến để các lệnh sau không nhầm sang cơ sở dữ liệu tạm, rồi đọc thời gian từng migration và số liệu:

```
unset DATABASE_URL
env | grep -c '^DATABASE_URL=' || true
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select migration_name, round(extract(epoch from finished_at - started_at)::numeric, 3) as giay from _prisma_migrations where migration_name like '"'"'20261106%'"'"' order by migration_name"'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_rehearsal_scratch -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from notifications) as notifications"'
```

**Mong đợi:** dòng `grep -c` in `0` (nếu in số khác `0`: **DỪNG**, đóng cửa sổ terminal, mở lại và làm lại từ Bước 1); 10 dòng `tên|số giây` (**ghi lại cả 10 dòng gửi Claude**); dòng cuối `73|65|<số thông báo như Bước 2.1>`. Diễn tập ở máy thử (bản sao 208 MB, 300.000 thông báo, mã cũ `39ad8d1`): mỗi migration dưới 0,25 giây, cả 10 cộng lại khoảng 0,6 giây; migration `…08` (kiểm lại bảng thông báo) 0,13 giây. **Quá 60 giây ở bất kỳ migration nào, hoặc số khác: DỪNG.**

4.4. Xóa cơ sở dữ liệu tạm:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" lucy_spa_rehearsal_scratch'
```

## Bước 5. Áp migration vào cơ sở dữ liệu thật

```
env | grep -c '^DATABASE_URL=' || true
pnpm db:status
```

**Mong đợi:** `0`; `db:status` liệt kê đúng 10 tên như 4.2. Khác: **DỪNG**.

```
pnpm db:deploy
pnpm db:status
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from products) as products"'
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`; dòng cuối `73|54|0` (73 migration, quyền **vẫn 54**, 0 sản phẩm; 11 quyền mới thêm ở Bước 6, sau khi khởi động lại, để bản cũ đang chạy không gặp dòng quyền mà nó không đọc được). Có lỗi: **DỪNG, không chạy lại**, xem Bước 9.

## Bước 6. Khởi động lại (API, worker, rồi web chuyển sang cluster), rồi thêm quyền

6.1. Nếu Bước 1 cho thấy web không dùng cổng 3000, đặt trước: `export WEB_PORT=<cổng>`.

```
pm2 restart lucyspa-api lucyspa-worker --update-env
sleep 10
pm2 delete lucyspa-web
pm2 start ecosystem.config.cjs --only lucyspa-web
pm2 save
sleep 20
pm2 status
pm2 logs lucyspa-api --err --lines 30 --nostream
pm2 logs lucyspa-worker --err --lines 30 --nostream
```

**Mong đợi:** `lucyspa-api` 1 dòng `online`, `lucyspa-worker` **đúng 1 dòng** `online`, `lucyspa-web` **3 dòng** `online` (mode `cluster`); không có dòng lỗi mới sau lúc khởi động lại. **Không bao giờ chạy `pm2 scale lucyspa-worker` hoặc `pm2 scale lucyspa-api`**: lập lịch của worker sẽ chạy hai lần.

6.2. Thêm 11 quyền mới vào danh mục (chưa gán cho ai):

```
pnpm db:permissions:sync
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from permissions"'
```

**Mong đợi:** `Permission catalog synced: 11 inserted, 54 already present.` rồi `65`. Khác: **DỪNG**.

## Bước 7. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s http://127.0.0.1:3000/vi | grep -c 'href="/vi/products"'
curl -s http://127.0.0.1:3000/sitemap.xml | grep -c products
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
free -m
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng `200`; hai số `grep -c` đều `0` (chưa có sản phẩm "Đang bán" thì menu và sơ đồ trang không có mục Mỹ phẩm); `lucyspa-web 3`, `lucyspa-api 1`, `lucyspa-worker 1`; `Swap` vẫn 0 và `available` còn trên 3000 MB. Chạy lại câu lệnh ở 2.1 (đổi sang `db`): `users`, `bookings`, `invoices`, `payments`, `notifications` bằng hoặc nhỉnh hơn dòng đã ghi.

Kiểm tra giới hạn số lần đọc (OQ-57). **Lệnh này sẽ chặn địa chỉ của Owner khỏi các đường công khai khoảng 1 phút**, bình thường:

```
seq 1 700 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" https://lucyspa.vn/api/v1/public/products/codes | sort | uniq -c
```

**Mong đợi:** có cả dòng `200` và dòng `429` (ít nhất khoảng 100 lần `429`). **Toàn `200`:** nginx chưa gửi `X-Forwarded-For`, giới hạn chưa hoạt động; không nguy hiểm, báo Claude và kỹ thuật viên (xem OQ-57).

## Bước 8. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. Đăng nhập quản trị: **Danh mục** có Sản phẩm, Kho hàng, Nhập dữ liệu (cần gán quyền "Sản phẩm và kho" cho vai trò trong màn hình **Vai trò**: 11 quyền mới).
2. `https://lucyspa.vn/vi/products`: thấy lời "Mỹ phẩm sắp có tại Lucy Spa" (chưa có sản phẩm); menu đầu trang **không** có "Mỹ phẩm". Khi Owner đăng sản phẩm đầu tiên ở trạng thái "Đang bán", sau khoảng 1 phút mục "Mỹ phẩm" hiện ra.
3. Mở nhanh vài trang cũ: Lịch hẹn, Hóa đơn, trang chủ khách. Không có gì đổi.

## Bước 9. Quay lại nếu có sự cố

**Cách A (nên dùng trước): quay lại phần mềm, giữ nguyên cơ sở dữ liệu.** 10 migration chỉ thêm bảng, hàm, cột; riêng `…08` chỉ **nới** ràng buộc. Bản cũ bỏ qua phần mới, **trừ một điểm**: bản cũ **không đọc được** bảng quyền khi còn 11 quyền mới trong đó (báo lỗi `Value 'MANAGE_PRODUCTS' not found in enum`), nên phải xóa 11 dòng quyền mới trước. Các giá trị mới của kiểu quyền trong cơ sở dữ liệu cứ để nguyên (không hại). Claude đã chạy thử đúng quy trình này ở máy thử: bản `39ad8d1` chạy trên cơ sở dữ liệu đã áp đủ 10 migration và đã xóa 11 quyền mới (kết quả ghi ở `PHASE6_WAVE1_MILESTONE.md`); khi **chưa** xóa quyền thì 67 bài kiểm tra tích hợp của bản cũ báo lỗi. Sau này deploy lại, `pnpm db:permissions:sync` tự thêm lại 11 quyền.

A1. Dừng 3 tiến trình:

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
```

A2. Xóa 11 quyền mới (một lệnh duy nhất, chép nguyên dòng):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "delete from permissions where code::text = any(string_to_array(\$\$MANAGE_PRODUCTS,MANAGE_PRODUCT_PRICES,VIEW_PRODUCT_COST,VIEW_INVENTORY,MANAGE_STOCK_RECEIPTS,ADJUST_STOCK,IMPORT_PRODUCT_DATA,SELL_PRODUCTS,MANAGE_PRODUCT_RETURNS,REFUND_PRODUCTS,MANAGE_PRODUCT_CAMPAIGNS\$\$, \$\$,\$\$))" -c "select count(*) from permissions"'
```

**Mong đợi:** in `DELETE 11` rồi `54`. **Nếu có chữ `violates foreign key` (đã có vai trò hoặc người dùng được gán quyền mới) hoặc số khác: DỪNG** (không có gì bị xóa); hỏi Claude (cần gỡ phần gán quyền trước, hoặc dùng Cách B).

A3. Đưa phần mềm về bản cũ và khởi động lại:

```
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
```

**Mong đợi:** các tiến trình `online`; `https://lucyspa.vn/vi` mở được. (Web vẫn là cluster 3 tiến trình, chạy bản cũ được; muốn trở lại đúng một tiến trình như trước: `pm2 delete lucyspa-web` rồi `pm2 resurrect` từ tệp `pm2-dump-truoc-phase6-dot1-….pm2` đã lưu ở Bước 1, hỏi Claude trước.)

**Cách B (chỉ khi cơ sở dữ liệu hỏng):** khôi phục từ tệp sao lưu ở Bước 2. **Dữ liệu phát sinh sau lúc sao lưu sẽ mất (lịch hẹn, hóa đơn, thanh toán mới).** Hỏi Claude trước khi làm. Các lệnh (chỉ khi đã thống nhất):

```
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$BACKUP"
echo "pg_restore exit=$?"
```

rồi làm Cách A (đưa phần mềm về `$OLD_COMMIT`) và `pm2 restart` cả ba.

## Bước 10. Báo lại cho Claude

Gửi: mã commit đang chạy, 10 dòng thời gian migration ở 4.3, dòng `73|54|0` ở Bước 5 và số `65` ở 6.2, `pm2 status`, kết quả Bước 7 (kể cả đếm `200`/`429`) và đường dẫn tệp sao lưu. Claude ghi vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Nginx: `client_max_body_size 11m;` (tải ảnh 10 MB, nhập Excel 5 MB) và `proxy_read_timeout 150s;` cho đường `/api/`; nhập 2.000 dòng giữ một giao dịch khoảng 20 đến 23 giây, nên nhập lúc vắng khách. Web đã đặt `proxyTimeout` 150 giây.
- Giới hạn tần suất đọc `X-Forwarded-For` **từ bên phải** (địa chỉ ngoài đầu tiên); cần `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (nginx tự nối địa chỉ khách vào cuối, nên khách không tự chọn được địa chỉ của mình).
- Mỗi tiến trình API/worker mở tối đa 10 kết nối PostgreSQL (`max_connections` 100); web không mở kết nối nào.
- Worker phải khởi động lại sau deploy (vòng cảnh báo kho và quét hạn dùng 08:00 nằm trong worker). Redis dùng chung cho hàng đợi và bộ đếm giới hạn (khóa `lucy:rl:public:*`, tự hết hạn sau 2 phút).
- Cập nhật các lần sau: `pm2 reload lucyspa-web` cuốn chiếu từng tiến trình (đo ở máy thử: 13 trên 2.148 yêu cầu đang xử lý bị đứt, 0,6%), tốt hơn khởi động lại một tiến trình như trước.
