# Phase 6 Wave 4 / P6-23: chiến dịch khuyến mãi, phần web

Chưa commit, chưa deploy. Backend đã có sẵn (`/api/v1/product-campaigns`, `public/campaigns`, `public/products?campaign=`); không sửa API, database, server.

## Đã làm

- Danh sách `/workforce/product-campaigns`: DataTable chế độ server, 20 dòng một trang, tìm kiếm, lọc theo trạng thái (Nháp, Sắp diễn ra, Đang chạy, Đã kết thúc), nút chính "Tạo chiến dịch" mở hộp thoại ngắn (tên Việt/Anh, địa chỉ tự gợi ý từ tên, thời gian giờ Việt Nam, ghi chú nội bộ).
- Trang chiến dịch `/workforce/product-campaigns/[id]`: nút chính Công bố (nháp) hoặc Kết thúc chiến dịch (đang chạy/sắp diễn ra), Xóa bản nháp trong menu. Bốn tab: Sản phẩm (kiểm tra trước khi công bố, bảng nhóm giá, bảng sản phẩm đã chọn có bộ lọc nhóm và lưu ý, bỏ sản phẩm khỏi chiến dịch), Chọn sản phẩm (lọc thương hiệu, danh mục, khoảng giá, còn hàng, chọn nhiều dòng, "Thêm đã chọn" và "Thêm tất cả kết quả lọc" qua một hộp thoại có số lượng, tối đa 2000), Hiển thị (nhãn, tiêu đề, lời nhắn, chữ nút, ảnh bìa qua thư viện ảnh; sửa được cả sau khi công bố), Thông tin (chỉ sửa khi còn nháp).
- Mọi nút bật/tắt theo `campaign.can.*`, không theo trạng thái tự suy. Chỉ gửi các khóa đã đổi. Phiên bản cũ (CONFLICT) hiện thông báo kèm nút Tải lại, không tải lại âm thầm. Thông báo lỗi tiếng Việt cho mọi mã lỗi của chiến dịch.
- Web công khai: thẻ và trang sản phẩm có giá gạch, nhãn chiến dịch (hoặc %), tên chiến dịch dẫn tới `/products?campaign=<slug>`; trang đó có phần đầu (ảnh bìa, tiêu đề, lời nhắn, nút) và giữ phân trang/sắp xếp; chiến dịch lạ hoặc đã hết hiện trang thường; trang `/products` thường có tối đa 2 dải chiến dịch đang chạy. Lỗi tải chiến dịch không làm hỏng trang.
- Thư viện ảnh: nhãn cách dùng `CAMPAIGN`. Menu: "Chiến dịch" (MANAGE_PRODUCT_PRICES, toàn cục).
- Nhóm giá trình bày bằng bảng (một mặt bảng, theo FR), không dùng thẻ lồng.

## File chính

`lib/workforce/campaigns.ts`, `i18n/campaigns.ts`, `components/workforce/screens/campaign*.tsx`, `campaigns.tsx`, hai route trong `app/[locale]/workforce/(app)/product-campaigns`, `components/public/campaign-views.tsx`, `i18n/campaigns-public.ts`, sửa nhỏ `public-products-core.ts`, `public-site.ts`, `products-view.tsx`, `product-offer.tsx`, `packages/ui/src/site.css` (khối chiến dịch) và `components.css` (ô tiền hẹp trong thanh công cụ).

## Kiểm thử (apps/web)

`tsc --noEmit`: file của bước này sạch (còn lỗi ở `online-orders.test.tsx`, `online-order-dialogs.tsx` của việc khác). eslint, prettier, `check-boundaries`: sạch. Test: `campaigns.test.ts` (18), `campaigns.test.tsx` (6), nav, permissions, public-products-core, products-view, public-pages, ui-ratchet, screens-gate, media: 96 đạt, 0 lỗi. `next build`: đạt. Kiểm tra DOM (7 trang, 3 độ rộng): 0 phát hiện sau khi sửa 1 lỗi chiều cao dòng. Đã chạy end-to-end thêm sản phẩm vào nhóm qua giao diện và kiểm bằng API.

## UX gate

Môi trường: DB scratch lucy_spa_w4_camp_ui_scratch (101 migration), API 3111, web dev 3110 (biểu tượng "N" góc dưới trái là của Next dev, không phải của ứng dụng). Đã MỞ và xem từng ảnh:

- Quản trị: danh sách 360, 768, 1440 sáng và 130% chữ 1440 sáng; chi tiết đang chạy 1440 sáng; bản nháp 1440 sáng và tối, 130% chữ 360; chiến dịch đã kết thúc 1440 tối; tab Chọn sản phẩm 1440 sáng, 768 sáng, 130% chữ 360; tab Hiển thị 1440 sáng và tối; tab Thông tin 360 và 1440 tối; ngăn kéo sửa thông tin 1440 sáng; ngăn kéo sửa hiển thị 1440 sáng; hộp thoại tạo 360 và 1440, công bố 1440, kết thúc 1440, thêm nhóm 360 và 1440, thêm vào nhóm và kết quả (1440).
- Công khai: /products 1440 và 768 (dải chiến dịch), trang sale 1440 sáng, 768 tối và 360 sáng, chiến dịch lạ (?campaign=khong-co) 1440 sáng, trang sản phẩm 1440 sáng và 768 sáng (cuộn tới giá).
- Đã kiểm: bố cục, chữ cắt, hàng cao đều, giao diện tối, không tràn ngang trang, dải chiến dịch, phần đầu sale, trạng thái trống.
- Đã sửa: bảng rộng tràn, cột thời gian dài, thanh lọc giá và ô tìm kiếm bị cắt (thanh công cụ Chọn sản phẩm nay vừa một hàng ở 1440), ô lưu ý lệch chiều cao dòng trên điện thoại, dòng mô tả của chiến dịch đã kết thúc lặp "Dừng sớm", nhãn trùng ở tab Hiển thị.
- Chưa mở: 1440 tối của danh sách và tab Chọn sản phẩm đã sửa ô tìm; ảnh 768 của tab Hiển thị/Thông tin.
- Kiểm tra DOM trang (7 trang x 3 độ rộng): 0 phát hiện. Kiểm tra DOM với hộp thoại/ngăn kéo mở (tạo, thêm nhóm, công bố, kết thúc, thêm vào nhóm, sửa thông tin, sửa hiển thị; 360/768/1440 sáng, 1440 tối): hộp thoại 0 phát hiện, trừ (1) thêm nhóm: viền thanh trên chồng viền thẻ do trang đã cuộn dưới lớp phủ trong ảnh chụp; (2) hai ngăn kéo: phát hiện surface-style-mix giữa thẻ và ngăn kéo của kit (không bo góc). Cả hai đến từ thành phần kit/ảnh chụp, chưa so với ngăn kéo cũ nên chưa khẳng định giống màn khác.

## Chưa xong / lưu ý

- Ô chọn dòng cao 20px do thành phần kit (nhãn cả dòng là vùng bấm); kiểm tra tự động báo `small-target`, giống màn nhóm.
- Giới hạn (độ dài, 1-90%) khai báo lại ở web vì contracts không xuất; backend không lỗi.
