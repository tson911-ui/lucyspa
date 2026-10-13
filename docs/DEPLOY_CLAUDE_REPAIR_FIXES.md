# Hướng dẫn đưa bản sửa lỗi bản nháp viết lại lên máy chủ thật (cụm cấm theo từ nguyên, không xóa trắng trường bắt buộc, sửa dữ liệu đã bị trống, duyệt hàng loạt không còn "xung đột")

Dành cho Owner, không cần rành kỹ thuật. Chỉ có **MỘT khối lệnh** dưới đây. Mở cửa sổ terminal web của iNET đã đăng nhập vào máy chủ, **chép toàn bộ khối** (từ dấu `(` ở dòng đầu đến dấu `)` ở dòng cuối) và dán vào, rồi nhấn Enter. Khối tự kiểm tra từng bước; **khác mong đợi ở bất kỳ chỗ nào là nó in `DUNG LAI` và tự dừng**. Khi thấy `DUNG LAI`: **không chạy lại**, chụp màn hình từ dòng `DUNG LAI` trở lên và gửi cho Claude. Claude **không** đụng tới máy chủ; chỉ Owner chạy lệnh.

**Bản sẽ cài:** commit `04ceaa52fbbdc4ca310a540d53db3aaf336312c1`, đã push lên `main`. Các commit tài liệu đẩy sau đó không đổi mã chạy.
**Bản đang chạy (theo báo cáo của Owner):** `0e60254d28940077e78eb5016b82903ed59d810e` (**134 migration, 82 quyền**).
**Cơ sở dữ liệu:** **không có migration mới, không có quyền mới.** Khối chỉ **sửa dữ liệu** (bước 7, có sao lưu, chạy thử rồi mới ghi, mỗi sản phẩm một dòng nhật ký) và **sửa bản nháp** (bước 8, 9).

**Bản này sửa gì (đúng 8 mục Owner đã duyệt ngày 13/10/2026):**

1. Cụm cấm được so **theo từ nguyên**, không theo chuỗi con: "manicure", "pedicure", "secure", "semi-permanent" không còn bị coi là lời hứa; cụm nằm trong **tên chính thức hoặc thương hiệu** của sản phẩm (ví dụ "100% Pure Argan Oil") không bị coi là cam kết.
2. Bước sửa miễn phí **không bao giờ xóa trắng** một trường bắt buộc (tên tiếng Anh, tiêu đề và mô tả tìm kiếm, hai mô tả); chữ còn nguyên và chuyển cho bước nhờ AI.
3. Luật sửa AI cho thành phần: **danh sách phân tách bằng dấu phẩy**, không còn "một câu".
4. Lệnh `ai:fix-pending` in thêm **số bài còn lỗi sau khi sửa**, **đếm theo mã lỗi** (`codesBefore`, `codesAfter`) và **chi phí ước tính** trước khi tốn tiền.
5. Lưu ý đã lưu của **mọi** bản nháp được làm mới theo bộ kiểm tra hiện tại (không đổi chữ của bản nháp).
6. **Sửa dữ liệu:** lệnh mới `ai:fix-blanked` tìm sản phẩm đã được duyệt mà còn trường rỗng; khôi phục từ giá trị **trước khi duyệt** (nhật ký hoạt động) hoặc từ **tên chính thức**; không dùng AI; không tốn tiền; **chạy thử trước, ghi sau**; ghi nhật ký từng sản phẩm; không đụng bài do người sửa tay, sản phẩm không phải do AI viết, hay sản phẩm đã bị ai đó đổi sau khi duyệt. Trong các mục chữ chỉ khôi phục **"Phù hợp với ai"** (mục Công dụng, Thành phần, Cách dùng có thể để trống đúng ý, và chữ cũ có thể là chữ của nhà cung cấp), nên khối **dừng** nếu bản chạy thử cho thấy lệnh sắp ghi vào mục khác.
7. **Duyệt không còn báo "Dữ liệu vừa được thay đổi ở nơi khác".** Nguyên nhân thật: bản nháp có trường rỗng bị **cơ sở dữ liệu từ chối** (tên tiếng Anh và tiêu đề/mô tả tìm kiếm không được rỗng) và lỗi đó bị gom thành "xung đột"; cả lượt 10 bài cùng hỏng, nên chọn tất cả luôn hỏng còn lô nhỏ đôi khi qua. Giờ: bài không duyệt được bị **bỏ qua kèm lý do** ("Đã bỏ qua N bài: còn trường trống (3), ..."), các bài khác vẫn duyệt; "Chọn tất cả" gửi **một yêu cầu** (máy chủ tự chia từng 10 bài, một dòng nhật ký tổng); sản phẩm chỉ bị **hệ thống** đổi số phiên bản (không đổi chữ nguồn) vẫn duyệt được.
8. Sau cài: **bước 8 kiểm lại mọi bản đang chờ miễn phí**, **bước 9 sửa AI chỉ bài còn lỗi thật**, in số bài và chi phí ước tính **trước khi tốn tiền**, **trần 100.000 đồng** (không hỏi lại). Chạm trần là dừng; bài còn lại giữ nguyên và nằm trong báo cáo.

**Khối cũng tự chứng minh trước khi tốn tiền:** bước 3 chạy kiểm miễn phí **hai lần** trên bản khôi phục của cơ sở dữ liệu thật; lần hai phải không đổi thêm chữ nào và không làm mới thêm ghi chú nào. Truy vấn 7 của bước 6 đếm bản đang chờ mà sản phẩm đã đổi số phiên bản (cho biết đường "chỉ hệ thống đổi" có đáng kể ở máy chủ thật không).

**Thời gian:** khoảng 20 phút. API và worker khởi động lại một lần (khoảng 1 phút): POS tạm gián đoạn; báo nhân viên trước.

## Trước khi dán

- Trên GitHub, tab **Actions**, commit `04ceaa52fbbdc4ca310a540d53db3aaf336312c1` có dấu **xanh**. Đỏ hoặc đang chạy: **đừng làm**.
- **Trong lúc khối chạy, không bấm Duyệt, Áp dụng, Viết lại hay Chọn tất cả** ở bất cứ đâu.
- Báo nhân viên thu tiền ở quầy: tạm dừng khoảng 3 phút.

## Khối lệnh (dán nguyên khối)

```bash
(
set -u
cd /opt/lucyspa || { echo "DUNG LAI: khong co thu muc /opt/lucyspa"; exit 1; }
NEW=04ceaa52fbbdc4ca310a540d53db3aaf336312c1
OLD=0e60254d28940077e78eb5016b82903ed59d810e
DB=lucy_spa_dev
SCRATCH=lucy_spa_rehearsal_scratch
CAP_VND=100000
dung() { echo; echo "DUNG LAI: $1"; echo "Chup man hinh tu dong DUNG LAI tro len va gui Claude. KHONG chay lai."; exit 1; }
sqlq() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1" -At' _ "$1"; }
sqlt() { printf '%s\n' "$2" | docker exec -i lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$1"' _ "$1"; }
expect() { [ "$2" = "$3" ] || dung "$1: duoc '$2', mong doi '$3'"; echo "OK  $1: $2"; }
at_least() { [ "$2" -ge "$3" ] 2>/dev/null || dung "$1: duoc '$2', mong doi tu '$3' tro len"; echo "OK  $1: $2 (>= $3)"; }
at_most() { [ "$2" -le "$3" ] 2>/dev/null || dung "$1: duoc '$2', mong doi khong qua '$3'"; echo "OK  $1: $2 (<= $3)"; }
count_online() { pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);console.log(l.filter(p=>p.name===process.argv[1]&&p.pm2_env.status==='online').length)})" "$1"; }
http() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
field() { printf '%s\n' "$1" | sed -En "s/(^|.* )$2=([^ ]*).*/\2/p" | tail -n 1; }
COUNTS="select (select count(*) from _prisma_migrations where finished_at is not null)||'|'||(select count(*) from permissions)"
TEXTS="select md5(string_agg(coalesce(name_vi,'')||'~'||coalesce(name_en,'')||'~'||coalesce(description_vi,'')||'~'||coalesce(description_en,'')||'~'||coalesce(description_sections_vi::text,'')||'~'||coalesce(description_sections_en::text,'')||'~'||coalesce(seo_title_vi,'')||'~'||coalesce(seo_title_en,'')||'~'||coalesce(seo_description_vi,'')||'~'||coalesce(seo_description_en,''), '#' order by id::text)) from products"
READY="select count(*) from ai_items where kind='PRODUCT_TEXT' and status='DRAFT_READY'"
APPLIED="select count(*) from ai_items where kind='PRODUCT_TEXT' and status='APPLIED'"
EDITED="select count(*) from ai_items where kind='PRODUCT_TEXT' and status='DRAFT_READY' and edited is not null"
NAME_BLANK="select count(*) from products where btrim(name_en)='' or btrim(name_vi)=''"
BLANK_DRAFTS="select count(*) from ai_items i where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and (coalesce(btrim(i.draft->>'nameEn'),'')='' or coalesce(btrim(i.draft->>'seoTitleVi'),'')='' or coalesce(btrim(i.draft->>'seoTitleEn'),'')='' or coalesce(btrim(i.draft->>'seoDescriptionVi'),'')='' or coalesce(btrim(i.draft->>'seoDescriptionEn'),'')='' or coalesce(btrim(i.draft->>'descriptionVi'),'')='' or coalesce(btrim(i.draft->>'descriptionEn'),'')='')"
REPAIRABLE="'CLINIC_WORD','FORBIDDEN_PHRASE','AUTHENTICITY_CLAIM','TESTIMONIAL','URL_OR_CONTACT','MARKUP_OR_EMOJI','INJECTION_SIGN','SEO_TITLE_LONG','SEO_DESCRIPTION_LONG','WRONG_LANGUAGE','EMPTY_FIELD','BRAND_CHANGED','SUITABILITY_CONDITION','INGREDIENT_ADDED'"
LEDGER_ROWS="select count(*) from ai_usage_ledger"
diag() {
  echo "--- 1. Loi con lai theo ma va truong (so bai cho duyet, chua sua tay)"
  sqlt $DB "select w->>'code' as ma, coalesce(w->>'field','') as truong, count(distinct i.id) as bai from ai_items i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code' in ($REPAIRABLE) group by 1,2 order by 3 desc, 1, 2"
  echo "--- 2. So bai co it nhat mot loi con lai"
  sqlt $DB "select count(distinct i.id) as bai_con_loi from ai_items i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code' in ($REPAIRABLE)"
  echo "--- 3. Cum cam bi bat (FORBIDDEN_PHRASE) theo chu khop"
  sqlt $DB "select coalesce(w->>'detail','') as chu_khop, count(distinct i.id) as bai, (array_agg(distinct p.name_vi))[1:3] as vi_du from ai_items i join products p on p.id = i.target_id cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code'='FORBIDDEN_PHRASE' group by 1 order by 2 desc"
  echo "--- 4. Truong dang RONG trong ban nhap da luu"
  sqlt $DB "select v.truong, count(*) as bai_rong from ai_items i cross join lateral (values ('nameEn', i.draft->>'nameEn'), ('seoTitleVi', i.draft->>'seoTitleVi'), ('seoTitleEn', i.draft->>'seoTitleEn'), ('seoDescriptionVi', i.draft->>'seoDescriptionVi'), ('seoDescriptionEn', i.draft->>'seoDescriptionEn'), ('descriptionVi', i.draft->>'descriptionVi'), ('descriptionEn', i.draft->>'descriptionEn'), ('suitableForVi', i.draft->'sectionsVi'->>'suitableFor'), ('suitableForEn', i.draft->'sectionsEn'->>'suitableFor')) v(truong, gia_tri) where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and coalesce(btrim(v.gia_tri),'')='' group by 1 order by 2 desc"
  echo "--- 5. Ban nhap co ten chinh thuc chua chuoi hay bi bat nham (cure, permanent, 100%, treat)"
  sqlt $DB "select count(*) as bai, count(*) filter (where coalesce(btrim(i.draft->>'nameEn'),'')='') as ten_anh_rong from ai_items i where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and lower(i.base_snapshot->>'nameVi') ~ '(cure|permanent|100%|treat)'"
  echo "--- 7. Ban nhap cho duyet ma san pham da doi so phien ban tu luc viet (he thong hay sua doi cung lam so nay doi)"
  sqlt $DB "select count(*) as bai_phien_ban_doi from ai_items i join products p on p.id = i.target_id where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and p.row_version <> i.base_row_version"
  echo "--- 6. Muoi bai con loi nhieu ma nhat (ten, ma loi)"
  sqlt $DB "select left(i.base_snapshot->>'nameVi', 60) as ten, string_agg(distinct w->>'code', ', ') as ma_loi from ai_items i cross join lateral jsonb_array_elements(case when jsonb_typeof(i.warnings)='array' then i.warnings else '[]'::jsonb end) w where i.kind='PRODUCT_TEXT' and i.status='DRAFT_READY' and i.edited is null and w->>'code' in ($REPAIRABLE) group by i.id, 1 order by count(distinct w->>'code') desc, 1 limit 10"
}
echo "=== 0. Dieu kien ==="
expect "migration va quyen (khong doi)" "$(sqlq $DB "$COUNTS")" "134|82"
case "$(git rev-parse HEAD)" in "$OLD"|"$NEW") echo "OK  ma dang chay: $(git rev-parse HEAD)";; *) dung "ma dang chay $(git rev-parse HEAD) khong phai ban cu hay ban moi";; esac
expect "thu muc code sach" "$(git status --short | wc -l | tr -d ' ')" "0"
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online" "$(count_online lucyspa-worker)" "1"
expect "khong ban nhap nao dang cho hoac dang viet" "$(sqlq $DB "select count(*) from ai_items where status in ('QUEUED','GENERATING')")" "0"
expect "khong lan chay nao dang mo" "$(sqlq $DB "select count(*) from ai_runs where status in ('QUEUED','RUNNING')")" "0"
expect "khong san pham nao co ten rong" "$(sqlq $DB "$NAME_BLANK")" "0"
FREE=$(df -BG / | awk 'NR==2{gsub("G","",$4);print $4}')
[ "$FREE" -ge 2 ] || dung "o dia con $FREE GB, can it nhat 2 GB"
echo "OK  o dia con trong: $FREE GB"
READY_BEFORE=$(sqlq $DB "$READY")
APPLIED_BEFORE=$(sqlq $DB "$APPLIED")
EDITED_BEFORE=$(sqlq $DB "$EDITED")
BLANK_BEFORE=$(sqlq $DB "$BLANK_DRAFTS")
LEDGER_BEFORE=$(sqlq $DB "$LEDGER_ROWS")
USERS_BEFORE=$(sqlq $DB "select count(*) from users")
INVOICES_BEFORE=$(sqlq $DB "select count(*) from invoices")
PAYMENTS_BEFORE=$(sqlq $DB "select count(*) from payments")
FUNDS_BEFORE=$(sqlq $DB "select count(*) from fund_entries")
ONLINE_BEFORE=$(sqlq $DB "select enabled from online_sales_settings")
echo "Truoc: ban nhap cho duyet=$READY_BEFORE (sua tay $EDITED_BEFORE, co truong rong $BLANK_BEFORE) | da ap dung=$APPLIED_BEFORE | nguoi dung=$USERS_BEFORE hoa don=$INVOICES_BEFORE ban online bat=$ONLINE_BEFORE"
echo "=== 1. Sao luu ==="
mkdir -p /root/backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pm2 save >/dev/null 2>&1
cp ~/.pm2/dump.pm2 /root/backups/pm2-dump-truoc-sua-ban-nhap-$STAMP.pm2 || dung "khong sao luu duoc pm2"
BACKUP=/root/backups/lucyspa-pre-repair-fixes-$STAMP.dump
docker exec lucy-spa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP" || dung "pg_dump loi"
chmod 600 "$BACKUP"
[ "$(stat -c %s "$BACKUP")" -gt 102400 ] || dung "tep sao luu co so du lieu qua nho"
docker cp "$BACKUP" lucy-spa-postgres-1:/tmp/check.dump || dung "docker cp loi"
LISTED=$(docker exec lucy-spa-postgres-1 sh -c 'pg_restore --list /tmp/check.dump | wc -l; rm -f /tmp/check.dump' | tr -d ' ')
[ "$LISTED" -gt 1000 ] || dung "sao luu doc ra chi $LISTED dong"
echo "OK  sao luu co so du lieu: $BACKUP ($LISTED dong)"
WEBBACKUP=/root/backups/lucyspa-web-pre-repair-fixes-$STAMP.tar.gz
tar -czf "$WEBBACKUP" apps/web/.next apps/api/dist apps/worker/dist $(ls -d packages/*/dist) || dung "khong nen duoc ban web"
chmod 600 "$WEBBACKUP"
[ "$(stat -c %s "$WEBBACKUP")" -gt 10485760 ] || dung "ban sao luu web qua nho"
[ "$(tar -tzf "$WEBBACKUP" | wc -l)" -gt 500 ] || dung "ban sao luu web it tep bat thuong"
echo "OK  sao luu web: $WEBBACKUP"
echo "=== 2. Lay ban moi, cai, build (chua khoi dong lai gi) ==="
git fetch origin || dung "git fetch loi"
git checkout "$NEW" || dung "git checkout loi"
expect "ma moi" "$(git rev-parse HEAD)" "$NEW"
expect "khong doi thu vien (pnpm-lock)" "$(git diff $OLD $NEW --stat -- pnpm-lock.yaml | wc -l | tr -d ' ')" "0"
expect "khong co migration moi" "$(git diff $OLD $NEW --name-only -- packages/database/prisma/migrations | wc -l | tr -d ' ')" "0"
pnpm install --frozen-lockfile || dung "pnpm install loi (phan mem dang chay chua bi dung toi)"
pnpm db:generate || dung "db:generate loi"
pnpm build || dung "pnpm build loi (neu trang web bao loi: xem phan Quay lai)"
at_least "ban moi: so khop cum cam theo tu nguyen" "$(grep -c "bannedHit" packages/server/dist/ai/product-rewrite.js)" 1
expect "ban moi: luat thanh phan la danh sach dau phay" "$(grep -c "comma-separated list of ingredient names" packages/server/dist/ai/rewrite-repair.js)" "1"
expect "ban moi: lenh sua du lieu trong" "$(test -f apps/worker/dist/ai-fix-blanked.js && echo co)" "co"
expect "ban moi: duyet hang loat moi bai mot diem luu" "$(grep -c "SAVEPOINT approve_one" apps/api/dist/ai/ai-drafts.core.js)" "1"
expect "ban moi: bai tro khong bi bao xung dot" "$(grep -c "emptyFields" apps/api/dist/ai/ai-drafts.core.js | awk '{print ($1>0)?"co":"khong"}')" "co"
echo "=== 3. Dien tap tren ban khoi phuc cua co so du lieu that (sua du lieu va sua mien phi) ==="
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $SCRATCH && createdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong tao duoc co so du lieu tam"
docker exec -i lucy-spa-postgres-1 sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $SCRATCH --no-owner --exit-on-error" < "$BACKUP" || dung "pg_restore vao co so du lieu tam loi"
eval "$(node scripts/scratch-db-env.mjs $SCRATCH)" || dung "lenh tu choi ten co so du lieu tam"
expect "dang tro vao co so du lieu tam" "${DATABASE_URL##*/}" "$SCRATCH"
R_DRY=$(node apps/worker/dist/ai-fix-blanked.js 2>&1 | grep '^mode=' | tail -n 1)
echo "Tam, chay thu sua du lieu: $R_DRY"
[ -n "$R_DRY" ] || dung "ban tam: lenh sua du lieu khong in ket qua"
R_APPLY=$(node apps/worker/dist/ai-fix-blanked.js --apply 2>&1 | grep '^mode=' | tail -n 1)
echo "Tam, ghi: $R_APPLY"
R_AGAIN=$(node apps/worker/dist/ai-fix-blanked.js 2>&1 | grep '^mode=' | tail -n 1)
echo "Tam, chay thu lai: $R_AGAIN"
expect "ban tam: so truong ghi bang so truong du kien" "$(field "$R_APPLY" restoredFields)" "$(( $(field "$R_DRY" fromBefore) + $(field "$R_DRY" fromName) ))"
expect "ban tam: chay lai khong con gi de khoi phuc" "$(( $(field "$R_AGAIN" fromBefore) + $(field "$R_AGAIN" fromName) ))" "0"
expect "ban tam: khong san pham nao co ten rong" "$(sqlq $SCRATCH "$NAME_BLANK")" "0"
S_FREE=$(node apps/worker/dist/ai-fix-pending.js 2>&1 | grep '^pending=' | tail -n 1)
echo "Tam, sua mien phi: $S_FREE"
[ -n "$S_FREE" ] || dung "ban tam: lenh sua mien phi khong in ket qua"
S_FREE2=$(node apps/worker/dist/ai-fix-pending.js 2>&1 | grep '^pending=' | tail -n 1)
echo "Tam, sua mien phi lan hai: $S_FREE2"
expect "ban tam: lan kiem hai khong sua them chu nao (da hoi tu)" "$(field "$S_FREE2" fixedFree)" "0"
expect "ban tam: lan kiem hai khong lam moi them ghi chu nao" "$(field "$S_FREE2" notesRefreshed)" "0"
expect "ban tam: ban nhap cho duyet van la ban nhap" "$(sqlq $SCRATCH "$READY")" "$READY_BEFORE"
expect "ban tam: lan sua mien phi khong ton tien" "$(sqlq $SCRATCH "$LEDGER_ROWS")" "$LEDGER_BEFORE"
unset DATABASE_URL
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
docker exec lucy-spa-postgres-1 sh -c "dropdb -U \"\$POSTGRES_USER\" $SCRATCH" || dung "khong xoa duoc co so du lieu tam"
expect "da xoa co so du lieu tam" "$(sqlq $DB "select count(*) from pg_database where datname = '$SCRATCH'")" "0"
echo "=== 4. Khoi dong lai ==="
pm2 restart lucyspa-api lucyspa-worker --update-env >/dev/null 2>&1
sleep 10
pm2 reload lucyspa-web --update-env >/dev/null 2>&1
sleep 20
at_least "web online" "$(count_online lucyspa-web)" 1
expect "api online" "$(count_online lucyspa-api)" "1"
expect "worker online (dung 1)" "$(count_online lucyspa-worker)" "1"
echo "--- 15 dong loi gan nhat cua API va worker (khong duoc co dong moi sau luc khoi dong lai) ---"
pm2 logs lucyspa-api --err --lines 15 --nostream 2>&1 | tail -n 15
pm2 logs lucyspa-worker --err --lines 15 --nostream 2>&1 | tail -n 15
echo "=== 5. Kiem tra bang lenh (khong tao hay sua du lieu that) ==="
expect "suc khoe" "$(curl -s http://127.0.0.1:3001/health/ready | grep -c '"status":"ok"')" "1"
expect "trang chu /vi" "$(http http://127.0.0.1:3000/vi)" "200"
expect "dich vu" "$(http http://127.0.0.1:3000/vi/services)" "200"
expect "my pham" "$(http http://127.0.0.1:3000/vi/products)" "200"
expect "dang nhap nhan vien" "$(http http://127.0.0.1:3000/vi/workforce/login)" "200"
for TRANG in product-rewrites seo-drafts ai-settings; do
  KQ=$(http http://127.0.0.1:3000/vi/workforce/$TRANG)
  case "$KQ" in 200|307) echo "OK  man $TRANG: $KQ";; *) dung "man $TRANG tra $KQ (mong doi 200 hoac 307)";; esac
done
expect "API duyet hang loat khi chua dang nhap" "$(http http://127.0.0.1:3001/api/v1/ai/product-drafts/approve-all)" "401"
expect "chat website con tat: cong tat trong co so du lieu" "$(sqlq $DB "select chat_enabled::text from ai_settings")" "false"
expect "chat website con tat: trang cong khai /public/site?locale=vi" "$(curl -s "http://127.0.0.1:3001/api/v1/public/site?locale=vi" | grep -c '"chatEnabled":false')" "1"
sleep 5
expect "khong ban nhap nao tu bat dau viet" "$(sqlq $DB "select count(*) from ai_items where status in ('QUEUED','GENERATING')")" "0"
echo "=== 6. Chan doan TRUOC khi sua (6 truy van chi doc) ==="
diag
echo "=== 7. Sua du lieu: san pham da duyet con truong rong (chay thu roi ghi) ==="
expect "khong con DATABASE_URL trong moi truong" "$(env | grep -c '^DATABASE_URL=' || true)" "0"
TEXTS_PRE_FIX=$(sqlq $DB "$TEXTS")
D_DRY=$(pnpm --filter @lucy-spa/worker run ai:fix-blanked 2>&1 | grep '^mode=' | tail -n 1)
echo "KET QUA CHAY THU: $D_DRY"
[ -n "$D_DRY" ] || dung "lenh sua du lieu (chay thu) khong in ket qua"
expect "chay thu khong ghi gi" "$(sqlq $DB "$TEXTS")" "$TEXTS_PRE_FIX"
expect "chay thu: dung so bai da ap dung" "$(field "$D_DRY" appliedItems)" "$APPLIED_BEFORE"
expect "so lieu chay thu khop ban tam" "$(field "$D_DRY" productsWithBlank)" "$(field "$R_DRY" productsWithBlank)"
case "$(field "$D_DRY" fields)" in *.benefits*|*.ingredients*|*.usage*) dung "lenh sua du lieu se dong vao muc benefits/ingredients/usage (khong duoc phep): $(field "$D_DRY" fields)";; esac
AUDIT_BEFORE=$(sqlq $DB "select count(*) from audit_events where action='AI_BLANK_FIELDS_RESTORED'")
D_APPLY=$(pnpm --filter @lucy-spa/worker run ai:fix-blanked --apply 2>&1 | grep '^mode=' | tail -n 1)
echo "KET QUA GHI: $D_APPLY"
[ -n "$D_APPLY" ] || dung "lenh sua du lieu (ghi) khong in ket qua"
expect "so truong ghi bang so truong du kien" "$(field "$D_APPLY" restoredFields)" "$(( $(field "$D_DRY" fromBefore) + $(field "$D_DRY" fromName) ))"
expect "moi san pham duoc sua co mot dong nhat ky" "$(( $(sqlq $DB "select count(*) from audit_events where action='AI_BLANK_FIELDS_RESTORED'") - AUDIT_BEFORE ))" "$(field "$D_APPLY" restoredProducts)"
D_AGAIN=$(pnpm --filter @lucy-spa/worker run ai:fix-blanked 2>&1 | grep '^mode=' | tail -n 1)
echo "CHAY THU LAI: $D_AGAIN"
expect "chay lai khong con gi de khoi phuc" "$(( $(field "$D_AGAIN" fromBefore) + $(field "$D_AGAIN" fromName) ))" "0"
expect "khong san pham nao co ten rong" "$(sqlq $DB "$NAME_BLANK")" "0"
expect "so bai da ap dung khong doi" "$(sqlq $DB "$APPLIED")" "$APPLIED_BEFORE"
echo "Truong ma khong the khoi phuc (de nguyen, gui Claude): $(field "$D_APPLY" unrestorable) | chi tiet: $(field "$D_APPLY" fields)"
TEXTS_AFTER_FIX=$(sqlq $DB "$TEXTS")
echo "=== 8. Kiem lai MOI ban nhap dang cho (mien phi, khong goi AI) ==="
P_FREE=$(pnpm --filter @lucy-spa/worker run ai:fix-pending 2>&1 | grep '^pending=' | tail -n 1)
echo "KET QUA LAN KIEM MIEN PHI: $P_FREE"
[ -n "$P_FREE" ] || dung "lenh kiem mien phi khong in ket qua"
expect "so ban nhap duoc xet" "$(field "$P_FREE" pending)" "$READY_BEFORE"
expect "ban nhap sua tay khong bi dung toi" "$(field "$P_FREE" skippedEdited)" "$EDITED_BEFORE"
expect "ban nhap cho duyet van la ban nhap" "$(sqlq $DB "$READY")" "$READY_BEFORE"
expect "chu cua san pham khong doi (khong gi bi dang)" "$(sqlq $DB "$TEXTS")" "$TEXTS_AFTER_FIX"
expect "lan kiem mien phi khong ton tien" "$(sqlq $DB "$LEDGER_ROWS")" "$LEDGER_BEFORE"
NEED=$(field "$P_FREE" needRepair)
EST=$(field "$P_FREE" estimatedRepairVnd)
echo "So ban nhap con loi that, can AI sua: $NEED | chi phi uoc tinh: $EST dong | tran: $CAP_VND dong"
echo "Ma loi truoc khi sua AI: $(field "$P_FREE" codesBefore)"
echo "=== 9. Sua bang AI (chi bai con loi that, tran $CAP_VND dong) ==="
REPAIR_LINE=""
if [ "$NEED" -gt 0 ]; then
  KEYS=$(grep -c '^ANTHROPIC_API_KEY=.' /opt/lucyspa/.env || true)
  ENABLED=$(sqlq $DB "select (enabled and rewrite_enabled and vnd_per_usd is not null)::text from ai_settings")
  if [ "$KEYS" = "1" ] && [ "$ENABLED" = "true" ]; then
    REPAIR_OUT=$(pnpm --filter @lucy-spa/worker run ai:fix-pending --repair --max-vnd=$CAP_VND 2>&1) || { echo "$REPAIR_OUT" | tail -n 20; dung "lenh sua bang AI loi"; }
    REPAIR_LINE=$(printf '%s\n' "$REPAIR_OUT" | grep '^pending=' | tail -n 1)
    echo "KET QUA LAN SUA BANG AI: $REPAIR_LINE"
    [ -n "$REPAIR_LINE" ] || dung "lenh sua bang AI khong in ket qua"
    SPENT=$(field "$REPAIR_LINE" repairCostVnd)
    at_most "chi phi sua AI khong qua tran" "${SPENT%%.*}" "$CAP_VND"
    expect "ban nhap cho duyet van la ban nhap" "$(sqlq $DB "$READY")" "$READY_BEFORE"
    expect "chu cua san pham van khong doi" "$(sqlq $DB "$TEXTS")" "$TEXTS_AFTER_FIX"
    echo "Chi phi sua bang AI (nhat ky chi tieu, ca hai ket cuc): $(sqlq $DB "select count(*)||' lan goi, '||coalesce(round(sum(cost_micro_usd)/1000000.0, 4), 0)||' USD' from ai_usage_ledger where outcome in ('REPAIRED','REPAIR_FAILED') and occurred_at >= now() - interval '1 hour'")"
    echo "Ma loi con lai sau khi sua AI: $(field "$REPAIR_LINE" codesAfter)"
  else
    echo "Chua sua bang AI: khoa Anthropic hoac cong tat AI/viet lai/ty gia chua san sang (khoa=$KEYS, san sang=$ENABLED). Cac bai con loi that van nam trong danh sach, kem ghi chu."
  fi
else
  echo "Khong co ban nhap nao con loi that: khong goi AI, khong ton tien."
fi
AGAIN=$(pnpm --filter @lucy-spa/worker run ai:fix-pending 2>&1 | grep '^pending=' | tail -n 1)
echo "KET QUA LAN KIEM MIEN PHI CUOI (phai khong doi them chu): $AGAIN"
echo "=== 10. Chan doan SAU khi sua ==="
diag
expect "so nguoi dung giu nguyen" "$(sqlq $DB "select count(*) from users")" "$USERS_BEFORE"
expect "so hoa don giu nguyen" "$(sqlq $DB "select count(*) from invoices")" "$INVOICES_BEFORE"
expect "so thanh toan giu nguyen" "$(sqlq $DB "select count(*) from payments")" "$PAYMENTS_BEFORE"
expect "but toan so quy giu nguyen" "$(sqlq $DB "select count(*) from fund_entries")" "$FUNDS_BEFORE"
expect "ban online khong bi doi" "$(sqlq $DB "select enabled from online_sales_settings")" "$ONLINE_BEFORE"
expect "migration va quyen khong doi" "$(sqlq $DB "$COUNTS")" "134|82"
BLANK_AFTER=$(sqlq $DB "$BLANK_DRAFTS")
echo "=== XONG: khong co DUNG LAI nao. Gui Claude cac dong sau ==="
echo "ma dang chay: $(git rev-parse HEAD)"
echo "ban nhap cho duyet: truoc $READY_BEFORE, sau $(sqlq $DB "$READY") | da ap dung: truoc $APPLIED_BEFORE, sau $(sqlq $DB "$APPLIED")"
echo "ban nhap co truong rong: truoc $BLANK_BEFORE, sau $BLANK_AFTER"
echo "san pham da duyet: sua du lieu chay thu: $D_DRY"
echo "san pham da duyet: sua du lieu ghi: $D_APPLY"
echo "kiem mien phi: $P_FREE"
echo "sua bang AI: ${REPAIR_LINE:-khong chay}"
echo "kiem mien phi cuoi: $AGAIN"
echo "sao luu co so du lieu: $BACKUP"
echo "sao luu web: $WEBBACKUP"
pm2 status
echo "--- Hai kiem tra cuoi (sau khi da in du so lieu): lan kiem mien phi cuoi khong con doi them gi ---"
expect "kiem lai khong sua them bai nao mien phi" "$(field "$AGAIN" fixedFree)" "0"
expect "kiem lai khong lam moi them ghi chu nao" "$(field "$AGAIN" notesRefreshed)" "0"
)
```

## Sau khi khối chạy xong (Owner xem trên web)

1. **Danh mục → Viết lại nội dung:** mở vài bài vừa được sửa; khung **Lưu ý của hệ thống** khớp với số "Mã lỗi còn lại" khối đã in. Bài còn lỗi thật vẫn duyệt được (lưu ý chỉ để tham khảo) nhưng **hãy đọc trước**: bản nháp còn mã `FORBIDDEN_PHRASE`, `TESTIMONIAL`, `INJECTION_SIGN`... nghĩa là lần sửa AI chưa gỡ được.
2. **Duyệt một bài** (sau khi bấm Ctrl+F5): phải được. Thử **Chọn tất cả → Duyệt các bài đã chọn**: một xác nhận; kết quả ghi rõ "Đã duyệt N bài. Đã bỏ qua M bài: lý do (số)". Không còn thông báo "Dữ liệu vừa được thay đổi ở nơi khác".
3. Mở vài sản phẩm đã được **khôi phục** (nhật ký hoạt động có dòng `AI_BLANK_FIELDS_RESTORED`, ghi giá trị cũ và mới): mô tả hoặc "Phù hợp với ai" đã có chữ. Chữ khôi phục từ tên chính thức chỉ là tạm; nên **Viết lại** sản phẩm đó sau.

## Quay lại nếu có sự cố

Không có migration nên không cần đụng cơ sở dữ liệu cho phần mã. Đổi lại bản chạy; **dữ liệu đã sửa ở bước 7** được hoàn lại bằng bản sao lưu cơ sở dữ liệu của khối nếu Owner muốn (hoặc giữ nguyên: mỗi trường khôi phục có giá trị cũ trong nhật ký hoạt động).

```bash
(
set -u
cd /opt/lucyspa || exit 1
OLD=0e60254d28940077e78eb5016b82903ed59d810e
git checkout "$OLD" && pnpm install --frozen-lockfile && pnpm db:generate && pnpm build || { echo "DUNG LAI: build loi"; exit 1; }
pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env
sleep 20
pm2 status
)
```

**Mong đợi:** ba tiến trình `online`; trang `https://lucyspa.vn/vi` mở được. _Nếu `pnpm build` làm hỏng trang web:_ `tar -xzf <tệp sao lưu web ở trên> -C /opt/lucyspa` rồi `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.
