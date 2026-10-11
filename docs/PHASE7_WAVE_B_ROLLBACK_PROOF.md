# Phase 7 Đợt B (lương): bằng chứng quay lui (2026-10-12, chạy trên máy này, chỉ cơ sở dữ liệu thử)

**Câu hỏi:** nếu sau khi triển khai Đợt B (7 migration `20261202000000` đến `20261208000000`, 110 thành **117**; 13 bảng mới; quyền vẫn 73) phải đưa phần mềm về bản Đợt A (`b11c21e`), bản cũ có chạy được trên cơ sở dữ liệu mới không?

## Đã chạy gì

- Bản cũ `b11c21e` (Đợt A) ở `D:/lucy-spa-p9-old` (cài và build riêng); mọi tiến trình chỉ trỏ vào cơ sở dữ liệu thử `lucy_spa_p7_rollback_scratch`, một bản sao của cơ sở dữ liệu kiểm thử giao diện đã áp **đủ 117 migration** và có dữ liệu thật của đợt B: 11 phiếu lương (một bảng lương đã chốt và trả), 11 khoản tour và hoa hồng, 5 khoản tạm ứng ở đủ các trạng thái, 76 bút toán sổ quỹ. Máy khách Prisma cũ, `db:permissions:sync` cũ, API cũ (cổng 3201) và worker cũ chạy trên đó. Đã xóa cơ sở dữ liệu thử sau khi xong.

## Kết quả

| Việc                                                                                | Kết quả                                                                                                                    |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Máy khách Prisma cũ đọc mọi bảng của nó (`.local/p7/rollback-reads.mjs`)            | **173 trên 173** (13 bảng mới của đợt B được bản cũ bỏ qua; bảng công CTV có thêm một cột, bản cũ không đọc nó)            |
| `db:permissions:sync` của bản cũ                                                    | "0 inserted, 73 already present" (không phải xóa quyền nào vì bản cũ đã biết cả 73)                                        |
| API cũ: `/health/ready`, đăng nhập Owner, 13 phép đọc kể cả `/api/v1/cash/overview` | tất cả **200**                                                                                                             |
| Worker cũ chạy 2 phút                                                               | chỉ 4 dòng "Inventory sales job failed" đã có sẵn trong dữ liệu xem thử (cùng lỗi ở các lần quay lui trước); không lỗi mới |

## Thứ tự quay lui đã kiểm

1. Dừng `lucyspa-api` và `lucyspa-worker`.
2. **Không xóa gì trong cơ sở dữ liệu.** `git checkout b11c21e…`, `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, khởi động lại ba tiến trình, `pnpm db:permissions:sync`.
3. 13 bảng mới ở lại, bản cũ bỏ qua chúng. (Quay về Phase 9 `ac74013` còn phải xóa 5 hàng quyền, xem hướng dẫn triển khai.)

## Không thể hoàn tác / chưa chứng minh

- **Bảng lương đã chốt không "mở lại" được** dù quay lui: bản chốt, phiếu lương, các khoản tour, hoa hồng, tip, công CTV đã khóa là lịch sử, cơ sở dữ liệu từ chối sửa. Quay về bản cũ chỉ làm phần lương **đứng yên**; dữ liệu vẫn nguyên và bản mới đọc lại được.
- Bản cũ **không** thấy các khóa mới trên công CTV: nếu quay về bản cũ rồi sửa tiền công của một buổi đã vào bảng lương đã chốt, **cơ sở dữ liệu vẫn từ chối** (khóa nằm ở cơ sở dữ liệu, không ở mã).
- **Chưa thử:** web cũ (Next) và pm2 trên máy chủ Linux thật; tài khoản khác Owner; Phase 9 (`ac74013`) chạy trên cơ sở dữ liệu 117 (chỉ thử trên 110 ở `PHASE7_WAVE_A_ROLLBACK_PROOF.md`; 7 migration sau chỉ thêm bảng).
