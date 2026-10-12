import type { Locale } from './locales';

/**
 * Claude integration CI-0b: the words of "Dọn lời đánh giá của nhà cung cấp". Short natural Vietnamese; a spa, not a clinic. The
 * comments are the supplier's own text, not Lucy Spa customers; the screen says so and never calls them reviews of Lucy Spa.
 */
const vi = {
  nav: 'Dọn lời đánh giá',
  title: 'Dọn lời đánh giá của nhà cung cấp',
  intro:
    'Một số sản phẩm nhập từ nhà cung cấp còn đoạn "Đánh giá" ở cuối mô tả, kèm tên và tuổi của người khen. Đó là chữ của nhà cung cấp, không phải khách của Lucy Spa. Xem trước từng sản phẩm, rồi dọn một lần. Chỉ phần "Đánh giá" bị bỏ; tên, giá, ảnh và phần mô tả còn lại giữ nguyên. Mọi lần dọn được ghi nhật ký cùng bản chữ cũ, và sản phẩm bị sửa sau lúc xem trước sẽ được bỏ qua.',
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
  empty: 'Không còn lời đánh giá nào của nhà cung cấp trong mô tả sản phẩm.',
  truncated:
    'Có nhiều sản phẩm hơn số hiển thị. Dọn xong, mở lại trang này để dọn tiếp phần còn lại.',
  loadFailed: 'Không tải được danh sách. Thử lại sau ít phút.',
  confirm: {
    title: 'Dọn lời đánh giá khỏi {count} sản phẩm?',
    body: 'Đoạn "Đánh giá" của nhà cung cấp sẽ biến mất khỏi mô tả. Khách sẽ thấy trang sản phẩm không còn đoạn này. Bản chữ cũ vẫn được giữ trong nhật ký.',
    confirm: 'Dọn {count} sản phẩm',
    facts: { products: 'Số sản phẩm', entries: 'Số lời đánh giá sẽ bỏ' },
  },
  done: 'Đã dọn {cleaned} sản phẩm.',
  doneSkipped: ' Bỏ qua {skipped} sản phẩm đã bị sửa hoặc không còn gì để dọn.',
  detail: {
    removed: 'Phần sẽ bị bỏ',
    after: 'Mô tả sau khi dọn',
    loadFailed: 'Không tải được chữ của sản phẩm này.',
    nothing: 'Sản phẩm này không còn gì để dọn.',
    code: 'Mã sản phẩm',
  },
};

export type ProductTextCleanupText = typeof vi;

const en: ProductTextCleanupText = {
  nav: 'Clean supplier comments',
  title: 'Clean the supplier’s customer comments',
  intro:
    'Some products imported from the supplier still end with a “Đánh giá” (reviews) block of praise with first names and ages. That is the supplier’s text, not Lucy Spa customers. Preview each product, then clean them in one go. Only the “Đánh giá” block is removed; the name, price, pictures and the rest of the description stay. Every clean-up is logged with the old text, and a product edited after the preview is skipped.',
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
  empty: 'No supplier comments are left in product descriptions.',
  truncated:
    'More products matched than are shown. Clean these, then reopen the page for the rest.',
  loadFailed: 'The list could not be loaded. Try again in a few minutes.',
  confirm: {
    title: 'Clean the comments from {count} products?',
    body: 'The supplier’s “Đánh giá” block will disappear from the description, so customers will see the product page without it. The old text stays in the audit log.',
    confirm: 'Clean {count} products',
    facts: { products: 'Products', entries: 'Comments to remove' },
  },
  done: 'Cleaned {cleaned} products.',
  doneSkipped: ' Skipped {skipped} products that were edited or have nothing left to clean.',
  detail: {
    removed: 'What will be removed',
    after: 'Description after cleaning',
    loadFailed: 'The text of this product could not be loaded.',
    nothing: 'Nothing is left to clean in this product.',
    code: 'Product code',
  },
};

export function productTextCleanupDictionary(locale: Locale): ProductTextCleanupText {
  return locale === 'en' ? en : vi;
}
