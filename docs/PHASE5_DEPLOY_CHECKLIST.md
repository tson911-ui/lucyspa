# Hướng dẫn đưa Phase 5 (điểm thưởng, hạng thành viên, giới thiệu, quà sinh nhật, combo, quà tặng) lên máy chủ thật

Dành cho Owner, không cần rành kỹ thuật. Làm **từng bước, theo thứ tự**, trong **cùng một cửa sổ terminal** từ đầu đến cuối. Mỗi bước có: lệnh cần gõ, kết quả mong đợi, và việc phải làm nếu kết quả khác. **Nếu một bước ra kết quả khác mong đợi: DỪNG, không làm bước tiếp theo, chụp màn hình gửi lại.**

**Trạng thái:** Phase 5 đã làm xong và đã kiểm tra trên cơ sở dữ liệu thử, **chưa deploy**. Hướng dẫn này chỉ dùng khi Owner nói "deploy".

## Tóm tắt

- **Bản sẽ cài:** `origin/main` tại thời điểm Owner làm Bước 4 (sau commit ghi chú cuối Phase 5). Claude ghi mã commit và kết quả CI xanh ở tin nhắn báo cáo cuối Phase 5; Bước 0 yêu cầu khớp mã đó.
- **Máy chủ đang chạy:** `58bfabc` (theo `LUCYSPA_HANDOFF.md`), mọi migration đến `20261026000000_uxui_part2_footer_blocks` đã áp.
- **Công tắc điểm thưởng (go-live) MẶC ĐỊNH TẮT và vẫn TẮT sau khi deploy.** Sau khi cài xong, hóa đơn, thanh toán, khách hàng chạy y như hôm nay: không ai được điểm, không giảm giá hội viên, không bán combo, không tặng quà. Chỉ khi chính Owner bấm "Kích hoạt" (có nhập lại mật khẩu) thì Phase 5 mới bắt đầu tính. **Không có bước nào trong hướng dẫn này bật nó.**
- **Thay đổi cơ sở dữ liệu (chỉ thêm, không xóa, không sửa dòng cũ), 16 migration:**
  1. `20261027000000_phase5_permission_codes`
  2. `20261027000001_phase5_permission_semantics`
  3. `20261027000002_phase5_loyalty_foundation`
  4. `20261027000003_phase5_combo_reward_foundation`
  5. `20261028000000_phase5_activate_loyalty_code`
  6. `20261028000001_phase5_activate_loyalty_owner_only`
  7. `20261028000002_phase5_loyalty_consumer_outcomes`
  8. `20261029000000_phase5_member_discount`
  9. `20261030000000_phase5_change_referrer_code`
  10. `20261030000001_phase5_referral`
  11. `20261031000000_phase5_birthday_reward`
  12. `20261031000001_phase5_birthday_base_rule`
  13. `20261101000000_phase5_combo_sale_line_kind`
  14. `20261101000001_phase5_combo_sale`
  15. `20261102000000_phase5_combo_usage`
  16. `20261103000000_phase5_reward_catalog`
- **Quyền mới: 13** (tổng sau khi đồng bộ là **54**). Chưa quyền nào được gán cho ai, kể cả vai trò Quản lý:
  - `VIEW_LOYALTY` (xem điểm, lịch sử điểm, combo, quà của khách), `ADJUST_LOYALTY_POINTS` (điều chỉnh điểm có lý do), `MANAGE_REFERRALS` (gắn người giới thiệu ở quầy), `MANAGE_COMBOS` (định nghĩa combo), `SELL_COMBOS` (bán combo ở quầy), `CONSUME_COMBO_SESSIONS` (ghi buổi dùng combo), `RESTORE_COMBO_SESSIONS` (hoàn lại buổi dùng nhầm), `MANAGE_REWARD_CATALOG` (danh mục quà), `ISSUE_REWARDS` (tặng quà và đánh dấu đã dùng), `VIEW_LOYALTY_EXCEPTIONS` (xem trang Ngoại lệ).
  - Ba quyền **chỉ Owner** mới có, không vai trò nào gán được: `ACTIVATE_LOYALTY` (bật điểm thưởng), `CHANGE_REFERRER` (đổi người giới thiệu trước khi được thưởng), `MANAGE_BIRTHDAY_REWARDS` (cấu hình quà sinh nhật).
- **Biến môi trường mới:** không. Không đổi tệp `.env`. Không đổi cấu hình nginx.
- **Tiến trình `lucyspa-worker` PHẢI được khởi động lại** (bước 4.9): bộ xử lý điểm thưởng nằm trong worker.
- **Thời gian:** khoảng 30 đến 40 phút. Chọn lúc ít khách. Dữ liệu phát sinh giữa lúc sao lưu (Bước 2) và lúc xong **sẽ mất nếu phải quay lại bằng bản sao lưu** (Bước 7, Cách B).

## Bước 0. Điều kiện trước khi bắt đầu

1. Trên GitHub, tab **Actions**, commit sẽ cài (mã Claude đã báo cuối Phase 5) phải có dấu **xanh** (không đỏ, không đang chạy). Nếu đỏ hoặc đang chạy: **DỪNG**.
2. Có một tài khoản khách thử (hoặc email thật của Owner) để kiểm tra trang khách ở Bước 6.
3. Đã đọc xong Bước 8 (nhắc về công tắc điểm thưởng).

## Bước 1. Xem máy chủ đang chạy bản nào

```
cd /opt/lucyspa
git status --short
git rev-parse HEAD
git log -1 --format='%h %cd %s'
pm2 status
df -h /
```

**Mong đợi:** `git status --short` **không in gì**; mã commit bắt đầu bằng `58bfabc`; `pm2 status` có 3 dòng **online**: `lucyspa-api`, `lucyspa-web`, `lucyspa-worker`; ổ đĩa còn trống ít nhất vài GB.

Ghi lại mã commit cũ (để quay lại nếu cần), thay bằng mã thật vừa in:

```
export OLD_COMMIT=<mã 40 ký tự vừa in ra>
echo "$OLD_COMMIT"
```

**Nếu sai: DỪNG** (dòng lạ ở `git status --short`, tiến trình không `online`, hoặc mã commit không phải `58bfabc`; nếu khác, hỏi lại Claude trước khi làm tiếp vì danh sách migration chờ sẽ khác).

## Bước 2. Sao lưu cơ sở dữ liệu TRƯỚC khi làm gì khác (pg_dump)

2.1. Ghi lại vài con số để so sánh sau này:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from users) as users, (select count(*) from bookings) as bookings, (select count(*) from invoices) as invoices, (select count(*) from payments) as payments, (select count(*) from permissions) as permissions"'
```

**Mong đợi:** một dòng dạng `12|345|67|60|41`. **Ghi lại ra giấy** (số cuối là số quyền, hiện 41).

2.2. Tạo bản sao lưu:

```
mkdir -p /root/backups
export BACKUP=/root/backups/lucyspa-pre-phase5-$(date -u +%Y%m%dT%H%M%SZ).dump
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

Không cần sửa `.env`, không cần tạo thư mục mới. Kiểm tra nhanh thư mục ảnh vẫn còn:

```
ls -ld /opt/lucyspa-media
grep -c '^MEDIA_STORAGE_DIR=' /opt/lucyspa/.env
```

**Mong đợi:** thư mục tồn tại; `grep -c` in `1`. **Nếu sai: DỪNG.**

## Bước 4. Lấy bản mới, cài, cập nhật cơ sở dữ liệu, build, khởi động lại

4.1. Lấy bản `origin/main`:

```
cd /opt/lucyspa
git fetch origin
git checkout origin/main
git rev-parse HEAD
git log -1 --format='%h %s'
```

**Mong đợi:** `git rev-parse HEAD` in đúng mã commit Claude đã báo (Bước 0). Máy báo "detached HEAD" là bình thường. **Nếu mã khác: DỪNG.**

4.2. Cài thư viện (bản khóa sẵn):

```
pnpm install --frozen-lockfile
```

**Mong đợi:** kết thúc bằng `Done`, không có `ERR`. **Nếu có `ERR_PNPM`: DỪNG.**

4.3. Tạo lại Prisma client:

```
pnpm db:generate
```

**Mong đợi:** có dòng `Generated Prisma Client`. **Nếu lỗi: DỪNG.**

4.4. Xem **trước khi áp** các migration đang chờ:

```
pnpm db:status
```

(Có thể kết thúc với dấu hiệu lỗi vì có migration chờ: bình thường.)

**Mong đợi: đúng 16 tên** như danh sách ở phần Tóm tắt (từ `20261027000000_phase5_permission_codes` đến `20261103000000_phase5_reward_catalog`), không có tên nào khác. **Nếu danh sách khác: DỪNG** và gửi lại nguyên văn.

4.5. Áp migration (chỉ thêm bảng, cột, ràng buộc; không xóa gì):

```
pnpm db:deploy
pnpm db:status
```

**Mong đợi:** lần 1 áp 16 migration và kết thúc `All migrations have been successfully applied.`; lần 2 báo `Database schema is up to date!`. **Nếu có lỗi: DỪNG, không chạy lại**; xem Bước 7.

4.6. Đồng bộ danh sách quyền (đây là bước **bắt buộc**, nếu không các màn hình mới báo thiếu quyền):

```
pnpm db:permissions:sync
```

**Mong đợi:** dòng `Permission catalog synced: 13 inserted, 41 already present` (Claude đã chạy thử trên cơ sở dữ liệu có đủ 41 quyền cũ). Nếu hai con số này hơi khác thì **chưa phải lỗi**: điều kiện để dừng chỉ là tổng số quyền bên dưới. Kiểm tra số quyền:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from permissions"'
```

**Mong đợi:** `54`. **Nếu khác: DỪNG.**

4.7. Build toàn bộ (vài phút):

```
pnpm build
```

**Mong đợi:** chạy hết, không có chữ `ERR` hay `error` ở cuối. **Nếu lỗi: DỪNG** (bản đang chạy chưa bị đụng tới vì chưa khởi động lại; cơ sở dữ liệu đã có bảng mới nhưng bản cũ bỏ qua).

> Đừng đặt biến `API_UPSTREAM_ORIGIN` trong cửa sổ terminal khi build, hãy build như các lần trước.

4.8. Khởi động lại 3 tiến trình:

```
pm2 restart lucyspa-api lucyspa-web lucyspa-worker --update-env
sleep 15
pm2 status
```

**Mong đợi:** 3 dòng đều `online`. **Nếu có `errored`/`stopped`, hoặc cột `↺` cứ tăng: DỪNG, xem Bước 7.**

4.9. Xem worker khởi động sạch:

```
pm2 logs lucyspa-worker --lines 30 --nostream
```

**Mong đợi:** không có dòng `error` / `fatal`. (Worker không làm gì cho điểm thưởng khi công tắc còn tắt: mọi sự kiện được ghi nhận là "bỏ qua".)

## Bước 5. Kiểm tra bằng lệnh (curl và sức khỏe hệ thống)

Mặc định API ở cổng `3001`, web ở `3000`.

```
curl -s http://127.0.0.1:3001/health/ready; echo
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select count(*) from loyalty_go_live"'
curl -s -o /dev/null -w "diem thuong (API, chua dang nhap): %{http_code}\n" http://127.0.0.1:3001/api/v1/me/loyalty
curl -s -o /dev/null -w "kich hoat (API, chua dang nhap): %{http_code}\n" http://127.0.0.1:3001/api/v1/loyalty/go-live
curl -s -o /dev/null -w "combo da ban (API, chua dang nhap): %{http_code}\n" http://127.0.0.1:3001/api/v1/combos/sold
curl -s -o /dev/null -w "vi: %{http_code}\n" http://127.0.0.1:3000/vi
curl -s -o /dev/null -w "services: %{http_code}\n" http://127.0.0.1:3000/vi/services
curl -s -o /dev/null -w "dang nhap khach: %{http_code}\n" http://127.0.0.1:3000/vi/account/login
curl -s -o /dev/null -w "dang nhap nhan vien: %{http_code}\n" http://127.0.0.1:3000/vi/workforce/login
```

**Mong đợi:**

- `/health/ready` có `"status":"ok"`, `database` và `redis` đều `up`.
- Số đếm `loyalty_go_live` là **`0`** (công tắc điểm thưởng đang TẮT). **Nếu không phải 0: DỪNG ngay và báo.**
- Ba lệnh API chưa đăng nhập đều trả **`401`** (đường dẫn có mặt nhưng cần đăng nhập; nếu `404` nghĩa là bản mới chưa chạy).
- `vi`, `services`, `dang nhap khach`, `dang nhap nhan vien` đều `200`.

Số liệu không đổi (chạy lại lệnh ở 2.1): các số `users`, `bookings`, `invoices`, `payments` giống dòng đã ghi (hoặc nhỉnh hơn vì khách vẫn đặt lịch), số quyền là `54`. **Nếu ít hơn: DỪNG ngay và báo.**

## Bước 6. Kiểm tra trên web (Owner đăng nhập tài khoản Owner)

Công tắc còn TẮT, nên mọi thứ chỉ để **xem**, không tạo dữ liệu thật.

1. **Menu:** Thanh toán > **Điểm thưởng** có mặt. Các tab: Khách hàng, Giới thiệu, Ngoại lệ, Combo, Combo đã bán, Lịch sử dùng combo, Cấp quà tặng, Danh mục quà, Quà sinh nhật, Kích hoạt (một số tab chỉ hiện đúng với quyền của Owner).
2. **Tab Kích hoạt:** nói rõ điểm thưởng **chưa bật**. **Đừng bấm nút bật** (xem Bước 8).
3. **Các tab còn lại** mở được, đều **trống** (không có combo, không có quà, không có cấu hình sinh nhật: Phase 5 không tự tạo gì). Thử tìm một khách trong tab Khách hàng: hiện thông báo điểm thưởng chưa bật, không có số điểm.
4. **Quản trị > Vai trò:** mở một vai trò, có nhóm mới **Khách hàng thân thiết** với 10 quyền gán được (3 quyền chỉ-Owner không hiện). Đừng lưu gì.
5. **Trang khách:** đăng nhập tài khoản khách thử, mở `/vi/account/loyalty` (thẻ "Điểm thưởng" trong khu thành viên): chỉ thấy **một thông báo** là chương trình chưa bật, không có số điểm, combo, quà.
6. **Bán hàng chạy như cũ:** mở **Bán hàng** (POS) và một hóa đơn bất kỳ. Nút **Bán combo** hiện ở đầu trang POS nhưng khi chọn sẽ báo chương trình chưa bật (đúng). Nếu muốn thử một hóa đơn thật: tạo một hóa đơn thử và hủy ngay như các lần trước; hóa đơn **không** có dòng "Giảm giá hội viên", **không** cộng điểm.
7. **Khu quản trị cũ không đổi:** mở nhanh **Lịch hẹn**, **Hóa đơn**, **Ưu đãi**, tab **Slider** và **Popup** của Website.

Nếu một bước ở Bước 6 lỗi mà Bước 5 đều đạt: chụp màn hình và báo; chưa cần quay lại. Nếu **mọi trang** báo "hệ thống không phản hồi": báo ngay.

## Bước 7. Quay lại bản cũ nếu có sự cố

Chọn **một** trong hai cách. Cách nào cũng **không xóa** thư mục `/opt/lucyspa-media`.

### Cách A (nhẹ, nên dùng trước): quay lại phần mềm, giữ nguyên cơ sở dữ liệu

Các migration chỉ **thêm** bảng, cột, ràng buộc; công tắc điểm thưởng đang tắt nên **chưa có dòng dữ liệu Phase 5 nào**. Bản cũ bỏ qua phần mới, **trừ một điểm**: bản cũ **không đọc được** bảng quyền khi còn 13 quyền mới trong đó (báo lỗi "Value 'VIEW_LOYALTY' not found in enum"), nên phải xóa 13 dòng quyền mới trước (bước A2). Việc này an toàn khi chưa ai được gán các quyền đó (chưa có ai, trừ khi Owner đã gán sau deploy): nếu đã có người được gán, lệnh xóa **tự báo lỗi và không xóa gì** (khóa ngoại), khi đó DỪNG và dùng Cách B hoặc hỏi kỹ thuật viên.

Claude đã chạy thử đúng quy trình này trên cơ sở dữ liệu thử: bản `58bfabc` chạy trên cơ sở dữ liệu đã áp đủ 16 migration và đã xóa 13 quyền mới thì **489/489** bài kiểm tra tích hợp đạt; khi **chưa** xóa quyền thì 53 bài lỗi. Sau này deploy lại, bước 4.6 (`pnpm db:permissions:sync`) tự thêm lại 13 quyền.

A1. Dừng 3 tiến trình:

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-web lucyspa-worker
```

A2. Xóa 13 quyền mới (chép nguyên khối, gồm cả dòng `<<'SQL'` và dòng `SQL` cuối):

```
docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
delete from permissions where code::text in ('VIEW_LOYALTY', 'ADJUST_LOYALTY_POINTS', 'MANAGE_REFERRALS', 'MANAGE_COMBOS', 'SELL_COMBOS', 'CONSUME_COMBO_SESSIONS', 'RESTORE_COMBO_SESSIONS', 'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'ISSUE_REWARDS', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY', 'CHANGE_REFERRER');
select count(*) from permissions;
SQL
```

**Mong đợi:** in `DELETE 13` rồi `41`. **Nếu có chữ `violates foreign key` hoặc số khác: DỪNG** (không có gì bị xóa; dùng Cách B hoặc hỏi).

A3. Quay lại bản cũ và khởi động:

```
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-web lucyspa-worker --update-env
sleep 15
pm2 status
curl -s http://127.0.0.1:3001/health/ready; echo
```

(Nếu `OLD_COMMIT` mất, dùng `58bfabc`: `git checkout 58bfabc`.) **Mong đợi:** 3 dòng `online`, `"status":"ok"`. Đăng nhập thử bằng tài khoản Owner để chắc chắn quản trị vẫn dùng được.

### Cách B (đầy đủ): khôi phục cả cơ sở dữ liệu

Chỉ dùng khi thật sự cần (ví dụ migration báo lỗi giữa chừng, hoặc Cách A không chạy). **Cảnh báo:** mọi dữ liệu phát sinh **sau** lúc sao lưu (lịch hẹn, hóa đơn, thanh toán mới) sẽ mất. Nếu đã có thanh toán thật sau khi deploy: **DỪNG và hỏi kỹ thuật viên trước.**

```
cd /opt/lucyspa
pm2 stop lucyspa-api lucyspa-web lucyspa-worker
ls -l "$BACKUP"
docker exec lucy-spa-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/restore.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error /tmp/restore.dump && rm /tmp/restore.dump'
git checkout "$OLD_COMMIT"
pnpm install --frozen-lockfile
pnpm build
pm2 restart lucyspa-api lucyspa-web lucyspa-worker --update-env
sleep 15
pm2 status
```

(Nếu cửa sổ terminal đã đóng và biến `$BACKUP` mất: `ls -l /root/backups/` rồi đặt lại `export BACKUP=/root/backups/<tên tệp lucyspa-pre-phase5-...>.dump`.) **Mong đợi:** `pg_restore` không in lỗi; 3 dòng `online`; chạy lại lệnh ở 2.1 thấy đúng các số đã ghi. **Nếu có lỗi: DỪNG, không chạy lại nhiều lần**; bản sao lưu vẫn còn nguyên.

## Bước 8. Nhắc: công tắc điểm thưởng vẫn TẮT cho đến khi Owner bật

- Sau deploy, **điểm thưởng KHÔNG chạy**. Khách không được điểm, không có giảm giá hội viên, không bán được combo, không tặng được quà, hóa đơn tính như hôm nay.
- **Bật là việc của riêng Owner**, làm một lần, **không tắt lại được**: Điểm thưởng > tab **Kích hoạt**, nhập lại mật khẩu. Hệ thống ghi mốc thời gian bật; hóa đơn thanh toán **trước** mốc đó không bao giờ được cộng điểm hay hồi tố.
- **Nên làm trước khi bật** (cho phép làm khi công tắc còn tắt): tạo định nghĩa combo (tab Combo), danh mục quà (tab Danh mục quà), cấu hình quà sinh nhật (tab Quà sinh nhật, buộc chọn giới hạn dùng); gán quyền cho nhân viên đúng người (ví dụ `ISSUE_REWARDS` chỉ cho Quản lý; `MANAGE_COMBOS`, `SELL_COMBOS`, `CONSUME_COMBO_SESSIONS` cho người cần); báo nhân viên quầy cách bán và dùng combo.
- Chưa có thông báo SMS, Zalo hay email nào cho điểm thưởng: khách chỉ thấy trong trang tài khoản của mình.

## Sau khi xong

- Báo lại Claude: mã commit đang chạy (`git rev-parse HEAD`), kết quả `pm2 status`, kết quả Bước 5 (đặc biệt số `loyalty_go_live` = 0).
- Giữ bản sao lưu `/root/backups/lucyspa-pre-phase5-*.dump` ít nhất 7 ngày.
- Ghi ngày giờ deploy cho Claude để ghi vào `LUCYSPA_HANDOFF.md` (mã commit, 16 migration, ngày).
