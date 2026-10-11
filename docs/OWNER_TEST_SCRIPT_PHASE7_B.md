# Kịch bản Owner thử lương, hoa hồng, tip và tạm ứng (Phase 7 Đợt B) trên máy thật

Làm **sau khi** Đợt A đã chạy (sổ quỹ đã bắt đầu, `docs/OWNER_TEST_SCRIPT_PHASE7_A.md`) và Claude báo triển khai Đợt B xong (`docs/DEPLOY_PHASE7_WAVE_B.md`). Mất khoảng 60 phút. Đăng nhập tài khoản Owner. **Chưa có gì tự trả tiền**: mọi bước tạo tiền ra khỏi quỹ đều do chính Owner bấm và nhập lại mật khẩu. Bước 9 và bước 12 là **việc thật** (chốt bảng lương, trả lương); nếu chỉ muốn thử, làm ở một tháng chưa có người thật hoặc dừng trước các bước đó.

## Chuẩn bị (10 phút)

1. **Quản trị → Vai trò:** gán `MANAGE_PAY_RULES` (đặt tiền tour, hoa hồng, mã nhân viên), `MANAGE_PAYROLL` (làm bảng lương, tạm ứng) cho người của bạn; `APPROVE_PAYROLL` (chốt, trả, duyệt tạm ứng) **chỉ Owner**. Owner không cần gán gì.
2. **Nhân sự → Lương và hoa hồng → Lương cơ bản:** với **từng nhân viên chính thức**, bấm `⋮` → **Ghi mức lương mới** (lương theo tháng, từ ngày hôm nay hoặc ngày trong 62 ngày trước). Ai chưa có mức này hiện "Chưa xác nhận" và **chặn chốt bảng lương**.
3. Tab **Tiền tour**: đặt tiền tour cho từng dịch vụ (số 0 nghĩa là dịch vụ đó không trả tour; dịch vụ chưa đặt thì không phát sinh tiền). Tab **Hoa hồng → Thêm quy tắc**: ví dụ "Cả cửa hàng, 5%". Tab **Mã nhân viên**: bấm **Tạo mã** cho người được nhận hoa hồng đơn online.

## Tour, hoa hồng, tip trong ngày

4. Làm **một hóa đơn dịch vụ** và **một hóa đơn bán sản phẩm** (có người bán) rồi thu tiền. Mở từng hóa đơn: cuối trang có thẻ **Tiền tour và hoa hồng** (chỉ người có quyền lương thấy) với khoản vừa phát sinh. Hoàn tiền một phần sản phẩm: hoa hồng giảm đúng phần đó, hiện thành một dòng âm.
5. **Tip do khách chọn** (tiền mặt không ghi vào hệ thống). Mở một hóa đơn dịch vụ **chờ thanh toán**, bấm **Tạo mã QR PayOS**, nhập số tiền, **Tiếp tục**: màn **Thêm tip** dành cho khách. Một KTV: chỉ hiện KTV đó. Nhiều KTV: hiện từng người, khách chọn người nhận và số tiền từng người (Không / 20.000 / 50.000 / 100.000 / Khác). Chọn tip rồi **Tạo mã QR**. _Mong đợi:_ thẻ chờ ghi "Ghi nhận X, Tip Y, Khách chuyển X+Y"; khách chuyển **một lần** đủ X+Y. Khi PayOS xác nhận: hóa đơn **đã thanh toán đúng X**; thẻ **Tip của khách** có tip cho từng KTV; Sổ quỹ có "Nhận tip của khách" ở quỹ ngân hàng; hóa đơn **không đổi** (không doanh thu, không điểm, không hoa hồng). Nếu khách chỉ chuyển X (thiếu tip) thì PayOS báo sai số tiền, **không ghi gì**. Chỉ **Chủ** (quyền duyệt lương) mới thấy **Hoàn tác tip** (có lý do), nhân viên thu ngân thì không.
6. Đơn **online**: đặt hàng ở trang khách, ô **Mã nhân viên giới thiệu**, nhập mã đã tạo; mã sai báo "Mã nhân viên chưa đúng". Thu tiền đơn: hoa hồng thuộc về người có mã.
7. **Thu nhập của tôi** (đăng nhập bằng một nhân viên): thấy tiền tour, hoa hồng, tip của mình trong ngày/tuần/tháng; đó là số **ghi nhận**, chưa phải lương đã trả.

## Bảng lương của tháng

8. **Nhân sự → Bảng lương → Tạo bảng lương**, chọn tháng. _Mong đợi:_ bản nháp có lương cơ bản, tour, hoa hồng, tiền công CTV, tip (tip ở cột riêng, **không nằm trong thực lãnh**). Phần **Cần xem trước khi chốt** nêu người chưa có lương cơ bản, CTV chưa thỏa thuận tiền công, ngày có chênh lệch đếm quỹ (chỉ tham khảo, không trừ lương). Thêm một **Thưởng** và một **Khấu trừ** có lý do; thử hủy một khoản (bắt buộc lý do; khoản đã nhập không sửa được). **Chọn ngày trả lương.** Bấm **Làm mới bản nháp** sau khi có hóa đơn mới.
9. **Chốt bảng lương** (nhập lại mật khẩu). _Mong đợi:_ bảng lương hiện "Đã chốt", **chưa ai được trả**; từng người có phiếu lương "Chưa trả". Từ lúc này không thêm hay sửa được gì trong bảng lương đó; tour, hoa hồng, tip của tháng bị khóa. Một khoản sửa sau (ví dụ hoàn tiền muộn) sẽ vào **bảng lương tháng sau** dưới dạng khoản âm.
10. Mở **Phiếu lương** của một người: thấy các khoản, thực lãnh, tip ở dòng riêng; bấm **In phiếu lương** (chỉ in phiếu, không in menu). Nhân viên đăng nhập vào **Phiếu lương của tôi** thấy đúng phiếu của mình, không thấy của ai khác.

## Trả lương (từ ngày trả trở đi)

11. Trước ngày trả: nút **Trả lương** báo "Chưa đến ngày trả". Đến ngày: **Trả lương**, chọn quỹ (số dư hiện bên cạnh), chọn tất cả hoặc từng phiếu, nhập lại mật khẩu. _Mong đợi:_ Sổ quỹ có **hai dòng chi riêng** cho mỗi người: "Trả lương" (thực lãnh) và "Trả tip cho nhân viên"; phiếu thành "Đã trả"; trả hết thì bảng lương thành "Đã trả". Quỹ tiền mặt không đủ thì báo "Quỹ không đủ tiền".
12. Thử **Hoàn tác việc trả** một phiếu (với lý do): sổ quỹ có bút toán điều chỉnh, phiếu thành "Đã hoàn tác"; bảng lương **không mở lại** (khoản phải trả lại thêm bằng điều chỉnh ở bảng lương kỳ sau).

## Tạm ứng lương

13. **Nhân sự → Tạm ứng lương → Tạo yêu cầu tạm ứng:** chọn một nhân viên (chỉ hiện người chính thức, đã có lương cơ bản xác nhận, chưa có khoản đang mở; số tiền tối đa là **một nửa lương tháng**). Nhập quá mức: báo "Tạm ứng tối đa một nửa lương cơ bản tháng".
14. Dòng vừa tạo: `⋮` → **Duyệt** (chưa chi tiền) → **Chi tiền** (chọn quỹ, nhập lại mật khẩu). _Mong đợi:_ Sổ quỹ có dòng "Chi tạm ứng lương". Bảng lương kế tiếp **tự gợi ý thu hồi** khoản này, không bao giờ làm thực lãnh âm; phần chưa thu hết còn nợ sang kỳ sau. Chỉ Owner **Xóa nợ** phần còn lại (lý do + mật khẩu; không có tiền nào di chuyển).

## Điều không làm trong buổi thử

- Không chốt một bảng lương tháng thật chỉ để thử: chốt xong là khóa, không mở lại.
- Không tạo mã nhân viên cho người sắp nghỉ; mã cũ không bao giờ dùng lại.
- Chưa có xuất Excel/PDF phiếu lương (Phase 8); in bằng nút **In phiếu lương** của trình duyệt.
