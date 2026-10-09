# P6-23: Chiến dịch khuyến mãi, phần máy chủ (báo cáo)

Theo PRD 24.1 và yêu cầu của Chủ (2026-10-09, "chiến dịch đầy đủ"); quyền `MANAGE_PRODUCT_PRICES` (W4-8, không thêm quyền). Các cách hiểu W4-11 ở mục 2.38 **chờ Chủ xem lại**. Giao diện: `PHASE6_STEP23_CAMPAIGNS_WEB.md`.

## Đã làm

- **Chiến dịch** có tên VI/EN, tên địa chỉ (slug), thời gian bắt đầu và kết thúc, nhiều **nhóm** (mỗi nhóm một quy tắc: giảm % từ 1 đến 90, giảm số tiền, hoặc giá cố định; tối đa 10 nhóm) và các sản phẩm; chọn hàng loạt theo hãng, nhóm hàng, khoảng giá, còn hàng, tìm tên/SKU, kể cả "chọn tất cả kết quả lọc" (tối đa 2.000).
- **Nháp** sửa tự do và chưa ảnh hưởng giá. **Đăng** (bắt đầu phải ở tương lai, có ít nhất một sản phẩm được giảm) rồi **đóng băng** thời gian, quy tắc, sản phẩm bằng bảo vệ cơ sở dữ liệu; chữ, huy hiệu, banner vẫn sửa được. **Kết thúc sớm** một lần, có lý do; hết giờ tự trả giá về như cũ, không cần khôi phục giá.
- **Xem lại trước khi đăng**: số sản phẩm, số sản phẩm quy tắc không giảm được, số trùng với chiến dịch khác hoặc khuyến mãi riêng của sản phẩm, phần trăm thấp và cao nhất. Trùng **không cộng dồn**: giá thấp nhất thắng, hòa thì chiến dịch đăng trước.
- **Giá**: vẫn MỘT hàm SQL (`lucy_variant_price_at`) thêm một ứng viên từ `lucy_variant_campaign_at`; quầy, web công khai, giỏ online, đổi hàng và kiểm tra hóa đơn đều dùng chung nên không thể lệch. Giảm % làm tròn **xuống** đồng. Không có chiến dịch thì kết quả y hệt trước. Dòng hóa đơn ghi chiến dịch đã định giá (`campaign_id`); hóa đơn cũ vẫn tái hiện đúng giá sau khi chiến dịch kết thúc.
- **Công khai**: chỉ chiến dịch đang chạy (tên, huy hiệu, tiêu đề, lời, nút, banner, giờ kết thúc); thẻ sản phẩm nêu chiến dịch; `?campaign=<tên địa chỉ>` liệt kê hàng của chiến dịch; ảnh banner chỉ công khai khi chiến dịch chạy và không xóa được khi còn được dùng.
- Trang quản trị sản phẩm báo đúng giá hiện hành (có chiến dịch).

## Migration

`20261124000000`: 3 bảng, 1 enum, 1 cột `invoice_line_products.campaign_id`, hàm giá thay thân (cùng cột trả về). Chỉ thêm. Quyền: không thêm.

## Kiểm thử

`campaign.integration.test.ts` (7 bài: số học quy tắc, quyền và đầu vào, nhóm và chọn hàng loạt, xem lại, đăng và đóng băng kể cả bảo vệ cơ sở dữ liệu, giá với mọi quy tắc / thắng thấp nhất / hòa / bán hàng / kết thúc / tái hiện, góc nhìn công khai và banner). Chạy lại: giá v3, bán hàng, quầy, đổi hàng, danh mục, công khai, phương tiện, bộ online: 0 lỗi.

## Câu hỏi mở

1. Gắn chiến dịch với **hero trang chủ và popup** (hai thứ này có lịch riêng) — chưa làm.
2. Quy tắc cộng dồn khác "giá thấp nhất thắng" — không định nghĩa.
3. Báo cáo doanh thu theo chiến dịch — dữ liệu đã ghi (`campaign_id`), chưa có màn.
