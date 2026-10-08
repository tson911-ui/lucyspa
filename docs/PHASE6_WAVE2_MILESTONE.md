# Phase 6 Đợt 2: kiểm tra mốc (2026-10-08, chạy trên máy này)

> **Cập nhật:** Đợt 2 đã được Chủ deploy lên máy chủ thật ngày 2026-10-08 khoảng 12:02 (UTC+7), commit `135872558838e00436fa5ce829e70f0517d7be68`. Diễn tập trên bản khôi phục của dữ liệu thật: 7 migration tổng khoảng 0,31 giây (lớn nhất 0,126 giây, `pricing_v3`; máy thử ước 0,4 giây). Sau deploy: 80 migration, 65 quyền, 0 dữ liệu bán sản phẩm, `SELL_PRODUCTS` không gán cho ai. Chi tiết ở `LUCYSPA_HANDOFF.md` và `PHASE6_WAVE2_DEPLOY_CHECKLIST.md`. Phần dưới là bản ghi tại lúc kiểm tra mốc, trước khi push và deploy.

**Phạm vi Đợt 2:** P6-8 đến P6-11 (bán sản phẩm tại quầy, giá bản 3 cho hai bên Spa và Beauty, trừ kho sau thanh toán, điểm Lucy Beauty, màn hình phạm vi giảm giá). **7 migration (73 thành 80), 0 quyền mới (vẫn 65).** Khác Đợt 1: Đợt 2 sửa các bảng đang thu tiền thật (hóa đơn, ưu đãi, thông báo, kho); mọi migration chỉ thêm hoặc nới, hóa đơn chỉ có dịch vụ vẫn tính bằng bộ tính cũ. **Chưa có gì được đẩy lên hay triển khai; chưa quyền `SELL_PRODUCTS` nào được gán.**

## Kết quả kiểm tra (mã nguồn tại commit mốc, cơ sở dữ liệu thử dựng từ số 0 bằng 80 migration)

| Việc                                                  | Kết quả                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`    | sạch                                                                                                                                                                                                                                            |
| `pnpm test` (cả repo)                                 | database 29, server 53, worker 24 (+1 bỏ qua), ui 467, web 638, api 314 (+98 cần cơ sở dữ liệu); **không lỗi**                                                                                                                                  |
| `pnpm build` (có `API_UPSTREAM_ORIGIN`), `pnpm smoke` | đạt (web có ngôn ngữ, API/DB/Redis, OpenAPI, BullMQ)                                                                                                                                                                                            |
| Kiểm thử tích hợp cơ sở dữ liệu                       | **123 đạt và 18 bài tranh chấp đạt**, 0 lỗi                                                                                                                                                                                                     |
| Kiểm thử tích hợp API (kể cả tranh chấp)              | **759 bài: 758 đạt, 1 bỏ qua, 0 lỗi.** Lần chạy đầu có 1 bài (`session`, bài đầu tiên) hết thời gian chờ giao dịch vì lúc đó chạy cùng lúc ba tác vụ nặng; chạy riêng đạt 12/12                                                                 |
| Bài mới của P6-11                                     | điểm Beauty 9 bài; 3 bài tranh chấp (hai worker cùng sự kiện, sự kiện thanh toán đua với đảo khoản thu, cộng điểm đua với chỉnh điểm tay); cảnh báo lô hết hạn: 3 bài tích hợp + 1 bài tranh chấp; sổ cái và tồn kho được đối chiếu sau mỗi bài |

**Bằng chứng của kiểm thử tranh chấp:** bỏ riêng phần khóa người nhận cảnh báo ra khỏi mã thì bài tranh chấp mới **báo deadlock** (đã thử, rồi hoàn lại); có phần đó thì đạt. Điểm Beauty: một sự kiện thanh toán chỉ cộng một lần dù hai worker cùng nhận; đua với đảo khoản thu thì hoặc "cộng rồi thu hồi" hoặc "chưa bao giờ cộng", không bao giờ cộng mà không thu hồi; số dư mỗi ví luôn bằng tổng sổ cái.

## Diễn tập trên bản khôi phục (Chủ yêu cầu)

**Giới hạn thật thà:** máy này **không có `pg_dump` của cơ sở dữ liệu thật**. Tôi dựng bản giống thật: chạy mã đang chạy thật `6546c43` với đúng 73 migration và 65 quyền, thêm 300.000 thông báo và 20.000 hóa đơn đã thanh toán (kèm lượt đến, dòng dịch vụ, thanh toán; 233 MB), rồi làm **đúng các lệnh của hướng dẫn**: `pg_dump -Fc` (8 giây, 45 MB), `pg_restore` vào cơ sở dữ liệu tạm (13 giây, thoát 0), `db:status`, `db:deploy`, `db:permissions:sync`.

- **Thời gian từng migration (giây):** `…07000000` 0,014; `…07000001` 0,064 (thêm 2 cột và thay ràng buộc tiền của 20.000 hóa đơn); `…08000000` 0,022; `…08000001` 0,057; `…09000000` 0,008; `…09000001` 0,019; `…10000000` 0,178 (kiểm lại 300.000 thông báo). **Cả 7 khoảng 0,4 giây**; `db:deploy` toàn lệnh 3 giây. Sau đó: 80 migration, 65 quyền, 300.000 thông báo, 20.000 hóa đơn nguyên vẹn (đều là hóa đơn quầy, phí vận chuyển 0).
- **Bước 4 của hướng dẫn cho Chủ làm đúng việc này trên bản sao lưu THẬT trước khi áp thật**; kết quả thật của Chủ thay cho số trên.

## Quay lại bản cũ (đã thử thật, xem `PHASE6_WAVE2_ROLLBACK_PROOF.md`)

- Bản cũ `6546c43` chạy được trên cơ sở dữ liệu 80 migration **khi chưa có dữ liệu Đợt 2**: bộ kiểm thử API cũ 683 đạt (1 lỗi do thiếu biến `REDIS_URL` của lệnh chạy thử, không phải lỗi mã), bộ cơ sở dữ liệu cũ 107 và 18 đạt.
- **Có dữ liệu Đợt 2 thì bản cũ hỏng:** bảng POS, chi tiết hóa đơn có sản phẩm, trang kho có phiếu bán và danh sách hóa đơn của khách trả **503**; worker cũ **cộng điểm Spa** (342 điểm) cho tiền sản phẩm; chương trình giảm giá phạm vi sản phẩm bị bản cũ áp cho dịch vụ. Vì vậy hướng dẫn có **cổng kiểm 5 số** (phải bằng 0 mới được quay lại phần mềm), bước thu hồi quyền bán, bước chờ hai bộ xử lý nền về 0, và nói rõ: **sau lần bán đầu tiên, quay lại phần mềm không còn là lựa chọn**; chỉ còn sửa tiếp hoặc khôi phục sao lưu (mất giao dịch sau lúc sao lưu; thử: 16 giây).
- Đợt 2 không thêm quyền nên **không cần xóa quyền** khi quay lại (khác Đợt 1).

## UI gate

- Màn hình phạm vi giảm giá: dựng ở 360, 768, 1440 sáng, 1440 tối, chữ 130%; DOM audit `discounts` 56 thành 0, `discount-detail` 78 thành 0, trang tạo 0, không số đếm nào tăng; chi tiết ở `PHASE6_STEP11_DISCOUNT_SCOPE_UI.md`. Màn hình bán sản phẩm của P6-10 đã qua gate ở `PHASE6_STEP10_POS_PRODUCTS.md` (`pos` 42 thành 0).
- Thẻ Beauty và thông báo lô hết hạn: xem phần cuối `PHASE6_STEP11_DISCOUNT_SCOPE_UI.md`.
- Còn lại, đã biết: thanh trên cùng của quản trị tràn 32 px ở 360 px với chữ 130% (`UI_BACKLOG`, mọi trang).

## Chưa làm được / Chủ cần biết

- Chưa thử trên máy chủ thật: pm2, web Next cũ khi quay lại, bản Linux. Cổng kiểm và hướng dẫn có bước kiểm cho các điểm này.
- **Chưa có trả hàng và hoàn tiền sản phẩm** (Đợt 3): hóa đơn bán nhầm chỉ sửa bằng đảo khoản thu rồi hủy hóa đơn (OQ-60: bán thử có giám sát trước khi cấp quyền; Chủ hoãn bán thử vì chưa có sản phẩm thật, `SELL_PRODUCTS` không gán cho ai).
- **Đã duyệt (2026-10-08):** OQ-77 (thông báo lô hết hạn ghi SKU, mã hóa đơn, mã lô và mở trang kho) và OQ-78 (ô "Phạm vi" của giảm giá làm trong P6-11). Hai khoảng trống của ô chọn sản phẩm: người chỉ có quyền giảm giá (không có quyền sản phẩm) không chọn được đích sản phẩm; danh sách sản phẩm chưa có tìm kiếm phía máy chủ (ô chọn lọc trong trình duyệt, hiện 30 kết quả đầu).
- Hướng dẫn deploy từng khối lệnh cho terminal web iNET: `docs/PHASE6_WAVE2_DEPLOY_CHECKLIST.md` (mã commit điền sau khi Chủ push và CI xanh). Đợt 2 chỉ được deploy khi Chủ tự chạy hướng dẫn.
