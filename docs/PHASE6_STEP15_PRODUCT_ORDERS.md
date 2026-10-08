# P6-15: Cơ sở dữ liệu đơn đặt trước và lõi kho (báo cáo)

Làm theo yêu cầu của Chủ (2026-10-08, mục 2.29), mốc 3b. Chưa đẩy lên, chưa triển khai, chưa gán quyền. Mọi lựa chọn kỹ thuật ghi ở mục 2.30 (P15-1 đến P15-10), **chờ Chủ xem lại**.

## Đã làm

- **Chế độ dòng hàng:** cột `fulfilment_mode` (`IN_STOCK` mặc định, `PRE_ORDER`) trên chi tiết dòng sản phẩm; chỉ sản phẩm "cho đặt trước" mới được đặt trước; không sửa về sau.
- **3 bảng:** `product_orders` (đơn, mã `DT000001`, số điện thoại bắt buộc), `product_order_lines` (từng dòng: chờ thanh toán, đã thanh toán, đã đặt, đã về, đã giao, hoàn tất, hủy; ngày dự kiến), `product_order_events` (lịch sử chỉ thêm, do cơ sở dữ liệu tự ghi). Không có cột tiền.
- **Luật ở cơ sở dữ liệu:** máy trạng thái một chiều, kiểm lúc ghi sổ (đơn, dòng, hóa đơn, giữ hàng cùng một câu chuyện), hóa đơn tự kéo dòng đơn theo trạng thái thanh toán, đảo thanh toán bị chặn từ lúc đã đặt hàng (T22 mở rộng), hồ sơ trả hàng của dòng đặt trước chỉ sau khi giao.
- **Giữ hàng theo dòng đơn** (`ORDER_LINE`): hàng về được giữ riêng cho cả dòng; xuất kho khi giao (bộ xử lý nền hiện có, sự kiện `INVOICE_ORDER_HANDED_OVER`); hủy dòng thì nhả hàng.
- **Lõi** `packages/server`: hàng đợi và phân bổ (`lockWaitingOrderLines`, `allocateWaitingLines`), xuất kho lúc giao (`settleHandedOverOrderLines`). Sự kiện thanh toán không còn động tới giữ hàng của dòng đơn.
- **Quyền mới:** `MANAGE_PRODUCT_ORDERS` (65 thành 66), chưa gán cho ai.

## Migration

`20261116000000` (hai giá trị enum) và `20261116000001` (3 bảng, 4 kiểu, 1 dãy số, 1 cột, thay 5 hàm bảo vệ: dòng sản phẩm, kiểm hóa đơn, giữ hàng, hồ sơ trả hàng, T22). Chỉ thêm; không ghi đè dữ liệu cũ. 89 thành 91.

## Kiểm thử

- Mới (PostgreSQL thật): bài tích hợp cơ sở dữ liệu (9 nhóm: chế độ dòng, tạo đơn, thanh toán và ngày dự kiến, hủy, đảo trước khi đặt, đặt-về-giao-xuất kho-hoàn tất, hủy hàng đã về, luật giữ hàng, hồ sơ trả hàng) và 4 bài tranh chấp (hàng cuối giữa bán lẻ và phân bổ, hai phân bổ một đơn vị, đảo thanh toán và hàng về) và kiểm tĩnh migration.
- Bài cũ không bị nới (chỉ đổi số 65 thành 66 ở hai bài và thêm một dòng ở một bài): 14 bộ tích hợp API chạy lại trên cơ sở dữ liệu 91 migration (bán sản phẩm, bán và đua tranh kho, kho, trả hàng, hoàn tiền, đổi hàng, hóa đơn, thanh toán, hóa đơn khách, quyền): đều đạt, không lỗi.
- Typecheck và lint sạch.

## Chưa làm (các bước sau của mốc 3b)

Màn hình và API bán đặt trước (P6-16), danh sách "cần đặt", hàng về, giao hàng, hủy và hoàn tiền (P6-17), quà tặng (P6-18). Kiểm thử API cấp dịch vụ cho lõi kho nằm ở P6-17 (cần các lệnh dịch vụ).

## Câu hỏi mở

P15-4 và P15-5 (đảo thanh toán; xếp hàng nghiêm ngặt hay bỏ qua dòng lớn) đụng tới quyền và công bằng: Chủ chọn.
