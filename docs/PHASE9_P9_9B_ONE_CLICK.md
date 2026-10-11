# Phase 9 P9-9b: một lần bấm "Nhập và đăng tất cả" và "Quét toàn bộ"

Trạng thái: **làm xong, chưa deploy.** Căn cứ: yêu cầu của chủ sau khi thử trên máy thật (nguyên văn ở `docs/PHASE9_PRODUCT_IMPORT.md` mục 17). **Migration `20261130000000_phase9_full_scan` (107 → 108)**, chỉ thêm: cột `import_scans.scope` (`SAMPLE` mặc định, hoặc `FULL`) và hai ràng buộc (mẫu tối đa 20, toàn bộ tối đa 2.000). Quyền vẫn **68**. Kiểm tra an toàn bên dưới (quyền, khóa, nhật ký, lưu vết) giữ nguyên; chỉ số lần bấm giảm.

## Làm gì

- **Quét toàn bộ** (menu nguồn, bên cạnh "Quét mẫu"): đọc mọi sản phẩm của nguồn theo trang 100 sản phẩm, vẫn 1 yêu cầu mỗi giây, vẫn theo robots.txt và giấy phép. Chỉ so với các lần quét **cùng phạm vi** (quét toàn bộ không làm quét mẫu thành "đáng ngờ" và ngược lại). Quét mẫu vẫn 20 sản phẩm.
- **Nhập và đăng tất cả** (nút ở đầu "Sản phẩm nhập", cần `MANAGE_PRODUCTS` **và** `MANAGE_PRODUCT_PRICES`): một trang xem trước, mỗi sản phẩm một ô tích (ảnh, tên, SKU, thương hiệu, nhóm, giá), tích sẵn tất cả; "Chọn tất cả / Bỏ chọn tất cả", tìm theo tên hoặc SKU, lọc theo nhóm và thương hiệu; ô tích rộng 44 px trên điện thoại. Bấm một nút: sản phẩm được tích được nhập và **đăng bán** (gọi 20 sản phẩm mỗi lượt, có thanh tiến độ); sản phẩm bỏ tích thành **IGNORED** và **không đề xuất lại** trừ khi nội dung ở nguồn đổi (giá hay ảnh đổi thì không mở lại). Sản phẩm đã đăng vẫn ẩn được bằng trạng thái ngừng bán sẵn có.
- **Tự chọn:** thương hiệu (tạo mới nếu chưa có, nhớ cho lần sau), **12 nhóm cố định** của chủ (tạo nếu thiếu; thứ tự và tên đúng như chủ ghi), giá bán. Nhóm: danh mục của nhà cung cấp trước (Bộ/Set trước hết), rồi từ khóa tiếng Việt và tiếng Anh trong tên; tên thương hiệu và dòng sản phẩm không bao giờ là nhóm; không khớp thì "Khác" (vẫn đăng). Lựa chọn được nhớ (bảng ánh xạ có sẵn). Giá = giá niêm yết của nguồn, làm tròn **1.000 đồng**, ghi thành phiên bản giá bình thường, sửa sau được; **không ghi giá vốn**.
- **Chỉ bỏ qua khi có lý do thật** và nêu rõ trong danh sách "chưa nhập được": thiếu tên hoặc SKU, SKU trùng, ảnh bị cờ chặn, nguồn không có giá. Sản phẩm bị bỏ qua nằm lại ở "Chờ duyệt" để xử lý bằng tay.
- Sửa lỗi menu: mục "Giấy phép" trong menu hàng không còn tàng hình khi rê chuột (nền đỏ, chữ trắng).

## Thử trên dữ liệu thật (bản sao thử, không deploy, không mua bán thật)

- **Quét toàn bộ haruohui.com** (giấy phép ảnh tắt trong bản sao nên chỉ đọc chữ): 5 yêu cầu, 23 giây, **352 sản phẩm** đọc được (333 mới, 19 trùng với 20 của lần quét mẫu), trạng thái "xong, có việc cần xem" vì một sản phẩm giả lập của kiểm tra P9-9 (mã 999999991, chỉ có trong bản sao thử) không còn trong danh sách; 352 + 1 = 353 ứng viên.
- **Lần phân loại thật (353 sản phẩm):** thương hiệu THE WHOO 119, OHUI 80, SU:M37 47, BELIF 26, CNP 26, BEYOND 21, CARE ZONE 15, GLINT 4, Euthymol 1, TG Dominas 1, không có thương hiệu 12 (9 thực phẩm chức năng, 3 của TG Dominas ghi trong tên). Nhóm: Bộ sản phẩm 72, Trang điểm 46, Làm sạch 43, Serum 41, Dưỡng ẩm 40, Chống nắng 32, Toner 26, Mặt nạ 19, Khác 17, Chăm sóc mắt 6, Cơ thể 6, Tóc 4. Lần thử đầu sai ba chỗ (nhóm quà tặng và "Thực phẩm chức năng" bị coi là thương hiệu; dòng "Whoo ..." thành thương hiệu riêng; 103 sản phẩm thiếu thương hiệu): đã sửa và có bài kiểm thử riêng.
- **Danh sách "chưa nhập được": 19 trên 353** (16 SKU dạng chữ chưa đúng dạng, 1 SKU trùng, 1 trùng chưa giải quyết, 2 không có giá).
- **Nhập thật trên bản sao:** tích 40, bỏ tích 5: 40 sản phẩm **đăng bán**, 5 thành IGNORED, 7 thương hiệu mới, 12 nhóm được tạo, 40 phiên bản giá đều chia hết 1.000 (230.000 đến 7.030.000 đồng), 0 giá vốn, 8 ánh xạ thương hiệu và 13 ánh xạ nhóm được nhớ, nhật ký có đủ (tạo sản phẩm, đổi giá, đổi trạng thái, duyệt ứng viên, tạo nhóm và thương hiệu). Sản phẩm bỏ qua mở lại khi nội dung nguồn đổi: đã thử bằng một khác biệt giả lập rồi quét thật lại, ứng viên 330 từ IGNORED về "Chờ duyệt".
- Kiểm thử: server 12 bài phân loại; API tích hợp trên PostgreSQL thật (3 bài `supplier-import-all`, cộng bộ P9-3..P9-8): **73/73**; web (màn nhập tất cả, thẻ cổng quyền) và UI kit (cột chọn mới) đều qua; `lint`, `typecheck`, `format:check`, `pnpm test` cả repo sạch.

## UX gate

Ảnh `.local/uxui-screens/p99b-*`, đã mở và xem từng ảnh: trang nhập tất cả ở 360, 768, 1440 sáng và 1440 tối (thật, bằng cookie giao diện), không tích sản phẩm nào, chữ 130% ở 360, người không có quyền (trạng thái trống), bản tiếng Anh, cuộn danh sách chưa nhập được (điện thoại, tối), menu "Giấy phép" khi rê chuột, ngăn "Quét nguồn". **Đã sửa sau khi xem:** (1) ô tích bị đè dưới ảnh trên thẻ điện thoại: thêm cột chọn riêng vào bảng chung (góc trên bên phải, 44 px), (2) ô tìm bị bóp còn một vệt trên 360: hai nút chọn xuống hàng riêng, (3) số sản phẩm theo nhóm là cột 12 dòng: thành hàng nhãn gọn, (4) ngăn quét luôn ghi "Quét mẫu": đổi thành "Quét nguồn", (5) lý do bị bỏ qua bị cắt trên điện thoại: hiện đủ chữ. Công cụ chụp nay đo ô tích qua nhãn bao quanh (nhãn mới là chỗ ngón tay chạm). **DOM audit:** `supplier-imports`, `supplier-sources`, `imports`: 0; trang mới 3 (chiều cao thẻ lý do khác nhau trên 360 vì chữ xuống dòng, và hai kiểu mặt phẳng thông báo/bảng ở 768 và 1440, kiểu chung của bộ giao diện); không trang nào trong 26 trang gốc bị đụng. **Chưa xem:** 768 tối, bản tiếng Anh ở 360 và 768, trạng thái "đang chạy" và "xong" của nút (cần chạy thật; kiểm thử web có).

## Em tự đặt, chờ chủ duyệt (đụng giá và đăng bán)

1. Giá khuyến mãi của nguồn thấp hơn giá niêm yết thì lấy **giá khuyến mãi** (chủ nói "giá niêm yết"); làm tròn đến 1.000 đồng.
2. 16 SKU dạng chữ (đường dẫn) **không tự nhập**, vì chủ đã quyết giữ SKU nguyên văn và không tự sinh; chủ tự sửa hoặc duyệt tay.
3. Thực phẩm chức năng (9 sản phẩm) vào nhóm "Khác" vì 12 nhóm không có chỗ cho chúng.
4. "Đăng" = trạng thái đang bán của sản phẩm; công tắc "Bán online" **không bị đụng** (vẫn tắt).
5. Quét theo lịch dùng phạm vi toàn bộ khi nguồn đã chạy được một lần toàn bộ, nếu không thì mẫu; lịch vẫn tắt cho tới khi chủ bật.
