# Kịch bản Owner thử Phase 9 trên máy thật (nhập sản phẩm từ Haruohui)

Làm **sau khi** Claude báo triển khai xong (`docs/DEPLOY_PHASE9_P9_7_TO_P9_9B.md`, bản `ac74013`). Mất khoảng 45 phút (chờ quét toàn bộ 6 đến 20 phút). Đăng nhập tài khoản Owner. **Lần đầu chỉ đăng 3 đến 5 sản phẩm** để xem; sản phẩm đã đăng hiện ở trang **Mỹ phẩm** của khách (nút "Mua tại cửa hàng"), dù "Bán online" vẫn tắt. Gần như mọi sản phẩm Haruohui đang giảm giá, nên các sản phẩm đăng sẽ có **khuyến mãi** giống Haruohui (không có đếm ngược, vì Haruohui không cho ngày kết thúc). Gặp điều gì lạ: dừng, chụp màn hình, gửi Claude.

## Phần 1. Đi từng bước (an toàn, mỗi bước có người xem)

Nếu nguồn Haruohui đã có từ lần thử trước, bỏ qua bước 1 và 2.

1. **Danh mục → Nguồn nhà cung cấp → Thêm nguồn.** Nhà cung cấp "Haru Ohui", tên nguồn "Website haruohui.com", loại **Website**, địa chỉ `https://haruohui.com/`. _Mong đợi:_ nguồn mới ở trạng thái "Đang tắt", giấy phép "Chưa ghi".
2. Menu `⋮` của dòng → **Giấy phép.** Điền người cho phép, cách cho phép (ví dụ tin nhắn Zalo), ngày; tích **Chữ** và **Ảnh sản phẩm** (giá: tùy chủ). **Ghi giấy phép**, rồi `⋮` → **Xác nhận giấy phép.** _Mong đợi:_ "Đã xác nhận".
3. `⋮` → **Chạy thử.** Đợi "Đạt", xem 20 sản phẩm mẫu, bấm **Xác nhận mẫu.** Rồi `⋮` → **Bật nguồn.** _Mong đợi:_ "Mẫu đã xác nhận", "Đang bật".
4. `⋮` → **Quét mẫu.** Đợi "Quét xong". _Mong đợi:_ 20 sản phẩm đã đọc, vào **Sản phẩm nhập → Chờ duyệt** (mỗi sản phẩm một dòng, không trùng).
5. Mở vài sản phẩm bằng **Xem và duyệt**, chọn thương hiệu và nhóm nếu còn thiếu, bấm **Duyệt.** _Mong đợi:_ thành sản phẩm **nháp**, chưa có giá, chưa hiện cho khách.
6. **Danh mục → Sản phẩm:** mở sản phẩm nháp, **Đặt giá niêm yết**, rồi **Đăng bán** một sản phẩm. _Mong đợi:_ sản phẩm hiện ở trang Mỹ phẩm của khách.
7. Về **Nguồn nhà cung cấp → Quét mẫu** lần nữa. _Mong đợi:_ không có sản phẩm trùng; **Sản phẩm nhập → Thay đổi** chỉ hiện nếu nguồn thật sự có đổi.

## Phần 2. Một lần bấm (bản mới)

8. `⋮` → **Quét toàn bộ.** Đợi xong (6 đến 20 phút; có thể đóng ngăn và làm việc khác). _Mong đợi:_ khoảng 352 sản phẩm; ghi chú "xong, có việc cần xem" là bình thường.
9. **Sản phẩm nhập → Nhập và đăng tất cả.** Trang liệt kê từng sản phẩm với ô tích (ảnh, tên, SKU, thương hiệu, nhóm, giá). Bấm **Bỏ chọn tất cả**, rồi tích **3 đến 5 sản phẩm** bằng ô tích hoặc ô tìm. Xem dòng "Thương hiệu mới sẽ được tạo" và các nhóm. Bấm **Nhập và đăng 5 sản phẩm.**
   _Mong đợi:_ cột Giá bán hiện **giá giảm và giá gốc gạch ngang** (ví dụ 580.000 và 750.000), SKU dạng chữ đã thành `HARU-<mã>`, nhóm "Thực phẩm chức năng" có riêng. Sau khi bấm: thanh tiến độ, "Đã nhập và đăng 5 sản phẩm". Chỉ vài sản phẩm không nhập được (trùng, không có giá) nằm ở bảng "chưa nhập được" với lý do.
10. **Kiểm tra:** Sản phẩm → 5 sản phẩm vừa đăng có thương hiệu, nhóm đúng, **giá niêm yết = giá gốc của Haruohui**, tròn nghìn đồng, kèm một khuyến mãi bằng giá giảm của Haruohui. Mở trang khách của một sản phẩm (**Mỹ phẩm**): giá gốc gạch ngang và "-N%" màu đỏ thương hiệu, giá giảm to và đậm, dòng "Tiết kiệm ...", **không có đếm ngược**, không huy hiệu trên ảnh; sản phẩm không giảm giá chỉ có một giá. Thử **kết thúc khuyến mãi** một sản phẩm ở màn Sản phẩm (giá về giá gốc); sửa giá một sản phẩm thử (phiên bản giá mới, giá cũ vẫn lưu); ẩn một sản phẩm bằng trạng thái **ngừng bán** và xem nó biến mất khỏi trang khách.
11. **Quét toàn bộ lần hai**, rồi mở lại **Nhập và đăng tất cả.** _Mong đợi:_ 5 sản phẩm đã đăng **không** hiện lại; sản phẩm bạn bỏ tích **không** được đề xuất lại (trừ khi nội dung ở nguồn đổi).

## Phần 3. Giá và ảnh hàng loạt (tùy chọn, 10 phút)

12. **Nhập dữ liệu → Tải tệp lên**, chọn **Cập nhật giá bán hàng loạt**, tải **Bảng giá Excel**, sửa vài giá, tải lên: bản xem trước hiện giá hiện tại và giá trong tệp, **chưa ghi gì**; bấm xác nhận mới đổi. Ảnh: **Nhập ảnh từ ZIP** với tệp tên theo SKU (`SKU-1.jpg`).

## Điều không làm trong buổi thử

Không đặt "Lịch kiểm tra" khác **Chạy tay** (quét theo lịch vẫn tắt cho tới khi Owner quyết). Không bật "Bán online". Các quyết định của chủ về giá, SKU và nhóm nằm ở `docs/PHASE9_PRODUCT_IMPORT.md` mục 18 và `docs/PHASE9_P9_9B_ONE_CLICK.md`; các điều của P9-8 (giá hàng loạt, ảnh ZIP) cũng đã được duyệt, và cả hai vẫn luôn đòi bạn xem trước rồi xác nhận.
