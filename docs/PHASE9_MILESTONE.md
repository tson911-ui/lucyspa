# Phase 9 mốc tổng kết: nhập sản phẩm từ nhà cung cấp (Haruohui)

Trạng thái 2026-10-11: **P9-2 đến P9-6 đã chạy thật (commit `638afde`, 106 migration, 68 quyền). P9-7 đến P9-9b đã xong và đẩy lên `main` (mã chạy `2b064e9`), CHƯA triển khai.** Hướng dẫn triển khai: `docs/DEPLOY_PHASE9_P9_7_TO_P9_9B.md` (106 → **108 migration**, quyền vẫn **68**). Kịch bản Owner thử: `docs/OWNER_TEST_SCRIPT_PHASE9.md`.

## Các bước và commit

| Bước       | Nội dung                                                                                                                                           | Commit                              | Báo cáo                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------- |
| P9-2..P9-6 | nguồn và giấy phép, bộ đọc WooCommerce, quét mẫu và ảnh, đánh giá ứng viên, duyệt thành sản phẩm nháp                                              | `5ee604c`..`638afde` (đã chạy thật) | `PHASE9_P9_2..P9_6`              |
| P9-7       | quét lại, ghi chú thay đổi, chặn "không còn ở nguồn" (3 lần quét khỏe), lần quét đáng ngờ, lịch quét theo nguồn (mặc định chạy tay), thông báo gọn | `d79c312` (+ `7551bee`)             | `PHASE9_P9_7_RESYNC`             |
| P9-8       | xuất và nhập lại giá hàng loạt (xem trước, chỉ người có quyền đặt giá xác nhận), nhập ảnh từ ZIP                                                   | `0dc200d`                           | `PHASE9_P9_8_BULK_PRICES_IMAGES` |
| P9-9       | kiểm tra mẫu 20 sản phẩm thật: quét, quét lại, trùng, ảnh, SKU, phát hiện thay đổi                                                                 | `5054b8a`                           | `PHASE9_P9_9_SAMPLE_VALIDATION`  |
| P9-9b      | theo phản hồi của Owner: "Quét toàn bộ" 352 sản phẩm và "Nhập và đăng tất cả" một lần bấm, ô tích từng sản phẩm                                    | `2b064e9`                           | `PHASE9_P9_9B_ONE_CLICK`         |

**Migration:** 101 → 106 (P9-2..P9-6, đã chạy thật) → `20261129000000_phase9_resync_changes` (107) → `20261130000000_phase9_full_scan` (108). Chỉ thêm, đã diễn tập trên bản sao cơ sở dữ liệu, không lệch so với schema. **Quyền:** 66 → 68 (`MANAGE_SUPPLIER_SOURCES`, `REVIEW_SUPPLIER_IMPORTS`), không thêm ở P9-7..P9-9b.

## Bằng chứng

- Kiểm thử API tích hợp trên PostgreSQL thật cho riêng Phase 9 và nhập dữ liệu: **73/73** ở bản cuối; toàn bộ bộ tích hợp ở P9-7: 1017, 0 lỗi. `pnpm test` cả repo (đơn vị): database 112, server 145, worker 24, UI 489, web 926, API 352, tất cả đạt; `lint`, `typecheck`, `format:check` sạch.
- **Dữ liệu thật:** quét thật 20 sản phẩm rồi quét lại (P9-9) và quét toàn bộ 352 sản phẩm bản sao (5 yêu cầu, 23 giây, chỉ đọc chữ). Phân loại 353 sản phẩm: 19 chưa nhập được (16 SKU dạng chữ, 1 trùng SKU, 1 trùng chưa giải quyết, 2 không có giá). Nhập thử 40 sản phẩm trên bản sao: giá tròn nghìn, không giá vốn, nhật ký đủ.
- Cổng giao diện: ảnh 360, 768, 1440 sáng và 1440 tối thật, chữ 130%, các trạng thái trống và không quyền, đã mở và xem từng ảnh; DOM audit các màn đã đổi: 0 lỗi ở ba màn cũ, 3 ghi chú ở trang mới (chiều cao thẻ lý do, kiểu mặt phẳng chung).

## Chờ Owner quyết (không tự coi là đã duyệt)

- **Hai cách hiểu giữ lại từ trước:** P9-3 số 1 (chạy thử cần ghi và xác nhận giấy phép) và số 3 (ngưỡng đạt 90/50/50, dính tới giá). Bảy cách hiểu còn lại của P9-3..P9-5 Owner đã duyệt 2026-10-11.
- **P9-7:** bảy cách hiểu trong `PHASE9_P9_7_RESYNC` (lịch quét, chặn xóa, thông báo...).
- **P9-8 và P9-9b (giá, đăng bán):** giá khuyến mãi khi thấp hơn giá niêm yết, làm tròn 1.000 đồng; 16 SKU dạng chữ không tự nhập; thực phẩm chức năng vào "Khác"; "đăng" là đang bán (hiện ở trang Mỹ phẩm dù Bán online tắt); quét theo lịch dùng phạm vi toàn bộ sau lần quét toàn bộ đầu; ảnh ZIP cho sản phẩm đang bán cần tích riêng.

## Việc còn lại

Owner chạy hướng dẫn triển khai rồi kịch bản thử; sau đó Claude ghi commit, 2 migration và giờ vào `LUCYSPA_HANDOFF.md`. Chưa làm: bộ đọc cho nguồn dạng tệp (vẫn chưa bật được) và Phase 7, 8 theo lộ trình của Owner.
