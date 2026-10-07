# Phase 6 P6-3b: "cho đặt trước" và số ngày chờ ở biến thể (Wave 1)

Trạng thái: **làm xong, commit cục bộ, chưa push, chưa deploy.** Căn cứ: quyết định của Chủ ngày 2026-10-07 (thiết kế mục 2.8): T33 đổi (không cân nặng), OQ-30 và OQ-31 duyệt như đề xuất.

## Đã làm gì

- **1 migration nhỏ (tổng 70)**: `20261106000006_phase6_variant_pre_order`. Thêm vào biến thể: `sell_on_order` (mặc định **bật**), `lead_time_days_min`, `lead_time_days_max` (tùy chọn). Thêm vào dòng cài đặt sản phẩm: số ngày chờ mặc định **3 đến 5**. **Không có cân nặng.** Không đụng POS, hóa đơn, thanh toán, điểm.
- **API**: tạo và sửa biến thể nhận 3 trường mới (không gửi khi sửa thì giữ nguyên; khi tạo không gửi thì "cho đặt trước" = bật). Mới: `GET /api/v1/product-settings` và `POST /api/v1/product-settings/edit` (xem: `MANAGE_PRODUCTS` hoặc `MANAGE_PRODUCT_PRICES`; sửa: `MANAGE_PRODUCTS`; phiên bản lạc quan, ghi nhật ký trước/sau). Cùng hàng này sẽ chứa số ngày cảnh báo hết hạn cho P6-4.
- **Màn hình**: hộp "Thêm/Sửa biến thể" có ô **Cho đặt trước** và hai ô "Chờ hàng từ / Đến (ngày)"; bảng biến thể có cột **Đặt trước** (nhãn "Đặt trước · 2-4 ngày" hoặc "Bán sẵn"); nút **Cài đặt** ở đầu trang Sản phẩm mở hộp "Cài đặt sản phẩm" (số ngày chờ mặc định). VI và EN.

## Cách đọc của tôi (chờ Chủ xác nhận)

- OQ-30 nói "mặc định bật đặt theo đơn": cột mặc định **bật**; Chủ bỏ chọn cho hàng cửa hàng giữ sẵn.
- Luật DB do tôi chọn (như P6-2, chờ Chủ có/không): hai ô số ngày cùng có hoặc cùng trống; mỗi ô 1 đến 90; từ ≤ đến. Cùng khoảng cho số ngày mặc định.
- Số ngày là ngày theo lịch (Chủ viết "ngày thường" nhưng không loại chủ nhật, lễ). Tắt "cho đặt trước" thì số ngày riêng bị xóa.

## Kiểm thử (DB thử `lucy_spa_p6_4_scratch_20261007`, 70 migration)

`pnpm format:check`, `lint`, `typecheck` sạch; `pnpm test` cả repo đạt (database 9, server 39, worker 16 + 1 bỏ qua, ui 464, api 257, web 553, gồm 5 test mới); `pnpm test:integration` (database) 101 + 18 đạt; `pnpm test:auth:integration` (API) 644 test, 643 đạt, 1 bỏ qua, 0 lỗi. Mới: `product-preorder.integration.test.ts` (6 test: mặc định, sửa không nhắc trường mới, xóa số ngày, kiểm tra đầu vào, luật DB, cài đặt: quyền, phiên bản, nhật ký), HTTP test (trường lạ như `weightGrams` bị 400), 5 test web, guard cô lập Wave 1 đếm 7 migration. Khung test mới dùng chung: `apps/api/src/testing/phase6-fixture.ts`.

## UX gate (5 dòng)

1. **Đã mở xem**: danh sách sản phẩm (1440 sáng, 768, 360), chi tiết (1440 sáng và tối; cột Đặt trước), hộp Cài đặt (1440 và 360), hộp Thêm biến thể (360, 768, 1440 sáng, 1440 tối), chữ 130% (hộp thêm biến thể, 1440). **Chưa mở**: danh sách ở bản tối, chi tiết ở 768, hộp Cài đặt ở 768 và tối, chữ 130% ở 360. Ảnh trong `.local/uxui-screens/`.
2. DOM audit bằng công cụ riêng (cùng `scripts/uxui-page-audit.js`; kịch bản chính thức `.local/uxui-audit/capture.mjs` không còn trên máy này nên chưa chạy `--compare` với baseline): 3 trang × 4 lần chụp, 0 phát hiện. Cờ "ô 20x20" của hộp chọn giống mọi màn cũ.
3. Sửa sau khi xem: hộp Cài đặt chuyển một cột, lời giải thích nằm sau cả hai ô.
4. Nhãn "Đặt trước" nằm trong ô của bảng, không cạnh tiêu đề (quy tắc 2026-10-05). Không thêm `wf-*`, px/rem, màu hex.
5. Chưa kiểm: trạng thái lỗi 409 của hộp Cài đặt chỉ có test logic, chưa chụp.

## Chưa rõ / cần Chủ quyết

- Ba cách đọc ở trên. Mặc định 3-5 ngày lấy đúng số của Chủ (OQ-31).

## Bổ sung UX gate (2026-10-08)

- Đã mở thêm và xem: trang sản phẩm tối 1440, trang chi tiết 768, ngăn kéo thêm biến thể 768 (ô "Cho đặt trước" và hai ô thời gian chờ), hộp cài đặt 768 và tối. Không thấy lỗi mới. DOM audit chính thức đã tạo lại (`scripts/uxui-audit-capture.mjs`); trang sản phẩm không có phát hiện nào.
