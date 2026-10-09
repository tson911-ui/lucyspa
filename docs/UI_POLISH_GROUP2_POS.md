# UI polish, nhóm 2: màn hình quầy (POS) (Bước A)

Chỉ đổi giao diện. Không đổi nghiệp vụ, API, cơ sở dữ liệu hay dữ liệu. Luật nền: mục "UI design rules" và "UX quality gate" trong `CLAUDE.md`
(đỏ `#782b37` + trắng, không vàng, giữ chữ và logo hiện có). Đã dùng skill `frontend-design` để nâng bố cục, thứ bậc thông tin và lời văn, không đổi thương hiệu.

Trạng thái: **xong toàn bộ nhóm 2 (mục 9 đến 13), chờ chủ triển khai**. Chủ đã duyệt bản mẫu và thứ tự (2026-10-09), kèm 5 quyết định ở mục 8. Hướng dẫn triển khai: `docs/DEPLOY_UI_POLISH_GROUP2_RUNBOOK.md`.

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

- **Lời dẫn một dòng:** "{tên chi nhánh}: lập hóa đơn cho khách đã làm xong và thu tiền." (không nhắc "bán sản phẩm" vì thu ngân không có quyền đó sẽ không thấy nút). Ghi chú cửa sổ thời gian ngắn: "7 ngày gần nhất, tính đến ngày đã chọn."
- **Ô chọn chi nhánh chỉ hiện khi có nhiều chi nhánh**; một chi nhánh thì tên nằm ở lời dẫn (hết bị cắt).
- **Thêm bộ lọc "Trạng thái"** (Mọi trạng thái, Chờ thanh toán, Đã thanh toán, Bản nháp, Đã hủy) cùng hàng với ô ngày; lọc trên các dòng bảng đã tải (7 ngày), nút "Xóa bộ lọc" xóa cả ngày lẫn trạng thái. Không đổi API.
- **Hóa đơn: cột mới theo thứ tự quan trọng:** Mã hóa đơn, **Lập lúc** (giờ theo chi nhánh; ngày khác thì có `dd/mm`), **Khách** (đầy đủ, "Khách lẻ" thay cho "Khách lẻ (không tài khoản)"), **Nội dung** ("Dịch vụ", "Dịch vụ + 2 sản phẩm", "3 sản phẩm", "Bán combo: tên"), Người bán, Trạng thái, Tổng tiền. Bỏ cột "Ngày ghi nhận".
- **Khách luôn hiện trên mọi cỡ màn hình** (trước đây ẩn ở 768 px). Nội dung ẩn dưới 1024 px, người bán ẩn dưới 1280 px như trước.
- **Lượt khách chờ:** bỏ cột ngày lặp; "Dịch vụ đã làm" hiện "2 dịch vụ" thay vì số `2` đứng một mình; giờ hoàn thành có ngày khi khác ngày đang xem. **Không có lượt chờ thì chỉ còn một dòng chữ nhỏ**, hết khung 90 px.
- **Điện thoại:** thẻ hóa đơn còn 4 dòng (Khách, Nội dung, Trạng thái, Tổng tiền) thay vì 6, vì "Lập lúc" và "Người bán" không hiện trên điện thoại: mỗi thẻ cao khoảng 250 px thay vì 340 px (đo trên ảnh), 20 thẻ khoảng 5.000 px thay vì 6.800 px. Vẫn là thẻ cao; chưa có kiểu dòng gọn hơn cho điện thoại, xem câu hỏi 7. Cần tính năng chung mới của bảng: `hidePhone` (xem dưới).
- **Chữ:** "Dịch vụ đã thực hiện" thành "Dịch vụ đã làm", "Người thanh toán" thành "Khách" trên bảng này (trang chi tiết vẫn dùng "Người thanh toán").

**Tệp:** `apps/web/src/components/workforce/screens/pos.tsx`, `apps/web/src/lib/workforce/pos.ts` (hai hàm thuần mới: `boardStamp`, `invoiceContent`), `apps/web/src/i18n/workforce.ts` (vi và en), kiểm thử `apps/web/src/lib/workforce/pos.test.tsx`; **bộ dùng chung `packages/ui`:** thêm cột tùy chọn `hidePhone` cho `DataTable` (`data-table.tsx`, `components.css`, một kiểm thử). Tính năng này **chỉ có tác dụng ở bảng nào bật nó** (hiện chỉ bảng hóa đơn), nên mọi bảng admin khác không đổi; DOM audit và bộ đếm ratchet cho thấy không loại nào tăng so với baseline (mục 6b), chưa so với bản ngay trước bước này.
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
- **CI:** commit `7164c23` (và hai lần chạy lại `9f06672`, `2eabd0f`) trượt **chỉ ở bước `pnpm test:auth:integration`** (bộ kiểm thử tích hợp của API, CSDL thật), trong khoảng 15:14-16:22 UTC. Diff chỉ nằm ở `apps/web`, `packages/ui`, tài liệu. Cùng bước đó chạy ở máy này trên CSDL mới: **926 kiểm thử, 0 lỗi** (cả với `TZ=UTC`); bản cũ `18b05d1` đẩy lên nhánh thử lúc 17:16 UTC thì xanh; `ee62668` và `4e71ddc` (chỉ tài liệu) cũng từng trượt như vậy trong ngày. Kiểm thử `my-income.integration.test.ts` đã ghi chú đúng cửa sổ 15:00-17:00 UTC (Tokyo sang ngày mới trước Việt Nam). Chạy lại lúc 17:37 UTC: **xanh** (commit `2ed632d`, run `37967549325`). Không sửa mã API (ngoài phạm vi chỉ giao diện); ghi để chủ biết CI có thể đỏ trong cửa sổ giờ đó.
- **Không đụng** `apps/web/next-env.d.ts`.

## 7. Việc chờ chủ (câu hỏi cho chủ, chưa tự quyết)

1. **Hover của hàng bảng (luật 4).** Hàng bảng nhân viên hiện nền hồng nhạt khi rê chuột ở chế độ sáng; luật 4 nói hover ở chế độ sáng là đỏ đặc, chữ trắng. Đổi sẽ ảnh hưởng **mọi bảng nhân viên** (kể cả hàng không bấm được). **Đã thử dựng bằng cách chèn CSS (không nằm trong mã):** hàng đặc đỏ `#782b37` chữ trắng đọc rõ, link trắng gạch chân đọc rõ, nhãn trạng thái vẫn đọc được (nền nhạt giữ nguyên), nhưng **nút ⋮ cuối dòng gần như biến mất** (biểu tượng tối trên nền đỏ) nên phải đổi cả màu biểu tượng; đổi chữ trắng mà quên nền ô thì chữ trắng trên nền hồng nhạt không đọc được (ảnh `g2-hoversolid-D9JJJ3-1440-light.png`, `.local/uxui-screens/`). Muốn (a) đổi cho mọi bảng, (b) chỉ cho bảng có hàng bấm được, hay (c) giữ hồng nhạt cho hàng bảng?
2. **Định dạng ngày** trên ô chọn ngày và dòng "Ngày 2026-10-09" ở Lịch hẹn hôm nay: dùng ô nhập `dd/mm/yyyy` như trang đăng ký của khách (nhóm 1) cho nhân viên không? Ô ngày gốc theo ngôn ngữ trình duyệt.
3. **Bộ lọc trạng thái** trên bảng hóa đơn (lọc trên 7 ngày đã tải, không đổi API): giữ không? Nếu muốn **tìm theo mã hoặc tên khách** thì cần thêm ô tìm (làm được ở giao diện, vẫn trên các dòng đã tải).
4. **Chi tiết hóa đơn:** đưa khối "Thanh toán" lên đầu trang (hai cột) có được không? Đây là thay đổi thứ tự lớn nhất, chỉ làm sau khi chủ đồng ý.
5. **Thứ tự các lượt** ở mục 4 (đề xuất của tôi): giữ hay đổi?
6. **Bản mẫu này:** duyệt để làm tiếp, hay sửa gì?
7. **Danh sách trên điện thoại:** muốn một kiểu dòng gọn hơn (mã + khách + tiền trong hai dòng) cho thu ngân dùng điện thoại, thay vì thẻ 4 dòng? Cần thay đổi thẻ của `DataTable` dùng chung, nên chỉ làm khi chủ muốn.

## 8. Quyết định của chủ (2026-10-09, nguyên văn rút gọn) và cách làm

Chủ duyệt bản mẫu Bảng hóa đơn và thứ tự ở mục 4 (câu hỏi 5, 6), rồi quyết định:

1. **Hover hàng bảng (câu hỏi 1):** áp luật 4 cho **mọi bảng nhân viên**: chế độ sáng nền đỏ đặc `#782b37`, chữ trắng, biểu tượng (⋮, v.v.) cũng trắng; chế độ tối dùng màu hồng nhấn của chế độ tối. Kiểm lại mọi bảng nhân viên vẫn đọc tốt.
2. **Ô ngày của nhân viên (câu hỏi 2):** nhập `dd/mm/yyyy` như trang đăng ký của khách.
3. **Bảng hóa đơn (câu hỏi 3):** giữ bộ lọc trạng thái và **thêm ô tìm** (mã hóa đơn, tên hoặc số điện thoại khách, không phân biệt dấu).
4. **Chi tiết hóa đơn (câu hỏi 4):** đưa khối thanh toán lên đầu trang.
5. **Danh sách trên điện thoại (câu hỏi 7):** dòng gọn thay cho thẻ 4 dòng.

Sau đó: làm mọi màn hình quầy còn lại theo thứ tự mục 4 (chi tiết hóa đơn, hộp thoại bán sản phẩm/combo, thanh toán và PayOS, trả hàng/đổi hàng/hoàn tiền, hàng đặt trước, đơn online, nhận khách/lịch hẹn và mọi thứ khác ở quầy), chỉ đổi giao diện; rồi đẩy `main`, chờ CI xanh, viết hướng dẫn deploy như nhóm 1. Chủ không muốn server bị đụng.

## 9. Đã làm (toàn bộ nhóm 2, chỉ giao diện)

Trạng thái: **xong, đã qua cổng chất lượng, đã chạy các luồng quầy trên CSDL scratch**. Không có migration, không đổi API, không đổi quyền, không đổi dữ liệu.

**Dùng chung (`packages/ui`):**

- **Rê chuột vào dòng bảng nhân viên (luật 4):** nền đỏ đặc `#782b37`, chữ, liên kết, chữ phụ và biểu tượng ⋮ đều trắng; chế độ tối dùng màu hồng nhấn có sẵn. Nhãn trạng thái giữ màu riêng; nút ⋮ có viền khi rê vào để không chìm vào dòng. Chỉ áp trong khung nhân viên (`.ls-shell`); bảng của khách (hóa đơn, lịch hẹn trong tài khoản) giữ nền hồng nhạt như cũ (đã so ảnh).
- **Ô ngày của nhân viên nhập `dd/mm/yyyy`** (`DateTextInput`, `date-text-core.ts`): giá trị vẫn là ngày ISO, nên mọi nơi dùng không đổi cách đọc. Gõ nửa chừng không báo gì và về ngày đang dùng khi rời ô; ô hiện lỗi khi ngày ngoài `min`/`max`. Đổi ở 12 màn hình nhân viên (chấm công, lịch CTV, tạo và sửa nhân sự, vòng đời nhân sự, phiếu nhập kho, nghỉ phép, hồ sơ của tôi, thu nhập, đơn online, hóa đơn, đổi kỹ thuật viên, mùa trang trí). Ô ngày của **khách** (đặt lịch) không đổi.
- **Dòng gọn trên điện thoại** cho `DataTable` (`phoneRows="compact"`, `phoneEmphasis`): một mặt danh sách, mỗi dòng hai hàng (mã, số tiền, ⋮; rồi các trường không nhãn). Bật ở: bảng hóa đơn và lượt chờ lập hóa đơn, danh sách trả hàng, các tab hàng đặt trước (trừ tab Cần đặt) và đơn online. Các trường phụ (giờ, người bán, lý do, số lượng) ẩn trên điện thoại và vẫn có ở máy tính và trong trang chi tiết.
- Ô nhập tiền trong hộp thoại (thu tiền mặt, PayOS, sửa giá) hiện dấu chấm nghìn (`329.000 ₫`); yêu cầu gửi lên API vẫn là chuỗi số như trước. Bỏ "(₫)" thừa ở nhãn.
- **Thanh trên của khu nhân viên ở điện thoại (360 px):** khe hở giữa nút menu, logo, chuông và tài khoản hẹp lại để không cuộn ngang ở cỡ chữ 130%; mục tiêu chạm giữ nguyên cỡ.

**Từng màn hình (ngắn):**

- **Bảng hóa đơn:** thêm ô tìm (mã hóa đơn, tên khách, mã lượt khách, tên combo; không phân biệt dấu); bộ lọc trạng thái giữ; ô chọn chi nhánh chỉ khi có nhiều chi nhánh; điện thoại dùng dòng gọn (20 hóa đơn khoảng 2.200 px thay vì 6.800 px).
- **Chi tiết hóa đơn:** khối **Thanh toán đứng đầu** (còn phải thu, nút thu tiền, lịch sử thu); lời dẫn ngắn; "Chưa nhập mã nào", "Chưa có khoản thu nào", "Chưa có ghi chú" là một dòng chữ nhỏ thay cho khung rỗng cao khoảng 150 px; thẻ Đơn đặt trước hai cột; trang lỗi không lặp "Hóa đơn" ở đường dẫn và tiêu đề.
- **Hộp thoại thanh toán và sửa giá:** ô tiền có dấu nghìn (ở trên). Các hộp thoại còn lại (bán sản phẩm, bán combo, mã ưu đãi, đổi người thanh toán, hủy hóa đơn, đổi hàng, hoàn tiền, gửi hàng, sửa địa chỉ, ghi nhật ký) đã chụp và xem; bố cục đã đúng chuẩn nên không đổi.
- **Khách vãng lai:** chi nhánh chỉ hỏi khi có nhiều; lời dẫn một dòng có tên chi nhánh; dòng "Thêm ít nhất một khách và một dịch vụ" là chữ nhỏ thay cho khung rỗng.
- **Lịch hẹn hôm nay:** ngày hiện `09/10/2026`; ba khối rỗng cùng một kiểu (dòng chữ nhỏ), hết khung nét đứt; cột "Mốc giờ" xuống dòng thay vì cắt; chi nhánh chỉ hỏi khi có nhiều.
- **Trả hàng (danh sách):** cột "Mở lúc" không còn bị cắt (cột "Lý do" chỉ hiện từ màn hình rất rộng); ô tìm đủ chữ; điện thoại dùng dòng gọn (20 hồ sơ khoảng 2.700 px thay vì 5.000 px). **Chi tiết:** "Chưa có ảnh nào" là một dòng chữ nhỏ.
- **Hàng đặt trước và Đơn online (danh sách):** có khoảng cách giữa thanh công cụ và bảng; tên nhà cung cấp và khách không bị cắt; nhật ký giao hàng trống là một dòng chữ nhỏ; điện thoại dùng dòng gọn.

## 10. Cổng chất lượng (ghi chú UX gate)

1. **Ảnh:** `.local/uxui-screens/g2-before-*` (trước) và `g2-after-*` (sau): mỗi màn hình 360, 768, 1440 px sáng và 360, 768, 1440 px tối; hộp thoại và trạng thái ở 360 px sáng, 1440 px sáng và tối; hover ở `g2-hover-*` và `g2-after-hover-*`. Thư viện ảnh trước/sau: `.local/polish2/gallery/index.html` (không đưa lên git).
2. **Đã mở và xem từng ảnh sau đây** (không nói đã xem ảnh nào chưa mở): bảng hóa đơn 1440 sáng và tối (hover), 768 sáng, 360 sáng và tối; chi tiết hóa đơn chờ thanh toán 1440 sáng, đã hủy 1440 sáng; hộp thoại thu tiền mặt 1440 sáng, PayOS 360 sáng, đổi hàng 1440 sáng; khách vãng lai 1440 và 360 sáng; lịch hẹn 1440 sáng và 360 tối; trả hàng danh sách 1440 tối (hover); hàng đặt trước 1440 sáng; đơn online 1440 sáng; trạng thái lỗi hóa đơn; hover ở nhân sự (sáng), dịch vụ (tối), vai trò (sáng), phiếu nhập kho (tối). **Cỡ chữ 130% ở 360 px** (`g2-after-t130-*`): đã mở ảnh bảng hóa đơn (sáng) và chi tiết hóa đơn chờ thanh toán (sáng); đã chụp khách vãng lai, trả hàng, lịch hẹn và vai trò, và công cụ chụp không còn báo cuộn ngang ở cả sáu trang. **Chụp nhưng chưa mở:** các ảnh còn lại của bộ 6 kích cỡ; chúng dùng cùng mã với ảnh đã xem.
3. **Phát hiện khi xem và đã sửa:** (a) lần chụp đầu dòng gọn vẫn cắt mã hóa đơn thành hai dòng, đã bỏ nút ⋮ một mục khỏi dòng điện thoại của hóa đơn (mã là liên kết) để mã có đủ chỗ; (b) ô tìm bị cắt chữ ở 360 và 768 px, đã rút ngắn lời gợi ý ở bảng hóa đơn, trả hàng và lịch hẹn; (c) trang lỗi hóa đơn lặp "Hóa đơn" ở đường dẫn và tiêu đề; (d) thanh công cụ dính vào bảng ở hai danh sách có tab; (e) "Khách vãng lai" ở rộng mặc định bị lệch so với "Quay lại": đã trả về cột biểu mẫu như mọi trang tạo mới (xem mục "Chưa sửa"); (f) **ở cỡ chữ 130% trang cuộn ngang** (392 > 360 px) vì thanh trên cùng (nút menu, logo, chuông, tài khoản) quá rộng, **ở mọi trang nhân viên** (kể cả trang Vai trò không đổi), và mã hóa đơn dài đè lên dòng dưới trong dòng gọn: đã sửa cả hai (khe hở thanh trên ở điện thoại hẹp lại, tiêu đề dòng gọn được xuống dòng và hàng cao thêm), chụp lại.
4. **Luật cứng:** chỉ token (không hex, không lớp `wf-` mới, không px/rem trong CSS mới); không số hay ký hiệu cạnh tiêu đề.

## 11. Luồng quầy đã chạy (CSDL scratch `lucy_spa_polish1_scratch`, API 3101 có bộ mô phỏng PayOS, web 3100)

Chạy bằng trình duyệt không giao diện (`.local/polish2/flows.mjs`): **mọi bước bấm, gõ, chọn đều qua giao diện**; chỉ có hai chỗ không qua giao diện và nói rõ ở dưới. Kết quả (đều PASS):

1. **Mở và chốt hóa đơn, thu tiền mặt:** tìm hóa đơn nháp của một lượt khách bằng ô tìm mới, mở, bấm Chốt hóa đơn, bấm Thu tiền mặt (số tiền hiện `34.000`), ghi nhận: trạng thái Đã thanh toán, API xác nhận `PAID`. (Mở hóa đơn từ menu của dòng "Lượt khách chờ" cũng đã chạy, khi chuẩn bị luồng; lượt đó chốt thành 0 ₫ nên tự thành Đã thanh toán.)
2. **Bán sản phẩm cho khách lẻ, thu tiền mặt:** Bán sản phẩm, Bắt đầu bán, Thêm sản phẩm (chọn sản phẩm, người bán), Chốt, Thu tiền mặt `380.000`: PAID.
3. **Bán sản phẩm, PayOS (mô phỏng):** như trên, rồi Tạo mã QR PayOS; **ngân hàng là bộ mô phỏng** (cổng điều khiển 3199 báo "đã trả"), trang tự đọc lại: PAID. Không có PayOS thật.
4. **Trả hàng và hoàn tiền:** bán một sản phẩm và thu tiền, Mở hồ sơ trả hàng (tìm theo mã hóa đơn, chọn lý do, tích niêm phong), Chấp nhận, Hoàn tiền (tiền mặt, nhập lý do, **nhập lại mật khẩu**): hồ sơ hiện lần hoàn `231.200 ₫`. **Hàng khách trả chọn "Không bán lại được"**, vì stack scratch không chạy worker nên kho chưa ghi nhận lần bán (hệ thống nói đúng điều đó: "Kho chưa ghi nhận việc bán hàng này"); đây là hạn chế của môi trường thử, không phải lỗi giao diện.
5. **Hàng đặt trước:** trên đơn đặt trước có sẵn trong dữ liệu thử: tab Cần đặt, "Đã đặt hàng" (số dòng 14 xuống 13); tab Hàng đã về, **Giao hàng** với mã đơn khách đọc và 4 số cuối điện thoại: dòng DT000011 chuyển sang tab Đã giao. **Không đi từ lúc bán**: sản phẩm có tồn kho nên hệ thống không cho bán đặt trước, và nhập kho/hàng về chưa có màn hình trong luồng này; phần "bán đặt trước tới chốt hóa đơn" chưa chạy trong lần này (đã có kiểm thử đơn vị từ các bước trước).

Hai chỗ **không** qua giao diện: (a) dữ liệu nền (khách, sản phẩm, lượt khách đã làm xong, đơn đặt trước) do các script seed của các bước trước tạo bằng API và Prisma; (b) bộ mô phỏng ngân hàng PayOS.

## 12. DOM audit và kiểm thử

- **DOM audit 26 trang nhân viên** (sáng, 360 / 768 / 1440 px; CSDL scratch `lucy_spa_polish1_scratch`, không phải CSDL audit cũ) so với `docs/uxui-audit-baseline.json` ngày 2026-10-01: **không loại phát hiện nào tăng** (mọi loại bằng hoặc thấp hơn; còn lại `edge-left` 4, `unpaged-list` 3, `row-height-uneven` 9, `list-height-uneven` 5, `sibling-gap-uneven` 6, `surface-style-mix` 3, `wrapped-label` 1). Trang `pos`: 42 phát hiện xuống 1, `walk-in`: 62 xuống 0, `booking-board`: 123 xuống 1.
- So với lần audit ngay trước nhóm 2 (bước A): mọi loại bằng nhau, **trừ `list-height-uneven` 3 lên 5**, cả hai nằm ở trang **Tổng quan** (`dashboard`, 8 lên 10 phát hiện), trang mà nhóm 2 **không đụng tới**: danh sách widget có 5 dòng cao 70-110 px vì dữ liệu mẫu mới (các luồng quầy ở mục 11 đã tạo hóa đơn và hồ sơ). Là hiệu ứng của dữ liệu, không phải của mã đổi.
- **Baseline đã làm mới** (`docs/uxui-audit-baseline.json`, bản cũ nằm ở `.local/polish2/uxui-audit-baseline.2026-10-01.json`) vì không số nào tăng so với baseline cũ.
- **Kiểm thử:** `pnpm test` toàn repo (mọi gói) qua; `packages/ui` 479, `apps/web` 889 (gồm bộ đếm ratchet `ui-ratchet.test.ts`, không đổi), kiểm thử mới: `date-text-core.test.ts`, `date-text-input.test.tsx`, `components-css.test.ts` (hover nhân viên), `data-components.test.tsx` (dòng gọn), `pos.test.tsx` (tìm hóa đơn, ô tiền). Typecheck web và ui, eslint các tệp đổi, `pnpm format:check` toàn repo sạch.
- **Không đụng** `apps/web/next-env.d.ts`.

## 13. Chưa sửa và hạn chế

1. **Tìm theo số điện thoại trên bảng hóa đơn: chưa làm được.** Chủ muốn tìm theo mã hóa đơn, tên khách **hoặc số điện thoại**; dữ liệu bảng hóa đơn (API `pos/branches/{id}/board`) không có số điện thoại của khách, nên ô tìm chỉ khớp mã hóa đơn, tên khách, mã lượt khách và tên combo. Muốn tìm theo số điện thoại phải thêm trường vào API (ngoài phạm vi chỉ giao diện); cần chủ quyết.
2. **Trang dạng biểu mẫu** (khách vãng lai, mở hồ sơ trả hàng, tạo nhân sự...) vẫn ở cột biểu mẫu giữa trang, nên tiêu đề lệch phải so với "Quay lại" ở góc trái: đây là khung `Page width="form"` dùng chung cho nhiều trang, không phải riêng quầy; đổi sẽ ảnh hưởng mọi trang tạo mới.
3. **Bảng ở màn hình rộng 1440 px có cột cuối bị cắt ở một số trang** (ví dụ cột Trạng thái của Dịch vụ, bảng Quản lý của Nhân sự): có từ trước, không thuộc màn hình quầy, không đổi ở đây (cùng kích thước ảnh với lần audit trước nhóm 2).
4. **Hộp thoại Khách vãng lai "Thêm khách lẻ" ở 1440 sáng không chụp được** bằng công cụ chụp (treo, trong khi trang chạy bình thường qua trình điều khiển: thêm khách mất khoảng 0,3 giây). Ảnh 360 sáng và 1440 tối của màn hình này đã có.
5. **Bán đặt trước từ lúc bán tới chốt hóa đơn** chưa chạy trên giao diện trong lần này (sản phẩm có tồn kho nên hệ thống không cho bán đặt trước; xem mục 11).
6. Cảm ứng thật trên điện thoại và máy tính bảng, tiếng Anh (chỉ kiểm bằng kiểm thử). Ở 768 px thanh bên rút gọn có các mục tiêu chạm 40x44 px (khung chung của khu nhân viên, có từ trước).
7. Hover của dòng bảng nhân viên đã xem ở 5 màn hình (nhân sự, dịch vụ, vai trò, phiếu nhập kho, trả hàng) cùng bảng hóa đơn; 14 bảng còn lại đã chụp (`g2-hover-*`) nhưng chưa mở từng ảnh.
