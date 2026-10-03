# Hướng dẫn đưa Part 2 (website công khai và khu vực khách hàng làm lại) lên máy chủ thật (production)

Dành cho Owner, không cần rành kỹ thuật. Làm **từng bước, theo thứ tự**. Mỗi bước có: lệnh cần gõ, kết quả mong đợi, và việc phải làm nếu kết quả khác. **Nếu một bước ra kết quả khác mong đợi: DỪNG, không làm bước tiếp theo, chụp màn hình gửi lại.**

## Tóm tắt

- **Bản sẽ cài:** commit `7adf3bf7866561445ffdeb81befc06693b63ec1e` (viết tắt `7adf3bf`). Đây là bản có toàn bộ Part 2: trang chủ và trang Dịch vụ lấy dữ liệu thật (khẩu hiệu, địa chỉ, hotline, giờ mở cửa, danh mục dịch vụ), đăng nhập / đăng ký / quên mật khẩu trong khung website mới, đặt lịch 4 bước (có thể mở thẳng từ một dịch vụ), khu vực thành viên (tổng quan, lịch hẹn, hóa đơn) dạng bảng, hủy lịch hẹn bằng hộp thoại xác nhận, hiệu ứng chuyển động nhẹ, và dữ liệu cho công cụ tìm kiếm (sitemap, robots, thẻ mô tả).
- **Về các commit sau bản này:** sau `7adf3bf` chỉ có thể có commit tài liệu (không đổi mã); hướng dẫn này luôn cài đúng mã commit ở trên, không cài "bản mới nhất" của nhánh `main`.
- **Từ bản nào:** Owner xác nhận ở Bước 1. Có hai trường hợp:
  - **Trường hợp A:** máy chủ vẫn ở bản UX/UI Step 2–13 (`684b9ee`, chưa có Mùa lễ). Khi đó lần deploy này cũng đưa lên **Mùa lễ S1–S6** và Step 14 (đã làm xong, đã có hướng dẫn riêng `docs/DEPLOY_S1_S5_RUNBOOK.md` và `docs/DEPLOY_S6_RUNBOOK.md`; **không cần làm riêng nữa**, bản này gộp chung): có **3 migration** chờ.
  - **Trường hợp B:** máy chủ đã cài S1–S6 (`6ec65a7` hoặc `d59d02c`). Khi đó chỉ có **1 migration** chờ.
- **Thay đổi cơ sở dữ liệu (chỉ thêm, không xóa gì):**
  - `20261021000000_uxui_s3_website_seasons` (chỉ trường hợp A): bảng `website_seasons` và cột `season_id` (cho phép trống) ở popup và slide.
  - `20261022000000_uxui_s6b_season_decoration` (chỉ trường hợp A): 9 cột ở `website_seasons` và bảng `website_season_slot_media`.
  - `20261023000000_uxui_part2_shop_info` (cả hai trường hợp): bảng `website_shop_info` có **đúng 1 dòng** với giá trị của Owner: khẩu hiệu tiếng Việt "Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc", khẩu hiệu tiếng Anh "Heartfelt Relaxation – Elevated Beauty", địa chỉ "04 Nguyễn Quang Bích, Đà Nẵng", hotline "0934 936 101". Sửa được sau trong Admin.
- **Quyền mới:** không. Dùng lại quyền "Quản lý nội dung website". Vẫn chạy bước đồng bộ quyền cho chắc, kết quả mong đợi là `0 inserted`.
- **Biến môi trường mới:** không có. Thư mục ảnh `MEDIA_STORAGE_DIR` giữ nguyên. Lưu ý: sitemap, robots và thẻ canonical lấy **tên miền khách đang truy cập** (từ các dòng `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` mà máy chủ web trung gian chuyển tiếp). Bước 5.3 kiểm tra việc này.
- **Thay đổi hành vi cần biết:**
  - Trang chủ, trang Dịch vụ và trang từng dịch vụ **được phép xuất hiện trên Google** (trước đây chặn `noindex`; Owner đã đồng ý, vì website chưa ra mắt chính thức nên cân nhắc thời điểm deploy). Trang thành viên, đăng nhập và quản trị vẫn luôn bị chặn.
  - Giờ mở cửa trên website lấy từ giờ hoạt động của **chi nhánh được chọn** trong Admin > Website > Thông tin tiệm (mặc định chi nhánh đầu tiên đang hoạt động): Owner cần mở trang này một lần để kiểm tra.
  - Khách chưa đăng nhập vẫn **phải đăng nhập mới đặt lịch** (không có đặt lịch không cần tài khoản); nút "Đặt lịch" ở mỗi dịch vụ đưa khách qua đăng nhập rồi quay lại đúng dịch vụ đó.
  - Thanh menu: "Trang chủ", "Dịch vụ"; "Lịch hẹn", "Hóa đơn" chỉ hiện khi đã đăng nhập; chỉ có một nút "Đặt lịch ngay". Chưa có mục "Mỹ phẩm" (để dành cho giai đoạn sau).
- **Thời gian:** khoảng 30 đến 40 phút. Chọn lúc ít khách. Từ lúc sao lưu (Bước 2) đến lúc xong (Bước 4) dữ liệu mới phát sinh sẽ **mất nếu phải quay lại bằng bản sao lưu**.
- Mọi lệnh gõ trên máy chủ, dùng tài khoản đã dùng cho các lần deploy trước (có quyền `root`/`sudo`), **trong cùng một cửa sổ terminal** từ đầu đến cuối.

## Bước 0. Điều kiện trước khi bắt đầu

1. Trên GitHub, tab **Actions**, commit `7adf3bf` phải có dấu **xanh** (đã chạy xong, không đỏ, không đang chạy). Nếu đỏ hoặc đang chạy: **DỪNG**, đừng deploy.
2. Có điện thoại/máy tính khác để kiểm tra ở Bước 5, và một **tài khoản khách thử** (hoặc email thật của Owner để đăng ký thử).
3. Tải sẵn về máy Owner tệp ảnh tạm của trang chủ: `docs/mockups/part2/assets/placeholder-hero.jpg` (trong kho mã trên GitHub). Dùng ở Bước 5.5 (chỉ khi Owner vẫn đồng ý dùng ảnh tạm; sau này thay bằng ảnh thật của tiệm).
4. Biết tên miền thật của website (ví dụ `lucyspa.vn`).

## Bước 1. Xem máy chủ đang chạy bản nào

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
git log -1 --format='%h %cd %s'
pm2 status
```

**Mong đợi:** `git status --short` **không in gì**; `pm2 status` có 3 dòng **online**: `lucyspa-api`, `lucyspa-web`, `lucyspa-worker`; mã commit bắt đầu bằng `684b9ee` (trường hợp A) hoặc `6ec65a7` / `d59d02c` (trường hợp B).

Ghi lại mã commit cũ (để quay lại nếu cần), thay bằng mã thật vừa in:

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

**Nếu sai: DỪNG** khi có dòng lạ ở `git status --short`, một tiến trình không `online`, hoặc mã commit không thuộc các bản trên.

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
export BACKUP=/root/backups/lucyspa-pre-part2-$(date -u +%Y%m%dT%H%M%SZ).dump
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

**Phạm vi sao lưu:** bản này lưu cơ sở dữ liệu. Thư mục ảnh `/opt/lucyspa-media` không bị bản này xóa hay đổi; ảnh mới Owner tải lên ở Bước 5.5 chỉ thêm tệp. Nếu muốn chắc, sao chép thư mục ảnh: `cp -a /opt/lucyspa-media /root/backups/lucyspa-media-pre-part2` (kiểm tra còn đủ chỗ trống bằng `df -h /`).

## Bước 3. Cấu hình

Không cần sửa `.env`, không cần tạo thư mục mới. Kiểm tra nhanh thư mục ảnh vẫn còn:

```
ls -ld /opt/lucyspa-media
grep -c '^MEDIA_STORAGE_DIR=' /opt/lucyspa/.env
```

**Mong đợi:** thư mục tồn tại; `grep -c` in `1`. **Nếu sai: DỪNG.**

## Bước 4. Lấy bản mới, cài, cập nhật cơ sở dữ liệu, build, khởi động lại

4.1. Lấy đúng bản `7adf3bf`:

```
cd /opt/lucyspa
git fetch origin
git cat-file -t 7adf3bf7866561445ffdeb81befc06693b63ec1e
git checkout 7adf3bf7866561445ffdeb81befc06693b63ec1e
git log -1 --format='%h %s'
```

**Mong đợi:** `cat-file` in `commit`; dòng cuối bắt đầu bằng `7adf3bf`. **Nếu sai: DỪNG.**

4.2. Cài thư viện (bản khóa sẵn):

```
pnpm install --frozen-lockfile
```

**Mong đợi:** kết thúc bằng `Done`, không có `ERR`. **Nếu có `ERR_PNPM`: DỪNG.**

4.3. Xem **trước khi áp** các migration đang chờ:

```
pnpm db:status
```

(Có thể kết thúc với dấu hiệu lỗi vì có migration chờ: bình thường.)

**Mong đợi:**

- Trường hợp A: **đúng 3 tên**: `20261021000000_uxui_s3_website_seasons`, `20261022000000_uxui_s6b_season_decoration`, `20261023000000_uxui_part2_shop_info`.
- Trường hợp B: **đúng 1 tên**: `20261023000000_uxui_part2_shop_info`.

**Nếu danh sách khác: DỪNG** và gửi lại nguyên văn.

4.4. Áp migration (chỉ thêm bảng và cột, không xóa gì):

```
pnpm db:deploy
pnpm db:status
```

**Mong đợi:** lần 1 áp các migration trên và kết thúc `All migrations have been successfully applied.`; lần 2 báo `Database schema is up to date!`. **Nếu có lỗi: DỪNG, không chạy lại**; xem Bước 6.

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

**Mong đợi:** chạy hết, không có chữ `ERR` hay `error` ở cuối. **Nếu lỗi: DỪNG** (bản đang chạy chưa bị đụng tới vì chưa khởi động lại; cơ sở dữ liệu đã có bảng và cột mới nhưng bản cũ bỏ qua).

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

5.2. API sống, bảng mới có mặt, các địa chỉ công khai (mặc định API `3001`, web `3000`):

```
curl -s http://127.0.0.1:3001/health/ready; echo
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from website_shop_info"'
curl -s -o /dev/null -w "public site: %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/site?locale=vi"
curl -s -o /dev/null -w "public services: %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/services?locale=vi"
curl -s -o /dev/null -w "dich vu khong co: %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/services/KHONG-CO?locale=vi"
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "services: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "trang dich vu khong co: %{http_code}\n" http://127.0.0.1:3000/vi/services/KHONG-CO
curl -s -o /dev/null -w "dang nhap: %{http_code}\n" http://127.0.0.1:3000/vi/account/login
curl -s -o /dev/null -w "workforce: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "sitemap: %{http_code}\n" http://127.0.0.1:3000/sitemap.xml
curl -s -o /dev/null -w "robots: %{http_code}\n" http://127.0.0.1:3000/robots.txt
```

**Mong đợi:** `"status":"ok"` với `database` và `redis` đều `up`; số đếm bảng mới in `1`; `public site` và `public services` đều `200`; `dich vu khong co` và `trang dich vu khong co` đều `404`; `vi`, `services`, `dang nhap`, `workforce`, `sitemap`, `robots` đều `200`. **Nếu sai: DỪNG.**

5.3. Địa chỉ công khai đúng tên miền (thay `lucyspa.vn` bằng tên miền thật):

```
export DOMAIN=lucyspa.vn
curl -s https://$DOMAIN/robots.txt
curl -s https://$DOMAIN/sitemap.xml | head -n 8
curl -s https://$DOMAIN/vi | grep -o 'rel="canonical" href="[^"]*"'
curl -s https://$DOMAIN/vi/account/login | grep -o '<meta name="robots" content="[^"]*"'
curl -s https://$DOMAIN/vi | grep -o '<meta name="robots" content="[^"]*"'
```

**Mong đợi:** `robots.txt` có dòng `Sitemap: https://lucyspa.vn/sitemap.xml` và các dòng `Disallow:` cho `/vi/account`, `/vi/workforce`; `sitemap.xml` liệt kê các địa chỉ bắt đầu bằng `https://lucyspa.vn/`; canonical của trang chủ là `https://lucyspa.vn/vi`; trang đăng nhập có `noindex, nofollow`; trang chủ có `index, follow`. **Nếu các địa chỉ hiện `http://127.0.0.1` hoặc `http://` thay vì `https://tên-miền`:** máy chủ web trung gian chưa chuyển tiếp `Host` và `X-Forwarded-Proto`; báo kỹ thuật viên thêm `proxy_set_header Host $host;` và `proxy_set_header X-Forwarded-Proto $scheme;` vào cấu hình rồi tải lại. Việc này không làm hỏng website, chỉ làm sai địa chỉ trong dữ liệu tìm kiếm.

5.4. Số liệu không đổi (chạy lại lệnh ở 2.1): **Mong đợi:** giống dòng đã ghi (hoặc nhỉnh hơn vì khách vẫn đặt lịch). **Nếu ít hơn: DỪNG ngay và báo.**

5.5. Kiểm tra bằng trình duyệt (Owner đăng nhập tài khoản Owner):

1. **Shop info (làm đầu tiên):** `/vi/workforce/website`, tab cuối **Thông tin tiệm**. Kiểm tra khẩu hiệu tiếng Việt/Anh, địa chỉ, hotline đúng như Owner đã đưa. Mục **Liên kết bản đồ**: dán đường dẫn Google Maps (bắt đầu bằng `https://`; để trống thì nút "Chỉ đường" tìm theo địa chỉ). Mục **Chi nhánh lấy giờ**: chọn chi nhánh chính; phần xem trước hiện giờ mở cửa (mặc định 09:00–21:00 nếu chưa đổi). Bấm **Lưu**. **Nếu giờ sai:** sửa giờ hoạt động của chi nhánh đó (cùng nguồn với đặt lịch), không sửa ở đây.
2. **Ảnh đầu trang chủ (tuỳ chọn, chỉ khi vẫn đồng ý dùng ảnh tạm):** Admin > Thư viện ảnh, tải lên `placeholder-hero.jpg`, tiêu đề **PLACEHOLDER - replace with a real shop photo**, mô tả ảnh (alt) tiếng Việt bắt buộc, ví dụ "Không gian thư giãn của Lucy Spa (ảnh tạm)". Quay lại Thông tin tiệm, mục **Ảnh đầu trang chủ** chọn ảnh này, **Lưu**. Khi có ảnh thật của tiệm: tải lên và chọn lại.
3. **Trang chủ** `/vi` ở cửa sổ ẩn danh (chờ tối đa 1 phút vì bộ nhớ đệm 60 giây): khẩu hiệu đúng, dải thông tin (giờ, địa chỉ, hotline) đúng, các thẻ nhóm dịch vụ lấy từ danh mục thật (kèm giá), mục **Ghé thăm** có nút **Chỉ đường** mở đúng liên kết bản đồ vừa dán. Đổi sang tiếng Anh (nút **EN**) kiểm tra khẩu hiệu tiếng Anh.
4. **Dịch vụ** `/vi/services`: lọc theo nhóm, mở một dịch vụ (trang chi tiết có giá, thời gian dự kiến), dịch vụ tính theo ngón ghi rõ "số ngón chốt tại tiệm". Mở một địa chỉ dịch vụ gõ sai: phải thấy trang "Không tìm thấy".
5. **Đặt lịch từ một dịch vụ:** ở cửa sổ ẩn danh bấm **Đặt lịch** trên một dịch vụ → chuyển sang đăng nhập → đăng nhập bằng tài khoản khách thử → quay lại trang đặt lịch với dịch vụ đó **đã được chọn sẵn**.
6. **Đặt lịch thử 4 bước** (tài khoản khách thử): Chọn dịch vụ → Khách → Nhân viên và giờ → Xác nhận. Thanh tạm tính hiện đúng; dịch vụ tính theo ngón hiện "+ giá theo ngón". Hoàn tất, rồi vào **Lịch hẹn** → mở lịch hẹn vừa tạo → **Hủy lịch hẹn** → hộp thoại xác nhận → xác nhận. **Mong đợi:** lịch hẹn chuyển "Đã hủy". **Làm ngay bước hủy này để không giữ chỗ thật của khách.** (Chọn ngày xa và dịch vụ ngắn khi thử.)
7. **Thanh menu:** chưa đăng nhập chỉ thấy **Trang chủ, Dịch vụ**; đăng nhập rồi thấy thêm **Lịch hẹn, Hóa đơn**; chỉ có một nút **Đặt lịch ngay**; biểu tượng mặt trời/trăng đổi giao diện sáng/tối; biểu tượng người mở menu tài khoản (Đăng nhập / Đăng ký hoặc Lịch hẹn, Hóa đơn, Thông báo, Đăng xuất).
8. **Điện thoại:** thanh dưới cùng: **Trang chủ, Dịch vụ, Đặt lịch ngay** (và **Lịch hẹn, Hóa đơn** khi đã đăng nhập); các trang không bị tràn ngang.
9. **Khu thành viên:** Tổng quan, Lịch hẹn, Hóa đơn (bảng có phân trang 20 dòng), Thông báo. Mở một hóa đơn nếu có.
10. **Quản trị không đổi:** mở nhanh **Lịch hẹn**, **Bán hàng**, tab **Slider** và **Popup** của Website.
11. **Chỉ trường hợp A (mới có Mùa lễ):** làm Bước 5.4 mục 4–8 của `docs/DEPLOY_S6_RUNBOOK.md` (tạo một mùa lễ thử, xem trang chủ, rồi **xóa mùa lễ thử**).

Nếu một bước ở 5.5 lỗi mà 5.1 đến 5.4 đều đạt: chụp màn hình và báo kỹ thuật viên; chưa cần quay lại. Nếu **mọi trang** báo "hệ thống không phản hồi": báo ngay.

## Bước 6. Quay lại bản cũ nếu có sự cố

Chọn **một** trong hai cách. Cách nào cũng **không xóa** thư mục `/opt/lucyspa-media`.

### Cách A (nhẹ, nên dùng trước): quay lại phần mềm, giữ nguyên cơ sở dữ liệu

Các migration chỉ **thêm** bảng và cột; bản cũ bỏ qua chúng nên **không mất dữ liệu nào**. Bảng `website_shop_info` có thể để nguyên, không ảnh hưởng.

```
cd /opt/lucyspa
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
```

(Nếu `OLD_COMMIT` mất, dùng mã bản cũ Owner đã ghi; xem mã bằng `git log --oneline | head`.) **Mong đợi:** 3 dòng `online`, `"status":"ok"` ở `/health/ready`. Giao diện trở lại như trước Part 2. Ảnh đã tải lên vẫn nằm trong thư viện ảnh.

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

(Nếu cửa sổ terminal đã đóng và biến `$BACKUP` mất: `ls -l /root/backups/` rồi đặt lại `export BACKUP=/root/backups/<tên tệp lucyspa-pre-part2-...>.dump`.) **Mong đợi:** `pg_restore` không in lỗi; 3 dòng `online`; chạy lại lệnh ở 2.1 thấy đúng các số đã ghi. **Nếu có lỗi: DỪNG, không chạy lại nhiều lần**; bản sao lưu vẫn còn nguyên.

## Sau khi xong

- Báo lại kỹ thuật viên/Claude: mã commit đang chạy (`git rev-parse HEAD`), kết quả `pm2 status`, kết quả 5.2 và 5.3.
- **Việc Owner làm sau:** thay ảnh tạm bằng ảnh thật của tiệm; viết mô tả ngắn cho từng dịch vụ (ô mô tả trong danh mục, tiếng Việt và tiếng Anh) để trang dịch vụ đẹp hơn và có mô tả cho Google; kiểm tra tên nhóm và thứ tự dịch vụ trong danh mục (trang web hiển thị theo nhóm của danh mục, trong nhóm xếp giá tăng dần rồi theo tên); khi website chính thức ra mắt, gửi `https://tên-miền/sitemap.xml` cho Google Search Console.
- Giữ bản sao lưu `/root/backups/lucyspa-pre-part2-*.dump` ít nhất 7 ngày.
