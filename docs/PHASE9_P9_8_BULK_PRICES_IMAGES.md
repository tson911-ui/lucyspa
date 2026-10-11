# Phase 9 P9-8: cập nhật giá hàng loạt và nhập ảnh từ tệp ZIP

Trạng thái: **làm xong, chưa deploy.** Căn cứ: PRD 31.3 (ảnh hàng loạt), 31.4 (cập nhật giá hàng loạt), `docs/PHASE9_PRODUCT_IMPORT.md` mục 14. **Không có migration** (vẫn 107), quyền vẫn **68** (dùng lại `IMPORT_PRODUCT_DATA`, `MANAGE_PRODUCT_PRICES`, `MANAGE_PRODUCTS`).

## Cập nhật giá hàng loạt (hoàn thiện loại `PRICE_UPDATE`)

- **Xuất bảng giá:** `GET /api/v1/product-imports/export-prices?format=xlsx|csv&lang=vi|en` (cần **cả** `IMPORT_PRODUCT_DATA` và `MANAGE_PRODUCT_PRICES`): mọi phân loại đang bán, ba cột `Mã SKU`, `Tên sản phẩm` (chỉ để đọc, nhập lại thì bỏ qua), `Giá bán (₫)` kèm giá hiện tại. Ghi nhật ký kiểm tra. Không có giá vốn, không có giá nhà cung cấp.
- **Nhập lại:** tải tệp lên với loại "Cập nhật giá" (cùng màn "Nhập dữ liệu", cùng cơ chế xem trước rồi xác nhận). Người không có `MANAGE_PRODUCT_PRICES` **không xem trước được** loại này. Bản xem trước hiện **giá hiện tại và giá trong tệp** cho từng dòng, dòng giá không đổi là "Không đổi", dòng lỗi nêu lý do (SKU không có, SKU trùng trong tệp, giá không hợp lệ, **giá bằng hoặc thấp hơn khuyến mãi đang chạy**, phân loại đã ngừng bán). Xem trước **không ghi gì**.
- **Xác nhận:** bằng người có `MANAGE_PRODUCT_PRICES`; máy chủ tính lại dưới khóa và **từ chối nếu bất kỳ dòng nào khác bản xem trước, kể cả giá hiện tại** (giá ai đó vừa đổi không bị ghi đè bằng tệp cũ). Mỗi thay đổi là **một phiên bản giá mới đánh số, chỉ thêm**; giá cũ vẫn được giữ; nhật ký kiểm tra loại tài chính. Dòng lỗi chỉ bị bỏ qua khi người dùng nói rõ.

## Nhập ảnh từ ZIP (PRD 31.3)

- Màn "Nhập dữ liệu" có nút **"Nhập ảnh từ ZIP"**. Hai bước: **xem trước** (đọc ZIP, không lưu gì) rồi **thêm ảnh** (gửi lại đúng tệp; máy chủ đối chiếu mã SHA-256 với bản đã xem trước).
- Tên tệp theo SKU: `WHOO001-1.jpg`, `WHOO001-2.jpg`, hoặc `WHOO001.jpg` cho một ảnh. SKU phải khớp **đúng một** phân loại đang bán. Không đoán: SKU không có, tên tệp khớp hai sản phẩm (ví dụ SKU `A` vị trí 2 và SKU `A-2` cùng có), hai tệp trùng tên, tệp không phải ảnh, ảnh quá 10 MB đều **bị bỏ qua và nêu lý do**.
- Ảnh **chỉ được thêm**, xếp sau các ảnh đã có theo số trong tên tệp; **không thay, không xóa**; ảnh đã có trên sản phẩm hoặc trùng trong ZIP bị bỏ qua. Mỗi ảnh đi qua quy trình thư viện ảnh (kiểm tra byte đầu, giới hạn kích thước, ba bản WebP), chữ thay thế = tên sản phẩm.
- **Ảnh cho sản phẩm đang đăng bán** đổi trang bán hàng ngay, nên chỉ được thêm khi người dùng **tích ô** "Cũng thêm ảnh vào sản phẩm đang đăng bán"; không tích thì các ảnh đó bị bỏ qua.
- An toàn tệp: tên trong ZIP chỉ là chữ (không bao giờ là đường dẫn, nên không có zip-slip); đếm số ảnh và dung lượng **khai báo** trước khi giải nén (tối đa 400 ảnh, 300 MB sau giải nén, 10 MB mỗi ảnh, 100 MB tệp ZIP). Cần `IMPORT_PRODUCT_DATA` và `MANAGE_PRODUCTS`.

## Kiểm thử

Server (đơn vị): 10 bài mới và cũ cho ZIP, tên tệp, mẫu/xuất giá. API tích hợp trên PostgreSQL thật, DB mới: **4/4** bài mới (`import-price-zip`: quyền, xem trước không ghi, đổi giá có phiên bản mới và giữ lịch sử, giá đổi giữa chừng làm bản xem trước hết hạn, giá dưới khuyến mãi, ZIP: tên tệp/không đoán/chỉ thêm/sản phẩm đang bán/giới hạn). Web: kiểm thử cho màn nhập. `lint`, `typecheck`, `format:check`, `pnpm test` cả repo sạch.

## UX gate

Ảnh ở `.local/uxui-screens/p98-*`. **Đã mở và xem:** màn nhập dữ liệu với hai nút trên đầu trang (360), hộp "Tải tệp lên" chọn "Cập nhật giá" kèm tải bảng giá (1440), hộp "Nhập ảnh từ ZIP" (360), trang xem trước giá có cột giá hiện tại và giá trong tệp (1440). Đã sửa sau khi xem: ô giá không phải số ("abc") hiện đúng chữ trong tệp thay vì dấu gạch. Xem thêm ngày 2026-10-11 (giao diện tối thật): bảng nhập dữ liệu 1440 sáng, hộp ZIP 1440 tối, hộp "Tải tệp lên" chọn "Cập nhật giá" ở 360, trang chi tiết lần nhập 1440; DOM audit của "Nhập dữ liệu": 0. **Chưa xem từng ảnh:** 768, tiếng Anh, chữ 130%, **trạng thái đã xem trước của hộp ZIP** (trạng thái trong hộp, không dựng được bằng công cụ chụp, vì cần chọn tệp thật); kiểm tra bằng kiểm thử API.

## Em tự đặt: chủ đã duyệt cả năm điều (2026-10-11)

Chủ đã duyệt ngày 2026-10-11 (nguyên văn): "P9-8 readings (bulk price file, ZIP pictures on live products): approved as written — both require the Owner's preview + confirm." Cả hai đều đã đòi xem trước rồi xác nhận rõ ràng (giá hàng loạt: xem trước, rồi người có quyền đặt giá xác nhận; ảnh ZIP cho sản phẩm đang bán: tích riêng sau khi xem trước).

1. Giá hàng loạt chỉ đổi giá bán (phiên bản giá mới), không đụng giá vốn; lý do ghi trong phiên bản: "Cập nhật giá hàng loạt từ tệp".
2. Xuất bảng giá cần cả quyền nhập dữ liệu và quyền đổi giá.
3. Ảnh ZIP không bao giờ thay hay xóa ảnh; ảnh cho sản phẩm đang đăng bán cần tích ô riêng.
4. Giới hạn ZIP: 100 MB, 400 ảnh, 10 MB mỗi ảnh, 300 MB sau giải nén.
5. Không làm bộ đọc tệp cho **nguồn nhà cung cấp** loại tệp (vẫn chưa bật được; xem báo cáo P9-3).

## Triển khai (khi chủ cho phép)

Không migration; khởi động lại API và web. Quay lại bản cũ không ảnh hưởng dữ liệu (ảnh đã thêm và phiên bản giá đã tạo vẫn nằm đó).
