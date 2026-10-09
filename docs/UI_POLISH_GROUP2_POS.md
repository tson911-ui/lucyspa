# UI polish, nhóm 2: màn hình quầy (POS) (Bước A)

Chỉ đổi giao diện. Không đổi nghiệp vụ, API, cơ sở dữ liệu hay dữ liệu. Luật nền: mục "UI design rules" và "UX quality gate" trong `CLAUDE.md`
(đỏ `#782b37` + trắng, không vàng, giữ chữ và logo hiện có). Đã dùng skill `frontend-design` để nâng bố cục, thứ bậc thông tin và lời văn, không đổi thương hiệu.

Trạng thái: **bản mẫu một màn hình (Bảng hóa đơn) đã làm, chờ chủ duyệt hướng**. Commit cục bộ, chưa push, chưa deploy. Các màn hình còn lại chưa đụng.

## 1. Danh sách màn hình của quầy

| Nhóm           | Màn hình                                                                                                          | Đường dẫn (`/vi/workforce/...`)                                  | Ảnh "trước" (`.local/uxui-screens/`)           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Hóa đơn        | **Bảng hóa đơn** (lượt khách chờ lập hóa đơn, hóa đơn gần đây)                                                    | `pos`                                                            | `g2-before-pos-*`                              |
|                | Chi tiết hóa đơn: đã thanh toán, chờ thanh toán, bản nháp, đã hủy                                                 | `pos/{id}`                                                       | `g2-before-pos-paid/pending/draft/cancelled-*` |
|                | Hộp thoại: Bán sản phẩm, Bán combo, Thu tiền mặt, QR PayOS, Sửa giá, Mã ưu đãi, Đổi người thanh toán, Hủy hóa đơn | mở từ bảng và chi tiết hóa đơn                                   | **chưa chụp** (xem mục 6)                      |
| Tiếp khách     | Khách vãng lai (nhận khách)                                                                                       | `walk-in`                                                        | `g2-before-walkin-*`                           |
|                | Lịch hẹn hôm nay (bảng điều phối)                                                                                 | `booking-board`                                                  | `g2-before-bookingboard-*`                     |
| Sau bán        | Trả hàng: danh sách, mở hồ sơ, chi tiết (đổi hàng, hoàn tiền)                                                     | `product-returns`, `product-returns/new`, `product-returns/{id}` | `g2-before-returns*-*`                         |
| Hàng đặt trước | Danh sách (5 tab), chi tiết đơn                                                                                   | `product-orders`, `product-orders/{id}`                          | `g2-before-preorders*-*`                       |
| Đơn online     | Danh sách (6 tab), chi tiết đơn                                                                                   | `online-orders`, `online-orders/{id}`                            | `g2-before-online*-*`                          |

Mỗi màn hình chụp 360, 768, 1440 px sáng và 360, 768, 1440 px tối (6 ảnh). Dữ liệu: CSDL scratch `lucy_spa_polish1_scratch` (không phải dev hay production),
đã thêm 5 lượt khách làm xong (2 còn chờ lập hóa đơn, 3 có hóa đơn: nháp, chờ thanh toán), 1 hóa đơn bán combo chờ thanh toán, khách lẻ, và một tên khách rất dài, để bảng không rỗng như lần chụp đầu.

## 2. Lỗi đã thấy, theo màn hình (nói đơn giản)

### Bảng hóa đơn (màn hình thu ngân dùng nhiều nhất)

1. **Thông tin thu ngân cần thì bị giấu, thông tin thừa thì để lại.** Cột "Ngày ghi nhận" lặp cùng một ngày ở mọi dòng; còn tên khách thanh toán bị ẩn trên máy tính bảng (768 px), nơi quầy hay dùng nhất.
2. **Tên khách bị cắt** thành "Hoàng Thị L…", "Khách lẻ (kh…" dù bảng còn chỗ trống; cột "Loại" chiếm chỗ bằng mã lượt khách rất dài ("Lượt khách VS-…").
3. **Không biết hóa đơn nào mới và nào cần thu tiền.** Không có giờ lập, không lọc theo trạng thái; muốn tìm hóa đơn "Chờ thanh toán" phải đọc từng dòng trong 7 ngày.
4. **Lời dẫn dài hai dòng**, nói về quy tắc giá thay vì việc cần làm. Chú thích "Hiển thị 7 ngày gần nhất, tính đến ngày đã chọn (giờ chi nhánh)" dài, đặt ở chỗ đáng lẽ là số kết quả.
5. **Ô chọn chi nhánh cắt tên** ("Lucy Spa Đà Nẵng - 04 Nguyễn Qu") và luôn hiện dù chỉ có một chi nhánh.
6. **Không có lượt khách chờ vẫn chiếm một khung viền cao khoảng 90 px**, ngang với bảng hóa đơn thật.
7. **Điện thoại (360 px):** mỗi hóa đơn là một thẻ cao khoảng 340 px (đo trên ảnh) với 6 dòng có nhãn, nhãn "Người thanh toán" xuống hai dòng; 20 hóa đơn dài khoảng 6.800 px.
8. Ô chọn ngày hiện `10/09/2026` ở máy chụp (trình duyệt tiếng Anh). Ở trình duyệt tiếng Việt, ô này theo ngôn ngữ trình duyệt nên có thể đúng `dd/mm/yyyy`; **chưa kiểm được trên máy thật**, xem mục 7.

### Chi tiết hóa đơn

1. **Nút thu tiền nằm cuối trang, cách đầu khoảng 1.700 px** (ở hóa đơn chờ thanh toán): thu ngân phải cuộn qua sản phẩm, ưu đãi, mã ưu đãi, người thanh toán mới thấy "Thu tiền mặt" và "Tạo mã QR PayOS".
2. Thẻ "Đơn đặt trước" xếp mỗi nhãn một dòng, mỗi giá trị một dòng, cột hẹp, trống nửa chiều ngang.
3. Thẻ "Mã ưu đãi" rỗng cao khoảng 150 px chỉ để nói "Chưa nhập mã nào."; khối "Thanh toán" có lời dẫn kỹ thuật dài.
4. Hai lối quay lại: dòng "Quay lại" và breadcrumb "Hóa đơn › mã".

### Khách vãng lai

1. Biểu mẫu hẹp, đặt giữa trang, còn tiêu đề và "Quay lại" lệch trái nên mép trang không thẳng với các trang khác.
2. Thẻ có khoảng trống lớn với dòng "Thêm ít nhất một khách và một dịch vụ." ở giữa; nút "Tiếp nhận khách" mờ vì chưa đủ điều kiện nhưng không nói thiếu gì cụ thể.
3. "Thêm trẻ em" mờ kèm ghi chú nhỏ ngay dưới, khó đọc.

### Lịch hẹn hôm nay

1. Bốn khối liền nhau, **hai khối rỗng chiếm khung viền lớn**, khối thứ ba dùng viền nét đứt (kiểu rỗng khác hẳn): trông như lỗi.
2. Ngày hiển thị `2026-10-09` (kiểu máy), không phải `dd/mm/yyyy` như nơi khác.
3. Cột "Mốc giờ" cắt chữ ("Bắt đầu 00:39, dự kiến xong 02…") khi cần đọc đủ.

### Trả hàng

1. **Cột cuối "Mở lúc" bị cắt mất ở mép phải** ("18:36 08/10/202"): giờ và ngày đều nằm trong ô nhưng bị bảng che.
2. Cột "Lý do" lặp cùng một chữ ở hầu hết dòng ("Khách đổi ý"), "55 kết quả" đứng riêng trên thanh công cụ.
3. Mở hồ sơ mới: một ô nhập đơn lẻ trong thẻ giữa trang, phần còn lại của trang trống.
4. Chi tiết: cặp nhãn - giá trị hai cột dài 14 dòng; "Ảnh bằng chứng" rỗng cao khoảng 200 px.

### Hàng đặt trước và Đơn online

1. Tên nhà cung cấp bị cắt ("Công ty Mỹ phẩm Hoa Sen MU…") và lặp ở mọi dòng.
2. Ở "Đơn online" chỉ có một dòng, bảng và dòng "Hiển thị 1-1 trong 1" đứng giữa màn hình trống.
3. Tab, ô tìm, "14 kết quả" và nút tải lại ở ba chỗ khác nhau, không thẳng hàng với ô tìm.

### Chung cho mọi màn hình quầy

- Hover hàng bảng (sáng) là nền hồng nhạt, **không đúng luật 4** (sáng = đỏ `#782b37` đặc, chữ trắng). Xem mục 7: đây là CSS dùng chung của mọi bảng nhân viên, nên chưa sửa trong bản mẫu.
- Trạng thái rỗng có ba kiểu (khung viền liền, khung nét đứt, một dòng chữ).
- Thanh tác vụ lệch: nút chính nằm ở tiêu đề, một số trang lại đặt nút phụ trong thẻ.

## 3. Hướng thiết kế (trong luật của `CLAUDE.md`, chờ chủ duyệt)

**Giữ nguyên:** đỏ `#782b37` và trắng, chế độ sáng/tối, hai bộ chữ đã duyệt, thang khoảng cách, một mặt thẻ (`Card`), `DataTable`, `ListToolbar`, `PageHeader`, nút ⋮ cho hành động trên dòng, mọi luật FR1-FR15.

**Cải thiện (thứ bậc theo cách thu ngân làm việc):**

- **Mỗi màn hình trả lời một câu hỏi.** Bảng hóa đơn: "việc gì đang chờ, hóa đơn nào chưa thu tiền?". Nên: việc chờ ở trên (lượt khách chờ lập hóa đơn), hóa đơn có **khách, nội dung, giờ, trạng thái, tiền** trong một dòng, lọc theo trạng thái.
- **Thông tin cần nhất không bao giờ bị ẩn trước thông tin phụ** (khách ở lại ở 768 px, người bán và giờ lập mới bị ẩn trước).
- **Không lặp giá trị cả cột**: ngày chỉ hiện khi khác ngày đang xem.
- **Trạng thái rỗng một kiểu:** nơi "không có việc" là một dòng chữ nhỏ dưới tiêu đề; chỉ nơi cần hướng dẫn mới có khung (có câu và nút).
- **Hóa đơn chi tiết (bước sau):** đưa khối thanh toán và tóm tắt tiền lên đầu (hai cột trên máy tính), phần ưu đãi, đơn đặt trước ở dưới.
- **Lời văn ngắn, tự nhiên, không "khám":** lời dẫn là việc cần làm, không phải quy tắc kỹ thuật.
- **Chuyển động:** không thêm hiệu ứng mới (giữ nhịp hiện có), tôn trọng giảm chuyển động.

**Yếu tố đặc trưng (một):** _dòng hóa đơn đọc được trong một liếc_: khách, nội dung, giờ, trạng thái, tiền. Mọi thứ khác giữ yên.

## 4. Thứ tự đề xuất cho nhóm 2 (sau khi chủ duyệt bản mẫu)

(1) Chi tiết hóa đơn và các hộp thoại thanh toán; (2) Khách vãng lai và Lịch hẹn hôm nay; (3) Trả hàng (danh sách, mở hồ sơ, chi tiết); (4) Hàng đặt trước và Đơn online. Mỗi lượt có ảnh trước/sau và cổng chất lượng riêng.

## 5. Bản mẫu đã làm: Bảng hóa đơn

- **Lời dẫn một dòng:** "{tên chi nhánh}: lập hóa đơn cho khách đã làm xong, thu tiền và bán sản phẩm." Ghi chú cửa sổ thời gian ngắn: "7 ngày gần nhất, tính đến ngày đã chọn."
- **Ô chọn chi nhánh chỉ hiện khi có nhiều chi nhánh**; một chi nhánh thì tên nằm ở lời dẫn (hết bị cắt).
- **Thêm bộ lọc "Trạng thái"** (Mọi trạng thái, Chờ thanh toán, Đã thanh toán, Bản nháp, Đã hủy) cùng hàng với ô ngày; lọc trên các dòng bảng đã tải (7 ngày), nút "Xóa bộ lọc" xóa cả ngày lẫn trạng thái. Không đổi API.
- **Hóa đơn: cột mới theo thứ tự quan trọng:** Mã hóa đơn, **Lập lúc** (giờ theo chi nhánh; ngày khác thì có `dd/mm`), **Khách** (đầy đủ, "Khách lẻ" thay cho "Khách lẻ (không tài khoản)"), **Nội dung** ("Dịch vụ", "Dịch vụ + 2 sản phẩm", "3 sản phẩm", "Bán combo: tên"), Người bán, Trạng thái, Tổng tiền. Bỏ cột "Ngày ghi nhận".
- **Khách luôn hiện trên mọi cỡ màn hình** (trước đây ẩn ở 768 px). Nội dung ẩn dưới 1024 px, người bán ẩn dưới 1280 px như trước.
- **Lượt khách chờ:** bỏ cột ngày lặp; "Dịch vụ đã làm" hiện "2 dịch vụ" thay vì số `2` đứng một mình; giờ hoàn thành có ngày khi khác ngày đang xem. **Không có lượt chờ thì chỉ còn một dòng chữ nhỏ**, hết khung 90 px.
- **Điện thoại:** thẻ hóa đơn còn 4 dòng (Khách, Nội dung, Trạng thái, Tổng tiền) thay vì 6, vì "Lập lúc" và "Người bán" không hiện trên điện thoại: mỗi thẻ cao khoảng 250 px thay vì 340 px (đo trên ảnh), 20 thẻ khoảng 5.000 px thay vì 6.800 px. Vẫn là thẻ cao; chưa có kiểu dòng gọn hơn cho điện thoại, xem câu hỏi 7. Cần tính năng chung mới của bảng: `hidePhone` (xem dưới).
- **Chữ:** "Dịch vụ đã thực hiện" thành "Dịch vụ đã làm", "Người thanh toán" thành "Khách" trên bảng này (trang chi tiết vẫn dùng "Người thanh toán").

**Tệp:** `apps/web/src/components/workforce/screens/pos.tsx`, `apps/web/src/lib/workforce/pos.ts` (hai hàm thuần mới: `boardStamp`, `invoiceContent`), `apps/web/src/i18n/workforce.ts` (vi và en), kiểm thử `apps/web/src/lib/workforce/pos.test.tsx`; **bộ dùng chung `packages/ui`:** thêm cột tùy chọn `hidePhone` cho `DataTable` (`data-table.tsx`, `components.css`, một kiểm thử). Tính năng này **chỉ có tác dụng ở bảng nào bật nó** (hiện chỉ bảng hóa đơn), nên mọi bảng admin khác không đổi; DOM audit và bộ đếm ratchet được chạy để chứng minh (mục 6).
Không có migration, không đổi API, không có quyền mới, không đổi dữ liệu.

## 6. Cổng chất lượng (ghi chú UX gate)

1. **Ảnh bản mẫu "sau"** (`.local/uxui-screens/g2-after-pos-*`, `g2-after-t130-*`, `g2-after-hover-*`, `g2-after-empty-*`, `g2-after-status-*`), cùng dữ liệu với ảnh "trước" (`g2-before-pos-*`). **Đã mở và xem:** sau 1440 sáng, 1440 tối, 768 sáng, 360 sáng (cả trang); chữ 130% ở 360 sáng; hover 1440 sáng và tối; trạng thái "không có dữ liệu" (đổi ngày về tháng 8) 1440 sáng; bộ lọc "Đã hủy" 1440 sáng; trước 1440 sáng, 1440 tối (bản đầu), 768 sáng, 360 sáng. **Có chụp nhưng chưa mở:** sau 768 tối, 360 tối, chữ 130% ở 768 và tối, trạng thái rỗng và lọc ở 360 và tối, trước 768 tối và 360 tối. Chúng dùng cùng mã với ảnh đã xem; không dùng làm bằng chứng.
2. **Phát hiện khi xem:** (a) lần đầu `hidePhone` không có tác dụng vì quy tắc thẻ điện thoại cụ thể hơn; đã sửa (chèn sau quy tắc đó, kể cả thẻ cuối) và chụp lại; (b) bộ lọc trạng thái trên điện thoại nằm trong ngăn "Bộ lọc" nên ảnh 360 của trạng thái lọc không thể hiện việc lọc (không dùng làm bằng chứng); (c) hover hàng bảng sáng là nền hồng nhạt (xem mục 7, câu hỏi 1); (d) các hàng cũ có giờ lập 00:39 là dữ liệu mẫu cũ, không phải lỗi.
3. **Luật cứng:** chỉ token (không hex, không lớp `wf-` mới, không đơn vị px/rem trong CSS mới); bảng không có số hay ký hiệu cạnh tiêu đề (số "Hiển thị 1-2 trong 2" là dòng của bảng).
4. **Chưa kiểm được:** hộp thoại (bán sản phẩm, bán combo, thu tiền) và chi tiết hóa đơn chưa chụp "trước" nên chưa nằm trong cổng; trạng thái đang tải và lỗi của bảng hóa đơn dùng thành phần dùng chung, không đổi ở bước này, nên không chụp lại; cảm ứng thật trên điện thoại và máy tính bảng; tiếng Anh chỉ kiểm bằng kiểm thử. Ở 768 px thanh bên rút gọn có 27 mục tiêu chạm 40x44 px (khung chung của khu nhân viên, có từ trước, không thuộc bản mẫu).
5. **DOM audit và kiểm thử:** xem phần "Kết quả chạy" ở cuối tệp.

## 6b. Kết quả chạy

- **DOM audit 26 trang nhân viên so với `docs/uxui-audit-baseline.json`** (sáng, 360 / 768 / 1440; chạy trên CSDL scratch `lucy_spa_polish1_scratch`, **không phải** `lucy_spa_uxaudit_20261001`: đây là bản sao của CSDL audit, nâng lên 101 migration, có thêm dữ liệu hóa đơn ở trên): **không loại phát hiện nào tăng** (mọi loại bằng hoặc thấp hơn baseline; `edge-left` 4 và `unpaged-list` 3 bằng baseline). Trang `pos`: 42 phát hiện trong baseline, 1 bây giờ: ở 360 px, độ cao thẻ 240-260 px (hai độ cao, do tên combo dài xuống dòng). Baseline là ngày 2026-10-01, nên mức giảm phần lớn đến từ các bước trước; **chưa chạy audit riêng cho bản ngay trước bước này**.
- **Kiểm thử:** `pnpm --filter @lucy-spa/ui test` 469/469; `pnpm --filter @lucy-spa/web test` 888/888 (gồm bộ đếm ratchet `ui-ratchet.test.ts`: không đổi, không cần `UPDATE_RATCHET`); typecheck web và ui, eslint các tệp đổi, prettier toàn repo sạch. Chưa chạy `pnpm test` toàn repo (chỉ cần trước khi push; chưa push).
- **Không đụng** `apps/web/next-env.d.ts`.

## 7. Việc chờ chủ (câu hỏi cho chủ, chưa tự quyết)

1. **Hover của hàng bảng (luật 4).** Hàng bảng nhân viên hiện nền hồng nhạt khi rê chuột ở chế độ sáng; luật 4 nói hover ở chế độ sáng là đỏ đặc, chữ trắng. Đổi sẽ ảnh hưởng **mọi bảng nhân viên** (kể cả hàng không bấm được). Muốn (a) đổi cho mọi bảng, (b) chỉ cho bảng có hàng bấm được, hay (c) giữ hồng nhạt cho hàng bảng?
2. **Định dạng ngày** trên ô chọn ngày và dòng "Ngày 2026-10-09" ở Lịch hẹn hôm nay: dùng ô nhập `dd/mm/yyyy` như trang đăng ký của khách (nhóm 1) cho nhân viên không? Ô ngày gốc theo ngôn ngữ trình duyệt.
3. **Bộ lọc trạng thái** trên bảng hóa đơn (lọc trên 7 ngày đã tải, không đổi API): giữ không? Nếu muốn **tìm theo mã hoặc tên khách** thì cần thêm ô tìm (làm được ở giao diện, vẫn trên các dòng đã tải).
4. **Chi tiết hóa đơn:** đưa khối "Thanh toán" lên đầu trang (hai cột) có được không? Đây là thay đổi thứ tự lớn nhất, chỉ làm sau khi chủ đồng ý.
5. **Thứ tự các lượt** ở mục 4 (đề xuất của tôi): giữ hay đổi?
6. **Bản mẫu này:** duyệt để làm tiếp, hay sửa gì?
7. **Danh sách trên điện thoại:** muốn một kiểu dòng gọn hơn (mã + khách + tiền trong hai dòng) cho thu ngân dùng điện thoại, thay vì thẻ 4 dòng? Cần thay đổi thẻ của `DataTable` dùng chung, nên chỉ làm khi chủ muốn.
