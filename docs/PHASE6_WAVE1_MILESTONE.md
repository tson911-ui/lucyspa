# Phase 6 Đợt 1: kiểm tra mốc (2026-10-07, chạy trên máy này)

> **Cập nhật:** Đợt 1 đã được Chủ deploy lên máy chủ thật ngày 2026-10-07 khoảng 23:10 (UTC+7), commit `6546c434595cef5c7ab764d8e5e7cc4b62afe256`. Diễn tập trên bản khôi phục của dữ liệu thật: 10 migration tổng khoảng 0,43 giây (máy thử ước 0,6 giây). Chi tiết ở `LUCYSPA_HANDOFF.md` và `PHASE6_WAVE1_DEPLOY_CHECKLIST.md`. Phần dưới là bản ghi tại lúc kiểm tra mốc, trước khi push và deploy.

**Phạm vi Đợt 1:** P6-2 đến P6-7 (nền cơ sở dữ liệu và quyền, danh mục sản phẩm, "cho đặt trước", kho hàng, nhập Excel/CSV, trang mỹ phẩm công khai, chịu tải). **10 migration (63 thành 73), 11 quyền mới (54 thành 65)**, không đụng POS, hóa đơn, thanh toán, điểm thưởng (test cô lập Đợt 1 ghim điều này).

## Kết quả kiểm tra (cơ sở dữ liệu thử `…p6_4_scratch`, mã nguồn ngay trước commit mốc)

| Việc                                               | Kết quả                                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | sạch (lần đầu `lint` báo 2 lỗi ở file mới `ecosystem.config.cjs`, `load-public.mjs`; đã sửa và chạy lại sạch)                                                                |
| `pnpm test` (cả repo)                              | database 10, server 53, worker 22 (+1 bỏ qua), ui 464, web 614, api 286 (+90 cần cơ sở dữ liệu); **không lỗi**                                                               |
| `pnpm build`                                       | đạt                                                                                                                                                                          |
| `pnpm test:integration`                            | 107 và 18 bài đạt                                                                                                                                                            |
| `pnpm test:auth:integration`                       | **684 đạt, 1 bỏ qua, 0 lỗi**, trong đó **20 file kiểm thử tranh chấp (race)** (đặt lịch, vận hành, POS, giảm giá, thanh toán, PayOS, điểm thưởng, kho, nhập Excel, website…) |
| `pnpm smoke`                                       | đạt (web, API/DB/Redis, OpenAPI, BullMQ)                                                                                                                                     |

Sau lần chạy trên tôi chỉ sửa một lỗi nhỏ trong `public-rate-limit.core.ts` (địa chỉ IPv4 viết dạng `::ffff:a.b.c.d` phải tính như IPv4) kèm test; đã chạy lại `format:check`, `lint`, `typecheck` và `pnpm test` cả repo sau sửa: sạch, api 287 đạt (+90 cần cơ sở dữ liệu), không lỗi.

## UI gate của mốc

- **DOM audit thật** (`uxui-audit-capture.mjs --all`, rồi `--compare docs/uxui-audit-baseline.json`): **không số đếm nào tăng so với mốc chuẩn** (edge-left 4 = 4, unpaged-list 3 = 3, các loại khác giảm); 4 trang chi tiết bị bỏ qua vì cơ sở dữ liệu thử không có dữ liệu để mở. Trang Sản phẩm, Chi tiết sản phẩm, Thêm sản phẩm, Phiếu nhập mới, Kiểm kê, Nhà cung cấp, Nhập dữ liệu: 0 phát hiện. Còn 3 phát hiện đã báo ở P6-4 và P6-5, không mới: Kho hàng và Phiếu nhập `row-height-uneven` ở 360 px (hai chiều cao dòng vì nhãn xuống dòng), chi tiết lần nhập `surface-style-mix` (thông báo cạnh thẻ).
- **Đã mở xem ảnh:** Sản phẩm, Kho hàng, Nhập dữ liệu (quản trị, đăng nhập Chủ, 1440 sáng); trang công khai: danh sách 1440 sáng, chi tiết 768 sáng (3 vị trí cuộn), thành viên đăng nhập thật ở 1024, trang rỗng 360 và 1440 sáng và tối (xem `PHASE6_STEP6_PUBLIC_CATALOG.md`). Các ảnh 360, 768, tối của ba trang quản trị đã chụp, chưa mở lại ở mốc này (đã mở ở P6-3, P6-4, P6-5). **Thấy khi xem:** dòng "Kem dưỡng ẩm ban đêm" hiện biểu tượng ảnh hỏng ở hai bảng, vì tệp ảnh của dòng đó không còn trong thư mục media của máy thử (đường ảnh trả 404): lỗi dữ liệu thử, không phải của mã; nhưng `MediaThumb` chưa có hình thay thế khi ảnh tải lỗi. **Đã sửa sau mốc** theo yêu cầu của Chủ (xem `PHASE6_STEP7_LOAD_READINESS.md`, mục "Ảnh lỗi").

## Diễn tập trên bản khôi phục (Chủ yêu cầu)

**Giới hạn thật thà:** máy này **không có tệp `pg_dump` của cơ sở dữ liệu thật**, nên tôi dựng một bản giống thật: chạy mã `39ad8d1` (bản đang chạy trên máy chủ) với đúng 63 migration và 54 quyền, thêm 300.000 thông báo (bảng duy nhất mà Đợt 1 phải kiểm lại, 208 MB), rồi làm **đúng các lệnh của hướng dẫn**: `pg_dump -Fc` (3 giây, 36 MB), `pg_restore` vào cơ sở dữ liệu tạm (7 giây, mã thoát 0), `db:status`, `db:deploy`, `db:permissions:sync`.

- **Thời gian từng migration (giây):** `…00` 0,022; `…01` 0,013; `…02` 0,069; `…03` 0,067; `…04` 0,236; `…05` 0,006; `…06` 0,013; `…07` 0,038; `…08` 0,128 (kiểm lại 3 ràng buộc của 300.000 thông báo); `…09` 0,017. **Cả 10 dưới 0,6 giây**; `db:deploy` toàn lệnh 2 giây. Sau đó: 73 migration, 65 quyền, 300.000 thông báo.
- **Bước 4 của hướng dẫn cho Chủ làm đúng việc này trên bản sao lưu THẬT trước khi áp thật** (khôi phục vào cơ sở dữ liệu tạm cùng container, đo từng migration, xóa đi); kết quả thật của Chủ thay cho số trên.

## Quay lại bản cũ: phát hiện quan trọng

Chạy **toàn bộ kiểm thử tích hợp API của bản cũ `39ad8d1`** trên cơ sở dữ liệu đã áp 10 migration: **67 bài lỗi** vì bản cũ không đọc được bảng quyền khi có 11 quyền mới (`Value 'MANAGE_PRODUCTS' not found in enum`). **Xóa 11 dòng quyền mới rồi chạy lại: 626 đạt, 1 bỏ qua, 0 lỗi.** Vì vậy hướng dẫn (Bước 9, Cách A) có lệnh xóa 11 quyền trước khi đưa phần mềm về bản cũ, và (Bước 5, 6) **chỉ đồng bộ quyền SAU khi đã khởi động lại** để bản cũ đang chạy không gặp dòng quyền lạ. Chỉ màn Vai trò (gán quyền) đọc bảng này lúc chạy. Đã có phần gán quyền mới cho vai trò thì xóa bị chặn (khóa ngoại): hướng dẫn bảo DỪNG và hỏi.

## Chưa làm được / Chủ cần biết

- Chưa thử trên máy chủ thật: pm2 cluster chỉ thử trên Windows; số đo tải là của máy này (16 nhân), không phải máy chủ 6 nhân; phiên bản Node, pnpm, pm2 và cấu hình nginx trên máy chủ tôi không xem được (hướng dẫn có bước kiểm).
- Giới hạn tần suất chỉ có tác dụng nếu nginx gửi `X-Forwarded-For` (OQ-57; hướng dẫn có lệnh thử).
- **Đã duyệt (2026-10-07):** OQ-54..OQ-57 như đề xuất (`PHASE6_OWNER_DECISIONS_VI.md`). Đợt 1 chỉ được deploy khi Chủ tự chạy hướng dẫn.
- Hướng dẫn deploy từng khối lệnh cho terminal web iNET: `docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md` (mã commit sẽ điền sau khi Chủ push và CI xanh).
