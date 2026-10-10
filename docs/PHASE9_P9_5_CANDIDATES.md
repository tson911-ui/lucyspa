# Phase 9 P9-5: chuẩn hóa ứng viên, nhớ ánh xạ thương hiệu và nhóm, phát hiện trùng

Trạng thái: **làm xong, chưa deploy.** Căn cứ: `docs/PHASE9_PRODUCT_IMPORT.md` (mục 5, 8, 9) và lời chủ 2026-10-10 (mã SKU, bộ). Chỉ phía máy chủ: không có màn hình, **không có migration** (vẫn 105), quyền vẫn 68. Cuối mỗi lần quét, và khi lưu một ánh xạ, hệ thống tính lại cho ứng viên: mã SKU đề xuất, thương hiệu và nhóm, nghi trùng, cảnh báo, trạng thái.

## Luật (đúng lời chủ)

- **SKU = SKU của nhà cung cấp đúng như hiển thị.** Định dạng Lucy là luật của cơ sở dữ liệu `^[A-Z0-9][A-Z0-9._-]{0,63}$` áp **đúng nguyên văn** (không viết hoa, không cắt, không sửa): SKU không vừa → `SKU_FORMAT`, giữ nguyên, hiện thêm "nếu viết hoa sẽ là …" và có trùng không, **chỉ để xem, không áp** (form sản phẩm thường sẽ tự viết hoa, nên duyệt ở P9-6 không được làm vậy trong im lặng). Mẫu thật: 18/20 SKU hợp lệ (số), 2 SKU dạng slug chữ thường → `SKU_FORMAT`.
- **Không có SKU:** `HARU-<mã WooCommerce>` **chỉ cho haruohui.com** (chủ chỉ cho tiền tố đó cho nguồn này); nguồn khác để `SKU_MISSING` cho tới khi chủ quyết định tiền tố.
- **Trùng SKU** với biến thể của sản phẩm Lucy khác (kể cả SKU sinh ra) → `SKU_COLLISION` kèm sản phẩm trùng **chỉ để gợi ý**, không tự liên kết (lời chủ thắng mục 8 của thiết kế); trùng giữa hai ứng viên → `SKU_DUPLICATE_CANDIDATE` hai chiều (tính hai lượt nên không phụ thuộc thứ tự).
- **Thương hiệu và nhóm chỉ từ ánh xạ đã nhớ** (`saveMapping`: một câu trả lời cho mỗi chữ, tìm không phân biệt hoa thường và dấu; đích phải còn hoạt động). Chưa có ánh xạ → `BRAND_UNMAPPED` / `CATEGORY_UNMAPPED` kèm gợi ý (thương hiệu Lucy trùng tên) và các chữ nguồn; hai đích khác nhau → `*_AMBIGUOUS`. Chữ đã là thương hiệu không được đưa làm nhóm. Không bao giờ tự tạo. Đổi ánh xạ không đổi ứng viên đã có thương hiệu/nhóm (đó là quyết định đã nằm trên ứng viên).
- **Nghi trùng (`POSSIBLE_DUPLICATE`):** cùng tên đã gấp dấu và cùng dung tích ("50 ML" = "50ml") với sản phẩm Lucy hoặc ứng viên khác chưa bị loại; thương hiệu chỉ so khi cả hai đã biết. Ảnh trùng là cờ của P9-4. "Bộ/Set" là sản phẩm riêng, không xử lý đặc biệt.
- **Trạng thái:** `READY_FOR_REVIEW` chỉ khi **không còn cảnh báo nào**; ảnh bị cắm cờ luôn giữ ở `NEEDS_REVIEW`; ứng viên đã duyệt/loại/bỏ qua/đã nhập không bao giờ bị đụng. Cảnh báo của P9-4 chỉ giữ khi còn đúng (`IMAGE_FAILED` nếu địa chỉ chưa có ảnh, `IMAGE_SHARED` nếu ảnh đó còn dùng và còn cờ); `IMAGE_MISSING` nay do P9-5 tính theo ảnh đang dùng. **Chữ của Lucy (tên, mô tả) không bao giờ bị ghi đè**; thương hiệu, nhóm, SKU đã có trên ứng viên cũng không bị thay. Chạy lại không đổi gì thì không ghi (số phiên bản không nhảy).

## Mẫu thật (20 sản phẩm haruohui.com, đánh giá lại không gọi mạng)

20/20 `NEEDS_REVIEW`: tất cả `BRAND_UNMAPPED` + `CATEGORY_UNMAPPED` (nhóm của website trộn thương hiệu "OHUI", dòng sản phẩm và loại: cần ánh xạ từng chữ một lần), 2 có `SKU_FORMAT`. Không SKU trùng, không nghi trùng.

## Kiểm thử

Server 119 (13 mới, thuần: luật SKU, gợi ý, ánh xạ, nghi trùng, ảnh, trạng thái), web 912, api 352, database 112, ui 486, worker 24; tích hợp trên PostgreSQL thật **5/5** (SKU nguyên văn, `HARU-` chỉ cho nguồn được duyệt, trùng SKU hai kiểu, ánh xạ nhớ + chạy lại không ghi, ảnh cắm cờ giữ ở xét duyệt, chữ Lucy và ứng viên đã quyết không bị ghi đè) cùng 13/13 quét và 18/18 nguồn; `lint`, `typecheck`, `format:check` sạch.

## Em tự đặt, chờ chủ duyệt

1. Dịch tên EN **không** giữ ứng viên lại (tên EN bắt đầu bằng tên VI và vẫn đánh dấu "cần dịch"); thiết kế mục 9 liệt kê "thiếu bản dịch" là cảnh báo bắt buộc xem lại, nhưng như vậy không ứng viên nào sẵn sàng để "Duyệt tất cả sản phẩm sẵn sàng".
2. Chữ nguồn không có ánh xạ thì để trống chứ không đoán thương hiệu từ chữ in hoa; gợi ý chỉ khi trùng tên với thương hiệu Lucy.
3. Mã vạch chưa dùng (nguồn không cung cấp); nghi trùng chỉ khi tên (đã gấp dấu) và dung tích giống hệt.

## Triển khai (khi chủ cho phép)

Không migration; khởi động lại API và worker. Quay lại bản cũ không ảnh hưởng dữ liệu (chỉ đổi cách tính cảnh báo).
