# Vì sao 77 bản nháp vẫn "cần AI sửa" ngay sau khi đã sửa (chẩn đoán, 2026-10-13)

Trạng thái: **chỉ đọc mã và chạy thử trên chữ giả; chưa đụng máy chủ, chưa sửa mã.** Cần Owner duyệt hướng sửa (mục 4) trước khi làm. Không chạy thêm lần sửa trả phí nào cho tới khi Owner quyết.

## 1. Số liệu cần đọc cho đúng

- `repaired=163` **không** có nghĩa là 163 bài đã hết lỗi. Nó chỉ đếm số bài mà mô hình **trả về chữ khác** với chữ cũ. Lệnh không đếm số bài còn lỗi **sau** khi sửa; bản chạy lại miễn phí mới là con số đó (`needRepair=77`).
- `needRepair` trong bản chạy có `--repair` (165) là số bài lỗi **trước** khi sửa, không phải sau.
- `fixedFree=20`, rồi `fixedFree=12` ở các lần chạy sau: toàn bộ nằm trong nhóm bài còn lỗi (165 và 77 đã gồm chúng). Tức là lần chạy miễn phí **vẫn đổi chữ** của chính những bài chưa sửa được.

## 2. Nguyên nhân tìm được (mã, đã tái hiện bằng chữ giả; kịch bản thử nằm trong `.local/`, không đưa lên kho)

**Nguyên nhân A: bộ kiểm tra bắt nhầm, cụm cấm được so theo "chứa chuỗi", không theo từ.**

- `cure` khớp **Manicure, Pedicure, Secure**; `permanent` khớp **Semi-permanent** (sơn gel, thuốc nhuộm); `100%` khớp tên như "100% Pure Argan Oil"; `treat ` khớp "...mistreat ".
- Tên chính thức của sản phẩm (nameEn, tiêu đề SEO, mô tả) chứa các chữ đó nên bị báo `FORBIDDEN_PHRASE`. Đây là sản phẩm móng, tóc: có thể chiếm phần lớn 77 bài (chưa có số liệu thật để khẳng định; truy vấn mục 3 sẽ cho biết).

**Nguyên nhân B: bước sửa miễn phí xóa trắng trường chứa tên chính thức, và còn "ghi đè" kết quả.**

- Với trường dính cụm cấm, bước sửa miễn phí bỏ cả câu; tên sản phẩm chỉ có một "câu" nên trường thành **rỗng**. Quy tắc nội bộ coi "rỗng" là không tệ hơn "có lỗi", nên chấp nhận. Chạy thử: `nameEn`, tiêu đề SEO tiếng Việt và mô tả SEO tiếng Anh bị **xóa trắng**, và còn một lỗi `FORBIDDEN_PHRASE` ở tiêu đề SEO tiếng Anh.
- Lệnh sửa AI chép lại tên chính thức (đúng yêu cầu "giữ tên"), nên lỗi vẫn còn; sau đó bước miễn phí **xóa trắng lần nữa** trước khi lưu. Vì vậy mỗi lần chạy miễn phí lại báo `fixedFree` cho đúng những bài này. Bản nháp lưu **có trường rỗng** (nameEn, tiêu đề SEO, mô tả SEO).
- **Rủi ro thật:** "Duyệt" ghi nguyên bản nháp lên sản phẩm (từ khi cảnh báo không còn chặn). **Đừng bấm "Chọn tất cả" / "Duyệt các bài đã chọn"** cho tới khi sửa xong; duyệt từng bài đã đọc thì an toàn.

**Nguyên nhân C: quy tắc sửa AI cho thành phần mâu thuẫn với bộ kiểm tra.**

- Lời nhắc bảo "viết thành **một câu ngắn**", còn bộ kiểm tra chỉ chấp nhận danh sách phân tách bằng dấu phẩy chỉ gồm tên thành phần (chữ "Thành phần gồm ..." hay "Sản phẩm chứa ..." bị báo `INGREDIENT_ADDED`). Chạy thử xác nhận: danh sách thuần qua, câu văn không qua.

**Có thể còn (chưa kiểm chứng được nếu thiếu dữ liệu thật):** tiêu đề quá 60 ký tự mà thiếu thương hiệu (không rút gọn được), `EMPTY_FIELD` của "Phù hợp với ai" khi mô hình trả null, `WRONG_LANGUAGE` ở chữ ngắn. Truy vấn mục 3 sẽ cho thấy.

**Lệch phụ (không gây 77 bài):** bước miễn phí chỉ ghi lại danh sách lưu ý khi chữ có đổi; bài không đổi giữ danh sách lưu ý cũ (có thể gồm lưu ý của bộ kiểm tra cũ đã sửa). Màn hình có thể hiện lưu ý mà lệnh chạy lại không còn thấy.

## 3. Truy vấn chỉ đọc để chạy trên máy chủ (không ghi, không gọi AI, không tốn tiền)

Dán nguyên khối vào terminal máy chủ. Các số trong cột phản ánh **lưu ý đã lưu** (đúng với mọi bài đã được sửa AI hoặc đã đổi ở lần chạy miễn phí; có thể cũ với bài không đổi, xem "lệch phụ").

```bash
(
set -u
q() { printf '%s\n' "$1" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d lucy_spa_dev'; }
echo "--- 1. Lỗi còn lại theo mã và trường (số bài chờ duyệt, chưa sửa tay)"
q "select w->>'code' as ma, coalesce(w->>'field','') as truong, count(distinct i.id) as bai from ai_items i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code' in ('CLINIC_WORD','FORBIDDEN_PHRASE','AUTHENTICITY_CLAIM','TESTIMONIAL','URL_OR_CONTACT','MARKUP_OR_EMOJI','INJECTION_SIGN','SEO_TITLE_LONG','SEO_DESCRIPTION_LONG','WRONG_LANGUAGE','EMPTY_FIELD','BRAND_CHANGED','SUITABILITY_CONDITION','INGREDIENT_ADDED') group by 1,2 order by 3 desc, 1, 2"
echo "--- 2. Số bài có ít nhất một lỗi còn lại"
q "select count(distinct i.id) as bai_con_loi from ai_items i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code' in ('CLINIC_WORD','FORBIDDEN_PHRASE','AUTHENTICITY_CLAIM','TESTIMONIAL','URL_OR_CONTACT','MARKUP_OR_EMOJI','INJECTION_SIGN','SEO_TITLE_LONG','SEO_DESCRIPTION_LONG','WRONG_LANGUAGE','EMPTY_FIELD','BRAND_CHANGED','SUITABILITY_CONDITION','INGREDIENT_ADDED')"
echo "--- 3. Cụm cấm bị bắt (FORBIDDEN_PHRASE) theo chữ khớp"
q "select coalesce(w->>'detail','') as chu_khop, count(distinct i.id) as bai, (array_agg(distinct p.name_vi))[1:3] as vi_du from ai_items i join products p on p.id = i.target_id cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code'='FORBIDDEN_PHRASE' group by 1 order by 2 desc"
echo "--- 4. Trường đang RỖNG trong bản nháp đã lưu (bằng chứng của việc xóa trắng)"
q "select v.truong, count(*) as bai_rong from ai_items i cross join lateral (values ('nameEn', i.draft->>'nameEn'), ('seoTitleVi', i.draft->>'seoTitleVi'), ('seoTitleEn', i.draft->>'seoTitleEn'), ('seoDescriptionVi', i.draft->>'seoDescriptionVi'), ('seoDescriptionEn', i.draft->>'seoDescriptionEn'), ('descriptionVi', i.draft->>'descriptionVi'), ('descriptionEn', i.draft->>'descriptionEn'), ('suitableForVi', i.draft->'sectionsVi'->>'suitableFor'), ('suitableForEn', i.draft->'sectionsEn'->>'suitableFor')) v(truong, gia_tri) where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and coalesce(btrim(v.gia_tri),'')='' group by 1 order by 2 desc"
echo "--- 5. Bản nháp có tên chính thức chứa chuỗi hay bị bắt nhầm (cure, permanent, 100%, treat)"
q "select count(*) as bai, count(*) filter (where coalesce(btrim(i.draft->>'nameEn'),'')='') as ten_anh_rong from ai_items i where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and lower(i.base_snapshot->>'nameVi') ~ '(cure|permanent|100%|treat)'"
echo "--- 6. Mười bài còn lỗi nặng nhất (tên, mã lỗi)"
q "select left(i.base_snapshot->>'nameVi', 60) as ten, string_agg(distinct w->>'code', ', ') as ma_loi from ai_items i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code' in ('CLINIC_WORD','FORBIDDEN_PHRASE','AUTHENTICITY_CLAIM','TESTIMONIAL','URL_OR_CONTACT','MARKUP_OR_EMOJI','INJECTION_SIGN','SEO_TITLE_LONG','SEO_DESCRIPTION_LONG','WRONG_LANGUAGE','EMPTY_FIELD','BRAND_CHANGED','SUITABILITY_CONDITION','INGREDIENT_ADDED') group by i.id, 1 order by count(distinct w->>'code') desc, 1 limit 10"
)
```

Gửi Claude toàn bộ kết quả. Mục 1 là "số lỗi theo mã" Owner yêu cầu; mục 4 và 5 xác nhận nguyên nhân B.

## 4. Hướng sửa đề nghị (chờ Owner duyệt; không có migration, không tốn tiền AI để làm)

1. **So khớp cụm cấm theo từ nguyên, không theo chuỗi con** (`cure` không khớp "manicure"; `permanent` không khớp "semi-permanent"), và **bỏ qua cụm nằm trong tên chính thức** của sản phẩm (tên, thương hiệu) khi bài đó là tên. Áp cho cả bộ kiểm tra lẫn bước sửa miễn phí.
2. **Bước sửa miễn phí không bao giờ xóa trắng** một trường bắt buộc (nameEn, tiêu đề, mô tả): nếu bỏ câu làm trường rỗng thì **giữ nguyên chữ cũ** và để lỗi thành mục cho AI. Và `final = fixDraft(...)` sau khi sửa AI cũng theo quy tắc đó.
3. **Sửa quy tắc AI cho thành phần**: "một danh sách tên thành phần phân tách bằng dấu phẩy, không câu văn", khớp với bộ kiểm tra.
4. **Lệnh `ai:fix-pending` in thêm số bài còn lỗi sau khi sửa và đếm theo mã** (hiện chỉ in số trước khi sửa), và ghi lại danh sách lưu ý cho mọi bài (kể cả bài không đổi) để màn hình và lệnh khớp nhau.
5. **Sau khi sửa mã**, chạy miễn phí trước (không tốn tiền) để khôi phục các trường đã bị xóa trắng **chỉ khi có thể**: chữ gốc nằm ở `base_snapshot` và `autoFixes` ghi lại trường nào bị đổi, nhưng chữ cũ không được lưu, nên các bài đã xóa trắng cần **một lần AI viết lại trường đó** (ước tính theo số bài ở mục 4 của truy vấn; mỗi lần sửa khoảng 360 đồng theo số thực tế: 59.211 đồng cho 165 lần).

Câu hỏi cho Owner: duyệt hướng 1 đến 5 (hay bỏ bớt)? Nếu duyệt, em làm một Step nhỏ (có kiểm thử), đẩy lên, và **không** chạy sửa trả phí nào cho tới khi Owner nói.
