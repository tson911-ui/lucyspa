# Phase 9 P9-7: đồng bộ lại, phát hiện thay đổi, lịch quét theo nguồn, thông báo tóm tắt

Trạng thái: **làm xong, chưa deploy.** Căn cứ: `docs/PHASE9_PRODUCT_IMPORT.md` mục 10 (luật bảo vệ P9-T7 đã duyệt). Có migration `20261129000000_phase9_resync_changes` (106 → **107**); quyền vẫn **68**.

## Đã làm

- **Quét lại và phát hiện thay đổi.** Mỗi lần quét so với dữ liệu đã lưu. Mỗi thay đổi (giá nguồn, nội dung, ảnh, không còn trên nguồn, có lại) thành **một ghi chú** trong bảng mới `source_changes` (chỉ thêm; chỉ được "đánh dấu đã xem" một lần; không sửa, không xóa) cùng trước/sau ngắn gọn. Ghi chú **không đổi gì** ở ứng viên, sản phẩm, giá hay ảnh; chữ của Lucy Spa không bao giờ bị ghi đè.
- **Luật bảo vệ.** Một lần quét **đáng ngờ** (đọc được dưới 70% so với lần quét khỏe gần nhất) hoặc lỗi **chỉ ghi dòng của lần quét**: không ghi bản ghi, không đếm "vắng mặt", không tải ảnh, không thông báo, không đặt nguồn là "vừa đọc xong". Sản phẩm chỉ bị nêu là **không còn trên nguồn** sau **3 lần quét khỏe liên tiếp** không thấy; thấy lại thì đếm lại từ đầu (và ghi chú "có lại" nếu đã nêu). **Không có gì bị xóa, ẩn hay gỡ đăng**. Sản phẩm mà website trả về lỗi riêng không bị tính là vắng mặt.
- **Lịch quét theo nguồn.** Mặc định **Chạy tay** (không bao giờ tự quét). "Hằng tuần" hoặc "Hằng ngày" chỉ chạy **từ 1 đến 5 giờ sáng giờ Việt Nam**, khi nguồn đang bật, `READY`, giấy phép đã xác nhận và **đã được quét tay thành công ít nhất một lần**; cách lần quét gần nhất (kể cả lần lỗi) ít nhất một tuần (hằng tuần) hoặc 20 giờ (hằng ngày); mỗi nguồn một lần quét tại một thời điểm; cùng các cổng như quét tay. Worker nhìn lịch mỗi 5 phút và chỉ xếp hàng một dòng quét.
- **Thông báo tóm tắt** (kiểu mới `SUPPLIER_IMPORT_CHANGES`) trong ứng dụng, gửi cho người giữ `REVIEW_SUPPLIER_IMPORTS`, **chỉ khi lần quét khỏe tìm thấy gì đó**, chỉ có **số đếm** (không tên, không giá, không đường dẫn); người vừa tự bấm quét không nhận. Mở ra màn "Thay đổi".
- **Ảnh không bao giờ chuyển giữa các sản phẩm khi quét lại**: luật P9-4 giữ nguyên; thêm bài kiểm thử trên đường quét theo lịch (ảnh bị đổi chỗ bị cắm cờ hai phía, không gán lại; ứng viên đã quyết định giữ nguyên ảnh; sản phẩm vắng mặt giữ ảnh).
- **Màn hình:** tab **Thay đổi** ở "Duyệt sản phẩm nhập" (bảng 20/trang, lọc chưa xem/đã xem và loại; menu hàng: đánh dấu đã xem, xem sản phẩm nhập, mở trang nguồn; nút "Đã xem hết" cho cả trang). Giá nguồn trong ghi chú chỉ hiện với người giữ `MANAGE_PRODUCT_PRICES` (máy chủ cắt). Ngăn "Quét mẫu" thêm các số mới, trạng thái "Đáng ngờ" và lần quét tự động; mô tả "Lịch kiểm tra" được viết lại (lịch đã chạy thật). Sửa lỗi nhỏ: **chữ trong menu hàng biến mất khi rê chuột lên hàng bảng** (quy tắc hover của hàng ép màu chữ xuống cả menu đang mở; nay menu giữ màu riêng).

## Kiểm thử

Server (đơn vị): luật đáng ngờ / 3 lần / so sánh / lịch. API tích hợp trên PostgreSQL thật, DB mới: **8/8** bài mới (`supplier-source-resync`: ghi chú thay đổi, luật 3 lần, quay lại, đáng ngờ và lỗi, lỗi riêng của sản phẩm, thông báo, lịch, ảnh không chuyển) cùng 42/42 bài P9-2..P9-6 cũ. Web: bài kiểm thử mới cho tab và thông báo. `pnpm test` cả repo, `lint`, `typecheck`, `format:check` sạch. Rehearsal: bản sao `lucy_spa_dev` 68 → 107 sạch (bước 107 mất 0,019 s), không lệch ở bảng và ràng buộc mới; DB thử đã xóa.

## UX gate

Ảnh ở `.local/uxui-screens/p97-*`. **Đã mở và xem:** tab Thay đổi (360, 1440 sáng; 360 với chữ 130%), người duyệt không có quyền giá (1440), menu hàng khi rê chuột (1440, trước và sau khi sửa). Đã sửa sau khi xem: nút trên thanh công cụ tràn ngang ở 360 → nhãn ngắn "Đã xem hết"; dòng chi tiết bị cắt ở thẻ 360 → cho xuống dòng; menu hàng mất chữ khi rê chuột (lỗi có sẵn, Chủ báo). **Chưa xem từng ảnh:** 768, 1440 tối, tiếng Anh, trang 2, bộ lọc rỗng và ngăn quét (đã dựng bằng bài kiểm thử, ảnh đã chụp). DOM audit: `supplier-imports` 0, `supplier-sources` 0 phát hiện, không số nào tăng.

## Em tự đặt, chờ chủ duyệt

1. Lần quét theo lịch không có người: ảnh mới thuộc về **người đã xác nhận giấy phép** của nguồn (giấy phép là điều kiện bật nguồn).
2. Lịch chỉ chạy sau khi nguồn đã được quét tay thành công một lần; từ 1 đến 5 giờ sáng giờ Việt Nam; hằng tuần cách ít nhất 6 ngày 20 giờ, hằng ngày cách ít nhất 20 giờ (mặc định vẫn là Chạy tay; cả hằng tuần và hằng ngày vốn có từ P9-2).
3. Lần quét đáng ngờ **không** đổi trạng thái nguồn hay tắt nguồn; chỉ hiện "Đáng ngờ" ở lần quét. Lần quét lỗi cũng vậy.
4. "3 lần quét khỏe liên tiếp": lần đáng ngờ hoặc lỗi bị bỏ qua, không tính và không làm đếm lại.
5. Thông báo chỉ khi tìm thấy gì đó và chỉ cho lần quét khỏe; lần đáng ngờ hay lỗi không thông báo.
6. "Không còn trên nguồn" chỉ tính trên từng nguồn (hiện chỉ có một nguồn); phần "vắng ở mọi nguồn của nhà cung cấp" chưa làm.
7. Mẫu vẫn tối đa 20 sản phẩm (cơ sở dữ liệu giữ); quét lại chỉ đọc đúng các sản phẩm đã biết.

## Triển khai (khi chủ cho phép)

1 migration (`pnpm db:deploy`), khởi động lại API, web và **worker** (có vòng lặp lịch mới). Quay lại bản cũ: bản cũ vẫn chạy trên cơ sở dữ liệu mới (chỉ thêm bảng, nới ràng buộc thông báo).
