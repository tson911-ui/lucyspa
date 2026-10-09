# UI polish, nhóm 1: trang dành cho khách (Bước A)

Chỉ đổi giao diện. Không đổi nghiệp vụ, API, cơ sở dữ liệu hay dữ liệu. Luật nền: mục "UI design rules" trong `CLAUDE.md`
(thương hiệu đỏ `#782b37` + trắng, không vàng, hover đỏ đặc chữ trắng ở chế độ sáng, hồng hiện có ở chế độ tối). Đã dùng skill
`frontend-design` để nâng bố cục, chữ, chi tiết, chuyển động và lời văn, không đổi thương hiệu.

Trạng thái: **Bước A xong, chờ chủ duyệt hướng thiết kế (mục 4) và cách đưa chiến dịch lên trang chủ (mục 4, A/B/C đều chờ chủ)**. Chưa đụng các trang khác ngoài trang chủ. Commit cục bộ, chưa push, chưa deploy.

## 1. Danh sách trang của khách

| Nhóm       | Trang                                                                             | Đường dẫn (`/vi/...`)                                          |
| ---------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Công khai  | Trang chủ                                                                         | ``                                                             |
|            | Danh sách dịch vụ, chi tiết dịch vụ                                               | `services`, `services/{mã}`                                    |
|            | Mỹ phẩm: danh sách, chi tiết, trang chiến dịch                                    | `products`, `products/{mã}`, `products?campaign={tên}`         |
|            | Phiếu hẹn nhận hàng công khai                                                     | `ticket/{mã bí mật}`                                           |
|            | Trang không tìm thấy (404)                                                        | mọi địa chỉ không có                                           |
| Tài khoản  | Đăng nhập, đăng ký, quên mật khẩu                                                 | `account/login`, `account/register`, `account/forgot-password` |
|            | Tổng quan tài khoản                                                               | `account`                                                      |
|            | Đặt lịch, lịch hẹn của tôi (danh sách, chi tiết)                                  | `account/book`, `account/bookings`, `account/bookings/{id}`    |
|            | Hóa đơn (danh sách, chi tiết)                                                     | `account/invoices`, `account/invoices/{id}`                    |
|            | Điểm thưởng, hạng thành viên, combo, quà tặng                                     | `account/loyalty`                                              |
|            | Thông báo                                                                         | `account/notifications`                                        |
| Mua online | Giỏ hàng, thanh toán, đơn hàng online (danh sách, chi tiết); khi "Bán online" TẮT | `cart`, `checkout`, `account/orders`, `account/orders/{id}`    |
| Dùng chung | Header, chân trang, thanh tab điện thoại, nút liên hệ nổi, popup, ảnh trượt       | mọi trang                                                      |
| Theo mùa   | Lớp trang trí theo mùa (Tết, Trung thu, quốc khánh)                               | theo mùa đang bật (xem mục 6, chưa chụp)                       |

Chi tiết lịch hẹn và hóa đơn chi tiết dùng cùng khung với đơn hàng chi tiết; ảnh "trước" của hai trang đó chưa chụp vì CSDL mẫu
chưa có lịch hẹn và hóa đơn thật (xem mục 6).

Ảnh "trước": `.local/uxui-screens/before-<trang>-<rộng>-<sáng|tối>.png` (360, 768, 1440; sáng và tối), kèm `-top.png` là 1000 px đầu.
Trạng thái "Bán online" tắt: `before-off-*`. Chữ 130%: `before-t130-*`. Popup: `before-popup-*`.
Xem trang chủ trước/sau cạnh nhau: mở `.local/polish1/gallery/index.html`.

## 2. Lỗi đã thấy, theo trang

### Dùng chung (mọi trang)

1. Header ở 360 px với chữ 130%: nút tài khoản bị cắt khỏi màn hình (thừa 23 px). **Đã sửa trong bản mẫu** (chữ logo không lớn quá 5% bề rộng màn hình).
2. Ảnh trượt tạm dừng vĩnh viễn khi chạm trên điện thoại (lần chạm cũng bắn sự kiện chuột). **Đã sửa trong bản mẫu** (chỉ chuột mới tạm dừng khi rê).
3. Dải trống cao 88 px ngay trên chân trang (chỗ nghỉ của nút liên hệ nổi) trên mọi trang ngắn; trên điện thoại nút nổi còn đè lên nút "Đặt lịch" của thẻ dịch vụ (trang dịch vụ 360 px).
4. Thanh tab điện thoại: nhãn "Đặt lịch ngay" đậm hơn các tab khác và cách mép phải khoảng 5 px; ở chữ 130% nhãn "Trang chủ" gãy 2 dòng khi có 5 tab (hội viên).
5. Chân trang: mỗi dòng cao 40 px nên cột Liên hệ, Liên kết rất thưa, cột thương hiệu gần như trống; biểu tượng Facebook đứng cạnh chữ "Zalo" trông như một nhãn sai. Khi không đọc được dữ liệu cửa hàng, cột liên hệ biến mất.
6. Hàng "Quay lại" xuất hiện cả ở trang cấp một (Tài khoản, Hóa đơn, Lịch hẹn); trang chi tiết có thêm đường dẫn breadcrumb, nên có hai lối quay lại.
7. Trang 404 là trang mặc định tiếng Anh ("This page could not be found."), nền trắng, không header, không chân trang, ngoài thương hiệu.
8. Tên nút đặt lịch không thống nhất: "Đặt lịch ngay" (header, tab), "Đặt lịch" (thẻ dịch vụ), "Đặt lịch mới" (tài khoản), tiêu đề trang "Đặt lịch hẹn".
9. Hover chưa theo luật: bộ lọc danh mục mỹ phẩm vẫn nền hồng nhạt khi rê; dải khuyến mãi ở trang mỹ phẩm chỉ đổi viền.
10. Nhiều trang "cột hẹp lệch trái": giỏ hàng, thanh toán, đơn hàng chi tiết, chi tiết dịch vụ, vé dùng cột 720 px (hoặc 650 px) bắt đầu ở mép trái hoặc lệch so với logo, để trống hơn nửa chiều ngang ở 1440 px.

### Trang chủ (trước)

1. Ảnh trượt: chú thích là thẻ trắng dưới ảnh, tiêu đề chú thích dùng chữ không chân đậm trong khi mọi tiêu đề khác dùng chữ có chân; nút điều khiển (‹ ● ● ● › ⏸) trôi giữa, không bám mép khung.
2. Chiến dịch đang chạy không xuất hiện ở đâu trên trang chủ (câu hỏi mở số 3 của chủ).
3. "Nhóm dịch vụ nổi bật": 4 thẻ y hệt nhau (tiêu đề, 3 dòng, liên kết), thẻ nào cũng viền và đổ bóng; từng dịch vụ không bấm được; dòng phụ nhắc lại ý của đoạn dẫn ở hero.
4. Popup: tiêu đề chữ không chân, khác các tiêu đề khác (đã đổi trong bản mẫu); chưa có chỗ cho chiến dịch.

### Dịch vụ

- Danh sách: mỗi dịch vụ một thẻ giống nhau (23 dịch vụ đang bán trong dữ liệu mẫu), mỗi thẻ một nút "Đặt lịch" đặc (nhiều nút chính trên một màn); thẻ lẻ ở cuối hàng; ở 360 px mỗi thẻ cao khoảng 250 px nên cuộn rất dài; không có ô tìm.
- Chi tiết: khối thông tin là cặp nhãn - giá trị rời rạc, không mô tả; "Dịch vụ cùng nhóm" lại là thẻ lặp; thẻ lẻ cuối hàng; breadcrumb trùng "Quay lại".

### Mỹ phẩm

- Danh sách: ô chọn "Nổi bật" dùng kiểu gốc của trình duyệt (mũi tên hệ điều hành) cạnh ô tìm dạng viên thuốc; dải khuyến mãi bị cắt chữ ở 360 px ("Ngày hội làm đẹp ...").
- Chi tiết: khối "Mua trực tiếp tại cửa hàng" là thẻ viền riêng giữa trang; cột ảnh bên trái bỏ trống phía dưới ở 1440 px.
- Khi "Bán online" tắt: nút thành "Mua tại cửa hàng" (rõ ràng), nhưng giỏ hàng ở header biến mất không báo.
- Trang chiến dịch: khoảng cách giữa "Quay lại" và khối đầu trang hơi rộng; còn lại ổn.

### Vé nhận hàng công khai

- Nhãn "Đã thanh toán" hiện cả số tiền của đơn đang "Chờ thanh toán" (cần kiểm tra lại lời văn); dòng sản phẩm "1 · 520.000 ₫" khó đọc; trạng thái lặp ở từng dòng.

### Đăng nhập, đăng ký, quên mật khẩu

- Thẻ nhỏ 448 px trôi giữa một trang trống, không có yếu tố thương hiệu (khác trang nhân viên có panel đỏ).
- Đăng ký: ô ngày sinh dùng định dạng của trình duyệt (`mm/dd/yyyy`) trên trang tiếng Việt; form 9 ô một cột rất dài ở 360 px.

### Tài khoản

- Tổng quan: nút "Đặt lịch mới" nằm thấp hơn dòng tiêu đề; "Xem tất cả" là liên kết chữ làm hành động; thẻ "Thông tin tài khoản" chỉ 2 dòng.
- Đặt lịch: liệt kê hết dịch vụ trong một cột dài, không tìm, không thu gọn theo nhóm; thanh hành động dính dưới màn hình (mục tồn đọng đã biết); header vẫn có nút "Đặt lịch ngay" ngay trên trang đặt lịch.
- Lịch hẹn: hai thẻ rỗng "Sắp tới" và "Lịch sử" xếp chồng, chiếm nửa màn.
- Hóa đơn: cột chi nhánh ghép tên với địa chỉ nên bị cắt ("Lucy Spa Đà Nẵng - 04 Nguyễ..."); ngày là liên kết gạch chân.
- Điểm thưởng: sáu khối rỗng liên tiếp, mỗi khối một thẻ viền "Bạn chưa có ..."; hai thẻ điểm y hệt nhau; tiêu đề phụ quá nhiều.
- Thông báo: lời dẫn còn nhắc "công việc của bạn" (lời của nhân viên); nút "Đánh dấu tất cả đã đọc" mờ chiếm cả dòng; nút lọc và nút làm mới chỉ có biểu tượng, đặt lệch nhau.
- Đơn hàng: bảng ổn; trang chi tiết lặp "Mã đơn" 3 lần (tiêu đề, breadcrumb, trường).

### Giỏ hàng, thanh toán

- Giỏ trống và "Bán online" tắt dùng thẻ viền nét đứt, khác các trạng thái rỗng còn lại (nét liền); thẻ rộng 720 px nằm lệch trái, nửa màn trống.
- Ở 360 px mỗi dòng sản phẩm xếp 4 tầng (tên, giá, bộ đếm kèm thùng rác, thành tiền), nên giỏ 3 món đã dài hơn một màn rưỡi.

## 3. Việc chưa xử lý ở bước này (để dành cho các lượt kế tiếp)

Tất cả mục trên ngoài trang chủ: để sau khi chủ duyệt hướng. Gợi ý thứ tự: (1) khung chung (chân trang, thanh tab, nút nổi, 404, "Quay lại");
(2) dịch vụ và đặt lịch; (3) mỹ phẩm, chiến dịch, vé; (4) đăng nhập và tài khoản; (5) giỏ, thanh toán, đơn hàng.

## 4. Hướng thiết kế cho cả site khách (chờ chủ duyệt)

**Giữ nguyên:** đỏ `#782b37` và trắng, nền ấm `#faf7f7`, chế độ sáng/tối, hai bộ chữ đã duyệt (chữ có chân cho tiêu đề, chữ không chân cho nội dung), chữ "LUCY SPA", header trong suốt rồi kính mờ, nút dạng viên thuốc, thanh tab điện thoại, chuyển trang mượt.

**Cải thiện:**

- Một thang cách điệu duy nhất, mỗi trang có một tiêu đề, một hành động chính; bỏ lặp thẻ giống nhau bằng bố cục theo nội dung (bảng giá, danh sách hàng, khối thông tin) thay vì lưới thẻ.
- Trạng thái rỗng: một kiểu duy nhất, ngắn, nói việc cần làm (không xếp nhiều thẻ rỗng liên tiếp; gộp thành một dòng khi cả nhóm đều rỗng).
- Hover theo luật: đỏ đặc, chữ trắng (sáng); hồng hiện có (tối); mọi hàng bấm được đều có hover như nhau.
- Lời văn ngắn, tự nhiên, một tên cho một hành động ("Đặt lịch" ở mọi nơi), không dùng từ của nhân viên cho khách, không dùng chữ "khám".
- Chuyển động: giữ nhịp hiện có (hiện dần khi cuộn, trượt trang); không thêm hiệu ứng mới ngoài một khoảnh khắc ở trang chủ; tôn trọng "giảm chuyển động".

**Một yếu tố đặc trưng: "bảng giá"** (như tấm bảng giá in của spa). Giá niêm yết rõ ràng là điểm mạnh của Lucy Spa, nên giá được trình bày như một tấm bảng giá:
tên dịch vụ, dải chấm dẫn, giá, trên một mặt phẳng duy nhất, tên nhóm bằng chữ có chân. Từng dòng bấm được (mở dịch vụ). Dùng lại ở danh sách dịch vụ (nhóm 2) và ở
bước chọn dịch vụ khi đặt lịch. Không thêm màu, chữ, hay trang trí nào mới. Tên gọi "Bảng giá dịch vụ" là đề xuất lời văn, chờ chủ đối chiếu với cách gọi của spa (nhãn trong admin vẫn là "Nhóm dịch vụ nổi bật").

### Chiến dịch trên hero và popup (câu hỏi mở số 3): cả A, B, C đều CHỜ CHỦ DUYỆT

Dữ liệu chiến dịch đang chạy đã công khai sẵn (tên, nhãn, câu chính, ngày kết thúc, nút, ảnh banner). Có ba cách đặt lên trang chủ; đề xuất kỹ thuật của tôi: A, rồi B nếu chủ muốn.
Chủ chưa trả lời, nên cách A trên trang chủ mẫu chỉ là **bản dựng tạm để chủ xem**, không phải quyết định.

| Cách                                | Mô tả                                                                                                                   | Đổi dữ liệu?                                                                                | Trạng thái                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| A. Dải ưu đãi trên hero             | Một dòng mỏng ngay trên hero: nhãn, câu chính, "Đến hết ngày ...", nút. Cả dòng là một liên kết tới trang chiến dịch.   | Không. Chạy và tắt đúng lịch của chiến dịch.                                                | Dựng tạm trên trang chủ mẫu, chờ chủ |
| B. Chiến dịch là ảnh trượt đầu tiên | Trong lúc chạy, ảnh banner và lời của chiến dịch thành ảnh đầu của ảnh trượt (tối đa 8 ảnh), tự hết khi chiến dịch hết. | Không (ghép ở giao diện). Muốn chọn từng chiến dịch có/không thì cần thêm một cột công tắc. | Chờ chủ chọn                         |
| C. Chiến dịch làm popup             | Khi không có popup tự đặt đang chạy, popup hiện chiến dịch (một lần mỗi lượt truy cập). Popup tự đặt luôn được ưu tiên. | Không                                                                                       | Chờ chủ chọn                         |

Lịch riêng của ảnh trượt và popup vẫn giữ nguyên; A, B, C chỉ đọc lịch của chiến dịch. Với B và C, nếu chủ muốn công tắc "hiện ở trang chủ" riêng cho từng chiến dịch thì cần đổi dữ liệu (không làm khi chưa được duyệt).

## 5. Đã làm trên trang chủ (bản mẫu tạm, chờ chủ duyệt hướng)

- **Dải ưu đãi** (cách A, dựng tạm): `HomeOffer` (`campaign-views.tsx`); dữ liệu đọc từ `/public/campaigns` đã có; chạy theo lịch chiến dịch; nền hồng nhạt (không tranh nút chính của hero), hover đỏ đặc chữ trắng; hết chiến dịch thì biến mất; tiêu đề dài tự xuống dòng.
- **Bảng giá dịch vụ** (yếu tố đặc trưng): một mặt phẳng không đổ bóng (cùng kiểu bề mặt với dải ưu đãi và ảnh trượt), hai cột từ 768 px, một cột trên điện thoại; mỗi dòng "tên ····· giá" là liên kết tới dịch vụ, cao đủ 40/44 px; hover đỏ đặc chữ trắng (kể cả giá; chế độ tối: hồng hiện có chữ tối). `PriceList` ở `packages/ui` nhận thêm `href` và dải chấm.
- **Ảnh trượt**: tiêu đề chú thích dùng chữ có chân như mọi tiêu đề; chấm ở đầu khung, mũi tên và nút dừng ở cuối khung; **sửa lỗi dừng khi chạm** (có kiểm thử).
- **Popup**: tiêu đề dùng chữ có chân (cùng quy tắc với mọi tiêu đề); bố cục không đổi.
- **Header chữ 130%**: sửa lỗi nút tài khoản bị cắt (chỉ thu nhỏ chữ logo khi màn hẹp). Sửa này nằm ở CSS dùng chung nên áp dụng cho MỌI trang khách, không riêng trang chủ.
- **Lời văn**: "Bảng giá dịch vụ" và dòng phụ "Giá niêm yết rõ ràng cho từng dịch vụ. Chọn một dịch vụ để xem chi tiết và đặt lịch." (có bản tiếng Anh). Khung chờ (`loading.tsx`) của trang chủ đã đổi cho hợp bố cục mới nhưng chưa được dựng ra để chụp.
- **Công cụ kiểm định** (`scripts/uxui-screens.mjs`): ảnh điện thoại giờ chụp đủ cả trang (trước đây chỉ chụp màn hình đầu vì cuộn nằm trong khung ứng dụng); thêm `--hover` và `--fresh-session` (popup hiện ở mỗi lần chụp).

Không làm: footer, nút liên hệ nổi, thanh tab, 404 và mọi trang khác (xem mục 3). Bản xem trước lớp theo mùa trong admin chưa đọc chiến dịch nên chưa hiện dải ưu đãi (chỉ trang thật hiện).

Tệp: `packages/ui/src/{site.css,components.css,site.tsx,slider.tsx,index.tsx}`, `apps/web/src/components/public/{campaign-views,home-content,home-sections}.tsx`,
`apps/web/src/lib/{public-site,public-site-core}.ts`, `apps/web/src/i18n/site.ts`, loading của trang chủ, kiểm thử tương ứng, `scripts/uxui-screens.mjs`.
Không có migration, không đổi API, không có quyền mới.

## 6. Cổng chất lượng (ghi chú UX gate)

1. **Đã mở và xem** (bản dựng cuối): trang chủ 1440 sáng và tối (cả trang), 768 sáng và tối (cả trang), 360 sáng (1000 px đầu) và bảng giá 360 sáng và tối; chữ 130% ở 360 px cho khách và hội viên, sáng và tối (1000 px đầu); hover dòng bảng giá sáng và tối, hover dải ưu đãi sáng và tối; popup 360, 768, 1440, sáng và tối (6 ảnh); trạng thái không có ảnh trượt + tiêu đề ưu đãi rất dài (360 tối, 1440 tối), tên dịch vụ rất dài (360 và 1440 sáng), lỗi đọc dữ liệu (360 sáng); lớp Tết bản trước (1440 sáng) và bản sau (360 sáng, 1440 sáng và tối). **Có chụp nhưng chưa mở**: 360 tối cả trang (chỉ mở 1000 px đầu ở bản trước đó), lỗi đọc dữ liệu 768, 1440 và tối, trạng thái không ảnh trượt 360 và 1440 sáng, 768, lớp Tết 768 và các ảnh `-top` còn lại: không dùng làm bằng chứng.
2. **Phát hiện khi xem:** hover chế độ tối là hồng hiện có chữ tối (đúng luật 4); popup 1440 tối ở lần chụp đầu thiếu ảnh do chờ chưa đủ (chụp lại với chờ lâu hơn thì có ảnh: lỗi của lần chụp, không phải của trang); trạng thái "lỗi đọc dữ liệu" làm mất cột Liên hệ của chân trang (đã có từ trước); ảnh trượt thứ tư trong dữ liệu mẫu có tệp ảnh bị mất nên chỉ hiện chữ thay thế, đó là một lỗi đáng làm ở nhóm sau (ảnh hỏng nên có hình thay thế).
3. Luật cứng: chỉ dùng token (khoảng cách bội số của 4, không hex, không lớp `wf-`); bộ đếm ratchet không tăng; trang chủ không có số/ký hiệu cạnh tiêu đề.
4. DOM audit trang chủ, trước và sau cùng một cách chạy: **trước 12 / 12 / 8, sau 11 / 11 / 7** (360 / 768 / 1440), không loại nào tăng; loại "surface-style-mix" biến mất sau khi bỏ bóng của bảng giá. Bản nháp từng thêm 20 cảnh báo tràn do lề âm của dòng bảng giá; đã bỏ lề âm.
5. DOM audit 26 trang nhân viên so với `docs/uxui-audit-baseline.json`: chụp đủ 26 trang, **không loại nào tăng** (hai loại bằng baseline: edge-left 4, unpaged-list 3; mọi loại còn lại thấp hơn baseline). Số liệu này là so với baseline cũ ngày 2026-10-01, không phải so với bản ngay trước bước này.
6. Lớp theo mùa: đã chụp thử với một mùa Tết mẫu (trước và sau, 360 / 768 / 1440 sáng và tối): dải ưu đãi và bảng giá hiển thị đúng dưới các trang trí. Chưa thử các mùa khác (Giáng sinh, Trung thu...).
7. Chưa kiểm tra được: lịch hẹn và hóa đơn chi tiết (CSDL mẫu chưa có); thao tác chạm thật trên điện thoại (cần máy thật); ảnh trượt dùng ảnh mẫu vẽ bằng mã (không phải ảnh thật của spa). Mục tiêu chạm "Lucy Spa, về trang chủ" 113×40 px khi header thu nhỏ đã có từ trước (có cả ở bản trước), chưa sửa.
8. Dữ liệu mẫu: CSDL scratch `lucy_spa_polish1_scratch` (bản sao của CSDL audit, 23 dịch vụ đang bán, nâng lên 101 migration), không phải dev hay production.

Kiểm thử đã chạy: `pnpm --filter @lucy-spa/ui test` 468/468, `pnpm --filter @lucy-spa/web test` 881/881, typecheck ui và web, eslint, prettier (toàn repo sạch trước commit).
Chưa chạy: `pnpm test` toàn repo (chỉ cần trước khi push, chưa push).

## 7. Việc chờ chủ

1. Duyệt hướng ở mục 4 (giữ / cải thiện / yếu tố "bảng giá"), và tên gọi "Bảng giá dịch vụ".
2. Chọn cách A, B, C cho chiến dịch (mục 4) và có cần công tắc riêng không.
3. Dải ưu đãi hiện nút "Mua ngay" kể cả khi "Bán online" đang TẮT (như production hiện nay). Có nên hiện không khi bán online tắt? (Chưa làm gì cho việc này.)
4. Cho phép chạy tiếp theo thứ tự ở mục 3, hay đổi thứ tự.
