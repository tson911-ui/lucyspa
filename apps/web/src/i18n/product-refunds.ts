import type { Locale } from './locales';

/**
 * Phase 6 P6-13: texts of the product refund part of the case page (the list of refunds, the refund form, the correction form).
 * Short, natural Vietnamese; a spa, not a clinic. A refund is cash or a manual bank transfer made by hand: the system records it, it
 * never sends money and never keeps the customer's account number. Templates use `{name}` placeholders filled by `fill`.
 */
const vi = {
  required: 'Nhập mục này.',
  action: 'Hoàn tiền',
  title: 'Các lần hoàn tiền',
  empty: 'Chưa hoàn tiền lần nào.',
  loading: 'Đang tải các lần hoàn tiền…',
  states: {
    NOT_REFUNDED: 'Chưa hoàn',
    PARTIALLY_REFUNDED: 'Đã hoàn một phần',
    REFUNDED: 'Đã hoàn hết',
  },
  methods: { CASH: 'Tiền mặt', BANK_TRANSFER_MANUAL: 'Chuyển khoản thủ công' },
  restocks: { SELLABLE: 'Bán lại được', NOT_SELLABLE: 'Không bán lại được' },
  summary: {
    state: 'Tình trạng dòng hàng',
    refundedUnits: 'Số lượng đã hoàn',
    refundedUnitsOf: '{refunded} trên {sold} của dòng hàng',
    caseUnits: 'Hồ sơ này',
    caseUnitsOf: 'Đã hoàn {refunded} trên {quantity}, còn {left}',
    paid: 'Khách đã trả cho dòng hàng',
    refunded: 'Đã hoàn cho dòng hàng',
  },
  blocked: {
    NOT_ACCEPTED_AS_REFUND:
      'Hồ sơ này chưa được chấp nhận theo cách hoàn tiền nên chưa hoàn tiền được.',
    INVOICE_NOT_PAID: 'Hóa đơn không còn ở trạng thái đã thanh toán nên không hoàn tiền được.',
    NOTHING_LEFT: 'Đã hoàn đủ số lượng của hồ sơ này.',
    NOTHING_PAID: 'Khách không phải trả tiền cho dòng hàng này nên không có gì để hoàn.',
  },
  refund: {
    code: 'Mã hoàn tiền',
    when: '{name} · {time}',
    quantity: 'Số lượng',
    method: 'Cách hoàn',
    reference: 'Mã giao dịch',
    referenceFirst: 'Mã đã nhập lúc đầu',
    goods: 'Hàng trả về',
    lots: 'Nhập vào lô {lots}',
    noStock: 'Không đổi tồn kho',
    points: 'Điểm Beauty',
    pointsTaken: 'Đã thu hồi {points} điểm',
    pointsShort: 'Đã thu hồi {points} điểm; thiếu {short} điểm vì số dư không đủ',
    pointsNone: 'Chưa có điểm nào bị thu hồi',
    reason: 'Lý do',
    corrections: 'Sửa mã giao dịch',
    correctionLine: '{reference} · {name} · {time}',
  },
  form: {
    title: 'Hoàn tiền sản phẩm',
    description:
      'Ghi lại lần hoàn tiền mặt hoặc chuyển khoản thủ công cho khách. Hệ thống không tự chuyển tiền và không lưu số tài khoản của khách.',
    quantity: 'Số lượng hoàn',
    quantityHint: 'Tối đa {max} trong hồ sơ này.',
    amount: 'Số tiền hoàn: {amount}',
    amountHint:
      'Bằng phần khách thực trả cho số lượng này, đã trừ giảm giá. Hệ thống tính lại khi lưu.',
    noAmount: 'Không tính được số tiền hoàn. Kiểm tra lại số lượng.',
    method: 'Cách hoàn',
    reference: 'Mã giao dịch chuyển khoản',
    referenceHint:
      'Chỉ nhập mã giao dịch của ngân hàng (chữ, số, dấu . _ / -). Không nhập số tài khoản của khách.',
    goods: 'Hàng khách trả',
    goodsSellable: 'Còn bán lại được',
    goodsSellableHint:
      'Hàng nhập lại kho thành một lô mới mang tên hồ sơ, giữ hạn dùng của lô đã bán.',
    goodsNotSellable: 'Không bán lại được',
    goodsNotSellableHint: 'Kho không thay đổi. Dùng khi hàng đã mở, hỏng hoặc hết hạn.',
    reason: 'Lý do hoàn tiền',
    reasonHint: 'Ghi vào nhật ký. Ví dụ: khách trả hàng đổi ý, đã hoàn tiền mặt tại quầy.',
    submit: 'Hoàn tiền',
    submitting: 'Đang ghi nhận…',
    done: 'Đã ghi nhận hoàn tiền {code}: {amount}.',
    warning:
      'Chỉ ghi nhận sau khi bạn đã đưa tiền hoặc chuyển khoản cho khách. Lần hoàn không sửa được; mã chuyển khoản gõ sai thì sửa ở mục "Sửa mã giao dịch".',
    pointsNote:
      'Điểm Beauty đã tích từ hóa đơn sẽ được thu hồi theo phần đã hoàn. Điểm giới thiệu và ví điểm Spa không bị trừ. Voucher hoặc quà đã dùng trên hóa đơn không tự trả lại.',
  },
  correct: {
    action: 'Sửa mã giao dịch',
    title: 'Sửa mã giao dịch chuyển khoản',
    description:
      'Lần hoàn tiền không bị sửa. Hệ thống ghi thêm một dòng sửa và mã mới được dùng từ bây giờ.',
    which: 'Lần hoàn tiền',
    reference: 'Mã giao dịch mới',
    reason: 'Lý do sửa',
    submit: 'Lưu mã mới',
    submitting: 'Đang lưu…',
    done: 'Đã sửa mã giao dịch.',
  },
  errors: {
    REFUND_CASE_NOT_READY: 'Chỉ hoàn tiền cho hồ sơ đã được chấp nhận theo cách hoàn tiền.',
    REFUND_QUANTITY_EXCEEDED: 'Số lượng hoàn nhiều hơn số còn lại của hồ sơ này.',
    REFUND_NOTHING_PAID: 'Khách không phải trả tiền cho phần hàng này nên không có gì để hoàn.',
    REFUND_STOCK_PENDING:
      'Kho chưa ghi nhận việc bán hàng này. Thử lại sau ít phút, hoặc chọn "Không bán lại được".',
    INVOICE_HAS_REFUND:
      'Hóa đơn đã có hoàn tiền nên giữ nguyên các lần thanh toán và không đảo hay hủy được.',
    INVOICE_STATE_INVALID: 'Hóa đơn không còn ở trạng thái đã thanh toán.',
    conflict:
      'Dữ liệu vừa được người khác thay đổi. Đã tải lại dữ liệu mới, hãy kiểm tra rồi thử lại.',
    fields: {
      quantity: 'Số lượng không hợp lệ.',
      method: 'Chọn cách hoàn.',
      bankReference:
        'Mã giao dịch chỉ gồm chữ, số và dấu . _ / - (4 đến 64 ký tự), không có khoảng trắng.',
      restock: 'Chọn hàng trả về bán lại được hay không.',
      reason: 'Nhập lý do (tối đa 500 ký tự).',
    },
  },
};

type Dictionary = typeof vi;

const en: Dictionary = {
  required: 'Fill in this field.',
  action: 'Refund',
  title: 'Refunds made',
  empty: 'Nothing has been refunded yet.',
  loading: 'Loading the refunds…',
  states: {
    NOT_REFUNDED: 'Not refunded',
    PARTIALLY_REFUNDED: 'Partly refunded',
    REFUNDED: 'Fully refunded',
  },
  methods: { CASH: 'Cash', BANK_TRANSFER_MANUAL: 'Manual bank transfer' },
  restocks: { SELLABLE: 'Can be sold again', NOT_SELLABLE: 'Cannot be sold again' },
  summary: {
    state: 'State of the line',
    refundedUnits: 'Units refunded',
    refundedUnitsOf: '{refunded} of {sold} on the line',
    caseUnits: 'This case',
    caseUnitsOf: '{refunded} of {quantity} refunded, {left} left',
    paid: 'Paid by the customer for the line',
    refunded: 'Refunded for the line',
  },
  blocked: {
    NOT_ACCEPTED_AS_REFUND: 'This case was not accepted as a refund, so nothing can be refunded.',
    INVOICE_NOT_PAID: 'The invoice is no longer paid, so nothing can be refunded.',
    NOTHING_LEFT: 'Every unit of this case has been refunded.',
    NOTHING_PAID: 'The customer paid nothing for this line, so there is nothing to refund.',
  },
  refund: {
    code: 'Refund code',
    when: '{name} · {time}',
    quantity: 'Quantity',
    method: 'Method',
    reference: 'Transfer reference',
    referenceFirst: 'Reference first typed',
    goods: 'Returned goods',
    lots: 'Put back in lot {lots}',
    noStock: 'Stock unchanged',
    points: 'Beauty points',
    pointsTaken: '{points} points taken back',
    pointsShort: '{points} points taken back; {short} short because the balance was too small',
    pointsNone: 'No points taken back',
    reason: 'Reason',
    corrections: 'Reference corrections',
    correctionLine: '{reference} · {name} · {time}',
  },
  form: {
    title: 'Refund a product',
    description:
      'Record a cash or manual bank transfer refund to the customer. The system does not send money and never stores the customer’s account number.',
    quantity: 'Units to refund',
    quantityHint: 'At most {max} in this case.',
    amount: 'Refund amount: {amount}',
    amountHint:
      'What the customer actually paid for these units, after discounts. It is computed again when you save.',
    noAmount: 'The refund amount cannot be worked out. Check the quantity.',
    method: 'Method',
    reference: 'Bank transfer reference',
    referenceHint:
      'Only the bank’s transaction reference (letters, digits, . _ / -). Never the customer’s account number.',
    goods: 'Goods brought back',
    goodsSellable: 'Can be sold again',
    goodsSellableHint:
      'The goods go back into stock in a new lot named after the case, keeping the expiry of the lot they were sold from.',
    goodsNotSellable: 'Cannot be sold again',
    goodsNotSellableHint: 'Stock does not change. Use it for opened, damaged or expired goods.',
    reason: 'Reason for the refund',
    reasonHint:
      'Kept in the audit log. For example: change of mind, refunded in cash at the counter.',
    submit: 'Refund',
    submitting: 'Recording…',
    done: 'Refund {code} recorded: {amount}.',
    warning:
      'Record it only after you have handed over the cash or sent the transfer. A refund cannot be edited; a mistyped transfer reference is fixed under “Correct reference”.',
    pointsNote:
      'The Beauty points earned on the invoice are taken back in proportion to what is refunded. Referral points and the Spa wallet are not touched. A voucher or gift used on the invoice is not given back.',
  },
  correct: {
    action: 'Correct reference',
    title: 'Correct the transfer reference',
    description:
      'The refund itself is not edited. A correction line is added and the new reference is used from now on.',
    which: 'Refund',
    reference: 'New reference',
    reason: 'Reason for the correction',
    submit: 'Save the new reference',
    submitting: 'Saving…',
    done: 'The reference was corrected.',
  },
  errors: {
    REFUND_CASE_NOT_READY: 'Only a case accepted as a refund can be refunded.',
    REFUND_QUANTITY_EXCEEDED: 'More units than this case has left to refund.',
    REFUND_NOTHING_PAID:
      'The customer paid nothing for these units, so there is nothing to refund.',
    REFUND_STOCK_PENDING:
      'Stock has not recorded this sale yet. Try again in a moment, or choose “Cannot be sold again”.',
    INVOICE_HAS_REFUND:
      'An invoice with a refund keeps its payments; they cannot be reversed or cancelled.',
    INVOICE_STATE_INVALID: 'The invoice is no longer paid.',
    conflict:
      'The data was just changed by someone else. The latest data was loaded; check it and try again.',
    fields: {
      quantity: 'The quantity is not valid.',
      method: 'Choose the method.',
      bankReference:
        'The reference has only letters, digits and . _ / - (4 to 64 characters), with no spaces.',
      restock: 'Say whether the goods can be sold again.',
      reason: 'Enter a reason (500 characters at most).',
    },
  },
};

export function productRefundsDictionary(locale: Locale): Dictionary {
  return locale === 'en' ? en : vi;
}

export type ProductRefundsDictionary = Dictionary;
