# Phase 6 P6-3: quản lý danh mục sản phẩm (Wave 1)

Trạng thái: **Chủ duyệt P6-3 ngày 2026-10-07 kèm 5 sửa đổi (đã làm, mục "Sửa theo Chủ duyệt")**; commit cục bộ, chưa push, chưa deploy.
Hợp đồng: `PHASE6_PRODUCTS_INVENTORY_DESIGN.md` (mục 3, 16.5; Chủ duyệt P6-2 và yêu cầu P6-3 ghi ở mục 2.6).

## Đã làm gì

- **1 migration nhỏ (tổng 69)**: `20261106000005_phase6_ended_promotion_price_guard` (xem "Sửa theo Chủ duyệt"); P6-3 ban đầu không có migration. Không đụng POS, hóa đơn, thanh toán, giảm giá, điểm (đã chạy nguyên bộ test cũ, không sửa test nào của chúng).
- **API** `apps/api/src/products/`, đường dẫn `/api/v1/product-brands`, `/product-categories`, `/products`: thương hiệu, danh mục (tối đa 2 cấp), sản phẩm, biến thể (SKU, mã vạch, ngưỡng sắp hết hàng), ảnh (từ thư viện ảnh), giá niêm yết (mỗi lần đổi là một phiên bản mới, có lịch sử), khuyến mãi đơn giản theo biến thể (giá, từ ngày, đến ngày, kết thúc sớm), trạng thái Nháp / Đang bán / Ngừng bán. Mọi lệnh quyền được quyết lại trong giao dịch, chỉ phạm vi toàn hệ thống; ghi nhật ký (giá, khuyến mãi, giá vốn: loại FINANCIAL).
- **Giá vốn và lợi nhuận bị cắt ngay tại API**: một bộ trình bày duy nhất cho mọi phản hồi (danh sách, chi tiết, kết quả của mọi lệnh). Người không có `VIEW_PRODUCT_COST` nhận phản hồi **không có** khóa `costPriceVnd` và `marginVnd` (không phải `null`), và cột giá vốn không được đọc từ DB. Gửi giá vốn mà không có quyền: 403, không ghi gì. Sửa biến thể mà không gửi giá vốn: giá vốn cũ giữ nguyên.
- **Giá**: đổi giá, tạo/kết thúc khuyến mãi, giá ban đầu khi tạo biến thể đều cần `MANAGE_PRODUCT_PRICES`; thiếu quyền thì 403 và DB không đổi.
- **6 luật DB đã duyệt** đều được kiểm tra trước trong API (khóa dòng) và trả mã lỗi riêng, tiếng Việt rõ ràng; nếu DB vẫn chặn (đua lệnh) thì được dịch lại đúng mã.
- **Màn hình** (menu Danh mục > Sản phẩm): danh sách có tìm kiếm, lọc, sắp xếp, 20 dòng/trang; tab Thương hiệu, Danh mục; trang "Thêm sản phẩm"; trang chi tiết (thông tin, biến thể, lịch sử giá và khuyến mãi, hình ảnh). VI + EN.
- **Thư viện ảnh**: người có `MANAGE_PRODUCTS` được xem, tải lên và chọn ảnh (theo thiết kế 3.5); sửa mô tả ảnh và xóa vẫn chỉ của `MANAGE_WEBSITE_CONTENT`. Ảnh đang dùng cho sản phẩm hiện trong "dùng ở" và không xóa được.

## Quyền (không thêm mã mới; 65 mã, chưa gán cho ai)

Xem catalog: `MANAGE_PRODUCTS` hoặc `MANAGE_PRODUCT_PRICES`. Sửa catalog/ảnh/trạng thái: `MANAGE_PRODUCTS`. Giá và khuyến mãi: `MANAGE_PRODUCT_PRICES`. Giá vốn, lợi nhuận: `VIEW_PRODUCT_COST`. `VIEW_PRODUCT_COST` đứng một mình không mở màn hình nào.

## Kiểm thử (DB thử `lucy_spa_p6_3_scratch_20261007`, 69 migration)

Chạy lần cuối trên mã cuối cùng: `pnpm format:check`, `lint`, `typecheck` sạch; `pnpm test` cả repo **1.332 đạt, 0 lỗi** (database 9, server 39, worker 16 + 1 bỏ qua, ui 464, api 257, web 547); `pnpm test:integration` (database) **101 + 18 đạt** (gồm mọi bộ POS, hóa đơn, thanh toán, điểm thưởng, đua lệnh, không sửa test nào); `pnpm test:auth:integration` (API) **637 test, 636 đạt, 1 bỏ qua, 0 lỗi**. Sửa đổi sau duyệt: test hạ giá sau khi kết thúc sớm (DB và API), sửa mô tả ảnh bằng `MANAGE_PRODUCTS`, cột ảnh nhỏ của DataTable. Mới: `product-catalog.integration.test.ts` (10 test: quyền theo từng mã, giá vốn/lợi nhuận vắng mặt ở mọi endpoint với 8 loại người dùng, quyền giá, 6 luật DB, trạng thái, phiên bản lạc quan, ảnh, thư viện ảnh, nhật ký), `product-catalog.http.test.ts` (khóa đúng trường, 403 khi thiếu CSRF, khóa tùy chọn giá/giá vốn), `product-catalog.guard.test.ts`; web: 547 test (gồm hiển thị không lộ giá vốn). Guard cô lập Wave 1 vẫn đạt.

## UX gate (5 dòng)

1. Đã chụp và mở xem từng ảnh: danh sách, 2 tab, trang thêm, chi tiết (đang bán và nháp), hộp đổi giá, ngăn khuyến mãi, ngăn biến thể, chọn ảnh, và hộp Vai trò với nhóm "Sản phẩm và kho" (360/768/1440 sáng, 1440 tối; ảnh trong `.local/uxui-screens/`).
2. Kiểm tra DOM (`uxui-page-audit.js`) trên 8 trang × 4 lần chụp: **0 phát hiện**. Lần đầu có 4 lỗi `surface-style-mix`: đã sửa (ô ảnh có cùng đổ bóng với thẻ; câu nhắc "Nháp" chuyển thành mô tả của tiêu đề thay vì khung thông báo).
3. Bộ đếm ratchet không tăng; không thêm `wf-*`, px/rem, màu hex.
4. Cờ "ô 20x20" của hộp chọn (checkbox) giống hệt các màn cũ (Vai trò), không phải lỗi mới.
5. Quy tắc UI/UX của Chủ (2026-10-07) đã ghi vào CLAUDE.md và áp dụng: thêm dữ liệu thử nhiều (31 sản phẩm, sản phẩm tên rất dài với 24 biến thể, sản phẩm không nhãn/danh mục/ảnh), chụp trạng thái trống, lỗi 404, lỗi nhập, chữ 130%. Sửa: lỗi 503 khi tạo/mở sản phẩm không có thương hiệu hoặc danh mục (lỗi thật của tôi, đã có test chặn lại); nhãn tên dài ở đường dẫn; căn lề trên cho thông tin; vùng bấm tối thiểu 44 px; cột bảng biến thể không bị cắt; nút xóa ô tìm kiếm (x) bị lệch xuống ở mọi ô tìm kiếm có chữ (lỗi cũ của bộ giao diện, đã sửa trong packages/ui). **Chưa sửa (Chủ quyết, đã ghi `docs/UI_BACKLOG.md`)**: ở chữ 130% và màn 360 px, thanh trên cùng tràn 32 px ngang trên MỌI trang quản trị; là vỏ chung của Bước 5.
6. **Ảnh nhỏ ở danh sách (sau duyệt)**: đã chụp và mở xem 360/768/1440 sáng, 1440 tối, và chữ 130% (360, 768, 1440); DOM audit 4 lần chụp: 0 phát hiện. Lần đầu ở 768 px bảng tràn ngang với tên rất dài (lỗi do tôi): đã thu cột tên về `md`, chụp lại đạt. Còn lại: ở chữ 130% trên 1440 px, cột Trạng thái nằm ngoài khung và phải cuộn ngang trong bảng (không tràn cả trang); chưa kiểm xem trước khi có ảnh nhỏ có giống vậy không.
7. Thêm 2 tùy chọn cho `scripts/uxui-screens.mjs`: `--cookie` (chụp trang sau đăng nhập) và `--before` (cuộn/mở trạng thái trước khi chụp).

## Sửa theo Chủ duyệt (2026-10-07)

1. **Khuyến mãi kết thúc sớm** (kể cả trước giờ bắt đầu) không còn chặn hạ giá niêm yết. Migration chỉ thay thân hàm `lucy_guard_product_price_version` (`CREATE OR REPLACE`, thêm điều kiện `ended_early_at IS NULL`), không đổi bảng/cột/trigger, không đụng dòng dữ liệu nào. API khớp theo: kiểm tra trước, kiểm tra trùng khung giờ và "kết thúc lần hai".
2. **Quyền xem màn hình**: `MANAGE_PRODUCTS` hoặc `MANAGE_PRODUCT_PRICES` (đã duyệt).
3. **Mô tả ảnh (tiêu đề/alt)**: người có `MANAGE_PRODUCTS` sửa được (`/website/media/:id/alt`); xóa ảnh vẫn chỉ `MANAGE_WEBSITE_CONTENT`. Hộp chọn ảnh của sản phẩm nay lưu được mô tả ngay.
4. **Ảnh nhỏ ở đầu mỗi dòng danh sách sản phẩm** (có ảnh bìa thì hiện, không có thì ô giữ chỗ cùng cỡ). Thêm vào bộ giao diện: `MediaThumb` và cột `leading` của `DataTable` (vuông cỡ ô điều khiển 40/44 px; trên điện thoại nằm góc trên bên trái thẻ). Cột tên thu về `md` để bảng không tràn ở 768 px.
5. **Thanh trên cùng tràn ở chữ 130% + 360 px**: chỉ ghi vào `docs/UI_BACKLOG.md` cho lần rà soát UI đầy đủ, không sửa.

Chủ nói "P6-3 approved" chung; ba cách đọc còn lại bên dưới Chủ không nhắc riêng, tôi coi là nằm trong duyệt chung (Chủ báo nếu muốn khác).

## Chưa rõ / cần Chủ quyết

- **Cách đọc của tôi (Chủ không nhắc riêng)**: tạo mã (code) tự động từ tên tiếng Anh, không đổi sau khi tạo; không có sản phẩm "xóa" (chỉ Ngừng bán); ghi chú lý do đổi giá là tùy chọn.
- Thấy nhưng không sửa (không do thay đổi này): tên tệp ảnh tiếng Việt khi tải lên bị lỗi dấu trong thư viện ảnh; ở thư viện ảnh, hàng ô ảnh đầu tiên dính sát thanh tìm kiếm.
- **Sự cố của tôi, đã xử lý nhưng cần Chủ biết**: một lệnh thiết lập DB thử bị lỗi tên nên chạy nhầm vào DB cục bộ `lucy_spa_dev` (DB trên máy này, không phải máy chủ thật; trước đó không có dữ liệu: 0 dịch vụ, 0 chi nhánh, 0 người dùng). Hậu quả: đã áp dụng các migration còn thiếu (đều là thêm mới, hiện 68), đồng bộ quyền (65) và tạo tài khoản Chủ thử `owner@review.lucyspa.test` trong DB đó. Không xóa hay ghi đè gì. Tôi không tự gỡ (gỡ là thao tác phá hủy). Nếu Chủ muốn dùng `lucy_spa_dev` cho mình thì đặt lại mật khẩu Chủ bằng `owner:reset-password`. Công cụ thử đã sửa để từ chối mọi DB không phải DB thử.

## Thử trên máy

1. Docker (Postgres, Redis) đang chạy.
2. Trong thư mục dự án: `node .local/p6-3/start-review.mjs --db=lucy_spa_p6_3_try_20261007` (DB trống, riêng cho Chủ). DB `lucy_spa_p6_3_review_scratch_20261007` có sẵn 4 sản phẩm mẫu. Lần đầu mở trang hơi chậm.
3. Mở http://localhost:3100/vi/workforce/login; email và mật khẩu của tài khoản Chủ thử được in ra ở cuối lệnh (chỉ tồn tại trong DB thử). Vào Danh mục > Sản phẩm.
4. Nhập: tab Thương hiệu và Danh mục trước, rồi "Thêm sản phẩm", rồi trong trang chi tiết thêm biến thể (SKU, giá), thêm ảnh, "Đăng bán". Dừng bằng Ctrl+C.
