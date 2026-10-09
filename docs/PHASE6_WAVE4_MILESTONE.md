# Phase 6 Đợt 4: kiểm tra mốc (2026-10-09, chạy trên máy này, chỉ cơ sở dữ liệu thử)

P6-19 đến P6-23 đã xây xong; mục này là P6-24. **Đã triển khai (Chủ báo 2026-10-09, khoảng 14:02 UTC+7, commit `4b91af6`; kết quả ở đầu `PHASE6_WAVE4_DEPLOY_CHECKLIST.md`). Phase 6 hoàn tất.** Hướng dẫn triển khai: `PHASE6_WAVE4_DEPLOY_CHECKLIST.md`; quay lui: `PHASE6_WAVE4_ROLLBACK_PROOF.md`.

## Cổng đầy đủ (cơ sở dữ liệu thử mới, đủ 101 migration; `.local/w4-milestone.sh`)

| Bước                                                                                             | Kết quả                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint` (kèm ranh giới), `pnpm typecheck`                               | sạch                                                                                                                               |
| `pnpm test` (cả kho)                                                                             | cơ sở dữ liệu 104, server 53, worker 24 (1 bỏ qua), ui 467, API 346 (117 bài tích hợp bỏ qua vì cần cơ sở dữ liệu), web 880: 0 lỗi |
| `pnpm build` (có `API_UPSTREAM_ORIGIN`)                                                          | sạch                                                                                                                               |
| `pnpm test:integration` (cơ sở dữ liệu)                                                          | 135 bài, 0 lỗi (kể cả khóa tĩnh các migration Đợt 4)                                                                               |
| `pnpm test:auth:integration` (toàn bộ bộ tích hợp API, nay gồm 8 bộ mới của Đợt 4 và 2 bộ P6-17) | 961 bài, 958 đạt, 2 bỏ qua; xem "Sửa trong lúc kiểm" cho bài còn lại                                                               |
| `pnpm smoke`                                                                                     | "Production startup smoke passed"                                                                                                  |

## Sửa trong lúc kiểm (đều là lỗi của bài kiểm tra hay câu chữ, không phải của hành vi)

- Một ràng buộc đổi câu chữ nên bài cũ P6-15 hỏng: câu chữ nay giữ nguyên cụm cũ ("…handed over and sold") và thêm "(an online line: delivered)". Bài cũ không đổi.
- Bài "quét 08:00" của tôi phụ thuộc giờ trong ngày (chạy lúc 12:50 thì giờ thử rơi trước 08:00): nay chọn đúng 10:00 giờ chi nhánh. Bài "ngân sách yêu cầu" đếm theo cửa sổ một phút cố định nên chờ cửa sổ còn chỗ (đã thử hai lần liền sau khi sửa; vòng chạy đầy đủ chỉ hỏng đúng bài này một lần vì vắt qua ranh giới phút).
- **Đổi duy nhất một bài cũ có chủ đích:** bài P6-11 "phí giao hàng không bao giờ cộng điểm" dựng hóa đơn ONLINE bằng cách tắt trigger; Đợt 4 cấm hóa đơn online không có đơn hàng. Bài đó chuyển sang `skip` có ghi lý do, và kiểm tra tương tự trên đường online thật (`online.loyalty.integration.test.ts`: phí 30.000, điểm 200 trên 200.000 hàng). Bài `public-products` được nới đúng một điểm (id biến thể là chìa khóa giỏ hàng, OQ-91).
- Hai lỗi thật tìm được khi xây và đã sửa: ba đường `POST` rỗng bị `ValidationPipe` từ chối (web báo); quyết toán giao thất bại lúc worker chưa ghi bán kho trả 503 (nay `REFUND_STOCK_PENDING`, có bài).

## Diễn tập trên cơ sở dữ liệu giống thật (`.local/w4-rehearsal.sh`)

Nguồn: 95 migration, 66 quyền, 20.000 hóa đơn trả tiền, 300.000 thông báo. Sao lưu `pg_dump -Fc` 7 giây (45 MB); `pg_restore` 11 giây, thoát 0; `db:deploy` 7 giây tổng (sáu migration: 0,04 / 0,04 / 0,68 / 0,22 / 0,15 / 0,28 giây); quyền 66 (0 thêm); "Bán online" tắt; 0 đơn online; 0 chiến dịch. Quay lui: xem `PHASE6_WAVE4_ROLLBACK_PROOF.md`.

## Đo tải và bảo mật

`PHASE6_STEP22_ONLINE_LOAD_SECURITY.md`: một tiến trình API đủ (khoảng 8 lượt đặt hàng mỗi giây, mọi bất biến đúng, 20 kiểm tra bảo mật đạt). Lệnh chạy lại: `node scripts/load-online.mjs --db <cơ sở dữ liệu *_scratch> --customers 100 --concurrency 30 --spread`.

## Chưa làm / còn rủi ro (nói thẳng)

- Cổng PayOS thật (chỉ có bộ giả lập), web cũ và pm2 trên máy chủ Linux thật, và giao hàng qua hãng thật chưa thử; đơn thử đầu tiên ở Bước 9 của hướng dẫn là để thử những chỗ đó.
- Bốn màn chiến dịch chưa mở ảnh trong cổng giao diện (danh sách và bộ chọn ở 1440 tối sau lần sửa cuối; hai tab "Hiển thị" và "Thông tin" ở 768); màn xử lý đơn: ảnh của đơn đã giao và hộp thoại quyết toán nền tối là trước lần dựng cuối, và ảnh 130% của hàng đợi chưa dựng lại sau khi bớt cột. Kiểm DOM của các hộp thoại chiến dịch còn hai điểm do bộ ngăn kéo của bộ giao diện.
- Cột "Chưa trả" không có trong hàng đợi online (hợp đồng không có nhóm này).
- Mọi cách hiểu kỹ thuật W4-1 đến W4-12 **chờ Chủ xem lại** (cuối `PHASE6_OWNER_DECISIONS_VI.md`).
