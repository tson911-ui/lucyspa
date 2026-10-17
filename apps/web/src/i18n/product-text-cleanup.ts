import type { Locale } from './locales';

/**
 * Claude integration CI-0b: the words of "Dọn lời đánh giá của nhà cung cấp". Short natural Vietnamese; a spa, not a clinic. The
 * comments are the supplier's own text, not Lucy Spa customers; the screen says so and never calls them reviews of Lucy Spa.
 */
const vi = {
  nav: 'Dọn lời đánh giá',
  title: 'Dọn lời đánh giá của nhà cung cấp',
  intro:
    'Bỏ đoạn “Đánh giá” nhà cung cấp để ở cuối mô tả sản phẩm. Chỉ đoạn đó bị bỏ; tên, giá, ảnh và phần mô tả còn lại giữ nguyên.',
  noAccess: 'Bạn không có quyền quản lý sản phẩm.',
  table: 'Sản phẩm còn lời đánh giá của nhà cung cấp',
  columns: {
    product: 'Sản phẩm',
    entries: 'Lời đánh giá',
    chars: 'Ký tự bỏ đi',
    state: 'Trạng thái',
  },
  states: { clean: 'Sẽ dọn', skip: 'Bỏ qua' },
  menu: { view: 'Xem chữ sẽ bỏ', skip: 'Bỏ qua sản phẩm này', include: 'Dọn sản phẩm này' },
  submit: 'Dọn {count} sản phẩm',
  submitNone: 'Chưa có sản phẩm nào để dọn',
  emptyTitle: 'Không còn lời đánh giá cần dọn',
  empty: 'Mô tả sản phẩm không còn đoạn “Đánh giá” của nhà cung cấp.',
  toProducts: 'Xem danh sách sản phẩm',
  truncated:
    'Có nhiều sản phẩm hơn số hiển thị. Dọn xong, mở lại trang này để dọn tiếp phần còn lại.',
  loadFailed: 'Không tải được danh sách. Thử lại sau ít phút.',
  confirm: {
    title: 'Dọn lời đánh giá khỏi {count} sản phẩm?',
    body: 'Đoạn “Đánh giá” (chữ của nhà cung cấp, không phải khách của Lucy Spa) sẽ biến mất khỏi mô tả. Bản chữ cũ được giữ trong nhật ký; sản phẩm bị sửa sau lúc xem trước sẽ được bỏ qua.',
    confirm: 'Dọn {count} sản phẩm',
    cleaning: 'Đang dọn…',
    facts: { products: 'Số sản phẩm', entries: 'Số lời đánh giá sẽ bỏ' },
  },
  done: 'Đã dọn {cleaned} sản phẩm.',
  doneSkipped: ' Bỏ qua {skipped} sản phẩm đã bị sửa hoặc không còn gì để dọn.',
  detail: {
    removed: 'Phần sẽ bị bỏ',
    after: 'Mô tả sau khi dọn',
    loadFailed: 'Không tải được chữ của sản phẩm này. Thử tải lại.',
    nothingTitle: 'Không còn gì để dọn',
    nothing: 'Đoạn “Đánh giá” của sản phẩm này đã được bỏ.',
    code: 'Mã sản phẩm',
  },
};

export type ProductTextCleanupText = typeof vi;

const en: ProductTextCleanupText = {
  nav: 'Clean supplier comments',
  title: 'Clean the supplier’s customer comments',
  intro:
    'Remove the “Đánh giá” (reviews) block the supplier left at the end of product descriptions. Only that block goes; the name, price, pictures and the rest of the description stay.',
  noAccess: 'You do not have permission to manage products.',
  table: 'Products that still carry the supplier’s comments',
  columns: {
    product: 'Product',
    entries: 'Comments',
    chars: 'Characters removed',
    state: 'Status',
  },
  states: { clean: 'Will clean', skip: 'Skipped' },
  menu: {
    view: 'See the text to remove',
    skip: 'Skip this product',
    include: 'Clean this product',
  },
  submit: 'Clean {count} products',
  submitNone: 'No products to clean',
  emptyTitle: 'Nothing left to clean',
  empty: 'No product description still carries the supplier’s “Đánh giá” block.',
  toProducts: 'View the product list',
  truncated:
    'More products matched than are shown. Clean these, then reopen the page for the rest.',
  loadFailed: 'The list could not be loaded. Try again in a few minutes.',
  confirm: {
    title: 'Clean the comments from {count} products?',
    body: 'The “Đánh giá” block (the supplier’s text, not Lucy Spa customers) will disappear from the description. The old text stays in the audit log; a product edited after the preview is skipped.',
    confirm: 'Clean {count} products',
    cleaning: 'Cleaning…',
    facts: { products: 'Products', entries: 'Comments to remove' },
  },
  done: 'Cleaned {cleaned} products.',
  doneSkipped: ' Skipped {skipped} products that were edited or have nothing left to clean.',
  detail: {
    removed: 'What will be removed',
    after: 'Description after cleaning',
    loadFailed: 'The text of this product could not be loaded. Try reloading it.',
    nothingTitle: 'Nothing left to clean',
    nothing: 'The “Đánh giá” block of this product is already gone.',
    code: 'Product code',
  },
};

export function productTextCleanupDictionary(locale: Locale): ProductTextCleanupText {
  return locale === 'en' ? en : vi;
}
