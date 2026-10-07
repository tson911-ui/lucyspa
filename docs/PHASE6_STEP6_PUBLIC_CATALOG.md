# Phase 6 P6-6: trang mỹ phẩm công khai (2026-10-07, đã commit trên máy, chưa push, chưa deploy)

Làm theo mục 16 của thiết kế và OQ-27/OQ-28 đã duyệt; mẫu Lovable chỉ là tham khảo hình ảnh (không lấy dữ liệu, chữ, ảnh nào của mẫu).

## Đã làm

- **Trang công khai** `/vi/products`, `/en/products` (nhãn "Mỹ phẩm", EN "Cosmetics"): đầu trang do Chủ nhập (ẩn khi trống, lúc đó chỉ có tiêu đề "Mỹ phẩm"), tìm kiếm không dấu, 4 cách sắp xếp, lọc danh mục (danh mục cha gồm danh mục con) và thương hiệu (chỉ khi có từ 2 thương hiệu), khung cam kết do Chủ nhập, thẻ sản phẩm (ảnh, danh mục, tên, giá, giá gốc gạch ngang, "-x%", "Mới", "Hết hàng"), 20 sản phẩm một trang. Trang sản phẩm: ảnh vuốt được, chọn loại (giá và tình trạng từng loại), mô tả, khối "Mua trực tiếp tại cửa hàng" từ Thông tin cửa hàng, sản phẩm cùng danh mục. Chỗ cho nút mua sau này là `action` của `ProductOffer`, hiện không vẽ gì.
- **Menu (OQ-27):** một mục cho mọi người ở đầu trang; thanh dưới điện thoại chỉ thêm cho khách chưa đăng nhập (thành viên giữ 5 mục). Chân trang, sơ đồ trang (`/products` và từng sản phẩm), JSON-LD `Product`, canonical; trang tìm/lọc/trang sau không được lập chỉ mục.
- **API công khai** `GET /api/v1/public/products`, `/products/:code`, `/products/codes`: chỉ sản phẩm "Đang bán" có giá; giá từ `lucy_variant_price_at`, tồn từ `lucy_available_stock` (cộng các chi nhánh đang hoạt động); không bao giờ có giá vốn, số lượng, SKU, mã vạch, chi nhánh, mã nội bộ; cache 60 giây như các đường công khai khác; truy vấn bị chặn độ dài/giá trị. Ảnh sản phẩm chỉ phục vụ công khai khi sản phẩm đang bán.
- **Quản trị:** nút "Trang mỹ phẩm" ở màn Sản phẩm (ngăn kéo: ảnh, tiêu đề, lời giới thiệu, khung cam kết tối đa 6 dòng, đủ hai ngôn ngữ), và ô "Gắn nhãn Mới trong (ngày)" (1–365, mặc định 30) trong hộp Cài đặt. Có nhật ký.
- Không đụng POS, hóa đơn, thanh toán (test cô lập Wave 1 ghim điều này; đã cập nhật lên 10 migration).

## Migration, quyền

Migration `20261106000009_phase6_public_catalog_copy`: thêm 8 cột và 1 khóa ngoại vào `product_settings`, không đổi dòng nào. Wave 1 thành 10 migration, tổng 73 (cập nhật `PHASE6_WAVE1_DEPLOY_CHECKLIST.md`). Không thêm quyền: sửa nội dung dùng `MANAGE_PRODUCTS`.

## Kiểm thử (máy này, DB scratch)

`pnpm format:check`, `lint`, `typecheck` sạch. `pnpm test` toàn repo đạt (database 10, server 53, worker 19 +1 bỏ qua, ui 464, web 611, api 273 +89 cần DB). `pnpm test:integration` (107) đạt. Test API tích hợp mới `public-products.integration.test.ts` (9 mục: chỉ hiện đã đăng, giá/khuyến mãi, tình trạng, không lộ giá vốn/số lượng/SKU/id, tìm không dấu và ký tự đại diện, sắp xếp/lọc/trang, ảnh công khai chỉ khi đang bán, nội dung do Chủ nhập, không đụng bảng tiền) và `public-products.logic.test.ts`; web `products-view.test.tsx`, `public-products-core.test.ts`, `product-page.test.ts`. Khi chạy chung dưới tải, 5 file http của operations/pos từng lỗi cả file nhưng chạy riêng đều đạt (không liên quan). `pnpm test:auth:integration` (683 đạt, 1 bỏ qua) đạt khi chạy một mình; lần chạy chồng với một lần chạy khác trên cùng DB thì lỗi do tranh DB, không tính. DOM audit trang Sản phẩm (3 độ rộng): 0 phát hiện.

## UX gate (5 dòng)

1. **Đã mở xem:** mẫu Lovable 1440 sáng, 768, 360, 1440 "tối"; bản của ta: danh sách 1440 sáng (đầy đủ) và đầu trang, 1440 tối, 768 và 360 (đầu trang), cuộn 360 và 768, ngăn Lọc 360 và 768 tối, 130% ở 360, thanh trên 1024 (thêm 2 mục giả lập thành viên), chi tiết 1440 sáng và tối, 768, nhiều loại 1440, hết hàng 360, không ảnh 768, quản trị (ngăn kéo 1440 và 360, hộp Cài đặt 768, danh sách 360 và 768). **Chưa mở:** danh sách 768 và 360 sau lần sửa cuối, danh sách tối sau sửa nhãn, chi tiết 360 sáng bản cuối, chi tiết 360 tối.
2. **So với mẫu:** cùng bố cục (hero, danh mục + khung cam kết bên trái, lưới 3 cột, thẻ ảnh + nhãn + chữ có chân, giá đỏ + giá gạch). Khác có chủ ý: bỏ dòng "12 sản phẩm phù hợp" và chữ nhỏ trên tiêu đề; điện thoại để chữ hero trên nền đặc dưới ảnh. **Ảnh "tối" của mẫu giống hệt ảnh sáng** (trang mẫu không đổi giao diện), nên không dùng làm chuẩn cho bản tối.
3. **Đã sửa sau khi xem:** lỗi 500 trang sản phẩm (truyền hàm từ server sang client), ô tìm kiếm đè biểu tượng, nhãn trên ảnh chuyển sang nền đặc, khung cam kết nằm quá xa ở cột trái, lưới chi tiết vỡ 2 cột do tên vùng lưới, ảnh chi tiết quá to ở máy tính bảng, khoảng cách "Mô tả", nhãn menu bị bẻ dòng khi có 5 mục ở 1024–1279 px.
4. Dữ liệu chụp là 26 sản phẩm thử giả (tên "thử", ảnh vẽ tay) trong DB review, không dữ liệu thật hay của mẫu. Không thêm `wf-*`, hex, px/rem; chỉ dùng token và `packages/ui`.
5. **Chưa làm được:** thành viên đăng nhập thật ở 1024 (không có tài khoản khách trong DB review; chỉ giả lập thêm 2 mục menu), không thử trên điện thoại thật.

## Chưa rõ / cần Chủ quyết (OQ-49..OQ-53, `docs/PHASE6_OWNER_DECISIONS_VI.md`, chờ có/không)

Nơi nhập đầu trang và khung cam kết (tôi đặt ở màn Sản phẩm, thiết kế ghi tab Thông tin cửa hàng); 3 cách sắp xếp thêm ngoài "Nổi bật"; quy tắc chữ "Hết hàng" / "Đặt trước, dự kiến n ngày"; lời của khối mua tại cửa hàng; nhãn EN "Cosmetics". Còn lại: mô tả sản phẩm không xuống dòng được (quy tắc nhập sẵn có); chưa có giới hạn tần suất chung cho đường công khai (kiểm ở P6-7).
