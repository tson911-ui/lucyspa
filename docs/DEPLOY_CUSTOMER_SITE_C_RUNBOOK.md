# Hướng dẫn đưa giao diện trang khách hướng C ("Ấm áp thư giãn") và màn hình quầy nhóm 2 lên máy chủ thật (chỉ giao diện web)

> **ĐÃ TRIỂN KHAI** (Owner báo 2026-10-10 khoảng 10:29, UTC+7): commit `a907618993a49e2c563d28fd75b25ddb5f177d62`; sao lưu và kết quả kiểm tra đã ghi ở `LUCYSPA_HANDOFF.md` và `docs/CUSTOMER_SITE_C.md`. Giữ tệp này để quay lại (Bước 7) hoặc làm lại.

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG** và gửi Claude nguyên văn những gì terminal in ra.

**Bản sẽ cài:** commit `a907618993a49e2c563d28fd75b25ddb5f177d62`, đã push lên `main`, **CI xanh** (lần chạy `37998033826`; mã chạy giống hệt commit `5cd5163`, chỉ thêm một sửa nhỏ cho thẻ tiêu đề trang chủ, và các commit "ci: chạy lại" ở giữa không đổi mã). Lưu ý: các lần chạy trước đó đỏ vì GitHub không liên lạc được với Docker Hub ở bước `docker compose up` (lỗi hạ tầng, đã kiểm chứng bằng cách chạy lại cả commit xanh cũ `c674072` cũng đỏ), và một lần đỏ ở `pnpm smoke` do thẻ tiêu đề trang chủ, đã sửa trong commit này. Bản này gồm **hai phần** vì nhóm 2 (màn hình quầy, commit `7164c23`) chưa được triển khai: (1) màn hình quầy nhóm 2, (2) giao diện **toàn bộ trang khách theo hướng C** mà Owner đã chọn ngày 2026-10-10.
**Bản đang chạy:** `9a575894312b04768553b9fad35fc7a3ce4c34d0` (nhóm 1; Owner báo triển khai 2026-10-09).
**Chỉ đổi giao diện web** (`apps/web` và `packages/ui`). Không có migration, không đổi quyền, không đổi API, không đổi worker, không có thư viện mới, không đổi nginx, không đổi `.env`. API và worker **không dừng và không khởi động lại**: khách và nhân viên đang dùng vẫn dùng được; chỉ web được nạp lại (3 tiến trình nạp lần lượt). Hai phông chữ mới (Fraunces và Nunito Sans) được **tải về một lần lúc build** (giống cách hai phông hiện tại được lấy) rồi chạy từ chính máy chủ của mình; nếu Bước 3.3 báo lỗi tải phông chữ thì máy chủ cần ra internet: **DỪNG**, bản cũ vẫn đang chạy bình thường.
**Thời gian:** khoảng 20 phút (phần lớn là build).
**"Bán online" vẫn TẮT** sau khi cài (bản này không đụng tới cài đặt đó).

Điều sẽ **khác đi** (để kiểm tra bằng mắt ở Bước 6):

- **Trang khách (mọi trang):** nền hồng kem, chữ tiêu đề Fraunces mềm, nội dung Nunito Sans; thẻ "viên sỏi" bo tròn lớn, nút và ô nhập hình viên thuốc; dải sóng mềm giữa các khối; **chân trang màu đỏ thương hiệu**. Trang chủ: tiêu đề hai dòng, vòng tròn ảnh với vòng mảnh co giãn rất chậm, ba chip (giờ mở cửa, địa chỉ, hotline), "Bảng giá dịch vụ" là bốn viên sỏi, ruy-băng ưu đãi cuối trang (nút ghi **"Xem ưu đãi"** khi "Bán online" tắt). Các trang dịch vụ, đặt lịch, mỹ phẩm, chiến dịch, đăng nhập, đăng ký, tài khoản, giỏ hàng, phiếu hẹn, 404 và lỗi, popup, thanh dưới trên điện thoại đều theo hướng C; lớp trang trí ngày lễ vẫn chạy bên trên.
- **Ưu đãi chuyển chỗ:** dải ưu đãi một dòng trên đầu trang chủ không còn; chiến dịch đang chạy hiện thành **ruy-băng lớn ở cuối trang chủ** (nút "Xem ưu đãi" khi "Bán online" tắt). Ba nút trên nền đỏ (nút Đặt lịch và các nút tròn ở chân trang, nút trên ruy-băng) có kiểu rê chuột riêng vì đỏ đặc sẽ biến mất trên nền đỏ. Cả hai việc đang **chờ Owner xác nhận** (xem `docs/CUSTOMER_SITE_C.md`).
- **Chưa có ảnh thật:** các khung ảnh là khung giữ chỗ có chú thích ("Ảnh của tiệm: ..."). Chọn ảnh thật ở **Quản trị → Website** (xem `docs/CUSTOMER_SITE_C.md`) thì khung tự dùng ảnh đó.
- **Đăng nhập và đăng ký:** khung thương hiệu bên trái là một viên sỏi hồng nhạt, chỉ cao bằng nội dung (không còn vùng trống lớn ở trang đăng ký).
- **Các đường dẫn xem thử `/vi/design-preview/...` không còn** (trả 404).
- **Màn hình quầy (nhóm 2):** rê chuột vào dòng của mọi bảng nhân viên: nền đỏ đặc, chữ và biểu tượng ⋮ trắng (chế độ tối: nền hồng); ô ngày của nhân viên gõ ngày/tháng/năm (`09/10/2026`); Hóa đơn có ô tìm và khối **Thanh toán ở trên cùng**; ô tiền hiện dấu chấm nghìn; danh sách trên điện thoại dùng dòng gọn.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `a907618993a49e2c563d28fd75b25ddb5f177d62` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Nếu có khách hay nhân viên đang dùng, **không cần báo**: họ chỉ có thể phải nạp lại trang một lần. Nên làm ngoài giờ cao điểm.

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `9a57589`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB.

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-giao-dien-c-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu (làm TRƯỚC mọi việc khác)

2.1. Sao lưu cơ sở dữ liệu (lần này không đổi cơ sở dữ liệu; vẫn sao lưu để có điểm quay lại):

```
export BACKUP=/root/backups/lucyspa-pre-giao-dien-c-$(date -u +%Y%m%dT%H%M%SZ).dump
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
export WEBBACKUP=/root/backups/web-pre-giao-dien-c-$(date -u +%Y%m%dT%H%M%SZ).tgz
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
git checkout a907618993a49e2c563d28fd75b25ddb5f177d62
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

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối; trong danh sách trang **không còn** dòng `design-preview`. Lỗi: **DỪNG**. Trong lúc build, vài trang có thể báo lỗi tạm thời vì `.next` đang được ghi lại; web chưa nạp lại nên người dùng vẫn thấy bản cũ cho tới Bước 4.

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
curl -s -o /dev/null -w "en: %{http_code}\n" http://127.0.0.1:3000/en
curl -s -o /dev/null -w "dich vu: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "dang nhap khach: %{http_code}\n" http://127.0.0.1:3000/vi/account/login
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "xem thu cu (phai la 404): %{http_code}\n" http://127.0.0.1:3000/vi/design-preview/c
curl -s -o /dev/null -w "trang khong co (phai la 404): %{http_code}\n" http://127.0.0.1:3000/vi/khong-co-trang-nay
curl -s http://127.0.0.1:3000/vi | grep -c "ls-hero-title"
curl -s http://127.0.0.1:3000/vi/khong-co-trang-nay | grep -c "ls-site-footer"
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
```

**Mong đợi:** `/health/ready` có `"status":"ok"`; các dòng vi, en, dịch vụ, đăng nhập khách, đăng nhập nhân viên đều **`200`**; hai dòng 404 đều in **`404`**; lệnh `grep -c "ls-hero-title"` in số **lớn hơn 0** (trang chủ mới); lệnh `grep -c "ls-site-footer"` in số **lớn hơn 0**; `"enabled":false`; web **3**, api **1**, worker **1**. (Trang `/vi/workforce/...` cần đăng nhập, nên kiểm bằng mắt ở Bước 6.)

## Bước 6. Kiểm tra bằng mắt (Owner; chỉ để xem, **không** bấm lập hóa đơn, thu tiền hay hoàn tiền thật)

Thử cả giao diện sáng và tối, trên máy tính và trên điện thoại:

1. **Trang chủ** (`/vi`): tiêu đề hai dòng (dòng hai nghiêng, màu đỏ); khung ảnh tròn (hoặc ba khung giữ chỗ có chú thích nếu chưa chọn ảnh); ba chip giờ mở cửa, địa chỉ, hotline; bốn viên sỏi bảng giá; rê chuột vào một dòng giá: nền đỏ đặc, chữ trắng; ruy-băng ưu đãi (nếu đang có chiến dịch) có nút **"Xem ưu đãi"**; chân trang đỏ có biểu tượng Zalo và Facebook **chỉ khi** đã nhập liên kết.
2. **Dịch vụ**, một dịch vụ, **Đặt lịch** (chỉ xem bước 1; **không** xác nhận đặt lịch thật), **Mỹ phẩm**, một sản phẩm.
3. **Đăng nhập** và **Đăng ký** (`/vi/account/login`, `/vi/account/register`): khung bên trái là viên sỏi hồng nhạt, chữ đọc rõ, không có ô tối sau chữ; trang đăng ký không có vùng trống lớn.
4. **Trang không có** (ví dụ `/vi/abc`): vòng tròn mềm, tiêu đề ở giữa, hai nút.
5. **Bấm thử một chiến dịch** (nếu đang chạy) và nút chuyển tối/sáng ở thanh trên.
6. Đăng nhập tài khoản khách thử: **Tài khoản**, **Lịch hẹn**, **Hóa đơn**, **Điểm thưởng**: bảng và thẻ theo hướng C; thanh dưới trên điện thoại có góc trên bo tròn.
7. **Nếu đang có lớp trang trí ngày lễ:** vẫn hiện đúng trên trang chủ (đèn lồng, cành hoa, dải chữ chúc).
8. **Màn hình quầy** (đăng nhập Owner): **Hóa đơn** (`/vi/workforce/pos`): ô tìm theo tên khách; mở một hóa đơn: khối **Thanh toán ở trên cùng** (bấm **Thu tiền mặt** chỉ để xem hộp thoại rồi **Hủy**); rê chuột vào dòng bảng nhân viên: nền đỏ đặc; ô ngày ở **Chấm công** gõ `09102026` thành `09/10/2026`. Giao diện nhân viên **không** đổi phông chữ hay màu (vẫn là giao diện cũ).

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

**Mong đợi:** `lucyspa-web` 3 dòng `online`; `vi: 200`; trang khách trở lại giao diện cũ. (Nếu `$OLD_COMMIT` hoặc `$WEBBACKUP` không còn trong cửa sổ terminal vì đã đóng: dùng mã `9a575894312b04768553b9fad35fc7a3ce4c34d0` và đường dẫn tệp `.tgz` ghi ở Bước 2.2.)

**Cách B (build lại từ bản cũ, vài phút, dùng khi Cách A lỗi):**

```
cd /opt/lucyspa
git checkout 9a575894312b04768553b9fad35fc7a3ce4c34d0
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pm2 reload lucyspa-web --update-env
sleep 25
pm2 status
```

Cơ sở dữ liệu không bị đổi ở lần triển khai này nên **không bao giờ cần** khôi phục tệp `.dump` cho lần này; tệp chỉ là điểm an toàn.

## Bước 8. Báo lại cho Claude

Gửi: mã commit đang chạy (`git rev-parse HEAD`), hai đường dẫn tệp sao lưu (Bước 2), `pm2 status`, kết quả Bước 5 (các số `200`, `404`, hai số `grep` và dòng `"enabled":false`) và nhận xét ở Bước 6. Claude ghi lại vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Mã đổi ở `packages/ui` (ba tệp CSS mới `customer-tokens.css`, `customer.css`, `customer-pages.css`, chỉ có hiệu lực trong `.ls-site`; `PublicPage` có thêm tùy chọn `centered`; CSS bảng và dòng gọn, `DateTextInput`, `DataTable phoneRows` của nhóm 2) và `apps/web` (khung trang khách, trang chủ, chữ qua `next/font`, màn hình quầy, i18n, kiểm thử). `apps/api` chỉ đổi một **tệp kiểm thử** (`my-income.integration.test.ts`); không đổi `apps/worker`, `packages/database`, `packages/contracts`, `packages/server`.
- Khu nhân viên và quản trị không nằm trong `.ls-site`, nên giữ nguyên bảng màu, chữ và bo góc; DOM audit của 26 trang nhân viên không tăng chỉ số nào.
- `robots.txt` không còn dòng chặn `design-preview` vì các đường dẫn đó đã gỡ.
- Bản kiểm tra đã chạy trên CSDL scratch `lucy_spa_polish1_scratch` (không phải CSDL thật): xem `docs/CUSTOMER_SITE_C_STEP.md`.
