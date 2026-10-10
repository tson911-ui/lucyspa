# Rà soát toàn bộ và chỉnh giao diện lần cuối: danh sách kiểm (chủ chốt thứ tự 2026-10-10)

Thứ tự công việc còn lại do chủ đặt: **Phase 9 → Phase 7 → Phase 8 → giai đoạn "Claude integration" (chủ thêm 2026-10-10, ngay sau Phase 8)**, rồi bước rà soát (tài liệu này) và Phase 10. **Chỗ đứng của bước rà soát sau giai đoạn Claude integration là cách hiểu của em, chờ chủ xác nhận** (lời chủ chỉ nói Claude integration đứng sau Phase 8). Bước rà soát chỉ đổi giao diện và sửa lỗi; không thêm tính năng, không đổi quy tắc nghiệp vụ. Mỗi mục phải qua cổng chất lượng của `CLAUDE.md` (ảnh chụp 360 / 768 / 1440 px sáng và 1440 px tối, chữ 130%, đủ trạng thái, kiểm DOM so với mốc) trước khi báo xong.

Danh sách này đầy đủ (chủ xác nhận 2026-10-10): các việc ở trang chủ khách chỉ gồm bốn mục ở phần B.

## A. Cân đối chung của giao diện

- [ ] Duyệt lần lượt mọi màn hình khách, quầy và quản trị: cân đối khoảng trắng, căn lề, nhịp dọc, độ lớn chữ giữa các trang cùng loại.
- [ ] Một thương hiệu thống nhất: trang khách, quản trị, quầy và đăng nhập nhân viên cùng một cảm giác (hướng C), không trang nào lệch.
- [ ] Ba ngoại lệ rê chuột trên nền đỏ (`docs/CUSTOMER_SITE_C.md`): chốt với chủ rồi áp dụng nhất quán.
- [ ] Quyết định của chủ đã ghi từ trước và còn treo (không phải mục mới): bố cục đầu trang chủ (giữ vòng tròn ảnh hay dùng khung trượt), vị trí ruy-băng ưu đãi, hai khung ảnh nhỏ ("làm nail", "gội đầu") chưa có chỗ chọn ảnh trong Quản trị, và chiến dịch trên ảnh đầu trang và popup (chủ đã đồng ý đưa vào bước này, 2026-10-09).
- [ ] Sáng và tối, 360 / 768 / 1440 px, chữ 130%: không cuộn ngang trang, không chữ chồng nhau, không dịch bố cục.
- [ ] Mọi màn hình đủ trạng thái: đang tải, trống, lỗi, thành công, bị khóa, chữ dài, nhiều mục, không có ảnh.

## B. Trang chủ khách (chỉnh theo lời chủ)

- [ ] Tiêu đề lớn ở đầu trang chủ đang quá to: thu nhỏ cho cân với ảnh và các chip bên dưới.
- [ ] Thanh đầu trang (header) đổi sang phong cách C cho đồng bộ với phần còn lại của trang.
- [ ] Chú thích ảnh bị vòng tròn nhỏ che mất chữ: dời hoặc đổi cách đặt để chữ luôn đọc được.
- [ ] Ảnh thật thay cho các khung giữ chỗ (xem mục H, 11 ảnh).

## C. Màn hình nhân viên và quầy

- [ ] Ô chọn (checkbox) 20 px quá nhỏ trên điện thoại: bốn biểu mẫu còn giữ cỡ này phải lên cỡ chạm 44 px (cả vùng bấm).
- [ ] Bảng rộng vẫn phải cuộn ngang trong khung ở 768 và 1024 px: tìm cách gọn cột hoặc đổi cách hiển thị để không cần cuộn ngang.
- [ ] Quầy (POS): bảng hóa đơn, thanh toán, nhận khách; nút bấm đủ lớn, thao tác nhanh bằng một tay.
- [ ] Mọi mục tiêu chạm đạt 44 px (40 px trên máy tính), mọi ô nhập có nhãn, vòng focus nhìn thấy được, dùng được bằng bàn phím.

## D. Kiểm thử lại toàn bộ luồng (đi thật qua giao diện)

Mỗi luồng chạy từ đầu đến cuối trên cơ sở dữ liệu thử, ghi kết quả vào báo cáo:

- [ ] **Nhân viên:** đăng nhập, quên mật khẩu, quyền theo chi nhánh, lịch làm việc, nghỉ phép, thu nhập của tôi, thông báo.
- [ ] **Quầy:** đặt lịch, khách vãng lai, nhận khách, bắt đầu và kết thúc lượt làm dịch vụ, tạo hóa đơn, thu tiền (tiền mặt, chuyển khoản, thẻ khi đã bật), hủy, đổi nhân viên.
- [ ] **Trang khách:** xem dịch vụ, đặt lịch, đăng ký và đăng nhập, tài khoản, điểm thưởng, gói combo, giỏ hàng, phiếu hẹn nhận hàng, trang lỗi 404.
- [ ] **Bán mỹ phẩm tại quầy:** chọn sản phẩm, giá và khuyến mãi, tồn kho giảm đúng, người bán được ghi nhận.
- [ ] **Trả hàng, hoàn tiền, đổi hàng:** cửa sổ trả hàng, ngoại lệ chỉ chủ cửa hàng (có lý do), mật khẩu xác nhận một lần cho mỗi lần hoàn, điểm Lucy Beauty hoàn đúng.
- [ ] **Đặt trước (pre-order) và phiếu hẹn nhận hàng:** tạo, nhận hàng, hủy, quá hạn.
- [ ] **Bán online:** đặt hàng của thành viên, thanh toán PayOS (thành công, hủy, quá hạn, tiền về sau khi đơn đã hủy), giao hàng, giao thất bại, trả hàng, hoàn tiền.
- [ ] Công tắc "Bán online" đang TẮT: xác nhận trang khách không lộ gì, rồi mới bật khi chủ cho phép.
- [ ] Phase 7 (lương, hoa hồng, két, chốt ngày) và Phase 8 (báo cáo, xuất file, nhật ký): kiểm lại khi đã xây xong, đối chiếu số liệu với hóa đơn.

## E. Chất lượng tổng thể

- [ ] Chữ tiếng Việt ngắn, tự nhiên, thuật ngữ nhất quán; chỉ dùng "lượt đến" hoặc "lượt làm dịch vụ"; Lucy Spa là spa, không dùng từ ngữ của phòng y tế.
- [ ] Màu, cỡ chữ, khoảng cách chỉ lấy từ token; không màu hex, không ngoại lệ mới; không vàng hay kim tính ngoài trang trí lễ.
- [ ] Bộ đếm `ui-ratchet` chỉ giảm; kiểm DOM không số nào tăng so với mốc `docs/uxui-audit-baseline.json`.
- [ ] Chuyển động nhẹ, tôn trọng chế độ giảm chuyển động.

## F. Quy trình của bước này

- [ ] Làm theo nhóm nhỏ, mỗi nhóm có ảnh trước và sau cho chủ duyệt.
- [ ] Chạy toàn bộ `pnpm check`, `pnpm test:integration`, `pnpm smoke` ở cuối bước, rồi mới sang Phase 10.

## G. Việc phải xong trước khi ra mắt (không phải việc giao diện)

Cần chủ hoặc người quản trị máy chủ làm; Claude chỉ soạn hướng dẫn. Không việc nào chạm máy chủ khi chưa có lệnh của chủ.

- [ ] **Cloudflare:** đặt tên miền qua Cloudflare (DNS, HTTPS, chống tấn công cơ bản), kiểm lại địa chỉ gốc của máy chủ không bị lộ.
- [ ] **Sao lưu tự động ra ngoài máy chủ:** hiện bản sao lưu nằm trong `/root/backups` cùng máy chủ. Cần lịch tự động đẩy bản sao lưu cơ sở dữ liệu và tệp tải lên sang nơi khác, mã hóa, giữ nhiều ngày, và **thử khôi phục** ít nhất một lần.
- [ ] **Kho mã GitHub để riêng tư (private):** kiểm tra cài đặt kho; không có khóa bí mật nào trong lịch sử (nếu có thì đổi khóa).
- [ ] **Gỡ bản mẫu Lovable:** xóa bản mẫu Lovable cũ (không dùng làm tham chiếu nữa) khỏi mọi nơi còn giữ.
- [ ] **Nhập liên kết Zalo và Facebook** trong Quản trị → Website → Thông tin tiệm (chân trang và nút liên hệ chỉ hiện biểu tượng khi có liên kết).
- [ ] Chủ mở "Bán online" sau Phase 9 (bước 9 của `docs/PHASE6_WAVE4_DEPLOY_CHECKLIST.md`: quyền, đơn vị vận chuyển, chi nhánh, chữ chính sách, đơn thật nhỏ đầu tiên).
- [ ] Phiên bán thử có giám sát (OQ-60) khi đã có sản phẩm thật; cấp quyền bán sản phẩm sau đó.

## H. Ảnh thật cần chụp (11 ảnh, danh sách đầy đủ trong `docs/CUSTOMER_SITE_C.md`, mục "Ảnh chủ nên chụp")

1. Toàn cảnh phòng thư giãn hoặc khu gội đầu (ngang, khoảng 2400 x 1600 px): vòng tròn lớn đầu trang chủ.
2. Gội đầu dưỡng sinh, cận cảnh.
3. Làm nail: đôi tay, bộ móng.
4. Chăm sóc da mặt.
5. Massage chân hoặc cổ vai gáy.
6. Kỹ thuật viên: chân dung nhóm, mặc đồng phục.
7. Mặt tiền và biển hiệu, ban ngày và buổi tối.
8. Quầy lễ tân và góc chờ.
9. Chi tiết nhỏ: khăn, nến, hoa, lọ tinh dầu, bàn trà.
10. Sản phẩm mỹ phẩm trên mặt bàn sáng, nền đơn giản.
11. Ảnh bìa chiến dịch (ngang, sáng, ít chữ), mỗi khi mở một chiến dịch.

Chụp bằng ánh sáng tự nhiên, nền gọn, tông ấm; có giấy đồng ý của khách nếu thấy mặt. Hai khung ảnh nhỏ ở đầu trang chủ (nail, gội đầu) cần thêm chỗ chọn ảnh trong Quản trị trước khi thay được.
