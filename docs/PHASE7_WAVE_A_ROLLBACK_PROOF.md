# Phase 7 Đợt A (sổ quỹ): bằng chứng quay lui (2026-10-11, chạy trên máy này, chỉ cơ sở dữ liệu thử)

**Câu hỏi:** nếu sau khi triển khai Đợt A (hai migration `20261201000000` và `20261201000001`, 108 thành 110; quyền 68 thành **73**) phải đưa phần mềm về bản đang chạy thật (`ac74013`, Phase 9), bản cũ có chạy được trên cơ sở dữ liệu mới không?

## Đã chạy gì

- Bản cũ `ac74013` ở `D:/lucy-spa-p9-old` (cài và build riêng); mọi tiến trình chỉ trỏ vào cơ sở dữ liệu thử `lucy_spa_p7_rollback_scratch`, một bản sao của cơ sở dữ liệu kiểm thử giao diện đã áp **đủ 110 migration**, đã bắt đầu sổ quỹ, có 47 bút toán, 3 ngày đã chốt (một ngày lệch lớn). API và worker cũ chạy trên cổng 3201.
- Máy khách Prisma **cũ** đọc mọi bảng (`.local/p7/rollback-reads.mjs`); `db:permissions:sync` của bản cũ; API cũ đọc 13 địa chỉ với tài khoản Owner; worker cũ chạy 90 giây.

## Kết quả

| Việc                                                                                                                                                                                        | Kết quả                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Máy khách cũ đọc 168 bảng khi bảng `permissions` còn 73 hàng                                                                                                                                | **167 trên 168**; hỏng duy nhất: `Permission` ("Value 'MANAGE_CASH' not found in enum 'PermissionCode'")                              |
| Sau khi xóa **5 hàng quyền mới** (không ai được cấp: 0 hàng `role_permissions`, 0 ngoại lệ)                                                                                                 | **168 trên 168**                                                                                                                      |
| `db:permissions:sync` của bản cũ                                                                                                                                                            | "0 inserted, 68 already present"                                                                                                      |
| API cũ: `/health/ready`, đăng nhập Owner, 12 phép đọc (tài khoản, chi nhánh, dịch vụ, sản phẩm, nhân viên, vai trò, ưu đãi, thông báo, kho, điểm thưởng, nhập sản phẩm, nguồn nhà cung cấp) | tất cả **200**                                                                                                                        |
| API cũ gọi `/api/v1/cash/overview`                                                                                                                                                          | 404 (đúng: bản cũ không có sổ quỹ)                                                                                                    |
| Worker cũ 90 giây                                                                                                                                                                           | chỉ 4 dòng "Inventory sales job failed" đã có sẵn trong dữ liệu xem thử (cùng lỗi đã ghi ở các lần quay lui trước); không lỗi nào mới |

## Thứ tự quay lui đã kiểm

1. Dừng `lucyspa-api` và `lucyspa-worker`.
2. **Xóa 5 hàng quyền mới** khỏi bảng `permissions` (trước đó xóa mọi hàng `role_permissions` và `user_permission_overrides` trỏ vào chúng, nếu Owner đã gán): `MANAGE_PAY_RULES`, `MANAGE_PAYROLL`, `APPROVE_PAYROLL`, `VIEW_CASH`, `MANAGE_CASH`. Không làm bước này thì bản cũ **không đọc được bảng quyền** (lỗi ở trên).
3. `git checkout ac74013…`, `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, khởi động lại ba tiến trình, `pnpm db:permissions:sync` in "0 inserted, 68 already present".
4. **Không quay cơ sở dữ liệu.** Năm bảng mới (`finance_go_live`, `reauth_uses`, `cash_funds`, `fund_entries`, `cash_day_closings`) và các kiểu mới ở lại, bản cũ bỏ qua chúng.

## Không thể hoàn tác / chưa chứng minh

- **Sổ quỹ đã bắt đầu thì không "tắt" được:** bản ghi bắt đầu, số dư đầu kỳ, bút toán và ngày đã chốt là lịch sử, không xóa. Quay về bản cũ chỉ làm sổ **đứng yên** (không ghi thêm); dữ liệu vẫn nguyên và bản mới đọc lại được.
- Cổng kiểm trước khi quay lui không cần số liệu: bản cũ không đọc sổ quỹ, nên không có số nào phải bằng 0 (khác với Phase 6 Đợt 4).
- **Chưa thử:** web cũ (Next) và pm2 trên máy chủ Linux thật; tài khoản khác Owner; việc xóa 5 hàng quyền khi Owner đã gán chúng cho vai trò (câu lệnh xóa `role_permissions` trước nằm trong hướng dẫn, chưa chạy trên dữ liệu có gán).
