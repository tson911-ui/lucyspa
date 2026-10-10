# Quét bí mật trong kho mã và toàn bộ lịch sử git (2026-10-10, chỉ đọc)

Lý do: kho `tson911-ui/lucyspa` đang **công khai**. Phạm vi: các tệp đang có và **mọi commit** (355 commit, mọi nhánh). Không viết lại lịch sử, không đổi gì ở máy chủ.

## Cách quét

1. Tên tệp từng được commit: `.env*`, khóa và chứng chỉ (`.pem`, `.key`, `.p12`, `id_rsa`...), bản sao lưu (`.dump`, `.tgz`, `.zip`).
2. Mọi dòng được thêm trong lịch sử, theo mẫu: khối khóa riêng, khóa AWS/GitHub/Slack/Google, JWT, địa chỉ có tài khoản và mật khẩu (`scheme://user:pass@`), biến có tên bí mật (`PAYOS_*`, `*_KEY`, `*_SECRET`, `PASSWORD`, `TOKEN`) kèm giá trị dài, chuỗi 43 ký tự giống khóa, địa chỉ IP công cộng, `Bearer`/`Basic`, nội dung thông điệp commit.
3. `gitleaks` (bản chính thức, chạy bằng Docker, đã che giá trị): 348 commit, khoảng 25 MB.

## Kết quả

- **Không có `.env` nào từng được commit.** Chỉ có `.env.example` (mật khẩu để trống). `.env`, `.env.*` và `.local/` nằm trong `.gitignore`.
- **Không có khóa riêng, chứng chỉ, khóa đám mây, JWT, khóa PayOS thật, mật khẩu máy chủ hay địa chỉ IP máy chủ** trong kho hay lịch sử.
- gitleaks báo **3 điểm, cả ba đều là hằng số kiểm thử, không phải bí mật**: hai mã UUID ngẫu nhiên dùng làm khóa chống gửi trùng trong `apps/web/src/lib/workforce/pos.test.tsx`, và khóa mẫu cùng chữ ký mẫu mà **chính tài liệu của PayOS công bố** trong `packages/server/src/payos.test.ts`.
- Địa chỉ có mật khẩu chỉ xuất hiện trong dữ liệu kiểm thử (`test:***@localhost`, `user:***@example`) và trong `scripts/init-env.mjs` (mật khẩu lấy từ biến sinh ngẫu nhiên, không có sẵn).
- Không có số điện thoại hay email thật của khách hoặc nhân viên; chỉ có địa chỉ ví dụ trong kiểm thử.

## Phải xoay (đổi) khóa nào: **không có.**

Khóa PayOS, khóa phiên, mật khẩu cơ sở dữ liệu và SMTP chỉ có trên máy chủ và trong `.env` cục bộ, không ở trong kho.

## Điều cần biết (không phải bí mật bị lộ, nhưng đang công khai)

1. **Email cá nhân của chủ là địa chỉ tác giả và người commit của cả 355 commit** (cấu hình `git` của tài khoản). Muốn bỏ phải viết lại lịch sử: **chưa làm**. Với các commit sau: đặt email `git` thành địa chỉ ẩn của GitHub (`<số>+tson911-ui@users.noreply.github.com`) và bật "Keep my email addresses private" cùng "Block command line pushes that expose my email" trong GitHub Settings → Emails.
2. **Tài liệu vận hành đang công khai**: hơn 400 dòng nói về đường dẫn máy chủ (`/root/backups`, `/opt/lucyspa-media`), `pm2`, `nginx`, các bước deploy, quy tắc nghiệp vụ, quyết định của chủ và tên nhà cung cấp. Không có bí mật, nhưng giúp kẻ tấn công biết cách hệ thống chạy. **Đưa kho về riêng tư** (đã có trong danh sách việc trước khi ra mắt, `docs/REVIEW_POLISH_CHECKLIST.md` mục G) và coi nội dung đã đọc được.
3. Phạm vi quét chỉ gồm các commit. Chưa kiểm: nhật ký Actions cũ, bản sao (fork) hoặc bộ nhớ đệm bên ngoài; nên kiểm trong GitHub Settings → Actions.
