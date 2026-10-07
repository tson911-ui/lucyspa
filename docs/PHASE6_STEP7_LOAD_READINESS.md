# Phase 6 P6-7: chịu tải cho trang mỹ phẩm (2026-10-07, đã commit trên máy, chưa push, chưa deploy)

Theo OQ-26 đã duyệt: **chỉ web chạy nhiều tiến trình; API và worker giữ đúng một**. Máy chủ: 6 nhân, 7,8 GB RAM, không swap. Không đụng máy chủ, không migration, không quyền mới, không đụng POS/thanh toán.

## Đã làm

- **`ecosystem.config.cjs`** (gốc repo): `lucyspa-web` chạy cluster, mặc định **3 tiến trình** (`WEB_INSTANCES`, `WEB_PORT`), tự khởi động lại khi vượt 700 MB (máy không có swap); `lucyspa-api` và `lucyspa-worker` là `fork`, `instances: 1`. Test `apps/worker/src/ecosystem.test.ts` **báo lỗi nếu ai đổi worker hoặc API khỏi "đúng một"**. Chỉ web dùng `pm2 start ecosystem.config.cjs --only lucyspa-web`; `pm2 reload` cập nhật cuốn chiếu từng tiến trình.
- **Giới hạn tần suất dùng chung (Redis)** cho mọi đường `/api/v1/public/*` (chỉ đọc, ẩn danh): mỗi địa chỉ 300 lần/phút (ảnh 1.200), tất cả khách ngoài cộng lại 6.000 (ảnh 30.000); quá thì 429 kèm `Retry-After`. Đếm bằng khóa Redis có hạn 2 phút nên mọi tiến trình dùng chung một ngân sách; **Redis hỏng thì cho qua** (không để trang công khai lỗi theo). Địa chỉ khách đọc từ **bên phải** `X-Forwarded-For` (chỗ nginx ghi), IPv6 tính theo /64, Redis chỉ giữ mã băm. Yêu cầu của chính website (không có header đó) không bị đếm. Mã: `apps/api/src/platform/public-rate-limit.*`.
- **Bộ nhớ đệm 5 giây trong API** cho danh sách, chi tiết và mã sản phẩm (gộp các yêu cầu giống nhau cùng lúc thành một lần đọc; không nhớ lỗi, không nhớ tìm kiếm tự do). Cùng bộ nhớ 60 giây sẵn có của web, giá/tồn đổi hiện chậm nhất khoảng 65 giây. Không cần điều phối giữa các tiến trình vì chỉ dựa vào thời hạn.
- **Cơ sở dữ liệu:** `max_connections` mặc định **100** (cùng ảnh `postgres:17-alpine` với máy chủ). Mỗi tiến trình API và worker mở tối đa **10** kết nối (`packages/database/src/index.ts`), web **0** (web không được nhập gói DB, `pnpm lint` kiểm). Bình thường ≤ 20 trên 97 dùng được; lúc deploy thêm lệnh migrate ≤ 30; nhân API lên 3 sau này vẫn ≤ 40.
- **Đo tải:** `scripts/load-public.mjs` (không thêm thư viện).

## Số đo (máy phát triển Windows 16 nhân, 32 yêu cầu song song, 10 giây; chỉ để so sánh trước/sau, không phải số của máy chủ 6 nhân)

| Đường                      | Trước (req/s, p50 ms) | Sau (req/s, p50 ms)           |
| -------------------------- | --------------------- | ----------------------------- |
| Trang `/vi`                | 97, 338               | 249, 84 (web 3 tiến trình)    |
| Trang `/vi/products`       | 61, 522               | 159, 188                      |
| Trang chi tiết sản phẩm    | 96, 349               | 235, 131                      |
| API danh sách sản phẩm     | 74, 412               | 1.200, 25 (bộ nhớ đệm 5 giây) |
| API chi tiết / mã sản phẩm | 79, 387 / 264, 119    | 1.753, 17 / 2.010, 14         |

Chưa đổi (đã đo, đủ dùng): `site` 211, `services` 265, `slides` 194, ảnh 143 req/s. Quá 3–4 tiến trình web, số đo cục bộ không tăng thêm (đo 2/3/4/6) nên chọn **3**, chừa nhân cho API, PostgreSQL, Redis, nginx. Mỗi tiến trình web dừng ở 400–470 MB sau 45 giây tải hỗn hợp (không tăng tiếp). `pm2 reload` dưới tải: 13 trên 2.148 yêu cầu bị đứt (0,6%); khởi động lại đơn như hiện nay đứt hẳn vài giây.
Giới hạn: kiểm thử khi quá hạn mức (đúng 300 lần qua rồi 429; khách khác không ảnh hưởng; yêu cầu của chính website không đếm) làm trên Redis thật; **pm2 chỉ thử trên Windows**, trên Linux phân phối kết nối đều hơn.

## Quyết định kỹ thuật (OQ-54..OQ-57 trong `PHASE6_OWNER_DECISIONS_VI.md`): Chủ đã duyệt như đề xuất ngày 2026-10-07

Mức giới hạn 300/1.200 và 6.000/30.000; bộ nhớ đệm 5 giây; web 3 tiến trình, trần 700 MB; yêu cầu nginx gửi `X-Forwarded-For` (nếu không, giới hạn **không có tác dụng**; hướng dẫn deploy có bước kiểm bằng lệnh).

## Ảnh lỗi (sau khi Chủ duyệt Đợt 1)

Ảnh không tải được (tệp mất, mạng đứt) nay được thay bằng biểu tượng trung tính cùng khung, không còn biểu tượng ảnh hỏng của trình duyệt: `MediaThumb`, `MediaTile`, `MediaRow` (bộ thành phần chung) và mọi ảnh sản phẩm trên trang công khai (thẻ, thư viện ảnh và dải ảnh nhỏ). Dùng `FallbackImage` / `useImageFailure` trong `packages/ui/src/image-fallback.tsx`; bắt cả ảnh đã lỗi trước khi trang kịp "thức dậy" (trang vẽ từ máy chủ). Test jsdom: `image-fallback.test.tsx`.

## Kiểm thử

Mới: `public-rate-limit.test.ts` (9), `public-rate-limit.integration.test.ts` (Redis thật, hai "tiến trình" dùng chung ngân sách, hết hạn, Redis chết), `short-cache.test.ts` (4), `ecosystem.test.ts` (3). Kết quả chạy toàn bộ: xem báo cáo mốc Đợt 1 (`PHASE6_WAVE1_MILESTONE.md`).
