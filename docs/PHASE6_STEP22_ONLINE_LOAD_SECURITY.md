# P6-22: Đo tải và kiểm tra bảo mật đặt hàng online (báo cáo)

Theo yêu cầu của Chủ (2026-10-09): đo thật trang đặt hàng và webhook PayOS, thêm tiến trình API chỉ khi số đo cho thấy cần. Các điểm kỹ thuật W4-12 **chờ Chủ xem lại**.

## Cách đo

`scripts/load-online.mjs` (kèm `scripts/load-online-payos.mjs`) dựng dữ liệu riêng trên cơ sở dữ liệu `*_scratch` (từ chối tên khác), chạy **API thật** (một tiến trình, `apps/api/dist`) với bộ giả lập PayOS, rồi chạy năm pha: A đọc, B đặt hàng cùng lúc (một món khan hàng), C thanh toán (mỗi webhook gửi **ba bản cùng lúc**), D đối soát bằng SQL, E bảo mật. Thoát khác 0 nếu một bất biến hoặc kiểm tra bảo mật hỏng. Máy phát triển Windows 16 nhân; chỉ để so sánh, không phải số của máy chủ 6 nhân.

## Số đo (một tiến trình API)

| Lần chạy                                   | Đặt hàng (3 lệnh/khách)                                                                    | Bàn giao          | Webhook (3 bản/đơn)                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------- |
| 100 khách, 30 song song, mỗi khách một món | 14,6 s, 75 đơn, 25 bị từ chối do hết hàng; CPU API 12,8 s (khoảng 130 ms CPU một lượt đặt) | `pay` p50 ≈ 0,5 s | 225 lần gửi, 0 lỗi; CPU 4,1 s (khoảng 18 ms một lần) |
| 150 khách, 50 song song                    | 18,1 s, 112 đơn; p50 đặt đơn 2,2 s, p95 6,1 s; CPU 13,4 s                                  | p50 0,9 s         | 336 lần gửi, 0 lỗi, p50 0,64 s                       |
| Đọc công khai/giỏ (900 yêu cầu)            | 3,3 s; danh sách sản phẩm p50 6 ms, giỏ p50 0,29 s                                         |                   |                                                      |

**Kết luận:** một tiến trình API làm khoảng **8 lượt đặt hàng trọn vẹn mỗi giây** khi bị dồn (CPU của tiến trình khoảng 72%), cao hơn nhiều lần so với nhu cầu của một tiệm (dưới một đơn mỗi giây ngay cả khi khuyến mãi); mọi bất biến đều đúng (không bán quá tồn, mỗi đơn đúng một thanh toán và một sự kiện đã trả dù webhook gửi ba lần, tồn = tổng các lần xuất nhập, giữ hàng = các dòng giữ đang mở) và không có lỗi 5xx. **Không thêm tiến trình API** (OQ-26 giữ nguyên); đo lại khi số đơn mỗi giây vượt vài chục. Hàng khan (hai trăm người tranh một món) xếp hàng ở khóa dòng tồn kho nên độ trễ tăng chứ không sai số.

## Bảo mật (pha E, 20 kiểm tra, đều đạt)

Không phiên thì 401; ghi mà thiếu mã CSRF hoặc sai Origin thì 403; khách khác không đọc, hủy, trả tiền được đơn của người khác (404); đơn đã trả khách không tự hủy (409); khách không vào được trang nhân viên hay cài đặt; danh tính, giá, tổng, trạng thái trong thân yêu cầu bị từ chối (400); chữ ký webhook giả, thân quá lớn, thân sai định dạng bị từ chối; 80 webhook giả liền nhau đều bị từ chối hoặc chặn tần suất, còn webhook thật không bao giờ bị chặn; chuỗi tiêm SQL trong ô tìm kiếm chỉ là chữ.

## Thay đổi trong mã

- **Ngân sách yêu cầu theo tài khoản** (W4-12, chờ Chủ xem lại): tối đa **120 yêu cầu thành công mỗi phút** cho các đường online của một hội viên (một trang bình thường dùng khoảng 20); quá thì 429 `RATE_LIMITED`. Đếm trong cùng giao dịch; yêu cầu lỗi không tính (nhẹ và bị khóa dòng hội viên giới hạn). Bài kiểm tra: `online.limits.integration.test.ts`.
- Bắt lỗi cơ sở dữ liệu thành `CONFLICT` cho mọi lệnh khách và nhân viên online; sửa ba đường `POST` rỗng bị từ chối nhầm.

## Chưa làm

Đo trên máy chủ thật (Chủ chạy `node scripts/load-online.mjs --db <cơ sở dữ liệu thử>` trên một bản sao); cổng PayOS thật và độ trễ mạng của nó không đo được ở đây.
