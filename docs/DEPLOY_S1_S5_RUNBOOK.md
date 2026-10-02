# Hướng dẫn đưa S1–S5 (giao diện theo mùa lễ) lên máy chủ thật (production)

Dành cho Owner, không cần rành kỹ thuật. Làm **từng bước, theo thứ tự**. Mỗi bước có: lệnh cần gõ, kết quả mong đợi, và việc phải làm nếu kết quả khác. **Nếu một bước ra kết quả khác mong đợi: DỪNG, không làm bước tiếp theo, chụp màn hình gửi lại.**

## Tóm tắt

- **Bản sẽ cài:** commit `f7d694293ec2fc23e92d0f543f4bb6a0b2e1d6bf` (viết tắt `f7d6942`). Đây là bản có S1 (bảng màu và quy tắc theo mùa), S2 (hình trang trí, hiệu ứng), S3 (lưu lịch mùa lễ, API), S4 (tab **Mùa lễ** trong quản trị), S5 (áp dụng lên website, khu vực khách và quản trị).
- **Từ bản nào:** bản đang chạy trên máy chủ, giả định là `684b9ee` (bản triển khai gần nhất, đã xác nhận); Owner xác nhận lại ở Bước 1.
- **Thay đổi cơ sở dữ liệu:** đúng **1 migration**, chỉ thêm, không xóa gì: `20261021000000_uxui_s3_website_seasons` (thêm bảng `website_seasons` và cột liên kết `season_id` cho popup và slide).
- **Quyền mới:** không. Dùng lại quyền "Quản lý nội dung website" (phạm vi toàn hệ thống). Vẫn chạy bước đồng bộ quyền cho chắc, kết quả mong đợi là `0 inserted`.
- **Cấu hình mới:** không có biến môi trường mới. Trang web gọi API qua cùng địa chỉ như trước (mặc định `http://127.0.0.1:3001`).
- **Thay đổi hành vi cần biết:** trang chủ không còn là trang tĩnh; nó được dựng khi có khách vào (để biết đang có mùa lễ hay không). Mùa lễ được lưu tạm 60 giây. Nếu API chậm hoặc lỗi, trang hiển thị bình thường như cũ (không có mùa lễ).
- **Thời gian:** khoảng 20 đến 30 phút. Chọn lúc ít khách. Từ lúc sao lưu (Bước 2) đến lúc xong (Bước 4) dữ liệu mới phát sinh sẽ **mất nếu phải quay lại bằng bản sao lưu**.
- Mọi lệnh gõ trên máy chủ, dùng tài khoản đã dùng cho các lần deploy trước (có quyền `root`/`sudo`), **trong cùng một cửa sổ terminal** từ đầu đến cuối.

## Bước 0. Điều kiện trước khi bắt đầu

1. Trên GitHub, tab **Actions**, commit `f7d6942` phải có dấu **xanh** (đã chạy xong, không đỏ, không đang chạy). Nếu đỏ hoặc đang chạy: **DỪNG**, đừng deploy.
2. Có điện thoại/máy tính khác để đăng nhập Owner kiểm tra ở Bước 5.

## Bước 1. Xem máy chủ đang chạy bản nào

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
git log -1 --format='%h %cd %s'
pm2 status
```

**Mong đợi:** `git status --short` **không in gì**; `git rev-parse HEAD` in mã 40 ký tự (giả định bắt đầu bằng `684b9ee`); `pm2 status` có 3 dòng **online**: `lucyspa-api`, `lucyspa-web`, `lucyspa-worker`.

Ghi lại mã commit cũ (để quay lại nếu cần), thay bằng mã thật vừa in:

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

**Nếu sai: DỪNG** khi có dòng lạ ở `git status --short`, một tiến trình không `online`, hoặc mã commit **cũ hơn** `684b9ee` (khi đó số migration chờ sẽ không phải 1, xem Bước 4.3).

```
df -h /
```

**Mong đợi:** còn trống ít nhất vài GB.

## Bước 2. Sao lưu cơ sở dữ liệu TRƯỚC khi làm gì khác

2.1. Ghi lại vài con số để so sánh sau này:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from website_popups) as popups, (select count(*) from website_slides) as slides"'
```

**Mong đợi:** một dòng dạng `12|345|67|1|3`. **Ghi lại ra giấy.**

2.2. Tạo bản sao lưu:

```
mkdir -p /root/backups
export BACKUP=/root/backups/lucyspa-pre-s1s5-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
echo "$BACKUP"
```

**Mong đợi:** không in lỗi, `echo` in đường dẫn tệp.

2.3. Kiểm tra tệp đọc được:

```
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
chmod 600 "$BACKUP"
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` in số lớn hơn 200; 6 dòng đầu có `Format: CUSTOM`. **Nếu sai: DỪNG.** Chép bản sao lưu ra máy của Owner nếu có thể.

## Bước 3. Cấu hình

Không cần sửa `.env`, không cần tạo thư mục mới. (Thư mục ảnh `/opt/lucyspa-media` đã có từ lần deploy Step 13.) Kiểm tra nhanh nó còn đó:

```
ls -ld /opt/lucyspa-media
grep -c '^MEDIA_STORAGE_DIR=' /opt/lucyspa/.env
```

**Mong đợi:** thư mục tồn tại; `grep -c` in `1`. **Nếu sai: DỪNG.**

## Bước 4. Lấy bản mới, cài, cập nhật cơ sở dữ liệu, build, khởi động lại

4.1. Lấy đúng bản `f7d6942`:

```
cd /opt/lucyspa
git fetch origin
git cat-file -t f7d694293ec2fc23e92d0f543f4bb6a0b2e1d6bf
git checkout f7d694293ec2fc23e92d0f543f4bb6a0b2e1d6bf
git log -1 --format='%h %s'
```

**Mong đợi:** `cat-file` in `commit`; dòng cuối bắt đầu bằng `f7d6942 feat: uxui step S5 season wiring`. **Nếu sai: DỪNG.**

4.2. Cài thư viện (bản khóa sẵn):

```
pnpm install --frozen-lockfile
```

**Mong đợi:** kết thúc bằng `Done`, không có `ERR`. **Nếu có `ERR_PNPM`: DỪNG.**

4.3. Xem **trước khi áp** có đúng 1 migration đang chờ:

```
pnpm db:status
```

(Có thể kết thúc với dấu hiệu lỗi vì có migration chờ: bình thường.)

**Mong đợi:** liệt kê **đúng 1 tên**: `20261021000000_uxui_s3_website_seasons`. **Nếu danh sách khác:** DỪNG và gửi lại nguyên văn.

4.4. Áp migration (chỉ thêm bảng và cột, không xóa gì):

```
pnpm db:deploy
pnpm db:status
```

**Mong đợi:** lần 1 áp migration trên và kết thúc `All migrations have been successfully applied.`; lần 2 báo `Database schema is up to date!`. **Nếu có lỗi: DỪNG, không chạy lại**; xem Bước 6.

4.5. Tạo lại Prisma client (**bắt buộc trước khi đồng bộ quyền**):

```
pnpm db:generate
```

**Mong đợi:** có dòng `Generated Prisma Client`. **Nếu lỗi: DỪNG.**

4.6. Đồng bộ danh sách quyền (không có quyền mới; chạy cho chắc):

```
pnpm db:permissions:sync
```

**Mong đợi:** `0 inserted`. Nếu khác 0: không sao nhưng báo lại kỹ thuật viên.

4.7. Build toàn bộ (vài phút):

```
pnpm build
```

**Mong đợi:** chạy hết, không có chữ `ERR` hay `error` ở cuối. **Nếu lỗi: DỪNG** (bản đang chạy chưa bị đụng tới vì chưa khởi động lại; cơ sở dữ liệu đã có bảng mới nhưng bản cũ bỏ qua).

> Đừng đặt biến `API_UPSTREAM_ORIGIN` trong cửa sổ terminal khi build, hãy build như các lần trước.

4.8. Khởi động lại 3 tiến trình:

```
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
```

**Mong đợi:** 3 dòng đều `online`. **Nếu có `errored`/`stopped`, hoặc cột `↺` cứ tăng: DỪNG, xem Bước 6.**

## Bước 5. Kiểm tra sau khi deploy

5.1. Tiến trình ổn định (chạy lại sau 1 phút): `pm2 status` có 3 dòng `online`, cột `↺` không tăng thêm.

5.2. API sống và đường dẫn công khai mới (mặc định API `3001`, web `3000`):

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "season vi: %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/website/season?locale=vi"
curl -s -o /dev/null -w "season sai: %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/website/season?locale=fr"
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "workforce: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
```

**Mong đợi:** `"status":"ok"` với `database` và `redis` đều `up`; `season vi` trả `204` (chưa có mùa lễ nào đang áp dụng); `season sai` trả `400`; `vi` và `workforce` đều `200`. **Nếu sai: DỪNG.**

5.3. Số liệu không đổi (chạy lại lệnh ở 2.1): **Mong đợi:** giống dòng đã ghi (hoặc nhỉnh hơn vì khách vẫn đặt lịch). **Nếu ít hơn: DỪNG ngay và báo.**

5.4. Kiểm tra bằng trình duyệt (Owner đăng nhập tài khoản Owner):

1. Mở `/vi/workforce/website`. Thấy **4 tab**: **Thư viện ảnh**, **Popup**, **Slider**, **Mùa lễ**.
2. Tab **Mùa lễ** → **Tạo mùa lễ**: chọn một chủ đề (ví dụ **Giáng sinh**), nhập tên "Thử", chọn ngày đầu là **hôm nay** và ngày cuối là **ngày mai**, xem 4 khung **Xem trước** (máy tính/điện thoại, nền sáng/tối), bật **Bật mùa lễ**, bấm **Lưu mùa lễ**. **Mong đợi:** về danh sách, mùa lễ có nhãn **Đang áp dụng**.
3. Mở trang chủ `/vi` ở cửa sổ ẩn danh (chờ tối đa 1 phút vì bộ nhớ đệm 60 giây). **Mong đợi:** có dải màu theo chủ đề dưới thanh đầu trang với lời chúc, hình trang trí hai bên, hiệu ứng nhẹ, và nút **Tắt hiệu ứng**. Chữ và nút vẫn màu đỏ thương hiệu.
4. Quay lại bảng điều khiển quản trị: thấy đường nhấn mảnh dưới thanh trên cùng và một dòng lời chúc nhỏ kèm nút **Ẩn mùa lễ**. Bấm **Ẩn mùa lễ**: đường nhấn biến mất; tải lại trang vẫn ẩn (trên máy này). Bấm **Hiện mùa lễ** để bật lại.
5. (Nếu muốn thử liên kết) Mở mùa lễ vừa tạo → **Nội dung đi kèm** → **Tạo popup cho mùa lễ này**: form popup đã chọn sẵn mùa lễ và khóa ô thời gian. Hủy nếu không cần.
6. **Dọn dẹp:** ở tab **Mùa lễ**, menu ⋮ của mùa lễ thử → **Xóa mùa lễ** → xác nhận. Trang chủ trở lại như cũ sau tối đa 1 phút.
7. Kiểm tra nhanh trang cũ vẫn bình thường: **Lịch hẹn**, **Bán hàng**, trang chủ.

Nếu một bước ở 5.4 lỗi mà 5.1 đến 5.3 đều đạt: chụp màn hình và báo kỹ thuật viên; chưa cần quay lại, vì phần mùa lễ là mới, các chức năng cũ không phụ thuộc. Nếu **mọi trang** báo "hệ thống không phản hồi": báo ngay.

## Bước 6. Quay lại bản cũ nếu có sự cố

Chọn **một** trong hai cách. Cách nào cũng **không xóa** thư mục `/opt/lucyspa-media`.

### Cách A (nhẹ, nên dùng trước): quay lại phần mềm, giữ nguyên cơ sở dữ liệu

Migration chỉ **thêm** bảng và cột; bản cũ bỏ qua chúng nên **không mất dữ liệu nào**.

```
cd /opt/lucyspa
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
```

(Nếu `OLD_COMMIT` mất, dùng `684b9ee` hoặc mã bản cũ Owner đã ghi; xem mã đầy đủ bằng `git log --oneline | head`.) **Mong đợi:** 3 dòng `online`, `"status":"ok"` ở `/health/ready`. Giao diện mùa lễ biến mất; popup/slide đã liên kết với mùa lễ sẽ hiển thị theo thời gian riêng của chúng (đã lưu bằng thời gian của mùa lễ) như popup/slide thường.

### Cách B (đầy đủ): khôi phục cả cơ sở dữ liệu

Chỉ dùng khi thật sự cần (ví dụ migration báo lỗi giữa chừng). **Cảnh báo:** mọi dữ liệu phát sinh **sau** lúc sao lưu (lịch hẹn, hóa đơn, thanh toán mới) sẽ mất. Nếu đã có thanh toán thật sau khi deploy: **DỪNG và hỏi kỹ thuật viên trước.**

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
ls -l "$BACKUP"
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/restore.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error /tmp/restore.dump && rm /tmp/restore.dump'
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
```

(Nếu cửa sổ terminal đã đóng và biến `$BACKUP` mất: `ls -l /root/backups/` rồi đặt lại `export BACKUP=/root/backups/<tên tệp lucyspa-pre-s1s5-...>.dump`.) **Mong đợi:** `pg_restore` không in lỗi; 3 dòng `online`; chạy lại lệnh ở 2.1 thấy đúng các số đã ghi. **Nếu có lỗi: DỪNG, không chạy lại nhiều lần**; bản sao lưu vẫn còn nguyên.

## Sau khi xong

- Báo lại kỹ thuật viên/Claude: mã commit đang chạy (`git rev-parse HEAD`), kết quả `pm2 status`, kết quả 5.2.
- **Dùng hằng ngày:** Tết/Trung thu và các lễ âm lịch phải tự nhập ngày thật mỗi năm; lễ dương lịch được gợi ý sẵn ngày (sửa được). Mỗi lúc chỉ bật một mùa lễ; hết hạn là tự trở lại bình thường.
- Muốn giao việc cho nhân sự marketing: dùng vai trò có quyền "Quản lý nội dung website" (phạm vi toàn hệ thống).
- Giữ bản sao lưu `/root/backups/lucyspa-pre-s1s5-*.dump` ít nhất 7 ngày.
