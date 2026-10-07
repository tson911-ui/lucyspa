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

1. **Đã mở xem từng ảnh** (không nói gì về ảnh chưa mở): tồn kho (1440 sáng, 1440 tối, 768, 360; lọc "Còn hàng" và "Sắp hết hàng"), trang mặt hàng (1440, tên rất dài, hộp Điều chỉnh), phiếu nhập (danh sách 1440 và 768; nháp, sửa, tạo ở 1440; tạo ở 360; **lỗi nhập** ở 1440), kiểm kê (danh sách, đang mở 1440 sáng, tối và 360, **đang sửa chưa lưu: nút Duyệt bị khóa kèm lời nhắc**, đã duyệt), nhà cung cấp 1440, hộp tạo kiểm kê, hộp thêm nhà cung cấp, hộp Cài đặt (1440), **trạng thái trống** của 3 tab (1440; phiếu nhập cả 360), chữ 130% (kiểm kê 1440), **thông báo thật** trong trang Thông báo (1440 và 360). **Chưa mở**: các hộp thoại ở 360 và 768, bản tối của trang mặt hàng, phiếu và nhà cung cấp, chữ 130% ở 360 (chỉ có kết quả đo).
2. Sửa sau khi xem: nhãn đường dẫn quá dài; thêm dòng "Tình trạng" trên trang mặt hàng; ô tìm phiếu bị cụt chữ; "0 ₫" thành "—"; ô chọn chi nhánh của tab Kiểm kê và các trạng thái trống dùng thanh công cụ chuẩn (không còn tràn cả hàng); tên mặt hàng của dòng kiểm kê thành tiêu đề thẻ trên điện thoại (hai dòng, không còn 8 dòng); bảng phiếu nhập ở 768 không còn bị cắt (cột Nhà cung cấp ẩn dưới 1024); thông báo hạn dùng không còn nói "0 lô đã hết hạn"; lời giải thích ô báo trước hết hạn.
3. **DOM audit**: kịch bản chính thức `.local/uxui-audit/capture.mjs` **không còn trên máy này** nên không chạy được `--compare docs/uxui-audit-baseline.json`. Tôi chạy cùng bộ kiểm tra (`scripts/uxui-page-audit.js`) trên 9 trang × 4 lần chụp bằng công cụ riêng: ở 768 và 1440 chỉ còn một cảnh báo `icon-text-misaligned` của **chuông thông báo chung** (số "3" lệch 7,5 px; có từ khi có thông báo chưa đọc, không phải trang kho). Ở 360 còn `row-height-uneven`: thẻ cao 264-284 px vì **mã SKU thử dài 19 ký tự** xuống dòng; mã thật ngắn hơn. Chưa sửa.
4. Chữ 130% ở 360 px: tràn ngang 32 px do thanh trên cùng chung (đã ghi `docs/UI_BACKLOG.md`). Ở 360 px, tab thứ tư "Nhà cung cấp" bị cắt mép (cuộn ngang trong thanh tab).
5. Không thêm `wf-*`, px/rem, màu hex; bộ đếm ratchet không tăng. Ảnh thu nhỏ sản phẩm trong ảnh chụp bị vỡ vì máy chụp không có kho ảnh (giống P6-3).

## Chưa rõ / cần Chủ quyết

- **Có / không: mở rộng ràng buộc bảng `notifications`.** Migration `…08` nới 3 ràng buộc CHECK của bảng thông báo đang chạy thật để có 2 loại thông báo kho. Đây là chỗ duy nhất Wave 1 chạm tới một bảng cũ, nên tôi phải nới luật cô lập Wave 1 mà Chủ đã duyệt ở P6-2 (test cô lập nay cho phép đúng một ngoại lệ này và chỉ khi nó chỉ nới). Chỉ nới, không dòng nào bị đổi. Nếu Chủ không muốn, cách khác là không có thông báo trong app cho cảnh báo kho (chỉ xem trong màn hình Kho hàng).
- **Ghi chú khi deploy Wave 1:** migration `…08` giữ khóa độc quyền rất ngắn trên bảng `notifications` lúc chạy (bảng nhỏ); Wave 1 nay gồm **9 migration, tổng 72**.
- Các cách đọc ở trên. Chọn mặt hàng trong phiếu/kiểm kê tải toàn bộ danh sách (lọc trên trình duyệt): đủ cho vài trăm mặt hàng, danh mục lớn hơn cần tìm kiếm phía máy chủ.
- Mỗi bộ test đua chạy **một lần** trên máy này (mỗi tình huống 3 vòng), chưa thử tải thật (P6-7).

## Bổ sung UX gate (2026-10-08)

- Sau lần chụp lại bản cuối, tôi đã **mở thêm và xem**: kiểm kê 768 (sau khi ẩn cột Mã SKU ở máy tính bảng), nhà cung cấp 768, thông báo 768, phiếu nhập lỗi 768, trang mặt hàng 768, hộp thêm nhà cung cấp 768, hộp tạo đợt kiểm kê 768, đợt kiểm kê chưa lưu 768, hộp cài đặt 768, ba trạng thái rỗng (tối 1440 và 768) và tồn kho tối 1440. Không thấy lỗi mới. Các ảnh 360, hộp thoại và chữ 130% đã xem ở lượt trước.
- **DOM audit chính thức đã được tạo lại** và nằm trong repo: `scripts/uxui-audit-capture.mjs` + `scripts/uxui-audit-pages.json`. Chạy trên bản cuối cho các trang Phase 6: chỉ còn 2 phát hiện `row-height-uneven` (Tồn kho, Phiếu nhập); 26 trang của mốc cũ không có số đếm nào tăng so với `docs/uxui-audit-baseline.json`.
- Huy hiệu "3" trên chuông thông báo là lớp phủ có chủ đích (không phải chữ lệch): quy tắc kiểm tra bỏ qua phần tử định vị tuyệt đối; giao diện không đổi.
