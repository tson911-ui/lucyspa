# Phase 6: các mục chờ Chủ duyệt (giải thích bằng tiếng Việt)

**Cập nhật 2026-10-07: Chủ đã duyệt T9 đến T16, T24, T25 và đã trả lời OQ-19 đến OQ-28** (ghi lại ở mục 2.5 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`). Tài liệu này giữ lại như bản giải thích gốc. Còn chờ Chủ duyệt: T17 đến T23, T26, T27 (các đề xuất của Đợt 2 và 3).

Tài liệu này giải thích, bằng lời thường, từng mục kỹ thuật và câu hỏi đã được hỏi. Bản đầy đủ bằng tiếng Anh nằm trong `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md` (mục 2.2 và 2.4). Chỉ lời của Chủ mới duyệt.

Mỗi mục có bốn phần: **Ý nghĩa**, **Ví dụ ở spa**, **Tôi khuyên**, **Nếu Chủ chọn khác**.

Đã duyệt rồi (không cần trả lời lại): T1 đến T8 (T8 = trang sản phẩm công khai chỉ để xem, không giỏ hàng, giao hàng hay COD).

## Bảng trả lời nhanh

Chủ chỉ cần ghi "đồng ý" hoặc "khác: …" cho từng dòng. Cột giữa là điều tôi khuyên.

| Mục   | Chủ đề                                      | Tôi khuyên                        | Chặn bước nào |
| ----- | ------------------------------------------- | --------------------------------- | ------------- |
| T9    | Biến thể (size, dung tích)                  | Đồng ý                            | P6-2          |
| T10   | Giá dùng chung, kho theo chi nhánh          | Đồng ý                            | P6-2          |
| T11   | Trạng thái sản phẩm, không xóa              | Đồng ý                            | P6-3          |
| T12   | Cách tính giá và khuyến mãi                 | Đồng ý                            | P6-2          |
| T13   | Cách ghi kho                                | Đồng ý                            | P6-2          |
| T14   | Hàng hết hạn không bán                      | Đồng ý                            | P6-4          |
| T15   | Giữ hàng khi chốt hóa đơn                   | Đồng ý                            | P6-8          |
| T16   | Cảnh báo sắp hết hàng, sắp hết hạn          | Đồng ý                            | P6-4          |
| T24   | Danh sách 11 quyền mới                      | Đồng ý                            | P6-2          |
| T25   | Thứ tự bước và 3 đợt triển khai             | Đồng ý                            | P6-2          |
| OQ-19 | Làm tròn điểm khi hoàn tiền                 | Cách A                            | P6-13         |
| OQ-20 | Voucher dùng chung chỉ thắng một bên        | Đồng ý                            | P6-9          |
| OQ-21 | Khuyến mãi nhắm đúng nhãn/danh mục/sản phẩm | Cho chọn                          | P6-8          |
| OQ-22 | Lý do trả hàng nào được hoàn tiền           | Chủ tự quyết (cần 3 dòng trả lời) | P6-12         |
| OQ-23 | Hoàn theo số lượng                          | Cho hoàn theo số lượng            | P6-13         |
| OQ-24 | Đổi hàng: tiền chênh lệch, ai duyệt         | Chủ tự quyết (cần 3 ý trả lời)    | P6-14         |
| OQ-25 | Sửa người bán sau khi chốt hóa đơn          | Chỉ sửa khi còn nháp              | P6-10         |
| OQ-26 | Chạy nhiều tiến trình cho phần API ở Đợt 1  | Không (để sang Đợt 2)             | P6-7          |
| OQ-27 | Tên, địa chỉ web và menu của trang mỹ phẩm  | Như đề xuất                       | P6-6          |
| OQ-28 | Huy hiệu "Mới", mục "Nổi bật", chữ cam kết  | Như đề xuất                       | P6-6          |

Lưu ý: OQ-27 và OQ-28 là hai câu hỏi mới, phát sinh từ trang mẫu Lovable. Các mục T9 đến T25 và OQ-19 đến OQ-26 là những mục Chủ đã nhắc tên.

## Các mục kỹ thuật (T)

### T9. Mỗi sản phẩm có "biến thể"

- **Ý nghĩa:** giá, mã hàng (SKU) và số tồn kho nằm ở từng biến thể, không nằm ở sản phẩm. Sản phẩm không có size vẫn có một biến thể mặc định.
- **Ví dụ:** Kem dưỡng ẩm 50 ml và 100 ml là hai biến thể, mỗi cái có mã, giá và số tồn riêng. Mặt nạ chỉ có một loại thì có một biến thể.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** nếu để giá và kho ở mức sản phẩm, một sản phẩm không thể có hai size với hai giá. Sửa lại về sau rất tốn công.

### T10. Danh mục và giá dùng chung, kho tính riêng từng chi nhánh

- **Ý nghĩa:** một bảng giá cho cả hệ thống; chỉ số lượng tồn là riêng từng chi nhánh (Chủ đã chọn kho riêng từng chi nhánh ở Q13). PRD không nói giá có khác nhau theo chi nhánh hay không.
- **Ví dụ:** Tinh chất X giá 389.000đ ở mọi chi nhánh. Chi nhánh A còn 5 chai, chi nhánh B hết.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** nếu mỗi chi nhánh một giá, phải thêm bảng giá theo chi nhánh. Việc nhập và kiểm tra giá nhân lên theo số chi nhánh.

### T11. Ba trạng thái sản phẩm, sản phẩm đã bán không bao giờ bị xóa

- **Ý nghĩa:** "Nháp", "Đang bán", "Ngừng bán". Đăng "Đang bán" cần có tên tiếng Việt và ít nhất một biến thể có giá. "Ngừng bán" ẩn khỏi web và quầy nhưng giữ lịch sử.
- **Ví dụ:** Hãng ngừng sản xuất một loại kem: chuyển "Ngừng bán". Hóa đơn cũ vẫn hiện đúng tên và giá lúc bán.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** nếu cho xóa hẳn, hóa đơn và phiếu kho cũ mất tên sản phẩm. Điều đó trái quy tắc giữ nguyên lịch sử.

### T12. Cách tính giá và khuyến mãi

- **Ý nghĩa:** mọi lần đổi giá đều được lưu lịch sử. Khuyến mãi có giờ bắt đầu và kết thúc; hết giờ tự về giá thường, không ai phải sửa lại. Hóa đơn nháp luôn lấy giá hiện hành; **khi bấm chốt hóa đơn thì giá bị khóa**. Nhân viên không sửa được giá.
- **Ví dụ:** khuyến mãi 11/11 kết thúc 23:59. Khách chọn hàng lúc 23:50 nhưng nhân viên chốt lúc 00:05: hóa đơn tính lại theo giá thường, nhân viên thấy giá mới trước khi chốt.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** nếu khóa giá ngay lúc thêm vào hóa đơn nháp, khách giữ giá khuyến mãi cả khi khuyến mãi đã hết. Có thể bị lợi dụng bằng cách để nháp thật lâu.

### T13. Cách ghi kho: ghi từng dòng, không sửa số trực tiếp

- **Ý nghĩa:** mọi thay đổi (nhập, bán, điều chỉnh) là một dòng ghi nhận không sửa, không xóa. Phiếu nhập đã xác nhận không sửa được; sai thì làm phiếu điều chỉnh. Có thêm một điều chỉnh nhỏ: khi hệ thống khóa nhiều dòng kho cùng lúc, nó sắp theo cặp (chi nhánh, mã hàng) để không bị kẹt.
- **Ví dụ:** nhập 24 hộp; kiểm kho thấy 23: tạo phiếu điều chỉnh −1 với lý do "kiểm kho".
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** cho sửa số trực tiếp thì mất dấu vết, và PRD cấm.

### T14. Hàng hết hạn không bán được

- **Ý nghĩa:** số hàng "bán được" = hàng còn hạn trừ hàng đang giữ cho hóa đơn. Lô hết hạn bị loại và hệ thống nhắc làm phiếu "hết hạn". Sổ sách trừ lô gần hết hạn trước. Hệ thống không biết nhân viên lấy hộp nào trên kệ, nên cần xếp hộp hạn gần ra trước.
- **Ví dụ:** lô A hạn 30/11 còn 3 hộp, lô B hạn 2027 còn 10 hộp. Ngày 1/12 hệ thống coi còn 10 hộp bán được và nhắc xử lý 3 hộp lô A.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** nếu chỉ cảnh báo mà vẫn cho bán, có nguy cơ bán mỹ phẩm quá hạn cho khách.

### T15. Giữ hàng khi chốt hóa đơn, trừ kho sau khi thanh toán

- **Ý nghĩa:** (Chủ đã chọn giữ hàng lúc chốt ở Q8; đây là cách chạy chi tiết.) Chốt hóa đơn thì hàng được giữ; thanh toán xong thì trừ kho (vài giây sau); hủy trước khi trả tiền thì nhả hàng; hoàn thanh toán thì hàng quay lại.
- **Ví dụ:** còn đúng 1 hộp, hai quầy cùng bấm chốt: chỉ một quầy được, quầy kia báo "Hết hàng".
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** nếu giữ hàng từ lúc thêm vào nháp, hóa đơn nháp bị quên sẽ giữ hàng mãi, và hàng đó bán không được.

### T16. Cách cảnh báo sắp hết hàng, sắp hết hạn

- **Ý nghĩa:** báo "sắp hết" một lần khi số tồn chạm ngưỡng, báo lại sau khi nhập thêm hàng. Hạn dùng quét mỗi ngày, báo lô hết hạn trong 90 ngày (con số 90 chỉnh được, Q14). Gửi cho người có quyền xem kho ở chi nhánh, trong ứng dụng, không email hay Zalo. Giờ quét đề xuất 08:00.
- **Ví dụ:** ngưỡng 3. Còn 3 hộp thì báo. Bán còn 2 không báo lại. Nhập thêm 10, sau này xuống 3 lại báo.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** báo mỗi lần bán thì quá nhiều thông báo; không báo thì bất ngờ hết hàng.

### T24. Danh sách quyền mới

- **Ý nghĩa:** 11 quyền mới, mặc định **không ai có**; Chủ cấp sau khi triển khai. 7 quyền cho Đợt 1: quản lý sản phẩm, đổi giá, xem giá vốn, xem kho, nhập kho, điều chỉnh và kiểm kho, nhập file Excel. Đợt 2: bán sản phẩm. Đợt 3: xử lý trả hàng, hoàn tiền (luôn bắt nhập lại mật khẩu), chiến dịch khuyến mãi.
- **Ví dụ:** thu ngân có "bán sản phẩm". Quản lý chi nhánh có "nhập kho" và "kiểm kho". Chỉ Chủ và quản lý cấp cao có "đổi giá", "xem giá vốn", "hoàn tiền". KTV chỉ "bán sản phẩm", không thấy giá vốn.
- **Tôi khuyên:** đồng ý. Tên quyền có thể tách thêm sau mà không phá gì đã làm.
- **Nếu khác:** gộp ít quyền hơn thì dễ cấp thừa (người xem được giá vốn cũng đổi được giá). Tách nhiều hơn thì Chủ phải cấp nhiều quyền hơn.

### T25. Thứ tự bước và 3 đợt triển khai

- **Ý nghĩa:** Đợt 1 (P6-2 đến P6-7): sản phẩm, kho, nhập Excel, trang công khai, tối ưu tải; không đụng thu tiền. Đợt 2 (P6-8 đến P6-11): bán sản phẩm ở quầy, điểm Beauty, giảm giá mới. Đợt 3 (P6-12 đến P6-17): trả hàng, hoàn tiền, đổi hàng, quà tặng trừ kho, chiến dịch. Chủ chỉ triển khai khi Chủ bảo.
- **Ví dụ:** sau Đợt 1, Chủ nhập hàng bằng Excel, nhân viên thấy tồn kho, khách xem được mỹ phẩm trên web; quầy vẫn thu tiền như cũ.
- **Tôi khuyên:** đồng ý.
- **Nếu khác:** gộp Đợt 2 và 3 thì một lần triển khai thay đổi nhiều phần thu tiền đang chạy thật. Làm hoàn tiền sớm hơn thì phải sửa hóa đơn đang chạy sớm hơn.

## Các câu hỏi mở (OQ)

### OQ-19. Làm tròn điểm khi hoàn tiền một phần

- **Ý nghĩa:** điểm chỉ là số nguyên, nên khi hoàn một phần phải có quy tắc làm tròn. PRD yêu cầu Chủ định rõ.
- **Ví dụ:** khách mua hai món, mỗi món sau giảm giá còn 1.500đ (tổng 3.000đ, được 3 điểm). Hoàn một món (1.500đ): **Cách A** trừ 2 điểm (còn 1). **Cách B** trừ 1 điểm (còn 2). Hoàn cả hai món: A trừ đủ 3 điểm; B chỉ trừ 2 điểm, khách vẫn giữ 1 điểm dù đã nhận lại hết tiền.
- **Tôi khuyên:** Cách A (hoàn hết tiền thì điểm về đúng như trước khi mua).
- **Nếu chọn B:** khách có thể giữ vài điểm lẻ (tối đa vài điểm) sau khi hoàn tiền. Khách ít bị trừ hơn ở hoàn một phần.

### OQ-20. Voucher dùng chung có thể chỉ thắng một bên

- **Ý nghĩa:** theo Q1, bên dịch vụ và bên mỹ phẩm mỗi bên chọn ưu đãi tốt nhất. Một voucher dùng chung được chia theo tỷ lệ; nếu bên này giảm hội viên lớn hơn phần voucher chia cho bên đó, voucher chỉ áp cho bên kia.
- **Ví dụ:** voucher 30.000đ cho cả dịch vụ và mỹ phẩm; dịch vụ 300.000đ, mỹ phẩm 200.000đ. Voucher chia 18.000đ (dịch vụ) và 12.000đ (mỹ phẩm). Khách hạng Ruby Beauty giảm 9% mỹ phẩm = 18.000đ, lớn hơn 12.000đ, nên mỹ phẩm dùng giảm hội viên, dịch vụ dùng voucher. Tổng giảm 36.000đ; voucher tính là dùng một lần, phần 12.000đ của nó không dùng đến.
- **Tôi khuyên:** đồng ý (đây là hệ quả của Q1).
- **Nếu khác:** nếu muốn voucher thắng hoặc thua cả hóa đơn thì phải đổi lại Q1. Nếu không tính lượt dùng khi voucher chỉ thắng một bên thì giới hạn lượt dùng voucher sẽ sai.

### OQ-21. Khuyến mãi sản phẩm có nhắm theo nhãn, danh mục, từng sản phẩm không?

- **Ý nghĩa:** với dịch vụ, khuyến mãi chọn được dịch vụ hoặc nhóm dịch vụ. Với sản phẩm có làm tương tự không, hay chỉ "tất cả sản phẩm"?
- **Ví dụ:** "Giảm 10% các loại mặt nạ" chỉ cho danh mục Mặt nạ, không cho kem chống nắng.
- **Tôi khuyên:** cho chọn theo nhãn, danh mục hoặc từng sản phẩm.
- **Nếu khác:** chỉ có "tất cả sản phẩm" thì đơn giản hơn nhưng không làm được khuyến mãi theo nhóm; thêm sau phải sửa tiếp.

### OQ-22. Lý do trả hàng nào được hoàn tiền

- **Ý nghĩa:** PRD có ba lý do (sở thích cá nhân: hàng còn nguyên seal, khách chịu phí gửi; hàng sai hoặc hỏng do đóng gói: đổi 100% trong 48 giờ; kích ứng da: xem từng trường hợp). PRD không nói lý do nào được **hoàn tiền**, lý do nào chỉ **đổi hàng**, và không nói thời hạn cho trả vì sở thích.
- **Ví dụ:** khách mua kem, 10 ngày sau muốn trả vì không hợp, hộp còn nguyên seal. Có hoàn tiền không, trong bao nhiêu ngày?
- **Tôi khuyên:** Chủ trả lời cho từng lý do (hoàn tiền, đổi hàng, hay cả hai; thời hạn). Đến khi có câu trả lời, hệ thống chưa mở hoàn tiền cho lý do đó.
- **Nếu khác:** nếu tôi tự chọn thì có thể sai chính sách tiền thật.

### OQ-23. Hoàn theo số lượng hay cả dòng

- **Ý nghĩa:** một dòng hóa đơn có thể có nhiều cái. Cho hoàn từng cái, hay chỉ hoàn cả dòng?
- **Ví dụ:** khách mua 3 hộp mặt nạ trên một dòng, trả lại 1 hộp.
- **Tôi khuyên:** cho hoàn theo số lượng; dòng thành "Đã hoàn tiền" khi hoàn đủ 3 hộp.
- **Nếu khác:** chỉ hoàn cả dòng thì khách trả 1 trong 3 hộp sẽ không hoàn được, trừ khi nhân viên tách dòng ngay từ đầu.

### OQ-24. Đổi hàng: tiền chênh lệch và ai duyệt

- **Ý nghĩa:** PRD chỉ quy định phần điểm của việc đổi hàng, không nói chuyện tiền. Cần biết: khách trả thêm phần chênh bằng cách nào; món đổi rẻ hơn có hoàn lại phần chênh không; ai duyệt (người có quyền hoàn tiền hay một quyền riêng).
- **Ví dụ:** khách đổi sản phẩm lỗi 500.000đ lấy món 600.000đ: trả thêm 100.000đ ra sao? Đổi lấy món 400.000đ: có hoàn 100.000đ không?
- **Tôi khuyên:** Chủ trả lời ba ý trên. Tôi không làm bước đổi hàng (P6-14) cho đến khi có câu trả lời; việc này không chặn các bước khác.
- **Nếu khác:** không có gì xấu xảy ra; bước đổi hàng chỉ chờ.

### OQ-25. Sửa người bán sau khi chốt hóa đơn

- **Ý nghĩa:** người bán sẽ dùng để tính hoa hồng ở Phase 7. Có cho sửa người bán sau khi hóa đơn đã chốt không?
- **Ví dụ:** nhân viên A bán nhưng bấm nhầm tên B; hoa hồng sau này sẽ tính cho B.
- **Tôi khuyên:** chỉ sửa được khi hóa đơn còn nháp. Sau chốt chỉ sửa bằng một thao tác có ghi lịch sử mà Chủ định nghĩa ở Phase 7.
- **Nếu khác:** cho sửa tự do sau chốt thì hoa hồng có thể đổi sau khi đã tính lương. Cho quản lý sửa có lý do thì phải thêm quyền và màn hình.

### OQ-26. Chạy nhiều tiến trình cho phần API ở Đợt 1?

- **Ý nghĩa:** máy chủ có 6 nhân CPU. Chạy nhiều tiến trình giúp chịu tải nhiều khách hơn. Phần web (trang khách xem) chạy nhiều tiến trình thì không liên quan thu tiền. Phần API thì cũng phục vụ thu tiền, webhook PayOS, nhập lại mật khẩu.
- **Ví dụ:** đông khách xem mỹ phẩm cùng lúc: cần web chạy nhiều tiến trình. API ít bị tải bởi trang xem.
- **Tôi khuyên:** Đợt 1 chỉ chạy nhiều tiến trình cho web. API để sang Đợt 2 sau khi đã thử kỹ. Tôi chưa thấy dấu hiệu API không chạy được nhiều tiến trình, nhưng chưa thử.
- **Nếu khác:** nhân API ngay ở Đợt 1 thì nhanh hơn, nhưng đụng luồng thu tiền, trái Q17 ("Đợt 1 không đụng thu tiền").

### OQ-27. Tên, địa chỉ web và menu của trang mỹ phẩm (mới)

- **Ý nghĩa:** trang mẫu dùng nhãn "Mỹ phẩm" và địa chỉ `/my-pham`, và thêm mục này vào menu đầu trang và thanh dưới điện thoại. Menu hiện tại Chủ đã duyệt chưa có mục mỹ phẩm; các địa chỉ web của ta viết bằng tiếng Anh (`/services`).
- **Ví dụ:** menu: Trang chủ, Dịch vụ, **Mỹ phẩm**, Lịch hẹn, Hóa đơn. Địa chỉ `/vi/products`, giống `/vi/services`.
- **Tôi khuyên:** nhãn "Mỹ phẩm"; địa chỉ `/products`; một mục menu cho mọi người; trên điện thoại chỉ thêm vào thanh dưới cho khách chưa đăng nhập (thành viên đã có 5 mục, thêm nữa sẽ chật).
- **Nếu khác:** dùng `/my-pham` thì thân thiện hơn nhưng lệch quy ước địa chỉ hiện nay. Thêm cho cả thành viên thì thanh dưới có 6 mục, nút khó bấm.

### OQ-28. Dữ liệu mà trang mẫu có nhưng PRD chưa định nghĩa (mới)

- **Ý nghĩa:** trang mẫu có huy hiệu "Mới", sắp xếp "Nổi bật", khung "Cam kết tại LUCY SPA", ảnh và chữ ở đầu trang. PRD không nói quy tắc cho các thứ này, và chữ cam kết là lời hứa kinh doanh chỉ Chủ mới được quyết.
- **Ví dụ:** "Mới" = sản phẩm đăng trong 30 ngày gần đây (Chủ đặt số ngày; chưa đặt thì không hiện). "Nổi bật" = Chủ tick ô "nổi bật" ở từng sản phẩm. Khung cam kết, ảnh và chữ đầu trang do Chủ nhập; để trống thì ẩn.
- **Tôi khuyên:** như ví dụ.
- **Nếu khác:** nếu dùng chữ mẫu, những câu như "Tư vấn phù hợp với tình trạng da" sẽ nằm trên web thật dù Chủ chưa xác nhận. Nếu bỏ "Mới" và "Nổi bật" thì trang đơn giản hơn nhưng khác trang mẫu.
