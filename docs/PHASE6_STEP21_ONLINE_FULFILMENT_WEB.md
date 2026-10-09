# P6-20/P6-21 (web): xử lý đơn online, giao hàng, giao thất bại

Chưa commit, chưa deploy. Chỉ sửa phía web; backend và `packages/contracts` giữ nguyên.

## Đã làm

- Trang `/workforce/online-orders`: chọn chi nhánh (người chỉ có quyền hoàn tiền cũng thấy), 6 tab theo `ONLINE_QUEUE_TABS` (không có tab "chưa thanh toán"), tìm kiếm, DataTable 20 dòng/trang. Mỗi dòng một huy hiệu: "Trễ hạn gửi" / "Quá 7 ngày chưa giao" thay cho trạng thái khi có.
- Trang `/workforce/online-orders/[id]`: nút chính là bước kế tiếp (Gửi hàng, Xử lý giao thất bại, Hàng đã về cửa hàng, Ghi nhận đã giao). Thẻ thông tin, địa chỉ (Sửa địa chỉ), vận chuyển (mã vận đơn là liên kết, phí chiều đi chỉ khi API trả về), danh sách sản phẩm (menu hàng: hủy và hoàn tiền), nhật ký giao hàng, đơn trả hàng (menu hàng: ghi phí gửi về), kết quả giao thất bại.
- Hộp thoại: gửi hàng (ngăn kéo, cả kiện), sửa vận đơn (chỉ gửi phần đổi, có lý do), đã giao (ngày tùy chọn, không sau hôm nay theo giờ Việt Nam), nhật ký (loại theo trạng thái kiện), hàng đã về, sửa địa chỉ, hủy dòng và hoàn tiền, xử lý giao thất bại, ghi phí gửi về.
- Xử lý giao thất bại: công thức hiện ngay (tiền hàng, phí đi, phí về, tiền hoàn = max(0, ...)); hoàn 0 thì ẩn hình thức hoàn, ép "không bán lại được", không hỏi mật khẩu; hoàn > 0 hỏi mật khẩu một lần (cùng `clientRequestId` khi thử lại).
- Trang `/workforce/shipping-carriers` (MANAGE_PRODUCTS toàn cục): thêm, sửa tên và liên kết tra cứu, ngừng dùng và dùng lại (có `expectedRowVersion`).
- Phía khách (`order-fulfilment.tsx`): đơn vị vận chuyển, mã vận đơn có liên kết, ngày gửi và nhận, nút "Tôi đã nhận hàng" (có xác nhận), hai hạn đổi trả với câu chính sách Chủ đã duyệt, "cửa hàng xử lý đổi trả", số tiền đã hoàn, thông báo giao thất bại. Không bao giờ hiện phí vận chuyển.
- Menu: "Đơn online" (nhóm Thanh toán, MANAGE_PRODUCT_ORDERS hoặc REFUND_PRODUCTS ở một chi nhánh), "Đơn vị vận chuyển" (nhóm Danh mục). Thông báo: đơn mới mở trang đơn online, cảnh báo ngày mở hàng đợi online, câu có số đơn.
- Lời lỗi tiếng Việt và tiếng Anh cho mọi mã lỗi của các lệnh này (kể cả `ONLINE_ORDER_NOT_READY` kèm tên dòng, `REFUND_STOCK_PENDING`).

## Kiểm thử

- `tsc --noEmit` sạch; eslint `--max-warnings 0` và prettier sạch trên file đã sửa; `check-boundaries` đạt; `next build` đạt.
- Toàn bộ test web: 880 đạt, 0 lỗi (gồm `ui-ratchet`). Test mới: `online-orders.test.ts` (28), `online-orders.test.tsx`, `shipping-carriers.test.tsx`, `order-fulfilment.test.tsx`, `online-orders-notifications.test.ts`; sửa `nav-groups.test.ts`, `permissions.test.ts`.

## UX gate

CSDL scratch `lucy_spa_w4_fulfil_ui_scratch`, API 3121, web 3120, 37 đơn ở mọi trạng thái (`.local/w4-fulfil/`). Đã mở và xem: hàng đợi 360/768/1440 sáng, 1440 tối, 1440 ở cỡ chữ 130%, các tab Giao thất bại; đơn chờ gửi, đang giao, giao thất bại (sáng, tối), đã về cửa hàng, đã xử lý, đã giao có đơn trả, 360 đã xử lý; ngăn kéo gửi hàng (360, 1440), xử lý giao thất bại (360, 1440, hoàn 0), nhật ký, sửa địa chỉ; trang đơn vị vận chuyển (360, 1440); trang khách (đang giao, đã nhận, giao thất bại, đã xử lý, hộp xác nhận). Đã sửa sau khi xem: nhiều huy hiệu làm lệch chiều cao hàng, cột trống, hàng "-0 ₫", danh sách kiện hàng, nhãn địa chỉ bị xuống dòng, chữ bị tràn ở thẻ 360. DOM audit (4 trang): 8 phát hiện FR11 (tên sản phẩm cố ý dài 100 ký tự bị cắt, có `title`) và 2 FR8 (thẻ điện thoại cao khác nhau do tên dài); không có phát hiện khác.

## Chưa xử lý được / lưu ý

- Ô chọn radio gốc 20 px bị cảnh báo vùng chạm (thành phần RadioGroup dùng chung, nhãn bao quanh lớn hơn).
- Ảnh 130% chỉ phóng cỡ chữ gốc; ở 1440 các cột phụ ẩn từ 2xl nên bảng có thể cuộn ngang trong khung.
- Backend (không sửa): xử lý giao thất bại ngay sau khi gửi, khi worker chưa ghi nhận xuất kho, trả 503 `SERVICE_UNAVAILABLE` (trigger DB "goods reserved...") thay vì `REFUND_STOCK_PENDING` khi chọn "không bán lại được". Scratch không chạy worker nên seed giả lập bằng SQL.
