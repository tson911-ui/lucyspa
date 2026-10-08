# Phase 6 Đợt 3b: kiểm tra mốc (2026-10-09, chạy trên máy này)

**Phạm vi Đợt 3b:** P6-15 (cơ sở dữ liệu đơn đặt trước, giữ hàng cho đơn, quyền `MANAGE_PRODUCT_ORDERS`), P6-16 (bán đặt trước tại quầy, phiếu hẹn nhận hàng cho khách có tài khoản và liên kết bí mật + mã QR cho khách vãng lai), P6-17 (trang "Hàng đặt trước": cần đặt theo nhà cung cấp, đã đặt, hàng về, giao hàng có đối chiếu mã đơn và 4 số cuối, hủy và hoàn tiền, sửa mã chuyển khoản, nhắc 08:00), P6-18 (quà tặng sản phẩm trừ kho). **6 migration (89 thành 95), 1 quyền mới (65 thành 66), chưa gán cho ai.** Mọi migration chỉ thêm hoặc nới, không ghi lại dòng cũ; thay thân **8 hàm đang chạy** (kiểm tra hóa đơn, dòng sản phẩm của hóa đơn, giữ hàng, phát sinh kho, hồ sơ trả hàng, hoàn tiền, đảo thanh toán khi đã hoàn, danh mục quà); 5 bảng, 10 hàm, 21 trigger và 4 kiểu enum mới (đo bằng so cơ sở dữ liệu 89 và 95 migration: bảng 137 thành 142, hàm 343 thành 353, trigger 335 thành 356, enum 78 thành 82). **Chưa có gì được đẩy lên hay triển khai.** Các cách hiểu kỹ thuật P15-1 đến P18-5 (`PHASE6_PRODUCTS_INVENTORY_DESIGN.md` mục 2.30 đến 2.33) và bốn câu hỏi mở **chờ Chủ xem lại**; Chủ đã dặn ghi lại và làm tiếp, không tự đặt chính sách tiền.

## Kết quả kiểm tra (mã nguồn tại commit mốc, cơ sở dữ liệu thử dựng từ số 0 bằng 95 migration)

| Việc                                                  | Kết quả                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`    | sạch                                                                                                                                                                                               |
| `pnpm test` (cả repo)                                 | database 91, server 53, worker 24 (+1 bỏ qua), ui 467, web 747, api 338 (+110 bài cần cơ sở dữ liệu, chạy ở dòng dưới); **không lỗi**                                                              |
| `pnpm build` (có `API_UPSTREAM_ORIGIN`), `pnpm smoke` | đạt                                                                                                                                                                                                |
| Kiểm thử tích hợp cơ sở dữ liệu                       | **135 đạt và 23 bài tranh chấp đạt**, 0 lỗi                                                                                                                                                        |
| Kiểm thử tích hợp API (kể cả tranh chấp)              | **886 bài: 883 đạt, 2 lỗi, 1 bỏ qua** trong lần chạy đầu; hai lỗi là **một** bài (số quyền gán được trong danh mục vai trò, cũ 62, nay 63 vì có quyền mới); đã sửa con số và chạy lại bộ đó: 9 đạt |

**Bài của Đợt 3b (đều đạt):** `order.integration` (bán đặt trước, ngày dự kiến, hủy hóa đơn chưa trả, phiếu hẹn, hóa đơn của khách), `order.commands.integration` (13 bài: hàng đợi, nhóm theo nhà cung cấp, đã đặt, hàng về, cấp hàng, giao hàng có đối chiếu, hủy và hoàn tiền theo từng trạng thái, trễ hẹn quá 7 ngày, chuyển khoản và sửa mã, trả hàng sau khi giao), `order.race.integration` (**6 bài tranh chấp trên kết nối thật**: đã đặt tranh với đảo thanh toán, phiếu nhập tranh với bán lẻ, hủy tranh với hàng mới về, hủy hai lần, hai lần cấp hàng, quét hằng ngày hai lần), cơ sở dữ liệu `phase6-wave3b-orders.integration` và `-races` (đơn, giữ hàng, ba tranh chấp của P6-15), `reward-gift.integration` (8 bài) và `reward-gift.race.integration` (**3 bài tranh chấp**: hai lượt dùng đơn vị cuối, quà với bán lẻ, hai lần hoàn lại), bốn bài tĩnh về migration. **Đối chiếu sau từng bước** (`reconcileAll`): mỗi dòng đơn khớp trạng thái với hóa đơn, giữ hàng (nguồn `ORDER_LINE`), phát sinh kho bán và lịch sử; tồn bằng tổng phát sinh bằng tổng lô; số giữ không vượt tồn; mỗi lượt dùng quà đã trừ đúng một đơn vị và đã hoàn đúng một lần nếu được hoàn lại.

## Diễn tập trên bản khôi phục (Chủ yêu cầu)

**Giới hạn thật thà:** máy này **không có `pg_dump` của cơ sở dữ liệu thật**. Tôi dựng bản giống thật: chạy mã đang chạy thật `2076cc5` với đúng 89 migration và 65 quyền, thêm 300.000 thông báo và 20.000 hóa đơn đã thanh toán (kèm dòng, thanh toán; 234 MB), rồi làm **đúng các lệnh của hướng dẫn**: `pg_dump -Fc` (6 giây, 45 MB), `pg_restore` vào cơ sở dữ liệu tạm (11 giây, thoát 0), `db:status` (đúng 6 migration chờ), `db:deploy` (3 giây), `db:permissions:sync` ("1 inserted, 65 already present").

- **Thời gian từng migration (giây):** `…16000000` 0,039; `…16000001` 0,085; `…17000000` 0,024; `…18000000` 0,235 (kiểm lại thông báo và hoàn tiền); `…19000000` 0,016; `…19000001` 0,029. **Cả 6 khoảng 0,43 giây.** Sau đó: 95 migration, 66 quyền, 300.000 thông báo, 20.000 hóa đơn nguyên vẹn.
- Các câu lệnh kiểm của hướng dẫn (Bước 5, 7, 9, cổng kiểm Bước 10) đã chạy **đúng nguyên văn** trên bản diễn tập: `95|66|0|0|0|0|0|0|0|0|0`, hai số việc tồn `0`, `0|0`, cổng `0|0|0|0|0|0|0|0|0`; trên bản có dữ liệu 3b cổng cho `25|10|2|0|6|37|1|8|2` (chặn đúng).
- **Bước 4 của hướng dẫn cho Chủ làm đúng việc này trên bản sao lưu THẬT trước khi áp thật**; kết quả thật của Chủ thay cho số trên.

## Quay lại bản cũ (đã thử thật, xem `PHASE6_WAVE3B_ROLLBACK_PROOF.md`)

- Bản cũ `2076cc5` chạy được trên cơ sở dữ liệu 95 migration **khi chưa có dữ liệu 3b và đã xóa dòng quyền mới (bước A1)**: bộ cơ sở dữ liệu cũ 123 và 18 bài tranh chấp đạt; bộ API cũ: **877 bài: 874 đạt, 2 lỗi, 1 bỏ qua**; hai lỗi là **một** bài về cửa sổ thời gian của popup (bài phụ thuộc giờ chạy, tôi chạy riêng lại ngay trên cùng cơ sở dữ liệu: 10 đạt, 0 lỗi), không liên quan Đợt 3b.
- **Có dữ liệu 3b thì bản cũ hỏng một phần:** máy khách Prisma cũ không đọc nổi bảng quyền (còn dòng quyền mới) và bảng giữ hàng (hàng giữ cho đơn). Vì vậy hướng dẫn có **cổng kiểm 9 số** (phải bằng 0 mới được quay lại phần mềm), bước xóa dòng quyền, bước chờ hai bộ xử lý nền về 0.

## UI gate

- Màn hình đã dựng và **mở từng ảnh** ở 360, 768, 1440 sáng và 1440 tối (đã sửa sau khi xem; xem từng báo cáo bước): P6-16 (`p616-*`: hóa đơn có đơn đặt trước, hộp thoại thêm sản phẩm và chốt hóa đơn, liên kết + QR, phiếu công khai), P6-17 (`p617-*`: năm nhóm của hàng đợi, trang một đơn ở mọi trạng thái, bốn hộp thoại, ngăn sửa biến thể có nhà cung cấp quen thuộc), P6-18 (`p618-*`: danh mục quà và ngăn sửa quà có ô sản phẩm trừ kho). DOM audit: **không bộ đếm nào tăng so với `docs/uxui-audit-baseline.json`**; ba trang mới của P6-17 có 1 phát hiện cũ về chiều cao hàng thẻ ở 360.
- Chữ 130%: tràn ngang 32 px **có sẵn ở mọi trang quản trị** (cả Trả hàng), do thanh trên cùng, không do đợt này.

## Chưa làm được / Chủ cần biết

- Chưa thử trên máy chủ thật: pm2, web Next cũ khi quay lại, bản Linux, nginx (đợt này **không** thêm thư mục hay cấu hình nginx; trang phiếu công khai cần nginx gửi `X-Forwarded-For`, đã yêu cầu từ Đợt 1).
- **Chưa làm (cần Chủ quyết, không tự đặt):** email báo hàng về (hệ thống chưa có chỗ gửi email giao dịch); liên kết phiếu có hết hạn không; hoàn đủ hay trừ phí khi khách đổi ý sau khi đã đặt hàng; cho phép "người dùng hệ thống" cấp hàng chạy ngầm; đổi hàng sang hàng đặt trước.
- Hướng dẫn deploy từng khối lệnh cho terminal web iNET: `docs/PHASE6_WAVE3B_DEPLOY_CHECKLIST.md` (commit `43a1b29`, đã push, CI xanh). Đợt 3b chỉ được deploy khi Chủ tự chạy hướng dẫn.
