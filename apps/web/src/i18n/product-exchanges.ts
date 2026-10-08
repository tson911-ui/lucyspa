import type { Locale } from './locales';

/**
 * Phase 6 P6-14: texts of the exchange part of the case page (the card, the exchange form, the completion and the correction forms).
 * Short, natural Vietnamese; a spa, not a clinic. An exchange gives back the units of an accepted case and hands over the same number
 * of another (or the same) item that is in stock. The difference is paid on the exchange invoice or handed back by cash or a manual
 * transfer made by hand: the system records it, it never sends money and never keeps the customer's account number. Templates use
 * `{name}` placeholders filled by `fill`.
 */
const vi = {
  required: 'Nhập mục này.',
  action: 'Đổi hàng',
  title: 'Các lần đổi hàng',
  empty: 'Chưa đổi hàng lần nào.',
  loading: 'Đang tải các lần đổi hàng…',
  statuses: {
    AWAITING_PAYMENT: 'Chờ khách thanh toán',
    AWAITING_COMPLETION: 'Đã thanh toán, chờ nhận lại hàng cũ',
    COMPLETED: 'Đã hoàn tất',
    CANCELLED: 'Đã hủy',
  },
  rules: {
    SAME_ITEM: 'Đổi cùng sản phẩm: không tính chênh lệch',
    PRICE_DIFFERENCE: 'Đổi sang sản phẩm khác: tính chênh lệch giá',
  },
  methods: { CASH: 'Tiền mặt', BANK_TRANSFER_MANUAL: 'Chuyển khoản thủ công' },
  restocks: { SELLABLE: 'Bán lại được', NOT_SELLABLE: 'Không bán lại được' },
  summary: {
    quantity: 'Số lượng đổi',
    credit: 'Khách đã trả cho phần hàng này',
  },
  blocked: {
    NOT_ACCEPTED_AS_EXCHANGE: 'Hồ sơ này chưa được chấp nhận theo cách đổi hàng nên chưa đổi được.',
    INVOICE_NOT_PAID: 'Hóa đơn không còn ở trạng thái đã thanh toán nên không đổi hàng được.',
    NOTHING_PAID_NO_CREDIT: 'Khách không phải trả tiền cho dòng hàng này nên không có gì để đổi.',
    ALREADY_EXCHANGED: 'Hồ sơ này đã được đổi hàng xong.',
    OPEN_EXCHANGE:
      'Dòng hàng này đang có một lần đổi chưa xong. Hoàn tất hoặc hủy lần đó trước khi làm việc khác trên dòng hàng.',
    LINE_IN_USE: 'Số lượng còn lại của dòng hàng không đủ cho hồ sơ này.',
  },
  exchange: {
    when: '{name} · {time}',
    replacement: 'Hàng mới',
    replacementLine: '{name} ({sku}) × {quantity}, giá {price}',
    returned: 'Hàng khách trả',
    credit: 'Khách đã trả cho phần hàng cũ',
    gross: 'Giá hàng mới hôm nay',
    payable: 'Khách trả thêm',
    refund: 'Hoàn lại cho khách',
    none: 'Không có chênh lệch',
    reference: 'Mã giao dịch',
    referenceFirst: 'Mã đã nhập lúc đầu',
    invoice: 'Hóa đơn đổi hàng',
    invoiceLine: '{code} · {total}',
    invoiceBalance: 'còn thu {amount}',
    openInvoice: 'Mở hóa đơn',
    goods: 'Hàng khách trả',
    goodsPending: 'Chưa nhận lại hàng cũ',
    lots: 'Nhập vào lô {lots}',
    noStock: 'Không đổi tồn kho',
    points: 'Điểm Beauty cộng thêm',
    pointsEarned: 'Cộng {points} điểm trên phần khách trả thêm',
    pointsNone: 'Không cộng điểm; điểm cũ giữ nguyên',
    reason: 'Lý do',
    corrections: 'Sửa mã giao dịch',
    correctionLine: '{reference} · {name} · {time}',
  },
  form: {
    title: 'Đổi hàng',
    description:
      'Khách trả lại số hàng của hồ sơ này và nhận cùng số lượng của một sản phẩm đang có trong kho. Giá hàng mới là giá hôm nay; khách chỉ trả phần chênh với số tiền đã trả cho hàng cũ.',
    product: 'Hàng mới',
    productHint:
      'Tìm theo tên, thương hiệu, loại hoặc mã SKU. Chỉ đổi được sang hàng còn trong kho.',
    searchPlaceholder: 'Gõ tên hoặc mã SKU…',
    loading: 'Đang tìm…',
    none: 'Không có sản phẩm phù hợp.',
    more: 'Còn nhiều kết quả khác. Gõ thêm để thu hẹp.',
    needProduct: 'Chọn hàng mới.',
    available: '{count} có sẵn',
    outOfStock: 'hết hàng',
    needStock: 'Hàng mới không đủ số lượng trong kho.',
    seller: 'Người bán ghi trên hóa đơn đổi',
    sellerHint: 'Mặc định là người đã bán dòng hàng cũ.',
    sellerPlaceholder: 'Chọn người bán',
    needSeller: 'Chọn người bán.',
    figures: 'Tiền của lần đổi',
    credit: 'Khách đã trả cho hàng cũ',
    gross: 'Giá hàng mới hôm nay',
    payable: 'Khách trả thêm',
    refund: 'Hoàn lại cho khách',
    none0: 'Không có chênh lệch',
    sameItem:
      'Đổi cùng sản phẩm: hàng mới được đổi miễn phí, không tính chênh lệch dù giá hôm nay khác.',
    payableNote:
      'Hóa đơn đổi hàng được tạo ngay. Khách thanh toán phần chênh ở đó như một hóa đơn thường (tiền mặt hoặc PayOS), rồi bạn bấm "Hoàn tất đổi" để nhận lại hàng cũ.',
    refundNote:
      'Hóa đơn đổi hàng được tạo và tất toán ngay. Chỉ ghi nhận sau khi bạn đã đưa tiền hoặc chuyển khoản cho khách.',
    equalNote: 'Hóa đơn đổi hàng được tạo và tất toán ngay.',
    method: 'Cách hoàn phần chênh',
    reference: 'Mã giao dịch chuyển khoản',
    referenceHint:
      'Chỉ nhập mã giao dịch của ngân hàng (chữ, số, dấu . _ / -). Không nhập số tài khoản của khách.',
    goods: 'Hàng khách trả',
    goodsSellable: 'Còn bán lại được',
    goodsSellableHint:
      'Hàng nhập lại kho thành một lô mới mang tên hồ sơ, giữ hạn dùng của lô đã bán.',
    goodsNotSellable: 'Không bán lại được',
    goodsNotSellableHint: 'Kho không thay đổi. Dùng khi hàng đã mở, hỏng hoặc hết hạn.',
    goodsLater:
      'Bạn sẽ chọn hàng cũ bán lại được hay không khi bấm "Hoàn tất đổi", sau khi khách thanh toán.',
    reason: 'Lý do đổi hàng',
    reasonHint: 'Ghi vào nhật ký. Ví dụ: sản phẩm lỗi, khách đổi sang loại khác.',
    submit: 'Đổi hàng',
    submitting: 'Đang ghi nhận…',
    done: 'Đã tạo lần đổi {code}.',
    warning:
      'Mỗi lần đổi cần nhập lại mật khẩu, và nếu có hoàn tiền thì Chủ nhận thông báo. Lần đổi không sửa được; mã chuyển khoản gõ sai thì sửa ở mục "Sửa mã giao dịch".',
    pointsNote:
      'Điểm Beauty đã tích từ hóa đơn gốc được giữ nguyên. Điểm chỉ được cộng thêm trên phần khách trả thêm. Đổi sang hàng bằng giá hoặc rẻ hơn không cộng và không trừ điểm. Voucher hoặc quà đã dùng trên hóa đơn gốc không tự trả lại.',
  },
  invoicePage: {
    intro: 'Hóa đơn của lần đổi hàng {code} (hồ sơ {case}) · {branch}',
    creditRow: 'Trừ số tiền đã trả cho hàng cũ',
  },
  complete: {
    action: 'Hoàn tất đổi',
    title: 'Nhận lại hàng cũ',
    description:
      'Khách đã thanh toán hóa đơn đổi hàng. Cho biết hàng khách trả có bán lại được không để hoàn tất lần đổi.',
    which: 'Lần đổi',
    submit: 'Hoàn tất đổi',
    submitting: 'Đang ghi nhận…',
    done: 'Đã hoàn tất lần đổi.',
  },
  correct: {
    action: 'Sửa mã giao dịch',
    title: 'Sửa mã giao dịch chuyển khoản',
    description:
      'Lần đổi không bị sửa. Hệ thống ghi thêm một dòng sửa và mã mới được dùng từ bây giờ.',
    which: 'Lần đổi',
    reference: 'Mã giao dịch mới',
    reason: 'Lý do sửa',
    submit: 'Lưu mã mới',
    submitting: 'Đang lưu…',
    done: 'Đã sửa mã giao dịch.',
  },
  errors: {
    EXCHANGE_CASE_NOT_READY: 'Chỉ đổi hàng cho hồ sơ đã được chấp nhận theo cách đổi hàng.',
    EXCHANGE_IN_PROGRESS:
      'Dòng hàng này đang có một lần đổi chưa xong. Hoàn tất hoặc hủy lần đó trước.',
    EXCHANGE_ALREADY_DONE: 'Hồ sơ này đã được đổi hàng xong.',
    EXCHANGE_NOTHING_PAID: 'Khách không phải trả tiền cho phần hàng này nên không có gì để đổi.',
    EXCHANGE_FIGURES_CHANGED:
      'Giá hoặc số tiền khách đã trả vừa thay đổi. Đã tải lại số liệu mới, hãy kiểm tra rồi bấm lại.',
    EXCHANGE_NOT_PAID: 'Hóa đơn đổi hàng chưa được thanh toán đủ.',
    EXCHANGE_STOCK_PENDING:
      'Kho chưa ghi nhận việc bán hàng này. Thử lại sau ít phút, hoặc chọn "Không bán lại được".',
    INVOICE_HAS_EXCHANGE:
      'Hóa đơn có lần đổi hàng nên giữ nguyên các lần thanh toán và không đảo hay hủy được.',
    PRODUCT_OUT_OF_STOCK: 'Hàng mới không đủ số lượng trong kho.',
    PRODUCT_NOT_SELLABLE: 'Sản phẩm này hiện không bán được.',
    PRODUCT_SELLER_INVALID: 'Người bán phải là nhân viên đang làm ở chi nhánh này.',
    PRODUCT_SELLER_REQUIRED: 'Chọn người bán.',
    INVOICE_STATE_INVALID: 'Hóa đơn không còn ở trạng thái đã thanh toán.',
    conflict:
      'Dữ liệu vừa được người khác thay đổi. Đã tải lại dữ liệu mới, hãy kiểm tra rồi thử lại.',
    fields: {
      variantId: 'Chọn hàng mới.',
      method: 'Chọn cách hoàn.',
      refundMethod: 'Chọn cách hoàn phần chênh.',
      bankReference:
        'Mã giao dịch chỉ gồm chữ, số và dấu . _ / - (4 đến 64 ký tự), không có khoảng trắng.',
      restock: 'Chọn hàng khách trả bán lại được hay không.',
      reason: 'Nhập lý do (tối đa 500 ký tự).',
      sellerUserId: 'Chọn người bán.',
    },
  },
};

type Dictionary = typeof vi;

const en: Dictionary = {
  required: 'Fill in this field.',
  action: 'Exchange',
  title: 'Exchanges made',
  empty: 'Nothing has been exchanged yet.',
  loading: 'Loading the exchanges…',
  statuses: {
    AWAITING_PAYMENT: 'Waiting for the customer to pay',
    AWAITING_COMPLETION: 'Paid, waiting to take the old goods in',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  },
  rules: {
    SAME_ITEM: 'Same product: no price difference',
    PRICE_DIFFERENCE: 'Another product: price difference applies',
  },
  methods: { CASH: 'Cash', BANK_TRANSFER_MANUAL: 'Manual bank transfer' },
  restocks: { SELLABLE: 'Can be sold again', NOT_SELLABLE: 'Cannot be sold again' },
  summary: {
    quantity: 'Units to exchange',
    credit: 'Paid by the customer for these units',
  },
  blocked: {
    NOT_ACCEPTED_AS_EXCHANGE:
      'This case was not accepted as an exchange, so nothing can be exchanged.',
    INVOICE_NOT_PAID: 'The invoice is no longer paid, so nothing can be exchanged.',
    NOTHING_PAID_NO_CREDIT:
      'The customer paid nothing for this line, so there is nothing to exchange.',
    ALREADY_EXCHANGED: 'This case has already been exchanged.',
    OPEN_EXCHANGE:
      'This line has an exchange that is not finished. Complete or cancel it before doing anything else on the line.',
    LINE_IN_USE: 'The units left on the line are not enough for this case.',
  },
  exchange: {
    when: '{name} · {time}',
    replacement: 'New goods',
    replacementLine: '{name} ({sku}) × {quantity}, price {price}',
    returned: 'Goods brought back',
    credit: 'Paid for the old goods',
    gross: 'Price of the new goods today',
    payable: 'Customer pays more',
    refund: 'Handed back to the customer',
    none: 'No difference',
    reference: 'Transfer reference',
    referenceFirst: 'Reference first typed',
    invoice: 'Exchange invoice',
    invoiceLine: '{code} · {total}',
    invoiceBalance: '{amount} left to collect',
    openInvoice: 'Open the invoice',
    goods: 'Goods brought back',
    goodsPending: 'Old goods not taken in yet',
    lots: 'Put back in lot {lots}',
    noStock: 'Stock unchanged',
    points: 'Beauty points added',
    pointsEarned: '{points} points on the extra amount paid',
    pointsNone: 'No points added; the old points are kept',
    reason: 'Reason',
    corrections: 'Reference corrections',
    correctionLine: '{reference} · {name} · {time}',
  },
  form: {
    title: 'Exchange goods',
    description:
      'The customer gives back the units of this case and takes the same number of a product that is in stock. The new goods are priced today; the customer pays only the difference from what they paid for the old goods.',
    product: 'New goods',
    productHint:
      'Search by name, brand, variant or SKU. Only goods that are in stock can be exchanged for.',
    searchPlaceholder: 'Type a name or SKU…',
    loading: 'Searching…',
    none: 'No matching product.',
    more: 'More results exist. Type more to narrow them down.',
    needProduct: 'Choose the new goods.',
    available: '{count} available',
    outOfStock: 'sold out',
    needStock: 'There is not enough of the new goods in stock.',
    seller: 'Seller on the exchange invoice',
    sellerHint: 'Defaults to the seller of the old line.',
    sellerPlaceholder: 'Choose the seller',
    needSeller: 'Choose the seller.',
    figures: 'The money of the exchange',
    credit: 'Paid for the old goods',
    gross: 'Price of the new goods today',
    payable: 'Customer pays more',
    refund: 'Handed back to the customer',
    none0: 'No difference',
    sameItem:
      'Same product: the new goods are given free of charge with no price difference, whatever today’s price is.',
    payableNote:
      'The exchange invoice is made now. The customer pays the difference on it like any invoice (cash or PayOS), then you press “Complete the exchange” to take the old goods in.',
    refundNote:
      'The exchange invoice is made and settled at once. Record this only after you have handed over the cash or sent the transfer.',
    equalNote: 'The exchange invoice is made and settled at once.',
    method: 'How the difference is handed back',
    reference: 'Bank transfer reference',
    referenceHint:
      'Only the bank’s transaction reference (letters, digits, . _ / -). Never the customer’s account number.',
    goods: 'Goods brought back',
    goodsSellable: 'Can be sold again',
    goodsSellableHint:
      'The goods go back into stock in a new lot named after the case, keeping the expiry of the lot they were sold from.',
    goodsNotSellable: 'Cannot be sold again',
    goodsNotSellableHint: 'Stock does not change. Use it for opened, damaged or expired goods.',
    goodsLater:
      'You choose whether the old goods can be sold again when you press “Complete the exchange”, after the customer has paid.',
    reason: 'Reason for the exchange',
    reasonHint: 'Kept in the audit log. For example: faulty product, changed to another kind.',
    submit: 'Exchange',
    submitting: 'Recording…',
    done: 'Exchange {code} made.',
    warning:
      'Every exchange asks for your password again, and the Owner is notified when money is handed back. An exchange cannot be edited; a mistyped transfer reference is fixed under “Correct reference”.',
    pointsNote:
      'The Beauty points earned on the original invoice are kept. Points are added only on the extra amount the customer pays. An equal or cheaper replacement adds none and takes none. A voucher or gift used on the original invoice is not given back.',
  },
  invoicePage: {
    intro: 'Invoice of exchange {code} (case {case}) · {branch}',
    creditRow: 'Less what was paid for the old goods',
  },
  complete: {
    action: 'Complete the exchange',
    title: 'Take the old goods in',
    description:
      'The customer has paid the exchange invoice. Say whether the goods they brought back can be sold again to complete the exchange.',
    which: 'Exchange',
    submit: 'Complete the exchange',
    submitting: 'Recording…',
    done: 'The exchange is completed.',
  },
  correct: {
    action: 'Correct reference',
    title: 'Correct the transfer reference',
    description:
      'The exchange itself is not edited. A correction line is added and the new reference is used from now on.',
    which: 'Exchange',
    reference: 'New reference',
    reason: 'Reason for the correction',
    submit: 'Save the new reference',
    submitting: 'Saving…',
    done: 'The reference was corrected.',
  },
  errors: {
    EXCHANGE_CASE_NOT_READY: 'Only a case accepted as an exchange can be exchanged.',
    EXCHANGE_IN_PROGRESS:
      'This line has an exchange that is not finished. Complete or cancel it first.',
    EXCHANGE_ALREADY_DONE: 'This case has already been exchanged.',
    EXCHANGE_NOTHING_PAID:
      'The customer paid nothing for these units, so there is nothing to exchange.',
    EXCHANGE_FIGURES_CHANGED:
      'The price or what the customer paid just changed. The latest figures were loaded; check them and press again.',
    EXCHANGE_NOT_PAID: 'The exchange invoice is not fully paid yet.',
    EXCHANGE_STOCK_PENDING:
      'Stock has not recorded this sale yet. Try again in a moment, or choose “Cannot be sold again”.',
    INVOICE_HAS_EXCHANGE:
      'An invoice with an exchange keeps its payments; they cannot be reversed or cancelled.',
    PRODUCT_OUT_OF_STOCK: 'There is not enough of the new goods in stock.',
    PRODUCT_NOT_SELLABLE: 'This product cannot be sold now.',
    PRODUCT_SELLER_INVALID: 'The seller must be an active employee of this branch.',
    PRODUCT_SELLER_REQUIRED: 'Choose the seller.',
    INVOICE_STATE_INVALID: 'The invoice is no longer paid.',
    conflict:
      'The data was just changed by someone else. The latest data was loaded; check it and try again.',
    fields: {
      variantId: 'Choose the new goods.',
      method: 'Choose the method.',
      refundMethod: 'Choose how the difference is handed back.',
      bankReference:
        'The reference has only letters, digits and . _ / - (4 to 64 characters), with no spaces.',
      restock: 'Say whether the goods brought back can be sold again.',
      reason: 'Enter a reason (500 characters at most).',
      sellerUserId: 'Choose the seller.',
    },
  },
};

export function productExchangesDictionary(locale: Locale): Dictionary {
  return locale === 'en' ? en : vi;
}

export type ProductExchangesDictionary = Dictionary;
