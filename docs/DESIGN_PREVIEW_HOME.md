# Trang chủ khách: ba hướng thiết kế để chủ chọn (bản xem thử ẩn)

Yêu cầu của chủ (2026-10-09): trang khách hiện cũ; làm lại cho hiện đại, sang trọng, đơn giản, chuyên nghiệp, theo chuẩn UX/UI của các trang thương hiệu hàng đầu. Bản mẫu Lovable cũ **không còn là tham chiếu**. Quy tắc mới cho riêng trang khách đã ghi ở `CLAUDE.md`, mục "Customer site redesign".

Trạng thái: **ba hướng đã dựng, chỉ xem thử; chưa thay trang chủ thật, chưa push, chưa deploy. Chờ chủ chọn.** Dùng kỹ năng `frontend-design`; mỗi hướng có kế hoạch riêng (màu, chữ, bố cục) và đã soát lại để không rơi vào lối mòn chung (kem và đất nung, đen và xanh chuối, báo giấy, thẻ SaaS giống nhau, nhãn viết hoa rải rác).

## Xem ở đâu

Ba đường dẫn ẩn (không có trong menu, không có trong sơ đồ trang, `noindex`, và `robots.txt` cấm): `/vi/design-preview/a`, `/vi/design-preview/b`, `/vi/design-preview/c` (thêm `/en/...` cho tiếng Anh). Ở góc dưới có nút nhỏ A, B, C để chuyển nhanh; thêm `?bare=1` để ẩn nút. Dữ liệu thật của tiệm: câu giới thiệu, giờ mở cửa, địa chỉ, hotline, bảng giá từng nhóm, chiến dịch đang chạy (ảnh bìa nếu chủ đã chọn trong Thông tin tiệm). Ảnh còn thiếu là **khung giữ chỗ** đã thiết kế sẵn, chờ thay bằng ảnh thật của tiệm (danh sách ảnh ở cuối).

Ảnh chụp (360 và 1440 px, sáng và tối): `.local/uxui-screens/design-a-*.png`, `design-b-*.png`, `design-c-*.png`.

## A. "Biên tập": sang trọng kiểu tạp chí

- **Cảm giác:** yên tĩnh, thưa, chữ lớn như bìa tạp chí; đường kẻ mảnh thay cho khung; nhiều khoảng trắng.
- **Chữ:** tiêu đề Cormorant Garamond (nét thanh mảnh, có chữ nghiêng), nội dung Manrope. Cả hai có đủ dấu tiếng Việt.
- **Màu:** nền xám hồng nhạt `#F5F0ED`, chữ mực `#1C1416`, đỏ rượu `#782B37` chỉ ở dòng thứ hai của tiêu đề, nút chính và khi rê chuột; chế độ tối dùng hồng nhấn có sẵn.
- **Điểm nhấn:** **thực đơn dịch vụ**: tiêu đề cố định bên trái, bên phải từng nhóm là một "trang thực đơn" với tên món, chấm dẫn và giá; cùng khung ảnh hình vòm cao ở đầu trang. Dòng thực đơn rê chuột lên thành đỏ đặc, chữ trắng.
- **Hợp khi:** muốn tiệm trông như một thương hiệu cao cấp, tự tin, ít thông tin cùng lúc.

## B. "Tối giản hiện đại": gọn, sáng, kiểu ô lưới

- **Cảm giác:** sạch, nhanh, tự tin; thanh trên cùng nổi, mờ kính; mọi thông tin cần nhất nằm trong một lưới ô bo tròn lớn.
- **Chữ:** một họ duy nhất, Plus Jakarta Sans (đậm 800 cho tiêu đề, khoảng cách chữ chặt), có đủ dấu tiếng Việt.
- **Màu:** nền trắng ngà `#FAFAF9`, chữ gần đen `#131113`, đỏ `#782B37` chỉ ở nút, ô "Đặt lịch" và biểu tượng; ô giờ mở cửa và các bước dùng nền hồng rất nhạt `#F6ECEE`.
- **Điểm nhấn:** **ô lưới trả lời ba câu của khách**: khi nào mở cửa, ở đâu, đặt lịch thế nào, cạnh một ảnh lớn. Bảng giá là bốn ô nhóm có biểu tượng; "Đặt lịch trong ba bước" đánh số vì đó đúng là một chuỗi bước.
- **Hợp khi:** muốn trông hiện đại như một ứng dụng thương hiệu, dễ quét bằng mắt trên điện thoại.

## C. "Ấm áp thư giãn": mềm, tròn, dễ chịu

- **Cảm giác:** ấm, mềm, như một nơi để thở; không có góc nhọn; nền chuyển sắc hồng nhẹ.
- **Chữ:** tiêu đề Fraunces (mềm, ấm, có chữ nghiêng), nội dung Nunito Sans; cả hai có đủ dấu tiếng Việt.
- **Màu:** nền hồng kem `#FDF4F2`, các thẻ nhóm dịch vụ mang bốn nền khác nhau: trắng, xanh lá nhạt `#E0E9DD`, hồng nhạt, be nhạt; đỏ `#782B37` ở nút, dải ưu đãi và chân trang. Không dùng vàng.
- **Điểm nhấn:** **vòng tròn ảnh với vòng thở**: một vòng tròn lớn, một vòng nhỏ và một viên thuốc đứng, có vòng mảnh phía sau co giãn rất chậm (đứng yên khi người dùng tắt chuyển động). Bảng giá là bốn "viên sỏi" bo góc không đều; dải sóng mềm ngăn các khối.
- **Hợp khi:** muốn nhấn mạnh thư giãn và chăm sóc, thân thiện với khách nữ.

## Chung cho cả ba

- Thanh trên cùng dính, mờ kính; nút đặt lịch luôn ở trên cùng; **đường đặt lịch ngắn**: nút "Đặt lịch" ở thanh trên, đầu trang và (hướng B) trong ô lưới.
- Chuyển động nhẹ: nội dung đầu trang hiện dần một lần; tất cả tôn trọng "giảm chuyển động".
- Hover theo luật: sáng = đỏ `#782B37` đặc, chữ trắng; tối = hồng nhấn có sẵn. Mục tiêu chạm tối thiểu 44 px. Có chế độ sáng và tối, khung hình 360 và 1440 px.
- Mọi chữ lấy từ dữ liệu thật hoặc từ lời sẵn có của trang; các bước đặt lịch ở hướng B chỉ nói những gì luồng đặt lịch hiện có làm. Không ghi chính sách nào chưa có.
- Chưa làm trong bản xem thử: các trang khác (dịch vụ, mỹ phẩm, đặt lịch, tài khoản) và chân trang đầy đủ; sẽ làm khi chủ chọn hướng.

## Ảnh chủ nên chụp (để thay các khung giữ chỗ)

1. **Toàn cảnh phòng thư giãn** hoặc khu gội đầu, ánh sáng ấm, nằm ngang (ảnh bìa: nên khoảng 2400 x 1600 px) và một bản dọc.
2. **Gội đầu dưỡng sinh**, cận cảnh bàn tay và mái tóc.
3. **Làm nail**: đôi tay, bộ móng.
4. **Chăm sóc da mặt**: khuôn mặt thư giãn, mặt nạ.
5. **Massage chân** hoặc cổ vai gáy (không lộ mặt nếu khách không đồng ý).
6. **Kỹ thuật viên** (chân dung nhóm, mặc đồng phục).
7. **Mặt tiền và biển hiệu** (ban ngày và buổi tối).
8. **Quầy lễ tân** và góc chờ.
9. **Chi tiết nhỏ**: khăn, nến, hoa, lọ tinh dầu, bàn trà (để trang trí).
10. **Sản phẩm mỹ phẩm** bày trên mặt bàn sáng, nền đơn giản.

Nên chụp bằng ánh sáng tự nhiên, nền gọn, đồng màu ấm; có giấy đồng ý của khách nếu thấy mặt.
