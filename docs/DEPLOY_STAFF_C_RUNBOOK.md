# Hướng dẫn đưa giao diện nhân viên hướng C ("Ấm áp thư giãn") lên máy chủ thật (chỉ giao diện web)

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG** và gửi Claude nguyên văn những gì terminal in ra.

**Bản sẽ cài:** commit `8b7c3413a0827f21e8973e45be56c94b10e5d9c2`, đã push lên `main`. **CI xanh:** lần chạy `38033720488` (vẫn kiểm tra lại ở Bước 0). Có thể có thêm một commit "docs" sau nó chỉ sửa tài liệu, không đổi mã; mã cài vẫn là commit trên.
**Bản đang chạy (và là bản quay lại):** `a907618993a49e2c563d28fd75b25ddb5f177d62` (giao diện khách hướng C + màn hình quầy nhóm 2; Owner báo triển khai 2026-10-10).
**Chỉ đổi giao diện web** (`apps/web` và `packages/ui`). Không có migration, không đổi quyền, không đổi API, không đổi worker, không có thư viện mới, không đổi nginx, không đổi `.env`. API và worker **không dừng và không khởi động lại**: khách và nhân viên đang dùng vẫn dùng được; chỉ web được nạp lại (3 tiến trình nạp lần lượt). **Không có phông chữ mới**: Fraunces và Nunito Sans đã được tải về lúc build lần trước (trang khách), lần này chỉ gắn thêm cho khu nhân viên, nên không cần internet thêm.
**Thời gian:** khoảng 20 phút (phần lớn là build).
**"Bán online" vẫn TẮT** sau khi cài (bản này không đụng tới cài đặt đó).

Điều sẽ **khác đi** (để kiểm tra bằng mắt ở Bước 6): **mọi màn hình nhân viên** (quản trị, quầy, đăng nhập nhân viên) đổi sang hướng C, gọn cho màn hình làm việc: nền hồng kem; thẻ, bảng và hộp thoại bo tròn lớn với bóng hồng mềm; nút và ô nhập hình viên thuốc, nút phụ nền hồng nhạt; tiêu đề trang, thẻ và hộp thoại bằng chữ Fraunces, nội dung Nunito Sans; thanh trên và thanh bên không còn đường kẻ cứng (bóng mềm), mục điều hướng hình viên thuốc, mục đang mở vẫn đỏ đặc; logo "LUCY SPA" ở thanh trên và trang đăng nhập nhân viên là chữ serif như trang khách; biểu mẫu "thêm mới" căn trái cùng mép với tiêu đề; bảng Dịch vụ, Nhân sự, Ưu đãi, Kho hàng, Hóa đơn không còn bị cắt cột cuối ở màn hình 1280 và 1440 px (một số cột ít quan trọng chỉ hiện từ 1440 px). Rê chuột vẫn là đỏ đặc chữ trắng (chế độ tối: hồng). **Trang khách không đổi.**

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `8b7c3413a0827f21e8973e45be56c94b10e5d9c2` (lần chạy `38033720488`) có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Nếu có khách hay nhân viên đang dùng, **không cần báo**: họ chỉ có thể phải nạp lại trang một lần. Nên làm ngoài giờ cao điểm.

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `a907618`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB.

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-giao-dien-nhan-vien-c-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu (làm TRƯỚC mọi việc khác)

2.1. Sao lưu cơ sở dữ liệu (lần này không đổi cơ sở dữ liệu; vẫn sao lưu để có điểm quay lại):

```
export BACKUP=/root/backups/lucyspa-pre-giao-dien-nhan-vien-c-$(date -u +%Y%m%dT%H%M%SZ).dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP"
chmod 600 "$BACKUP"
echo "$BACKUP"
ls -l "$BACKUP"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; pg_restore --list /tmp/check.dump | head -n 6; rm /tmp/check.dump'
```

**Mong đợi:** dung lượng lớn hơn 100 KB; `wc -l` lớn hơn 1000; có dòng `Format: CUSTOM`. **Sai: DỪNG.**

2.2. Sao lưu bản web đang chạy (để quay lại trong 1 phút, không cần build lại):

```
export WEBBACKUP=/root/backups/web-pre-giao-dien-nhan-vien-c-$(date -u +%Y%m%dT%H%M%SZ).tgz
tar czf "$WEBBACKUP" -C /opt/lucyspa apps/web/.next packages/ui/dist
ls -l "$WEBBACKUP"
tar tzf "$WEBBACKUP" | head -n 3
```

**Mong đợi:** tệp vài chục đến vài trăm MB; ba dòng đầu bắt đầu bằng `apps/web/.next/` hoặc `packages/ui/dist/`. Ghi lại hai đường dẫn tệp sao lưu.

## Bước 3. Lấy bản mới, cài, build (chưa khởi động lại gì)

3.1. Lấy đúng bản mới:

```
cd /opt/lucyspa
git fetch origin
git checkout 8b7c3413a0827f21e8973e45be56c94b10e5d9c2
git rev-parse HEAD
```

**Mong đợi:** in đúng mã 40 ký tự (`detached HEAD` là bình thường). Mã khác: **DỪNG**.

3.2. Cài thư viện (không có thư viện mới) và tạo lại Prisma client:

```
pnpm install --frozen-lockfile
pnpm db:generate
```

**Mong đợi:** không có `ERR`; có dòng `Generated Prisma Client`. Lỗi: **DỪNG** (máy chủ đang chạy bản cũ, chưa bị đụng tới).

3.3. Build (vài phút), **không** đặt biến `API_UPSTREAM_ORIGIN`:

```
pnpm build
```

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG**. Trong lúc build, vài trang có thể báo lỗi tạm thời vì `.next` đang được ghi lại; web chưa nạp lại nên người dùng vẫn thấy bản cũ cho tới Bước 4.

## Bước 4. Nạp lại web

```
pm2 reload lucyspa-web --update-env
sleep 25
pm2 status
pm2 logs lucyspa-web --err --lines 30 --nostream
```

**Mong đợi:** `lucyspa-web` **3 dòng** `online`; `lucyspa-api` và `lucyspa-worker` vẫn 1 dòng `online` và thời gian chạy của chúng **không** vừa mới đặt lại; không có dòng lỗi mới sau lúc nạp lại (tối đa vài dòng cũ).

## Bước 5. Kiểm tra bằng lệnh (không tạo hay sửa dữ liệu)

```
curl -s http://127.0.0.1:3001/health/ready; echo
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "dang nhap khach: %{http_code}\n" http://127.0.0.1:3000/vi/account/login
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "quen mat khau nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/forgot-password
curl -s -o /dev/null -w "trang khong co (phai la 404): %{http_code}\n" http://127.0.0.1:3000/vi/khong-co-trang-nay
curl -s http://127.0.0.1:3000/vi | grep -c "ls-hero-title"
for f in $(curl -s http://127.0.0.1:3000/vi/workforce/login | grep -o '/_next/static/[^"]*\.css' | sort -u); do curl -s http://127.0.0.1:3000$f | grep -c "ls-font-staff-title"; done
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
```

**Mong đợi:** `/health/ready` có `"status":"ok"`; các dòng vi, dịch vụ, đăng nhập khách, đăng nhập nhân viên, quên mật khẩu nhân viên đều **`200`**; dòng 404 in **`404`**; `grep -c "ls-hero-title"` in số **lớn hơn 0** (trang khách vẫn đúng); vòng lặp `ls-font-staff-title` in **ít nhất một số lớn hơn 0** (CSS nhân viên mới đã nằm trong bản chạy); `"enabled":false`; web **3**, api **1**, worker **1**. (Trang `/vi/workforce/...` cần đăng nhập, nên kiểm bằng mắt ở Bước 6.)

## Bước 6. Kiểm tra bằng mắt (Owner; chỉ để xem, **không** bấm lập hóa đơn, thu tiền hay hoàn tiền thật)

Thử cả giao diện sáng và tối, trên máy tính và trên điện thoại:

1. **Đăng nhập nhân viên** (`/vi/workforce/login`): thẻ trắng bo tròn trên nền đỏ, logo "LUCY SPA" chữ serif cân giữa, ô nhập hình viên thuốc; trên điện thoại logo không tràn thẻ.
2. **Tổng quan** (sau khi đăng nhập Owner): nền hồng kem, thẻ bo tròn có bóng mềm, tiêu đề thẻ chữ Fraunces, thanh trên không còn đường kẻ cứng; thanh bên có mục hình viên thuốc, mục đang mở đỏ đặc chữ trắng; rê chuột vào mục: đỏ đặc.
3. **Hóa đơn** (`/vi/workforce/pos`): mở một hóa đơn: khối Thanh toán ở trên, bảng trong thẻ không có bóng riêng; bấm **Thu tiền mặt** và **Tạo mã QR PayOS** chỉ để xem hộp thoại bo tròn rồi **Hủy**; rê chuột vào dòng bảng: nền đỏ đặc.
4. **Dịch vụ**, **Nhân sự**, **Ưu đãi**, **Kho hàng**: ở màn hình 1440 px không còn cột cuối bị cắt (cột Trạng thái và nút ⋮ thấy đủ); **Thêm dịch vụ** mở ngăn kéo bo một cạnh.
5. **Thêm nhân sự** (`/vi/workforce/employees/new`) và một trang tạo mới khác: cột biểu mẫu căn trái cùng mép với nút Quay lại và tiêu đề.
6. **Vai trò và quyền**, **Website**, **Chấm công**, **Nghỉ phép**, **Chi nhánh**, **Cơ cấu tổ chức**, **Thông báo**, **Tài khoản của tôi**: cùng một kiểu thẻ, nút, ô nhập; không có chữ hay nút bị cắt.
7. **Điện thoại** (hoặc thu hẹp cửa sổ xuống 360 px): thanh trên gồm nút menu, logo, chuông, tài khoản trên một dòng; cỡ chữ lớn (130%) không bị cuộn ngang.
8. **Trang khách** (`/vi`, `/vi/services`): **giữ nguyên** như hôm qua.

## Bước 7. Quay lại nếu có sự cố

Không có migration và không đổi dữ liệu, nên quay lại **chỉ là đưa phần mềm web về bản cũ**; không đụng cơ sở dữ liệu.

**Cách A (nhanh, khoảng 1 phút):**

```
cd /opt/lucyspa
git checkout "$OLD_COMMIT"
pm2 stop lucyspa-web
rm -rf apps/web/.next packages/ui/dist
tar xzf "$WEBBACKUP" -C /opt/lucyspa
pm2 start lucyspa-web --update-env
sleep 25
pm2 status
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
```

**Mong đợi:** `lucyspa-web` 3 dòng `online`; `vi: 200`; khu nhân viên trở lại giao diện cũ. (Nếu `$OLD_COMMIT` hoặc `$WEBBACKUP` không còn trong cửa sổ terminal vì đã đóng: dùng mã `a907618993a49e2c563d28fd75b25ddb5f177d62` và đường dẫn tệp `.tgz` ghi ở Bước 2.2.)

**Cách B (build lại từ bản cũ, vài phút, dùng khi Cách A lỗi):**

```
cd /opt/lucyspa
git checkout a907618993a49e2c563d28fd75b25ddb5f177d62
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 reload lucyspa-web --update-env
sleep 25
pm2 status
```

Cơ sở dữ liệu không bị đổi ở lần triển khai này nên **không bao giờ cần** khôi phục tệp `.dump` cho lần này; tệp chỉ là điểm an toàn.

## Bước 8. Báo lại cho Claude

Gửi: mã commit đang chạy (`git rev-parse HEAD`), hai đường dẫn tệp sao lưu (Bước 2), `pm2 status`, kết quả Bước 5 (các số `200`, `404`, các số `grep` và dòng `"enabled":false`) và nhận xét ở Bước 6. Claude ghi lại vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Mã đổi ở `packages/ui` (`tokens.css`, `staff.css` mới chỉ có hiệu lực trong `.ls-shell` và `.ls-auth`, `components.css` thêm mức ẩn cột `wide`, `data-table.tsx`, `index.tsx`: logo serif) và `apps/web` (gắn hai phông lên `<html>`, logo ở thanh trên và đăng nhập, vài cột bảng). Không đổi `apps/api`, `apps/worker`, `packages/database`, `packages/contracts`, `packages/server`.
- Trang khách nằm trong `.ls-site` và ghi đè lại mọi token đã đổi, nên không đổi; đã so ảnh chụp trước và sau.
- Kiểm tra đã chạy trên CSDL scratch `lucy_spa_polish1_scratch` (không phải CSDL thật): xem `docs/UI_STAFF_C.md`.
