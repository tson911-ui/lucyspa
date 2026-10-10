# Phase 9 P9-2: bảng dữ liệu nhập từ nhà cung cấp, hai quyền mới và màn hình "Nguồn nhà cung cấp"

Trạng thái: **làm xong, chưa deploy.** Căn cứ: `docs/PHASE9_PRODUCT_IMPORT.md` (mục 4, 11, 12; P9-T1..T10 đã duyệt theo lời chủ 2026-10-10). Mọi thứ ở đây chỉ **cấu hình nguồn**: chưa có bộ đọc, chưa quét, chưa tải ảnh, chưa tạo sản phẩm (P9-3 trở đi).

## Đã làm gì

- **2 migration** (tổng 101 → **103**): `20261125000000_phase9_permission_codes` (hai giá trị enum, riêng một migration vì Postgres không cho dùng ngay) và `20261125000001_phase9_supplier_sources` (8 bảng rỗng + enum + bảo vệ + viết lại ràng buộc phân loại quyền). Chỉ thêm; không sửa dòng nào có sẵn; mọi khóa ngoại `RESTRICT`.
- **Quyền 66 → 68, không cấp cho ai:** `MANAGE_SUPPLIER_SOURCES` (thêm/sửa nguồn, ghi và xác nhận giấy phép, bật/tắt) và `REVIEW_SUPPLIER_IMPORTS` (xem nguồn; về sau duyệt nội dung và ảnh, không đặt giá). Cả hai GLOBAL_ONLY, dữ liệu STANDARD. Hàng danh mục quyền do `pnpm db:permissions:sync` thêm (như các Phase trước).
- **Cổng giấy phép (P9-T9) ở ba tầng** (cơ sở dữ liệu, API, màn hình): nguồn chỉ bật được khi bản ghi giấy phép **đủ** (ai cho phép, bằng cách nào, ngày nào), **có chữ hoặc ảnh** và **đã được một người xác nhận**. Ghi giấy phép mới bỏ xác nhận cũ và tắt nguồn; đổi địa chỉ cũng bỏ xác nhận (giấy phép cấp cho địa chỉ cũ) và không đổi được khi đang bật. `permits_prices` chỉ ghi lại có được dùng lại giá không; giá nguồn luôn là dữ liệu tham khảo nội bộ.
- **8 bảng:** `supplier_sources`, `import_scans` (tối đa một lần quét đang chạy mỗi nguồn), `source_records`, `source_price_observations` (chỉ thêm, không sửa/xóa, không có cột giá vốn hay giá bán), `import_candidates` (chữ của Lucy tách khỏi chữ từ nguồn; `needs_translation` mặc định bật), `candidate_sources`, `candidate_images` (vị trí 0..5, tối đa 6 ảnh), `source_value_mappings`. Nguồn, lần quét, bản ghi, ứng viên không bao giờ bị xóa.
- **API** `/api/v1/supplier-sources`: danh sách, thêm, sửa, ghi giấy phép, xác nhận, bật, tắt; mỗi lệnh mang số phiên bản dòng, có nhật ký kiểm toán. Chọn nhà cung cấp có sẵn hoặc gõ tên (dùng lại nếu trùng tên, tạo mới nếu chưa có). Địa chỉ nguồn: chỉ `https`, tên miền thật, không cổng/tài khoản/`?`/`#`.
- **Màn hình** "Nguồn nhà cung cấp" (Danh mục, kiểu C): bảng 20 dòng/trang, hộp thêm nguồn, hộp sửa, ngăn "Giấy phép sử dụng", hộp xác nhận/bật/tắt; người chỉ có quyền xem chỉ thấy danh sách.

## Em tự đặt trong bước này (chờ chủ xác nhận)

1. Người ghi giấy phép **có thể tự xác nhận** (một người). Muốn "hai người" (người ghi khác người xác nhận) thì cần quyết định.
2. Thêm nguồn có thể **tạo nhà cung cấp mới** ngay trong hộp thêm (người có `MANAGE_SUPPLIER_SOURCES`, có nhật ký), không cần quyền kho.
3. Bật nguồn nghĩa là "được phép quét"; **chưa đòi trạng thái `READY`** ở bước này (chưa có chạy thử); P9-3 sẽ đòi cả hai.
4. Ghi chú giấy phép tối đa 500 ký tự; ngày cho phép không muộn hơn hôm nay theo giờ Việt Nam.

## Kiểm thử

Rehearsal: bản sao `lucy_spa_dev` (đang ở 68 migration) lên 101, rồi **101 → 103** sạch; `prisma migrate diff` không còn khác biệt ở bảng Phase 9; DB thử đã xóa. `pnpm test` cả repo đạt (database 112, server 53, worker 24 + 1 bỏ qua, ui 486, web 905, api 351 + 118 bỏ qua là bài tích hợp); tích hợp API `supplier-source` 11/11 trên PostgreSQL thật (quyền, gõ sai, cổng theo thứ tự, ghi lại bỏ xác nhận, phiên cũ, bảo vệ của cơ sở dữ liệu, bảng lịch sử); tích hợp database 5/5 và `phase6-foundation` (68 quyền); cách ly migration 8/8; `lint`, `typecheck`, `format:check` sạch.

## UX gate (5 dòng)

1. **Đã mở xem:** danh sách 1440 sáng/tối, 768 và 360 sáng; hộp thêm, ngăn giấy phép (360, 1440 sáng/tối), hộp xác nhận (1440 sáng), hộp tắt (1440 tối), hộp sửa (360), chữ 130% ở 360 sáng/tối, bản tiếng Anh 1440. **Chưa chụp:** trạng thái đang tải, lỗi, rỗng và bản chỉ xem (đã có bài kiểm thử dựng trang).
2. **Sửa sau khi xem:** ở 768 cột "Trạng thái" bị cắt ngang → cột nhà cung cấp ẩn dưới 1024 và cột địa chỉ ẩn dưới 1440 (xem lại: vừa khung); tên nguồn dài làm tiêu đề ngăn 3 dòng → cắt ở 40 ký tự; cảnh báo "chọn chữ hoặc ảnh" chỉ hiện sau khi bấm lưu hoặc khi đã có bản ghi.
3. **DOM audit** trang mới: 1 phát hiện FR8 `row-height-uneven` ở **360 px** (thẻ cao thấp theo độ dài tên dài), 768 và 1440 không có; 26 trang mốc chạy lại (có thêm một mục trong thanh bên): **không số nào tăng** (tổng theo loại bằng hoặc thấp hơn; `list-height-uneven` giảm 4 → 3), `docs/uxui-audit-baseline.json` không đổi.
4. Công cụ báo 3 ô tích 20 px trong ngăn giấy phép: dùng `CheckField` của bộ UI, **cả dòng 40/44 px là vùng bấm**; việc đổi cỡ ô tích là mục trong danh sách rà soát cuối.
5. Không thêm `wf-*`, px/rem hay màu hex; không đổi thành phần chung.

## Triển khai (khi chủ cho phép)

2 migration, rồi `pnpm db:permissions:sync` (thêm 2 hàng quyền); khởi động lại API và web; worker không đổi. Không ai có quyền mới cho đến khi chủ cấp. Quay lại bản cũ: API và web cũ vẫn chạy trên cơ sở dữ liệu mới (migration chỉ thêm), hai quyền và 8 bảng không ảnh hưởng chỗ khác.
