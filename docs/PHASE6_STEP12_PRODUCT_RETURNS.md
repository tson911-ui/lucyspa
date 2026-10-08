# P6-12: Hồ sơ trả hàng (báo cáo)

Chỉ làm P6-12, theo thiết kế đã duyệt (Q3-Q5, OQ-22, OQ-40, T23, T35, OQ-79). Không có tiền, kho hay điểm nào thay đổi. Chưa đẩy lên, chưa triển khai. Các chỗ phải tự hiểu (R1 đến R12) nằm ở mục 2.24 của `PHASE6_PRODUCTS_INVENTORY_DESIGN.md`, **chờ Chủ**.

## Đã làm

- **Hồ sơ** cho từng dòng sản phẩm của hóa đơn đã thanh toán, bán tại quầy: lý do (khách đổi ý / giao nhầm hoặc hỏng do đóng gói / kích ứng da), cách khách muốn (đổi hoặc hoàn), số lượng, niêm phong, ghi chú, trạng thái (đang xử lý, chấp nhận, từ chối, hủy), người mở và người xử lý. Không xóa, không sửa lịch sử: ghi chú, ảnh, quyết định đều là sự kiện nối thêm; cơ sở dữ liệu chặn sửa và xóa.
- **Kiểm điều kiện:** đổi ý trong 168 giờ kể từ lúc giao và hàng còn nguyên niêm phong; giao nhầm/hỏng trong 48 giờ, chấp nhận chỉ khi có ảnh chụp trong hạn; kích ứng da không có hạn, chỉ ghi lời khách và ảnh, **không chẩn đoán**, do người giữ `REFUND_PRODUCTS` quyết. Quá hạn thì từ chối, không ai được ngoại lệ (kể cả Chủ). Tổng số lượng các hồ sơ đang mở hoặc đã chấp nhận không vượt số đã bán (khóa dòng hóa đơn và trigger).
- **Ảnh bằng chứng riêng tư:** lưu ở thư mục `returns` bên trong thư mục ảnh hiện có (không thêm cấu hình), không vào thư viện ảnh website, chỉ phát qua API sau khi kiểm quyền (`no-store`), không bao giờ phát bản gốc, ảnh phát ra đã bỏ EXIF/GPS. Xóa ảnh chỉ do Chủ, kèm lời khách yêu cầu: tệp bị xóa thật, hồ sơ giữ dòng ghi lại (ai, lúc nào, vì sao) và nhật ký (OQ-79).
- **Thông báo (T35):** hồ sơ mới báo cho người giữ `REFUND_PRODUCTS` ở chi nhánh (trừ người mở), chỉ mang mã lý do.
- **Màn hình** (menu "Trả hàng", nhóm Thanh toán): danh sách (20 dòng một trang, lọc, tìm), trang mở hồ sơ (tìm hóa đơn, chọn dòng, lý do đã hết hạn bị khóa kèm giờ hết hạn), trang hồ sơ (thông tin, ảnh, lịch sử, chấp nhận / từ chối / hủy / ghi chú / thêm ảnh / xóa ảnh).
- **Quyền:** không thêm quyền, không cấp cho ai (vẫn 65). `MANAGE_PRODUCT_RETURNS` vẫn không gán cho ai.

## Migration

`20261111000000_phase6_wave3_product_returns` (81 migration): 3 bảng mới, 4 kiểu, 1 dãy số mã `TH000001`, trigger bảo vệ, và nới 2 ràng buộc CHECK của `notifications` (thêm một loại, một thực thể). Không đụng bảng hóa đơn, thanh toán, kho, điểm. Có bài kiểm tĩnh `phase6-wave3-returns-isolation.test`.

## Kiểm thử

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`: sạch. `pnpm test` cả repo: database 34, server 53, worker 24 (1 bỏ qua có từ trước), ui 467, web 672, api 321 (+100 bài tích hợp tự bỏ qua khi không bật), 0 lỗi.
- Mới: 5 bài luật cửa sổ, 1 bài HTTP (chặn trường lạ, ảnh không cache, không có bản gốc), 1 bài kiểm tĩnh migration, 26 bài tích hợp PostgreSQL thật (kể cả mốc 167h59/168h01 và 47h59/48h01, quyền theo chi nhánh, ảnh riêng tư, xóa ảnh, ranh giới cơ sở dữ liệu), 7 bài tranh chấp thật (hai người cùng trả quá số lượng, cùng yêu cầu gửi hai lần, mở hồ sơ trùng người nhận thông báo, chấp nhận và từ chối cùng lúc, mở hồ sơ lúc đảo thanh toán, ảnh và hủy, Chủ xóa ảnh lúc chấp nhận), 12 bài logic web, 19 bài hiển thị, 2 bài thông báo.
- Tích hợp trên CSDL dựng lại từ đầu: API 770 (769 đạt, 1 bỏ qua cũ), database 123 + 18, 0 lỗi.

Test cũ chỉ sửa theo hướng thêm (R12): danh sách loại thông báo và số loại OPERATIONS; Chủ thấy thêm một mục menu ở hai test điều hướng. Kiểm đột biến: bỏ khóa người nhận thông báo thì test tranh chấp báo `CONFLICT` (khóa chết), nên test thật sự bắt lỗi này.

## UX gate (đã mở từng ảnh để xem)

- Ảnh ở `.local/uxui-screens/p612-*`: danh sách (mặc định, trang 2, lọc, rỗng, chữ 130%), trang mở hồ sơ (ban đầu, đã tìm, sẵn sàng, hóa đơn cũ hơn 48 giờ, cũ hơn 7 ngày, tên dài, lỗi, không tìm thấy), trang hồ sơ ở mọi trạng thái, các hộp thoại (chấp nhận, từ chối, ghi chú, xem ảnh, xóa ảnh), ở 360, 768, 1440 sáng và 1440 tối.
- Đã sửa sau khi xem: bảng tràn ngang ở 1440 (bớt cột), tiêu đề lặp "Trả hàng", vùng thả ảnh trống và bị DOM audit báo lỗi (đổi thành nút "Thêm ảnh" ở đầu thẻ), lịch sử dạng danh sách số, tên người tải bị cắt.
- DOM audit (CSDL `lucy_spa_uxaudit_20261001`, 26 trang gốc + 3 trang mới): 3 trang mới 0 phát hiện, không loại nào tăng so với baseline.
- Chưa sửa được: ở chữ 130% và màn 360 px thanh trên cùng của khu quản trị tràn ngang 392 > 360 (đã ghi ở `docs/UI_BACKLOG.md`, lỗi chung của khung). Ô chọn tròn/vuông của kit là 20 px nhưng cả dòng nhãn là vùng bấm.

## Chủ đã duyệt (2026-10-08) và một thay đổi: ngoại lệ quá hạn của Chủ

Chủ duyệt R1 đến R12; **thay đổi ở R3**: chỉ Chủ được duyệt hồ sơ quá hạn như một ngoại lệ, bắt buộc có lý do bằng chữ, ghi vào lịch sử hồ sơ và nhật ký (nguyên văn ở mục 2.25 của tài liệu thiết kế). Đã làm:

- Chủ mở hồ sơ quá hạn kèm `windowExceptionReason`; nhân viên (kể cả người giữ cả hai quyền) vẫn bị từ chối, Chủ không có lý do cũng bị từ chối, lý do để trống hoặc gửi khi chưa quá hạn bị từ chối (hồ sơ không ghi "ngoại lệ" khi không phải ngoại lệ).
- Ghi ở ba chỗ: cột trên hồ sơ (ai, lúc nào, lý do), sự kiện lịch sử `WINDOW_EXCEPTION`, dòng nhật ký `PRODUCT_RETURN_WINDOW_EXCEPTION`. Hạn không đổi (`window_ends_at` vẫn là 168 giờ hoặc 48 giờ).
- Cơ sở dữ liệu giữ chốt: người mở phải là tài khoản kiểu `OWNER`, hạn thực sự đã qua, lý do không trống, và có dòng lịch sử đi kèm khi commit. Migration `20261112000000` (chỉ thêm giá trị enum) và `20261112000001`; `20261111000000` không đụng tới.
- Hồ sơ "giao nhầm hoặc hỏng" theo ngoại lệ chấp nhận với bất kỳ ảnh nào còn trên hồ sơ. Màn hình: Chủ chọn được lý do quá hạn và phải nhập "Lý do ngoại lệ"; nhân viên thấy lý do bị khóa như cũ; trang hồ sơ hiện ngoại lệ.
- Kiểm thử mới: 5 bài PostgreSQL thật, 1 bài luật ảnh, 1 bài HTTP, 7 bài web, 5 bài kiểm tĩnh migration. Các bài tích hợp P6-12 trước chạy lẻ, nay đã nằm trong `scripts/test-auth-integration.mjs`.

## Câu hỏi mở

Cách hiểu E1 đến E6 (mục 2.25) chờ Chủ xác nhận, nhất là E1 (Chủ tự mở hồ sơ quá hạn, không có bước "nhân viên mở, Chủ duyệt sau") và E5 (ảnh nào cũng được).
