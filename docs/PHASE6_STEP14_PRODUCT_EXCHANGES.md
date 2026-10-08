# P6-14: Đổi hàng (báo cáo)

Làm theo yêu cầu của Chủ (2026-10-08, nguyên văn ở mục 2.27 của `PHASE6_PRODUCTS_INVENTORY_DESIGN.md`; cách làm ở mục 2.28). Chưa đẩy lên, chưa triển khai, chưa gán quyền cho ai. Các chỗ phải tự hiểu (P14-1 đến P14-14) **chờ Chủ**.

## Đã làm

- **Phiếu đổi** (`product_exchanges`): chỉ từ hồ sơ trả hàng đã chấp nhận theo cách "đổi hàng". Khách trả lại số hàng của hồ sơ, nhận cùng số lượng của **một** sản phẩm đang có trong kho (đặt trước là mốc 3b). Không sửa, không xóa (cơ sở dữ liệu chặn). Người làm cần `REFUND_PRODUCTS` và **một lần nhập mật khẩu cho một lần đổi** (cùng "bể" với hoàn tiền: một lần nhập không thể dùng cho cả hoàn tiền và đổi hàng).
- **Tiền (đúng lời Chủ):** chênh lệch = giá hàng mới tại ngày đổi trừ số tiền khách **thực trả** cho phần hàng trả (cùng cách chia như hoàn tiền). Đắt hơn: khách trả phần chênh như một lần thanh toán thường (tiền mặt hoặc PayOS). Rẻ hơn: hoàn phần chênh bằng tiền mặt hoặc chuyển khoản thủ công theo luật hoàn tiền (chỉ lưu mã giao dịch, Chủ nhận thông báo). Bằng giá: không có gì.
- **Cách thu phần chênh mà không làm hệ thống thanh toán thứ hai:** hàng mới đi trên **một hóa đơn mới** (hóa đơn bán sản phẩm tại quầy, cùng chi nhánh và người trả), khoản duy nhất được trừ là "số tiền đã trả cho hàng cũ". Tổng hóa đơn chính là phần chênh. Nên kho được **giữ** lúc đổi và **trừ** khi hóa đơn được thanh toán (đúng quy tắc giữ hàng), thanh toán và PayOS dùng nguyên màn hình cũ, doanh thu chỉ tính phần chênh, và **điểm Beauty** được cộng đúng `floor(phần chênh khách trả / 1000)` bởi bộ tính điểm sẵn có: điểm cũ giữ nguyên, bằng giá hoặc rẻ hơn không cộng và không trừ (PRD 28.5).
- **Hàng khách trả:** người làm chọn "bán lại được" hoặc không (không có mặc định); bán lại được thì nhập **lô mới** `{mã hồ sơ}-E` giữ hạn dùng của lô đã bán; không thì kho không đổi. Không có khoản chênh phải thu thì nhận hàng ngay trong lần đổi; có khoản chênh thì bấm "Hoàn tất đổi" sau khi khách thanh toán.
- **Dãy chung của dòng hàng:** hoàn tiền và đổi hàng cùng cộng dồn trên một dãy, nên tổng tiền luôn bằng đúng số tiền của dòng. Một lần đổi chưa xong **chặn** mọi việc khác trên dòng (hoàn tiền, đổi tiếp); hủy hóa đơn đổi chưa thanh toán thì trả lại dòng.
- **T22 mở rộng:** hóa đơn gốc có lần đổi và hóa đơn của lần đổi đã hoàn tất không đảo thanh toán, không hủy (API và cơ sở dữ liệu).
- **Màn hình:** trên trang hồ sơ đổi hàng: nút chính "Đổi hàng" (ngăn kéo: tìm hàng mới trong kho, xem số tiền, chọn cách hoàn hoặc hàng cũ bán lại được không, người bán, lý do), thẻ "Các lần đổi hàng", nút "Hoàn tất đổi" ở đầu thẻ; trang hóa đơn đổi ghi rõ dòng trừ là số tiền đã trả cho hàng cũ.

## Migration

`20261115000000` (một giá trị enum `EXCHANGE_RETURN`) và `20261115000001`: 3 bảng, 1 kiểu, 1 dãy số `DH000001`, cột mới ở bảng dùng mật khẩu, lô và chuyển kho, hàm `lucy_line_claims`, thay 3 hàm bảo vệ (hoàn tiền, kiểm tra giá bản 3, T22) và thêm các ràng buộc. Tổng 88 migration. Không đụng quyền; không gán quyền.

## Kiểm thử

- Mới (PostgreSQL thật): 18 bài tích hợp (quyền, giá đắt hơn, rẻ hơn, bằng giá, cùng sản phẩm, ví dụ OQ-82 270.000 → 350.000, khuyến mãi, kho và lô giữ hạn, mật khẩu một lần chung với hoàn tiền, kiểm số liệu, lặp yêu cầu, dãy chung với hoàn tiền, T22, hoàn tất, chốt cơ sở dữ liệu), **10 bài tranh chấp thật** (hai người cùng đổi một hồ sơ, cùng yêu cầu hai lần, một lần nhập hai lần đổi, đổi so với hoàn tiền, đổi so với đảo thanh toán gốc, hai lần đổi chéo hàng nhau, đơn vị cuối cùng của hàng mới, thanh toán so với hủy, hoàn tất hai lần, hoàn tất so với đảo thanh toán). Thử đột biến: bỏ bước khóa trước hàng trong kho thì bài đổi chéo thất bại (có khóa chết).
- Thêm: luật tiền và tính giá thuần, HTTP, kiểm tĩnh migration, 25 bài ở web. Các bài POS, thanh toán, hoàn tiền cũ không bị nới; chỉ thêm trường (`lineClaimedQuantity`, `OPEN_EXCHANGE`, `exchange` trên hóa đơn) và sửa một câu kiểm của bài màn hình P6-12/13 về hồ sơ đổi hàng.

## UX gate (đã mở từng ảnh)

Ảnh `.local/uxui-screens/p614-*`: trang hồ sơ (chưa đổi, chờ thanh toán, chờ nhận hàng cũ, đã hoàn tất đắt hơn có điểm, rẻ hơn chuyển khoản có sửa mã, cùng sản phẩm, đã hủy rồi đổi lại), ngăn kéo (đắt hơn, rẻ hơn kèm chuyển khoản, chữ 130%), trang hóa đơn đổi; 360, 768, 1440 sáng và 1440 tối. Đã sửa sau khi xem: câu "dòng hàng đang có lần đổi chưa xong" lặp ngay trên chính lần đổi đó (nay chỉ hiện khi dòng bị giữ bởi lần đổi khác); hai thẻ thừa ở hóa đơn đổi (ưu đãi theo bên, mã ưu đãi) đã ẩn; ghi chú dài đổi thành dòng giới thiệu. DOM audit: 7 trang hồ sơ 0 phát hiện; không loại nào tăng so với baseline. Chưa sửa được: ô chọn tròn của kit 20 px (cả dòng nhãn bấm được).

## Câu hỏi mở

P14-1 đến P14-14 ở mục 2.28, nhất là P14-2 (cùng sản phẩm thì đổi miễn phí, không tính chênh lệch), P14-3 (giá hôm nay, không giảm giá nào áp lên hàng mới), P14-4 (khách không trả đồng nào cho dòng thì không đổi), P14-6 (hàng cũ nhận lúc hoàn tất) và P14-9 (không có lệnh "hủy lần đổi" riêng, hủy hóa đơn đổi là đủ).
