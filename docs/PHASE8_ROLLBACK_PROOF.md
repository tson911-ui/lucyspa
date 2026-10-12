# Phase 8: bằng chứng quay lui (2026-10-12, chạy trên máy này, chỉ cơ sở dữ liệu thử)

**Câu hỏi:** nếu sau khi triển khai Phase 8 (4 migration `20261210000000` đến `20261211000000`, 118 lên **122**; 2 bảng mới, 2 chỉ mục mới, quyền 73 lên **77**) phải đưa phần mềm về bản cũ `d42ab4e` (Phase 7 + Phase 9), bản cũ có chạy được trên cơ sở dữ liệu mới không?

## Đã chạy gì

- Bản cũ `d42ab4e` ở `D:/lucy-spa-p9-old` (cài và build riêng, `pnpm install --frozen-lockfile`, `db:generate`, `build` đều xong). Cơ sở dữ liệu thử `lucy_spa_p8_rollback_scratch` là **một bản sao** của cơ sở dữ liệu thử hiệu năng (164.400 hóa đơn) đã áp **đủ 122 migration**, có **dữ liệu thật của Phase 8**: 1.644 bút toán sổ quỹ và 1.092 lần chốt ngày, 12 bảng lương, 21 tip, tạm ứng, 169 dòng nhật ký, **31 đánh giá của khách** với 21 dòng chấm người phục vụ. Máy khách Prisma cũ, `db:permissions:sync` cũ, API cũ (cổng 3201) và worker cũ chạy trên đó. Đã xóa cơ sở dữ liệu thử sau khi xong.

## Kết quả

| Việc                                                                                               | Khi còn 4 hàng quyền mới (77 quyền)                                                    | Sau khi xóa 4 hàng quyền (73 quyền, đúng như hướng dẫn) |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Máy khách Prisma cũ đọc mọi bảng (`.local/p8/rollback-reads.mjs`)                                  | **186 trên 187**: bảng quyền không đọc được ("Value 'VIEW_REVIEWS' not found in enum") | **187 trên 187** (2 bảng đánh giá được bản cũ bỏ qua)   |
| `db:permissions:sync` của bản cũ                                                                   | **lỗi** (không biết 4 mã quyền lạ)                                                     | "0 inserted, 73 already present"                        |
| API cũ: `/health/ready`, đăng nhập Owner, 16 phép đọc (kể cả sổ quỹ, bảng lương, tạm ứng, nhật ký) | không thử (đã dừng ở dòng trên)                                                        | tất cả **200**                                          |
| Worker cũ chạy vài phút                                                                            |                                                                                        | **không có dòng lỗi nào** (API cũ cũng không)           |

**Kết luận:** quay về `d42ab4e` **phải xóa 4 hàng quyền mới trước** (`EXPORT_REPORTS`, `VIEW_STAFF_REPORTS`, `VIEW_PROFIT`, `VIEW_REVIEWS`); khối "Cách A" trong `docs/DEPLOY_PHASE8.md` làm đúng việc đó. Hai bảng đánh giá, hai chỉ mục và mọi dữ liệu **ở lại nguyên**, bản cũ bỏ qua. Nếu sau này triển khai lại bản mới, `db:permissions:sync` thêm lại 4 quyền (vẫn chưa cấp cho ai).

## Thứ tự quay lui đã kiểm

1. Dừng `lucyspa-api` và `lucyspa-worker`.
2. Xóa 4 hàng quyền (và phần cấp quyền, ghi đè quyền nếu có) bằng đúng câu lệnh của hướng dẫn.
3. `git checkout d42ab4e…`, `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, khởi động lại ba tiến trình, `pnpm db:permissions:sync`.

## Không thể hoàn tác / chưa chứng minh

- **Đánh giá của khách đã gửi không xóa được**, kể cả khi quay lui hoặc khi có lỗi: cơ sở dữ liệu từ chối sửa và xóa (lịch sử). Quay lui chỉ làm chúng đứng yên.
- Quyền đã gán cho vai trò **sẽ mất** khi xóa 4 hàng quyền; sau khi triển khai lại phải gán lại.
- Trong lúc thử, một dòng tạm ứng giả của dữ liệu thử (gắn nhầm vào tài khoản Owner, không phải nhân viên) làm `GET /api/v1/pay/advances` trả 503 ở **cả mã cũ**; sửa dòng giả thì trả 200. Đó là lỗi dữ liệu thử, không phải của Phase 8.
- **Chưa thử:** web cũ (Next) và pm2 trên máy chủ Linux thật; tài khoản khác Owner.
