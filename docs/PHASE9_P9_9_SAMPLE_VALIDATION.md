# Phase 9 P9-9: kiểm tra mẫu 20 sản phẩm của haruohui.com

Trạng thái: **làm xong (2026-10-11), chưa deploy.** Chỉ kiểm tra, **không nhập hàng loạt**, không đổi mã. Căn cứ: PRD 30.9 (thử mẫu trước), `docs/PHASE9_PRODUCT_IMPORT.md` mục 10, 13, 16. Kết quả thô: `.local/p9/validate-results.json` (không đưa vào kho mã).

## Cách làm

Một bản sao sạch của cơ sở dữ liệu thử (`lucy_spa_p9_9_scratch`, xóa hết dữ liệu nhập cũ, nguồn **Haruohui.com** vẫn bật, sẵn sàng, giấy phép đã xác nhận) chạy cùng API + worker như bản triển khai. **Worker là nơi duy nhất nói chuyện với website thật**: tổng cộng **43 yêu cầu** trong cả buổi (mỗi giây một yêu cầu, đúng giới hạn): lần quét thật đầu tiên 23, các lần quét lại 3 mỗi lần. Phần nào là **thật** và phần nào là **mô phỏng** được ghi rõ từng dòng; mô phỏng chỉ sửa bản sao đã lưu **trong cơ sở dữ liệu thử** để lần quét lại thấy khác biệt (website thật không thể bị làm đổi).

## Kết quả

| Việc kiểm tra          | Cách                                                                                         | Kết quả                                                                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quét mẫu lần đầu       | **thật**, 23 yêu cầu                                                                         | `SUCCEEDED`; đọc 20, tạo 20 ứng viên, 20 ảnh, 0 lỗi, 0 cờ ảnh                                                                                                                                                                                               |
| Trùng lặp              | **thật**                                                                                     | 0 cảnh báo nghi trùng, 0 SKU trùng, 0 cặp cùng tên, mỗi mã sản phẩm nguồn đúng một bản ghi                                                                                                                                                                  |
| Ảnh theo sản phẩm      | **thật**                                                                                     | **mỗi sản phẩm đúng 1 ảnh** (20/20), 0 sản phẩm không ảnh, tối đa 1 ảnh/sản phẩm; **0 ảnh nằm trên sản phẩm khác**; 0 tệp ảnh giống nhau giữa hai sản phẩm                                                                                                  |
| SKU                    | **thật**                                                                                     | 20/20 có SKU ở nguồn (không cần `HARU-<mã>`); **18 hợp dạng Lucy**, **2 là SKU dạng chữ thường có gạch nối** (`mat-na-duong-trang-ohui-…`, `nuoc-hoa-hong-duong-trang-da-ohui-…`) → cảnh báo `SKU_FORMAT`, **giữ nguyên, không sửa lặng lẽ** (đúng lời chủ) |
| Giá                    | **thật**                                                                                     | 20 quan sát giá tham khảo; **không sản phẩm Lucy nào được tạo** (0 sản phẩm có dấu vết nguồn), không ghi giá vốn                                                                                                                                            |
| Quét lại, không đổi gì | **thật**, 3 yêu cầu                                                                          | `SUCCEEDED`; 20 không đổi, 0 mới, 0 ghi chú thay đổi; **danh sách ứng viên và danh sách ảnh giống hệt** (so mã băm); không tải lại ảnh nào                                                                                                                  |
| Phát hiện thay đổi     | **mô phỏng** (sửa mã băm/tên/ảnh đã lưu của 4 sản phẩm), quét lại thật                       | đếm đúng: 1 giá đổi, 2 nội dung đổi, 1 ảnh đổi, 16 không đổi; ghi chú có trước/sau; **tên ứng viên của Lucy không bị ghi đè**; ảnh vẫn nguyên; thông báo tóm tắt gửi cho người duyệt (không gửi cho người bấm quét)                                         |
| Luật bảo vệ 3 lần      | **mô phỏng** (đổi mã của một sản phẩm đã lưu thành mã website không có), 4 lần quét lại thật | lần 1-2: đếm vắng 1 rồi 2, **chưa có ghi chú**; **lần 3: đúng một ghi chú "không còn trên nguồn"**; lần 4: vẫn một ghi chú (không lặp). **Ứng viên và ảnh của sản phẩm đó không đổi** (không xóa, không ẩn)                                                 |
| Lần quét đáng ngờ      | **mô phỏng ngưỡng** (đặt mốc lần quét trước là 100 sản phẩm), quét lại thật đọc 19           | `SUSPECT` (dưới 70%); **không ghi gì**: bản ghi, số đếm vắng, ảnh nguyên vẹn (so mã băm); nguồn vẫn bật và sẵn sàng; thêm 2 yêu cầu, không tải ảnh                                                                                                          |

## Điều đáng chú ý

1. Hai SKU dạng chữ thường (2 trên 20) là việc của người duyệt (chủ đã quyết: giữ nguyên, không sửa). Trên cả 352 sản phẩm có thể có nhiều hơn; chúng sẽ **không** được tự nhập và hiện trong danh sách "chưa nhập được" của "Nhập và đăng tất cả" (P9-9b).
2. Mỗi sản phẩm của mẫu có đúng **một ảnh** (website chỉ liệt kê ảnh chính cho các sản phẩm này).
3. Lần quét có sản phẩm "không trả về" luôn có trạng thái `PARTIAL` (xong, có việc cần xem), vì mỗi lần ghi mã `PRODUCT_NOT_RETURNED`. Đúng thiết kế; chỉ là chữ trạng thái.
4. **Sản phẩm bị bỏ qua rồi nội dung đổi ở nguồn:** bản này (P9-7/P9-8) **chưa** mở lại ứng viên đã bỏ qua (quy tắc "không đề xuất lại trừ khi nội dung đổi" do chủ yêu cầu 2026-10-11 được làm ở P9-9b; kết quả kiểm tra thật nằm ở báo cáo P9-9b).
5. Con số "52 phiên bản sản phẩm có giá vốn" trong cơ sở dữ liệu thử là dữ liệu mẫu có sẵn của bản sao kiểm tra giao diện, không do lần quét tạo ra (không có sản phẩm nào có dấu vết nhập từ nguồn).

## Bổ sung 2026-10-11 (P9-9b)

Quy tắc "sản phẩm bị bỏ qua mở lại khi nội dung nguồn đổi" đã làm xong ở P9-9b và thử thật trên bản sao (ứng viên 330: IGNORED rồi quét lại thì về "Chờ duyệt"); lần quét toàn bộ thật của 352 sản phẩm cũng ở báo cáo P9-9b.

## Em tự đặt, chờ chủ duyệt

Không có cách hiểu mới ở bước này (chỉ kiểm tra). Mọi điều cần chủ duyệt nằm trong báo cáo P9-7, P9-8, P9-9b.
