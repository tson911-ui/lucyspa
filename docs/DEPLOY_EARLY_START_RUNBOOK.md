# Hướng dẫn đưa tính năng "bắt đầu dịch vụ sớm" lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng bước, theo thứ tự**, trong **cùng một cửa sổ terminal** đã đăng nhập vào máy chủ. Gặp "DỪNG" thì dừng, **không chạy lại**, chụp màn hình và báo cho Claude.

**Bản sẽ cài:** commit `39ad8d1f268f243120184944c7d5a09b87c398cb` (viết tắt `39ad8d1`). Đó là `f88dff7` (tính năng) cộng một commit chỉ sửa tài liệu; không có thay đổi nào khác. Các commit tài liệu đẩy lên sau đó **không** được cài.
**Thay đổi cơ sở dữ liệu:** đúng **1 migration**, `20261105000000_early_service_start_occupancy` (chỉ thay một hàm và thêm một trigger, không đổi bảng, không đổi dữ liệu). Sau khi áp: **63** migration. Quyền: không đổi (**54**). Không đổi `.env`, không đổi nginx.
**Thời gian:** khoảng 15 phút. Chọn lúc ít khách.

## Bước 0. Điều kiện

Trên GitHub, tab **Actions**, commit `39ad8d1` phải có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.

## Bước 1. Xem máy chủ đang chạy bản nào

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
```

**Mong đợi:** `git status --short` không in gì; mã commit bắt đầu bằng `607ca6a` (theo `LUCYSPA_HANDOFF.md`); 3 dòng `online`: `lucyspa-api`, `lucyspa-web`, `lucyspa-worker`; ổ đĩa còn trống vài GB. Ghi lại mã cũ để quay lại nếu cần:

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

## Bước 2. Sao lưu cơ sở dữ liệu (làm TRƯỚC mọi việc khác)

2.1. Ghi các con số để so sánh sau này (chép ra giấy):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from permissions) as permissions, (select count(*) from _prisma_migrations) as migrations"'
```

**Mong đợi:** một dòng dạng `12|345|67|60|54|62` (số cuối là số migration, hiện **62**, quyền **54**).

2.2. Tạo và kiểm tra bản sao lưu:

```
mkdir -p /root/backups
export BACKUP=/root/backups/lucyspa-pre-earlystart-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
chmod 600 "$BACKUP"
echo "$BACKUP"
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` lớn hơn 200; có dòng `Format: CUSTOM`. **Nếu sai: DỪNG.** Ghi lại đường dẫn tệp sao lưu.

## Bước 3. Lấy bản mới, cài, cập nhật cơ sở dữ liệu, build, khởi động lại

3.1. Lấy đúng bản `39ad8d1`:

```
cd /opt/lucyspa
git fetch origin
git checkout 39ad8d1f268f243120184944c7d5a09b87c398cb
git rev-parse HEAD
```

**Mong đợi:** in đúng `39ad8d1f268f243120184944c7d5a09b87c398cb` ("detached HEAD" là bình thường). **Mã khác: DỪNG.**

3.2. Cài thư viện và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`.

3.3. Xem migration đang chờ **trước khi áp**:

```
pnpm db:status
```

(Có thể báo có migration chờ: bình thường.) **Mong đợi: đúng 1 tên**, `20261105000000_early_service_start_occupancy`. Danh sách khác: **DỪNG**.

3.4. Áp migration:

```
pnpm db:deploy
pnpm db:status
```

**Mong đợi:** lần 1 `All migrations have been successfully applied.`; lần 2 `Database schema is up to date!`. Có lỗi: **DỪNG, không chạy lại**; xem Bước 6.

3.5. Đồng bộ quyền và kiểm tra số liệu:

```
pnpm db:permissions:sync
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from _prisma_migrations where finished_at is not null) as migrations, (select count(*) from permissions) as permissions, (select count(*) from pg_trigger where tgname = '"'"'service_executions_early_occupancy'"'"') as trigger"'
```

**Mong đợi:** `63|54|1` (63 migration đã áp, 54 quyền, 1 trigger mới). **Khác: DỪNG.**

3.6. Build (vài phút), không đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG** (bản đang chạy chưa bị đụng tới vì chưa khởi động lại).

3.7. Khởi động lại 3 tiến trình:

```
pm2 restart lucyspa-api lucyspa-web lucyspa-worker --update-env
sleep 15
pm2 status
pm2 logs lucyspa-api --err --lines 30 --nostream
pm2 logs lucyspa-worker --err --lines 30 --nostream
```

**Mong đợi:** 3 dòng `online`, cột `↺` không tăng thêm; không có dòng lỗi mới sau lúc khởi động lại.

## Bước 4. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu thật)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "dich vu cua toi: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/my-services
curl -s -o /dev/null -w "lich hen hom nay: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/booking-board
```

**Mong đợi:** `/health/ready` có `"status":"ok"`, `database` và `redis` `up`; bốn dòng sau đều `200` (hai trang nhân viên chưa đăng nhập sẽ tự chuyển về trang đăng nhập, vẫn `200`, hoặc `307`; **không** được là `500`). Chạy lại câu lệnh ở 2.1: số `users`, `bookings`, `invoices`, `payments` bằng hoặc nhỉnh hơn dòng đã ghi, quyền `54`, migration `63`.

## Bước 5. Kiểm tra trên web (Owner đăng nhập, chỉ để xem)

1. **Dịch vụ của tôi** (menu Vận hành) mở được, không báo lỗi. **Lịch hẹn hôm nay** mở được, các phần "Lượt khách đang mở" và "Hàng chờ theo nhân viên" hiển thị bình thường.
2. Đừng bấm Bắt đầu hay Kết thúc ở khách thật. Nhãn "Bắt đầu sớm X phút" chỉ hiện khi có ai đó bắt đầu sớm thật; chưa có thì không thấy gì là đúng.
3. Mở nhanh vài trang cũ: Lịch hẹn, Hóa đơn, trang chủ khách. Không có gì đổi.

## Bước 6. Quay lại nếu có sự cố

**Cách A (nên dùng trước), quay lại phần mềm, giữ nguyên cơ sở dữ liệu.** Migration chỉ thêm một trigger; bản cũ không bao giờ bắt đầu dịch vụ trước giờ hẹn nên trigger này không làm gì với bản cũ, an toàn để giữ.

```
cd /opt/lucyspa
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 restart lucyspa-api lucyspa-web lucyspa-worker --update-env
sleep 15
pm2 status
```

**Cách B (chỉ khi cơ sở dữ liệu hỏng):** khôi phục từ tệp sao lưu ở Bước 2. **Dữ liệu phát sinh sau lúc sao lưu sẽ mất.** Hỏi Claude trước khi làm.

## Bước 7. Báo lại cho Claude

Gửi: mã commit đang chạy, dòng `63|54|1`, `pm2 status`, kết quả Bước 4 và đường dẫn tệp sao lưu. Claude ghi vào `LUCYSPA_HANDOFF.md`.
