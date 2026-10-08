# P6-18: Kho của quà tặng sản phẩm (báo cáo)

Làm theo yêu cầu của Chủ (2026-10-08, mục 2.29) và quyết định Q10, mốc 3b. Chưa đẩy lên, chưa triển khai, chưa gán quyền. Các cách hiểu P18-1 đến P18-5 ở mục 2.33, **chờ Chủ xem lại**.

## Đã làm

- **Quà tặng sản phẩm gắn được với một sản phẩm** (ô "Sản phẩm trừ kho" trong ngăn thêm/sửa quà, không bắt buộc). Danh mục hiện cột "Dịch vụ hoặc sản phẩm".
- **Bấm "đã dùng" một lượt quà** ở chi nhánh nào thì kho chi nhánh đó trừ 1 sản phẩm: lô hết hạn sớm nhất, không lấy lô đã hết hạn, không lấy hàng đang giữ cho hóa đơn hoặc cho đơn đặt trước đã về. Hết hàng thì báo "Hết hàng" và không ghi lượt dùng.
- **Quản lý hoàn lại lượt dùng nhầm:** sản phẩm trả về đúng lô cũ, một lần; lượt dùng cũ vẫn trong lịch sử.
- Quà không gắn sản phẩm (kể cả quà tạo từ trước) không trừ kho. Đã có người dùng quà thì không đổi sản phẩm gắn được (cả API lẫn cơ sở dữ liệu).
- Lịch sử kho có hai dòng mới: "Tặng quà cho khách", "Nhận lại quà tặng nhầm".

## Migration

`20261119000000` (hai giá trị `GIFT_OUT`, `GIFT_RETURN`) và `20261119000001` (cột `variant_id` ở quà, `reward_manual_use_id` ở phát sinh kho, kiểm tra hình dạng và số lượng, kiểm tra cuối giao dịch). 93 thành 95. Chỉ thêm, không thêm quyền.

## Kiểm thử

- Mới: 8 bài tích hợp API (gắn sản phẩm, lô hết hạn trước, hết hàng không ghi gì, hàng giữ cho hóa đơn và đơn đặt trước, hoàn lại về đúng lô, quà không gắn, khóa đổi sản phẩm), 3 bài **đua trên PostgreSQL thật** (hai lượt dùng một đơn vị cuối, quà với bán lẻ, hai lần hoàn lại), 1 bài HTTP, 7 bài tĩnh migration, 3 bài web.
- Cũ không bị nới (thêm trường `variant` vào dữ liệu mẫu và hai nhãn lịch sử kho). Chạy lại trên cơ sở dữ liệu 95 migration: 34 bộ tích hợp (quà, kho, bán hàng, trả hàng, hoàn tiền, đổi hàng, đơn đặt trước, thông báo, hóa đơn, thanh toán) đều đạt; lint, ranh giới, định dạng sạch. Chạy toàn bộ ở kiểm tra mốc 3b.

## UX gate (đã mở từng ảnh)

Ảnh `.local/uxui-screens/p618-*` (360/768/1440 sáng + 1440 tối): danh mục quà (có cột sản phẩm) và ngăn sửa quà có ô "Sản phẩm trừ kho". Không có màn hình nào khác đổi. Ô chọn một ngăn nhỏ 20 px là hộp kiểm có sẵn của bộ giao diện.

## Câu hỏi mở

Có cho thêm sản phẩm gắn vào quà sau khi đã có người dùng không (hiện không: tạo quà mới).
