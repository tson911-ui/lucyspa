# Phase 6: các mục chờ Chủ duyệt (giải thích bằng tiếng Việt)

**Cập nhật 2026-10-07: Chủ đã duyệt T9 đến T16, T24, T25 và đã trả lời OQ-19 đến OQ-28** (ghi lại ở mục 2.5 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`). Tài liệu này giữ lại như bản giải thích gốc. Còn chờ Chủ duyệt: T17 đến T23, T26, T27 (các đề xuất của Đợt 2 và 3).

**Mới 2026-10-07 (cuối tài liệu): thay đổi phạm vi bán Lucy Beauty** (đặt trước tại quầy, đặt hàng online): T28 đến T33 và OQ-29 đến OQ-41. **Chủ đã trả lời cùng ngày** (khung "Chủ đã trả lời" ở đầu phần đó). Còn chờ Chủ: **OQ-42** (khách vãng lai xem phiếu hẹn) và OQ-38 (để sang Đợt 4).

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

## Thay đổi phạm vi: bán Lucy Beauty qua đặt trước tại quầy và đặt hàng online (Chủ, 2026-10-07)

**Trạng thái (cập nhật sau khi Chủ trả lời, 2026-10-07):** Chủ đã trả lời bằng lời của Chủ (xem khung "Chủ đã trả lời" ngay dưới). Phần đề xuất bên dưới giữ nguyên như đã viết; **khi khác với câu trả lời của Chủ thì câu trả lời của Chủ thắng.** Bản đầy đủ bằng tiếng Anh: mục 2.7, 2.8 và 18 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`.

### Chủ duyệt P6-3b, P6-4 và OQ-42 (2026-10-07; đã khóa)

- **Duyệt P6-3b và P6-4.** (1) Migration …08 nới 3 ràng buộc bảng thông báo: **duyệt** (chỉ nới). **Chạy Đợt 1 vào lúc vắng khách (buổi tối)**: đã ghi vào `docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md`. (2) Các cách đọc của tôi (cho đặt trước mặc định bật, hết hạn tính theo ngày chi nhánh, kiểm kê lấy lô gần hết hạn trước, quét 08:00, luật 1-90 ngày): **duyệt**.
- **OQ-42 duyệt:** khách vãng lai xem "phiếu hẹn nhận hàng" bằng đường dẫn bí mật + mã QR, nhân viên gửi qua Zalo.
- Chủ yêu cầu hoàn thành cổng giao diện P6-3b/P6-4 rồi làm P6-5 (nhập Excel/CSV): sản phẩm, biến thể có các cột đặt trước, tồn đầu kỳ; xem trước, lỗi từng dòng bằng tiếng Việt, kiểm tra trùng, chỉ lưu khi Chủ xác nhận, có tệp mẫu tải về.

### Chủ đã trả lời (2026-10-07, ghi lại đúng ý của Chủ; đã khóa, không hỏi lại)

- **Đã duyệt:** T28, T29, T30, T31, T32. **T7 xác nhận:** không bán vượt kho với hàng có sẵn; đặt trước là chế độ riêng, rõ ràng, không phải bán vượt kho.
- **T33 đổi:** **không thêm cân nặng cho biến thể.** Phí giao hàng sẽ làm đơn giản (quyết ở Đợt 4). Giữ ô "cho đặt trước" và số ngày chờ riêng (tùy chọn) cho từng biến thể. Thêm "kênh bán" và "phí giao hàng" vào hóa đơn ở P6-8: **đã duyệt**.
- **Duyệt đúng như tôi khuyên:** OQ-29, 30, 31, 33, 34, 36, 37, 39, 41.
- **OQ-32:** nhà cung cấp không giao được = hoàn đủ tiền; khách hủy trước khi đặt nhà cung cấp = hoàn đủ tiền; khách đổi ý sau khi đã đặt nhà cung cấp = Chủ hoặc quản lý quyết từng trường hợp; hàng về trễ hơn ngày dự kiến **hơn 7 ngày** = khách được hủy và hoàn đủ tiền.
- **OQ-35:** **không in.** "Phiếu hẹn nhận hàng" chỉ có bản điện tử, hiện ngay trong hóa đơn trong app/tài khoản. Với khách vãng lai không có tài khoản: tôi phải đề xuất cách xem phiếu (ví dụ đường dẫn bí mật hoặc mã QR do nhân viên gửi qua Zalo) và hỏi Chủ: xem **OQ-42** ngay dưới.
- **OQ-38:** để sang Đợt 4, chưa có số.
- **OQ-40:** hạn đổi trả tính từ ngày giao khách. Giao thất bại = hoàn tiền hàng trừ phí giao hai chiều, khách chịu.
- **Cách đọc của tôi, Chủ xác nhận giúp:** (1) OQ-30 nói "mặc định bật đặt theo đơn cho sản phẩm chưa có hàng nhập": tôi đặt ô "cho đặt trước" **mặc định bật** ở mỗi biến thể mới; Chủ bỏ chọn với mặt hàng cửa hàng giữ sẵn. (2) OQ-31: số ngày chờ mặc định **3 đến 5** nằm trong cài đặt sản phẩm (từng biến thể có thể ghi đè); "ngày thường" nhưng không loại chủ nhật hay lễ, nên tôi coi là ngày theo lịch.

### OQ-42 (**Chủ đã duyệt 2026-10-07**: đường dẫn bí mật + mã QR, nhân viên gửi qua Zalo). Khách vãng lai không có tài khoản xem phiếu hẹn nhận hàng thế nào?

- **Ý nghĩa:** khách có tài khoản thấy phiếu trong hóa đơn của họ. Khách vãng lai (chỉ có số điện thoại) không có chỗ đăng nhập.
- **Ví dụ:** chị Lan mua kem ở quầy, không đăng ký. Nhân viên gửi cho chị một tin Zalo có đường dẫn; chị mở ra thấy phiếu (đã thanh toán, ngày dự kiến, trạng thái "hàng đã về").
- **Tôi đề xuất:** khi tạo đơn, hệ thống tạo **một đường dẫn bí mật** (chuỗi ngẫu nhiên dài, chỉ lưu bản mã hóa, hiện đầy đủ một lần cho nhân viên) và **mã QR** của đường dẫn đó. Nhân viên sao chép hoặc cho khách quét, rồi gửi qua Zalo bằng tay (hệ thống không tự gửi gì). Trang chỉ cho **xem** phiếu: mã đơn, sản phẩm, giá, tổng, "Đã thanh toán", ngày dự kiến ("dự kiến, không phải cam kết"), trạng thái hiện tại; không có số điện thoại, địa chỉ hay đơn khác. Nhân viên có quyền xử lý đơn có thể **hủy đường dẫn và tạo lại**; đường dẫn hết hiệu lực sau một số ngày kể từ khi đơn hoàn tất hoặc bị hủy; có giới hạn số lần mở; đường dẫn sai không lộ thông tin gì.
- **Nếu khác:** cách khác là tra bằng **mã đơn + 4 số cuối điện thoại** (không cần đường dẫn nhưng yếu hơn, dễ đoán). Hoặc khách vãng lai không có bản điện tử, chỉ nhân viên đọc cho khách khi gọi.
- **Chủ cần trả lời:** đồng ý đường dẫn bí mật + QR không? Hiệu lực bao nhiêu ngày sau khi đơn xong? Cần xong trước P6-16.

### Tóm tắt bằng lời thường

- Hàng Beauty phần lớn **không có sẵn**: khách trả đủ tiền, cửa hàng đặt nhà cung cấp, 3-5 ngày hàng về. Vậy bán hàng chưa có trong kho là chuyện thường, không phải ngoại lệ.
- Hệ thống sẽ có thêm **"đơn hàng sản phẩm"** (theo dõi hàng) tách khỏi **hóa đơn** (theo dõi tiền). Hóa đơn vẫn là PAID như hiện nay; đơn hàng đi qua các trạng thái: **Đã thanh toán → Đã đặt nhà cung cấp → Hàng đã về → Đã giao khách (quầy) hoặc Đang giao (online) → Hoàn tất**, hoặc **Đã hủy** (kèm hoàn tiền).
- Hàng bán sẵn tại quầy (có trong kho) **không đổi**: khách cầm về ngay, trừ kho khi thanh toán.
- Hàng đặt trước: khi hàng về, hàng được **giữ riêng cho đúng đơn đó** (đơn trả tiền trước được ưu tiên), không bán lẻ cho người khác.
- Vì cửa hàng nhận tiền cho hàng chưa giao, **phải có cách hoàn tiền trước** khi bán đặt trước. Nên thứ tự: hoàn tiền (P6-13) rồi mới đặt trước tại quầy, rồi mới online (đúng ý Chủ: online là Đợt 4).

### Ảnh hưởng đến các quyết định đã duyệt (nói gọn)

- **T7 "không bán vượt kho"**: vẫn giữ cho hàng có sẵn. Đặt trước là một chế độ riêng, rõ ràng (khách được báo là đặt nhà cung cấp và thấy ngày dự kiến). **Cần Chủ xác nhận** rằng đặt trước không bị coi là bán vượt kho.
- **Q8/T15 (giữ hàng khi chốt hóa đơn)**: giữ nguyên cho hàng có sẵn. Hàng đặt trước không giữ gì lúc chốt, chỉ giữ khi hàng về. Hàng đặt trước và hàng online trừ kho khi **giao khách / gửi đi**, không phải lúc thanh toán.
- **Q15 "Hết hàng"**: sản phẩm cho đặt trước sẽ ghi "Đặt trước, dự kiến n ngày" thay vì "Hết hàng". Vẫn không hiện số lượng.
- **T8 (trang công khai chỉ để xem)**: được thay bằng đặt hàng online (Chủ quyết). Trang xem vẫn làm ở P6-6, chừa sẵn chỗ cho nút mua.
- **Điểm Beauty**: câu hỏi OQ-33 bên dưới.
- **T23 / OQ-22 (hạn 48 giờ, 7 ngày)**: tôi từng ghi "tính từ lúc thanh toán"; với đặt trước và hàng gửi đi, khách chưa cầm hàng lúc thanh toán, nên tôi **rút lại** cách đọc đó, hỏi lại ở OQ-40.
- **P6-2 (đã xong)**: không phải sửa. **P6-3 (đã xong)**: cần thêm một bước nhỏ **P6-3b** (xem dưới) để khỏi làm lại.

### Để khỏi làm lại, cần thêm ngay (đề xuất)

- **P6-3b (nhỏ, chỉ thêm, làm trước P6-4; Chủ đã bỏ cân nặng):** ở từng biến thể thêm ô **"cho đặt trước"** (mặc định bật) và (tùy chọn) **số ngày chờ riêng**. **Không có cân nặng.**
- **P6-4 (kho):** khi xác nhận phiếu nhập kho, hệ thống phát một sự kiện "đã nhập hàng" để sau này tự giữ hàng cho đơn đặt trước. Chưa cần bảng đơn hàng.
- **P6-5 (nhập Excel):** thêm 3 cột mới vào file mẫu. **P6-6 (trang công khai):** nhãn "Đặt trước" và chỗ trống cho nút mua.
- **P6-8 (đợt 2, đụng hóa đơn):** thêm vào hóa đơn "kênh bán" (quầy/online) và "phí giao hàng" (mặc định 0). Đây là lần duy nhất trước Đợt 4 sửa bảng hóa đơn đang chạy, nên quyết sớm.

### Thứ tự bước và các đợt (đề xuất)

P6-2 đến P6-14 giữ nguyên số và nội dung đã duyệt (thêm P6-3b). Các bước sau P6-14 đánh số lại:

| Bước          | Nội dung                                                                                           | Đợt |
| ------------- | -------------------------------------------------------------------------------------------------- | --- |
| P6-3b         | "Cho đặt trước" và số ngày chờ ở biến thể (không có cân nặng)                                      | 1   |
| P6-12 - P6-14 | Trả hàng, hoàn tiền, đổi hàng (như đã duyệt). **Mốc 3a: đã có hoàn tiền**                          | 3   |
| P6-15         | Cơ sở dữ liệu đơn hàng sản phẩm, hàng chờ, quyền mới                                               | 3   |
| P6-16         | Đặt trước tại quầy và phiếu hẹn nhận hàng                                                          | 3   |
| P6-17         | Danh sách "cần đặt", giữ hàng khi về, báo khách, giao khách, hủy và hoàn tiền. **Mốc 3b**          | 3   |
| P6-18         | Quà tặng sản phẩm (trước là P6-15)                                                                 | 3   |
| P6-19         | Đặt hàng online: giỏ hàng, địa chỉ, phí giao hàng, khách thanh toán PayOS, hết hạn chưa thanh toán | 4   |
| P6-20         | Xử lý đơn online: đóng gói, gửi, mã vận đơn, đã nhận, giao thất bại                                | 4   |
| P6-21         | Trả hàng, hoàn tiền cho đơn online; thông báo khách                                                | 4   |
| P6-22         | Kiểm tra tải và bảo mật cho thanh toán online. **Mốc Đợt 4**                                       | 4   |
| P6-23         | Chương trình khuyến mãi đầy đủ (trước là P6-16, vẫn "làm cuối")                                    | 4   |
| P6-24         | Kiểm tra cuối (trước là P6-17)                                                                     | 4   |

### Các mục kỹ thuật mới (T)

| Mục | Chủ đề                                                                                               | Tôi khuyên |
| --- | ---------------------------------------------------------------------------------------------------- | ---------- |
| T28 | Đơn hàng sản phẩm tách khỏi hóa đơn (tiền ≠ hàng)                                                    | Đồng ý     |
| T29 | Dòng "đặt trước" là chế độ riêng, chỉ cho sản phẩm được bật                                          | Đồng ý     |
| T30 | Hàng về thì giữ cho đơn chờ lâu nhất trước                                                           | Đồng ý     |
| T31 | Hàng đặt trước/online trừ kho khi giao hoặc gửi                                                      | Đồng ý     |
| T32 | Các trạng thái đơn (xem trên)                                                                        | Đồng ý     |
| T33 | Thêm sớm: "cho đặt trước" (P6-3b, **không cân nặng**); kênh bán và phí giao hàng trên hóa đơn (P6-8) | Đồng ý     |

Giải thích ngắn: T28 như một cuốn sổ giao hàng riêng bên cạnh sổ thu tiền, để hủy hay trễ hàng không làm rối sổ tiền. T29 để hệ thống không tự biến hàng thiếu thành "đặt trước" mà thu ngân phải chọn. T30 công bằng cho người trả tiền trước. T31 để kho không bị trừ khi hàng còn nằm ở nhà cung cấp. T33 tránh sửa hóa đơn đang chạy thật hai lần. Nếu Chủ chọn khác từng mục: làm sau vẫn được nhưng phải sửa lại phần đã làm.

### Bảng trả lời nhanh các câu hỏi mới

| Mục   | Chủ đề                                                     | Tôi khuyên                                                              | Chặn bước nào |
| ----- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| OQ-29 | Hàng về rồi: nhận tại cửa hàng hay giao                    | Quầy: nhận tại cửa hàng. Online: giao                                   | P6-16         |
| OQ-30 | Có giữ hàng sẵn hay đặt theo từng đơn                      | Mỗi sản phẩm tự chọn; mặc định "đặt theo đơn"                           | P6-3b         |
| OQ-31 | Cách đặt nhà cung cấp, ngày dự kiến                        | Danh sách "cần đặt"; ngày dự kiến là khoảng 3-5 ngày                    | P6-17         |
| OQ-32 | Khách hủy, nhà cung cấp không giao được, trễ hẹn           | Hoàn đủ tiền; xem chi tiết                                              | P6-17         |
| OQ-33 | Điểm Beauty tính lúc nào                                   | Lúc thanh toán, hoàn tiền thì trừ lại                                   | P6-16         |
| OQ-34 | Báo khách hàng đã về, số điện thoại, giữ bao lâu           | Thông báo trong app + email; bắt buộc số điện thoại; giữ 7 ngày rồi gọi | P6-16         |
| OQ-35 | Mẫu phiếu hẹn nhận hàng                                    | Trang in khổ A5 hoặc A4 + bản trong tài khoản                           | P6-16         |
| OQ-36 | Ai được mua online; giao từ chi nhánh nào                  | Chỉ thành viên; một chi nhánh giao hàng cố định                         | P6-19         |
| OQ-37 | Online: hàng chưa có kho có cho đặt trước không            | Cho (với sản phẩm đã bật), ghi rõ ngày                                  | P6-19         |
| OQ-38 | Phí giao hàng, hãng vận chuyển, ngưỡng miễn phí            | Chủ quyết (cần các số)                                                  | P6-19         |
| OQ-39 | Hết hạn đơn online chưa thanh toán                         | 30 phút                                                                 | P6-19         |
| OQ-40 | Hạn đổi trả tính từ đâu; giao thất bại                     | Từ ngày giao khách; Chủ quyết giao thất bại                             | P6-21         |
| OQ-41 | Giảm giá, voucher, điểm có áp dụng cho phí giao hàng không | Không                                                                   | P6-19         |

### OQ-29. Hàng về rồi: khách nhận tại cửa hàng, được giao tận nơi, hay tự chọn? (câu hỏi (a) của Chủ)

- **Ý nghĩa:** khách trả đủ tiền ở quầy trước. Nếu sau đó muốn giao tận nơi thì phí giao hàng phải thu thêm lần nữa, trái với "trả đủ một lần".
- **Ví dụ:** chị Lan đặt kem ở quầy, 4 ngày sau hàng về. Chị nhận tại 04 Nguyễn Quang Bích. Chị ở Đà Nẵng đặt trên web thì hàng được gửi tới nhà.
- **Tôi khuyên:** đơn tại quầy chỉ **nhận tại cửa hàng** (phiên bản đầu); đơn online **giao tận nơi**. Nếu muốn, đơn online có thêm lựa chọn "nhận tại cửa hàng" (không phí giao hàng).
- **Nếu khác:** cho khách chọn giao tận nơi ở quầy thì phải biết phí ngay lúc thanh toán hoặc thu thêm sau, và phải nhập địa chỉ ở quầy. Làm được, nhưng thêm việc và thêm lỗi dễ xảy ra.

### OQ-30. Cửa hàng giữ sẵn một số mặt hàng, hay đặt theo từng đơn? (câu hỏi (b) của Chủ)

- **Ý nghĩa:** hệ thống hỗ trợ cả hai; câu trả lời quyết định cách nhập dữ liệu ban đầu và trang web hiện gì.
- **Ví dụ:** kem bán chạy giữ sẵn 5 hộp (bán ngay, trừ kho). Son hiếm không giữ, ai mua thì mới đặt.
- **Tôi khuyên:** **mỗi sản phẩm tự chọn** (ô "cho đặt trước" ở P6-3b). Mặc định bật "đặt theo đơn" cho mọi sản phẩm chưa có hàng nhập.
- **Nếu khác:** "đặt hết theo đơn" thì trang web hầu như toàn "đặt trước". "Giữ sẵn hết" thì không dùng được tính năng này, trái với ý Chủ.

### OQ-31. Cách đặt nhà cung cấp và ngày dự kiến

- **Ý nghĩa:** Chủ nói hàng về sau 3-5 ngày. Cần quy tắc ngày dự kiến trên phiếu và cách nhân viên ghi "đã đặt".
- **Ví dụ:** thanh toán thứ Hai: phiếu ghi "dự kiến từ thứ Năm đến thứ Bảy". Cuối ngày, nhân viên mở danh sách "cần đặt", thấy 3 hộp kem cùng nhà cung cấp, bấm "đã đặt".
- **Tôi khuyên:** ngày dự kiến = ngày thanh toán + 3 đến 5 **ngày thường** (không loại trừ chủ nhật hay lễ), ghi "dự kiến, không phải cam kết"; số ngày là một ô cài đặt, mỗi sản phẩm có thể riêng. Chỉ có danh sách "cần đặt" và nút "đã đặt", **chưa làm phiếu đặt hàng gửi nhà cung cấp**.
- **Nếu khác:** tính ngày làm việc thì phiếu chính xác hơn nhưng cần danh sách ngày lễ. Làm phiếu đặt hàng riêng thì thêm một phần việc lớn.

### OQ-32. Khách hủy, nhà cung cấp không giao được, hàng về trễ

- **Ý nghĩa:** cần quy tắc kinh doanh, tôi không tự đặt. Hoàn tiền vẫn theo quy tắc đã duyệt: chỉ tiền mặt hoặc chuyển khoản tay, chỉ người có quyền hoàn tiền, nhập lại mật khẩu.
- **Ví dụ:** nhà cung cấp hết hàng: cửa hàng hoàn đủ tiền. Khách đổi ý sau khi đã đặt nhà cung cấp: có hoàn không? Hàng trễ hơn dự kiến 5 ngày: khách có được hủy không?
- **Tôi khuyên:** nhà cung cấp không giao được: **hoàn đủ tiền**. Khách hủy **trước** khi đặt nhà cung cấp: hoàn đủ. Sau khi đã đặt: Chủ hoặc quản lý quyết từng trường hợp (giống trường hợp kích ứng da). Trễ quá dự kiến một số ngày (Chủ cho con số): khách được hủy, hoàn đủ.
- **Nếu khác:** cho hủy tự do sau khi đã đặt thì cửa hàng có thể kẹt hàng đã nhập. Không cho hủy thì dễ tranh cãi khi hàng về trễ.

### OQ-33. Điểm Beauty tính lúc nào?

- **Ý nghĩa:** hiện điểm cộng ngay khi hóa đơn PAID. Với đặt trước, tiền đã trả nhưng hàng chưa giao.
- **Ví dụ:** khách trả 1.000.000đ. Cộng 1.000 điểm ngay, hoặc đợi tới khi nhận hàng 4 ngày sau?
- **Tôi khuyên:** **cộng lúc thanh toán** (đúng quy tắc đã duyệt cho Spa). Nếu đơn bị hủy và hoàn tiền thì trừ lại điểm đúng quy tắc hoàn tiền đã duyệt (hoàn đủ thì ví về như cũ).
- **Nếu khác:** cộng lúc giao hàng thì ít phải trừ lại, nhưng khách đợi lâu mới thấy điểm, và đơn online gửi đi mất thêm ngày.

### OQ-34. Báo khách khi hàng về, số điện thoại, giữ hàng bao lâu

- **Ý nghĩa:** khách có tài khoản nhận thông báo trong app và email. Khách vãng lai không có tài khoản thì cần số điện thoại để nhân viên gọi (hệ thống chưa gửi tin nhắn Zalo hay SMS).
- **Ví dụ:** hàng về chiều thứ Năm: khách thành viên nhận chuông thông báo; khách vãng lai hiện trong danh sách "đã về, chưa gọi" của nhân viên.
- **Tôi khuyên:** thông báo trong app + email; **đơn đặt trước bắt buộc có số điện thoại** (không tự bịa, khách tự cung cấp); hàng về giữ cho khách **7 ngày**, quá hạn thì nhắc nhân viên gọi lại, **không tự hủy** đơn.
- **Nếu khác:** không bắt buộc số điện thoại thì khách vãng lai có thể không bao giờ biết hàng đã về. Tự hủy sau N ngày thì phải có quy tắc hoàn tiền rõ trước.

### OQ-35. Mẫu phiếu hẹn nhận hàng

- **Ý nghĩa:** phiếu giống hóa đơn: tên cửa hàng và chi nhánh, mã đơn, ngày thanh toán, từng sản phẩm, số lượng, giá, tổng, "Đã thanh toán", ngày dự kiến có hàng, dòng "dự kiến, không phải cam kết".
- **Ví dụ:** in ngay ở quầy, đồng thời hiện trong "Hóa đơn của tôi" của khách thành viên.
- **Tôi khuyên:** một trang in được bằng trình duyệt; cần Chủ cho biết **máy in dùng khổ nào** (giấy nhiệt 80 mm hay A5/A4) và có in số điện thoại, địa chỉ cửa hàng không.
- **Nếu khác:** nếu chỉ cần bản điện tử (gửi link) thì bỏ phần in, nhanh hơn.

### OQ-36. Ai được mua online, và giao từ chi nhánh nào?

- **Ý nghĩa:** kho tính riêng từng chi nhánh và chưa có chuyển kho (Q13), nên mỗi đơn online phải lấy hàng từ một chi nhánh cố định.
- **Ví dụ:** mọi đơn online lấy từ 04 Nguyễn Quang Bích.
- **Tôi khuyên:** **chỉ thành viên đã đăng nhập** mới đặt (có lịch sử đơn, điểm, thông báo, tra cứu phiếu); **một chi nhánh giao hàng** do Chủ chọn trong cài đặt.
- **Nếu khác:** cho khách vãng lai đặt thì phải có cách tra cứu đơn bằng mã và số điện thoại, và không tích điểm.

### OQ-37. Online: sản phẩm chưa có kho có cho đặt trước không?

- **Ý nghĩa:** Chủ nói hàng thường không có sẵn, nên nếu online chỉ bán hàng có sẵn thì gần như trống.
- **Ví dụ:** trang ghi "Đặt trước, dự kiến hàng về trong 3-5 ngày, sau đó giao tận nơi".
- **Tôi khuyên:** **cho đặt trước online** với sản phẩm đã bật "cho đặt trước", ghi rõ thời gian chờ hàng và thời gian giao.
- **Nếu khác:** chỉ bán hàng có sẵn: đơn giản hơn, nhưng danh mục online sẽ rất nhỏ.

### OQ-38. Phí giao hàng, hãng vận chuyển, ngưỡng miễn phí (cần các con số của Chủ)

- **Ý nghĩa:** PRD ghi mục này là "chưa quyết", tôi không tự đặt. Chủ đã quyết: toàn quốc, trả đủ trước, không COD.
- **Câu hỏi cần Chủ trả lời:** (1) phí cố định, theo cân nặng, hay theo vùng; (2) hãng nào (ví dụ GHN, GHTK, Viettel Post) và ai đặt đơn với hãng; (3) có miễn phí giao hàng từ một mức tiền không, mức bao nhiêu; (4) có cần kích thước gói hàng ngoài cân nặng không.
- **Tôi khuyên:** phiên bản đầu **nhân viên tự tạo đơn trên trang của hãng và nhập mã vận đơn** vào hệ thống (chưa nối API hãng); phí theo bảng cố định theo cân nặng và vùng do Chủ nhập; ngưỡng miễn phí là một con số trong cài đặt. Tôi sẽ không làm gì cho tới khi có số.
- **Nếu khác:** nối API hãng thì tự tính phí và in vận đơn nhưng thêm một đợt công việc và phụ thuộc hãng.

### OQ-39. Hết hạn đơn online chưa thanh toán

- **Ý nghĩa:** đơn online chốt xong thì giữ hàng có sẵn trong lúc khách trả tiền. Nếu không trả, phải nhả hàng ra.
- **Ví dụ:** khách bấm đặt, nhưng bỏ ngang lúc quét mã PayOS.
- **Tôi khuyên:** **30 phút**, sau đó tự hủy đơn chưa trả và nhả hàng; mỗi tài khoản chỉ được một số ít đơn chưa trả cùng lúc để không ai giữ hàng chơi. Hàng đặt trước không giữ gì nên không bị ảnh hưởng.
- **Nếu khác:** dài hơn (vài giờ) thì khách thong thả hơn nhưng hàng có sẵn bị giữ lâu.

### OQ-40. Hạn đổi trả tính từ đâu; giao thất bại thì sao?

- **Ý nghĩa:** các hạn đã duyệt (7 ngày đổi ý, 48 giờ hàng sai hoặc hỏng) cần ngày bắt đầu. "Giao thất bại" (khách không nhận, sai địa chỉ) chưa có quy tắc trong PRD.
- **Ví dụ:** hàng gửi ngày 10, khách nhận ngày 13: 7 ngày tính từ ngày 13.
- **Tôi khuyên:** tính từ **ngày giao khách** (tại quầy: lúc nhân viên bấm "đã giao"; online: ngày nhận ghi nhận trên đơn). Cách xử lý giao thất bại (hoàn tiền trừ phí giao? ai chịu phí?) **Chủ quyết**.
- **Nếu khác:** tính từ ngày thanh toán thì khách đặt trước gần như mất quyền đổi trả khi hàng mới về.

### OQ-41. Giảm giá, voucher và điểm có áp dụng cho phí giao hàng không?

- **Ý nghĩa:** phí giao hàng không phải sản phẩm.
- **Ví dụ:** đơn 1.000.000đ + phí 30.000đ, voucher 10%: giảm 100.000đ hay 103.000đ? Điểm tính trên 1.000.000đ hay 1.030.000đ?
- **Tôi khuyên:** **không áp dụng** giảm giá và không tính điểm cho phí giao hàng; chỉ tính trên sản phẩm.
- **Nếu khác:** tính cả phí thì khách có thể dùng voucher để giảm phí giao hàng, và hoàn tiền phải tách phí ra.

## Câu hỏi của P6-5 (nhập Excel/CSV): **chờ Chủ có/không**, chưa tính là đã duyệt

Chi tiết: `docs/PHASE6_STEP5_IMPORT.md`. Mọi cách đọc dưới đây là của tôi; đã làm theo hướng khuyên nhưng chưa có lời duyệt của Chủ.

### OQ-43. Tệp có dòng lỗi thì xử lý thế nào?

- **Ý nghĩa:** PRD chỉ ghi "phải xác nhận trước khi áp dụng", không nói tệp có dòng lỗi thì sao.
- **Tôi đã làm:** các dòng hợp lệ được nhập cùng lúc (cả lô thành công hoặc không có gì); dòng lỗi **không bao giờ** được nhập. Nếu có dòng lỗi, hộp xác nhận nêu rõ số dòng bị bỏ qua và Chủ phải **tích ô "Tôi hiểu … dòng có lỗi sẽ bị bỏ qua"** mới nhập được.
- **Nếu khác:** chỉ nhập khi **mọi** dòng đều đúng (an toàn hơn, nhưng một dòng sai chặn cả tệp).

### OQ-44. Giới hạn tệp: 5 MB và 2.000 dòng, xử lý ngay (không chạy nền)

- **Ý nghĩa:** thiết kế 11.2 viết "tệp lớn chạy nền (PRD 53)". Tôi chưa làm chạy nền: danh mục spa chỉ vài trăm đến vài nghìn mặt hàng.
- **Đo thực tế:** xem trước dưới 1 giây; nhập 2.000 sản phẩm có giá và giá vốn mất khoảng 23 giây, 2.000 dòng tồn đầu kỳ khoảng 8 giây (giới hạn của giao dịch là 120 giây).
- **Nếu khác:** cần danh mục lớn hơn 2.000 dòng/tệp thì nên làm chạy nền (thêm một đợt công việc).

### OQ-45. Cách viết tệp sản phẩm

- Mỗi dòng là một **phân loại** (một SKU). Cột tùy chọn **"Nhóm sản phẩm"** gom nhiều dòng thành một sản phẩm; để trống thì mỗi dòng là một sản phẩm. SKU đã có thì dòng đó **cập nhật**; **ô để trống nghĩa là giữ nguyên** (không xóa được dữ liệu bằng tệp).
- Sản phẩm mới tạo ở trạng thái **nháp** (đăng bán trong màn hình sản phẩm). **Thương hiệu và danh mục không tự tạo**: tên không có trong hệ thống là lỗi của dòng đó.
- "Cho đặt trước" để trống: sản phẩm mới là **Có** (đúng mặc định đã duyệt), sản phẩm cũ giữ nguyên.

### OQ-46. Tồn đầu kỳ

- Chỉ nhập **một lần cho mỗi phân loại ở mỗi chi nhánh** (đã có nhập hoặc xuất kho thì dòng bị từ chối, dùng phiếu nhập hoặc kiểm kê). Một phân loại có thể có **nhiều lô** trong cùng tệp. Hạn dùng đã qua bị từ chối. Giá vốn chỉ nhập được khi có quyền xem giá vốn.

### OQ-47. Hai thư viện mới

- Đọc tệp .xlsx cần **fflate** (giải nén) và **fast-xml-parser** (đọc XML); cả hai không có phụ thuộc phức tạp (khóa phụ thuộc thêm 9 gói). Đây là quyết định kỹ thuật cần Chủ đồng ý.

### OQ-48. Hai việc PRD 31 chưa làm: khi nào làm?

- **Ảnh hàng loạt theo tên tệp = SKU** (31.3) và **cập nhật giá hàng loạt: xuất ra, sửa, nhập lại, xem khác biệt, xác nhận** (31.4). Lời yêu cầu của Chủ ngày 2026-10-07 chỉ nêu sản phẩm, phân loại và tồn đầu kỳ nên tôi **chưa làm** hai việc này. Chủ cho biết làm ở bước nào.
