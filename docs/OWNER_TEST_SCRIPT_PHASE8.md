# Kịch bản thử của Owner: Phase 8 (báo cáo, xuất tệp, nhật ký, đánh giá)

Khoảng 20 phút, sau khi triển khai (`docs/DEPLOY_PHASE8.md`). Báo cáo **không sửa dữ liệu**: xem thoải mái. Hai việc có để lại dấu: **xuất tệp** (ghi một dòng vào nhật ký) và **đánh giá của khách** (một đánh giá đã gửi **không sửa, không xóa được**; hãy thử bằng tài khoản khách của chính Owner).

## 1. Xem các báo cáo (Owner, 10 phút)

1. Menu **Báo cáo → Doanh thu**: chọn "30 ngày qua". Con số **Doanh thu** = tiền đã thu trừ tiền đã hoàn lại cho khách (không gồm tip). Đối chiếu một ngày với sổ thu ngân của chính bạn: phải khớp. Đơn online chưa giao hiện ở "Đã thu, chưa giao", chưa tính vào doanh thu.
2. **Chi tiết bán hàng:** các thẻ Dịch vụ, Sản phẩm, Combo, Giảm giá, Đơn online; số điện thoại khách hiện **đầy đủ**. **Khách hàng:** lượt đến, lịch hẹn, điểm thưởng, khách chi nhiều. **Hoạt động nhân viên:** chỉ là số liệu, không xếp hạng. **Báo cáo kho:** bán chạy, sắp hết, bán chậm, hạn dùng, giá trị tồn.
3. **Báo cáo quỹ / Báo cáo lương / Lãi tạm tính:** nếu **chưa bắt đầu sổ quỹ**, các trang nói rõ "chưa bắt đầu", không hiện số 0 giả. Lãi tạm tính luôn ghi "không phải báo cáo thuế" và cho biết bao nhiêu phần hàng bán **chưa có giá vốn** (nhập giá vốn để lãi đúng hơn).
4. **Tổng quan:** các ô mới (Doanh thu, Cảnh báo kho, Hoàn tiền hôm nay, Đơn online, Lệch quỹ, Cảnh báo lương). Dùng "Sắp xếp bố cục" để ẩn ô không cần.

## 2. Xuất tệp (Owner, 3 phút)

1. Trang **Doanh thu → Xuất file → Excel**: tệp tải về mở được, số trong tệp **bằng** số trên màn hình. Thử **CSV** và **PDF** (in).
2. Xuất tệp lương hoặc lãi: hệ thống **hỏi lại mật khẩu** (đúng thiết kế).
3. **Quản trị → Nhật ký hoạt động:** thấy dòng "xuất báo cáo" của bạn; bấm **Xem chi tiết** để xem ai, làm gì, lúc nào.

## 3. Phân quyền (Owner, 3 phút)

1. **Quản trị → Vai trò:** gán `EXPORT_REPORTS`, `VIEW_STAFF_REPORTS`, `VIEW_REVIEWS` cho vai trò quản lý. Đăng nhập bằng tài khoản quản lý thử: chỉ thấy báo cáo của **chi nhánh mình**, không thấy Lãi tạm tính, không thấy cột lương nếu thiếu quyền xem lương.
2. Nhân viên thường **không thấy** mục Báo cáo.

## 4. Đánh giá của khách (Owner, 4 phút)

1. Đăng nhập bằng một **tài khoản khách thử** có hóa đơn đã thanh toán: **Hóa đơn** → mở hóa đơn: cuối trang có ô **"Đánh giá của bạn"** (dòng đầu nói rõ: chỉ spa đọc, không đăng công khai, bỏ qua được). Hóa đơn chưa thanh toán **không** có ô này.
2. Bấm **Để sau**: ô biến mất lần này. Mở lại: chọn số sao, viết vài chữ, chấm riêng từng người (hoặc để "Bỏ qua"), **Gửi đánh giá**: hiện "Cảm ơn bạn đã đánh giá". Gửi lần hai: không được.
3. **Báo cáo → Đánh giá của khách:** thấy số đánh giá; dưới **5 đánh giá** hệ thống ghi "Chưa đủ đánh giá" thay vì điểm trung bình. Báo cáo chỉ có số, **không** có lời nhắn của khách; nhân viên được chấm chưa xem được.

## Nếu thấy lạ

Chụp màn hình, ghi giờ, gửi Claude. Không sửa gì bằng tay trong cơ sở dữ liệu.
