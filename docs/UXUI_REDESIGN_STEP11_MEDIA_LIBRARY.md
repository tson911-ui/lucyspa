# UX/UI Step 11: website media library (Content A)

Status: implemented locally, awaiting Owner review (uncommitted, not deployed). Base a58c5fc. Contract: UXUI_REDESIGN_DESIGN.md sections 16.1-16.4, 16.7-16.8, Q-CM1/5/6/8/9/10/11. `CLAUDE.md` also gets the new rule: run `pnpm test` for the whole repo before every push.

## What changed

- **DB (2 additive migrations)**: `20261018000000_uxui_step11_website_permission` (enum value) and `20261018000001_uxui_step11_media_library` (catalog CHECK + `media_assets`, `media_variants`). DB-enforced: JPEG/PNG/WebP, 10 MB, 6000 px, sha256 shape, alt <= 300, unique sha256 and keys, variants cascade, creator restricted.
- **Permission**: `MANAGE_WEBSITE_CONTENT`, GLOBAL_ONLY, STANDARD (catalog 41). Needs `pnpm db:permissions:sync` at deployment. A branch grant never opens it (API and nav).
- **Storage** (`packages/server`): `MediaStorage` + `LocalDiskMediaStorage` (random `yyyy/mm/uuid` keys, atomic write that never overwrites, path-escape refused). **New env `MEDIA_STORAGE_DIR`**: absolute, outside the repo and release folder, in the backup scope; required in production (names only in the error), temp-folder default elsewhere.
- **API** (`apps/api/src/website`, dependency `sharp` 0.35.4, Q-CM11): `POST /api/v1/website/media` (multipart: magic bytes only, no SVG/GIF, EXIF stripped and auto-oriented renditions thumb 320/md 960/lg 1920 WebP, original kept but never served, dedupe by sha256, 30 attempts/min/user), `GET` list (24/page, search filename + alt), `GET :id`, `GET :id/:variant`, `POST :id/alt` (versioned), `POST :id/delete` (refused while referenced). Audit `MEDIA_UPLOADED/UPDATED/DELETED`. Files are written before the rows commit and removed again on any failure. Multipart is allowed on that one route only (`@MultipartUpload()`); Origin, session and CSRF still apply.
- **Web**: nav `Website` (administration group, `/website`, page title "Thu vien anh"); `MediaLibraryScreen`: toolbar search, tile grid, pager, upload (button, drop on the page) with a progress `DataTable` queue, detail `FormDrawer` (preview, facts, alt VI/EN), tile `⋮` Edit / Delete + `ConfirmDialog`. `ApiClient.upload` (XHR: progress, cancel, same CSRF retry and 401 handling). VI/EN text. Kit: `MediaGrid`, `MediaTile`, `MediaPreview` (tokens only).

## Decisions to confirm (not in the contract)

1. The public serve route and the "used in" lookups (popup, slider) arrive with Steps 12/13: no table can reference an asset yet, so `mediaUsages` returns none; delete protection is tested with a stand-in lookup.
2. No `deleted_at` column (Q-CM5 is a real delete). Alt VI is "required before use": the library shows a "Thieu mo ta" badge and Steps 12/13 enforce it when an image is picked.
3. Update and delete are `POST :id/alt` and `POST :id/delete`, like every other route (no PATCH/DELETE).
4. Thumbnails use a read-only session lookup + fresh authority check under the shared graph lock instead of `runAdminCommand` (which locks the user row): 24 thumbnails took 1.2 s and stalled the user's other requests, now 0.4 s.
5. Production now fails to start without `MEDIA_STORAGE_DIR` (36 test fixtures that build a production env got it). Deployment: set it, create the folder writable by the API user, add it to backups, run `db:deploy` and `db:permissions:sync`.

## Tests and checks

- `pnpm test` (all packages) green: server 35, worker 15, ui 240, web 295, api 178 (+63 integration, skipped here). New: storage 4, image processing 5, HTTP contract 1, kit 3, client upload 6, upload queue 6, library logic 8.
- Integration on a scratch DB: `media.integration` 11/11 (permission, upload, dedupe, rejected files leave nothing, rollback of stored files, list/search, alt versions, serving, rate limit, delete), `website-media-foundation` (DB constraints) 1/1, database suites 64/64, authorization + role-admin updated for 41 permissions. Full `test:auth:integration` on a scratch DB: 434/436; the 2 failures are one known time-of-day fixture in `my-income` (expects 2026-10-01, the branch date had rolled to 10-02), unrelated to this Step.
- Real browser (headless, scratch app) 14/14: upload of 2 PNGs + 1 SVG (refused in the browser), queue, toast, drawer save, delete, search, page 2, English.
- eslint, `check-boundaries`, `format:check` clean. No `apps/web/next-env.d.ts` change.

## UX gate

- Rendered `website` at 360/768/1440 light + 1440 dark, the drawer, the delete dialog, the queue, the empty search and English dark.
- Fixed from review: toolbar jammed under the header (a wrapper div broke the page's vertical gap; drag/drop moved to window listeners), phone grid to 2 columns with ellipsis, tile = real name button stretched over the card (no multi-line button), upload queue rebuilt as a `DataTable`.
- DOM audit: `website` 0 findings at all widths (new page, baseline 0 -> 0); no other page changed. Ratchet unchanged.
- Reference comparison: yes to all 8 (gutter 16, header-to-content 24, 24/600 title + one-line description, primary last at the trailing edge, one toolbar row, one-surface table, pager as one footer row, create in a drawer/dialog, nothing touches another surface).
- Not run: popup/slider (Steps 12/13); S3 storage (later, by configuration).

## Serving thumbnails: what the lighter path still checks (Owner question 1)

- Every request: the session cookie is resolved read-only (revoked, expired or permission-changed sessions are refused), the person must be an Owner or employee (customers are refused), and their authority graph is read fresh and must hold GLOBAL `MANAGE_WEBSITE_CONTENT`. Only the row locks of `runAdminCommand` are skipped.
- Never public: no cookie answers 401; the response is `Cache-Control: private, max-age=300` with an ETag; no CDN or shared cache may keep it. Originals are never served.
- Tests: `media.integration` "serving" refuses a user without the permission, a branch-only grant, a customer, no session and an invalid session (FORBIDDEN / AUTHENTICATION_REQUIRED); `media.http.test` asserts `private` caching, `nosniff`, 304 on ETag and 404 for any rendition but thumb/md/lg.

## Carry-over for Steps 12 and 13 (Owner question 2)

An image used by a popup or slide must not be deletable: the popup and slide tables reference `media_assets` with `ON DELETE RESTRICT`, `mediaUsages` (media.core.ts) returns them so `deleteMedia` answers `MEDIA_IN_USE`, and the delete dialog shows the list of places that use it with no destructive button. Each of 12 and 13 adds its lookup, a test that delete is refused while referenced, and the public serve route for images referenced by an enabled, in-window popup/slide.

## Cách deploy Step 11 (cho Owner, không cần rành IT)

Làm trên máy chủ, trong `/opt/lucyspa`, theo đúng thứ tự:

1. **Tạo thư mục lưu ảnh, nằm ngoài code** (để lần deploy sau không làm mất ảnh): `sudo mkdir -p /opt/lucyspa-media`. Xem tài khoản đang chạy API: `ps -o user= -p $(pm2 pid lucyspa-api)`, rồi `sudo chown <tài-khoản>:<tài-khoản> /opt/lucyspa-media` và `sudo chmod 750 /opt/lucyspa-media` (chỉ tài khoản đó đọc/ghi).
2. **Khai báo thư mục**: thêm một dòng vào file `.env` trên máy chủ (đừng in ra hay đưa lên git): `MEDIA_STORAGE_DIR=/opt/lucyspa-media`. Thiếu dòng này API sẽ cố ý không khởi động (có lỗi nêu tên biến).
3. **Lấy bản mới và cài**: checkout commit của Step 11, `pnpm install --frozen-lockfile` (cài thêm thư viện xử lý ảnh `sharp`), `pnpm build`.
4. **Cập nhật cơ sở dữ liệu**: `pnpm db:deploy` (2 migration mới, chỉ thêm, không xóa gì), rồi khởi động lại `pm2 restart lucyspa-api lucyspa-worker lucyspa-web --update-env`.
5. **Đồng bộ quyền**: `pnpm db:permissions:sync`. Lần đầu phải báo `1 inserted, 40 already present`; chạy lại báo `0 inserted`.
6. **Kiểm tra**: đăng nhập Owner, mở `/vi/workforce/website`, tải 1 ảnh lên, thấy ảnh hiện ra. Muốn giao việc này cho nhân sự marketing: tạo vai trò có quyền "Quản lý nội dung website" và gán cho họ ở phạm vi **toàn hệ thống** (gán theo chi nhánh sẽ không có tác dụng).
7. **Giới hạn tải lên**: ảnh JPEG, PNG hoặc WebP, tối đa **10 MB mỗi ảnh** và 6000 px mỗi cạnh; không nhận SVG, GIF, video; tối đa 30 lần tải/phút mỗi người. Mỗi ảnh chiếm khoảng 1,3 đến 2 lần dung lượng gốc (bản gốc + 3 bản thu nhỏ); 1.000 ảnh khoảng vài GB, ổ đĩa hiện còn nhiều (89 GB). Nếu có nginx đứng trước web, đặt `client_max_body_size 11m;` (đã thử: ảnh 9,2 MB đi qua web bình thường; trình duyệt tự từ chối ảnh quá 10 MB trước khi gửi).
8. **Sao lưu (quan trọng)**: thêm `/opt/lucyspa-media` vào lịch sao lưu cùng với cơ sở dữ liệu. Hai thứ này phải được sao lưu và khôi phục cùng thời điểm: cơ sở dữ liệu chỉ nhớ tên tệp ngẫu nhiên, mất thư mục thì ảnh bị lỗi 404.
9. **Quay lại bản cũ (nếu cần)**: không cần xóa thư mục ảnh; bản cũ bỏ qua các bảng mới.
