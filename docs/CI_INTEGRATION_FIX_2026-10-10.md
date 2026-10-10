# CI đỏ ở bước `pnpm test:auth:integration` (2026-10-10): nguyên nhân thật, cách sửa, bằng chứng

Trạng thái: **đã sửa, chưa deploy.** Không liên quan đến máy chủ.

## Điều em hiểu sai lúc đầu

Em báo "bộ tích hợp đỏ vào buổi tối". Đó là **sai**: 220 test đỏ ở lần chạy đó là do em chạy trên một **bản sao của cơ sở dữ liệu kiểm tra giao diện** (có sẵn chủ, vai trò, lịch, hóa đơn mẫu), không phải cơ sở dữ liệu mới như CI. Trên cơ sở dữ liệu mới, ở 19:20 giờ Việt Nam, 973 test chạy chỉ đỏ đúng **1** (xem mục 1).

## Ba nguyên nhân thật (CI không đọc được log nên em cho bước CI in tên test đỏ thành một chú thích: `scripts/ci-auth-integration.sh`, đọc được không cần đăng nhập)

1. **Lỗi của em ở P9-2 (đỏ ở `5ee604c` và `4c8dbba`).** Hai quyền mới làm danh mục thành 68; `role-admin.integration.test.ts` còn đếm cứng 63 quyền và danh sách quyền GLOBAL_ONLY cũ. Đã sửa (65 = 68 trừ 3 quyền chỉ của chủ; thêm hai mã vào danh sách).
2. **Cờ ngẫu nhiên (đỏ ở `295d6fb`, commit chỉ có tài liệu).** `return.exception.integration.test.ts` sắp xếp dòng lịch sử theo `occurred_at` (độ chính xác mili giây) rồi theo `id` ngẫu nhiên; hai dòng OPENED và WINDOW_EXCEPTION ghi liền nhau nên hay trùng mili giây, thứ tự lật gần một nửa số lần chạy. Đã sửa: dùng `kind` để phá thế hòa (enum khai báo theo vòng đời); hai thời điểm khác nhau vẫn quyết định trước. Không nới điều khẳng định.
3. **Cờ ngẫu nhiên khác (tìm thấy khi chạy giả đồng hồ lúc 23:50).** `campaign.integration.test.ts` tìm "san pham c3"; ô tìm cũng đọc SKU, mà SKU chứa mã chạy ngẫu nhiên 8 ký tự hex: khi mã đó có "c3" (khoảng 1 lần chạy trong 40) cả ba sản phẩm khớp. Đã đổi các nhãn sang chữ không phải hex (`g1`, `g2`, `w3`).

Không test nào hóa ra phụ thuộc giờ trong ngày. Các test hay phụ thuộc giờ (`operations`, `walk-in`, `reassignment`...) đã tự chọn múi giờ có giờ trưa; `my-income` đã ghim giờ từ bước trước.

## Chứng minh không phụ thuộc giờ chạy

Cách làm (`scripts/it-fake-clock.sh <HH:MM> [số ngày]`): Postgres một lần dùng xong với libfaketime **và** đồng hồ của tiến trình kiểm thử cùng bắt đầu ở giờ Việt Nam chọn; cơ sở dữ liệu mới, toàn bộ bộ tích hợp.

| Giờ giả (Asia/Ho_Chi_Minh) | Kết quả                                        |
| -------------------------- | ---------------------------------------------- |
| 06:00                      | 794 test, 793 qua, 0 đỏ (1 bỏ qua)             |
| 13:00                      | 794 test, 793 qua, 0 đỏ                        |
| 16:55                      | 794 test, 793 qua, 0 đỏ (chạy lại sau khi sửa) |
| 19:30                      | 794 test, 793 qua, 0 đỏ (chạy lại sau khi sửa) |
| 23:50                      | 794 test, 793 qua, 0 đỏ (chạy lại sau khi sửa) |

**Giới hạn phải nói thẳng:** libfaketime trong Postgres làm `statement_timeout` (10 giây) bật sớm một cách ngẫu nhiên khi nhiều kết nối chạy đua; **ngay cả khi chỉ lệch 1 phút** (đối chứng: cùng 5 bộ test đua qua 27/27 trên container thường, đỏ 5 trên 27 với libfaketime). Vì vậy bộ chạy giả đồng hồ **không gồm các bộ `*.race.*`** (28 bộ; chúng là test đồng thời, không có logic theo giờ) và hai lần đỏ đầu (16:55 và 19:30, đều là `57014 statement timeout` ở test hoàn tiền) là lỗi của công cụ, không phải của giờ: test đó qua 25/25 khi chạy riêng ở 16:55 giả, và cả hai giờ qua khi chạy lại. Các bộ đua chạy ở **đồng hồ thật** (mục dưới).

Đồng hồ thật, bộ đầy đủ **gồm cả bộ đua**, cơ sở dữ liệu mới (khoảng 23:20 giờ Việt Nam): **973 test, 971 qua, 0 đỏ** (2 bỏ qua).

## Chưa làm

## Thử thêm: ngày

`it-fake-clock.sh 13:00 30` (đồng hồ ở 30 ngày sau, 13:00): 794 test, 8 đỏ (đếm cả bộ cha), **không có lỗi nào do ngày**: 6 là một chuỗi bắt đầu từ bài `concurrent bootstrap` bị `57014 statement timeout` (lỗi công cụ của libfaketime), 2 là chính cờ ngẫu nhiên của bộ chọn sản phẩm chiến dịch ở một nhãn khác (`c1`); em đã đổi cả `c1`, `c2`, `c3` sang nhãn không phải hex (`g1`, `g2`, `w3`) và bộ đó qua 8/8.
