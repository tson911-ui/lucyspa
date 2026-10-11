# Phase 9 P9-4: quét mẫu và ảnh nhà cung cấp (ảnh không bao giờ lẫn giữa các sản phẩm)

Trạng thái: **làm xong, chưa deploy.** Căn cứ: `docs/PHASE9_PRODUCT_IMPORT.md` (mục 7, 10) và yêu cầu của chủ: ảnh chỉ lấy từ chính bản ghi của sản phẩm đó, lưu cùng mã sản phẩm nguồn và địa chỉ, kiểm tra lúc tải, trùng thì cắm cờ cho cả hai bên và **không bao giờ tự gán**. Chỉ làm phía máy chủ (quét do API xếp hàng, worker chạy); màn hình duyệt là P9-6.

## Đã làm gì

- **Quét mẫu thủ công:** `POST/GET /supplier-sources/:id/scans` (`MANAGE_SUPPLIER_SOURCES`; nguồn phải đang bật, `READY`, giấy phép còn xác nhận). Worker nhận lần quét (thuê 3 phút, gia hạn khi chạy), đọc robots.txt, **tối đa 20 sản phẩm** (cơ sở dữ liệu cũng chặn sản phẩm thứ 21 của một nguồn). Lần đầu: trang đầu của danh sách; quét lại: chỉ đọc lại đúng các sản phẩm đã biết. Mỗi sản phẩm thành bản ghi nguồn + giá tham khảo (chỉ thêm, không bao giờ vào giá vốn hay giá bán) + ứng viên tối thiểu (tên EN = tên VI, đánh dấu cần dịch). Không có quyền chữ thì chỉ lưu tên và mã; không có quyền ảnh thì không gửi yêu cầu ảnh nào.
- **Ảnh (tối đa 6 mỗi sản phẩm):** (1) chỉ từ `images[]` của chính sản phẩm; (2) **đọc lại đúng mã sản phẩm** (`include`) lúc tải, ảnh phải có trong lần đọc lại đó, không thì không tải và báo `IMAGE_PROVENANCE_MISMATCH`; (3) tải qua kết nối an toàn, kiểm tra byte đầu và giải mã bằng quy trình ảnh chung (chuyển từ API sang `packages/server`, API dùng lại); (4) lưu cùng mã sản phẩm nguồn, địa chỉ, sha256, mã băm hình, giờ kiểm tra; (5) ảnh biến thể nằm trên biến thể của nó (`variant_key`, bản ghi biến thể phải nêu đúng sản phẩm cha); ảnh giả của WooCommerce không phải ảnh.
- **Cơ sở dữ liệu giữ luật:** khóa kép (ứng viên, bản ghi nguồn) → `candidate_sources`, nên ảnh **chỉ nằm trên ứng viên sở hữu sản phẩm nó được đọc từ**; mã sản phẩm phải khớp bản ghi; mỗi vị trí/tệp một lần trong số ảnh đang dùng; ảnh bất biến (chỉ cờ và việc ngưng dùng), không xóa; ứng viên đã duyệt/từ chối không đổi ảnh. Ảnh nguồn không còn liệt kê thì **ngưng dùng**, không xóa.
- **Cắm cờ, không gán:** cùng tệp (`SAME_FILE`; kể cả tệp mà sản phẩm khác vừa ngưng dùng, nên hai sản phẩm đổi ảnh cho nhau đều bị cờ bất kể thứ tự đọc), ảnh gần giống (`SIMILAR`) trên ứng viên khác cùng nhà cung cấp, hoặc tệp đang dùng cho sản phẩm Lucy (`CATALOG_SAME_FILE`) → cờ ở cả hai phía (số cờ của lần quét đếm ảnh khác nhau, không đếm sự kiện), cảnh báo `IMAGE_SHARED`, ứng viên sang `NEEDS_REVIEW` (P9-5 phải giữ). Ảnh gần giống trong danh mục Lucy **chưa so** (chỉ so đúng tệp).
- **Mã băm hình đổi sau khi thử thật:** mã 64 bit cũ gắn cờ 15/20 ảnh thật (chai trên nền trắng); thử trên 20 ảnh thật chọn mã 256 bit đã cắt lề (hai sản phẩm khác nhau cách ≥ 22 bit, bản nén lại cách 9), ngưỡng **12 bit**. Cặp 323/325 (Skin Softener và Emulsion) gần như cùng một kiểu chai, chỉ khác nhãn, cách 22 bit, không bị cắm cờ.
- **1 migration** (104 → **105**): `20261127000000_phase9_scans_images`. Quyền vẫn **68**. `MEDIA_STORAGE_DIR` của worker lấy từ cùng `.env` với API (không thêm cấu hình); thiếu thì lần quét báo `MEDIA_STORAGE_UNAVAILABLE`. Thư viện ảnh liệt kê ứng viên là nơi dùng ảnh (không xóa được).

## Kiểm thử

Server 106 (5 mới: mã băm, quy trình ảnh, ảnh giả, tên tệp), web 912, api 352, database 112, ui 486, worker 24; tích hợp quét **13/13** trên PostgreSQL thật (ảnh giữ đúng sản phẩm qua quét lại có đảo thứ tự/ẩn sản phẩm; hai sản phẩm đổi địa chỉ ảnh cho nhau; cùng tệp; bản sao gần giống; trùng ảnh danh mục; đọc lại không khớp; biến thể; tối đa 6 ảnh, ảnh giả, tệp hỏng; quyền chữ/ảnh; mẫu 20; ứng viên đã duyệt; robots chặn; mất worker; các chặn của cơ sở dữ liệu), `supplier-source` 18/18, media/sản phẩm/popup/slider 42/42; `lint`, `typecheck`, `format:check` sạch. Rehearsal: bản sao `lucy_spa_dev` 68 → 105 sạch, không lệch ở bảng đụng tới; DB thử đã xóa. **Chạy thật 2 lần** (23 yêu cầu mỗi lần: robots, danh sách, đọc lại, 20 ảnh) qua worker với haruohui.com: 20 ứng viên, 20 ảnh, 0 lỗi.

## UX gate

Không có màn hình mới (phía máy chủ). Chỉ một nhãn mới ở thư viện ảnh ("Nhập từ nhà cung cấp"). DOM audit chạy lại: trang `supplier-sources` 1 phát hiện như P9-2; trang `dashboard` 9 → 11 `list-height-uneven` (dữ liệu scratch: các mục danh sách dài ngắn khác nhau; tính từ mốc P9-2 chỉ 8 tệp web đổi, toàn là màn nguồn nhà cung cấp, thư viện ảnh và từ điển, **không có tệp bảng điều khiển hay bộ UI nào**; chạy lại với worker tắt vẫn 11, nên không phải do worker).

## Em tự đặt, chờ chủ duyệt

Lời duyệt 2026-10-11 của chủ chỉ nêu 7 cách hiểu của P9-6 (và điều bản dịch EN của P9-5); 3 điều dưới đây **chưa** nằm trong đó, vẫn chờ chủ.

1. Ảnh biến thể tính vào 6 ảnh của sản phẩm (ảnh chính trước); biến thể dùng lại ảnh chính thì không thêm.
2. Ngưỡng "gần giống" 12/256 bit và việc cắm cờ cả hai phía; ảnh quá lớn (> 6000 px hoặc 10 MB) hiện chỉ báo lỗi, chưa có bước dùng bản nhỏ hơn.
3. Quét lại chỉ đọc đúng các sản phẩm đã biết (mẫu không tự lớn); sản phẩm không còn trả về chỉ ghi `PRODUCT_NOT_RETURNED`, chưa đánh dấu biến mất (P9-7).

## Triển khai (khi chủ cho phép)

1 migration, khởi động lại API, web và **worker**; `pnpm install` thêm `sharp` cho gói server (đã có trong kho của API).
