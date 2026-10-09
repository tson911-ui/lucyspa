# Giao diện trang khách hướng C: báo cáo bước (2026-10-10)

Chủ chọn hướng C "Ấm áp thư giãn" (xem `docs/CUSTOMER_SITE_C.md`). Chỉ đổi giao diện: không migration, không quyền mới, không đổi API, worker hay dữ liệu. Chưa triển khai.

## Đã làm

- Ghi quyết định vào `docs/DESIGN_PREVIEW_HOME.md`, `CLAUDE.md` (mục trang khách: C là phong cách đã duyệt) và `LUCYSPA_HANDOFF.md`.
- Ba tệp CSS mới trong `packages/ui` (`customer-tokens.css`, `customer.css`, `customer-pages.css`), chỉ có hiệu lực trong `.ls-site`; phông Fraunces và Nunito Sans qua `next/font` (`site-fonts.ts`). Khu nhân viên không đổi.
- Trang chủ làm lại (đầu trang hai dòng, ảnh tròn hoặc khung giữ chỗ, chip thông tin, bốn viên sỏi, ruy-băng ưu đãi "Xem ưu đãi" khi Bán online tắt). Mọi trang khách khác theo C: dịch vụ, đặt lịch, mỹ phẩm, chiến dịch, đăng nhập và đăng ký, tài khoản, giỏ hàng, phiếu hẹn, 404 và lỗi, đầu trang, thanh dưới, chân trang, popup, thông báo; lớp ngày lễ chạy bên trên (đã thử Tết).
- Sửa kèm theo: khung thương hiệu đăng nhập và đăng ký (không ô tối sau chữ, không kéo dài); biểu tượng Zalo và Facebook ở chân trang chỉ hiện khi có liên kết (có kiểm thử); chữ gợi ý ảnh đầu trang trong Quản trị nói rõ khung tròn.
- Gỡ `/vi/design-preview/*` (hướng A, B và C xem thử), robots không còn dòng chặn.

## Kiểm thử

- Mới hoặc cập nhật: `customer-tokens.test.ts` (7: hai khối tối giống nhau, độ tương phản AA ở sáng và tối), `tagline.test.ts` (3), `public-pages.test.tsx`, `components-css.test.ts`.
- `pnpm test` toàn repo qua: web 892, UI 486, API 346 (117 bỏ qua vì là kiểm thử tích hợp), database 104, server 53, worker 24 (1 bỏ qua). Typecheck web và UI, `pnpm lint` và `pnpm format:check` sạch.
- Luồng đã chạy bằng trình duyệt (`.local/polish1/flows.mjs`, 7 luồng): tìm dịch vụ, từ dịch vụ sang đặt lịch, mỹ phẩm và chiến dịch, đăng ký (mặt nạ và kiểm tra), đăng nhập và 7 trang tài khoản, **đặt lịch từ đầu đến "Đặt lịch thành công"**, trang 404. Tất cả qua.

## DOM audit

- 26 trang nhân viên: không chỉ số nào tăng (một chỉ số giảm do dữ liệu).
- 30 trang khách so với bản trước (dựng riêng từ commit `35d5a6f`): tổng theo loại không đổi (tràn 93 → 93, cắt chữ 21 → 21); thêm 3 phát hiện cùng loại ở trang chiến dịch 768 px (khoảng cách thẻ sản phẩm do `margin-top: auto`, có sẵn ở các cỡ khác). Công cụ đo cỡ chữ được sửa để đọc thang chữ trong `.ls-site`; khoảng cách đổi sang các bậc 4 px theo bề rộng.

## Cổng UX (ghi chú 5 dòng)

1. Ảnh chụp 360, 768, 1440 px sáng và 1440 px tối của 30 trang, thêm tối ở mọi cỡ: `.local/customer-c/gallery/index.html` (trước và sau).
2. Đã mở xem ảnh "sau" của: trang chủ (4 cỡ, sáng và tối), dịch vụ và chi tiết, mỹ phẩm và chi tiết, chiến dịch, đăng nhập, đăng ký, quên mật khẩu, phiếu hẹn, 404, tài khoản, đặt lịch, lịch hẹn (có, trống, đã hủy), hóa đơn và chi tiết, điểm thưởng, thông báo, đơn hàng và chi tiết, giỏ hàng (có, trống), thanh toán; trạng thái: trống, nhiều mục, chữ dài, chưa có ảnh, đã có ảnh, có slide.
3. Chữ 130% (khách, hội viên) 360 px: không tràn; rê chuột (dòng giá đỏ đặc, chữ trắng); popup; lớp Tết; chân trang có khối của chủ.
4. Mục tiêu chạm 44 px; tiêu điểm rõ; giảm chuyển động tắt vòng thở; tương phản có kiểm thử.
5. Chưa làm được: hai khung ảnh phụ trên trang chủ chưa có chỗ chọn trong Quản trị (cần API và CSDL).

## Cờ kiểm thử 15:00-17:00 UTC (my-income)

- Không tái hiện được lỗi thật. Chạy cả bộ tích hợp (961 test) với đồng hồ giả cho cả PostgreSQL (libfaketime) và Node, bắt đầu 15:20 UTC: mọi test phụ thuộc giờ trong ngày qua, kể cả my-income. 40 test đua (race) rớt, nhưng cũng rớt khi chỉ dời 24 giờ (cùng giờ trong ngày) và qua khi không dời: do đồng hồ giả, không phải do khung giờ.
- `my-income.integration.test.ts` được làm cho **không phụ thuộc giờ chạy**: `now()` của giao dịch bị ghim ở 16:30 UTC của ngày hiện tại (23:30 Việt Nam, 01:30 Tokyo ngày sau), có khẳng định rằng ghim đã có hiệu lực. Chỉ sửa mã kiểm thử; qua 3 lần liên tiếp ở giờ thật. Nếu CI vẫn đỏ trong khung giờ đó, nghi các test đua rất nhạy với máy chạy chậm (lỗi `SERVICE_UNAVAILABLE`); chưa đụng tới.

## Mở (chờ Owner)

- Hai khung ảnh phụ (vòng nhỏ "làm nail", viên thuốc "gội đầu") cần chỗ chọn ảnh trong Quản trị: đổi API và CSDL.
- Ba kiểu rê chuột riêng trên nền đỏ (nút chân trang, nút tròn chân trang, nút ruy-băng) khác luật 4 (đỏ đặc sẽ biến mất trên nền đỏ).
- Dải ưu đãi một dòng trên đầu trang (phương án A đã duyệt 2026-10-09) được thay bằng ruy-băng cuối trang chủ như bản xem thử C; đưa lại dải trên là việc nhỏ.
- CI xanh trên `a907618` (lần chạy 37998033826). Các lần đỏ trước đó: GitHub không liên lạc được Docker Hub ở bước `docker compose up` (cả commit xanh cũ `c674072` cũng đỏ lúc đó), và một lần ở `pnpm smoke` vì thẻ tiêu đề trang chủ (đã sửa, `smoke` qua cục bộ). Lần xanh chạy lúc 23:00 UTC, ngoài khung 15:00-17:00 UTC, nên **không** chứng minh gì về cờ kiểm thử: nên chạy lại một lần trong khung 22:00-24:00 giờ Việt Nam. Bộ tích hợp đầy đủ cũng đã chạy ở đồng hồ thật trên CSDL mới: 961 test, 959 qua, 0 lỗi, 2 bỏ qua.
