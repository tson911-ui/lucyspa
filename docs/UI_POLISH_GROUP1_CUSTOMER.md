# UI polish, nhóm 1: trang dành cho khách (Bước A)

Chỉ đổi giao diện. Không đổi nghiệp vụ, API, cơ sở dữ liệu hay dữ liệu. Luật nền: mục "UI design rules" trong `CLAUDE.md`
(thương hiệu đỏ `#782b37` + trắng, không vàng, hover đỏ đặc chữ trắng ở chế độ sáng, hồng hiện có ở chế độ tối). Đã dùng skill
`frontend-design` để nâng bố cục, chữ, chi tiết, chuyển động và lời văn, không đổi thương hiệu.

Trạng thái: **hướng đã được chủ duyệt (2026-10-09, mục 8); toàn bộ trang khách đã chỉnh (mục 9); cổng chất lượng ở mục 10; chưa deploy**. Hướng dẫn triển khai: `docs/DEPLOY_UI_POLISH_RUNBOOK.md`. Chưa đụng các trang khác ngoài trang chủ. Commit cục bộ, chưa push, chưa deploy.

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

## 3. Thứ tự các lượt sửa

Đã làm hết theo thứ tự này sau khi chủ duyệt (mục 8, 9): (1) khung chung; (2) dịch vụ và đặt lịch; (3) mỹ phẩm, chiến dịch, vé; (4) đăng nhập và tài khoản; (5) giỏ, thanh toán, đơn hàng.

## 4. Hướng thiết kế cho cả site khách (đã duyệt, mục 8)

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

### Chiến dịch trên hero và popup (câu hỏi mở số 3): chủ chọn CHỈ cách A (mục 8)

Dữ liệu chiến dịch đang chạy đã công khai sẵn (tên, nhãn, câu chính, ngày kết thúc, nút, ảnh banner). Có ba cách đặt lên trang chủ; đề xuất kỹ thuật của tôi: A, rồi B nếu chủ muốn.
Chủ chưa trả lời, nên cách A trên trang chủ mẫu chỉ là **bản dựng tạm để chủ xem**, không phải quyết định.

| Cách                                | Mô tả                                                                                                                   | Đổi dữ liệu?                                                                                | Trạng thái                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| A. Dải ưu đãi trên hero             | Một dòng mỏng ngay trên hero: nhãn, câu chính, "Đến hết ngày ...", nút. Cả dòng là một liên kết tới trang chiến dịch.   | Không. Chạy và tắt đúng lịch của chiến dịch.                                                | **Đã duyệt, làm xong** (mục 8) |
| B. Chiến dịch là ảnh trượt đầu tiên | Trong lúc chạy, ảnh banner và lời của chiến dịch thành ảnh đầu của ảnh trượt (tối đa 8 ảnh), tự hết khi chiến dịch hết. | Không (ghép ở giao diện). Muốn chọn từng chiến dịch có/không thì cần thêm một cột công tắc. | Không làm (chủ chỉ chọn A)     |
| C. Chiến dịch làm popup             | Khi không có popup tự đặt đang chạy, popup hiện chiến dịch (một lần mỗi lượt truy cập). Popup tự đặt luôn được ưu tiên. | Không                                                                                       | Không làm (chủ chỉ chọn A)     |

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

## 8. Quyết định của chủ (2026-10-09, bằng lời của chủ)

1. Duyệt: trang chủ mẫu, hướng thiết kế (mục 4) và tên "Bảng giá dịch vụ".
2. Chiến dịch trên trang chủ: **chỉ cách A** (dải ưu đãi trên hero); B và C không làm. Làm cho hoàn chỉnh.
3. Khi "Bán online" TẮT, dải ưu đãi không được ghi "Mua ngay": ghi **"Xem ưu đãi"** và dẫn tới trang chiến dịch. Chỉ khi "Bán online" BẬT mới dùng lời của chủ (ví dụ "Mua ngay"). Chưa đọc được trạng thái bán online thì coi như TẮT. Cùng quy tắc áp dụng cho nút của dải khuyến mãi và đầu trang chiến dịch ở các trang mỹ phẩm.
4. Sửa TẤT CẢ trang khách còn lại theo thứ tự ở mục 3, không dừng giữa các trang; chỉ đổi giao diện (không logic, API, CSDL); chạy lại các luồng người dùng để chứng minh không hỏng; push main, đợi CI xanh, viết hướng dẫn deploy cho bản chỉ-giao-diện này. Không đụng máy chủ.

## 9. Đợt chỉnh toàn bộ trang khách (2026-10-09 và 10, theo quyết định ở mục 8)

Chỉ giao diện: không đổi nghiệp vụ, API, cơ sở dữ liệu hay dữ liệu; không có migration. Mỗi dòng dưới đây là một lỗi ở mục 2 đã sửa, theo trang.

**Dùng chung**

- Nút đặt lịch ở mọi nơi ghi **"Đặt lịch"** (trước: "Đặt lịch ngay", "Đặt lịch mới", "Book an appointment").
- Chân trang: hàng gọn hơn (36 px, vùng chạm vẫn 44 px), cột thương hiệu có nút "Đặt lịch", điện thoại xếp các liên kết thành một dòng; dải trống 88 px trên chân trang cùng màu với khối phía trên và bớt khoảng đệm.
- Trang 404 và trang lỗi có khung site (menu, chân trang) và hai lối đi; trang lỗi có nút "Tải lại"; có cả bản tiếng Anh.
- Hover đặc đỏ chữ trắng (sáng) / hồng (tối) cho: dòng bảng giá, dòng dịch vụ, dòng chọn dịch vụ khi đặt lịch, dải khuyến mãi, bộ lọc mỹ phẩm, hàng của bảng ở khu khách, "Truy cập nhanh". Thẻ chỉ có thông tin không còn nhấc lên khi rê chuột.
- Ô chọn (sort, loại thông báo) có mũi tên riêng thay mũi tên của hệ điều hành; ô tìm không còn đè biểu tượng lên chữ.
- Nút hành động của tiêu đề trang căn giữa khối tiêu đề.
- Header ở chữ 130%: nút tài khoản không còn bị cắt (đã làm ở bản mẫu).

**Dịch vụ**: danh sách dạng dòng (tên, dấu chấm, giá, thời gian, nút "Đặt lịch" riêng) thay lưới 3 cột; có **ô tìm không cần gõ dấu** và bộ lọc nhóm trên cùng một dòng. Chi tiết dịch vụ hai cột (thông tin và nút đặt lịch, dịch vụ cùng nhóm bên cạnh); số liệu bằng chữ không chân.

**Đặt lịch**: ô tìm dịch vụ (từ 9 dịch vụ trở lên), dòng chọn gọn hơn và hover đặc; header không còn nút "Đặt lịch" thứ hai trên chính trang đặt lịch.

**Mỹ phẩm, chiến dịch, vé**: mũi tên ô sắp xếp riêng; dải khuyến mãi xuống tối đa hai dòng thay vì cắt chữ; bớt khoảng trống trên trang chiến dịch; ảnh sản phẩm đứng yên khi đọc cột bên cạnh; nút chiến dịch **"Xem ưu đãi" / "Xem sản phẩm" khi "Bán online" tắt, "Mua ngay" chỉ khi bật** (cả dải ở danh sách, đầu trang chiến dịch và dải ở trang chủ). Phiếu hẹn nhận hàng: mã đơn lớn, trạng thái cùng dòng, sản phẩm là các dòng; nhãn "Tổng tiền" thay "Đã thanh toán" khi chưa trả.

**Đăng nhập, đăng ký**: khung thương hiệu bên cạnh thẻ (màn hình ≥ 1024 px); ô ngày sinh nhập **ngày/tháng/năm** (gõ `15031990` thành `15/03/1990`, báo lỗi ngày không có thật) thay ô ngày của trình duyệt.

**Tài khoản**: tổng quan có khối "Truy cập nhanh" (lịch hẹn, hóa đơn, điểm thưởng, đơn hàng, thông báo) và "Xem tất cả" là nút; lịch hẹn rỗng là một lời mời đặt lịch hoặc một dòng chữ nhỏ, không còn hai thẻ rỗng; chi tiết lịch hẹn, hóa đơn, đơn hàng hai cột, dòng dịch vụ có giá bên phải; cột chi nhánh ẩn khi chỉ có một chi nhánh; điểm thưởng: bảng hạng giữ ba cột trên điện thoại, mục chưa có gì thành một dòng chữ; thông báo: lời dẫn cho khách ("Tin về lịch hẹn, hóa đơn và đơn hàng của bạn"); đơn hàng: mã đơn ở dòng mô tả thay vì lặp trong tiêu đề và trường.

**Giỏ hàng, thanh toán**: trạng thái rỗng (giỏ trống, "Bán online" tắt) là một thẻ gọn ở giữa, viền liền như các thẻ khác.

**Không làm (có lý do):** nút "Quay lại" giữ nguyên trên mọi trang (quy tắc của chủ 2026-10-04; thu nhỏ khoảng cách thay vì bỏ); thanh hành động dính của trang đặt lịch (chưa ai báo lỗi); biểu tượng Facebook cạnh chữ "Zalo" ở chân trang (hai biểu tượng thật, đã đặt đúng chỗ); thanh tab điện thoại ở chữ 130% với 5 tab (nhãn xuống 2 dòng, vẫn đọc được).

**Kiểm chứng luồng người dùng** (trình duyệt thật, `.local/polish1/flows.mjs`, bảy luồng đều qua): tìm dịch vụ có/không dấu và báo không khớp; từ chi tiết dịch vụ sang đặt lịch đúng dịch vụ; mỹ phẩm, dải khuyến mãi, trang chiến dịch, trang sản phẩm; form đăng ký (mặt nạ ngày sinh, báo ngày sai); đăng nhập rồi mở 7 trang tài khoản không lỗi; đặt lịch từ đầu đến hết (chọn dịch vụ, khách, ngày giờ, xác nhận, "Đặt lịch thành công"); trang 404.

## 10. Cổng chất lượng của đợt chỉnh toàn bộ trang khách

1. **DOM audit 30 trang khách, trước và sau cùng một cách chạy** (sáng, 360 / 768 / 1440 px; `.local/polish1/audit-all.mjs`): không có loại phát hiện nào tăng, trừ hai chỗ có lý do. (a) Trang 404: trước chỉ là trang trần (1 phát hiện), nay có header, chân trang, thanh tab nên có cùng 5 phát hiện nền như mọi trang (nút nổi và thanh tab đứng riêng); không so sánh được. (b) Chi tiết dịch vụ ở 1440 px: 1 lên 2 (`row-height-unequal`: thẻ thông tin cao 216 px bên cạnh danh sách "dịch vụ cùng nhóm" cao 446 px); đây là bố cục hai cột có chủ ý, thẻ không bị kéo giãn cho bằng nhau, chấp nhận. Số phát hiện của từng trang đang là 5 / 5 / 1 (360 / 768 / 1440) cho phần lớn trang, thấp hơn trước ở trang chủ (11 / 11 / 7 so với 12 / 12 / 8) và dịch vụ không đổi.
2. **DOM audit 26 trang nhân viên so với `docs/uxui-audit-baseline.json`**: không loại nào tăng (chạy ở bước A; bản sửa sau đó không đụng CSS của khu nhân viên ngoài việc popup dùng chung đổi chữ tiêu đề, xem 4).
3. **Kiểm thử và tĩnh**: `pnpm --filter @lucy-spa/ui test` 468/468; `pnpm --filter @lucy-spa/web test` 886/886; typecheck, eslint, prettier sạch; chạy lại toàn bộ `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` trước khi push (xem báo cáo cuối).
4. **Phạm vi chung của CSS dùng chung**: đổi popup (chữ tiêu đề có chân), ô chọn (mũi tên riêng, `.ls-site` only), ô tìm (chừa chỗ cho biểu tượng, `.ls-site` only) chỉ có hiệu lực trong khung khách (`.ls-site`), trừ popup (cũng có bản xem trước trong admin: tiêu đề popup ở đó cũng đổi sang chữ có chân; không đổi nghiệp vụ).
5. **Ảnh đã xem và chưa xem (nói đúng)**: không mở hết từng ảnh một (khoảng 330 ảnh sau). Đã mở và xem: trang chủ cả 6 kích cỡ/chế độ; popup 6; hover (sáng và tối); chữ 130% (4); trạng thái ngoại lệ (không ảnh trượt, tiêu đề dài, lỗi API, lớp Tết); và với các trang khác chủ yếu bản 1440 sáng (cả trang hoặc 1000 px đầu), 360 sáng, và 360 tối ở dịch vụ, điểm thưởng, chi tiết dịch vụ, đăng nhập; 768 sáng ở dịch vụ, đăng nhập. **Các ảnh còn lại (768 tối và đa số 360/1440 tối của từng trang) đã chụp nhưng chưa mở**; chúng dùng cùng mã với ảnh đã xem và token màu, và đã qua DOM audit ở chế độ sáng (chế độ tối chưa chạy audit). Xem tất cả trong thư viện ảnh.
6. **Chưa kiểm tra / không sửa**: thao tác chạm thật trên điện thoại; bản xem trước theo mùa trong admin (không đọc chiến dịch); các mùa khác ngoài Tết mẫu; tiếng Anh chỉ kiểm bằng kiểm thử (không chụp ảnh `/en`); thanh tab 5 mục ở chữ 130% (nhãn xuống 2 dòng); hai ảnh mẫu của lớp Tết bị hỏng là dữ liệu mẫu, không phải lỗi của trang.

## 11. Đã triển khai lên production (chủ báo, 2026-10-09)

- **Commit đang chạy:** `9a575894312b04768553b9fad35fc7a3ce4c34d0` (đợt chỉnh toàn bộ trang khách), triển khai ngày 2026-10-09 khoảng 19:23 (UTC+7). Bản trước đó: `4b91af6`. Chỉ nạp lại web (`pm2 reload lucyspa-web`); API và worker không khởi động lại. Migration vẫn 101, quyền vẫn 66.
- **Bản sao lưu trước khi triển khai:** `/root/backups/lucyspa-pre-polish1-20261009T121951Z.dump` (1.328.082 byte, cơ sở dữ liệu) và `/root/backups/lucyspa-web-pre-polish1-20261009T121952Z.tgz` (325.737.415 byte, phần mềm web; dùng để quay lại).
- **Kiểm tra sau triển khai:** pm2: web 3, api 1, worker 1 đều online. `/health/ready` ok; `/vi`, `/vi/services`, `/vi/products`, `/vi/workforce/login` trả 200; địa chỉ không có trả 404; bán online `"enabled":false`.
- **Một kết quả khác mong đợi:** `grep -c "Không tìm thấy trang này"` trên HTML của trang 404 ra **0**. Trang **không sai**. Nguyên nhân (tái hiện trên máy, Next 16.3.5): trang 404 của khung khách là thành phần phía trình duyệt (`not-found.tsx` có `'use client'`, dùng `usePathname`), nên máy chủ trả HTML thô gần như rỗng (mã 404, `noindex`, dấu hiệu `NEXT_HTTP_ERROR_FALLBACK;404`) và trình duyệt vẽ khung, tiêu đề, nút sau khi tải; chữ nằm trong tệp JS chứ không trong HTML. Mở trang bằng trình duyệt thật cho thấy đủ tiêu đề, hai nút, menu và chân trang (kiểm bằng `scripts/uxui-screens.mjs --expect "Không tìm thấy trang này"`, đạt). Hệ quả cần biết: người tắt JavaScript chỉ thấy trang trống ở địa chỉ không có (đây là trang 404, không được đưa lên công cụ tìm kiếm nên không ảnh hưởng SEO). Không đổi trang.
- **Đã sửa runbook:** `docs/DEPLOY_UI_POLISH_RUNBOOK.md` Bước 5 nay đếm `NEXT_HTTP_ERROR_FALLBACK;404` thay vì chữ tiêu đề, và ghi rõ vì sao không tìm chữ bằng `curl`; chữ tiêu đề vẫn được kiểm bằng mắt ở Bước 6, mục 5.
