# P6-19: Đặt hàng online, phần máy chủ (báo cáo)

Làm theo lời Chủ duyệt ngày 2026-10-09 (mục 2.37): miễn phí giao hàng, thanh toán trước bằng PayOS, chỉ hội viên, nhân viên nhập mã vận đơn và phí vận chuyển. Chưa triển khai. Các cách hiểu kỹ thuật W4-1 đến W4-9 ở mục 2.38 **chờ Chủ xem lại**. Giao diện khách: `PHASE6_STEP19_ONLINE_CHECKOUT_WEB.md`.

## Đã làm

- **Một đơn online là một hóa đơn bán hàng (kênh ONLINE) và một đơn hàng (kênh ONLINE)**, dùng lại toàn bộ máy hóa đơn, PayOS, giữ hàng và hoàn tiền (T41). Người mua là hội viên; không có người bán.
- **Công tắc "Bán online"** (`online_sales_settings`, mặc định TẮT sau khi triển khai; cần chi nhánh giao hàng và cổng PayOS đã cấu hình; quyền `MANAGE_PRODUCTS`). Thời hạn thanh toán 30 phút, tối đa 3 đơn chưa trả, giỏ tối đa 20 dòng, hẹn gửi trong 2 ngày làm việc, giao 2–5 ngày; phí giao hàng có sẵn nhưng TẮT.
- **Giỏ hàng, sổ địa chỉ, tính giá thử** (dựng hóa đơn nháp thật rồi hủy, nên không bao giờ lệch giá thật), **đặt hàng** (khóa dòng hội viên rồi hóa đơn; chính sách giao/đổi trả có phiên bản, khách phải đồng ý bản hiện hành), **thanh toán PayOS** (liên kết hết hạn đúng bằng hạn đơn), **làm mới**, **hủy đơn chưa trả**.
- **Hết hạn tự hủy** (worker quét mỗi 30 giây): người ghi là chính khách, nguyên nhân hệ thống, có kiểm tra lại với PayOS trước khi hủy; tiền về muộn sau khi hủy thành bất thường cho quản lý (câu hỏi W4-5).
- **Hàng giữ ngay khi đặt** cho dòng có sẵn; dòng đặt trước giữ khi hàng về; bán thật (xuất kho) chỉ khi gửi đi.
- Thông báo cho khách và cho người xử lý đơn (ONLINE_ORDER_*).
- Mọi lệnh khách bắt lỗi cơ sở dữ liệu thành `CONFLICT` thay vì lỗi 500.

## Migration

`20261121000000` (hai giá trị enum) và `20261121000001` (cài đặt, giỏ, địa chỉ, chi tiết đơn, các ràng buộc và bảo vệ). Chỉ thêm; một dòng cài đặt (bán online TẮT). Quyền: không thêm.

## Kiểm thử

11 bài tích hợp (`online.checkout.integration.test.ts`: giá, hạn mức, đặt/hủy/hết hạn, PayOS, đối soát), 1 bài HTTP (`online.http.test.ts`), 1 bài ngân sách yêu cầu theo tài khoản; các bộ cũ chạy lại trên cơ sở dữ liệu 101 migration: 0 lỗi (xem báo cáo mốc). Đua trên PostgreSQL thật: `online.race.integration.test.ts` (webhook đôi, thanh toán và hủy quá hạn, hai người mua món cuối, hủy và gửi hàng, giới hạn đơn chưa trả).

## Sửa ngoài phạm vi

- Một bài cũ (`public-products.integration.test.ts`, "không có id nội bộ") được nới đúng một điểm: id của biến thể là chìa khóa giỏ hàng, công khai có chủ đích (OQ-91).
- `EmptyDto` của ba đường khách bị `ValidationPipe` từ chối mọi nội dung; nay dùng `requireEmptyObject` như các bộ điều khiển khác.

## Câu hỏi mở

W4-5: nếu ngân hàng báo thanh toán SAU khi đơn đã bị hủy, hệ thống chỉ báo bất thường cho quản lý và tiền hoàn bằng tay; Chủ muốn tự động hoàn không?
