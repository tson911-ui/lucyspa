# P6-17: Làm việc với đơn đặt trước (báo cáo)

Làm theo yêu cầu của Chủ (2026-10-08, mục 2.29), mốc 3b. Chưa đẩy lên, chưa triển khai, chưa gán quyền. Các cách hiểu P17-1 đến P17-10 ở mục 2.32, **chờ Chủ xem lại**.

## Đã làm

- **Trang "Hàng đặt trước"** (`/workforce/product-orders`): năm nhóm Cần đặt / Đã đặt / Hàng đã về / Đã giao / Đã hủy, tìm theo mã đơn, hóa đơn, điện thoại, tên, SKU, 20 dòng một trang. "Cần đặt" gom theo **nhà cung cấp quen thuộc** của biến thể (ô mới trong ngăn sửa biến thể).
- **Trang một đơn:** thông tin liên hệ, từng dòng với trạng thái, nhãn "Trễ hẹn" / "Chờ nhận lâu", khoản hoàn và mã chuyển khoản; thao tác nằm trong menu của dòng: Đã đặt hàng, Giao hàng, Hủy và hoàn tiền, Sửa mã giao dịch.
- **Hàng về:** xác nhận phiếu nhập tự giữ hàng cho đơn trả tiền sớm nhất (cả dòng); hủy dòng đã giữ hàng thì hàng chuyển ngay cho đơn kế; nút "Cấp hàng" cho trường hợp khác. Khách có tài khoản nhận thông báo trong app.
- **Giao hàng** có đối chiếu mã đơn và 4 số cuối điện thoại (không lưu); **hủy và hoàn tiền** đúng toàn bộ tiền của dòng, hỏi lại mật khẩu, Chủ nhận thông báo, điểm Beauty trừ lại; sửa mã chuyển khoản bằng bản ghi mới.
- **Mỗi sáng 08:00** (worker): thông báo cho người xử lý đơn nếu có dòng trễ hẹn hoặc hàng về quá 7 ngày chưa ai nhận. Không tự đổi hay hủy gì.
- **Trả hàng** cho dòng đặt trước chỉ khi đã giao và đã bán; hạn tính từ ngày giao.
- Sửa hai điểm của P6-16: giờ thanh toán trên phiếu theo múi giờ chi nhánh; web chuyển địa chỉ khách để giới hạn tần suất tính theo từng khách.

## Migration

`20261118000000` (92 thành 93): hoàn tiền gắn được vào dòng đơn, bảng `product_order_scans`, `usual_supplier_id`, nới ràng buộc thông báo (thêm 2 loại, 1 đối tượng). Chỉ thêm. Quyền: không thêm quyền mới.

## Kiểm thử

- Mới: 13 bài tích hợp API (hàng đợi, nhóm theo nhà cung cấp, đã đặt, hàng về, cấp hàng, giao hàng, hủy và hoàn tiền, trễ hẹn, chuyển khoản và sửa mã, trả hàng), 6 bài **đua trên PostgreSQL thật** (đã đặt với hoàn tác thanh toán, phiếu nhập với bán lẻ, hủy với hàng mới về, hủy hai lần, hai lần cấp hàng, quét hằng ngày), 1 bài nhà cung cấp quen thuộc, HTTP mở rộng, 7 bài tĩnh migration, 12 + 7 bài web.
- Cũ không bị nới (chỉ thêm trường vào dữ liệu mẫu và một mục vào danh sách điều hướng của Chủ). Chạy lại trên cơ sở dữ liệu 93 migration: 29 bộ tích hợp (đơn hàng, danh mục sản phẩm, POS, kho, trả hàng, hoàn tiền, đổi hàng, thông báo, hóa đơn, thanh toán) đều đạt; web 744 bài đạt; lint, kiểm tra ranh giới, định dạng sạch.

## UX gate (đã mở từng ảnh)

Ảnh `.local/uxui-screens/p617-*` (360/768/1440 sáng + 1440 tối): 5 nhóm của hàng đợi, tìm không thấy, đơn (chưa đặt, trễ hẹn, hàng về quá lâu, đã giao, hủy chuyển khoản, nhiều dòng), 4 hộp thoại (đã đặt, giao hàng, hủy và hoàn tiền, sửa mã). Đã sửa sau khi xem: cột thừa làm bảng tràn ở 768, hai nhãn dính nhau, bảng nằm trong thẻ, ô tìm bị cắt chữ, cột "Hoàn tiền" rỗng. Tràn ngang 32 px ở 130% chữ có sẵn ở mọi trang (kể cả Trả hàng), không do bước này.

## Câu hỏi mở

Liên kết phiếu có hết hạn không; gửi email báo hàng về không; khách đổi ý sau khi đã đặt hàng thì hoàn đủ hay trừ phí; có cho "người dùng hệ thống" cấp hàng ngầm không.
