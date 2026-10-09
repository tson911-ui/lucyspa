# Hướng dẫn đưa bản chỉnh giao diện trang khách lên máy chủ thật (chỉ giao diện)

> **CHƯA TRIỂN KHAI.** Khi Owner báo đã triển khai, ghi mã commit, ngày giờ và đường dẫn bản sao lưu vào `LUCYSPA_HANDOFF.md`.

Dành cho Owner, không cần rành kỹ thuật. Làm **từng khối lệnh, theo thứ tự**, trong **cùng một cửa sổ terminal web của iNET** đã đăng nhập vào máy chủ. Mỗi khối có dòng **Mong đợi**; khác với mong đợi thì **DỪNG** và gửi Claude nguyên văn những gì terminal in ra.

**Bản sẽ cài:** commit `9a575894312b04768553b9fad35fc7a3ce4c34d0`, đã push lên `main`, **CI xanh** (lần chạy `37924671820`). Các commit tài liệu đẩy sau đó không đổi mã chạy.
**Bản đang chạy:** `4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44` (Phase 6 Đợt 4, Owner báo triển khai 2026-10-09).
**Chỉ đổi giao diện web của trang khách.** Không có migration, không đổi quyền, không đổi API, không đổi worker, không có thư viện mới, không đổi nginx, không đổi `.env`. API và worker **không dừng và không khởi động lại**: khách đang dùng vẫn dùng được; chỉ web được nạp lại (3 tiến trình nạp lần lượt).
**Thời gian:** khoảng 20 phút (phần lớn là build).
**"Bán online" vẫn TẮT** sau khi cài. Vì vậy dải ưu đãi ở trang chủ và các nút của chiến dịch ghi **"Xem ưu đãi"** (không ghi "Mua ngay"); chỉ khi Owner bật "Bán online" thì nút dùng lời của chủ chiến dịch.

Những gì khách thấy khác đi (để kiểm tra bằng mắt ở Bước 7): trang chủ có **dải ưu đãi** (khi có chiến dịch đang chạy) và **bảng giá dịch vụ** có chấm dẫn; trang **Dịch vụ** là danh sách dòng có **ô tìm**; trang **đặt lịch** có ô tìm dịch vụ; trang **đăng nhập, đăng ký** có khung thương hiệu bên cạnh (màn hình rộng) và ô **ngày sinh nhập ngày/tháng/năm**; trang **404** và trang lỗi có khung site; **chân trang** gọn hơn, có nút "Đặt lịch"; **Tài khoản** có "Truy cập nhanh"; hóa đơn, lịch hẹn, đơn hàng hai cột; điểm thưởng gọn hơn khi chưa có gì. Nút đặt lịch ở mọi nơi đều ghi **"Đặt lịch"** (trước đây có chỗ ghi "Đặt lịch ngay" hoặc "Đặt lịch mới").

## Bước 0. Điều kiện

- Trên GitHub, tab **Actions**, commit `9a575894312b04768553b9fad35fc7a3ce4c34d0` có dấu **xanh**. Đỏ hoặc đang chạy: **DỪNG**.
- Nếu có nhân viên đang dùng máy, **không cần báo**: màn hình quầy và các trang nhân viên không đổi, chỉ có thể phải nạp lại trang một lần.

## Bước 1. Xem hiện trạng (chỉ đọc)

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
pm2 status
df -h /
```

**Mong đợi:** `git status --short` **không in gì**; mã bắt đầu bằng `4b91af6`; `lucyspa-api` 1 dòng `online`, `lucyspa-worker` 1 dòng `online`, `lucyspa-web` 3 dòng `online`; ổ đĩa còn trống vài GB.

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
pm2 save
mkdir -p /root/backups
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-ui-polish-$(date -u +%Y%m%dT%H%M%SZ).pm2
ls -l /root/backups | tail -n 3
```

## Bước 2. Sao lưu (làm TRƯỚC mọi việc khác)

2.1. Sao lưu cơ sở dữ liệu (lần này không đổi cơ sở dữ liệu; vẫn sao lưu để có điểm quay lại):

```
export BACKUP=/root/backups/lucyspa-pre-ui-polish-$(date -u +%Y%m%dT%H%M%SZ).dump
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
export WEBBACKUP=/root/backups/web-pre-ui-polish-$(date -u +%Y%m%dT%H%M%SZ).tgz
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
git checkout 9a575894312b04768553b9fad35fc7a3ce4c34d0
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

**Mong đợi:** chạy hết, không có `ERR` hay `error` ở cuối. Lỗi: **DỪNG**. Trong lúc build, vài trang có thể báo lỗi tạm thời vì `.next` đang được ghi lại; web chưa nạp lại nên khách vẫn thấy bản cũ cho tới Bước 4.

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
curl -s -o /dev/null -w "my pham: %{http_code}\n" http://127.0.0.1:3000/vi/products
curl -s -o /dev/null -w "dang nhap khach: %{http_code}\n" http://127.0.0.1:3000/vi/account/login
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
curl -s -o /dev/null -w "trang khong co (phai la 404): %{http_code}\n" http://127.0.0.1:3000/vi/khong-co-trang-nay
curl -s http://127.0.0.1:3000/vi/khong-co-trang-nay | grep -c "Không tìm thấy trang này"
curl -s http://127.0.0.1:3000/vi/services | grep -c "ls-svc-row"
curl -s http://127.0.0.1:3001/api/v1/online-sales | grep -o '"enabled":[a-z]*'
pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);for(const n of ['lucyspa-web','lucyspa-api','lucyspa-worker'])console.log(n,l.filter(p=>p.name===n&&p.pm2_env.status==='online').length)})"
```

**Mong đợi:** `/health/ready` có `"status":"ok"`; năm dòng `200` (vi, dịch vụ, mỹ phẩm, đăng nhập khách, đăng nhập nhân viên); dòng 404 in **`404`**; hai lệnh `grep -c` in số **lớn hơn 0** (trang 404 có chữ của khung mới; trang dịch vụ có các dòng mới); `"enabled":false`; web **3**, api **1**, worker **1**.

## Bước 6. Kiểm tra bằng mắt (Owner, chỉ để xem; không bấm đặt hay thanh toán)

Mở bằng điện thoại và máy tính, thử cả giao diện sáng và tối:

1. **Trang chủ** `https://lucyspa.vn/vi`: có **Bảng giá dịch vụ** (tên dịch vụ, chấm dẫn, giá; chạm vào một dòng mở dịch vụ). Nếu có chiến dịch đang chạy: dải ưu đãi ở trên cùng, nút ghi **"Xem ưu đãi"** (vì "Bán online" tắt), chạm vào mở trang chiến dịch.
2. **Dịch vụ**: gõ "goi dau" vào ô tìm: ra "Gội đầu" (không cần gõ dấu). Nút **Đặt lịch** ở mỗi dòng mở trang đặt lịch với dịch vụ đã chọn.
3. **Đặt lịch** (đăng nhập tài khoản của Owner): có ô tìm dịch vụ; chọn một dịch vụ, bấm Tiếp tục tới hết các bước; **dừng ở bước Xác nhận, không bấm Xác nhận đặt lịch**.
4. **Đăng ký** `/vi/account/register`: ô Ngày sinh gõ `15031990` thành `15/03/1990` (không bấm Tạo tài khoản).
5. **Trang không có**: gõ `https://lucyspa.vn/vi/abc`: trang có tiêu đề **"Không tìm thấy trang này"**, nút Về trang chủ, có menu và chân trang.
6. **Tài khoản**: khối "Truy cập nhanh"; mở **Hóa đơn** và **Lịch hẹn** một cái: chi tiết hai cột trên máy tính.
7. **Màn hình quầy (POS)**, **Lịch hẹn nhân viên**: mở nhanh, không đổi gì.
8. Cỡ chữ lớn (điện thoại đặt chữ lớn nhất): menu trên cùng vẫn thấy đủ nút tài khoản.

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

**Mong đợi:** `lucyspa-web` 3 dòng `online`; `vi: 200`; trang chủ trở lại giao diện cũ. (Nếu `$OLD_COMMIT` hoặc `$WEBBACKUP` không còn trong cửa sổ terminal vì đã đóng: dùng mã `4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44` và đường dẫn tệp `.tgz` ghi ở Bước 2.2.)

**Cách B (build lại từ bản cũ, vài phút, dùng khi Cách A lỗi):**

```
cd /opt/lucyspa
git checkout 4b91af65f5666ae8dd4f40fabbf9bfcde7b82c44
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

- Mã đổi chỉ ở `packages/ui` (CSS, `PriceList`, slider, popup), `apps/web` (trang khách, i18n) và `scripts/uxui-screens.mjs` (công cụ kiểm định, không chạy trên máy chủ). Một đọc mới ở trang chủ: `GET /api/v1/online-sales` (đã công khai sẵn) để biết "Bán online" bật hay tắt; lỗi đọc coi như tắt.
- Trang công khai cache khoảng 60 giây: sau khi Owner bật hoặc tắt "Bán online", nút ở dải ưu đãi đổi sau khoảng 1 phút.
- Hai ảnh trượt, popup và chiến dịch vẫn theo lịch riêng của chúng; không có cột mới nào.
