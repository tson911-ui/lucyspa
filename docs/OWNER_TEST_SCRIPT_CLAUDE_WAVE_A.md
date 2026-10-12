# Kịch bản Owner thử Claude Wave 0 + A (khoảng 45 phút, làm trên trang thật sau khi triển khai)

Mục đích: dọn lời đánh giá của nhà cung cấp, rồi **viết lại thật 3 sản phẩm**, đọc từng bản, áp dụng. **Chưa chạy các sản phẩm còn lại** cho đến khi bạn xem xong 3 bản đầu và bấm **"Cho phép chạy tiếp"**. Không có gì lên trang web khi bạn chưa bấm **Áp dụng**.

Cần có: khóa Anthropic đã dán (`docs/HUONG_DAN_DAN_KHOA_ANTHROPIC.md`), tài khoản Owner.

## 1. Dọn lời đánh giá của nhà cung cấp (không cần khóa)

1. **Danh mục → Dọn lời đánh giá.** Trang liệt kê các sản phẩm còn lời đánh giá của khách Haruohui trong phần mô tả (lần quét thật cho thấy khoảng 71 trên 353).
2. Bấm vào một sản phẩm: bên phải là chữ **sẽ bị xóa**, bên dưới là bản **sau khi dọn**. Chỉ lời đánh giá bị bỏ; câu hướng dẫn, thành phần, dung tích giữ nguyên. Nếu thấy một dòng bị xóa **nhầm**, bấm **Bỏ qua** cho sản phẩm đó (và báo em tên sản phẩm).
3. Bấm **Dọn N sản phẩm**, xác nhận. **Mong đợi:** thông báo "Đã dọn …"; danh sách còn lại ít hơn (hoặc trống). Mở trang một sản phẩm đã dọn ở trang khách để thấy mô tả không còn đoạn đánh giá. Nhật ký hoạt động giữ **bản cũ đầy đủ** (Quản trị → Nhật ký hoạt động, tìm "Đã bỏ lời đánh giá").
4. Ở lần quét nhà cung cấp kế tiếp sẽ có **một lần** dòng "nội dung đổi" cho các sản phẩm đã dọn: bình thường, không cần làm gì.

## 2. Cài đặt AI

5. **Quản trị → Cài đặt AI** (làm theo bước 9 đến 11 của hướng dẫn dán khóa). **Chưa** bật "Cho phép viết chữ chính hãng" (để tắt: chỉ bật khi bạn xác nhận nhà cung cấp là nhà phân phối chính thức).

## 3. Viết lại 3 sản phẩm đầu tiên

6. **Danh mục → Viết lại nội dung → Chạy viết lại.** Hộp thoại ghi "Ba sản phẩm đầu tiên", số sản phẩm (3), chi phí dự kiến tối đa và hạn mức còn lại. Bấm **Bắt đầu chạy**. Danh sách hiện 3 dòng "Đang chờ" rồi "Chờ duyệt" sau vài phút (mỗi sản phẩm khoảng 1 đến 3 phút). Thấy "Tạm dừng" kèm lý do (thiếu khóa, hết hạn mức, ...): lý do ghi ngay trên thẻ "Lần chạy gần nhất".
7. Mở **từng** bản nháp (bấm tên sản phẩm). Bên trái là chữ **hiện tại**, bên phải là **bản nháp** (sửa được). Hai thẻ ngôn ngữ: Tiếng Việt và English. Kiểm tra:
   - Có đúng **thông tin thật** của sản phẩm (dung tích, thành phần, cách dùng) và **không** thêm điều gì nhà cung cấp không nói; không có lời đánh giá, tên khách, số điện thoại, liên kết;
   - Giọng văn ấm, ngắn, **không** chữa bệnh, **không** "100%", **không** dùng từ ngữ y tế (spa không phải phòng mạch);
   - Tiêu đề tìm kiếm ≤ 60 ký tự, mô tả tìm kiếm ≤ 155 ký tự (có đếm ký tự ngay dưới ô);
   - Khung **"Cần xem trước khi áp dụng"** (nếu có): mục **Cần sửa** phải sửa hết mới áp dụng được; mục **Lưu ý** đọc rồi tích xác nhận.
8. Với **bản đầu tiên**: sửa vài chữ cho hợp ý, bấm **Lưu chỉnh sửa**, rồi **Áp dụng** (xác nhận). Mở trang sản phẩm đó ở trang khách: thấy bốn mục **Công dụng, Thành phần, Cách dùng, Phù hợp với ai**; tiêu đề thẻ trình duyệt là tiêu đề tìm kiếm.
9. Với **bản thứ hai**: thử **Viết lại bản nháp** (menu ⋮ hoặc nút trên đầu), gõ một dòng ví dụ "ngắn hơn, giọng ấm hơn", đợi bản mới. Rồi **Áp dụng** nếu ưng.
10. Với **bản thứ ba**: nếu chưa ưng thì **Từ chối bản nháp** (sản phẩm giữ nguyên). Sau đó có thể chạy lại cho riêng nó.
11. Thử **kiểm tra chặn nhầm** (tùy chọn, 3 phút): sửa một bản, thêm câu "Gọi 0905 123 456 để được tư vấn" rồi lưu. **Mong đợi:** hiện "Cần sửa" và nút **Áp dụng** bị khóa với lý do "Còn chỗ cần sửa". Xóa câu đó đi thì áp dụng được.

## 4. Chạy tiếp (chỉ khi 3 bản đầu làm bạn hài lòng)

12. Khi bạn đã **áp dụng hoặc từ chối đủ 3 bản**, thẻ "Lần chạy" hiện nút **Cho phép chạy tiếp**. Bấm nếu đồng ý để các sản phẩm còn lại được chạy (bấm một lần; hệ thống nhớ ai bấm và lúc nào).
13. **Chạy viết lại** lần nữa: chọn "Các sản phẩm còn lại", nhập **số sản phẩm** (đề nghị 20 cho lần đầu), xem **chi phí dự kiến**, bắt đầu. Có thể **Tạm dừng / Tiếp tục / Hủy lần chạy** bất cứ lúc nào (bản đã viết vẫn còn).
14. Khi đã **áp dụng riêng 3 bản**, trên danh sách có nút **Duyệt cả trang**: mở ra thấy các bản nháp của một trang (tối đa 20) để **đọc**; chỉ các bản **không có lưu ý nào** được duyệt cùng lúc; xác nhận **một lần**. Bản còn lại mở riêng.
15. Xem chi phí: **Cài đặt AI → Chi phí tháng này** (đồng, theo tỷ giá bạn nhập). Chạm hạn mức: lần chạy tự dừng, thẻ ghi "Tạm dừng: hết hạn mức".

## 5. Nhập Excel không ghi đè chữ đã viết (tùy chọn, 5 phút)

16. **Danh mục → Nhập dữ liệu**, tải một tệp sản phẩm có sửa cột mô tả của sản phẩm vừa áp dụng. Bản xem trước ghi **"Chữ do Lucy Spa viết được giữ nguyên"** cho dòng đó (giá và các cột khác vẫn nhập). Bạn chỉ ghi đè được khi tích ô ghi đè **và** nhập lý do; có lưu nhật ký.

## Gửi lại cho em

Ảnh chụp 1 bản nháp đã áp dụng (cả trang quản trị và trang khách), những chỗ AI viết sai hoặc **thiếu**, con số chi phí của 3 bản đầu (Cài đặt AI), và bạn muốn **sửa gì ở lời nhắc (prompt)** trước khi chạy cả loạt. **Chưa** chạy các sản phẩm còn lại khi em chưa nghe ý bạn.
