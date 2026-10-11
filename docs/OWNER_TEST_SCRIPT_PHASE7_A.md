# Kịch bản Owner thử sổ quỹ (Phase 7 Đợt A) trên máy thật

Làm **sau khi** Claude báo triển khai xong (`docs/DEPLOY_PHASE7_WAVE_A.md`, bản `b11c21e`). Mất khoảng 30 phút. Đăng nhập tài khoản Owner. **Bước 3 là việc thật, làm một lần, không đổi lại được**: chỉ làm vào ngày Owner đã chọn để bắt đầu dùng sổ quỹ, lúc đã đếm tiền thật.

## Chuẩn bị (5 phút)

1. **Quản trị → Vai trò:** gán `VIEW_CASH` và `MANAGE_CASH` cho vai trò quản lý chi nhánh (theo chi nhánh của họ) nếu muốn họ dùng sổ; Owner không cần gán gì. Ai chỉ cần **nộp tiền thu được** thì cần `VIEW_CASH` cộng `COLLECT_PAYMENTS`.
2. Đếm tiền mặt thật ở ngăn kéo và két của từng chi nhánh; xem số dư tài khoản ngân hàng.

## Bắt đầu sổ quỹ (làm một lần)

3. **Thanh toán → Sổ quỹ → Bắt đầu sổ quỹ.** Nhập số tiền mặt đã đếm của từng chi nhánh và số dư ngân hàng, bấm **Bắt đầu**, nhập lại mật khẩu. _Mong đợi:_ trang hiện quỹ tiền mặt từng chi nhánh và quỹ ngân hàng với **số dư đầu kỳ đúng số đã nhập**; dòng "Sổ quỹ bắt đầu lúc …". Từ lúc này mọi khoản thu chi mới được ghi; **trước lúc này không có gì được ghi bù**.

## Thử trong ngày

4. Ở quầy, làm **một hóa đơn thu tiền mặt** (hoặc đợi hóa đơn thật). _Mong đợi:_ vài giây sau, Sổ quỹ của chi nhánh có thêm dòng **"Thu tiền mặt từ hóa đơn"** kèm **mã hóa đơn**; số dư tăng đúng số tiền.
5. **Ghi sổ quỹ → Chi khác**: nhập số tiền và lý do (ví dụ "Mua nước uống"). _Mong đợi:_ dòng mới, số dư giảm. Thử bỏ trống lý do hoặc số tiền: không cho ghi. Thử chi **nhiều hơn số dư**: báo "Quỹ không đủ tiền".
6. Mở menu `⋮` của dòng chi vừa ghi → **Điều chỉnh (hoàn tác)**, nhập lý do. _Mong đợi:_ thêm một dòng ngược lại, dòng cũ vẫn còn và được đánh dấu "Đã điều chỉnh"; số dư về như trước.
7. **Chuyển quỹ:** chuyển một khoản nhỏ từ tiền mặt vào ngân hàng, nhập lại mật khẩu. _Mong đợi:_ hai dòng "Chuyển giữa các quỹ" (một ở mỗi quỹ), số dư hai quỹ đổi đúng.

## Cuối ngày: chốt quỹ

8. Tab **Chốt ngày → Chốt ngày.** Màn hiện tiền đầu ngày, thu, chi và **tiền theo sổ**. Nhập **tiền đã đếm**: nếu đúng bằng số theo sổ thì hiện "Khớp sổ"; thử nhập thiếu 1.000 đồng: hiện "Thiếu" và **bắt buộc ghi lý do**. Nhập số tiền **Chủ rút** (gợi ý sẵn); dòng "Tiền để lại cho ngày sau" tự tính. Bấm **Chốt ngày**, nhập lại mật khẩu. _Mong đợi:_ ngày hiện trong danh sách "Các ngày đã chốt"; chênh lệch (nếu có) là một dòng riêng "Chênh lệch khi đếm quỹ" **và không bị trừ vào lương của ai**; chênh lệch từ 50.000 đồng trở lên hiện nhãn "Lệch lớn" và dòng cảnh báo ở thẻ quỹ.
9. Thử **ghi thêm một khoản vào đúng ngày vừa chốt**: không được (ngày đã khóa); khoản mới tự vào **ngày kế tiếp**. Một hóa đơn thu tiền mặt làm sau khi chốt cũng vào ngày kế tiếp, kèm giờ thật.
10. Tab **Đối chiếu**: chọn chi nhánh và khoảng ngày. _Mong đợi:_ "Khớp: mọi khoản đã vào sổ đúng số tiền"; các cột "Lệch" và "Chưa vào sổ" đều trống.

## Điều không làm trong buổi thử

- Không thử "Chủ rút tiền" bằng số lớn nếu chưa muốn lấy tiền thật ra khỏi quỹ trên sổ (nó được ghi như một khoản chi thật; điều chỉnh được bằng bước 6).
- Lương, tip và hoa hồng **chưa có** (Đợt B). Tip khách đưa hiện chưa ghi vào hệ thống.
