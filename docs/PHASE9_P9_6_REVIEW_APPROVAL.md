# Phase 9 P9-6: màn hình duyệt sản phẩm nhập và duyệt tạo sản phẩm nháp

Trạng thái: **làm xong, chưa deploy.** Căn cứ: `docs/PHASE9_PRODUCT_IMPORT.md` (mục 5, 9, 12) và lời chủ 2026-10-10 (giá do chủ đặt, giá nhà cung cấp chỉ tham khảo, ảnh không bao giờ lẫn). Có migration `20261128000000_phase9_review_decisions` (105 → **106**), quyền vẫn **68** (`REVIEW_SUPPLIER_IMPORTS` có từ P9-2, GLOBAL).

## Đã làm

- **API `/api/v1/supplier-imports`** (chỉ `REVIEW_SUPPLIER_IMPORTS`): danh sách 20/trang có lọc trạng thái và cảnh báo, chi tiết, sửa (chỉ trường của Lucy, `expectedVersion`), ghi nhớ ánh xạ thương hiệu/nhóm, quyết định ảnh (giữ/bỏ) và "giữ riêng" cho nghi trùng, từ chối, bỏ qua, duyệt một sản phẩm, duyệt tối đa 20 sản phẩm sẵn sàng (mỗi sản phẩm một savepoint, báo cái bị bỏ qua), ảnh theo từng ứng viên (chỉ người có quyền).
- **Duyệt** tạo **một sản phẩm NHÁP** + một biến thể với SKU đúng như đã xem + ảnh đã giữ theo thứ tự + dấu vết nguồn, trong một giao dịch; ứng viên thành `IMPORTED`. Máy chủ chặn: thiếu tên, SKU sai dạng hoặc đã có, trùng SKU với ứng viên khác, ảnh bị cắm cờ chưa có quyết định, nghi trùng chưa "giữ riêng".
- **Giá:** giá nhà cung cấp chỉ trả về cho người có `MANAGE_PRODUCT_PRICES` (máy chủ cắt, không phải màn hình), chỉ để tham khảo; **không bao giờ ghi vào giá vốn**. Giá bán chỉ khi người đó tự nhập lúc duyệt; không nhập thì sản phẩm nháp chưa có giá.
- **Quyết định ảnh/nghi trùng** nhớ trong bảng `candidate_review_decisions` (thêm, không sửa); đánh giá lại (quét lại, lưu ánh xạ) tôn trọng quyết định nhưng không bao giờ tự gán ảnh.
- **Màn hình** `Sản phẩm nhập` trong menu, tiêu đề trang "Duyệt sản phẩm nhập" (nhóm Danh mục): bảng 20/trang, lọc, ngăn kéo duyệt với từng ảnh **cạnh tên sản phẩm, SKU và nút mở trang nguồn** (`PictureReview` trong `packages/ui`), sửa, "Nhớ lựa chọn này", từ chối/bỏ qua có ghi chú, nút "Duyệt sản phẩm sẵn sàng" có hỏi lại số lượng. Màn hình Nguồn nhà cung cấp có thêm "Quét mẫu" (xếp hàng, hiện kết quả lần quét).

## Kiểm thử

Server 121, web 921, api 352, database 112, ui 488, worker 24 (`pnpm test` cả repo xanh); tích hợp duyệt **6/6** trên PostgreSQL thật (quyền và cắt giá, sửa, ánh xạ, ảnh cờ/nghi trùng, duyệt một và nhiều, từ chối/bỏ qua). `lint`, `typecheck`, `format:check` sạch. Rehearsal: bản sao `lucy_spa_dev` 68 → 106 sạch, không lệch ở bảng mới; DB thử đã xóa. Dữ liệu thật: 20 sản phẩm haruohui.com đã quét ở P9-4/5.

## UX gate

Ảnh ở `.local/uxui-screens/p96-*` (dựng lại từ bản build cuối; 360/768/1440 sáng, 1440 tối, 130% chữ ở 360). **Đã mở và xem:** danh sách (360, 768, 1440 sáng, 1440 tối), lọc rỗng (360), lọc sẵn sàng (768), đã nhập (1440), menu hàng, hộp từ chối, hộp duyệt hàng loạt (360, 1440), người duyệt không có quyền giá (danh sách 1440, ngăn kéo 360 và cuối ngăn kéo 1440), ngăn kéo: sẵn sàng (360, 1440, 130% tối, tiếng Anh), ảnh trùng (360, 1440 sáng và tối, 130%), SKU đã có, SKU sai dạng (1440, 360), tên dài (1440, 768, 360, mở bằng liên kết `?review=`), chưa chọn nhóm kèm "Nhớ lựa chọn này" và hộp ghi nhớ, đã nhập (sáng, tối), ngăn kéo Quét mẫu (360, 1440). **Chưa mở từng ảnh** của mọi tổ hợp độ rộng và giao diện còn lại; phần đó chỉ có kiểm tra tự động (không cuộn ngang, ô bấm). **Chưa chụp:** trạng thái đang tải và lỗi (kit chung), danh sách nhiều trang (mẫu thật chỉ 17 sản phẩm).
Đã sửa sau khi xem: liên kết tên là `<a>` đúng kit, một nhãn cảnh báo mỗi dòng (nhãn chặn trước), tiêu đề ngăn kéo không lặp tên sản phẩm, bỏ nút lẻ trong ngăn kéo quét, gợi ý chữ nguồn chỉ khi chưa chọn, thông báo "duyệt được nhưng còn mục cần xem", tên menu rút còn "Sản phẩm nhập" (nhãn dài làm xuống dòng ở lối tắt trang tổng quan).
**DOM audit** (26 trang mốc + 2 trang, chạy sạch vào thư mục riêng): `list-height-uneven` 4 → 6 và `row-height-uneven` 8 → 10. `dashboard` 9 → 11 là khoản đã ghi ở `docs/PHASE9_P9_3_ADAPTER_TEST_SOURCE.md` và `docs/PHASE9_P9_4_SCAN_IMAGES.md` (dữ liệu scratch), không do bước này; `supplier-sources` 0 → 1 và `supplier-imports` 0 → 1 là hai trang chưa có trong mốc. Phát hiện của trang mới: thẻ 360 px cao 300-360 px (SKU dạng chữ dài như `nuoc-hoa-hong-…` xuống dòng trên điện thoại; cùng loại với màn Nguồn nhà cung cấp, chưa sửa). Ô chọn 20 px của kit (CheckField) bị đo nhỏ hơn 44 px: chung bộ kit.

## Em tự đặt, chờ chủ duyệt

1. Duyệt chỉ tạo sản phẩm **nháp** (chưa đăng); "Duyệt sản phẩm sẵn sàng" chỉ lấy ứng viên không còn cảnh báo, tối đa 20 mỗi lần, không đặt giá.
2. Ảnh bị cắm cờ **phải** có quyết định giữ/bỏ trước khi duyệt; nghi trùng phải bấm "giữ riêng". Quyết định được nhớ qua các lần quét lại.
3. Từ chối/bỏ qua có ghi chú không bắt buộc và không xóa dữ liệu (thành trạng thái, lưu người và giờ).
4. Duyệt **một** sản phẩm vẫn được khi còn cảnh báo không chặn (chưa chọn thương hiệu/nhóm, thiếu mô tả, nguồn không có giá); ngăn kéo báo rõ. Chỉ "Duyệt sản phẩm sẵn sàng" đòi không còn cảnh báo nào.
5. Ô giá bán lúc duyệt hiện cho người có `MANAGE_PRODUCT_PRICES` (em hiểu "giá do chủ đặt" là người giữ quyền giá); người không có quyền không thấy ô đó lẫn giá nguồn.

## Triển khai (khi chủ cho phép)

Có migration 106 (bảng mới, thêm); khởi động lại API, worker và web. Quay lại bản cũ: bảng mới không ảnh hưởng chức năng cũ.
