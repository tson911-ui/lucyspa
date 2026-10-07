# Hướng dẫn đưa Phase 6 Đợt 1 (sản phẩm, kho, nhập Excel) lên máy chủ thật

**Trạng thái: bản nháp, sẽ hoàn thiện ở bước P6-7 (kiểm tra tải) trước khi Chủ deploy.** Chưa có gì của Phase 6 trên máy chủ thật; chưa push. Mỗi bước hoàn thành sẽ bổ sung vào đây. Cách làm giống `PHASE5_DEPLOY_CHECKLIST.md`: từng bước, một cửa sổ terminal, bước nào ra kết quả khác mong đợi thì DỪNG và chụp màn hình gửi lại.

## Lúc nào chạy (Chủ quyết 2026-10-07)

**Chạy Đợt 1 vào lúc vắng khách, buổi tối.** Lý do kỹ thuật: migration `20261106000008_phase6_notification_kinds` nới 3 ràng buộc của bảng `notifications` đang chạy thật và giữ khóa độc quyền rất ngắn trên bảng đó khi chạy (bảng nhỏ, chỉ nới, không dòng nào đổi). Worker cũng phải khởi động lại.

## Những gì Đợt 1 thay đổi (tính đến P6-5, đã gồm nhập Excel/CSV)

- **Cơ sở dữ liệu, chỉ thêm (10 migration; 63 migration hiện có trên máy chủ + 10 = 73):** `20261106000000` đến `20261106000009` (`…09` của P6-6: 8 cột nội dung trang mỹ phẩm trong `product_settings`, một khóa ngoại tới `media_assets`, không đổi dòng nào) (xem `PHASE6_STEP2_DB_PERMISSIONS_FOUNDATION.md`, `PHASE6_STEP3_CATALOG_ADMIN.md`, `PHASE6_STEP3B_PRE_ORDER_FIELDS.md`, `PHASE6_STEP4_INVENTORY.md`). Nếu P6-5 thêm migration, báo cáo `PHASE6_STEP5_IMPORT.md` sẽ nói rõ và danh sách này được cập nhật.
- **Nhập Excel/CSV (P6-5): không thêm migration** (migration thứ 10 là của P6-6). Quyền `IMPORT_PRODUCT_DATA` đã nằm trong 11 quyền mới. Cần `pnpm install` để lấy 2 thư viện mới của `packages/server` (fflate, fast-xml-parser).
- **Giới hạn tệp nhập: 5 MB**, nhỏ hơn giới hạn tải ảnh 10 MB; nếu có nginx đứng trước web, dòng `client_max_body_size 11m;` đã ghi ở `DEPLOY_STEP13_RUNBOOK.md` là đủ cho cả hai (chưa thử trên máy chủ thật). Nhập 2.000 dòng giữ một giao dịch khoảng 20 đến 23 giây (nginx cần `proxy_read_timeout 150s;` cho đường `/api/`; web đã đặt `proxyTimeout` 150 giây): nên nhập lúc vắng khách (Chủ đã quyết Đợt 1 chạy buổi tối).
- **Quyền mới: 11** (tổng 65), **chưa gán cho ai**. Sau khi deploy, Chủ gán trong màn hình Vai trò, nhóm "Sản phẩm và kho".
- **Không đụng** hóa đơn, thanh toán, điểm thưởng, POS (test cô lập Đợt 1 ghim điều này; ngoại lệ duy nhất là nới 2 loại thông báo ở trên).
- **Worker phải khởi động lại** (vòng cảnh báo kho và quét hạn dùng 08:00 nằm trong worker).
- **Thứ tự lệnh** (khi hoàn thiện): `pnpm db:deploy` rồi `pnpm db:permissions:sync`; kiểm tra số migration và số quyền (65).

## Trang mỹ phẩm công khai (P6-6)

- **Web phải build lại và khởi động lại** (trang mới `/vi/products`, `/en/products`, mục menu "Mỹ phẩm"). API cũng phải khởi động lại (3 đường công khai mới `/api/v1/public/products…`).
- **Không đụng** POS, hóa đơn, thanh toán. Không thêm quyền mới: sửa nội dung trang dùng `MANAGE_PRODUCTS`.
- **Trang trống cho đến khi Chủ nhập:** chưa có sản phẩm "Đang bán" thì trang báo "Chưa có sản phẩm nào để hiển thị"; chưa nhập ảnh/lời đầu trang và khung cam kết thì hai khối ẩn (Sản phẩm → nút "Trang mỹ phẩm").
- **Sau deploy, xem thử:** `/vi/products`, một trang sản phẩm, `/sitemap.xml` (có `/products` và từng sản phẩm đang bán), nhãn "Mới" (đếm từ lần đăng đầu).
- **Quay lại bản cũ:** không cần gỡ migration `…09` (các cột thêm không ảnh hưởng bản cũ); chỉ cần chạy lại bản web và API cũ.

## Việc còn lại để hoàn thiện hướng dẫn

P6-7 (tải, số tiến trình web), kiểm tra sau deploy, cách quay lại bản cũ.
