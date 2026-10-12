# Dán khóa Anthropic vào máy chủ (Owner tự làm, khoảng 10 phút)

**Quy tắc duy nhất:** không gửi khóa vào chat, e-mail, Zalo hay dán vào Claude Code. Em (Claude) **không bao giờ cần thấy khóa**. Chương trình cũng không bao giờ in khóa ra màn hình, nhật ký hay trang web; màn hình **Cài đặt AI** chỉ báo "máy chủ đã có khóa" hoặc "chưa có".

Làm sau khi **khối lệnh triển khai Wave 0 + A** (`docs/DEPLOY_CLAUDE_WAVE_0_A.md`) đã chạy xong không có `DUNG LAI`. Trước khi có khóa, mọi tính năng AI **tắt**, cả hệ thống vẫn chạy bình thường (trang "Dọn lời đánh giá" không cần khóa).

## A. Làm trên trang Anthropic Console (trình duyệt)

1. Đăng nhập Anthropic Console bằng tài khoản đã nạp credit.
2. Tạo **hai Workspace riêng** (Settings, Workspaces): **`lucyspa`** (cho tính năng trong ứng dụng) và **`lucyspa-n8n`** (cho các bot n8n). Đặt **giới hạn chi tiêu hằng tháng** cho từng workspace (đề xuất `lucyspa` 100 USD trong tháng đầu; `lucyspa-n8n` theo mức bạn đang dùng). Workspace mặc định không đặt được giới hạn nên phải tạo riêng. Menu có thể khác: chụp màn hình gửi em (che khóa).
3. Trong `lucyspa` tạo API key tên **`lucyspa-app`**. Khóa chỉ hiện **một lần**: lưu ngay vào trình quản lý mật khẩu của bạn.
4. (Nên làm) Trong `lucyspa-n8n` tạo key `lucyspa-n8n` rồi **thay khóa đang dùng trong n8n** bằng khóa này, để hạn mức của n8n đo riêng.

## B. Làm trên máy chủ (terminal web của iNET, đã đăng nhập)

5. Mở tệp bằng trình soạn thảo, **không dùng `echo` hay `printf`** (chúng để lại khóa trong lịch sử lệnh): `nano /opt/lucyspa/.env`. Thêm một dòng mới `ANTHROPIC_API_KEY=` rồi dán khóa `lucyspa-app` **ngay sau dấu `=`** (không dấu cách, không ngoặc kép). Lưu (Ctrl+O, Enter) và thoát (Ctrl+X).
6. Đặt quyền và đếm dòng (lệnh chỉ **đếm**, không in khóa): `chmod 600 /opt/lucyspa/.env && grep -c '^ANTHROPIC_API_KEY=' /opt/lucyspa/.env`. **Mong đợi: `1`.**
7. Khởi động lại hai tiến trình đọc khóa: `pm2 restart lucyspa-api lucyspa-worker --update-env && sleep 8 && pm2 status`. **Mong đợi:** hai tiến trình `online`.
8. Kiểm tra máy chủ ra được Anthropic: `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 10 https://api.anthropic.com/v1/models`. **Mong đợi: `401`** (nối được, chỉ là chưa gửi khóa). Lỗi kết nối hoặc hết thời gian: dừng và báo em.

## C. Làm trên trang quản trị lucyspa.vn

9. **Quản trị → Cài đặt AI.** Ô "Kết nối với Anthropic" phải ghi **"Máy chủ đã có khóa"**.
10. Nhập **tỷ giá (đồng cho 1 USD)** (ví dụ 26.000; bạn tự nhập, hệ thống không tự đoán) và xem **hạn mức**: tháng 3.000.000 đ, viết lại sản phẩm 2.000.000 đ (sửa được). Bật **"Bật AI (công tắc chung)"** và **"Viết lại nội dung sản phẩm"**, bấm **Lưu cài đặt**.
11. Bấm **Kiểm tra kết nối** (gọi miễn phí, không tốn tiền). **Mong đợi:** "Kết nối tốt" kèm giờ kiểm tra. Báo "khóa không được chấp nhận" thì làm lại bước 5 đến 7; "hết hạn mức chi tiêu" thì xem Console.

## Nếu nghi lộ khóa

Vào Console, **xóa khóa ngay**, tạo khóa mới, làm lại bước 5 đến 7. Khóa cũ vô dụng ngay khi bị xóa.

## Chi phí và an toàn (nhắc lại)

- Hai lớp chặn chi tiêu: **hạn mức của ứng dụng** (Cài đặt AI; chạm hạn mức thì lần chạy tự dừng, bản nháp đã viết vẫn còn) và **giới hạn của workspace** trong Console.
- Chi phí các bot n8n tính ở workspace `lucyspa-n8n`, **không** nằm trong con số của Cài đặt AI.
- Anthropic có thể giữ nội dung gửi sang đến 30 ngày để chống lạm dụng; chương trình chỉ gửi nội dung sản phẩm của nhà cung cấp (đã bỏ lời đánh giá, liên kết, số điện thoại), **không** gửi dữ liệu khách hàng.
