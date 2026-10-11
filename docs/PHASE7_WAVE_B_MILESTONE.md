# Phase 7 Đợt B (lương, hoa hồng, tip, tạm ứng): mốc hoàn tất

Ngày 2026-10-12. Đợt B được xây xong phía mã, **chưa triển khai**. Đợt A (sổ quỹ) ở `docs/PHASE7_WAVE_A_MILESTONE.md`.

## Đã làm (mỗi bước một báo cáo trong `docs/`)

| Bước   | Nội dung                                                                                                                          | Migration |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P7-8   | Lương cơ bản theo ngày hiệu lực, tiền tour theo dịch vụ, quy tắc hoa hồng (tất cả rỗng, chỉ thêm), chọn quy tắc cụ thể nhất       | 111       |
| P7-9   | Máy tính tiền tour và hoa hồng theo trạng thái hóa đơn (bất biến, đảo bằng dòng âm, hoàn tiền theo tỷ lệ), đổi người bán có lý do | 112       |
| P7-10  | Tip tách khỏi hóa đơn, vào sổ quỹ cùng giao dịch, hoàn tác bằng dòng âm                                                           | 113       |
| P7-10b | Mã nhân viên cho đơn online (Owner tạo, đổi mã, khóa trên đơn), hoa hồng cho người có mã                                          | 114       |
| P7-11  | Màn Lương và hoa hồng (4 tab), thẻ tip và thẻ tiền tour/hoa hồng trên hóa đơn, "Thu nhập của tôi"                                 | -         |
| P7-12  | Bảng lương tháng: bản nháp, xem trước, làm mới, ngày trả, khoản thưởng/điều chỉnh/khấu trừ                                        | 115       |
| P7-13  | Tạm ứng lương: yêu cầu, duyệt, chi (mật khẩu, quỹ), thu hồi trong bảng lương, xóa nợ                                              | 116       |
| P7-14  | Chốt bảng lương (mật khẩu, khóa nguồn), phiếu lương, trả lương (hai khoản chi riêng), hoàn tác, phiếu lương của tôi               | 117       |
| P7-15  | Màn Bảng lương, phiếu lương (in), Tạm ứng lương, Phiếu lương của tôi                                                              | -         |

## Kiểm tra toàn bộ (2026-10-12)

- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` (toàn bộ gói: 141 + 153 + 24 + 489 + 972 + 355 kiểm thử), `pnpm test:integration` trên cơ sở dữ liệu mới (151 + 23), tích hợp API (hai tiến trình: phần chính 937 và phần Phase 7 91 kiểm thử), kiểm DOM các trang mới, ảnh chụp 360/768/1440 sáng + 1440 tối + chữ 130%.
- **Sự cố đã gặp và sửa:** bộ tích hợp API chạy trong một tiến trình hết bộ nhớ (4 GB) sau khoảng 940 kiểm thử; các kiểm thử Phase 7 nay chạy ở tiến trình thứ hai (`scripts/test-phase7-integration.mjs`). Máy tính lương không nhìn thấy quy tắc nhập sau khi bán và chỉ xử lý 200 hóa đơn mới nhất: đã sửa (duyệt từng trang, nhận biết quy tắc đổi).
- Chưa chạy: `pnpm smoke` (cần cả hệ thống chạy thật), kiểm thử với tài khoản nhân viên thường cho "Phiếu lương của tôi" trên giao diện.

## Giữ nguyên các quyết định của Owner (`PHASE7_PAYROLL_FUNDS.md` mục 14)

Hoa hồng online chỉ qua mã nhân viên; tip trả cùng ngày trả lương và tách khỏi doanh thu, điểm, hoa hồng; ngày bắt đầu là một cài đặt không có mặc định; mọi việc trả tiền hoặc đổi số tiền cần Owner bấm và nhập lại mật khẩu (đã chọn phương án an toàn hơn: chặn chốt khi lương cơ bản chưa xác nhận hoặc thực lãnh âm; chỉ gợi ý thu hồi tạm ứng; không tự tạo mã nhân viên; không tự nhập bù).

## Chờ Owner

- Đọc `docs/DEPLOY_PHASE7_WAVE_B.md` (một khối lệnh cho cả Đợt A và B) và `docs/OWNER_TEST_SCRIPT_PHASE7_B.md`.
- OQ-P7-10a: thời hạn 7 ngày để ghi tip sau khi thu tiền (mặc định đang là 7).
- Trả lời các điểm khác biệt đã ghi trong từng báo cáo (không có điểm nào cần quyết trước khi triển khai).
