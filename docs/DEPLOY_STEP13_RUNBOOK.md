# Hướng dẫn đưa Step 13 lên máy chủ thật (production)

Dành cho Owner, không cần rành kỹ thuật. Làm **từng bước, theo thứ tự**. Mỗi bước có: lệnh cần gõ, kết quả mong đợi, và việc phải làm nếu kết quả khác. **Nếu một bước ra kết quả khác mong đợi: DỪNG, không làm bước tiếp theo, chụp màn hình gửi lại.**

## Tóm tắt

- **Bản sẽ cài:** commit `bf8bf815b11db128c72f1e10d72619e9ea04cd0e` (viết tắt `bf8bf81`). Đây là bản có Step 11 (thư viện ảnh), Step 12 (popup) và Step 13 (slider trang chủ).
- **Từ bản nào:** bản đang chạy trên máy chủ, Owner sẽ cho biết ở Bước 1 (giả định cũ nhất là `a9887ba`).
- **Thay đổi cơ sở dữ liệu:** đúng **4 migration**, chỉ thêm, không xóa gì: `20261018000000_uxui_step11_website_permission`, `20261018000001_uxui_step11_media_library`, `20261019000000_uxui_step12_website_popups`, `20261020000000_uxui_step13_website_slides`.
- **Thay đổi cấu hình:** thêm 1 dòng `MEDIA_STORAGE_DIR=/opt/lucyspa-media` vào file `.env`. Thiếu dòng này API cố ý không khởi động.
- **Thư viện mới:** `sharp` (xử lý ảnh), tự cài ở Bước 4.
- **Thời gian:** khoảng 20 đến 30 phút. Chọn lúc ít khách (ví dụ sau giờ đóng cửa). Từ lúc sao lưu (Bước 2) đến lúc xong (Bước 4) dữ liệu mới phát sinh sẽ **mất nếu phải quay lại bằng bản sao lưu**, nên đừng để lâu.
- Mọi lệnh gõ trên máy chủ, dùng tài khoản đã dùng cho các lần deploy trước (có quyền `root`/`sudo`), **trong cùng một cửa sổ terminal** từ đầu đến cuối (một số lệnh dùng biến nhớ tạm).

## Bước 0. Điều kiện trước khi bắt đầu

1. Trên GitHub, tab **Actions**, commit `bf8bf81` phải có dấu **xanh** (đã chạy xong, không đỏ, không đang chạy). Nếu đỏ hoặc đang chạy: **DỪNG**, đừng deploy.
2. Kỹ thuật viên (hoặc Claude) đã xác nhận bản này chạy được trên máy phát triển. Test của repo đã xanh trước khi commit.
3. Có điện thoại/máy tính khác để đăng nhập Owner kiểm tra ở Bước 5.

## Bước 1. Xem máy chủ đang chạy bản nào

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
git log -1 --format='%h %cd %s'
pm2 status
```

**Mong đợi:**

- `git status --short` **không in gì** (thư mục sạch).
- `git rev-parse HEAD` in ra một mã dài 40 ký tự (mã này Owner báo lại để kỹ thuật viên đối chiếu; giả định là `a9887ba04b2ef99cb3477eb4fd7afd6b918fe55a` hoặc mới hơn).
- `pm2 status` có 3 dòng **online**: `lucyspa-api`, `lucyspa-web`, `lucyspa-worker`.

**Ghi lại mã commit cũ này** (để quay lại nếu cần). Gõ (thay mã bằng mã thật vừa in):

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

**Nếu sai: DỪNG** khi: có dòng lạ ở `git status --short` (có người sửa tay trên máy chủ); một trong 3 tiến trình không `online`; hoặc mã commit **cũ hơn** `a9887ba` (khi đó số migration chờ sẽ không phải 4, xem Bước 4.3).

Kiểm tra thêm chỗ trống ổ đĩa và nơi API đọc cấu hình:

```
df -h /
pm2 describe lucyspa-api | grep -E "script args|exec cwd|script path"
```

**Mong đợi:** ổ đĩa còn trống ít nhất vài GB (cột `Avail`); phần `script args` có chứa `--env-file-if-exists=../../.env`, `exec cwd` kết thúc bằng `apps/api`. Tức là API đọc file `/opt/lucyspa/.env`. **Nếu khác** (ví dụ API khởi động bằng file cấu hình khác): DỪNG, báo kỹ thuật viên trước khi sửa `.env`.

## Bước 2. Sao lưu cơ sở dữ liệu TRƯỚC khi làm gì khác

Cơ sở dữ liệu nằm trong container Docker `lucy-spa-postgres-1`. Lệnh dưới lấy tên người dùng và tên cơ sở dữ liệu từ chính container, **không in mật khẩu**.

2.1. Ghi lại vài con số để so sánh sau này:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices"'
```

**Mong đợi:** một dòng dạng `12|345|67` (số người dùng | số lịch hẹn | số hóa đơn). **Ghi lại dòng này ra giấy.**

2.2. Tạo bản sao lưu:

```
mkdir -p /root/backups
export BACKUP=/root/backups/lucyspa-pre-step13-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
echo "$BACKUP"
```

**Mong đợi:** không in lỗi nào, `echo` in ra đường dẫn tệp.

2.3. Kiểm tra tệp có dung lượng và đọc được:

```
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
chmod 600 "$BACKUP"
```

**Mong đợi:**

- `ls -l` cho thấy dung lượng **lớn hơn 100 KB** (các lần trước: 94 đến 152 KB; bây giờ dữ liệu nhiều hơn nên thường vài trăm KB đến vài MB). Dung lượng 0 hoặc vài byte là hỏng.
- Dòng `wc -l` in một số **lớn hơn 200** (số mục trong bản sao lưu), và 6 dòng đầu có chữ `Format: CUSTOM` và tên cơ sở dữ liệu.

**Nếu sai: DỪNG.** Không deploy khi chưa có bản sao lưu đọc được. Chép bản sao lưu ra nơi khác (máy của Owner) nếu có thể: `scp` hoặc tải qua công cụ quản lý máy chủ.

## Bước 3. Tạo thư mục lưu ảnh và khai báo cho API

3.1. Xem tài khoản đang chạy API và tạo thư mục (nằm **ngoài** thư mục code để lần deploy sau không làm mất ảnh):

```
ps -o user= -p $(pm2 pid lucyspa-api)
```

**Mong đợi:** in một tên tài khoản (ví dụ `root`). Gọi nó là `<TÀI-KHOẢN>`, dùng ở lệnh kế tiếp.

```
sudo mkdir -p /opt/lucyspa-media
sudo chown <TÀI-KHOẢN>:<TÀI-KHOẢN> /opt/lucyspa-media
sudo chmod 750 /opt/lucyspa-media
ls -ld /opt/lucyspa-media
sudo -u <TÀI-KHOẢN> test -w /opt/lucyspa-media && echo GHI_DUOC
```

**Mong đợi:** `ls -ld` in một dòng bắt đầu `drwxr-x---` và có tên `<TÀI-KHOẢN>`; lệnh cuối in `GHI_DUOC`. **Nếu sai: DỪNG.**

3.2. Khai báo thư mục trong file `.env` của API, **chỉ thêm một dòng ở cuối, không ghi đè file**. Trước hết sao lưu file `.env` (file này chứa mật khẩu, nên chỉ mình `root` đọc được; **đừng mở ra hay dán lên đâu**):

```
cd /opt/lucyspa
cp -p .env /root/backups/env-pre-step13-$(date -u +%Y%m%dT%H%M%SZ).bak
chmod 600 /root/backups/env-pre-step13-*.bak
grep -c '^MEDIA_STORAGE_DIR=' .env
```

**Mong đợi:** `grep -c` in `0` (chưa có dòng này). Nếu in `1`: đã có, **bỏ qua lệnh thêm dòng** bên dưới và chỉ cần kiểm tra giá trị bằng lệnh `grep -n '^MEDIA_STORAGE_DIR=' .env` thấy `/opt/lucyspa-media`. Nếu in số lớn hơn 1: DỪNG.

Thêm dòng (dấu `>>` là **nối thêm** vào cuối, không xóa nội dung cũ; tuyệt đối không dùng một dấu `>`):

```
printf '\nMEDIA_STORAGE_DIR=/opt/lucyspa-media\n' >> .env
grep -n '^MEDIA_STORAGE_DIR=' .env
```

**Mong đợi:** in đúng một dòng `...:MEDIA_STORAGE_DIR=/opt/lucyspa-media`. (Lệnh `grep` chỉ in dòng này, không in mật khẩu.) **Nếu sai: DỪNG**; có thể khôi phục `.env` từ bản `.bak` ở trên.

## Bước 4. Lấy bản mới, cài, cập nhật cơ sở dữ liệu, build, khởi động lại

4.1. Lấy đúng bản `bf8bf81`:

```
cd /opt/lucyspa
git fetch origin
git cat-file -t bf8bf815b11db128c72f1e10d72619e9ea04cd0e
git checkout bf8bf815b11db128c72f1e10d72619e9ea04cd0e
git log -1 --format='%h %s'
```

**Mong đợi:** `cat-file` in `commit`; sau `checkout` có thông báo "detached HEAD" (bình thường, các lần trước cũng vậy); dòng cuối bắt đầu bằng `bf8bf81 feat: uxui step 13 homepage slider`. **Nếu sai: DỪNG.**

4.2. Cài thư viện (bản khóa sẵn, không tự đổi phiên bản):

```
pnpm install --frozen-lockfile
```

**Mong đợi:** kết thúc bằng `Done` (không có chữ `ERR`), có nhắc `sharp` được cài. **Nếu có `ERR_PNPM`: DỪNG.**

4.3. Xem **trước khi áp** có đúng 4 migration đang chờ:

```
pnpm db:status
```

(Lệnh này có thể kết thúc với dấu hiệu lỗi vì có migration chờ: bình thường.)

**Mong đợi:** có phần "Following migration have not yet been applied" liệt kê **đúng 4 tên**:
`20261018000000_uxui_step11_website_permission`, `20261018000001_uxui_step11_media_library`, `20261019000000_uxui_step12_website_popups`, `20261020000000_uxui_step13_website_slides`; và dòng đầu cho biết `39 migrations found` (đã áp 35). **Nếu danh sách khác** (thiếu, thừa, hoặc báo lỗi kết nối): **DỪNG** và gửi lại nguyên văn kết quả.

4.4. Áp migration (chỉ thêm bảng và quyền, không xóa gì):

```
pnpm db:deploy
pnpm db:status
```

**Mong đợi:** lần 1 liệt kê 4 migration và kết thúc `All migrations have been successfully applied.`; lần 2 báo `Database schema is up to date!`. **Nếu có lỗi: DỪNG, không chạy lại, không sửa tay**; làm theo Bước 6 nếu cần.

4.5. Đồng bộ danh sách quyền (thêm quyền "Quản lý nội dung website"). Lệnh tự build phần cần thiết, mất 1 đến 2 phút:

```
pnpm db:permissions:sync
pnpm db:permissions:sync
```

**Mong đợi:** lần 1 báo `1 inserted` (cộng thêm số `already present`; số này tùy bản cũ, không cần để ý); lần 2 báo `0 inserted`. **Nếu lần 2 vẫn `inserted` khác 0 hoặc báo mismatch: DỪNG.**

4.6. Build toàn bộ (vài phút):

```
pnpm build
```

**Mong đợi:** chạy hết, không có chữ `ERR` hay `error` ở cuối. **Nếu lỗi: DỪNG** (bản đang chạy vẫn chưa bị đụng tới vì chưa khởi động lại; cơ sở dữ liệu đã có bảng mới nhưng bản cũ bỏ qua chúng).

> Lưu ý: trang web ghi nhớ địa chỉ API ngay lúc build (biến `API_UPSTREAM_ORIGIN`). **Không cần làm gì thêm:** trên máy chủ biến này không được đặt (trong `.env` chỉ là dòng ghi chú), và khi trống code dùng sẵn `http://127.0.0.1:3001`, đúng cổng API thật. **Đừng đặt biến này** trong cửa sổ terminal khi build (hãy build như các lần trước). Nếu sau này mọi trang báo "hệ thống không phản hồi", báo kỹ thuật viên.

4.7. Khởi động lại 3 tiến trình, nạp lại cấu hình mới:

```
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
```

**Mong đợi:** 3 dòng đều `online`. **Nếu có dòng `errored` hoặc `stopped`, hoặc số ở cột `↺` (restart) cứ tăng: DỪNG và xem Bước 5.2/Bước 6.**

## Bước 5. Kiểm tra sau khi deploy

5.1. Tiến trình ổn định (chạy lại sau 1 phút):

```
pm2 status
```

**Mong đợi:** 3 dòng `online`, cột `↺` không tăng thêm so với lần trước.

5.2. Nhật ký API không báo lỗi thiếu thư mục ảnh:

```
pm2 logs lucyspa-api --lines 40 --nostream
pm2 logs lucyspa-api --err --lines 20 --nostream | grep -i "MEDIA_STORAGE_DIR" || echo KHONG_CO_LOI_MEDIA
```

**Mong đợi:** phần đầu có dòng `API started`; lệnh thứ hai in `KHONG_CO_LOI_MEDIA`. Nếu thấy `Invalid environment configuration: MEDIA_STORAGE_DIR`: quay lại Bước 3.2 (dòng chưa đúng hoặc API không đọc file đó), sửa rồi `pm2 restart lucyspa-api --update-env`. Dòng lỗi **cũ** của các lần khởi động trước có thể còn trong log: chỉ quan tâm dòng có giờ **sau** lần khởi động lại ở Bước 4.7.

5.3. API sống và các đường dẫn công khai mới (thay cổng nếu máy chủ dùng cổng khác; mặc định API `3001`, web `3000`):

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -i "http://127.0.0.1:3001/api/v1/public/website/slides?locale=vi" | head -n 12
curl -s -o /dev/null -w "popup: %{http_code}\n" "http://127.0.0.1:3001/api/v1/public/website/popup?locale=vi"
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "workforce: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
```

**Mong đợi:**

- dòng đầu có `"status":"ok"` với `database` và `redis` đều `up`;
- đường dẫn slides trả `200` và nội dung `{"items":[]}` (chưa có slide nào), có dòng `cache-control: public, max-age=60`;
- popup trả `204` (chưa có popup đang bật) hoặc `200`;
- `vi` và `workforce` đều `200`.

**Nếu sai: DỪNG.**

5.4. Kiểm tra số liệu không đổi (chạy lại lệnh ở 2.1):

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices"'
```

**Mong đợi:** giống dòng đã ghi ở 2.1 (hoặc nhỉnh hơn vì khách vẫn đặt lịch trong lúc deploy). **Nếu ít hơn: DỪNG ngay và báo.**

5.5. Kiểm tra bằng trình duyệt (Owner tự làm, đăng nhập tài khoản Owner):

1. Mở `/vi/workforce/website`. Thấy trang **Nội dung website** có 3 tab: **Thư viện ảnh**, **Popup**, **Slider**.
2. Tab **Thư viện ảnh**: bấm **Tải ảnh lên**, chọn **1 ảnh thử** (JPEG, PNG hoặc WebP, dưới 10 MB). **Mong đợi:** ảnh hiện ra trong thư viện. Trên máy chủ kiểm tra tệp đã được lưu: `ls -R /opt/lucyspa-media | head` có thư mục năm/tháng và tệp. Nếu báo lỗi "tệp quá lớn" mà ảnh nhỏ hơn 10 MB và máy chủ có nginx đứng trước: thêm `client_max_body_size 11m;` vào cấu hình nginx rồi nạp lại nginx (nhờ kỹ thuật viên).
3. Bấm vào ảnh, nhập **mô tả tiếng Việt**, lưu.
4. Tab **Slider**: bấm **Thêm slide**, chọn ảnh vừa tải, bật **Hiển thị slide**, lưu. Mở trang chủ `/vi` (cửa sổ ẩn danh): **Mong đợi:** thấy slider ở đầu trang (chờ tối đa 1 phút vì bộ nhớ đệm 60 giây).
5. **Dọn dẹp:** xóa slide thử (menu ⋮, **Xóa slide**), rồi xóa ảnh thử (menu ⋮ của ảnh). Trang chủ trở lại như cũ.
6. Kiểm tra nhanh trang cũ vẫn bình thường: đăng nhập và mở **Lịch hẹn**/**Bán hàng** như mọi ngày.

Nếu một bước ở 5.5 lỗi mà các bước 5.1 đến 5.4 đều đạt: chụp màn hình và báo kỹ thuật viên; chưa cần quay lại, vì nội dung website là phần mới, các chức năng cũ không phụ thuộc.

## Bước 6. Quay lại bản cũ nếu có sự cố

Chọn **một** trong hai cách. Cách nào cũng **không xóa** thư mục `/opt/lucyspa-media` (xóa là mất ảnh).

### Cách A (nhẹ): chỉ quay lại phần mềm, giữ nguyên cơ sở dữ liệu

Dùng khi lỗi nằm ở **Step 13 (slider)** hoặc giao diện, còn Step 11 (thư viện ảnh) và Step 12 (popup) vẫn dùng tốt. Bản `c47f8f775b4f8c44b82923ad369dd2a19af3ff81` là bản Step 12 hoàn chỉnh (không có slider). Bảng `website_slides` đã tạo chỉ nằm đó và bản này bỏ qua nó, **không mất dữ liệu nào**.

```
cd /opt/lucyspa
git checkout c47f8f775b4f8c44b82923ad369dd2a19af3ff81
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
```

**Mong đợi:** 3 dòng `online`, và làm lại 5.3. Lưu ý: nếu đã có slide đang hiển thị, trang chủ sẽ không còn slider cho đến khi vào lại bản mới.

### Cách B (đầy đủ): quay lại hẳn bản cũ kể cả cơ sở dữ liệu (đã áp migration)

Dùng khi: migration đã áp rồi mới phát hiện lỗi nặng, hoặc cần về đúng bản trước Step 11 (`OLD_COMMIT` ở Bước 1). **Lý do cần khôi phục:** Step 11 thêm một giá trị mới vào danh sách quyền trong cơ sở dữ liệu mà bản cũ không biết; bản cũ sẽ lỗi ở trang **Vai trò & quyền**. Cơ sở dữ liệu không thể "gỡ" giá trị đó bằng migration, nên cách an toàn là khôi phục bản sao lưu của Bước 2.

**Cảnh báo:** mọi dữ liệu phát sinh **sau** lúc sao lưu (lịch hẹn, hóa đơn, thanh toán mới) sẽ mất. Làm càng sớm càng ít mất. Nếu đã có thanh toán thật sau khi deploy: **DỪNG và hỏi kỹ thuật viên trước.**

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-worker lucyspa-web
ls -l "$BACKUP"
```

(Nếu cửa sổ terminal đã đóng và biến `$BACKUP` mất: gõ `ls -l /root/backups/` rồi đặt lại `export BACKUP=/root/backups/<tên tệp lucyspa-pre-step13-...>.dump`.) **Mong đợi:** thấy tệp sao lưu có dung lượng. **Nếu không thấy: DỪNG.**

Khôi phục cơ sở dữ liệu từ bản sao lưu:

```
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/restore.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error /tmp/restore.dump && rm /tmp/restore.dump'
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users), (select count(*) from bookings), (select count(*) from invoices)"'
```

**Mong đợi:** lệnh `dropdb` không báo lỗi "being accessed by other users" (các ứng dụng đã dừng); `pg_restore` không in lỗi; dòng cuối khớp với số đã ghi ở 2.1. **Nếu có lỗi: DỪNG, không chạy lại nhiều lần**, báo kỹ thuật viên (bản sao lưu vẫn còn nguyên).

Đưa phần mềm về bản cũ và khởi động lại:

```
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 15
pm2 status
curl -s http://127.0.0.1:3001/health/ready; echo
```

**Mong đợi:** 3 dòng `online`, `"status":"ok"`. (Nếu `OLD_COMMIT` mất, dùng mã `a9887ba04b2ef99cb3477eb4fd7afd6b918fe55a` hoặc mã bản cũ Owner đã ghi.) Dòng `MEDIA_STORAGE_DIR` trong `.env` để nguyên: bản cũ bỏ qua. Sau đó `pnpm db:status` phải báo `Database schema is up to date!` ở bản cũ.

## Sau khi xong

- Báo lại kỹ thuật viên/Claude: mã commit đang chạy (`git rev-parse HEAD`), kết quả `pm2 status`, kết quả 5.3.
- **Sao lưu định kỳ:** thêm thư mục `/opt/lucyspa-media` vào lịch sao lưu cùng với cơ sở dữ liệu. Hai thứ này phải được sao lưu và khôi phục **cùng thời điểm**: cơ sở dữ liệu chỉ nhớ tên tệp ngẫu nhiên, mất thư mục thì ảnh bị lỗi 404.
- Muốn giao việc quản lý website cho nhân sự marketing: tạo vai trò có quyền "Quản lý nội dung website" và gán ở phạm vi **toàn hệ thống** (gán theo chi nhánh sẽ không có tác dụng).
- Giữ bản sao lưu `/root/backups/lucyspa-pre-step13-*.dump` ít nhất 7 ngày.
