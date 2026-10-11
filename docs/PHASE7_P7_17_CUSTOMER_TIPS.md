# P7-17: tip do khách chọn (Phase 7, Đợt B)

Quyết định của Owner (2026-10-12, nguyên văn ở `PHASE7_PAYROLL_FUNDS.md` mục 15) thay OQ-P7-10a, form "Ghi tip" của nhân viên và hạn 7 ngày.

## Đã làm

- **Migration 118** (`20261209000000_phase7_tip_pledges`, chỉ thêm): bảng `payment_tip_pledges` (khách chọn gì: yêu cầu PayOS, KTV, số tiền; bất biến; chỉ tạo cùng yêu cầu PayOS mới chưa có link; KTV phải làm dịch vụ trên hóa đơn; bội của 1.000, tối đa 10.000.000) và cột `tips.payment_id` (trống được; một tip cho mỗi thanh toán và KTV).
- **Tiền:** `payments.amount_vnd` vẫn là phần ghi vào hóa đơn (doanh thu, điểm, hoa hồng chỉ đọc cột này). PayOS được yêu cầu **phần hóa đơn + tip**. `applyProviderConfirmation` (webhook, đọc trạng thái, worker dùng chung) chỉ nhận đúng tổng đó: ghi phần hóa đơn, rồi trong cùng giao dịch ghi mỗi KTV một tip và một dòng `TIP_IN` vào quỹ ngân hàng (`packages/server/src/payment-tips.ts`). Tổng khác (ví dụ chỉ chuyển phần hóa đơn) là sai số tiền như mọi trường hợp khác: không ghi gì, không tip. Xác nhận trễ cũng ghi tip (gắn vào dòng thanh toán trễ).
- **API:** `POST .../payments/payos` nhận `tips: [{employeeUserId, amountVnd}]` (kiểm đúng KTV, bội 1.000, quỹ đã bắt đầu; gửi lại cùng khóa phải cùng lựa chọn). Bỏ `POST /pay/tips`, `TIP_WINDOW_DAYS`, `TIP_EXISTS`, `TIP_WINDOW_CLOSED`. `POST /pay/tips/:id/reverse` chỉ cho `APPROVE_PAYROLL` toàn cửa hàng (lý do, nhật ký), đảo trọn vẹn khi chưa vào kỳ lương.
- **Màn hình:** hộp thoại PayOS có bước **Thêm tip** (một KTV: chỉ người đó; nhiều KTV: từng người; Không / 20.000 / 50.000 / 100.000 / Khác) trước khi tạo mã QR; thẻ chờ ghi "Ghi nhận / Tip / Khách chuyển"; thẻ **Tip của khách** chỉ đọc (Chủ mới thấy Hoàn tác).
- Quyền vẫn 73. Phiếu lương, kỳ lương, Thu nhập của tôi không đổi (đọc bảng `tips` như trước).

## Kiểm tra

- API tích hợp (`tips.integration.test.ts`, 12 kiểm thử, nhà cung cấp mô phỏng): bước chưa bắt đầu sổ quỹ, tổng PayOS, webhook, đọc trạng thái, xác nhận trễ, replay không ghi tip thứ hai, thiếu tip = bất thường không tip, nhiều KTV, quyền, lựa chọn sai, replay khác lựa chọn, ràng buộc cơ sở dữ liệu, hoàn tác chỉ Chủ, tip đã vào kỳ lương, doanh thu và hoa hồng không đổi. `pay-runs`, `pay-close` dùng `seedTip` (fixture ghi y hệt bản thanh toán). Web 975 + cô lập migration.
- Chạy cả bộ: xem báo cáo cuối của bước (lint, typecheck, `pnpm test`, tích hợp trên cơ sở dữ liệu mới, CI).

## UX gate (bước Thêm tip và thẻ tip)

- Chụp 360/768/1440 sáng, 1440 tối, chữ 130% ở 360 và 1440: các bước số tiền, tip một KTV (chọn sẵn, "Khác", lỗi), nhiều KTV, thẻ chờ, hóa đơn đã thu có thẻ tip, hộp Hoàn tác tip; đã mở từng ảnh. Sửa sau khi xem: thanh chọn 5 mục bị chồng chữ ở 130% trên điện thoại, đổi sang nhóm radio của bộ UI (tự xuống dòng); câu lỗi lặp hai lần.
- Quét DOM hóa đơn (đã thu và chờ): thẻ tip 0 phát hiện; 3 phát hiện FR8 cũ ở 360 trên bảng dịch vụ và bảng ưu đãi (không đụng tới). Hộp đóng 28px là của bộ UI chung.
- Chưa kiểm: người dùng thật trên máy chạm; ở 1440 nhóm radio xuống dòng 4+1 (chấp nhận được, không chồng).

## Chờ Owner xác nhận (chưa đánh dấu là đã duyệt)

Mức gợi ý 20.000/50.000/100.000; khách chọn trên màn hình quầy (máy không phân biệt ai bấm); đơn online chỉ có sản phẩm nên không có bước tip; PayOS không hoàn tiền trong hệ thống nên "hoàn tiền thì đảo tip" = Chủ hoàn tác tip bằng tay.
