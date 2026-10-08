# P6-16: Bán đặt trước tại quầy và phiếu hẹn nhận hàng (báo cáo)

Làm theo yêu cầu của Chủ (2026-10-08, mục 2.29), mốc 3b. Chưa đẩy lên, chưa triển khai, chưa gán quyền. Các cách hiểu P16-1 đến P16-7 ở mục 2.31, **chờ Chủ xem lại**.

## Đã làm

- **Thêm sản phẩm:** ô "Hình thức" (Hàng có sẵn / Đặt trước) chỉ hiện với sản phẩm cho đặt trước; hết hàng thì tự chọn "Đặt trước" và ghi "Dự kiến có hàng sau 3-5 ngày"; dòng đặt trước có nhãn "Đặt trước" trong bảng.
- **Chốt hóa đơn:** hóa đơn có dòng đặt trước mở hộp thoại hỏi số điện thoại khách (bắt buộc) và tên (không bắt buộc); nút chính của hộp thoại là "Chốt hóa đơn". API ghi đơn và dòng đơn cùng lúc chốt; hóa đơn trả về mã đơn `DT...`.
- **Thẻ "Đơn đặt trước"** trên trang hóa đơn: mã đơn, trạng thái, liên hệ, từng dòng với trạng thái và ngày dự kiến; khách vãng lai có nút tạo / tạo mới / thu hồi liên kết; hộp thoại liên kết hiện liên kết, nút sao chép và mã QR (tạo ngay trong trình duyệt), kèm lời nhắc "chỉ hiện một lần".
- **Khách có tài khoản:** thẻ "Phiếu hẹn nhận hàng" trong chi tiết hóa đơn của mình.
- **Khách vãng lai:** trang công khai `/vi/ticket/<mã>` (chỉ đọc, không lưu bộ nhớ đệm, không lập chỉ mục, không gửi referrer, giới hạn tần suất như các trang công khai khác); mã sai, đã thu hồi hay không có đều ra cùng một trang "Không tìm thấy phiếu"; lỗi đọc ra thông báo "thử lại", không bị coi là mã sai.

## Migration

`20261117000000`: bảng `product_order_tickets` (chỉ lưu SHA-256 của mã, một liên kết đang dùng cho mỗi đơn, lịch sử không xóa). 91 thành 92.

## Kiểm thử

- Mới: 8 bài tích hợp API (chế độ dòng, chốt hóa đơn, kho đủ hàng, thanh toán và ngày dự kiến, hủy hóa đơn chưa trả, liên kết phiếu, hóa đơn của khách), 1 bài HTTP, 5 bài tĩnh migration, 1 bài cơ sở dữ liệu (liên kết phiếu), 18 bài web.
- Cũ không bị nới; chỉ thêm trường. Web 725 bài đạt; các bộ tích hợp POS, kho, trả hàng, hoàn tiền, đổi hàng chạy lại đạt.

## UX gate (đã mở từng ảnh)

Ảnh `.local/uxui-screens/p616-*` (360/768/1440 sáng + 1440 tối): hóa đơn chờ thanh toán, đã trả có liên kết, đã trả nhiều dòng tên dài, nháp, hộp thoại thêm sản phẩm, hộp thoại chốt hóa đơn, hộp thoại liên kết + QR, hóa đơn của khách, trang phiếu công khai, trang không tìm thấy; 130% chữ ở 360 (đã sửa nhãn trạng thái quá dài làm tràn ngang). Còn lại, không do bước này: trang POS cũ cũng tràn ngang 392 > 360 ở 130% chữ. DOM audit: trang mới chỉ có các phát hiện cũ của bảng thẻ ở 360 (hàng cao thấp khác nhau) và lệch kiểu thông báo/thẻ; không trang nền nào tăng.

## Câu hỏi mở

Liên kết phiếu có tự hết hạn không, sau bao lâu (hiện không tự hết hạn).
