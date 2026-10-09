# Hướng dẫn đưa bản chỉnh giao diện màn hình quầy (nhóm 2) lên máy chủ thật (chỉ giao diện web)

> **CHƯA TRIỂN KHAI.** Khi Owner báo đã triển khai, ghi mã commit, ngày giờ và đường dẫn bản sao lưu vào `LUCYSPA_HANDOFF.md`.

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG** và gửi Claude nguyên văn những gì terminal in ra.

**Bản sẽ cài:** commit `{{SHA}}`, đã push lên `main`, **CI xanh** (lần chạy `{{RUN}}`). Các commit tài liệu đẩy sau đó (nếu có) không đổi mã chạy.
**Bản đang chạy:** `9a575894312b04768553b9fad35fc7a3ce4c34d0` (nhóm 1, giao diện trang khách; Owner báo triển khai 2026-10-09).
**Chỉ đổi giao diện web** (`apps/web` và `packages/ui`). Không có migration, không đổi quyền, không đổi API, không đổi worker, không có thư viện mới, không đổi nginx, không đổi `.env`. API và worker **không dừng và không khởi động lại**: khách và nhân viên đang dùng vẫn dùng được; chỉ web được nạp lại (3 tiến trình nạp lần lượt).
**Thời gian:** khoảng 20 phút (phần lớn là build).
**"Bán online" vẫn TẮT** sau khi cài (bản này không đụng tới cài đặt đó).

Nhân viên sẽ thấy khác đi (để kiểm tra bằng mắt ở Bước 6):

- **Rê chuột vào dòng của mọi bảng nhân viên:** nền đỏ đặc, chữ và biểu tượng ⋮ trắng (chế độ tối: nền hồng). Bảng trong tài khoản khách không đổi.
- **Ô ngày của nhân viên gõ ngày/tháng/năm** (ví dụ `09/10/2026`), ở chấm công, nghỉ phép, lịch CTV, nhân sự, phiếu nhập kho, hóa đơn, đơn online, đổi kỹ thuật viên, mùa trang trí.
- **Hóa đơn (quầy):** có ô tìm theo mã hoặc tên khách; chi tiết hóa đơn có khối **Thanh toán ở trên cùng**; ô tiền trong hộp thoại thu tiền hiện dấu chấm nghìn (`329.000 ₫`); điện thoại hiện danh sách dòng gọn thay cho thẻ cao.
- **Khách vãng lai, Lịch hẹn hôm nay, Trả hàng, Hàng đặt trước, Đơn online:** các khối trống chỉ còn một dòng chữ nhỏ, ô tìm đủ chữ, không còn cột bị cắt; danh sách trên điện thoại dùng dòng gọn.

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `{{SHA}}` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Nếu có nhân viên đang dùng máy, **không cần báo**: họ chỉ có thể phải nạp lại trang một lần. Nên làm ngoài giờ cao điểm của quầy.

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
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-ui-polish2-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu (làm TRƯỚC mọi việc khác)

2.1. Sao lưu cơ sở dữ liệu (lần này không đổi cơ sở dữ liệu; vẫn sao lưu để có điểm quay lại):

```
export BACKUP=/root/backups/lucyspa-pre-ui-polish2-$(date -u +%Y%m%dT%H%M%SZ).dump
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
export WEBBACKUP=/root/backups/web-pre-ui-polish2-$(date -u +%Y%m%dT%H%M%SZ).tgz
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
git checkout {{SHA}}
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
curl -s -o /dev/null -w "trang khong co (phai la 404): %{http_code}\n" http://127.0.0.1:3000/vi/khong-co-trang-nay
curl -s http://127.0.0.1:3000/vi/khong-co-trang-nay | grep -c "ls-site-footer"
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
```

**Mong đợi:** `/health/ready` có `"status":"ok"`; bốn dòng `200` (vi, dịch vụ, đăng nhập khách, đăng nhập nhân viên); dòng 404 in **`404`**; lệnh `grep -c` in số **lớn hơn 0** (trang 404 có chân trang của khung khách); `"enabled":false`; web **3**, api **1**, worker **1**. (Trang `/vi/workforce/...` cần đăng nhập, nên kiểm bằng mắt ở Bước 6, không kiểm bằng `curl`.)

## Bước 6. Kiểm tra bằng mắt (Owner, chỉ để xem; **không** bấm lập hóa đơn, thu tiền hay hoàn tiền thật)

Đăng nhập tài khoản của Owner trên máy tính, thử cả giao diện sáng và tối; rồi mở trang bằng điện thoại:

1. **Hóa đơn** (`/vi/workforce/pos`): gõ vài chữ của tên một khách vào ô tìm (có hay không dấu đều ra); danh sách thu gọn lại. Rê chuột vào một dòng: dòng đỏ đặc, chữ trắng, nút ⋮ vẫn thấy rõ. Trên điện thoại: mỗi hóa đơn hai hàng.
2. **Mở một hóa đơn** đã thanh toán và một hóa đơn chờ thanh toán: khối **Thanh toán** ở trên cùng. Hóa đơn chờ thanh toán: bấm **Thu tiền mặt** chỉ để xem hộp thoại (số tiền có dấu chấm nghìn), rồi bấm **Hủy**.
3. **Nhân sự** (`/vi/workforce/employees`), **Dịch vụ**, **Vai trò**: rê chuột vào dòng đầu: nền đỏ đặc, chữ trắng; nút ⋮ thấy rõ.
4. **Chấm công** hoặc **Nghỉ phép**: ô ngày gõ `09102026` thành `09/10/2026`.
5. **Lịch hẹn hôm nay**: ngày hiện `09/10/2026`; các khối rỗng là một dòng chữ nhỏ.
6. **Trả hàng**, **Hàng đặt trước**, **Đơn online**: mở nhanh, không còn cột bị cắt ở mép phải; thử một tab trống ("Giao thất bại").
7. **Tài khoản của khách** (`/vi/account/invoices`, đăng nhập bằng tài khoản khách thử): rê chuột vào dòng hóa đơn: nền hồng nhạt như cũ (bảng của khách không đổi).

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

**Mong đợi:** `lucyspa-web` 3 dòng `online`; `vi: 200`; màn hình quầy trở lại giao diện cũ. (Nếu `$OLD_COMMIT` hoặc `$WEBBACKUP` không còn trong cửa sổ terminal vì đã đóng: dùng mã `9a575894312b04768553b9fad35fc7a3ce4c34d0` và đường dẫn tệp `.tgz` ghi ở Bước 2.2.)

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

Gửi: mã commit đang chạy (`git rev-parse HEAD`), hai đường dẫn tệp sao lưu (Bước 2), `pm2 status`, kết quả Bước 5 (các số `200`, `404`, số `grep` và dòng `"enabled":false`) và nhận xét ở Bước 6. Claude ghi lại vào `LUCYSPA_HANDOFF.md`.

## Ghi chú kỹ thuật cho kỹ thuật viên

- Mã đổi chỉ ở `packages/ui` (CSS bảng và dòng gọn, `DateTextInput`, `DataTable phoneRows`) và `apps/web` (màn hình quầy, i18n, kiểm thử). Không có thay đổi ở `apps/api`, `apps/worker`, `packages/database`, `packages/contracts`, `packages/server`.
- Hover của dòng bảng đổi trong khung nhân viên (`.ls-shell .ls-table`); bảng của trang khách giữ nền hồng nhạt (`--ls-row-hover-bg`).
- Ô ngày `DateTextInput` nhận và trả ngày ISO như ô ngày cũ; ô ngày của khách (`DateInput`, trang đặt lịch) không đổi.
- Bản kiểm tra đã chạy trên CSDL scratch `lucy_spa_polish1_scratch` (không phải CSDL thật): xem `docs/UI_POLISH_GROUP2_POS.md` mục 11.
