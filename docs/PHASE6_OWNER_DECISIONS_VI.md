# Phase 6: các mục chờ Chủ duyệt (giải thích bằng tiếng Việt)

## Đợt 4: bán hàng online (P6-19 đến P6-24). **Chủ đã duyệt ngày 2026-10-09; đã xây xong, đã triển khai (commit `4b91af6`, 2026-10-09 khoảng 14:02, Phase 6 hoàn tất) (mục "Đã duyệt" ngay dưới; các cách hiểu kỹ thuật chờ xem lại ở cuối tệp)**

### Đã duyệt (Chủ, 2026-10-09, nguyên văn; đã khóa)

- **"F1–F4 (3b follow-up) approved as you described. The rollback proof for migration 96 is done together with the Wave 4 milestone."**
- **"Wave 4: T39, T40, T41, T42, OQ-89 to OQ-103 approved as you recommended."** Vậy T39 đến T42 và OQ-89 đến OQ-103 là **đã duyệt đúng như cột "Tôi khuyên"** của bảng bên dưới, kể cả các con số tôi đề xuất (20 dòng, 10 cái mỗi dòng, 3 đơn chưa thanh toán, gửi trong 2 ngày làm việc, giao dự kiến 2 đến 5 ngày, nhắc lúc 08:00 đơn đã gửi quá 7 ngày chưa giao).
- **"T38 changed: no split. Build all of Wave 4 (P6-19 to P6-24, including the full campaigns P6-23) and deploy ONCE, together with the unpushed 3b follow-up."** Không còn 4a/4b; một lần triển khai duy nhất, cùng migration 96.
- **"Add a master switch 'Bán online' in admin, OFF by default after deploy, so online checkout stays closed until I turn it on."** Công tắc **"Bán online"** trong quản trị, **tắt mặc định** sau khi triển khai; tắt thì không đặt hàng được, trang sản phẩm không có nút mua.
- Chủ dặn làm liên tục P6-19 đến P6-24; các lựa chọn kỹ thuật tôi tự chọn theo khuyến nghị, ghi **"chờ Chủ xem lại"** ở các mục P6-19 đến P6-24 bên dưới; không tự bịa tiền hay chính sách; câu nào thật sự cần Chủ thì ghi ở cuối. Chi tiết trong mục 2.37 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`.
- Phần còn lại của mục này (bảng, T38 gốc, rủi ro) giữ nguyên làm lịch sử; **T38 gốc đã được thay như ở trên**.

Đợt 3b đã chạy thật từ 2026-10-09 (bản `43a1b29`, 95 migration, 66 quyền; chưa quyền bán hàng, xử lý đơn hay hoàn tiền nào được gán). Đợt 4 là đợt đầu tiên **khách tự trả tiền qua mạng** và đầu tiên có **địa chỉ nhà khách** và **hàng gửi đi xa**. Mọi thứ dưới đây là đề xuất; **chưa có gì được duyệt cho đến khi Chủ trả lời bằng lời của Chủ**.

### Chủ đã quyết (2026-10-09 và trước đó), đã khóa, không hỏi lại

- **Miễn phí giao hàng cho MỌI đơn online** (Chủ, 2026-10-09): khách chỉ trả tiền hàng, trả đủ trước bằng PayOS; phí giao hàng khách thấy và bị tính **luôn bằng 0**. Quyết định này **thay thế OQ-38** (phí, hãng, ngưỡng miễn phí).
- **Cửa hàng tự trả tiền cho hãng vận chuyển.** Nhân viên đặt hãng **ở ngoài hệ thống** và chỉ **nhập mã vận đơn** vào hệ thống.
- **Giữ trong cài đặt (quản trị) một mục phí giao hàng / ngưỡng miễn phí, nhưng TẮT mặc định**, để dùng sau nếu cần.
- **Giao thất bại** (khách không nghe máy, đi vắng, sai địa chỉ): nhân viên liên hệ khách và giao lại; nếu khách không còn muốn nhận, **hoàn tiền hàng trừ phí vận chuyển hai chiều mà cửa hàng thực trả** (như OQ-40 đã duyệt), **do nhân viên nhập kèm lý do**.
- Từ trước: chỉ thành viên đã đăng nhập mua online; trả đủ trước bằng PayOS, không thu tiền khi giao (COD); giao toàn quốc; hàng gửi từ **04 Nguyễn Quang Bích** (OQ-36); đơn chưa thanh toán tự hủy sau **30 phút** (OQ-39); giảm giá và điểm **không bao giờ** tính cho phí giao hàng (OQ-41; hiện phí bằng 0 nên chưa có tác dụng, chỉ có nghĩa nếu sau này bật phí); online là **giao tận nơi** (OQ-29); sản phẩm chưa có hàng vẫn cho **đặt trước online** (OQ-37); điểm Beauty cộng lúc thanh toán (OQ-33); hạn đổi trả tính từ **ngày khách nhận hàng** (OQ-40); hoàn tiền chỉ bằng tiền mặt hoặc chuyển khoản tay, chỉ người có quyền hoàn tiền, nhập lại mật khẩu (Q4).

### Bảng trả lời nhanh cho Đợt 4

Chủ chỉ cần ghi "đồng ý" hoặc "khác: …" cho từng dòng. Cột "Mức rủi ro" là rủi ro **nếu làm sai**, không phải mức khó. Mục có dấu **(tiền)** đụng tới tiền thật của khách hoặc của cửa hàng.

| Mục    | Chủ đề                                                                                                | Tôi khuyên                                                                                                  | Chặn bước    | Mức rủi ro |
| ------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | ---------- |
| T38    | Thứ tự bước Đợt 4 và **hai lần triển khai** (4a: bán và giao hàng; 4b: khuyến mãi đầy đủ)             | Đồng ý: 4a sau P6-22; P6-23 làm riêng, triển khai sau                                                       | cả Đợt 4     | Trung bình |
| T39    | **Không thêm quyền mới** (vẫn 66 quyền); dùng lại quyền xử lý đơn, quyền hoàn tiền, quyền sản phẩm    | Đồng ý                                                                                                      | P6-20        | Trung bình |
| T40    | Cài đặt phí giao hàng và ngưỡng miễn phí: **tắt mặc định**, chỉ phí cố định và ngưỡng                 | Đồng ý (không cân nặng, không theo vùng)                                                                    | P6-19        | Thấp       |
| T41    | Đơn online **dùng lại** hóa đơn, PayOS, đơn hàng, giữ hàng đã có; thêm trạng thái "đã gửi", "đã giao" | Đồng ý                                                                                                      | P6-19        | **Cao**    |
| T42    | Kiểm tải và bảo mật trước khi mở bán; có chạy nhiều tiến trình API không (mở lại OQ-26)               | Đo thật trước; chỉ thêm tiến trình API nếu số đo cho thấy cần                                               | P6-22        | Trung bình |
| OQ-89  | Giỏ hàng: lưu theo tài khoản; giới hạn số dòng và số lượng                                            | Giỏ lưu theo tài khoản; tối đa 20 dòng, mỗi dòng tối đa 10 cái                                              | P6-19        | Thấp       |
| OQ-90  | Đơn có cả hàng có sẵn và hàng đặt trước                                                               | **Một đơn, một kiện**, gửi khi đủ hàng; báo rõ lúc thanh toán                                               | P6-19, P6-20 | **Cao**    |
| OQ-91  | Sản phẩm nào được bán online                                                                          | Mỗi biến thể có ô "bán online", **mặc định bật**                                                            | P6-19        | Thấp       |
| OQ-92  | Số đơn **chưa thanh toán** tối đa cùng lúc của một tài khoản                                          | 3 đơn                                                                                                       | P6-19        | Trung bình |
| OQ-93  | Địa chỉ giao hàng và số điện thoại nhận hàng (dữ liệu cá nhân)                                        | Nhập 5 ô; lưu theo từng đơn; che bớt trong danh sách; chỉ người xử lý đơn thấy đủ                           | P6-19        | Trung bình |
| OQ-94  | Hứa thời gian gửi hàng và thời gian giao (cần các con số của Chủ)                                     | Gửi trong 2 ngày làm việc kể từ khi có hàng; vận chuyển "dự kiến 2 đến 5 ngày", không phải cam kết          | P6-19        | Trung bình |
| OQ-95  | Hãng vận chuyển, mã vận đơn và **phí hãng cửa hàng thực trả** **(tiền)**                              | Danh sách hãng trong cài đặt; nhập mã vận đơn và phí hãng thực trả lúc gửi (nội bộ, khách không thấy)       | P6-20        | **Cao**    |
| OQ-96  | Ai đánh dấu "đã giao" và khi nào (bắt đầu hạn đổi trả)                                                | Nhân viên đánh dấu; khách cũng bấm được "Tôi đã nhận hàng"; nhắc lúc 08:00 nếu quá 7 ngày chưa xong         | P6-20, P6-21 | Trung bình |
| OQ-97  | Khách hủy đơn online (trước thanh toán, sau thanh toán chưa gửi, đã gửi) **(tiền)**                   | Xem chi tiết: chưa thanh toán tự do; đã thanh toán chưa gửi theo OQ-32; đã gửi thì không hủy                | P6-20        | **Cao**    |
| OQ-98  | Các bước của **giao thất bại** và hoàn tiền trừ phí hai chiều **(tiền)**                              | Xem chi tiết: chỉ hoàn khi hàng đã về cửa hàng; tiền hoàn = tiền hàng đã thu trừ phí hai chiều, thấp nhất 0 | P6-20, P6-21 | **Cao**    |
| OQ-99  | Hoàn tiền đơn online bằng chuyển khoản: lấy số tài khoản của khách thế nào **(tiền)**                 | Nhân viên hỏi khách qua điện thoại/Zalo; hệ thống **không lưu** số tài khoản, chỉ lưu mã giao dịch          | P6-21        | Trung bình |
| OQ-100 | Khách trả hàng **đã nhận** (đổi ý hoặc hàng sai, hỏng): ai chịu phí gửi trả **(tiền)**                | Đổi ý: khách chịu phí gửi trả; hàng sai/hỏng: cửa hàng chịu; không trừ phí giao ban đầu (đã miễn phí)       | P6-21        | **Cao**    |
| OQ-101 | Báo khách về đơn online: trong ứng dụng hay có cả email                                               | Chỉ trong ứng dụng và trên trang đơn (hệ thống chưa có email giao dịch)                                     | P6-21        | Trung bình |
| OQ-102 | Mã giảm giá khi thanh toán online                                                                     | Giảm giá thành viên tự áp dụng; cho nhập **một** mã voucher                                                 | P6-19        | Trung bình |
| OQ-103 | Chính sách giao hàng và đổi trả hiện ở trang thanh toán                                               | Tôi soạn bản nháp từ các quyết định đã duyệt; Chủ sửa; khách tích "đã đọc"                                  | P6-19        | Trung bình |

Nếu Chủ muốn trả lời gọn: "Đợt 4: đồng ý như tôi khuyên" cho cả bảng, hoặc ghi mục nào khác. **Chủ nên đọc kỹ các dòng in đậm "Cao" (T41, OQ-90, OQ-95, OQ-97, OQ-98, OQ-100)**: các dòng này quyết cách tiền được hoàn và hàng đi lại giữa khách và cửa hàng.

### Vì sao Đợt 4 nguy hiểm theo cách khác các đợt trước, và tôi kiểm thế nào

| Rủi ro                                                                                 | Hậu quả thật ở spa                                  | Cách tôi kiểm trước khi đưa cho Chủ                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lần đầu **người lạ trên mạng** chạm vào luồng thanh toán (nhưng phải đăng nhập)        | Đơn giả, chiếm hàng, làm nghẽn hệ thống             | Chỉ thành viên; giới hạn số đơn chưa trả (OQ-92); giới hạn số lần gọi theo tài khoản; kiểm tải thật ở P6-22                                                                                       |
| Khách trả tiền nhưng **PayOS báo chậm, báo hai lần hoặc báo sau khi đơn đã tự hủy**    | Mất tiền khách hoặc hàng bị giữ sai                 | Dùng lại đường thanh toán PayOS đã chạy thật từ Phase 4; kiểm tranh chấp thật: thanh toán đến đúng lúc hết 30 phút, báo hai lần, báo sau khi hủy; đối soát tiền, kho, sổ điểm sau mỗi bài         |
| Hai khách đặt **cái cuối cùng**, hoặc quầy bán cái cuối đúng lúc khách online đang trả | Bán một món hai lần                                 | Dùng chung một số "hàng còn bán được" của chi nhánh với quầy; giữ hàng từ lúc đặt, nhả sau 30 phút; kiểm tranh chấp thật                                                                          |
| **Hoàn tiền sai số** khi giao thất bại (trừ nhầm phí, trừ hai lần, hoàn âm)            | Cửa hàng mất tiền hoặc khách bị trừ oan             | Tiền hoàn tính bằng một công thức duy nhất, thấp nhất 0, không bao giờ vượt tiền hàng đã thu; phí thực trả do nhân viên nhập và lưu lại; bản ghi hoàn tiền không sửa được (như các đợt trước)     |
| Lộ **địa chỉ nhà và số điện thoại** của khách                                          | Khách bị lộ thông tin cá nhân                       | Địa chỉ chỉ đọc được bởi chủ đơn và người xử lý đơn ở chi nhánh; danh sách che bớt; không bao giờ có trong trang công khai, thông báo hay nhật ký (chỉ ghi "đã đổi địa chỉ"); kiểm quyền từng màn |
| Hàng gửi đi nhưng **hệ thống không biết đã giao hay chưa**                             | Hạn đổi trả không bao giờ bắt đầu, tiền treo        | Nhân viên đánh dấu đã giao; khách bấm "đã nhận"; nhắc lúc 08:00 đơn quá hạn (OQ-96)                                                                                                               |
| Quay lại bản cũ sau khi đã có đơn online                                               | Giống Đợt 2 và 3: bản cũ không đọc được dữ liệu mới | Làm lại đúng bằng chứng quay lui (bản cũ trên cơ sở dữ liệu mới có dữ liệu mới), kèm cổng kiểm các số; sau đơn online đầu tiên, quay lại phần mềm không còn là lựa chọn                           |
| Thao tác nhầm của nhân viên (nhập sai mã vận đơn, sai phí, hoàn nhầm)                  | Khách theo dõi sai đơn, hoàn sai tiền               | Nhập mã vận đơn có hộp xác nhận và sửa được bằng bản ghi mới (như sửa mã giao dịch); hoàn tiền nêu rõ số tiền, nhập lại mật khẩu, lý do bắt buộc                                                  |

**Cách tôi kiểm trước khi đưa cho Chủ (giống các đợt trước):** kiểm thử đơn vị và tích hợp trên PostgreSQL thật; kiểm tranh chấp cho mọi lệnh đụng tiền hoặc kho; đối soát sau mỗi bài; chạy lại **toàn bộ kiểm thử của các Phase trước**; kiểm giao diện ở 360, 768, 1440 px sáng và tối, chữ 130%, đủ trạng thái; diễn tập trên bản khôi phục của sao lưu thật; chạy bản cũ trên cơ sở dữ liệu mới; hướng dẫn triển khai từng khối lệnh cho terminal web iNET. Tôi **không chạm vào máy chủ**. Đợt 4 chỉ nên triển khai **khi đã có sản phẩm thật** và Chủ đã thử luồng mua bằng một tài khoản thật với số tiền nhỏ.

### T38. Thứ tự bước Đợt 4 và hai lần triển khai

- **Ý nghĩa:** theo bảng 18.6: P6-19 mua hàng và thanh toán; P6-20 xử lý đơn (đóng gói, gửi, mã vận đơn, đã giao, giao thất bại); P6-21 trả hàng, hoàn tiền, thông báo cho đơn online; P6-22 kiểm tải và bảo mật; P6-23 khuyến mãi đầy đủ (PRD §24.1: chiến dịch theo ngưỡng, giảm giá theo nhóm sản phẩm, biểu ngữ); P6-24 kiểm tra cuối.
- **Tôi khuyên:** **4a = P6-19 đến P6-22** triển khai một lần sau kiểm tra mốc; **P6-23** (khuyến mãi đầy đủ) làm riêng và triển khai sau, vì bán online không cần nó (giảm giá thành viên và voucher đã có). P6-24 là kiểm tra cuối cho cả hai.
- **Nếu khác:** gộp cả P6-23 vào một lần triển khai thì đợi lâu hơn và rủi ro dồn một chỗ; bỏ P6-23 khỏi Phase 6 thì phải ghi lại sang Phase sau.

### T39. Không thêm quyền mới

- **Ý nghĩa:** hiện có 66 quyền. Việc xử lý đơn online đủ dùng lại quyền đã có.
- **Ví dụ:** người đóng gói và gửi hàng cần `MANAGE_PRODUCT_ORDERS` (xem đơn, nhập mã vận đơn, đánh dấu đã gửi và đã giao); chỉ người có `REFUND_PRODUCTS` được hủy đơn đã thanh toán và hoàn tiền (kể cả giao thất bại); `MANAGE_PRODUCTS` sửa cài đặt giao hàng. Địa chỉ nhà khách chỉ hiện cho người có `MANAGE_PRODUCT_ORDERS` hoặc `REFUND_PRODUCTS` ở chi nhánh gửi hàng.
- **Tôi khuyên:** đồng ý, vẫn 66 quyền, không gán thêm cho ai.
- **Nếu khác:** tách quyền riêng cho việc xem địa chỉ khách hoặc nhập phí hãng: an toàn hơn nhưng thêm một quyền (67) và một lần hỏi lại phân quyền.

### T40. Cài đặt phí giao hàng và ngưỡng miễn phí, tắt mặc định

- **Ý nghĩa:** Chủ muốn giữ chỗ này trong quản trị để dùng sau, nhưng hiện miễn phí hết. Cột phí giao hàng đã có sẵn trên hóa đơn (mặc định 0, làm ở P6-8).
- **Ví dụ:** cài đặt có công tắc "Thu phí giao hàng" (tắt), "Phí cố định" (ví dụ 30.000đ) và "Miễn phí từ" (ví dụ 500.000đ). Công tắc tắt thì dù có điền số, khách vẫn thấy "Miễn phí giao hàng" và phí bằng 0.
- **Tôi khuyên:** chỉ phí cố định và ngưỡng miễn phí; **không** cân nặng, **không** theo vùng (Chủ đã bỏ cân nặng). Bật lên cũng không áp giảm giá hay điểm vào phí (OQ-41).
- **Nếu khác:** phí theo vùng hoặc cân nặng cần bảng giá và thêm một đợt việc, chỉ nên làm khi Chủ thật sự cần.

### T41. Đơn online dùng lại bộ máy đã có

- **Ý nghĩa:** thay vì làm hệ thống riêng, đơn online là **hóa đơn kênh online** (chờ thanh toán, rồi đã thanh toán) kèm **đơn hàng và dòng đơn** giống đặt trước tại quầy. Khách tự trả bằng PayOS (liên kết hết hạn sau 30 phút). Hàng có sẵn được giữ ngay khi khách đặt và nhả nếu hết 30 phút; hàng đặt trước không giữ gì cho đến khi hàng về. Kho **chỉ bị trừ khi nhân viên đánh dấu "đã gửi"** (T31 đã duyệt). Thêm hai trạng thái cho dòng đơn online: **Đã gửi**, rồi **Hoàn tất** (có ngày giao).
- **Ví dụ:** chị Hoa đặt 2 hộp kem có sẵn: hàng được giữ, chị quét mã PayOS trong 30 phút, đơn thành "Đã thanh toán", nhân viên đóng gói, gọi hãng, nhập mã vận đơn, hộp kem bị trừ khỏi kho, đơn thành "Đã gửi".
- **Tôi khuyên:** đồng ý. Ưu điểm lớn: tiền, kho, điểm Beauty, thông báo và hoàn tiền đều chạy trên đường đã kiểm kỹ ở các đợt trước. Chỗ rủi ro cao nhất là lúc PayOS báo trùng giờ với lúc hết hạn, nên tôi kiểm tranh chấp thật chỗ này.
- **Nếu khác:** làm hệ thống đơn online riêng thì không ảnh hưởng đường cũ nhưng phải viết lại và kiểm lại từ đầu toàn bộ tiền, kho, điểm.

### T42. Kiểm tải và bảo mật trước khi mở bán (P6-22)

- **Ý nghĩa:** đây là lúc OQ-26 (API chạy một tiến trình) được xem lại, vì lần đầu có khách tự thanh toán qua mạng.
- **Tôi khuyên:** **đo thật trước**: giả lập nhiều khách cùng đặt hàng, trả tiền và PayOS báo cùng lúc (mục tiêu đề xuất: 100 khách đồng thời trong 1 phút). Chỉ chạy nhiều tiến trình API **nếu số đo cho thấy cần**; Chủ duyệt kết quả đo trước khi tôi đổi cấu hình. Thêm giới hạn số lần gọi theo tài khoản cho đặt hàng và thanh toán.
- **Nếu khác:** chạy nhiều tiến trình API ngay: nhanh hơn khi đông nhưng đổi cách chạy máy chủ và phải kiểm lại cổng quay lui.

### OQ-89. Giỏ hàng và các giới hạn

- **Ý nghĩa:** khách có thể mua nhiều món một lần. Giỏ lưu ở đâu và tối đa bao nhiêu.
- **Ví dụ:** chị Hoa thêm kem vào giỏ trên điện thoại buổi sáng, buổi tối mở máy tính vẫn thấy.
- **Tôi khuyên:** giỏ **lưu theo tài khoản** (cả hai máy cùng thấy); tối đa **20 dòng**, mỗi dòng tối đa **10 cái**; giá luôn lấy lại khi thanh toán, không giữ giá cũ trong giỏ.
- **Nếu khác:** giỏ chỉ lưu trong trình duyệt thì đơn giản hơn nhưng mất khi đổi máy; hoặc chỉ có nút "mua ngay" một món.

### OQ-90. Đơn có cả hàng có sẵn và hàng đặt trước

- **Ý nghĩa:** hàng có sẵn gửi được ngay; hàng đặt trước phải chờ 3 đến 5 ngày. Vì cửa hàng trả phí hãng, gửi hai lần là tốn hai lần.
- **Ví dụ:** chị Hoa mua 1 kem có sẵn và 1 son đặt trước.
- **Tôi khuyên:** **một đơn, một kiện, gửi khi đủ hàng**; trang thanh toán ghi rõ "đơn này có hàng đặt trước, sẽ gửi khi đủ hàng, dự kiến …". Nhân viên không tách kiện.
- **Nếu khác:** gửi hàng có sẵn trước và phần còn lại sau: khách nhận sớm hơn nhưng cửa hàng trả hai lần phí hãng và mã vận đơn phải theo từng kiện (thêm việc đáng kể).

### OQ-91. Sản phẩm nào được bán online

- **Ý nghĩa:** có món chỉ nên bán tại quầy (dễ vỡ, cần tư vấn).
- **Ví dụ:** một loại tinh dầu cần tư vấn thì tắt "bán online", trang vẫn xem được và ghi "Mua tại cửa hàng".
- **Tôi khuyên:** mỗi **biến thể** có ô "bán online", **mặc định bật**; tắt thì trang không hiện nút mua.
- **Nếu khác:** mọi sản phẩm đã đăng đều mua được online (không có công tắc), hoặc mặc định tắt và phải bật từng món.

### OQ-92. Số đơn chưa thanh toán tối đa của một tài khoản

- **Ý nghĩa:** đơn chưa trả giữ hàng 30 phút; nếu không giới hạn, một người có thể giữ hết hàng bằng nhiều đơn.
- **Tôi khuyên:** tối đa **3 đơn chưa thanh toán** cùng lúc; đặt thêm thì báo "hãy thanh toán hoặc hủy đơn đang chờ".
- **Nếu khác:** số khác (Chủ cho số), hoặc chỉ 1 đơn một lúc (chặt hơn).

### OQ-93. Địa chỉ giao hàng và số điện thoại nhận hàng

- **Ý nghĩa:** đây là dữ liệu cá nhân. Địa chỉ trong hồ sơ khách (một địa chỉ) không đủ vì mỗi đơn có thể gửi chỗ khác, người nhận khác.
- **Tôi khuyên:** năm ô: tên người nhận, số điện thoại, tỉnh hoặc thành phố (chọn từ danh sách), phường hoặc xã, số nhà và đường (nhập tay). **Lưu theo từng đơn** (không đổi về sau); điền sẵn từ hồ sơ khách và cho lưu địa chỉ dùng lại. Trong danh sách, số điện thoại bị che bớt; chỉ người xử lý đơn và người hoàn tiền ở chi nhánh gửi hàng thấy đủ; không có trong thông báo, nhật ký hay trang công khai.
- **Nếu khác:** một ô địa chỉ tự do thì nhanh hơn nhưng nhân viên khó đọc và đặt hãng; kiểm địa chỉ tự động bằng dịch vụ ngoài thì chính xác hơn nhưng thêm phụ thuộc bên ngoài.

### OQ-94. Hứa thời gian gửi và thời gian giao (cần các con số của Chủ)

- **Ý nghĩa:** PRD ghi thời gian giao hàng là "chưa quyết". Tôi không tự hứa với khách.
- **Tôi khuyên:** cửa hàng **gửi trong 2 ngày làm việc** kể từ khi có hàng; vận chuyển do hãng, ghi **"dự kiến 2 đến 5 ngày, không phải cam kết"**; hệ thống nhắc nhân viên lúc 08:00 những đơn đã thanh toán, đã đủ hàng mà quá 2 ngày làm việc chưa gửi. **Chủ cho con số đúng của cửa hàng** trước khi tôi ghi lên trang.
- **Nếu khác:** không ghi con số nào (chỉ "cửa hàng sẽ báo khi gửi") thì không bị ràng buộc nhưng khách khó tin.

### OQ-95. Hãng vận chuyển, mã vận đơn và phí hãng cửa hàng thực trả (tiền)

- **Ý nghĩa:** Chủ đã quyết nhân viên đặt hãng ở ngoài và chỉ nhập mã. Hai việc cần thêm: (1) tên hãng và đường dẫn tra cứu hiện cho khách; (2) **số tiền cửa hàng thực trả cho hãng**, vì nếu giao thất bại thì số này được trừ khi hoàn tiền (đã duyệt).
- **Ví dụ:** nhân viên đặt hãng X, nhập "Hãng X", mã `ABC123`, phí đi 35.000đ. Khách thấy "Hãng X, mã ABC123" và nút "Tra cứu" nếu hãng có đường dẫn.
- **Tôi khuyên:** **danh sách hãng nằm trong cài đặt** (Chủ nhập tên và, nếu có, mẫu đường dẫn tra cứu; tôi không tự đặt tên hãng nào); nhân viên chọn hãng, nhập mã và **phí hãng thực trả** lúc đánh dấu "đã gửi". Phí này **chỉ nội bộ**, khách không thấy, chỉ người có quyền hoàn tiền thấy. Nhập sai mã hay phí thì sửa bằng bản ghi mới (bản cũ giữ trong lịch sử).
- **Nếu khác:** không nhập phí lúc gửi mà nhập lúc giao thất bại: ít việc hơn lúc gửi nhưng dễ quên hoặc nhớ sai con số.

### OQ-96. Ai đánh dấu "đã giao" và khi nào

- **Ý nghĩa:** hạn đổi trả (7 ngày, 48 giờ) bắt đầu từ ngày khách **nhận** hàng (OQ-40). Hệ thống không nối với hãng nên không tự biết.
- **Tôi khuyên:** nhân viên đánh dấu "đã giao" kèm ngày (xem trên trang tra cứu của hãng); khách cũng có nút **"Tôi đã nhận hàng"** trong trang đơn của mình; ai bấm trước thì tính. Lúc 08:00, đơn **đã gửi quá 7 ngày chưa có ngày giao** hiện trong danh sách nhắc để nhân viên kiểm tra với hãng.
- **Nếu khác:** tự coi là đã giao sau N ngày kể từ lúc gửi (không cần ai bấm) thì đơn giản nhưng có thể tính sai ngày và làm khách mất quyền đổi trả oan.

### OQ-97. Khách hủy đơn online (tiền)

- **Ý nghĩa:** ba lúc khác nhau, ba cách xử lý.
- **Tôi khuyên:** (1) **chưa thanh toán**: khách tự hủy bất cứ lúc nào, hoặc tự hủy sau 30 phút; (2) **đã thanh toán, chưa gửi**: khách liên hệ cửa hàng; người có quyền hoàn tiền hủy dòng và hoàn tiền: hàng có sẵn hoặc đặt trước chưa đặt nhà cung cấp thì **hoàn đủ**; khách đổi ý sau khi đã đặt nhà cung cấp thì **Chủ hoặc quản lý quyết từng trường hợp** (hoàn đủ, một phần hoặc từ chối, có lý do) đúng như đợt 3b; nhà cung cấp không giao được hoặc trễ quá 7 ngày thì hoàn đủ (OQ-32); (3) **đã gửi**: không hủy được; khách từ chối nhận thì đi theo "giao thất bại" (OQ-98), nhận rồi thì đi theo đổi trả (OQ-100).
- **Nếu khác:** cho khách tự hủy cả khi đã thanh toán thì khách tiện hơn nhưng dễ hủy đúng lúc nhân viên đóng gói; khóa hẳn thì dễ tranh cãi.

### OQ-98. Giao thất bại: các bước và công thức hoàn tiền (tiền)

- **Ý nghĩa:** Chủ đã quyết phần chính. Còn các chi tiết sau mà tôi cần Chủ đồng ý, vì chúng quyết khi nào tiền được hoàn.
- **Tôi khuyên:**
  1. Đơn "giao thất bại" (hãng báo không giao được): nhân viên **liên hệ khách, ghi lại từng lần liên hệ và lý do**, rồi cho giao lại; số lần giao lại **nhân viên quyết**, hệ thống không tự giới hạn.
  2. Nếu khách không còn muốn nhận: hãng gửi hàng **về cửa hàng**; nhân viên bấm "hàng đã về cửa hàng" (có ngày). **Chỉ sau bước này mới nhập được khoản hoàn**, để không hoàn tiền khi hàng còn trên đường.
  3. Tiền hoàn = **tiền hàng khách đã thu trừ (phí hãng chiều đi + phí hãng chiều về) mà cửa hàng thực trả**, do nhân viên nhập hai con số và **lý do**; **thấp nhất là 0** (không bao giờ bắt khách trả thêm), không bao giờ vượt tiền hàng đã thu.
  4. Hàng về cửa hàng nhập kho lại thành lô mới mang tên đơn đó; người giữ quyền hoàn tiền quyết "bán lại được" hay không (giống OQ-80); điểm Beauty thu hồi theo đúng số tiền đã hoàn.
  5. Đây là khoản hoàn như mọi khoản hoàn khác: chỉ người có quyền hoàn tiền, nhập lại mật khẩu, Chủ nhận thông báo, bản ghi không sửa được.
- **Nếu khác:** cho hoàn ngay khi hãng báo thất bại (trước khi hàng về) thì khách có tiền sớm nhưng cửa hàng có thể chưa nhận được hàng; trừ phí cố định thay cho phí thực trả thì dễ hơn nhưng không đúng ý Chủ ("phí thực trả").

### OQ-99. Hoàn tiền đơn online bằng chuyển khoản: số tài khoản của khách

- **Ý nghĩa:** khách trả bằng PayOS nhưng hoàn tiền chỉ bằng chuyển khoản tay (Q4: không bao giờ hoàn qua PayOS). Nhân viên cần số tài khoản để chuyển; tại quầy OQ-83 đã quyết không lưu số tài khoản.
- **Tôi khuyên:** nhân viên **hỏi khách qua điện thoại hoặc Zalo** lúc cần, chuyển khoản rồi ghi **mã giao dịch ngân hàng**; hệ thống **không lưu số tài khoản** (giống OQ-83). Nếu nhập mã giao dịch sai thì sửa bằng bản ghi mới (đã có từ đợt 3b).
- **Nếu khác:** khách nhập sẵn số tài khoản lúc đặt: tiện hơn nhưng thêm dữ liệu nhạy cảm phải bảo vệ.

### OQ-100. Khách trả hàng đã nhận: ai chịu phí gửi trả (tiền)

- **Ý nghĩa:** khi khách đã **nhận** hàng rồi muốn trả, hàng phải gửi ngược về. PRD có ô "ai chịu phí gửi" trong hồ sơ trả hàng nhưng chưa có quy tắc. Giao hàng đi miễn phí, nên khác với giao thất bại (hàng chưa tới tay khách).
- **Tôi khuyên:** **đổi ý** (hạn 7 ngày): khách tự chịu phí gửi hàng về, cửa hàng hoàn tiền hàng đủ và **không trừ phí giao ban đầu** (vì đã miễn phí); **hàng sai, hỏng** (hạn 48 giờ): cửa hàng chịu phí gửi trả (nhân viên ghi số tiền, đây là chi phí của cửa hàng, không trừ vào khoản hoàn). Các quy tắc còn lại (ảnh bằng chứng, niêm phong, duyệt, hoàn tiền) y như trả hàng tại quầy.
- **Nếu khác:** cửa hàng chịu mọi phí gửi trả (thân thiện nhưng tốn), hoặc trừ phí giao ban đầu khi khách đổi ý (đi ngược lời "miễn phí giao hàng", không khuyên).

### OQ-101. Báo khách về đơn online

- **Ý nghĩa:** hôm nay Chủ quyết chưa gửi email "hàng đã về" cho đặt trước tại quầy (hệ thống chưa có email giao dịch). Đơn online cần báo nhiều lúc: đã nhận đơn, đã thanh toán, đã gửi (kèm mã vận đơn), đã giao, giao thất bại, đã hoàn tiền.
- **Tôi khuyên:** **chỉ trong ứng dụng** (chuông thông báo) và hiện đầy đủ trạng thái, mã vận đơn trên **trang đơn** của khách; khách không có tài khoản không mua online được nên không bị bỏ sót. Email giao dịch (cần cấu hình gửi thư và tên miền gửi) để một đợt riêng nếu Chủ muốn.
- **Nếu khác:** làm email giao dịch trước khi mở bán online: khách yên tâm hơn nhưng thêm một đợt việc và phần cấu hình ngoài hệ thống.

### OQ-102. Mã giảm giá khi thanh toán online

- **Ý nghĩa:** hệ thống đã có giảm giá thành viên (Beauty) và voucher. Cần biết khách được dùng gì ở trang thanh toán.
- **Tôi khuyên:** giảm giá thành viên **tự áp dụng** như ở quầy; khách có thể nhập **một** mã voucher (dùng lại luật đã duyệt: mỗi bên chỉ một ưu đãi tốt nhất, không cộng dồn); quà sinh nhật chỉ dành cho dịch vụ nên không có ở đây; không áp cho phí giao hàng (OQ-41). Chương trình khuyến mãi đầy đủ chờ P6-23.
- **Nếu khác:** không cho nhập voucher online (đơn giản hơn) hoặc cho nhiều mã (khó kiểm hơn).

### OQ-103. Chính sách giao hàng và đổi trả ở trang thanh toán

- **Ý nghĩa:** khách đồng ý các điều kiện trước khi trả tiền: miễn phí giao hàng, thời gian gửi dự kiến, hàng đặt trước, hủy đơn, đổi trả (7 ngày, 48 giờ), giao thất bại bị trừ phí hai chiều.
- **Tôi khuyên:** tôi **soạn bản nháp bằng tiếng Việt thường** chỉ từ các quyết định Chủ đã duyệt, **không thêm điều khoản mới**; Chủ sửa; trang thanh toán có ô "Tôi đã đọc" bắt buộc tích. Nội dung này sửa được trong quản trị.
- **Nếu khác:** để Chủ hoặc người tư vấn pháp lý soạn toàn bộ văn bản: chính xác hơn, nhưng P6-19 phải đợi văn bản.

### Việc tôi làm tiếp theo khi Chủ đã trả lời

1. Ghi câu trả lời đúng lời Chủ vào tài liệu thiết kế, tài liệu này và `LUCYSPA_HANDOFF.md` (mục nào chưa được trả lời thì giữ "chờ Chủ duyệt", không tự duyệt).
2. Làm P6-19 trước (mua hàng và thanh toán), dừng cho Chủ xem; rồi P6-20, P6-21, P6-22. Mỗi bước có báo cáo ngắn, kiểm giao diện, và chỉ commit trên máy khi Chủ chưa bảo đẩy lên.
3. Sau P6-22: kiểm tra mốc 4a (đầy đủ như các đợt trước), diễn tập trên bản khôi phục, bằng chứng quay lui, hướng dẫn triển khai cho terminal iNET.

## Đợt 3b (mốc 3b: đặt hàng trước tại quầy): các lựa chọn kỹ thuật **chờ Chủ xem lại**

Chủ dặn (2026-10-08, mục 2.29 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`): chọn theo đề xuất của tôi, ghi là "chờ Chủ xem lại" và làm tiếp; không tự bịa chính sách về tiền. Mỗi bước ghi thêm vào đây. Mục nào đụng tới tiền hoặc quyền của người làm được đánh dấu **(tiền/quyền)**.

### P6-15 (cơ sở dữ liệu đơn đặt trước, kho): chờ Chủ xem lại

- **Đơn và dòng đơn được tạo lúc chốt hóa đơn, không phải lúc thanh toán.** Hệ thống tự chuyển sang "đã thanh toán" khi hóa đơn được trả (tiền mặt, PayOS hay hóa đơn 0 đồng), tự hủy khi hóa đơn chưa trả bị hủy. Lý do: một luật chung cho mọi cách trả, và số điện thoại hỏi một lần ở quầy.
- **Ngày dự kiến có hàng** tính lúc thanh toán: ngày trả (giờ chi nhánh) + số ngày chờ của sản phẩm (nếu có) hoặc mặc định 3 đến 5 ngày; ghi là "dự kiến, không phải cam kết"; không đổi về sau.
- **(tiền/quyền) Đảo thanh toán của đơn đặt trước:** được phép chỉ khi chưa đặt hàng với nhà cung cấp; từ lúc đã đặt hàng trở đi, hóa đơn giữ nguyên các lần thanh toán, đường duy nhất là hủy dòng và hoàn tiền (P6-17). Chủ cho biết nếu muốn khác.
- **Chia hàng về (phân bổ):** chỉ phân cho dòng đơn mà số hàng đủ cho **cả dòng** (không chia lẻ, theo OQ-84), người trả tiền sớm nhất trước. Nếu dòng sớm nhất cần nhiều hơn số hàng về thì dòng sau (cần ít hơn) vẫn được phân, để hàng không nằm không. Cách "xếp hàng nghiêm ngặt" (dòng sớm nhất chưa đủ thì không ai được) chỉ cần đổi một dòng mã; **Chủ chọn**.
- **Hàng về được giữ riêng** cho dòng đơn (không bán cho người khác); hàng xuất kho **khi giao cho khách** (không phải lúc thanh toán), do bộ xử lý nền hiện có ghi, theo thứ tự hạn dùng gần nhất.
- **Trả hàng:** dòng đặt trước chỉ mở hồ sơ trả hàng sau khi đã giao và hàng đã xuất kho; hạn 7 ngày / 48 giờ tính từ lúc giao (OQ-40).
- **Quyền:** bán đặt trước = `SELL_PRODUCTS`; hàng đợi "cần đặt", đánh dấu đã đặt, giao hàng, liên kết phiếu = `MANAGE_PRODUCT_ORDERS` (quyền mới, chưa gán cho ai); hủy và hoàn tiền = `REFUND_PRODUCTS`.
- Mã đơn `DT000001`; lý do hủy theo OQ-32.

### P6-16 (bán đặt trước tại quầy và phiếu hẹn nhận hàng): chờ Chủ xem lại

- **Thu ngân tự chọn** "Hàng có sẵn" hay "Đặt trước" cho từng dòng; chỉ sản phẩm "cho đặt trước" mới chọn được. Không bao giờ tự đổi một dòng thành đặt trước.
- **Chốt hóa đơn có hàng đặt trước thì phải nhập số điện thoại khách** (tên không bắt buộc). Số được lưu dạng +84..., không ghi vào nhật ký kiểm toán.
- **Nếu kho đang đủ hàng cho cả dòng** thì không cho chốt dưới dạng đặt trước ("Kho đang đủ hàng, hãy bán như hàng có sẵn"): tránh khách chờ hàng về trong khi hàng đang nằm trên kệ. Đặt trước nhiều hơn số tồn thì được, nguyên cả dòng.
- **Phiếu hẹn nhận hàng, khách có tài khoản:** thấy ngay trong hóa đơn của mình (mã đơn, trạng thái, ngày dự kiến). **Khách vãng lai:** nhân viên tạo liên kết riêng + mã QR, tự gửi qua Zalo; liên kết chỉ hiện một lần, tạo liên kết mới thì liên kết cũ hết dùng, có thể thu hồi; trang chỉ đọc, không có số điện thoại.
- **Câu hỏi cho Chủ:** liên kết phiếu có tự hết hạn sau khi đơn hoàn tất hoặc hủy không, và sau bao nhiêu ngày? Chủ chưa cho con số nên hiện **không tự hết hạn** (nhân viên thu hồi được bất cứ lúc nào).

### P6-18 (kho của quà tặng sản phẩm, Q10): chờ Chủ xem lại

- **Quà tặng gắn với một sản phẩm (không bắt buộc).** Khi nhân viên bấm "đã dùng" một lượt quà ở chi nhánh nào thì **kho của chi nhánh đó trừ 1 sản phẩm**, lấy từ lô hết hạn sớm nhất, không lấy lô đã hết hạn.
- **Hàng đang giữ cho hóa đơn hoặc cho đơn đặt trước (hàng đã về) thì không được đem tặng.** Hết hàng thì báo "Hết hàng" và **không ghi lượt dùng**.
- **Bấm nhầm:** quản lý hoàn lại lượt dùng thì sản phẩm **trả về đúng lô cũ**, một lần. Lượt dùng cũ vẫn nằm trong lịch sử.
- Quà không gắn sản phẩm (kể cả quà tạo từ trước) **không trừ kho**. Không có tiền, hóa đơn hay điểm. Đã có người dùng quà thì không đổi sản phẩm gắn được nữa (tạo quà mới).

### P6-17 (làm việc với đơn đặt trước: danh sách cần đặt, hàng về, giao hàng, hủy và hoàn tiền): chờ Chủ xem lại

- **Trang "Hàng đặt trước"** có năm nhóm: Cần đặt, Đã đặt, Hàng đã về, Đã giao, Đã hủy. "Cần đặt" gom theo **nhà cung cấp quen thuộc** của từng sản phẩm (ô mới ở biến thể, không bắt buộc); sản phẩm chưa có nhà cung cấp xếp cuối.
- **Hàng về:** nhập kho xong là hệ thống tự giữ hàng cho đơn trả tiền sớm nhất (chỉ giữ cả dòng, đủ hàng mới giữ). Hủy một dòng đã giữ hàng thì hàng chuyển ngay cho đơn kế tiếp. Có nút "Cấp hàng" khi hàng được trả về kho bằng cách khác. **Không có tiến trình chạy ngầm tự cấp hàng** (mỗi lần cấp cần ghi tên người gây ra, đặt một "người dùng hệ thống" là tự nghĩ ra).
- **Báo khách:** khách có tài khoản nhận thông báo trong app khi hàng về (chỉ ghi mã đơn). **Chưa làm email** (hệ thống chưa có chỗ gửi email giao dịch). Mỗi sáng 08:00 người có quyền xử lý đơn nhận một thông báo nếu có dòng trễ hẹn hoặc hàng về quá 7 ngày chưa có người nhận; nhân viên gọi khách, **hệ thống không tự hủy hay đổi gì**.
- **Giao hàng:** người đến nhận đọc mã đơn và 4 số cuối điện thoại; hệ thống đối chiếu và không lưu những gì đã đọc, không nói sai phần nào. Người nhận thay được ghi tên.
- **Hủy và hoàn tiền:** lý do theo từng trạng thái (OQ-32). Hoàn **đúng toàn bộ số tiền của dòng**, tiền mặt hoặc chuyển khoản; hỏi lại mật khẩu mỗi lần hoàn, Chủ nhận thông báo, điểm Beauty được trừ lại. Dòng chưa thu tiền thì không hoàn, không hỏi mật khẩu. **Không tự đặt mức hoàn một phần**.
- **Câu hỏi cho Chủ:** (1) liên kết phiếu có hết hạn không; (2) có gửi email báo hàng về không (cần chỗ gửi email giao dịch); (3) khách đổi ý sau khi cửa hàng đã đặt hàng thì hoàn đủ hay trừ phí (hiện hoàn đủ, chưa có số nào); (4) có cho một "người dùng hệ thống" tự cấp hàng chạy ngầm không.

**Chủ đã duyệt (2026-10-08, nguyên văn): "Owner decisions: P14-2, P14-3, P14-4, P14-5, P14-15 approved as you recommended."** Vậy toàn bộ P14-1 đến P14-16 (đổi hàng) đã được duyệt: cùng sản phẩm thì đổi miễn phí; giá hàng mới là giá hôm nay, không áp giảm giá; khách chưa trả đồng nào cho dòng hàng thì không đổi; người đổi chỉ cần quyền hoàn tiền; hàng thay thế không được mở hồ sơ trả hàng. Đợt 3a đã lên máy chủ thật (mục 2.29 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`). Các lựa chọn kỹ thuật của P6-15 đến P6-18 (mốc 3b) ghi ở các mục sau với nhãn **chờ Chủ xem lại**.

**Chủ nói (2026-10-08, nguyên văn): "P12–P14 and N1–N4: list each in the chat, one short line in plain Vietnamese with your recommendation. If none of them changes money policy (refund amounts, who can refund, return windows, points), treat them as approved as you proposed and record that. If any does change money policy, do not treat it as approved; ask me."** Tôi áp dụng từng mục: mục **không** đổi số tiền hoàn, người được hoàn, hạn trả hay điểm thì **coi là đã duyệt như đề xuất**: N1 to N4, P14-1, P14-6, P14-7, P14-8, P14-9, P14-10, P14-11, P14-12, P14-13, P14-14, P14-16. Mục **có** đụng tới một trong bốn thứ đó thì **không** coi là duyệt, chờ Chủ trả lời: **P14-2, P14-3, P14-4, P14-5, P14-15** (giá khi đổi cùng sản phẩm; giá hôm nay không áp giảm giá; khách chưa trả đồng nào thì không đổi; ai được đổi; hàng thay thế có được trả tiếp không). P12 và P13 Chủ đã duyệt bằng lời riêng (mục 2.25, 2.27).

**P6-14 (đổi hàng) đã làm xong ở máy theo yêu cầu của Chủ ngày 2026-10-08 (nguyên văn ở mục 2.27, cách làm ở mục 2.28 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`, báo cáo `docs/PHASE6_STEP14_PRODUCT_EXCHANGES.md`); chưa đẩy lên, chưa triển khai, chưa gán quyền.** Tiền đúng lời Chủ: chênh lệch = giá hàng mới hôm nay trừ số tiền khách thực trả cho hàng cũ; đắt hơn thì khách trả thêm như một hóa đơn thường (tiền mặt hoặc PayOS); rẻ hơn thì hoàn bằng tiền mặt hoặc chuyển khoản thủ công (nhập lại mật khẩu, Chủ nhận thông báo). Điểm Beauty giữ nguyên, chỉ cộng thêm trên phần khách trả thêm, đổi bằng giá hoặc rẻ hơn không cộng không trừ. **Các cách tôi tự hiểu, chờ Chủ (nói gọn):** (1) đổi nguyên số lượng của hồ sơ, sang đúng một sản phẩm khác đang có trong kho, mỗi hồ sơ một lần đổi tại một thời điểm; (2) đổi sang **cùng sản phẩm** thì miễn phí, không tính chênh lệch (câu OQ-82 nói đổi cùng loại chênh lệch bằng 0), đổi sang sản phẩm khác thì áp công thức chung; (3) giá hàng mới là giá hôm nay (kể cả khuyến mãi đang chạy), không áp giảm giá, voucher hay quà nào lên hàng mới; (4) khách không phải trả đồng nào cho dòng hàng thì không đổi được; (5) người đổi chỉ cần quyền hoàn tiền, người thu phần chênh cần quyền thu tiền; (6) khi khách còn phải trả thêm, hàng cũ chỉ được nhận lại sau khi hóa đơn đổi được thanh toán (bấm "Hoàn tất đổi", chọn bán lại được hay không); (7) một lần đổi chưa xong thì chặn mọi việc khác trên dòng hàng, muốn bỏ thì hủy hóa đơn đổi chưa thanh toán; (8) lần đổi đã hoàn tất không đảo được; (9) Chủ chỉ nhận thông báo khi có tiền hoàn lại; (10) **hàng mới của một lần đổi không được mở hồ sơ trả hàng nữa** (PRD 28.4: ngoại lệ lỗi sản phẩm không mở thêm hạn mới; phần tiền của dòng gốc đã dùng cho lần đổi); (11) khách là thành viên thấy hóa đơn đổi với một dòng giảm "đã trả cho hàng cũ, đổi hàng", và lần đổi không mất tiền không gửi thông báo "đã thanh toán 0 ₫". Chủ cũng bảo làm tiếp **kiểm tra mốc 3a** (như Đợt 2).

**Chủ đã duyệt P6-13 (2026-10-08, nguyên văn ở mục 2.27 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`): "P6-13 approved: E1–E6 and P13-2, P13-4 to P13-9 as you proposed. P13-1: yes, a refund requires an accepted return case. P13-3: password re-entry once per refund (no 5-minute window)."** Nghĩa là: (a) P13-1 duyệt: chỉ hoàn tiền cho hồ sơ trả hàng đã chấp nhận; (b) **P13-3 đổi: mỗi lần hoàn tiền phải nhập lại mật khẩu, một lần nhập chỉ dùng cho đúng một lần hoàn, không còn "cửa sổ 5 phút"** (làm xong: cơ sở dữ liệu ghi lại mỗi lần dùng mật khẩu và từ chối dùng lần hai; hoàn tiền bị từ chối vì lý do khác thì chưa tiêu lần nhập); (c) **Chủ thêm: mỗi lần hoàn tiền sản phẩm gửi một thông báo trong ứng dụng cho Chủ** (hóa đơn, sản phẩm, số lượng, số tiền, cách hoàn, người hoàn). Cách tôi hiểu thông báo, **chờ Chủ**: N1 tên người hoàn nằm trong thông báo (ngoại lệ duy nhất của quy tắc "thông báo không mang tên"; không có lý do, mã chuyển khoản hay số tài khoản); N2 Chủ tự hoàn cũng nhận thông báo ("mọi lần hoàn"); N3 chỉ tài khoản Chủ nhận, không phải người giữ quyền hoàn tiền; N4 khóa dòng tài khoản Chủ trước khi khóa hóa đơn. Chủ cũng bảo làm tiếp **P6-14 (đổi hàng)** và **kiểm tra mốc 3a**.

**P6-13 (hoàn tiền từng dòng sản phẩm) đã làm theo yêu cầu của Chủ ngày 2026-10-08 (nguyên văn ở mục 2.26 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`).** Các cách hiểu P13-1 đến P13-9 **đã được Chủ duyệt ngày 2026-10-08, riêng P13-3 được Chủ đổi (xem đoạn ngay trên)**; nói gọn lúc đầu: (1) chỉ hoàn tiền cho hồ sơ trả hàng đã chấp nhận theo cách "hoàn tiền"; (2) mỗi lần hoàn là một dòng hàng, tính theo số lượng; (3) "nhập lại mật khẩu mỗi lần hoàn" làm theo cách của dự án (xác nhận mật khẩu trong vòng 5 phút, giống đảo thanh toán), thời điểm xác nhận được lưu trên phiếu hoàn; (4) mã chuyển khoản chỉ gồm chữ, số và dấu `. _ / -`, màn hình dặn rõ không nhập số tài khoản; (5) sửa sai chỉ làm được cho mã chuyển khoản (thêm một dòng sửa, phiếu hoàn không đổi); (6) đặt tên lô hàng trả về `{mã hồ sơ}-{số thứ tự}`, giữ hạn dùng của lô đã bán; (7) chưa làm thông báo "hoàn tiền bất thường" của mục 10.1, khoản thiếu điểm hiện ở màn "Ngoại lệ" có sẵn; (8) trạng thái "đã hoàn" của dòng chỉ hiện ở trang hồ sơ; (9) không sửa test POS hay thanh toán nào. Quyền `REFUND_PRODUCTS` vẫn chưa gán cho ai.

**Chủ đã duyệt P6-12 (2026-10-08, nguyên văn ở mục 2.25 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`): "P6-12 approved: R1, R2, R3, R8, R10 and the other R items in section 2.24 as you proposed."** Tức là mười hai cách hiểu R1 đến R12 (ai xem ảnh, ai quyết ca kích ứng da, hạn 168 giờ, Chủ tự xóa ảnh, thông báo...) đều đã được duyệt. **Một thay đổi của Chủ ở R3:** _"the Owner (only the Owner) may approve a return outside the time window as an exception, with a mandatory written reason, recorded in the case history and audit log."_ Nghĩa là: quá hạn (7 ngày hoặc 48 giờ) thì nhân viên vẫn bị từ chối như trước; **chỉ Chủ** mới mở được hồ sơ quá hạn, và **bắt buộc ghi lý do bằng chữ**. Lý do nằm trên hồ sơ, trong lịch sử hồ sơ và trong nhật ký. Cách làm (E1 đến E6 ở mục 2.25, **chờ Chủ xác nhận**): Chủ tự mở hồ sơ quá hạn kèm lý do (không có bước "nhân viên mở, Chủ duyệt sau" vì nhân viên không mở được); hồ sơ "giao nhầm hoặc hỏng" mở theo ngoại lệ được chấp nhận với bất kỳ ảnh nào còn trên hồ sơ (vì hạn 48 giờ đã qua trước khi hồ sơ có).

**Chủ đã duyệt Đợt 3 (2026-10-08, nguyên văn ở mục 2.23 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`): "Wave 3 decisions approved as you recommended: T34, T35, T36, T37, OQ-79 to OQ-88".** Cột "Tôi khuyên" của bảng "Đợt 3" là câu trả lời đã được duyệt: hai mốc triển khai 3a và 3b (T34), hồ sơ trả hàng với ảnh bằng chứng riêng tư (T35), quyền mới `MANAGE_PRODUCT_ORDERS` ở P6-15 (T36), trừ kho quà tặng (T37), ảnh bằng chứng giữ cùng hồ sơ, chỉ xóa ảnh khi khách yêu cầu và Chủ duyệt, có nhật ký (OQ-79), và OQ-80 đến OQ-88. Chủ bảo làm **P6-12 (hồ sơ trả hàng) và chỉ bước này**: không có tiền hoàn, không có chuyển kho (đó là P6-13, P6-14); `MANAGE_PRODUCT_RETURNS` vẫn không gán cho ai. Những chỗ hợp đồng chưa nói rõ và tôi phải tự hiểu nằm ở mục 2.24 của tài liệu thiết kế, **chờ Chủ**.

**Mới (2026-10-08): mục "Đợt 3"** (trả hàng, hoàn tiền, đổi hàng, đặt trước tại quầy, quà tặng) nằm ngay sau mục "Đợt 2". Các dòng đã được duyệt như đoạn trên.

**(2026-10-07, ngay bên dưới): mục "Đợt 2"** (bán sản phẩm tại quầy; sửa POS, hóa đơn, thanh toán đang chạy thật) với bảng trả lời nhanh, rủi ro và cách kiểm.

**Chủ đã trả lời Đợt 2 (2026-10-07, nguyên văn ở mục 2.13 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`): "Wave 2 decisions approved as you recommended"** cho T17, T18, T19, T20, T26, T27, OQ-58, OQ-59, OQ-60 và, cho Đợt 3, T21, T22, T23 (**"48 hours from handover"**: hạn 48 giờ tính từ lúc giao hàng cho khách, không tính từ lúc thanh toán). Cột "Tôi khuyên" của bảng dưới đây là câu trả lời đã được duyệt. Chủ cũng bảo bắt đầu **P6-8** (chỉ bước này). OQ-59 đổi quy tắc "kiểm vi sai": bộ tính cũ vẫn là chuẩn cho hóa đơn chỉ có dịch vụ, bộ mới chạy song song để so và báo lệch (việc của P6-9, chưa làm). **Đính chính (Chủ, 2026-10-08):** câu "chưa được trả lời" trước đây là sai. Cách sắp xếp khóa kho (chi nhánh, biến thể) ở T13 và OQ-P6-19 (làm tròn điểm khi hoàn tiền, phương án A) đã được Chủ duyệt từ 2026-10-07 (mục 2.5). Không còn mục nào của Đợt 2 đang chờ.

**P6-8 đã làm xong và được Chủ duyệt ngày 2026-10-08 (báo cáo `docs/PHASE6_STEP8_PRODUCT_LINES.md`; nguyên văn ở mục 2.15 của tài liệu thiết kế): OQ-61 đến OQ-65 "as you proposed" (OQ-65: bảng theo từng bên và cột phạm vi giảm giá nằm trong P6-9). Bốn điểm đã được duyệt:** OQ-61: Chủ (hoặc người không thuộc chi nhánh) bán hàng phải chọn người bán là nhân viên của chi nhánh, hệ thống không tự điền; OQ-62: dòng sản phẩm của hóa đơn **nháp** được xóa hẳn (nhật ký vẫn lưu), dòng khác của hóa đơn không bao giờ xóa; OQ-63: hóa đơn sản phẩm đã thanh toán vẫn **giữ hàng** (chưa trừ kho) cho đến P6-10; OQ-64: không cho điều chỉnh/kiểm kê làm tồn kho thấp hơn số đang giữ cho hóa đơn. Cho đến P6-9/P6-11, dòng sản phẩm **chưa có giảm giá và chưa cộng điểm**.

**P6-10 đã được Chủ duyệt ngày 2026-10-08 (nguyên văn ở mục 2.19 của tài liệu thiết kế): "OQ-72, 73, 74, 76 as proposed" và OQ-75 được đổi.** OQ-72 (cây danh mục tại lúc chốt hóa đơn là cây được áp dụng), OQ-73 (lệnh hủy tự trả hàng đã xuất kho), OQ-74 (người ghi trên phiếu xuất kho) và OQ-76 (người bán mặc định là người đang thêm dòng sản phẩm, không phải người tạo hóa đơn) đã được duyệt đúng như đề xuất. **OQ-75 đổi:** lô đã quá hạn vẫn chỉ dùng là biện pháp cuối cùng (để tồn kho vẫn khớp sau khi thanh toán), nhưng ngay lúc đó hệ thống phải **gửi thông báo trong ứng dụng** cho những người có quyền xem kho ở chi nhánh đó, nêu rõ hóa đơn, sản phẩm và lô, để quản lý kiểm tra hàng đã giao cho khách. Chủ cũng bảo làm **P6-11** (điểm Beauty, bậc hội viên Beauty, thẻ Beauty hiện đúng %, mốc kết thúc Đợt 2: kiểm thử đầy đủ, thử quay lui, thử trên bản sao dữ liệu thật, hướng dẫn triển khai). Không còn câu hỏi mở nào của P6-10.

**Đợt 2 đã được Chủ duyệt ngày 2026-10-08 (nguyên văn ở mục 2.21 của tài liệu thiết kế): "OQ-77 and OQ-78 as proposed".** Thông báo lô hết hạn ghi SKU, mã hóa đơn, mã lô và mở trang kho của sản phẩm (OQ-77); ô "Phạm vi" của giảm giá nằm trong P6-11 (OQ-78). Chủ cho biết website hiện chỉ dùng nội bộ (chưa công khai, chưa có khách), nên có thể triển khai bất kỳ giờ nào. **Bán thử có giám sát (OQ-60) được hoãn** vì chưa có sản phẩm thật (sau Phase 9): sau khi triển khai, quyền `SELL_PRODUCTS` vẫn **không gán cho ai**. Chủ yêu cầu thêm: bảng hạng của khách đánh dấu cả hạng Beauty (đã làm), đẩy lên và chờ CI, rồi điền mã commit vào hướng dẫn.

**P6-11 đã làm xong ở máy, chưa đẩy lên, chưa triển khai (báo cáo `docs/PHASE6_STEP11_BEAUTY_WAVE2.md`, mục 2.20 của tài liệu thiết kế).** Điểm Lucy Beauty cộng một lần cho mỗi lần thanh toán hóa đơn có sản phẩm, cho người trả tiền (khách vãng lai không có điểm), tính trên tiền sản phẩm sau giảm giá, không tính phí vận chuyển; đảo khoản thu thì thu hồi điểm theo quy tắc cũ. Thẻ Beauty của khách hiện phần trăm hạng thật. Thông báo lô hết hạn theo OQ-75 đã đổi. **Hai điểm tôi tự hiểu (đã được Chủ duyệt ngày 2026-10-08, xem đoạn trên): OQ-77** thông báo lô hết hạn ghi mã SKU, mã hóa đơn và mã lô, và mở trang kho của sản phẩm (không mở hóa đơn, vì người nhận có quyền xem kho chứ chưa chắc có quyền xem hóa đơn); **OQ-78** ô "Phạm vi" của màn hình giảm giá (Dịch vụ, Sản phẩm, Cả hai) được làm trong P6-11 vì bảng thiết kế xếp nó ở đây, dù tin nhắn của Chủ chỉ nêu bốn ý.

**P6-10 (bán sản phẩm tại quầy, trừ kho, xem hóa đơn của khách) đã làm xong ở máy, chưa đẩy lên, chưa triển khai; chờ Chủ duyệt (báo cáo `docs/PHASE6_STEP10_POS_PRODUCTS.md`, mục 2.18 của tài liệu thiết kế).** Đã làm: màn hình quầy thêm sản phẩm vào hóa đơn (tìm theo tên, nhãn hiệu, loại hoặc mã SKU không cần gõ dấu; chọn loại; số lượng; người bán bắt buộc, mặc định là người tạo, Chủ phải chọn nhân viên; chỉ sửa người bán khi hóa đơn còn nháp; hiện rõ "Hết hàng" và lỗi hết hàng nêu tên sản phẩm); hóa đơn chỉ có sản phẩm; bảng ưu đãi theo từng bên; sau khi thanh toán, hàng đã giữ được xuất kho (lô sắp hết hạn trước); hoàn thanh toán hoặc hủy hóa đơn thì hàng trả về đúng các lô cũ; khách xem sản phẩm (tên, loại, số lượng, giá), không thấy người bán, giá vốn, mã SKU; hóa đơn chỉ có sản phẩm không bị coi là lượt làm dịch vụ; danh sách hóa đơn của nhân viên hiện số sản phẩm và người bán. **Năm điểm tôi tự hiểu, cần Chủ đồng ý hoặc sửa:** **OQ-72** (xem ở đầu mục này); **OQ-73** khi hủy hóa đơn mà hàng đã xuất kho nhưng hệ thống nền chưa kịp trả lại, lệnh hủy tự trả hàng ngay (khác một câu trong thiết kế gốc nhưng kết quả giống, và hóa đơn đã hủy không bao giờ còn giữ hàng đã bán); **OQ-74** người ghi trên phiếu xuất kho là người đã chốt hóa đơn (khi trả hàng lúc hủy là người hủy); **OQ-75** hàng xuất kho theo lô gần hết hạn nhất trước, lô đã quá hạn chỉ dùng khi các lô còn bán được không đủ vì có lô hết hạn sau khi đã giữ hàng. **OQ-76** thiết kế 5.3 nói người bán mặc định là người tạo hóa đơn; tôi làm mặc định là người đang thêm dòng sản phẩm (nếu họ là nhân viên của chi nhánh, còn Chủ phải tự chọn). Hai cách khác nhau khi kỹ thuật viên thêm sản phẩm vào hóa đơn do người khác mở; Chủ muốn theo người tạo hóa đơn không? Chưa cấp quyền bán sản phẩm cho ai; cần chạy thêm tiến trình nền mới (trừ kho sau thanh toán) khi triển khai.

**P6-9 đã được Chủ duyệt ngày 2026-10-08 (nguyên văn ở mục 2.17 của tài liệu thiết kế).** Chủ xác nhận **"Widen the key"** (khóa dùng ưu đãi theo từng hóa đơn và từng chương trình), duyệt **OQ-67 đến OQ-71 "as proposed"**, và **đổi OQ-66: chương trình nhắm một danh mục sản phẩm thì tính luôn các danh mục con của nó** (ví dụ "Chăm sóc da" bao gồm "Serum"). Đã làm trong P6-10, có test. Cây danh mục chỉ có hai cấp (cha và con). Điểm tôi tự hiểu thêm, **chờ Chủ đồng ý: OQ-72**: cây danh mục tại lúc chốt hóa đơn là cây được áp dụng; sau này đổi danh mục cha của một sản phẩm không làm đổi hóa đơn đã chốt (số tiền đã lưu). Đoạn dưới đây là bản giải thích gốc của P6-9 (OQ-66 đã đổi như trên).

**P6-9 (bộ tính giá phiên bản 3) đã làm xong ở máy, chưa đẩy lên, chưa triển khai (báo cáo `docs/PHASE6_STEP9_PRICING_V3.md`, mục 2.16 của tài liệu thiết kế).** Đã làm đúng như Chủ đã duyệt: Spa và Beauty tính riêng, mỗi bên chọn một ưu đãi tốt nhất; ưu đãi theo hạng thành viên của đúng ví; voucher chia theo tỷ lệ giữa hai bên và chỉ tính đã dùng một lần; quà sinh nhật chỉ cho dịch vụ; hóa đơn chỉ có dịch vụ vẫn tính bằng bộ cũ, bộ mới chạy song song để so và báo lệch (không bao giờ đổi số tiền). Một câu trả lời đã nhận qua công cụ hỏi, ghi đúng như Chủ chọn và còn tạm thời cho đến khi Chủ xác nhận: **"Widen the key (Recommended)"** (nới khóa "mỗi hóa đơn một lần dùng ưu đãi" thành "mỗi hóa đơn, mỗi chương trình một lần"; sửa đúng 5 dòng tra cứu trong test cũ, không đổi nội dung kiểm tra). **Sáu điểm tôi tự hiểu, cần Chủ đồng ý hoặc sửa (OQ-66 đến OQ-71, cùng thứ tự với mục 2.16):** **OQ-66** danh mục sản phẩm: chương trình nhắm danh mục nào thì chỉ tính đúng danh mục đó, không tính danh mục con; **OQ-67** hóa đơn có sản phẩm mới mang phiên bản 3, hóa đơn chỉ có dịch vụ giữ phiên bản 2; **OQ-68** "báo lệch" gồm dòng nhật ký lỗi, một dòng kiểm toán và một sự kiện trong cùng giao dịch, chưa có thông báo đến người nhận (Chủ muốn nhận ở đâu?); **OQ-69** tiền khách trả được chia cho hai bên bằng trigger của cơ sở dữ liệu, chỉ với hóa đơn phiên bản 3, hoàn tiền mặt đảo đúng phần đã chia; **OQ-70** giảm giá của một bên được chia cho các dòng của bên đó theo giá gốc, kể cả dòng không thuộc phạm vi chương trình; **OQ-71** sửa một chương trình không còn là "chỉ dịch vụ" qua API phải ghi rõ phạm vi (màn hình chưa biết phạm vi, P6-11).

**Cập nhật 2026-10-07: Chủ đã duyệt T9 đến T16, T24, T25 và đã trả lời OQ-19 đến OQ-28** (ghi lại ở mục 2.5 của `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md`). Tài liệu này giữ lại như bản giải thích gốc. T17 đến T23, T26, T27 đã được duyệt sau đó (đoạn trên).

**Mới 2026-10-07 (cuối tài liệu): thay đổi phạm vi bán Lucy Beauty** (đặt trước tại quầy, đặt hàng online): T28 đến T33 và OQ-29 đến OQ-41. **Chủ đã trả lời cùng ngày** (khung "Chủ đã trả lời" ở đầu phần đó). Còn chờ Chủ: **OQ-42** (khách vãng lai xem phiếu hẹn) và OQ-38 (để sang Đợt 4).

Tài liệu này giải thích, bằng lời thường, từng mục kỹ thuật và câu hỏi đã được hỏi. Bản đầy đủ bằng tiếng Anh nằm trong `docs/PHASE6_PRODUCTS_INVENTORY_DESIGN.md` (mục 2.2 và 2.4). Chỉ lời của Chủ mới duyệt.

Mỗi mục có bốn phần: **Ý nghĩa**, **Ví dụ ở spa**, **Tôi khuyên**, **Nếu Chủ chọn khác**.

Đã duyệt rồi (không cần trả lời lại): T1 đến T8 (T8 = trang sản phẩm công khai chỉ để xem, không giỏ hàng, giao hàng hay COD).

## Đợt 2: bán sản phẩm tại quầy (P6-8 đến P6-11). **Đợt này sửa POS, hóa đơn, thanh toán và điểm đang chạy thật**

Đợt 1 (đã chạy thật từ 2026-10-07) chỉ **thêm** thứ mới, không đụng tiền. **Đợt 2 thì sửa chính các bảng và luồng đang thu tiền thật**: hóa đơn, ưu đãi, điểm thưởng, thanh toán. Vì vậy tôi hỏi kỹ hơn và kiểm kỹ hơn. Đợt 2 gồm: P6-8 (cơ sở dữ liệu), P6-9 (bộ tính giá mới), P6-10 (dòng sản phẩm ở POS, người bán, kho), P6-11 (điểm Beauty, giảm giá thành viên Beauty, phạm vi voucher). **Chưa viết dòng mã nào của Đợt 2**; chỉ khi Chủ trả lời các mục dưới đây tôi mới bắt đầu.

Chủ đã duyệt (không hỏi lại): hai bên Spa/Beauty chọn ưu đãi riêng (Q1), thanh toán chia theo tỷ lệ (Q2), hóa đơn chỉ có sản phẩm được phép (Q6), voucher có phạm vi Dịch vụ/Sản phẩm/Cả hai và quà sinh nhật chỉ cho dịch vụ (Q7), giữ hàng khi chốt hóa đơn và không bán vượt kho (Q8, T7), người bán bắt buộc ở mỗi dòng (Q9), T1 đến T8, T9 đến T16, T24, T25, T28 đến T33, OQ-19 đến OQ-25, OQ-29 đến OQ-42 (trừ OQ-38).

### Bảng trả lời nhanh cho Đợt 2

Chủ chỉ cần ghi "đồng ý" hoặc "khác: …" cho từng dòng. Cột "Mức rủi ro" là rủi ro **nếu làm sai**, không phải mức khó.

| Mục   | Chủ đề                                                                          | Tôi khuyên                                  | Chặn bước | Mức rủi ro |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------------- | --------- | ---------- |
| T17   | Bộ tính giá mới: tính riêng từng bên (Spa, Beauty)                              | Đồng ý                                      | P6-9      | **Cao**    |
| T18   | Một cách chia tiền theo tỷ lệ, làm tròn cộng dồn                                | Đồng ý                                      | P6-9      | Trung bình |
| T19   | Thêm bảng và sửa luật kiểm tra của hóa đơn, ưu đãi, điểm, thanh toán            | Đồng ý                                      | P6-8      | **Cao**    |
| T20   | Các loại hóa đơn: dịch vụ + sản phẩm chung một hóa đơn; hóa đơn chỉ sản phẩm    | Đồng ý                                      | P6-8      | **Cao**    |
| T26   | Khách xem hóa đơn: thấy tên, loại, số lượng, giá; không thấy người bán, giá vốn | Đồng ý                                      | P6-10     | Thấp       |
| T27   | Hủy hóa đơn sản phẩm đã đảo hết thanh toán thì trả hàng về kho                  | Đồng ý                                      | P6-10     | Trung bình |
| OQ-58 | Có chạy nhiều tiến trình cho API ngay trong Đợt 2 không                         | **Không**, để sau Đợt 2 chạy ổn rồi mới làm | P6-11     | **Cao**    |
| OQ-59 | Hóa đơn chỉ có dịch vụ: giữ bộ tính cũ làm chuẩn, bộ mới chạy song song để so   | Đồng ý (dây an toàn)                        | P6-9      | **Cao**    |
| OQ-60 | Khi nào bắt đầu bán sản phẩm thật: bán thử có giám sát trước, rồi mới cấp quyền | Đồng ý (xem điều kiện trả hàng)             | sau P6-11 | **Cao**    |
| T21   | Quy tắc trừ điểm khi hoàn tiền (chặn **Đợt 3**, không chặn Đợt 2)               | Đồng ý                                      | P6-13     | Trung bình |
| T22   | Phiếu hoàn tiền không sửa được (chặn **Đợt 3**)                                 | Đồng ý                                      | P6-13     | Trung bình |
| T23   | Hạn 48 giờ cho "giao nhầm hàng, hỏng do đóng gói" (chặn **Đợt 3**)              | Đồng ý, tính từ ngày giao khách             | P6-12     | Thấp       |

T21, T22, T23 không chặn Đợt 2 nhưng cùng một nhóm quyết định về hoàn tiền; Chủ trả lời luôn một lần thì Đợt 3 khỏi hỏi lại. Nếu muốn để sau, cứ để trống.

### Vì sao Đợt 2 nguy hiểm hơn, và tôi kiểm thế nào

| Rủi ro                                                                                | Hậu quả thật ở spa                                                                          | Cách tôi kiểm trước khi đưa cho Chủ                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hóa đơn chỉ dịch vụ bị tính lệch, dù 1 đồng                                           | Khách trả sai tiền, điểm sai, doanh thu sai                                                 | **Kiểm vi sai**: chạy mọi tình huống của Phase 4 và 5 (voucher, giảm giá thành viên, quà sinh nhật, combo, thưởng) qua bộ cũ và bộ mới, so từng đồng; kiểm theo tính chất (tổng chia luôn đúng); chạy song song (OQ-59) |
| Hai thu ngân cùng bán món cuối, hoặc chốt hóa đơn cùng lúc hủy                        | Bán vượt kho, hàng không có để giao                                                         | **Kiểm tranh chấp thật** trên PostgreSQL (hai giao dịch chạy cùng lúc), như 20 file race đã có; các số kho luôn đúng (`tồn = tổng phát sinh`, `giữ ≤ tồn`)                                                              |
| Thanh toán chia cho hai bên sai; thanh toán PayOS, đảo thanh toán, thanh toán hai lần | Tiền khớp sai, báo cáo sai, khách bị trừ hai lần                                            | Kiểm tranh chấp cho thanh toán và PayOS (bản giả lập), kiểm đối soát: `tổng phần chia của hai bên = số tiền thanh toán`, `tổng dòng = tổng hóa đơn`                                                                     |
| Điểm cộng hai lần, thiếu, hoặc thu hồi sai                                            | Khách lên hạng sai, giảm giá sai                                                            | Mỗi lần ghi điểm có khóa chống trùng; chạy lại sự kiện không tạo thêm; số dư ví luôn bằng tổng sổ cái                                                                                                                   |
| Migration hỏng trên dữ liệu thật                                                      | Hóa đơn không mở được, POS ngừng                                                            | **Diễn tập trên bản khôi phục `pg_dump` của dữ liệu thật** (như Đợt 1), đo thời gian từng migration; chạy **toàn bộ kiểm thử của bản cũ trên cơ sở dữ liệu mới** (như đã làm: phát hiện việc phải xóa 11 quyền)         |
| Quay lại bản cũ sau khi đã có bán thật                                                | Đợt 1 quay lại dễ vì chưa có dữ liệu mới; **Đợt 2 thì dữ liệu bán thật nằm trong bảng mới** | Chưa cấp quyền bán cho ai khi deploy; Chủ bán thử có giám sát (OQ-60); quay lại sau khi đã có bán thật chỉ còn cách khôi phục cơ sở dữ liệu và **mất giao dịch sau lúc sao lưu**: tôi ghi rõ trong hướng dẫn            |
| Thu ngân thao tác nhầm trên màn POS mới                                               | Chọn nhầm người bán, nhầm số lượng                                                          | Kiểm giao diện ở 360, 768, 1440 px sáng và tối, đủ trạng thái (lỗi, hết hàng, nhiều dòng); phân quyền: không có quyền thì không thấy nút                                                                                |

Điểm cuối cùng phải nói thẳng: **từ Đợt 2 đến Đợt 3 hệ thống chưa có chức năng trả hàng và hoàn tiền sản phẩm** (đó là P6-12 đến P6-14). Hóa đơn bán nhầm trong ngày vẫn sửa được bằng cách đảo thanh toán và hủy hóa đơn như Phase 4; khách mang hàng về rồi trả lại thì **chưa có công cụ**. Đó là lý do của OQ-60.

Việc **của Chủ** (không phải quyết định) trước khi bán thật: nhập sản phẩm, giá, tồn đầu kỳ thật bằng màn Nhập dữ liệu (Đợt 1 đã có), rồi gán 11 quyền mới cho đúng vai trò, trước hết `SELL_PRODUCTS`.

### T17. Bộ tính giá mới, tính riêng từng bên

- **Ý nghĩa:** một hóa đơn có thể có phần Spa (dịch vụ, combo) và phần Beauty (sản phẩm). Chủ đã duyệt (Q1) rằng **mỗi bên tự chọn đúng một ưu đãi tốt nhất** (không cộng dồn), có điểm và hạng riêng. T17 là cách tính cụ thể. Hóa đơn **chỉ có dịch vụ** phải ra **đúng từng đồng** như hôm nay.
- **Ví dụ ở spa:** khách hạng Vàng ở Spa (giảm 4%) và hạng Bạc ở Beauty (giảm 3%) làm massage 300.000đ và mua một lọ kem 200.000đ. Phần Spa giảm 4% = 12.000đ, còn 288.000đ, được 288 điểm Spa. Phần Beauty giảm 3% = 6.000đ, còn 194.000đ, được 194 điểm Beauty. Tổng phải trả 482.000đ.
- **Tôi khuyên:** đồng ý.
- **Nếu Chủ chọn khác:** muốn một ưu đãi cho cả hóa đơn thì trái với Q1 đã duyệt; nếu muốn tính khác ở một chi tiết (ví dụ khi hai ưu đãi bằng nhau) thì Chủ nói rõ, tôi sửa quy tắc trước khi viết mã.

### T18. Một cách chia tiền theo tỷ lệ, làm tròn cộng dồn

- **Ý nghĩa:** khi chia một voucher dùng chung, hoặc một lần thanh toán, cho hai bên, sẽ dư vài đồng lẻ. Chỉ dùng **một cách làm tròn duy nhất** (cộng dồn, làm tròn lên từ nửa đồng) để tổng các phần **luôn đúng bằng số gốc** và kết quả luôn giống nhau với cùng dữ liệu.
- **Ví dụ ở spa:** voucher 10.000đ dùng chung, phần dịch vụ 100.000đ và phần sản phẩm 200.000đ. Chia ra 3.333đ và 6.667đ (cộng đủ 10.000đ). Nếu mỗi phần làm tròn xuống riêng thì ra 3.333đ + 6.666đ = 9.999đ, mất 1đ.
- **Tôi khuyên:** đồng ý.
- **Nếu Chủ chọn khác:** cách khác (ví dụ dồn đồng lẻ vào bên Spa) cũng chạy được nhưng kết quả lệch 1đ ở vài hóa đơn; Chủ chọn cách nào tôi làm cách đó, chỉ cần một cách cho cả hệ thống.

### T19. Thêm bảng và sửa luật kiểm tra của dữ liệu đang chạy thật

- **Ý nghĩa:** hiện mỗi hóa đơn có một dòng "ưu đãi đã áp" và một dòng ảnh chụp điểm. Từ Đợt 2 cần **một dòng cho mỗi bên**, thêm bảng ghi số tiền giảm của từng dòng hàng và bảng ghi mỗi lần thanh toán thuộc bên nào, và **luật kiểm tra của cơ sở dữ liệu** (đang chặn tổng giảm giá sai) phải sửa theo. Dữ liệu cũ **không bị đổi**; hóa đơn cũ vẫn mở và tính như cũ.
- **Ví dụ ở spa:** hóa đơn 482.000đ ở T17 sẽ có hai dòng ưu đãi (Spa 12.000đ, Beauty 6.000đ), hai dòng ảnh chụp điểm (ví Spa, ví Beauty), và ghi rõ khoản thanh toán 482.000đ gồm bao nhiêu thuộc bên nào. Sau này hoàn tiền một sản phẩm mới biết đúng số tiền của sản phẩm đó.
- **Tôi khuyên:** đồng ý. Đây là **bước rủi ro cao nhất** vì sửa luật kiểm tra của hóa đơn đang thu tiền. Tôi chỉ **thêm** cột và bảng, không xóa gì, và diễn tập trên bản sao dữ liệu thật trước (hiện thật mới có 2 hóa đơn, 2 thanh toán nên migration rất nhanh; rủi ro nằm ở logic, không ở khối lượng).
- **Nếu Chủ chọn khác:** không thêm bảng mà nhét dữ liệu hai bên vào một cột JSON trên hóa đơn thì ít bảng hơn nhưng không kiểm tra được bằng cơ sở dữ liệu và rất khó tính hoàn tiền sau này. Tôi không khuyên.

### T20. Các loại hóa đơn

- **Ý nghĩa:** (1) hóa đơn của một lượt đến có thể có **cả dịch vụ và sản phẩm**; (2) có loại hóa đơn **chỉ sản phẩm** (không cần lượt đến; Chủ đã duyệt ở Q6); (3) hóa đơn bán combo vẫn **chỉ có một dòng combo**: mua combo và mua sản phẩm là hai hóa đơn. Các luật kiểm tra hiện tại của Phase 4 sẽ đổi để cho phép (1) và (2).
- **Ví dụ ở spa:** khách làm facial rồi mua serum: một hóa đơn có dòng facial và dòng serum, trả một lần. Khách chỉ ghé mua kem: hóa đơn chỉ có sản phẩm. Khách mua combo 10 buổi và một lọ kem: hai hóa đơn.
- **Tôi khuyên:** đồng ý.
- **Nếu Chủ chọn khác:** cho phép combo và sản phẩm cùng một hóa đơn thì đụng thêm phần buổi combo đang chạy (Phase 5), rủi ro tăng; cấm trộn dịch vụ và sản phẩm thì khách phải trả hai lần và hai bên Spa/Beauty không bao giờ gặp nhau trên một hóa đơn (mất ý nghĩa của Q1).

### T26. Khách xem hóa đơn sản phẩm

- **Ý nghĩa:** trong `/account/invoices` khách thấy tên sản phẩm, loại, số lượng, đơn giá, thành tiền. **Không bao giờ** thấy người bán, giá vốn, lô hàng, mã nội bộ.
- **Ví dụ ở spa:** khách mở hóa đơn thấy "Kem dưỡng ẩm, 50 ml, 2 x 289.000đ"; không thấy tên bạn nhân viên đã bán (tên người bán chỉ để Phase 7 tính hoa hồng).
- **Tôi khuyên:** đồng ý.
- **Nếu Chủ chọn khác:** muốn hiện tên người bán cho khách thì tôi thêm, nhưng khách sẽ thấy tên nhân viên (cân nhắc riêng tư).

### T27. Hủy hóa đơn sản phẩm đã đảo hết thanh toán thì hoàn hàng về kho

- **Ý nghĩa:** Phase 4 (OP-7) cho phép hủy một hóa đơn đã đảo hết thanh toán (số dư 0). Với hóa đơn sản phẩm, như vậy là việc bán **chưa từng xảy ra**, nên hàng phải **tự về lại kho**.
- **Ví dụ ở spa:** thu ngân bán nhầm một lọ serum, khách chưa đi khỏi quầy; quản lý đảo thanh toán và hủy hóa đơn. Lọ serum tự cộng lại vào tồn kho của chi nhánh.
- **Tôi khuyên:** đồng ý.
- **Nếu Chủ chọn khác:** không tự hoàn kho thì nhân viên phải tự "điều chỉnh kho" bằng tay; quên thì tồn kho lệch so với hàng thật.

### OQ-58. Có chạy nhiều tiến trình cho API ngay trong Đợt 2 không? (mới)

- **Ý nghĩa:** ở Đợt 1 Chủ chọn "Không" cho API và để sang sau. API vừa phục vụ thu tiền, webhook PayOS vừa đăng nhập lại. Chạy nhiều tiến trình giúp chịu tải nhưng đổi cách chạy đúng lúc đổi luật tính tiền.
- **Ví dụ ở spa:** nếu có lỗi sau deploy, ta sẽ không biết do luật tính mới hay do cách chạy mới.
- **Tôi khuyên:** **không** làm trong Đợt 2. Đợt 2 vẫn **một** tiến trình API. Khi bán sản phẩm đã chạy ổn, đo tải thật, rồi mới làm riêng (một bước nhỏ, có kiểm thử riêng).
- **Nếu Chủ chọn khác:** làm ngay trong Đợt 2 thì nhanh hơn một bước, nhưng hai thay đổi lớn lên đường thu tiền cùng lúc: khó biết nguyên nhân khi có lỗi.

### OQ-59. Hóa đơn chỉ có dịch vụ: bộ tính cũ vẫn là chuẩn, bộ mới chạy song song để so (mới)

- **Ý nghĩa:** dù đã kiểm vi sai kỹ, tôi muốn thêm một **dây an toàn**: với hóa đơn **không có sản phẩm**, kết quả thật vẫn là của **bộ tính cũ đang chạy**; bộ mới tính song song và ghi lại nếu khác dù 1 đồng. Sau vài tuần không có chênh lệch mới chuyển sang bộ mới.
- **Ví dụ ở spa:** thu ngân chốt hóa đơn massage + voucher như mọi ngày: khách trả đúng số cũ; trong nền, bộ mới tính lại và so. Nếu có lệch, tôi nhận được cảnh báo mà khách không bị ảnh hưởng.
- **Tôi khuyên:** đồng ý. Phải giữ hai bộ tính một thời gian (thêm việc), đổi lại gần như không có rủi ro làm sai hóa đơn dịch vụ đang chạy.
- **Nếu Chủ chọn khác:** dùng ngay bộ mới cho mọi hóa đơn (chỉ dựa vào kiểm thử vi sai). Nhanh gọn hơn, nhưng nếu còn lỗi hiếm mà kiểm thử không bắt được thì nó sai trên hóa đơn thật.

### OQ-60. Khi nào bắt đầu bán sản phẩm thật? (mới)

- **Ý nghĩa:** sau khi deploy Đợt 2, tôi đề nghị **chưa cấp quyền `SELL_PRODUCTS` cho nhân viên**. Chủ tự làm **một hóa đơn thử có giám sát** (một sản phẩm, trả tiền mặt, rồi hủy), kiểm kho, điểm, doanh thu. **Hóa đơn thử này ở lại vĩnh viễn trong sổ sách** (hệ thống không xóa lịch sử tiền). Đạt thì mới cấp quyền.
- **Trả hàng:** như đã nói, **chưa có trả hàng và hoàn tiền sản phẩm cho đến Đợt 3**. Hai cách: (A) cho bán thật ngay sau lần thử và nếu khách trả hàng sau ngày bán thì Chủ xử lý ngoài hệ thống rồi báo tôi để ghi nhận sau ở Đợt 3; (B) chỉ cho bán thật khi Đợt 3 (hoàn tiền) đã chạy.
- **Tôi khuyên:** làm lần thử có giám sát; về trả hàng chọn **(B)** nếu Chủ muốn sổ sách luôn sạch, hoặc **(A)** nếu cần bán sớm và chấp nhận xử lý tay trong thời gian ngắn. Quyết định này là của Chủ.
- **Nếu Chủ chọn khác:** cấp quyền ngay khi deploy, không thử trước: nếu có lỗi chỉ lộ ra trên khách thật, và quay lại bản cũ sau khi đã có bán thật là việc nặng (khôi phục cơ sở dữ liệu, mất giao dịch sau lúc sao lưu).

### T21. Quy tắc trừ điểm khi hoàn tiền (Đợt 3)

- **Ý nghĩa:** khi hoàn tiền một phần, điểm còn lại của khách = phần tiền còn lại sau hoàn, chia 1.000 làm tròn xuống; phần dư so với điểm đã cộng thì bị trừ. Hoàn tiền **không bao giờ bị chặn** vì khách đã dùng hết điểm; nếu điểm không đủ để trừ thì trừ đến 0 và ghi lại phần thiếu để Chủ xem. (Chủ đã chọn cách A ở OQ-19.)
- **Ví dụ ở spa:** khách mua 2 lọ x 150.000đ = 300.000đ, được 300 điểm. Trả lại 1 lọ: còn 150.000đ nên giữ 150 điểm, trừ 150 điểm. Trả cả hai: ví trở về đúng như trước khi mua.
- **Tôi khuyên:** đồng ý. **Nếu khác:** ví dụ muốn chặn hoàn tiền khi khách không còn đủ điểm thì khách mua hàng lỗi cũng không được hoàn: tôi không khuyên.

### T22. Phiếu hoàn tiền không sửa được (Đợt 3)

- **Ý nghĩa:** mỗi lần hoàn tiền là một bản ghi cố định (tiền mặt hoặc chuyển khoản thủ công, số tiền, lý do, người làm, giờ, mã giao dịch ngân hàng). Hóa đơn vẫn là "Đã thanh toán"; sau khi có hoàn tiền thì **không đảo thanh toán hay hủy hóa đơn** đó được nữa (tránh hoàn hai lần).
- **Ví dụ ở spa:** hoàn 289.000đ bằng chuyển khoản cho khách trả lọ kem, ghi mã giao dịch; hôm sau không ai đảo được khoản thanh toán gốc để "hoàn lần nữa".
- **Tôi khuyên:** đồng ý. **Nếu khác:** cho sửa phiếu hoàn tiền thì mất dấu vết kiểm toán, trái với quy tắc "lịch sử tiền không bao giờ bị viết lại".

### T23. Hạn 48 giờ cho "giao nhầm hàng, hỏng do đóng gói" (Đợt 3)

- **Ý nghĩa:** với hai lý do này, quá 48 giờ hệ thống **từ chối**, không có ngoại lệ (PRD §28.2). Tôi từng đề xuất tính từ lúc thanh toán; vì Chủ đã trả lời ở OQ-40 rằng hạn đổi trả tính **từ ngày giao khách**, tôi sửa lại cho khớp: **từ ngày khách nhận hàng** (quầy: lúc giao tại cửa hàng).
- **Ví dụ ở spa:** khách đặt trước một lọ serum, hàng về sau 4 ngày, nhận lúc 10:00 thứ Ba: 48 giờ chạy từ 10:00 thứ Ba, không phải từ ngày thanh toán.
- **Tôi khuyên:** đồng ý. **Nếu khác:** tính từ ngày thanh toán thì khách đặt trước có thể hết hạn khi chưa cầm hàng; muốn cho quản lý bỏ qua hạn thì cần thêm quyền và màn hình riêng (PRD nói "không chấp nhận").

---

## Đợt 3: trả hàng, hoàn tiền, đổi hàng, đặt trước tại quầy, quà tặng là sản phẩm (P6-12 đến P6-18). **Chỉ chuẩn bị tài liệu, chưa viết dòng mã nào**

Đợt 2 đã chạy thật từ 2026-10-08 (bản `1358725`, 80 migration, 65 quyền, chưa quyền bán sản phẩm nào được gán). **Đợt 3 là đợt đầu tiên có _tiền ra_**: hoàn tiền cho khách. Nó cũng là đợt đầu tiên **nhận tiền trước cho hàng mà tiệm chưa có** (đặt trước). Vì thế tôi hỏi kỹ hơn nữa, và tôi sẽ kiểm đúng cách đã làm ở Đợt 2 (kiểm tranh chấp thật trên PostgreSQL, đối soát sổ cái, diễn tập trên bản khôi phục, thử bản cũ trên cơ sở dữ liệu mới).

Đợt 3 gồm 7 bước (theo bảng 18.6 của tài liệu thiết kế; Chủ nhắc "P6-12 đến P6-18" là đúng phạm vi này):

| Bước  | Làm gì                                                                                                                                             | Chặn bởi            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| P6-12 | **Hồ sơ trả hàng**: lý do, ảnh bằng chứng riêng tư, kiểm niêm phong, ai chịu phí gửi, hàng có bán lại được không; hạn 48 giờ                       | T35, OQ-79          |
| P6-13 | **Hoàn tiền theo từng dòng** (tiền mặt hoặc chuyển khoản thủ công, nhập lại mật khẩu), trừ điểm Beauty tương ứng, hàng trả về kho nếu bán lại được | OQ-80, OQ-81, OQ-83 |
| P6-14 | **Đổi hàng** (hàng lỗi, đổi sang hàng khác); **mốc 3a: đã có hoàn tiền**                                                                           | OQ-82               |
| P6-15 | **Cơ sở dữ liệu đơn đặt trước**: đơn, dòng đơn, lịch sử trạng thái, hàng đợi, quyền mới                                                            | T36                 |
| P6-16 | **Đặt trước tại quầy** và phiếu hẹn nhận hàng (điện tử)                                                                                            | OQ-84               |
| P6-17 | Danh sách "cần đặt", phân hàng khi hàng về, báo khách, giao hàng, hủy dòng chưa giao kèm hoàn tiền; **mốc 3b: đặt trước tại quầy**                 | OQ-85, OQ-86, OQ-87 |
| P6-18 | **Quà tặng là sản phẩm**: trừ kho khi khách nhận quà                                                                                               | T37                 |

(Đặt hàng online, giao hàng, khuyến mãi đầy đủ là **Đợt 4**, chưa hỏi gì ở đây.)

**Chủ đã duyệt rồi, không hỏi lại:** hoàn theo số tiền khách **thực trả** của dòng sau giảm giá, ghi bằng một dòng điều chỉnh liên kết (Q3); hoàn chỉ bằng tiền mặt hoặc chuyển khoản thủ công, không bao giờ gọi PayOS, chỉ người có quyền riêng và phải nhập lại mật khẩu mỗi lần (Q4); trạng thái "đã hoàn" tính theo từng dòng, hóa đơn vẫn "Đã thanh toán" (Q5); T21 (cách trừ điểm, phương án A), T22 (phiếu hoàn tiền không sửa được, đã hoàn thì không đảo thanh toán hay hủy hóa đơn), T23 (48 giờ tính từ ngày giao khách); OQ-22 (ba lý do trả hàng và hạn 7 ngày, 48 giờ), OQ-23 (hoàn theo số lượng), OQ-24 (đổi hàng: chênh lệch trả như một lần thanh toán thường, hoặc hoàn như hoàn tiền; người giữ quyền hoàn tiền duyệt), OQ-25 (người bán chỉ sửa khi hóa đơn còn nháp); T28 đến T33 (đơn đặt trước tách khỏi hóa đơn, hai kiểu dòng "có sẵn / đặt trước", hàng đợi theo giờ thanh toán, kho trừ khi giao, các trạng thái, không bán vượt kho); OQ-29 đến OQ-37, OQ-39 đến OQ-42 (nhận tại cửa hàng, hàng giữ 7 ngày rồi nhắc gọi, hủy và hoàn tiền đầy đủ khi nhà cung cấp không giao hoặc trễ hơn 7 ngày, phiếu hẹn chỉ điện tử, khách vãng lai xem bằng đường dẫn bí mật và mã QR do nhân viên gửi qua Zalo, điểm Beauty tính lúc thanh toán, giao thất bại trừ phí hai chiều); Q10 (quà tặng là sản phẩm thì trừ kho khi khách nhận). Hoàn tiền và trả hàng chỉ áp dụng cho **sản phẩm**, không cho dịch vụ và combo (PRD §29).

### Bảng trả lời nhanh cho Đợt 3

Chủ chỉ cần ghi "đồng ý" hoặc "khác: …" cho từng dòng. Cột "Mức rủi ro" là rủi ro **nếu làm sai**, không phải mức khó.

| Mục   | Chủ đề                                                                                                   | Tôi khuyên                                                                                      | Chặn bước | Mức rủi ro |
| ----- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------- | ---------- |
| T34   | Thứ tự bước Đợt 3 và **hai lần triển khai** (3a: trả hàng, hoàn tiền, đổi hàng; 3b: đặt trước, quà tặng) | Đồng ý                                                                                          | cả Đợt 3  | Trung bình |
| T35   | Hồ sơ trả hàng và **ảnh bằng chứng riêng tư** (không bao giờ hiện công khai hay cho khách)               | Đồng ý                                                                                          | P6-12     | Trung bình |
| T36   | Thêm **một quyền mới** `MANAGE_PRODUCT_ORDERS` cho việc quản lý đơn đặt trước (65 thành 66 quyền)        | Đồng ý                                                                                          | P6-15     | Trung bình |
| T37   | Quà tặng là sản phẩm: cách trừ kho khi dùng quà và khôi phục khi bấm nhầm                                | Đồng ý                                                                                          | P6-18     | Thấp       |
| OQ-79 | Ảnh bằng chứng trả hàng giữ bao lâu, ai được xóa                                                         | Giữ cùng hồ sơ, không tự xóa; chỉ xóa khi khách yêu cầu và Chủ duyệt, có nhật ký                | P6-12     | Trung bình |
| OQ-80 | Hàng khách trả lại và "bán lại được": nhập vào lô nào, ai quyết                                          | Lô mới mang tên phiếu trả, giữ hạn dùng của lô đã bán; người giữ quyền hoàn tiền quyết          | P6-13     | **Cao**    |
| OQ-81 | Voucher hoặc quà sinh nhật đã dùng ở hóa đơn bị hoàn **toàn bộ**: có cấp lại không                       | Không tự cấp lại (đã tiêu); muốn thì cấp voucher mới bằng tay                                   | P6-13     | Trung bình |
| OQ-82 | Đổi sang hàng **khác giá**: tiền chênh lệch tính thế nào                                                 | Giá hàng mới tại ngày đổi trừ số tiền khách thực trả cho dòng cũ                                | P6-14     | **Cao**    |
| OQ-83 | Hoàn bằng chuyển khoản: có lưu số tài khoản của khách trong hệ thống không                               | Không lưu; chỉ lưu mã giao dịch ngân hàng của lần chuyển                                        | P6-13     | Thấp       |
| OQ-84 | Chỉ còn một phần hàng có sẵn: hệ thống có tự tách thành "lấy ngay" và "đặt trước" không                  | Không; thu ngân tự tách thành hai dòng                                                          | P6-16     | Thấp       |
| OQ-85 | Ai được nhận hàng đặt trước, nhân viên kiểm thế nào                                                      | Khách hoặc người đọc đúng mã đơn và 4 số cuối điện thoại; ghi "người nhận"                      | P6-17     | Trung bình |
| OQ-86 | Cảnh báo đơn đặt trước **trễ hẹn**                                                                       | Có, thông báo trong ứng dụng lúc 08:00 cho người giữ quyền quản lý đơn                          | P6-17     | Thấp       |
| OQ-87 | "Cần đặt" nhóm theo nhà cung cấp: thêm trường "nhà cung cấp thường đặt" cho từng loại sản phẩm           | Có, tùy chọn                                                                                    | P6-17     | Thấp       |
| OQ-88 | **Khi nào** đưa Đợt 3 lên máy chủ thật, khi chưa có sản phẩm thật (sản phẩm thật có sau Phase 9)         | Như Đợt 2: đưa lên khi xong và qua mốc, **không gán quyền cho ai** cho đến khi có sản phẩm thật | cả Đợt 3  | Trung bình |

Nếu Chủ muốn trả lời gọn: "Đợt 3: đồng ý như tôi khuyên" cho cả bảng, hoặc ghi mục nào khác.

### Vì sao Đợt 3 nguy hiểm theo cách khác Đợt 2, và tôi kiểm thế nào

| Rủi ro                                                                                 | Hậu quả thật ở spa                              | Cách tôi kiểm trước khi đưa cho Chủ                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hoàn tiền **nhiều hơn khách đã trả**, hoặc hoàn hai lần một dòng                       | Tiệm mất tiền thật, sổ sách sai                 | Mỗi lần hoàn bị chặn ở mức tiền thực trả còn lại của dòng và số lượng đã bán; kiểm tranh chấp thật (hai người hoàn cùng dòng cùng lúc, hoàn cùng lúc đảo thanh toán); đối soát: `tổng hoàn ≤ tổng thu`, mỗi dòng không quá số tiền thực trả |
| Hoàn tiền sửa các luật kiểm tra của thanh toán và hủy hóa đơn **đang chạy thật** (T22) | Có thể làm hỏng luồng thu tiền đang dùng        | Chạy lại toàn bộ kiểm thử Phase 4 và 5 và các kiểm thử của Đợt 2; bài kiểm "hóa đơn chưa hoàn thì hoạt động y như cũ"                                                                                                                       |
| Trừ điểm Beauty sai khi hoàn một phần                                                  | Khách xuống hạng sai, mất ưu đãi                | Công thức đã duyệt (T21); kiểm bằng ví dụ có số, kiểm khóa chống trùng và thu hồi đúng một lần; sổ cái luôn bằng số dư                                                                                                                      |
| Hàng trả về kho **tạo ra tồn kho không có thật**                                       | Tồn kho ảo, bán vượt kho sau này                | Hàng nhập lại chỉ được bằng số đã bán của đúng dòng đó; không bao giờ tạo hàng từ không; đối soát `tồn = tổng phát sinh = tổng lô`                                                                                                          |
| Nhận tiền trước cho hàng chưa có (đặt trước): khách trả mà không nhận được hàng        | Tiền của khách bị giữ, phải hoàn, khách mất tin | **Hoàn tiền phải chạy ổn trước** (vì thế 3a trước 3b); đơn trễ hẹn có cảnh báo; hủy dòng chưa giao luôn kèm hoàn tiền                                                                                                                       |
| Hàng vừa về bị bán cho người khác trước khi tới lượt người đã đặt                      | Khách đặt trước bị giành hàng                   | Phân hàng nằm **trong cùng giao dịch** xác nhận phiếu nhập; kiểm tranh chấp thật (bán món cuối đúng lúc hàng về; hai phiếu nhập cùng phân một hàng đợi)                                                                                     |
| Lộ dữ liệu cá nhân: ảnh da, số điện thoại, đường dẫn phiếu hẹn                         | Khách bị lộ thông tin nhạy cảm                  | Ảnh bằng chứng lưu riêng, không có đường dẫn công khai; đường dẫn phiếu hẹn chỉ lưu dạng băm, thu hồi và tạo lại được; kiểm quyền bằng test cho từng màn                                                                                    |
| Quay lại bản cũ sau khi đã có hoàn tiền hoặc đơn đặt trước                             | Giống Đợt 2: bản cũ không đọc được dữ liệu mới  | Làm lại đúng bằng chứng quay lui của Đợt 2 (bản cũ trên cơ sở dữ liệu mới, có dữ liệu mới), kèm **cổng kiểm các số** trước khi cho phép quay lại; sau hoàn tiền hoặc đơn đầu tiên, quay lại phần mềm không còn là lựa chọn                  |
| Thao tác nhầm trên màn mới (hoàn nhầm dòng, bấm nhầm trạng thái)                       | Hoàn nhầm tiền, giao nhầm hàng                  | Mỗi hoàn tiền có hộp xác nhận nêu rõ số tiền và dòng, nhập lại mật khẩu, lý do bắt buộc; kiểm giao diện ở 360, 768, 1440 px sáng và tối, chữ 130%, đủ trạng thái                                                                            |

**Cách tôi kiểm trước khi đưa cho Chủ (giống Đợt 2):** kiểm thử đơn vị và tích hợp trên PostgreSQL thật; kiểm tranh chấp (hai giao dịch cùng lúc) cho mọi lệnh đụng tiền hoặc kho; đối soát sau mỗi bài (tiền, kho, sổ điểm); chạy lại **toàn bộ kiểm thử của các Phase trước**; kiểm giao diện đủ kích thước và trạng thái; diễn tập trên bản khôi phục của sao lưu thật, đo từng migration; chạy bản cũ trên cơ sở dữ liệu mới có dữ liệu mới để biết chính xác cái gì hỏng; hướng dẫn triển khai từng khối lệnh cho terminal web iNET, có cổng kiểm quay lui. Tôi **không chạm vào máy chủ**.

Điểm phải nói thẳng: **trước khi có sản phẩm thật (sau Phase 9), mọi thứ của Đợt 3 chỉ chạy trên dữ liệu thử.** Đó là lý do của OQ-88: triển khai sớm cho yên tâm về mã, nhưng chưa gán quyền cho ai.

### T34. Thứ tự bước Đợt 3 và hai lần triển khai

- **Ý nghĩa:** Đợt 3 chia hai lần triển khai. **Mốc 3a** (P6-12 đến P6-14): trả hàng, hoàn tiền, đổi hàng. **Mốc 3b** (P6-15 đến P6-18): đơn đặt trước, đặt trước tại quầy, quà tặng. Sau mỗi mốc tôi làm một lần kiểm tra mốc đầy đủ như Đợt 2, rồi Chủ tự triển khai khi Chủ quyết.
- **Ví dụ ở spa:** nếu 3a gặp lỗi, ta chỉ phải sửa phần hoàn tiền; đặt trước (3b) chưa có nên không có khách nào đang chờ hàng bị ảnh hưởng.
- **Tôi khuyên:** đồng ý. Lý do chính: đặt trước nhận tiền cho hàng chưa có, nên đường hoàn tiền phải có trước.
- **Nếu Chủ chọn khác:** gộp một lần triển khai thì nhanh hơn nhưng rủi ro tập trung một chỗ, và quay lại bản cũ khó hơn.

### T35. Hồ sơ trả hàng và ảnh bằng chứng riêng tư

- **Ý nghĩa:** mỗi lần khách trả hàng là một **hồ sơ**: hóa đơn và dòng hàng, một trong ba lý do (sở thích cá nhân, giao nhầm hoặc hỏng do đóng gói, kích ứng da), cách xử lý (**đổi** hoặc **hoàn tiền**, ghi rõ), hàng còn nguyên niêm phong không, ai chịu phí gửi, ảnh bằng chứng, ghi chú (chỉ ghi nhận, **không chẩn đoán**), hàng có bán lại được không và ai quyết. Ảnh lưu **riêng**: không có đường dẫn công khai, chỉ người có quyền `MANAGE_PRODUCT_RETURNS` hoặc `REFUND_PRODUCTS` ở chi nhánh xem được; khách không thấy. Hồ sơ mới báo cho người giữ quyền hoàn tiền.
- **Ví dụ ở spa:** khách báo lọ serum bị nứt nắp sau hai ngày: thu ngân mở hồ sơ, chụp ảnh, hệ thống chặn vì quá 48 giờ tính từ ngày khách nhận; còn nếu khách kích ứng da thì hồ sơ ghi ảnh và lời khách, Chủ hoặc quản lý chọn đổi, hoàn hay từ chối.
- **Tôi khuyên:** đồng ý. **Nếu khác:** cho ảnh dùng chung kho ảnh website là không an toàn (ảnh da của khách có thể bị lộ).

### T36. Một quyền mới cho đơn đặt trước: `MANAGE_PRODUCT_ORDERS`

- **Ý nghĩa:** quyền để xem danh sách "cần đặt", đánh dấu đã đặt nhà cung cấp, hàng đã về, đã giao khách, tạo lại đường dẫn phiếu hẹn của khách vãng lai. Phạm vi theo chi nhánh. **Không** có quyền "đặt trước" riêng: tạo đơn đặt trước dùng quyền `SELL_PRODUCTS` đã có; hủy dòng và hoàn tiền dùng `REFUND_PRODUCTS` đã có (nhập lại mật khẩu). Quyền mới sẽ **không gán cho ai** khi triển khai; số quyền sẽ là 66.
- **Ví dụ ở spa:** thủ kho (không bán hàng) có quyền này để đánh dấu hàng đã về và giao khách, nhưng không hoàn được tiền.
- **Tôi khuyên:** đồng ý, một quyền là đủ. **Nếu khác:** tách thêm quyền (đặt hàng nhà cung cấp, giao hàng) cho nhiều tầng hơn, nhưng thêm việc gán quyền mà tiệm nhỏ chưa cần.

### T37. Quà tặng là sản phẩm: cách trừ kho

- **Ý nghĩa:** Chủ đã duyệt (Q10): quà là sản phẩm thì **trừ kho khi khách nhận quà**. Cách làm: một mục quà trong danh mục thưởng có thể gắn với một loại sản phẩm; nhân viên bấm "đã dùng" quà của khách ở chi nhánh nào thì kho chi nhánh đó giảm đúng 1 (lấy lô gần hết hạn trước). Hết hàng thì **báo "Hết hàng" và không ghi gì**. Nếu quản lý khôi phục một lần "đã dùng" bấm nhầm thì hàng trở về đúng lô cũ. Không có tiền, không có hóa đơn, không có điểm. Quà tạo trước Phase 6 (không gắn sản phẩm) không trừ kho.
- **Ví dụ ở spa:** khách đủ điểm đổi một lọ kem mini làm quà; thu ngân bấm "đã dùng", kho giảm 1; bấm nhầm thì quản lý khôi phục, kho tăng lại 1.
- **Tôi khuyên:** đồng ý. **Nếu khác:** trừ kho lúc khách đổi quà (thay vì lúc nhận) thì tồn kho giảm trước khi hàng rời tiệm.

### OQ-79. Ảnh bằng chứng trả hàng giữ bao lâu, ai được xóa

- **Ý nghĩa:** ảnh da và ảnh hàng hỏng là dữ liệu nhạy cảm của khách. Quy tắc chung của hệ thống: lịch sử không bị xóa hay viết lại.
- **Ví dụ ở spa:** một năm sau, khách yêu cầu xóa ảnh da của họ.
- **Tôi khuyên:** giữ cùng hồ sơ, hệ thống không tự xóa; chỉ xóa **ảnh** (không xóa hồ sơ) khi khách yêu cầu và Chủ duyệt, có nhật ký ai xóa lúc nào. Không đề xuất con số "giữ n tháng" vì PRD chưa quy định.
- **Nếu Chủ chọn khác:** muốn tự xóa sau một khoảng thời gian thì Chủ cho tôi con số; tôi sẽ không tự đặt.

### OQ-80. Hàng khách trả lại: nhập vào lô nào, ai quyết "bán lại được"

- **Ý nghĩa:** chỉ hàng "bán lại được" mới về kho bán; hàng không bán lại được thì ghi một phiếu riêng và **không** cộng vào tồn bán. Hàng trả về cần một lô để theo dõi hạn dùng.
- **Ví dụ ở spa:** khách trả một lọ kem còn nguyên niêm phong (bán lại được), còn lọ hỏng nắp (không bán lại được).
- **Tôi khuyên:** hàng bán lại được vào **một lô mới mang tên phiếu trả**, giữ **hạn dùng của lô đã bán** (hóa đơn biết lô nào); không trộn lại vào lô gốc. Người giữ quyền hoàn tiền xác nhận "bán lại được" (người mở hồ sơ chỉ đề xuất). Số lượng nhập lại không bao giờ nhiều hơn số đã bán của đúng dòng đó.
- **Nếu Chủ chọn khác:** nhập lại đúng lô gốc thì tiện hơn nhưng lẫn hàng đã rời tiệm với hàng chưa rời; lô không hạn dùng thì mất cảnh báo hết hạn.

### OQ-81. Voucher hoặc quà sinh nhật đã dùng ở hóa đơn bị hoàn toàn bộ

- **Ý nghĩa:** hoàn tiền theo số khách thực trả (đã trừ giảm giá), nhưng voucher dùng một lần đã bị "tiêu".
- **Ví dụ ở spa:** khách dùng voucher 100.000đ cho đơn 500.000đ rồi trả cả đơn; hoàn 400.000đ.
- **Tôi khuyên:** **không tự cấp lại** voucher (đã tiêu); nếu muốn bù cho khách thì tạo voucher mới bằng công cụ giảm giá đã có.
- **Nếu Chủ chọn khác:** tự cấp lại thì khách có thể lợi dụng "mua dùng voucher rồi trả để lấy lại voucher".

### OQ-82. Đổi sang hàng khác giá: tiền chênh lệch tính thế nào

- **Ý nghĩa:** PRD cấm đoán mò. Đổi **cùng loại** (hàng lỗi đổi cái mới) thì chênh lệch bằng 0. Đổi sang hàng giá khác cần một quy tắc.
- **Ví dụ ở spa:** khách đã trả thực 270.000đ cho lọ cũ (sau giảm giá), muốn đổi sang lọ giá niêm yết 350.000đ.
- **Tôi khuyên:** chênh lệch = **giá hàng mới tại ngày đổi** trừ **số tiền khách thực trả cho dòng cũ** (ở ví dụ: 80.000đ khách trả thêm); hàng mới rẻ hơn thì hoàn phần dư như hoàn tiền; điểm Beauty theo T21 và PRD §28.5.
- **Nếu Chủ chọn khác:** tính theo giá niêm yết cũ thì khách đổi sẽ được hưởng lại giảm giá đã dùng.

### OQ-83. Hoàn bằng chuyển khoản: có lưu số tài khoản của khách không

- **Ý nghĩa:** hoàn chuyển khoản cần số tài khoản của khách ở thời điểm chuyển, nhưng đó là dữ liệu nhạy cảm.
- **Ví dụ ở spa:** thu ngân chuyển 289.000đ cho khách rồi nhập mã giao dịch.
- **Tôi khuyên:** **không lưu số tài khoản** của khách; chỉ lưu mã giao dịch ngân hàng của lần chuyển (đã có trong T22) và người thực hiện.
- **Nếu Chủ chọn khác:** lưu thêm số tài khoản (che bớt số) nếu Chủ cần đối chiếu sau; tôi sẽ thêm trường và quyền xem riêng.

### OQ-84. Chỉ còn một phần hàng có sẵn

- **Ý nghĩa:** khách mua 3 lọ, kho có 1. Theo T29, hệ thống không tự đổi một dòng thiếu hàng thành đặt trước.
- **Ví dụ ở spa:** khách muốn 3 lọ serum: lấy ngay 1, đặt trước 2.
- **Tôi khuyên:** thu ngân **tự tách thành hai dòng** (1 lấy ngay, 2 đặt trước); hệ thống không tự tách. Mỗi dòng vẫn trọn vẹn: một dòng hoặc đủ hàng hoặc chờ.
- **Nếu Chủ chọn khác:** tự tách thì nhanh hơn nhưng dễ làm khách hiểu nhầm số hàng nhận ngay.

### OQ-85. Ai được nhận hàng đặt trước, kiểm thế nào

- **Ý nghĩa:** hàng đã trả tiền và đã về, nhân viên cần biết giao đúng người.
- **Ví dụ ở spa:** chị gái nhờ nhận hộ lọ kem.
- **Tôi khuyên:** nhận bởi chính khách, hoặc người đọc đúng **mã đơn** và **4 số cuối điện thoại** đã ghi; nhân viên chọn "người nhận: chính khách / người khác" và hệ thống ghi giờ, người giao. Không bắt giấy tờ tùy thân. Con số 4 là đề xuất của tôi.
- **Nếu Chủ chọn khác:** muốn chặt hơn (giấy tờ) hoặc lỏng hơn (chỉ mã đơn) đều làm được.

### OQ-86. Cảnh báo đơn đặt trước trễ hẹn

- **Ý nghĩa:** Chủ đã duyệt: quá 7 ngày so với ngày dự kiến thì khách được hủy và hoàn đầy đủ. Cần để nhân viên biết đơn nào đang trễ.
- **Ví dụ ở spa:** nhà cung cấp hẹn 5 ngày, đã 6 ngày chưa có hàng.
- **Tôi khuyên:** danh sách "trễ hẹn" trong màn quản lý đơn, và một thông báo trong ứng dụng lúc 08:00 (cách đã làm cho cảnh báo hết hạn) cho người giữ quyền quản lý đơn khi có đơn trễ hẹn hoặc sắp quá 7 ngày. Không gửi email hay Zalo.
- **Nếu Chủ chọn khác:** bỏ thông báo, chỉ giữ danh sách (phải nhớ vào xem).

### OQ-87. Nhóm "cần đặt" theo nhà cung cấp

- **Ý nghĩa:** danh sách "cần đặt" nhóm theo nhà cung cấp để gọi một lần cho nhiều món. Hiện sản phẩm chưa ghi nhà cung cấp thường đặt.
- **Ví dụ ở spa:** gom 4 lọ của hãng A thành một cuộc gọi.
- **Tôi khuyên:** thêm trường **tùy chọn** "nhà cung cấp thường đặt" cho loại sản phẩm (thay đổi nhỏ, chỉ thêm cột); chưa điền thì nằm nhóm "Chưa rõ nhà cung cấp".
- **Nếu Chủ chọn khác:** không thêm trường, nhóm theo nhãn hiệu.

### OQ-88. Khi nào đưa Đợt 3 lên máy chủ thật

- **Ý nghĩa:** website hiện chỉ dùng nội bộ, sản phẩm thật có sau Phase 9. Đợt 3 dùng quyền bán và hoàn tiền mà chưa ai có.
- **Ví dụ ở spa:** giống Đợt 2: mã đã chạy trên máy chủ, nút bán và hoàn tiền không hiện với ai.
- **Tôi khuyên:** như Đợt 2: đưa lên từng mốc (3a rồi 3b) khi xong và qua kiểm tra mốc, **không gán** `SELL_PRODUCTS`, `MANAGE_PRODUCT_RETURNS`, `REFUND_PRODUCTS`, `MANAGE_PRODUCT_ORDERS` cho ai cho đến khi có sản phẩm thật và Chủ bán thử có giám sát (OQ-60).
- **Nếu Chủ chọn khác:** chờ đến sau Phase 9 mới đưa lên thì mã nằm lâu chưa chạy thật, lỗi môi trường phát hiện muộn.

Việc **của Chủ** (không phải quyết định) trước khi bán thật: nhập sản phẩm, giá, tồn đầu kỳ thật (Phase 9), gán quyền cho đúng người, bán thử có giám sát một hóa đơn rồi trả lại thử một lần.

---

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
- **OQ-38:** để sang Đợt 4, chưa có số. **Đã được thay bằng quyết định của Chủ ngày 2026-10-09: miễn phí giao hàng cho mọi đơn online (xem mục "Đợt 4" ở đầu tài liệu).**
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

| Mục   | Chủ đề                                                                                                    | Tôi khuyên                                                              | Chặn bước nào |
| ----- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| OQ-29 | Hàng về rồi: nhận tại cửa hàng hay giao                                                                   | Quầy: nhận tại cửa hàng. Online: giao                                   | P6-16         |
| OQ-30 | Có giữ hàng sẵn hay đặt theo từng đơn                                                                     | Mỗi sản phẩm tự chọn; mặc định "đặt theo đơn"                           | P6-3b         |
| OQ-31 | Cách đặt nhà cung cấp, ngày dự kiến                                                                       | Danh sách "cần đặt"; ngày dự kiến là khoảng 3-5 ngày                    | P6-17         |
| OQ-32 | Khách hủy, nhà cung cấp không giao được, trễ hẹn                                                          | Hoàn đủ tiền; xem chi tiết                                              | P6-17         |
| OQ-33 | Điểm Beauty tính lúc nào                                                                                  | Lúc thanh toán, hoàn tiền thì trừ lại                                   | P6-16         |
| OQ-34 | Báo khách hàng đã về, số điện thoại, giữ bao lâu                                                          | Thông báo trong app + email; bắt buộc số điện thoại; giữ 7 ngày rồi gọi | P6-16         |
| OQ-35 | Mẫu phiếu hẹn nhận hàng                                                                                   | Trang in khổ A5 hoặc A4 + bản trong tài khoản                           | P6-16         |
| OQ-36 | Ai được mua online; giao từ chi nhánh nào                                                                 | Chỉ thành viên; một chi nhánh giao hàng cố định                         | P6-19         |
| OQ-37 | Online: hàng chưa có kho có cho đặt trước không                                                           | Cho (với sản phẩm đã bật), ghi rõ ngày                                  | P6-19         |
| OQ-38 | Phí giao hàng, hãng vận chuyển, ngưỡng miễn phí (**đã thay bằng quyết định Đợt 4, 2026-10-09: miễn phí**) | Chủ quyết (cần các số)                                                  | P6-19         |
| OQ-39 | Hết hạn đơn online chưa thanh toán                                                                        | 30 phút                                                                 | P6-19         |
| OQ-40 | Hạn đổi trả tính từ đâu; giao thất bại                                                                    | Từ ngày giao khách; Chủ quyết giao thất bại                             | P6-21         |
| OQ-41 | Giảm giá, voucher, điểm có áp dụng cho phí giao hàng không                                                | Không                                                                   | P6-19         |

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

### OQ-38 (**đã thay bằng quyết định của Chủ ngày 2026-10-09: miễn phí giao hàng cho mọi đơn online, cửa hàng tự trả hãng, nhân viên chỉ nhập mã vận đơn; xem mục "Đợt 4" ở đầu tài liệu; phần dưới giữ nguyên để tra cứu**). Phí giao hàng, hãng vận chuyển, ngưỡng miễn phí (cần các con số của Chủ)

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

## Câu hỏi của P6-5 (nhập Excel/CSV): **Chủ đã duyệt OQ-43 đến OQ-48 như đề xuất (2026-10-07)**

Chi tiết: `docs/PHASE6_STEP5_IMPORT.md`. **Lời Chủ (2026-10-07):** "P6-5 approved: OQ-43…48 as you proposed (explicit tick to skip invalid rows; 5 MB / 2,000 rows synchronous; blank cell keeps existing value; opening stock once per variant and branch; fflate and fast-xml-parser). Bulk images and bulk price update (PRD 31.3/31.4) stay in Phase 9." Ảnh hàng loạt và cập nhật giá hàng loạt (OQ-48) nằm ở Phase 9. Các mục dưới đây giữ nguyên như đã viết.

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

### OQ-48. Hai việc PRD 31 chưa làm: khi nào làm? (Chủ trả lời: Phase 9)

- **Ảnh hàng loạt theo tên tệp = SKU** (31.3) và **cập nhật giá hàng loạt: xuất ra, sửa, nhập lại, xem khác biệt, xác nhận** (31.4). Lời yêu cầu của Chủ ngày 2026-10-07 chỉ nêu sản phẩm, phân loại và tồn đầu kỳ nên tôi **chưa làm** hai việc này. Chủ cho biết làm ở bước nào.

## Câu hỏi của P6-6 (trang mỹ phẩm công khai): **Chủ đã duyệt OQ-49 đến OQ-53 như đề xuất (2026-10-07)**

**Lời Chủ (2026-10-07):** "P6-6 approved: OQ-49…53 as you proposed. Record in the design doc, owner-decisions doc and handoff." Các mục dưới đây giữ nguyên như đã viết.

**Quyết định deploy của Chủ (cuối cùng, 2026-10-07):** deploy Phase 6 **từng đợt**, sau kiểm tra mốc của mỗi đợt và **chỉ khi Chủ nói**. Trước mỗi đợt: chạy thử trên bản khôi phục của DB thật (pg_dump), đo thời gian từng migration, viết kế hoạch quay lại (khôi phục DB + commit trước), và đưa hướng dẫn dưới dạng lệnh cho terminal web của iNET, từng khối một.

Chi tiết: `docs/PHASE6_STEP6_PUBLIC_CATALOG.md`. OQ-27 và OQ-28 đã duyệt (mục 2.5 của thiết kế) và đã làm đúng như vậy. Năm điểm dưới đây là cách đọc của tôi, nơi thiết kế chưa nói rõ.

### OQ-49. Chỗ nhập ảnh, lời đầu trang và khung cam kết

- **Tôi đã làm:** nhập ở trang **Sản phẩm → nút "Trang mỹ phẩm"** (cần quyền quản lý sản phẩm), cùng chỗ với "Cài đặt". Thiết kế 16.5 ghi "tab Thông tin cửa hàng".
- **Lý do:** phần này thuộc về sản phẩm, có sẵn quyền, bản ghi và nhật ký; tab Thông tin cửa hàng là một biểu mẫu lớn lưu cả cửa hàng một lần.
- **Nếu khác:** chuyển sang tab Thông tin cửa hàng (đổi cột, không mất dữ liệu).

### OQ-50. Bốn cách sắp xếp

- Mẫu Lovable chỉ có "Nổi bật". Tôi thêm **Mới nhất, Giá thấp đến cao, Giá cao đến thấp** (khách quen dùng). "Nổi bật" = ô "nổi bật" của sản phẩm, rồi mới đăng trước.
- **Nếu khác:** bỏ ba cách thêm, ô sắp xếp chỉ còn "Nổi bật".

### OQ-51. Khi nào hiện "Hết hàng" và "Đặt trước, dự kiến n ngày"

- Còn hàng ở bất kỳ chi nhánh đang hoạt động: **không ghi gì**. Hết hàng và loại đó cho bán theo đơn: "Đặt trước, dự kiến 3–5 ngày" (số ngày riêng của loại, nếu không thì số ngày mặc định). Hết hàng và không bán theo đơn: "Hết hàng". Sản phẩm nhiều loại: còn hàng ở một loại là không ghi gì ở thẻ. Không bao giờ hiện số lượng.

### OQ-52. Lời của khối "Mua trực tiếp tại cửa hàng"

- "Đến Lucy Spa để xem và mua sản phẩm. Nên gọi trước để biết tình trạng hàng." kèm địa chỉ, điện thoại, giờ mở cửa từ Thông tin cửa hàng và hai nút "Chỉ đường", "Gọi cửa hàng". Lời là của tôi; Chủ sửa nếu muốn.

### OQ-53. Tên tiếng Anh của mục menu

- Tiếng Việt "Mỹ phẩm" (Chủ đã chọn). Tiếng Anh tôi dùng "Cosmetics".

## Câu hỏi của P6-7 (chịu tải): **Chủ đã duyệt OQ-54 đến OQ-57 như đề xuất (2026-10-07)**

**Lời Chủ (2026-10-07):** "Wave 1 approved: OQ-54…57 as you proposed. Record in the design doc, owner-decisions doc and handoff." Các mục dưới đây giữ nguyên như đã viết. Việc deploy vẫn chỉ diễn ra khi Chủ tự chạy hướng dẫn.

Chi tiết: `docs/PHASE6_STEP7_LOAD_READINESS.md`. OQ-26 (chỉ web chạy nhiều tiến trình ở Đợt 1) đã duyệt và được làm đúng như vậy. Bốn điểm dưới đây là cách làm cụ thể của tôi.

### OQ-54. Mức giới hạn số lần đọc trang công khai

- **Ý nghĩa:** chặn một địa chỉ (hoặc một chương trình quét) đọc dồn dập các đường công khai làm chậm cả hệ thống, kể cả thu tiền, vì API dùng chung.
- **Ví dụ:** mỗi địa chỉ được **300 lần mỗi phút** (ảnh **1.200**); mọi khách ngoài cộng lại **6.000** (ảnh **30.000**). Một người xem trang thấy khoảng 5 lần gọi; cả tiệm dùng chung một Wi-Fi vẫn thoải mái. Vượt thì nhận lỗi 429 và tự hết sau tối đa 1 phút.
- **Tôi khuyên:** như trên. Redis hỏng thì **cho qua** (không để trang lỗi theo).
- **Nếu khác:** Chủ cho con số khác, hoặc không giới hạn (rủi ro: một chương trình quét làm API chậm).

### OQ-55. Bộ nhớ đệm 5 giây cho danh sách, chi tiết và mã sản phẩm trong API

- **Ý nghĩa:** các yêu cầu giống nhau trong 5 giây dùng chung một lần đọc cơ sở dữ liệu. Đo thấy API danh sách sản phẩm từ **74 lên 1.200** yêu cầu mỗi giây.
- **Ví dụ:** Chủ đổi giá lúc 10:00:00; khách có thể còn thấy giá cũ đến khoảng 10:01:05 (5 giây của API cộng 60 giây sẵn có của web). Hiện nay là 60 giây.
- **Tôi khuyên:** làm. Không nhớ tìm kiếm tự do, không nhớ lỗi.
- **Nếu khác:** bỏ thì mỗi lần mở trang mới đều đọc cơ sở dữ liệu; tải nhẹ vẫn chạy được, nhưng chịu kém khi đông.

### OQ-56. Web chạy 3 tiến trình, trần 700 MB mỗi tiến trình

- **Ý nghĩa:** máy chủ 6 nhân, 7,8 GB, không swap. 3 tiến trình web nhanh gấp khoảng 2,5 lần trên máy thử, mỗi tiến trình dùng khoảng 400-470 MB khi tải nặng; vượt 700 MB thì pm2 khởi động lại riêng tiến trình đó. Còn lại nhân cho API, PostgreSQL, Redis, nginx. Worker và API giữ đúng một.
- **Tôi khuyên:** 3. Chỉnh bằng biến `WEB_INSTANCES` mà không sửa mã.
- **Nếu khác:** 2 (ít bộ nhớ hơn) hoặc 4 (cần thử lại trên máy chủ thật).

### OQ-57. Nginx phải gửi địa chỉ khách (`X-Forwarded-For`)

- **Ý nghĩa:** muốn giới hạn theo từng khách, API phải biết địa chỉ thật. Nếu nginx không gửi thì **giới hạn không có tác dụng** (không ai bị chặn nhầm, nhưng cũng không bảo vệ được). Tôi không xem được cấu hình nginx nên hướng dẫn deploy có một bước kiểm bằng lệnh (gọi 310 lần rồi đếm lỗi 429) và một bước xem cấu hình.
- **Tôi khuyên:** làm bước kiểm. Nếu thiếu, sửa nginx thêm `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (kỹ thuật viên của Chủ làm, tôi không đụng máy chủ).
- **Nếu khác:** không thêm, chấp nhận không có giới hạn theo khách ở Đợt 1.

## Đợt 4: các cách hiểu kỹ thuật (đã xây và triển khai 2026-10-09; chi tiết ở `PHASE6_PRODUCTS_INVENTORY_DESIGN.md` mục 2.38)

**Chủ đã duyệt (2026-10-09, sau khi triển khai, lời Chủ):** "W4-1 to W4-12: approved as you proposed." Bốn câu hỏi mở: (1) tiền về sau khi đơn đã hủy: **giữ nguyên, báo quản lý và hoàn tiền bằng tay**; (2) đổi hàng cho đơn online: **chưa cần**; (3) chiến dịch trên hero trang chủ và popup: **đưa vào đợt chỉnh giao diện sắp tới**; (4) báo cáo doanh thu theo chiến dịch: **Phase 8**. Cửa hàng online vẫn tắt đến khi Chủ mở sau Phase 9.

(Phần dưới giữ nguyên như đã trình bày trước khi duyệt.)

Tiền và chính sách chỉ là lời Chủ đã duyệt (miễn phí giao hàng, trả trước PayOS, chỉ hội viên, nhân viên nhập mã vận đơn và phí hãng, công thức giao thất bại, đổi trả). Mọi mục dưới đây là cách tôi làm kỹ thuật; **chưa được duyệt**, Chủ nói "đồng ý" hoặc ghi mục nào khác.

- **W4-1 Giữ và trừ kho.** Hàng có sẵn được giữ ngay khi khách đặt; chỉ trừ kho thật khi nhân viên bấm "Đã gửi". Đặt trước thì giữ khi hàng về, trừ khi gửi.
- **W4-2 Không có người bán trên dòng online.** Không ai bị ghi là người bán; hoa hồng bán online để Phase 7 quyết.
- **W4-3 Tự hủy quá 30 phút không có người thật.** Ghi là chính khách, nguyên nhân hệ thống, nhật ký kiểm toán loại SYSTEM; không tạo tài khoản hệ thống.
- **W4-4 PayOS.** Liên kết hết hạn đúng lúc hết hạn đơn; trước khi hủy, hệ thống hỏi lại PayOS; webhook và đối soát không bao giờ bị công tắc "Bán online" chặn.
- **W4-5 (câu hỏi) Tiền về muộn sau khi đơn đã hủy.** Hiện chỉ báo bất thường cho quản lý, tiền được giữ, hoàn bằng tay. Chủ có muốn tự động hoàn không?
- **W4-6/7/9** Tối đa 3 đơn chưa trả được khóa theo tài khoản; lệnh của khách không giả làm nhân viên; danh sách tỉnh lấy từ nguồn chính thức.
- **W4-8 Chiến dịch dùng quyền `MANAGE_PRODUCT_PRICES`**, không thêm quyền (vẫn 66 quyền).
- **W4-10 Hủy, giao thất bại, đổi trả.** Hủy dòng chưa gửi dùng đúng lệnh hủy ở quầy; quyết toán giao thất bại chỉ sau "hàng đã về", một lần nhập mật khẩu cho cả quyết toán, hoàn 0 thì không hỏi và không nhập kho bán được; đổi trả tính hạn từ ngày giao; phí gửi trả ghi riêng, không trừ vào tiền hoàn. **Câu hỏi:** đơn online có cần "đổi hàng" (chưa làm)?
- **W4-11 Chiến dịch khuyến mãi.** Giá thấp nhất thắng, không cộng dồn; giảm % làm tròn xuống đồng; đăng rồi thì đóng băng thời gian, quy tắc, sản phẩm; kết thúc sớm một lần có lý do. **Câu hỏi:** gắn chiến dịch với hero trang chủ và popup (chưa làm); báo cáo doanh thu theo chiến dịch (chưa có màn).
- **W4-12 Ngân sách yêu cầu theo tài khoản:** 120 yêu cầu thành công mỗi phút cho các đường online của một hội viên (một trang dùng khoảng 20). Đo tải: một tiến trình API làm khoảng 8 lượt đặt hàng mỗi giây, nên **không thêm tiến trình API**.
