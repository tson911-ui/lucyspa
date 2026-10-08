# P6-13: Hoàn tiền từng dòng sản phẩm (báo cáo)

Làm theo yêu cầu của Chủ (2026-10-08, nguyên văn ở mục 2.26 của `PHASE6_PRODUCTS_INVENTORY_DESIGN.md`). Chưa đẩy lên, chưa triển khai, chưa gán quyền cho ai. Các chỗ phải tự hiểu (P13-1 đến P13-9) **chờ Chủ**.

## Đã làm

- **Phiếu hoàn** (`product_refunds`): một lần hoàn một số lượng của một dòng sản phẩm, thuộc hồ sơ trả hàng đã chấp nhận theo cách "hoàn tiền". Chỉ **tiền mặt** hoặc **chuyển khoản thủ công**; không có đường gọi PayOS; chỉ lưu **mã giao dịch**, không có cột số tài khoản. Không sửa, không xóa (cơ sở dữ liệu chặn). Sửa mã gõ sai bằng một dòng liên kết mới (`product_refund_corrections`).
- **Tiền:** số tiền = phần **khách thực trả** của số lượng hoàn (sau giảm giá), chia theo số lượng với làm tròn cộng dồn: hoàn hết thì cộng lại đúng bằng số khách đã trả. API tính, cơ sở dữ liệu tính lại và từ chối số khác; yêu cầu không mang số tiền. Dòng thành "đã hoàn" khi hoàn đủ số lượng; hóa đơn vẫn "đã thanh toán".
- **Quyền:** `REFUND_PRODUCTS` ở chi nhánh của hóa đơn + xác nhận mật khẩu gần đây (như đảo thanh toán). Voucher và quà sinh nhật dùng trên hóa đơn **không** tự trả lại. Dịch vụ và combo không có đường hoàn tiền (khóa ngoại tới bảng sản phẩm).
- **Điểm Beauty:** `loyalty` xử lý sự kiện `PRODUCT_REFUNDED`, ghi **một dòng trừ liên kết** cho mỗi phiếu (phương án A: điểm còn lại = floor((thực thu − đã hoàn)/1000)); dòng cộng điểm gốc giữ nguyên; hạng theo số dư (có thể tụt: 5.160 Kim cương về 4.400 Bạch kim); ví Spa và điểm giới thiệu không đổi; số dư không đủ thì ghi khoản thiếu vào "Ngoại lệ", không chặn việc hoàn tiền.
- **Kho:** người hoàn chọn "bán lại được" hoặc không (không có mặc định). Bán lại được: nhập lại thành **lô mới** `{mã hồ sơ}-{số thứ tự}`, giữ hạn dùng (và giá vốn, không hiện ra ngoài) của lô đã bán; không bán lại được: kho không đổi. Cơ sở dữ liệu kiểm cuối giao dịch: số nhập lại đúng bằng số hoàn.
- **T22:** hóa đơn đã có hoàn tiền thì không đảo thanh toán, không hủy (API và cơ sở dữ liệu).
- **Màn hình:** trang hồ sơ đã chấp nhận có nút "Hoàn tiền" (một hành động chính), thẻ "Các lần hoàn tiền", biểu mẫu hoàn (hiện số tiền trước khi lưu), "Sửa mã giao dịch" trong menu thẻ.

## Migration

`20261113000000` (hai giá trị enum) và `20261113000001`: 2 bảng, 2 kiểu, 1 dãy số `HT000001`, cột mới ở sổ điểm, chuyển kho và lô, các ràng buộc và trigger bảo vệ (thay thân hàm cũ có kèm `search_path`). Tổng 85 migration. Không đụng bảng thanh toán, hóa đơn, quyền.

## Kiểm thử

- Mới: 22 bài PostgreSQL thật (quyền, mật khẩu, kiểm tra yêu cầu, làm tròn 9.710 + 9.709 + 9.710 = 29.129, hạn mức theo hồ sơ và theo dòng, lặp yêu cầu, kho nhiều lô, điểm phương án A, PRD 28.6, thiếu điểm, khách vãng lai, trước go-live, sai thứ tự, voucher, T22, sửa mã, chốt cơ sở dữ liệu), 6 bài **tranh chấp thật** (hoàn đôi, cùng một yêu cầu gửi hai lần, hoàn từng phần đồng thời, hoàn so với đảo thanh toán, hoàn so với trừ kho, hai worker xử lý điểm), kiểm tra cuối mỗi bước: hoàn ≤ thực thu mỗi dòng, điểm và kho khớp sổ. Bài tranh chấp **tìm ra một lỗi thật** (đọc điểm đã thu hồi trước khi khóa ví) và đã sửa.
- Thêm: 5 bài luật số tiền, 1 bài HTTP, 8 bài kiểm tĩnh migration, 8 bài logic và 7 bài hiển thị ở web. Test POS/thanh toán cũ không sửa; chỉ thêm `can.refunds` vào dữ liệu mẫu của test màn hình P6-12.
- Kết quả: `pnpm format:check`, `pnpm lint`, `pnpm typecheck` sạch. `pnpm test` cả repo: database 47, server 53, worker 24 (1 bỏ qua có từ trước), ui 467, web 693, api 328 (+103 bài tích hợp tự bỏ qua khi không bật), 0 lỗi. Tích hợp trên CSDL dựng lại từ đầu: API 841 (838 đạt, 1 bỏ qua cũ, 2 lỗi là test P6-12 so sánh `can` đúng bằng, đã thêm `refunds`, chạy lại 28/28 đạt), database 123 + 18, 0 lỗi.

## UX gate (đã mở từng ảnh để xem)

- Ảnh `.local/uxui-screens/p613-*`: trang hồ sơ (chưa hoàn, hoàn một phần có chuyển khoản và sửa mã, đã hoàn hết, thiếu điểm), biểu mẫu hoàn (trống, lỗi, chữ 130%), biểu mẫu sửa mã, trang mở hồ sơ của Chủ với ngoại lệ, trang hồ sơ có ngoại lệ; 360, 768, 1440 sáng và 1440 tối.
- Đã sửa sau khi xem: câu "chưa có tiền nào thay đổi" đã lỗi thời, ô nhập số lượng bị trình duyệt chặn bằng thông báo tiếng Anh, khoảng cách các dòng chi tiết lệch 2 px (DOM audit), chữ thường đầu câu.
- DOM audit (CSDL `lucy_spa_uxaudit_20261001`): trang hoàn một phần và đã hoàn hết 0 phát hiện; không loại nào tăng so với baseline. Danh sách trả hàng có 1 phát hiện ở 360 px (độ cao dòng không đều do tên sản phẩm rất dài trong dữ liệu mẫu), màn này không đổi ở bước này.
- Chưa sửa được: ở chữ 130% và 360 px thanh trên cùng của khu quản trị tràn ngang 392 > 360 (đã ghi ở `docs/UI_BACKLOG.md`); ô chọn tròn của kit 20 px nhưng cả dòng nhãn là vùng bấm; thông báo bắt buộc của trình duyệt (như các hộp thoại khác của dự án).

## Câu hỏi mở

Chờ Chủ trả lời P13-1 đến P13-9, nhất là P13-1 (phải có hồ sơ chấp nhận trước khi hoàn), P13-3 (xác nhận mật khẩu theo cửa sổ 5 phút hay đúng một lần cho mỗi phiếu) và P13-7 (chưa làm thông báo hoàn tiền bất thường).
