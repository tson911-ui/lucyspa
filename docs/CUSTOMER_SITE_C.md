# Trang khách: hướng C, "Ấm áp thư giãn" (chủ đã chọn 2026-10-10)

Chủ đã chọn hướng C trong ba hướng xem thử (`docs/DESIGN_PREVIEW_HOME.md`). Hướng C được áp dụng cho **toàn bộ trang khách**. Chỉ đổi giao diện: không đổi logic, API, cơ sở dữ liệu. Khu nhân viên, quầy và quản trị **không đổi** (các luật cũ vẫn áp dụng cho chúng).

## Hợp đồng thiết kế

- **Một nơi duy nhất:** `packages/ui/src/customer.css` (màu, chữ, hình dạng, trang chủ, chân trang, khung ảnh) và `packages/ui/src/customer-pages.css` (dịch vụ, mỹ phẩm, đặt lịch, đăng nhập, trang thông báo). Cả hai chỉ có hiệu lực **bên trong `.ls-site`**, nên khu nhân viên giữ nguyên bảng màu, chữ và bo góc cũ. Hex chỉ nằm ở các khối token; mọi quy tắc khác đọc token.
- **Chữ:** tiêu đề Fraunces (mềm, ấm, có chữ nghiêng), nội dung Nunito Sans; cả hai có đủ dấu tiếng Việt, tự lưu cùng ứng dụng qua `next/font` (`apps/web/src/components/public/site-fonts.ts`, gắn lên khung `.ls-site`). Thang chữ lớn và thoáng hơn: tiêu đề lớn 44 đến 88 px, tiêu đề trang 36 đến 56 px, nội dung 16 px.
- **Màu (sáng):** nền hồng kem `#fdf4f2` với một lớp chuyển sắc nhẹ sang be; thẻ trắng, xanh lá nhạt, hồng nhạt, be nhạt; đỏ thương hiệu `#782b37` ở nút, liên kết, chân trang và ruy-băng ưu đãi. Không vàng, không kim loại. **Tối:** nền `#171012`, hồng nhấn có sẵn của chế độ tối.
- **Hình dạng:** "viên sỏi" (ba góc lớn, một góc nhỏ) cho thẻ; nút và ô nhập hình viên thuốc; bóng đổ hồng nhạt mềm; sóng mềm ngăn các khối và mở đầu chân trang; vòng tròn ảnh có vòng mảnh phía sau co giãn rất chậm (đứng yên khi người dùng tắt chuyển động).
- **Rê chuột:** luật 4 giữ nguyên cho mọi nút, dòng giá, dòng bảng, thẻ chip và menu: sáng = đỏ `#782b37` đặc, chữ trắng; tối = hồng nhấn có sẵn. Mục tiêu chạm tối thiểu 44 px trên điện thoại. **Ba ngoại lệ trên nền đỏ, chờ Owner xác nhận** (đỏ đặc trên nền đỏ sẽ biến mất): nút "Đặt lịch" ở chân trang (nền trắng, chữ đỏ; rê chuột: nền hồng nhạt), các nút tròn Facebook, Zalo... ở chân trang (đĩa sáng; rê chuột: đĩa sáng dịu hơn), và nút trên ruy-băng ưu đãi (nền trắng; rê chuột: nền mực đậm, chữ trắng).
- **Ngày lễ:** các lớp trang trí mùa (Tết, Trung thu, Quốc khánh...) chỉ dùng biến `--ls-season-*` và `--ls-art-*`, hướng C không đụng đến chúng, nên vẫn chạy bên trên. Vàng chỉ còn trong lớp ngày lễ.
- **Trang chủ:** đầu trang (tiêu đề hai dòng, dòng hai nghiêng màu đỏ; ảnh), ba chip thông tin (giờ mở cửa, địa chỉ, hotline, theo thứ tự và các dòng tùy chỉnh của chủ), "Bảng giá dịch vụ" là bốn viên sỏi, phần "vì sao chọn" nếu chủ đã viết, ruy-băng ưu đãi cuối trang. Dải ưu đãi: nút ghi **"Xem ưu đãi"** khi "Bán online" TẮT (lời của chủ như "Mua ngay" chỉ dùng khi BẬT); quy tắc giữ nguyên ở trang chiến dịch. **Thay đổi nhìn thấy được, chờ Owner xác nhận:** dải ưu đãi một dòng phía trên đầu trang (phương án A, Owner duyệt 2026-10-09) được thay bằng ruy-băng lớn ở cuối trang chủ, đúng như bản xem thử C; nếu muốn, đưa lại dải một dòng lên đầu trang là việc nhỏ.
- **Đã sửa kèm theo:** khung thương hiệu ở trang đăng nhập và đăng ký (không còn ô tối sau từng dòng chữ, không còn kéo dài thành một vùng trống lớn: khung chỉ cao bằng nội dung và dính dưới đầu trang khi biểu mẫu dài); biểu tượng Zalo và Facebook ở chân trang chỉ hiện khi chủ đã nhập liên kết (đã có kiểm thử cho từng trường hợp).

## Ảnh: chỗ nào thay được từ Quản trị → Website

Mọi khung ảnh là **khung giữ chỗ đã thiết kế sẵn**, có chú thích nói ảnh nào thuộc về đây; không có ảnh stock hay ảnh bịa. Khi chủ chọn ảnh thật ở những chỗ đã có, khung tự dùng ảnh đó:

| Chỗ trên trang                                    | Thay ở đâu                                                | Ghi chú                                                                                |
| ------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Vòng tròn lớn đầu trang chủ                       | **Website → Thông tin tiệm → "Ảnh đầu trang chủ"**        | ảnh ngang, nên khoảng 2400 x 1600 px; khung cắt thành hình tròn, nên để chủ thể ở giữa |
| Khung trượt đầu trang chủ                         | **Website → Slide** (ảnh mỗi slide, khoảng 1920 x 800 px) | khi có slide, khung trượt thay vòng tròn                                               |
| Ruy-băng ưu đãi trang chủ và đầu trang chiến dịch | **Website → Chiến dịch → "Ảnh bìa"**                      | ảnh ngang                                                                              |
| Ảnh ở chân trang                                  | **Website → Thông tin tiệm → khối "Ảnh" của chân trang**  | tùy chủ thêm                                                                           |
| Popup khuyến mãi                                  | **Website → Popup** (ảnh, khoảng 1200 x 800 px)           |                                                                                        |
| Ảnh sản phẩm                                      | **Mỹ phẩm → từng sản phẩm**                               |                                                                                        |

**Chưa có chỗ chọn ảnh trong Quản trị** (cần thêm chỗ chọn ảnh, tức đổi API và cơ sở dữ liệu, nên chưa làm trong bước chỉ đổi giao diện; chờ chủ quyết định):

1. Vòng tròn nhỏ "làm nail" ở đầu trang chủ.
2. Viên thuốc đứng "gội đầu" ở đầu trang chủ.

Hai khung này chỉ hiện khi **chưa** có ảnh đầu trang và chưa có slide (để bộ ba khung giữ chỗ trọn vẹn); khi chủ đã chọn ảnh thật cho vòng tròn lớn thì chỉ còn vòng tròn lớn với vòng mảnh phía sau, nên trang không bao giờ có khung trống cạnh ảnh thật.

## Ảnh chủ nên chụp

1. **Toàn cảnh phòng thư giãn** hoặc khu gội đầu, ánh sáng ấm, nằm ngang (khoảng 2400 x 1600 px): cho vòng tròn lớn đầu trang chủ.
2. **Gội đầu dưỡng sinh**, cận cảnh bàn tay và mái tóc (khung "gội đầu").
3. **Làm nail**: đôi tay, bộ móng (khung "làm nail").
4. **Chăm sóc da mặt**: khuôn mặt thư giãn, mặt nạ.
5. **Massage chân** hoặc cổ vai gáy (không lộ mặt nếu khách không đồng ý).
6. **Kỹ thuật viên**: chân dung nhóm, mặc đồng phục (khối ảnh chân trang).
7. **Mặt tiền và biển hiệu**, ban ngày và buổi tối.
8. **Quầy lễ tân** và góc chờ.
9. **Chi tiết nhỏ**: khăn, nến, hoa, lọ tinh dầu, bàn trà.
10. **Sản phẩm mỹ phẩm** trên mặt bàn sáng, nền đơn giản (ảnh sản phẩm).
11. **Ảnh bìa cho chiến dịch** (ngang, sáng, ít chữ) mỗi khi chủ mở một chiến dịch.

Nên chụp bằng ánh sáng tự nhiên, nền gọn, đồng màu ấm; có giấy đồng ý của khách nếu thấy mặt.
