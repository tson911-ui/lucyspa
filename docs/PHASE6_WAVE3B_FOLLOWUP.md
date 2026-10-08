# Đợt 3b, việc làm tiếp sau khi Chủ trả lời (2026-10-09): hạn liên kết phiếu và hoàn một phần khi khách đổi ý

Theo yêu cầu của Chủ ngày 2026-10-09 (design 2.34, câu hỏi 1 và 3). Chỉ commit trên máy, **chưa đẩy lên, chưa triển khai**. Câu hỏi 2 (không gửi email "hàng đã về") và 4 (không có người dùng hệ thống cấp hàng ngầm) không cần mã.

## Đã làm

- **Hết hạn liên kết phiếu (câu hỏi 1).** Liên kết của khách vãng lai hết hạn **30 ngày sau lần giao hoặc hủy cuối cùng** của đơn (đúng 30 × 24 giờ). Đơn còn dòng chưa xong thì không hết hạn. Tính ra mỗi lần đọc từ các dòng của đơn, **không lưu gì, không có migration, không có việc chạy ngầm**. Hết hạn thì trang công khai trả cùng "không tìm thấy phiếu" như mã sai (không lộ lý do); thẻ nhân viên hiện "dùng được đến …" hoặc "đã hết hạn ngày …", ẩn nút tạo liên kết; tạo liên kết mới cho đơn đã hết hạn bị từ chối (`ORDER_TICKET_EXPIRED`). Phiếu của khách có tài khoản (trong hóa đơn) không đổi.
- **Khách đổi ý sau khi đã đặt hàng (câu hỏi 3).** Hộp thoại hủy có ô "Số tiền hoàn" chỉ cho lý do "Khách đổi ý": từ 1 ₫ đến toàn bộ phần đã thu (mặc định toàn bộ); mọi lý do khác vẫn hoàn đủ và từ chối số tiền. Có thêm mục "Từ chối hủy" trong menu dòng: **không đổi gì** (không tiền, không kho, không trạng thái), chỉ ghi quyết định và lý do vào nhật ký (`PRODUCT_ORDER_CANCEL_DECLINED`). Vẫn cần quyền `REFUND_PRODUCTS`, mật khẩu nhập lại một lần cho mỗi khoản hoàn, Chủ nhận thông báo đúng số tiền thật. Điểm Beauty thu hồi theo đúng số tiền đã hoàn (đã có bài kiểm: hoàn 120.000 trong 200.000 thu hồi 120 trong 200 điểm).

## Migration (1, cần hướng dẫn triển khai riêng)

`20261120000000_phase6_wave3b_changed_mind_refund` (95 thành 96): chỉ thay thân hàm `lucy_guard_product_refund` (khoản hoàn của dòng bị hủy vì "khách đổi ý" nằm từ 1 ₫ đến phần đã thu; mọi khoản hoàn khác vẫn đúng bằng phần đã thu). Không bảng, cột, dòng dữ liệu hay quyền mới. Kiểm tra cuối giao dịch "dòng đã thu bị hủy phải có khoản hoàn" **giữ nguyên**: không thể hủy mà hoàn 0.

## Kiểm thử

API: 18 bài `order.commands` (mới 5: số tiền hợp lệ/không, hoàn một phần, lặp lại cùng yêu cầu khác số tiền = CONFLICT, hai đầu của khoảng và cơ sở dữ liệu từ chối số tiền sai, từ chối hủy, điểm theo tỷ lệ), `order.integration` (mới 2: hết hạn khi đã giao và khi hủy, ngày 29 còn dùng, ngày 31 hết), 8 bài đơn vị `ticket.expiry`, cộng `order.race`, `refund`, `exchange` chạy lại đạt; cơ sở dữ liệu: 4 bài tĩnh mới, `phase6-wave3b-orders` và `-races` đạt (96 migration, cơ sở dữ liệu thử). Web: 6 bài mới. `format:check`, `lint`, `typecheck` sạch.

## UX gate (đã mở từng ảnh)

Đã mở đủ 36 ảnh (9 màn × 4 cỡ), trang công khai chụp lại sau khi sửa chữ, bản chữ cuối. `fu-cancel-full/part/bad/other`, `fu-decline`, `fu-menu`, `fu-card-live`, `fu-card-dead`, `fu-public-expired` ở 360, 768, 1440 sáng và 1440 tối. Đã xem: ô tiền dùng `MoneyInput` của bộ giao diện (có dấu chấm nghìn và ₫), lỗi hiện dưới ô, dòng thông báo "Hoàn cho khách 150.000 ₫ trong tổng 240.000 ₫ đã thu", hộp thoại cuộn được ở 360, chế độ tối ổn. DOM audit trên 3 trang (đơn, hóa đơn còn hạn, hóa đơn hết hạn): **0 phát hiện**, không bộ đếm nào tăng. Chữ 130%: hộp thoại vừa khung; tràn ngang 32 px ở 360 là lỗi cũ của thanh trên cùng mọi trang quản trị.

## Cách hiểu kỹ thuật chờ Chủ xem (F1..F4, không tự quyết)

- F1: hạn tính từ **thời điểm giao/hủy của dòng cuối**, đến từng mili giây, không theo ngày theo chi nhánh; đơn bị hủy do hóa đơn chưa trả bị hủy cũng đóng liên kết sau 30 ngày.
- F2: phần tiền khách không được hoàn **shop giữ lại** và vẫn là doanh thu; dòng bị hủy, hàng không bán, không giá vốn.
- F3: "từ chối" chỉ là bản ghi nhật ký (xem được ở Nhật ký kiểm tra), không hiện trên trang đơn; hủy với hoàn 0 ₫ **không** được làm (đó là mất tiền đã trả, Chủ chưa nói).
- F4: **chưa thử** quay lại bản cũ `43a1b29` trên cơ sở dữ liệu 96 migration, và chưa diễn tập migration trên bản sao lưu thật; hướng dẫn triển khai và bài thử quay lại phải làm riêng trước khi Chủ cài.
