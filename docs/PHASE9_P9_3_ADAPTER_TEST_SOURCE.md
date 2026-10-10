# Phase 9 P9-3: bộ đọc WooCommerce Store API và "Chạy thử" nguồn

Trạng thái: **làm xong, chưa deploy.** Căn cứ: `docs/PHASE9_PRODUCT_IMPORT.md` (mục 3, 16, lời chủ 2026-10-10 vòng hai). Chạy thử **không lưu sản phẩm, không tải ảnh, không tạo ứng viên**; quét và ảnh là P9-4.

## Đã làm gì

- **Bộ đọc `woocommerce-store-api`** (`packages/server/src/supplier-import/`, hàm thuần, tiêm được kết nối): `listPage` (thứ tự theo mã), `fetchProducts` (theo `include`), `fetchProduct` (một sản phẩm hoặc biến thể, bắt buộc trả đúng mã đã hỏi). Khóa nguồn = mã WooCommerce; chữ chuyển thành văn bản thuần, giá nguyên đồng (sai lệch thì báo, giữ số gốc), ảnh/đường dẫn ngoài website nguồn bị bỏ, kho không bao giờ đọc. Ảnh chỉ lấy từ `images[]` của chính sản phẩm đó (nền cho P9-4).
- **Kết nối an toàn:** chỉ https, đúng tên miền của nguồn, kiểm tra **địa chỉ thật mà ổ cắm nối tới** (chặn riêng tư, loopback, link-local, CGNAT, dành riêng, IPv6 nội bộ/ánh xạ; DNS đổi đáp án cũng không lọt), chuyển hướng kiểm tra lại từng bước (tối đa 3), 1 yêu cầu/giây (tăng theo `Crawl-delay`), timeout 15 s, trần byte tính trên dữ liệu đã giải nén. Không có công tắc tắt lớp bảo vệ; test tiêm giao thức giả. User-Agent `LucySpaCatalogBot/1.0 (+https://lucyspa.vn; hotro@lucyspa.vn)`, không có gì cá nhân. `robots.txt` đọc trước (nhóm của bot, rồi `*`; thiếu tệp = cho phép, lỗi tạm = không cho phép).
- **Chạy thử:** worker đọc robots.txt + **một trang tối đa 20 sản phẩm** (2 yêu cầu). Đạt khi ≥90% dùng được, ≥50% có giá và có ảnh (thiếu SKU không làm hỏng; sẽ là `HARU-<mã>`). Lỗi map sang trạng thái nguồn: 401/403 hoặc trang kiểm tra người dùng → `AUTHENTICATION_REQUIRED`; không có API/sai dạng → `ADAPTER_REQUIRED`; 5xx, mạng, robots không đọc được → `SOURCE_ERROR`.
- **Một người xác nhận mẫu (thiết kế mục 3):** lần chạy đạt chỉ là `PASSED`; nút "Xác nhận mẫu" (`MANAGE_SUPPLIER_SOURCES`) mới đặt nguồn `READY`. Bật nguồn đòi `READY` (gap mới `TEST_REQUIRED`). Cơ sở dữ liệu giữ đúng luật: `READY` chỉ khi có lần chạy đạt đã xác nhận cho địa chỉ hiện tại; bật chỉ khi `READY`; không thử khi giấy phép chưa xác nhận.
- **1 migration** (103 → **104**): `20261126000000_phase9_source_tests` (bảng `supplier_source_tests`, một lần chạy mỗi nguồn, lịch sử không xóa; thay thân hàm bảo vệ nguồn). **Quyền vẫn 68**, không cấp thêm. API: `GET/POST /supplier-sources/:id/tests`, `POST .../tests/:testId/confirm`. Giá nhà cung cấp trong mẫu **bị cắt ở máy chủ** với người không có `MANAGE_PRODUCT_PRICES`; chữ mô tả không lưu, chỉ độ dài.
- **Màn hình:** hàng menu "Chạy thử" mở ngăn (tóm tắt, điều cần lưu ý, mẫu 20 sản phẩm: tên + SKU, ảnh, giá tham khảo, nút mở trang nguồn; Đóng / Chạy lại / Xác nhận mẫu), cột "Chạy thử" trong danh sách; tự làm mới khi đang chạy.

## Kiểm thử

Server 101 (48 mới: bảo vệ địa chỉ, kết nối/robots/trần byte, chuẩn hóa, ánh xạ lỗi, chạy thử), web 912, api 352 + 118 bài tích hợp bỏ qua, database 112, ui 486, worker 24; tích hợp API `supplier-source` **18/18** trên PostgreSQL thật (gồm worker chạy trong giao dịch với nguồn giả: đạt, 5 loại lỗi, giấy phép/địa chỉ đổi → không gửi yêu cầu, mất worker, cắt giá, bảo vệ của cơ sở dữ liệu), tích hợp database phase9 5/5; `lint`, `typecheck`, `format:check` sạch. Rehearsal: bản sao `lucy_spa_dev` 68 → 104 sạch, `prisma migrate diff` không còn khác biệt ở bảng mới; DB thử đã xóa. **Chạy thật 1 lần** qua worker với haruohui.com (2 yêu cầu): đạt, 352 sản phẩm theo website, mẫu 20 (cả 20 có SKU, ảnh, giá; `orderby=id` được chấp nhận; một số SKU là chữ thường/gạch nối → việc của P9-5).

## UX gate (5 dòng)

1. **Đã mở xem:** danh sách 360/768/1440 sáng + 1440 tối; ngăn ở trạng thái đạt (360, 768, 1440 sáng, 1440 tối, 360 chữ 130%), chưa có lần nào, lỗi kết nối thật, bản tiếng Anh 1440. **Chưa chụp:** đang chờ/đang chạy và người chỉ có quyền xem (có bài kiểm thử dựng).
2. **Sửa sau khi xem:** bảng trong ngăn bị cắt cột → dùng bề rộng ngăn của bộ UI, gộp tên + SKU một ô; liên kết 20 px → nút biểu tượng 40/44 px; cột mới làm tràn danh sách ở 1440 → cột địa chỉ chỉ hiện từ 1536 px; nhãn trạng thái đổi cho khớp ("Chưa xác nhận mẫu").
3. **DOM audit:** trang mới 1 phát hiện (như P9-2); 26 trang mốc: không số nào tăng do Step này, riêng `dashboard` 9 → 11 `list-height-uneven` do dữ liệu scratch (worker đang chạy tạo thông báo), trang không bị đụng.
4. Không thêm `wf-*`, px/rem, màu hex; dùng `Drawer`, `DataTable`, `DescriptionList` của bộ UI. Kỹ năng `frontend-design` đã dùng để rà soát: giữ thương hiệu và kiểu C; câu chữ nói rõ bước kế tiếp.

## Em tự đặt, chờ chủ duyệt

1. Chạy thử đòi giấy phép đã ghi **và xác nhận** trước (không gửi yêu cầu nào tới website trước đó).
2. Chạy lại thất bại với nguồn đã bật: trạng thái nguồn đổi sang lỗi nhưng **không tự tắt**; việc quét (P9-4) sẽ đòi `READY`. Chạy lại đạt không tự đặt `READY`, phải xác nhận lại.
3. Ngưỡng đạt (90% / 50% / 50%) và mẫu = 20 sản phẩm đầu theo mã.
4. Nguồn loại tệp chưa chạy thử được, nên chưa bật được cho tới khi có bộ đọc tệp (P9-8).

## Triển khai (khi chủ cho phép)

1 migration (`pnpm db:deploy`), khởi động lại API, web và **worker** (có vòng lặp mới). Quay lại bản cũ: bản API/web/worker cũ vẫn chạy trên cơ sở dữ liệu mới (chỉ thêm bảng và thay thân một hàm bảo vệ).
