# Kịch bản Owner thử Claude Wave B, C, D và quy trình bản nháp mới (khoảng 90 phút, làm trên trang thật sau khi triển khai)

Mục đích: thử từng tính năng mới **theo thứ tự từ ít rủi ro đến nhiều rủi ro**. Mọi tính năng mới **tắt** sau khi cài; bạn bật từng cái ở **Quản trị → Cài đặt AI**. Không có gì lên trang web khi bạn chưa bấm **Áp dụng** hay **Duyệt**.

Cần có: khối lệnh trong `docs/DEPLOY_CLAUDE_WAVES_B_C_D.md` đã chạy xong không `DUNG LAI`, khóa Anthropic đã dán, tài khoản Owner.

## 1. Bản nháp viết lại sản phẩm theo quy trình mới (không cần bật gì thêm)

1. Dòng cuối khối lệnh in **số bài đã sửa miễn phí, số bài cần AI sửa và chi phí**: ghi lại (gửi em).
2. **Danh mục → Viết lại nội dung.** Cột **Lưu ý** ghi "N lưu ý" và "N chỗ đã tự sửa". Mở một bài có "đã tự sửa": thấy hai khung **Lưu ý của hệ thống** (chỉ để tham khảo) và **Đã tự sửa trước khi lưu** (mỗi dòng ghi chỗ nào, sửa tự động hay AI viết lại). **Mong đợi:** nút **Áp dụng** **không** bị khóa vì lưu ý nào.
3. Kiểm tra ba chỗ ở một bản nháp: tiêu đề tìm kiếm ≤ 60 ký tự, mô tả tìm kiếm ≤ 155, có đủ bốn mục (**Công dụng, Thành phần, Cách dùng, Phù hợp với ai**) khi nhà cung cấp có thông tin; **không** có lời đánh giá khách, **không** chữ "khám" (trừ "khám phá"), tên chính thức giữ nguyên. Mục nhà cung cấp không nói gì thì **để trống**, không bịa.
4. Chưa ưng một bài: **Viết lại bản nháp** (menu ⋮ hoặc nút trên đầu), gõ một dòng ví dụ rồi đợi bản mới.
5. **Duyệt nhiều bài:** tích ô vài bài (cột đầu bảng); thanh trên bảng đổi thành "Đã chọn: N" kèm **Bỏ chọn**, **Chọn tất cả (số bài chờ duyệt)** và **Duyệt các bài đã chọn**. Bấm **Duyệt các bài đã chọn**, đọc hộp xác nhận, xác nhận **một lần**. **Mong đợi:** "Đã duyệt N bài"; các bài đó chuyển "Đã áp dụng"; trang khách của chúng có bốn mục mới. **Thử với 2 đến 3 bài trước** rồi mới **Chọn tất cả** (chọn tất cả lấy **mọi** bài chờ duyệt, kể cả trang khác). Nhật ký hoạt động ghi từng sản phẩm và **một** dòng "duyệt hàng loạt".
6. Thử sửa một bản rồi duyệt hàng loạt: bản bạn đã sửa tay **vẫn được duyệt** (ghi "sửa tay"); bản mà sản phẩm đã đổi sau khi viết thì **bị bỏ qua** (báo "không duyệt được").

## 2. Mô tả tìm kiếm và bản tiếng Anh cho dịch vụ, trang chủ (bật "Mô tả tìm kiếm" trong Cài đặt AI)

7. **Cài đặt AI:** bật công tắc **Mô tả tìm kiếm và tiếng Anh** (cần AI đang bật và đã nhập tỷ giá). **Danh mục → Mô tả tìm kiếm → Tạo bản nháp**: chọn "Mọi dịch vụ chưa có mô tả tìm kiếm", xem **chi phí tối đa**, tạo.
8. Mở một bản nháp: **mô tả tiếng Việt** (≤ 155 ký tự), **mô tả tiếng Anh**, và (nếu dịch vụ chưa có tiếng Anh) **văn bản tiếng Anh**. Chữ tiếng Việt của tiệm **không** bị đổi. Sửa, **Áp dụng** (khung **Lưu ý của hệ thống** chỉ để tham khảo, **không** khóa nút Áp dụng). Mở trang dịch vụ ở trang khách: thẻ mô tả khi chia sẻ/tìm kiếm là chữ vừa áp dụng. Trang **tiếng Anh** của dịch vụ chỉ được Google lập chỉ mục **sau khi** bản tiếng Anh được áp dụng.

## 3. Trợ lý hỏi đáp về báo cáo (bật "Trợ lý hỏi đáp về báo cáo", cấp quyền "Dùng trợ lý AI")

9. **Cài đặt AI:** bật **Trợ lý hỏi đáp về báo cáo** (mô hình mặc định Sonnet 5.5). **Vai trò:** cấp **Dùng trợ lý AI** cho một người quản lý đã có quyền xem Doanh thu. (Owner có sẵn.)
10. **Báo cáo → Doanh thu:** đầu trang có khung **Hỏi trợ lý**. Hỏi "Doanh thu tháng này thế nào so với tháng trước?" **Mong đợi:** câu trả lời ngắn, nêu **đúng khoảng ngày** đã dùng, đúng **con số trên báo cáo** (đối chiếu từng số), kèm nút **Mở báo cáo**. Trợ lý **không tự tính số mới**: mọi số lấy từ báo cáo.
11. Thử câu khó: "Lương của chị Hoa tháng này?" hoặc "Số điện thoại khách VIP?" **Mong đợi:** trợ lý nói chỉ trả lời được số liệu tổng hợp, **không** đưa lương từng người, tên hay số điện thoại khách. Thử một câu không liên quan ("thời tiết hôm nay"): một câu từ chối lịch sự.
12. Đăng nhập người quản lý **không** có quyền xem **Lợi nhuận**: hỏi "Lợi nhuận tháng này?" **Mong đợi:** trợ lý nói số liệu này không có cho bạn. Người **không có** quyền "Dùng trợ lý AI" **không thấy** khung hỏi.
13. Xem chi phí: **Cài đặt AI → Chi phí tháng này** (mỗi câu hỏi khoảng 1.000 đến 2.500 đồng). Câu hỏi và trả lời được lưu **30 ngày** rồi chỉ còn ghi nhận ai hỏi và tốn bao nhiêu.

## 4. Chat trên website (cần nối n8n trước: `docs/N8N_BOT_DATA_GUIDE.md` mục D)

14. Làm đủ mục D của hướng dẫn n8n (webhook `lucy-chat`, hai biến `.env`, khởi động lại API). **Cài đặt AI:** bật **Chat với Lucy trên website**, trần **300 tin mỗi ngày**. **Vai trò:** cấp **Xử lý yêu cầu gọi lại** cho người sẽ gọi khách.
15. Mở trang chủ (cửa sổ ẩn danh), bấm nút liên hệ nổi → **Chat với Lucy**. Đọc dòng chào (**bản tạm, chỉ thử nội bộ; luật sư xem trước Phase 10**). Hỏi 5 câu: giá một dịch vụ, giờ mở cửa, khuyến mãi, một sản phẩm, giờ trống ngày mai. **Mong đợi:** trả lời đúng số liệu của tiệm; khi bot đưa giờ cụ thể có nút **Đặt lịch giờ này** mở đúng trang đặt lịch (`/vi/account/book?...`), khách đăng nhập rồi tự xác nhận.
16. **Thử bot hỏng:** tắt workflow `Lucy Chat Web` trong n8n một phút, gửi tin. **Mong đợi:** khung hiện **"Để lại số điện thoại, tiệm sẽ gọi lại"**. Điền số thật của bạn, tích đồng ý, gửi. **Quản trị/Vận hành → Yêu cầu gọi lại:** thấy yêu cầu mới (người có quyền còn nhận thông báo, **không** hiện số trong thông báo). Bấm **Đã gọi**, rồi **Đóng yêu cầu**. Bật lại workflow.
17. Gửi 9 tin liên tiếp trong 1 phút: từ tin thứ 9 khung báo "bạn gửi hơi nhiều, đợi một lát".

## 5. Thẻ khách và gợi ý mỹ phẩm cho KTV (**chỉ thử nội bộ**; luật sư sẽ xem lời chào chat và việc dùng dữ liệu trước Phase 10, đã ghi vào danh sách Phase 10)

18. Khi đã sẵn sàng: **Cài đặt AI:** bật **Tóm tắt khách, gợi ý sản phẩm**. **Vai trò:** cấp **Xem thông tin khách** cho một KTV **theo chi nhánh** của KTV đó.
19. Đăng nhập KTV có một khách đã đến từ trước (khách có tài khoản, có ghi chú của nhân viên). **Dịch vụ của tôi:** ở thẻ dịch vụ của khách, menu ⋮ → **Thông tin khách**. **Mong đợi:** ngăn bên phải: **Từ các lượt trước** (số lượt, lần gần nhất, người phục vụ lần trước, khoảng cách giữa các lần, dịch vụ hay dùng, mỹ phẩm đã mua), **Ghi chú của nhân viên** (2 đến 3 dòng chỉ nhắc lại điều nhân viên đã ghi, ghi rõ do AI viết) và **Gợi ý nói chuyện về mỹ phẩm** (tối đa 3, chỉ để tham khảo). Không có tên hay số điện thoại khách.
20. KTV **khác** (không được phân công khách này), hoặc khách đã xong/hủy: **không** mở được thẻ. **Quản trị → Nhật ký hoạt động**, tìm "Xem thông tin khách": mỗi lần mở đều có một dòng (ai, dịch vụ nào, không có nội dung).

## Gửi lại cho em

- Ba con số của bước 1 (miễn phí / AI / chi phí) và ảnh một bản nháp có "Đã tự sửa".
- Câu trả lời của trợ lý ở bước 10 và 11 (đúng/sai số, có trả lời quá phạm vi không).
- Kết quả bước 15 và 16 (chat đúng không, mẫu để lại số hiện đúng lúc không).
- Ý kiến của luật sư về lời chào chat và về thẻ khách.
