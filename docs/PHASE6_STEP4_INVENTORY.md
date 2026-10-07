# Phase 6 P6-4: kho hàng (Wave 1)

Trạng thái: **làm xong, commit cục bộ, chưa push, chưa deploy.** Căn cứ: thiết kế mục 4 và 4.8 (cách đọc của tôi), quyết định của Chủ ngày 2026-10-07 (mục 2.8: sự kiện "đã nhập hàng" cho đặt trước sau này).

## Đã làm gì

- **2 migration (tổng 72)**: `…07_phase6_inventory_alerts` (2 dãy số mã phiếu, hàm `lucy_available_stock` là định nghĩa duy nhất của "có thể bán", bảng cảnh báo sắp hết hàng và bảng quét hạn dùng, trigger sổ kho nay tự ghi cảnh báo) và `…08_phase6_notification_kinds` (**chỉ nới** 3 ràng buộc CHECK của bảng `notifications` cho 2 loại thông báo kho; đây là bảng cũ duy nhất Wave 1 chạm tới, test cô lập ghim đúng điều đó). Không đụng POS, hóa đơn, thanh toán, điểm.
- **API**: `/inventory/*` (tồn kho theo chi nhánh, lô, lịch sử), `/suppliers`, `/stock-receipts` (nháp, sửa, xác nhận một lần, hủy có lý do), `/stock-adjustments` (lấy hàng ra khỏi một lô, có lý do, không âm, gửi lại cùng mã thì không ghi hai lần), `/stock-counts` (kiểm kê, duyệt thì chênh lệch thành bút toán chỉnh, không ghi đè). Quyền theo chi nhánh: `VIEW_INVENTORY`, `MANAGE_STOCK_RECEIPTS`, `ADJUST_STOCK`; nhà cung cấp và cài đặt cần `MANAGE_PRODUCTS`. **Giá nhập chỉ có khi có `VIEW_PRODUCT_COST`** (khóa không tồn tại ở người khác, gửi lên là 403).
- **Sự kiện đặt trước**: xác nhận phiếu nhập ghi `STOCK_RECEIPT_CONFIRMED` (chỉ mã và số lượng, không giá) cùng giao dịch; chưa có bên nhận; test worker ghim rằng không relay nào nuốt nó.
- **Worker**: vòng `inventory-jobs.ts`: cảnh báo sắp hết hàng (đọc lại tồn trước khi báo; nhập thêm trước thì bỏ) và quét hạn dùng mỗi ngày theo giờ chi nhánh từ 08:00. Thông báo trong app cho người có `VIEW_INVENTORY` ở chi nhánh đó, không email.
- **Màn hình** (Danh mục > Kho hàng): tab Tồn kho, Phiếu nhập, Kiểm kê, Nhà cung cấp; trang mặt hàng (lô, lịch sử, hộp Điều chỉnh); trang tạo/sửa/xem phiếu; trang kiểm kê; nút Cài đặt (số ngày báo hết hạn). Thông báo mới trong chuông. VI + EN.

## Cách đọc của tôi (chờ Chủ có/không; chi tiết ở thiết kế 4.8)

Hết hạn tính theo **ngày của chi nhánh** (còn bán đến hết ngày hạn); lô nhập không bao giờ sửa; kiểm kê thiếu thì lấy lô **gần hết hạn trước**, thừa thì vào **một lô mới không hạn** mang mã đợt kiểm; cảnh báo chỉ khi một lần **xuất kho** đưa hàng xuống ngưỡng (nhập kho không báo; đổi ngưỡng riêng lẻ không báo cho đến lần xuất kế tiếp); quét hạn 08:00 mỗi ngày, mỗi ngày báo lại nếu còn lô hết hạn; không nhận phiếu có hạn đã qua; mã phiếu `PN000001`, đợt kiểm `KK000001`.

## Kiểm thử (DB thử `lucy_spa_p6_4_scratch_20261007`, 72 migration)

`format:check`, `lint`, `typecheck` sạch; `pnpm test` cả repo đạt (database 10, server 39, worker 20 gồm 1 bỏ qua, ui 464, api 259, web 580); `pnpm test:integration` (database) **107 + 18** đạt; `pnpm test:auth:integration` (API) **661 test, 660 đạt, 1 bỏ qua, 0 lỗi** (gồm toàn bộ bộ POS/hóa đơn/thanh toán cũ, không sửa test nào của chúng). Mới: DB (hàm "có thể bán" theo ngày chi nhánh ở 3 múi giờ, cảnh báo một lần/nạp lại, lịch sử không sửa được), API 10 nhóm (quyền theo chi nhánh với 8 loại người dùng, giá nhập vắng mặt ở mọi endpoint, phiếu, điều chỉnh, kiểm kê, cảnh báo, quét hạn, nhật ký), HTTP, 5 **race** (xác nhận phiếu hai người cùng lúc, hai người lấy nốt hàng, cùng yêu cầu gửi hai lần, kiểm kê duyệt trong lúc điều chỉnh, cảnh báo xử lý hai nơi), worker (không relay nào chạm sự kiện kho), web 27.

## UX gate (5 dòng)

1. Đã chụp và mở xem: tồn kho (2 trạng thái lọc), trang mặt hàng (2), phiếu nhập (danh sách, nháp, sửa, tạo), kiểm kê (danh sách, đang mở, đã duyệt), nhà cung cấp, 5 hộp thoại (điều chỉnh, tạo kiểm kê, thêm nhà cung cấp, cài đặt), chữ 130%; 360/768/1440 sáng, 1440 tối. Ảnh trong `.local/uxui-screens/`.
2. Sửa sau khi xem: nhãn đường dẫn quá dài (nay cắt như trang sản phẩm); thêm dòng "Tình trạng" trên trang mặt hàng; ô tìm phiếu bị cụt chữ; "0 ₫" thành "—" khi phiếu không có giá nhập; tab Kiểm kê dùng thanh công cụ chuẩn (ô chọn chi nhánh không còn tràn cả hàng, hết dòng "kết quả" lặp).
3. DOM audit 9 trang × 4 lần chụp: **0 phát hiện ở 768 và 1440**; ở 360 có 4 cảnh báo `row-height-uneven`: thẻ trên điện thoại cao khác nhau khi tên sản phẩm dài (dữ liệu thử có tên 200 ký tự). Chưa sửa.
4. Chữ 130% và 360 px: tràn ngang 32 px do thanh trên cùng chung của mọi trang quản trị (đã ghi `docs/UI_BACKLOG.md`, Chủ quyết để sau). Ở 360 px, tab thứ tư "Nhà cung cấp" bị cắt mép, cuộn ngang trong thanh tab.
5. Không thêm `wf-*`, px/rem, màu hex; bộ đếm ratchet không tăng. Ảnh thumbnail sản phẩm trong ảnh chụp bị vỡ vì máy chụp không có kho ảnh (giống P6-3).

## Chưa rõ / cần Chủ quyết

- Các cách đọc ở trên. Chọn mặt hàng trong phiếu/kiểm kê tải toàn bộ danh sách (lọc trên trình duyệt): đủ cho vài trăm mặt hàng, danh mục lớn hơn cần tìm kiếm phía máy chủ.
- Tôi đã chạy lại vòng đua nhiều lần trên máy này nhưng chưa thử tải thật (P6-7).
