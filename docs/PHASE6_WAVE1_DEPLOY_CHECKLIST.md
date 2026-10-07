# Hướng dẫn đưa Phase 6 Đợt 1 (sản phẩm, kho, nhập Excel) lên máy chủ thật

**Trạng thái: bản nháp, sẽ hoàn thiện ở bước P6-7 (kiểm tra tải) trước khi Chủ deploy.** Chưa có gì của Phase 6 trên máy chủ thật; chưa push. Mỗi bước hoàn thành sẽ bổ sung vào đây. Cách làm giống `PHASE5_DEPLOY_CHECKLIST.md`: từng bước, một cửa sổ terminal, bước nào ra kết quả khác mong đợi thì DỪNG và chụp màn hình gửi lại.

## Lúc nào chạy (Chủ quyết 2026-10-07)

**Chạy Đợt 1 vào lúc vắng khách, buổi tối.** Lý do kỹ thuật: migration `20261106000008_phase6_notification_kinds` nới 3 ràng buộc của bảng `notifications` đang chạy thật và giữ khóa độc quyền rất ngắn trên bảng đó khi chạy (bảng nhỏ, chỉ nới, không dòng nào đổi). Worker cũng phải khởi động lại.

## Những gì Đợt 1 thay đổi (tính đến P6-5)

- **Cơ sở dữ liệu, chỉ thêm (9 migration; 63 migration hiện có trên máy chủ + 9 = 72):** `20261106000000` đến `20261106000008` (xem `PHASE6_STEP2_DB_PERMISSIONS_FOUNDATION.md`, `PHASE6_STEP3_CATALOG_ADMIN.md`, `PHASE6_STEP3B_PRE_ORDER_FIELDS.md`, `PHASE6_STEP4_INVENTORY.md`). Nếu P6-5 thêm migration, báo cáo `PHASE6_STEP5_IMPORT.md` sẽ nói rõ và danh sách này được cập nhật.
- **Quyền mới: 11** (tổng 65), **chưa gán cho ai**. Sau khi deploy, Chủ gán trong màn hình Vai trò, nhóm "Sản phẩm và kho".
- **Không đụng** hóa đơn, thanh toán, điểm thưởng, POS (test cô lập Đợt 1 ghim điều này; ngoại lệ duy nhất là nới 2 loại thông báo ở trên).
- **Worker phải khởi động lại** (vòng cảnh báo kho và quét hạn dùng 08:00 nằm trong worker).
- **Thứ tự lệnh** (khi hoàn thiện): `pnpm db:deploy` rồi `pnpm db:permissions:sync`; kiểm tra số migration và số quyền (65).

## Việc còn lại để hoàn thiện hướng dẫn

P6-6 (trang công khai), P6-7 (tải, số tiến trình web), kiểm tra sau deploy, cách quay lại bản cũ.
