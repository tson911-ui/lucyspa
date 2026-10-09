# P6-20 và P6-21: Gửi hàng, giao thất bại, hoàn tiền, đổi trả online, phần máy chủ (báo cáo)

Làm theo lời Chủ duyệt ngày 2026-10-09 (mục 2.36–2.37): nhân viên nhập mã vận đơn và phí hãng; giao thất bại thì ghi nhận từng lần, rồi "hàng đã về cửa hàng", rồi **một** quyết toán: hoàn = max(0, tiền hàng đã trả − phí đi − phí về). Các cách hiểu W4-10 ở mục 2.38 **chờ Chủ xem lại**. Giao diện: `PHASE6_STEP21_ONLINE_FULFILMENT_WEB.md`.

## P6-20: xử lý đơn và gửi hàng

- **Hàng đợi** bảy nhóm (view `online_order_states`): Cần gửi, Chờ hàng, Đã gửi, Giao thất bại, Xong, Đã hủy, Chưa trả. Nhân viên có `MANAGE_PRODUCT_ORDERS` thấy; số tiền phí hãng chỉ người được hoàn tiền thấy.
- **Gửi hàng**: chọn các dòng sẵn sàng, hãng (`shipping_carriers`, có mẫu liên kết theo dõi), mã vận đơn, phí hãng. Lúc này hàng mới xuất kho (SALE, FEFO). Sửa mã hoặc phí chỉ bằng bản ghi sửa có lý do; sửa địa chỉ cũng vậy.
- **Đã giao**: nhân viên bấm (có thể kèm ngày) hoặc khách bấm "Tôi đã nhận hàng"; hạn đổi trả tính từ ngày giao (OQ-40).
- **Nhật ký giao thất bại** (từng lần, có mã lý do và ghi chú), "bắt đầu trả về", "hàng đã về cửa hàng".
- **Quét hằng ngày** (worker): báo đơn chưa gửi quá hẹn và đơn đã gửi lâu chưa giao.

## P6-21: hủy, quyết toán, đổi trả

- **Hủy dòng đã trả tiền, chưa gửi** (cùng lệnh với quầy: `REFUND_PRODUCTS`, hỏi lại mật khẩu, hoàn đủ phần tiền của dòng, trả hàng về kệ, khách và Chủ được báo).
- **Quyết toán giao thất bại**: chỉ sau "hàng đã về"; một bản ghi bất biến; chia tiền hoàn theo tỷ lệ cho các dòng (một hàm chia chung), mỗi phần là một dòng hoàn tiền thường; **một** lần nhập mật khẩu cho cả quyết toán, không hỏi khi hoàn bằng 0; hàng còn bán được thì nhập kho thành lô mới mang mã đơn (chỉ khi có tiền hoàn).
- **Đổi trả hàng đã giao**: dùng phiếu trả/hoàn hiện có; hạn tính từ ngày giao; **không đổi hàng** cho đơn online (xem câu hỏi); phí gửi trả (OQ-100) ghi riêng, chỉ người được hoàn tiền thấy, không trừ vào tiền hoàn.

## Migration

`20261122000000` (hãng, vận đơn, sửa, nhật ký, quét, view, kiểm tra), `20261123000000` (quyết toán, phí trả hàng, hoàn tiền gắn quyết toán, ràng buộc "hoàn 0 thì không nhập kho bán được") và một hàm kiểm tra hóa đơn được cập nhật (dòng hủy trước khi gửi nhả hàng giữ khi hóa đơn còn sống). Chỉ thêm. Quyền: không thêm.

## Kiểm thử

10 bài tích hợp gửi hàng (`online.fulfilment`) và 9 bài hoàn/hủy/quyết toán/đổi trả (`online.refunds`), đều có đối soát cuối bài; bài HTTP; khóa tĩnh các migration (`phase6-wave4-isolation.test.ts`). Bộ cũ liên quan (hoàn, trả, đơn đặt trước, quầy, thanh toán, PayOS, kho): 0 lỗi trên 101 migration.

## Câu hỏi mở

1. Đổi hàng cho đơn online: món thay thế là một lần bán tại quầy; Chủ có muốn làm không? (chưa làm)
2. Hàng giao thất bại mà quyết toán bằng 0 không nhập kho bán được (không có phiếu hoàn để đặt tên lô); nhân viên kiểm kho nhập lại. Chủ đồng ý?
