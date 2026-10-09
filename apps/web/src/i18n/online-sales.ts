import type { Locale } from './locales';

/**
 * Phase 6 P6-19: the staff page "Bán online" (the master switch and the settings of online ordering). Short natural Vietnamese; the
 * Owner decided delivery is free, so the fee block says plainly that it is off and should stay off unless needed.
 */
const vi = {
  title: 'Bán online',
  intro:
    'Bật bán mỹ phẩm online cho thành viên, đặt giới hạn đơn hàng, lời hẹn giao hàng và chính sách khách phải đồng ý.',
  noAccess: 'Bạn không có quyền xem cài đặt bán online.',
  master: {
    title: 'Công tắc bán online',
    on: 'Đang bật',
    off: 'Đang tắt',
    onBody: 'Thành viên thấy nút mua trên website, thêm vào giỏ và thanh toán online bằng PayOS.',
    offBody:
      'Website không có nút mua. Khách chỉ thấy "Mua tại cửa hàng". Công tắc luôn tắt cho đến khi bạn bật.',
    turnOn: 'Bật bán online',
    turnOff: 'Tắt bán online',
    confirmOnTitle: 'Bật bán online?',
    /** With {branch}. */
    confirmOnBody:
      'Thành viên sẽ thấy nút mua ngay và đặt hàng online, giao hàng miễn phí. Hàng được gửi từ chi nhánh {branch}.',
    confirmOffTitle: 'Tắt bán online?',
    confirmOffBody:
      'Nút mua biến mất khỏi website và khách không đặt thêm được. Đơn đã thanh toán vẫn được xử lý như bình thường.',
    busy: 'Đang lưu…',
    paymentMissing:
      'Máy chủ chưa kết nối PayOS nên chưa bật được bán online. Hãy báo bộ phận kỹ thuật.',
    needsBranch: 'Hãy chọn chi nhánh xuất hàng và lưu trước khi bật.',
    dirty: 'Hãy lưu hoặc hoàn tác thay đổi bên dưới trước khi bật hoặc tắt.',
    done: 'Đã bật bán online.',
    doneOff: 'Đã tắt bán online.',
  },
  fulfilment: {
    title: 'Xuất hàng',
    hint: 'Cả đơn được gửi một lần từ chi nhánh này, đi toàn quốc.',
    branch: 'Chi nhánh xuất hàng',
    branchPlaceholder: 'Chọn chi nhánh',
  },
  payment: {
    title: 'Thanh toán',
    hint: 'Khách trả đủ tiền hàng trước bằng PayOS. Không thu tiền khi giao.',
    timeout: 'Hạn thanh toán (phút)',
    timeoutHint: 'Đơn chưa thanh toán sau thời gian này sẽ tự hủy. Từ 5 đến 120.',
    maxUnpaid: 'Số đơn chưa thanh toán tối đa',
    maxUnpaidHint: 'Mỗi thành viên giữ được tối đa bấy nhiêu đơn chờ thanh toán. Từ 1 đến 20.',
  },
  cart: {
    title: 'Giỏ hàng',
    hint: 'Giới hạn để giỏ hàng gọn và tránh đặt nhầm.',
    maxLines: 'Số dòng tối đa trong giỏ',
    maxLinesHint: 'Từ 1 đến 100.',
    maxQuantity: 'Số lượng tối đa mỗi sản phẩm',
    maxQuantityHint: 'Từ 1 đến 100.',
  },
  promise: {
    title: 'Hẹn giao hàng',
    hint: 'Website nói rõ đây là dự kiến, không phải cam kết.',
    shipWithin: 'Gửi hàng trong (ngày làm việc)',
    shipWithinHint: 'Từ 1 đến 30.',
    transitMin: 'Vận chuyển từ (ngày)',
    transitMax: 'Vận chuyển đến (ngày)',
    transitHint: 'Từ 0 đến 60. Số lớn phải không nhỏ hơn số nhỏ.',
    /** With {days}, {min}, {max}. */
    preview:
      'Khách đọc: gửi trong {days} ngày làm việc, vận chuyển dự kiến {min} đến {max} ngày, không phải cam kết.',
  },
  fee: {
    title: 'Phí giao hàng',
    hint: 'Cửa hàng đang miễn phí giao hàng cho mọi đơn online.',
    switch: 'Thu phí giao hàng',
    offHelp: 'Đang miễn phí giao hàng cho mọi đơn. Chỉ bật khi cần.',
    onHelp:
      'Khách phải trả phí giao hàng khi đặt đơn. Bình thường nên tắt vì cửa hàng đang miễn phí giao hàng.',
    amount: 'Phí giao hàng cố định',
    amountHint: 'Tính cho mỗi đơn, bằng đồng.',
    threshold: 'Miễn phí giao hàng từ',
    thresholdHint: 'Đơn từ mức này trở lên không mất phí. Để trống nếu không có.',
    unit: '₫',
  },
  policy: {
    title: 'Chính sách mua hàng online',
    hint: 'Khách phải đọc và đồng ý khi đặt hàng. Để trống thì dùng bản nháp mặc định. Sửa nội dung sẽ tạo phiên bản mới và khách phải đồng ý lại.',
    vi: 'Chính sách (tiếng Việt)',
    en: 'Chính sách (English)',
    emptyHint: 'Để trống để dùng bản nháp mặc định.',
    /** With {version}. */
    version: 'Phiên bản chính sách hiện tại: {version}',
    /** With {count}, {max}. */
    count: '{count} / {max} ký tự',
    defaultVi: 'Bản nháp mặc định (tiếng Việt)',
    defaultEn: 'Bản nháp mặc định (English)',
    defaultNote: 'Chỉ gồm những điều đã được duyệt. Bản này đang dùng khi ô bên trên để trống.',
  },
  problems: {
    fulfilmentBranchId: 'Chọn chi nhánh xuất hàng.',
    unpaidTimeoutMinutes: 'Nhập số từ 5 đến 120.',
    maxUnpaidOrders: 'Nhập số từ 1 đến 20.',
    maxCartLines: 'Nhập số từ 1 đến 100.',
    maxLineQuantity: 'Nhập số từ 1 đến 100.',
    shipWithinWorkingDays: 'Nhập số từ 1 đến 30.',
    transitDaysMin: 'Nhập số từ 0 đến 60.',
    transitDaysMax: 'Nhập số từ 0 đến 60, không nhỏ hơn số bên cạnh.',
    shippingFeeVnd: 'Nhập số tiền hợp lệ.',
    freeShippingThresholdVnd: 'Nhập số tiền hợp lệ hoặc để trống.',
    policyVi: 'Nội dung quá dài hoặc có ký tự không hợp lệ.',
    policyEn: 'Nội dung quá dài hoặc có ký tự không hợp lệ.',
  },
  errors: {
    PAYMENT_METHOD_UNAVAILABLE:
      'Máy chủ chưa kết nối PayOS nên chưa bật được bán online. Hãy báo bộ phận kỹ thuật.',
    ONLINE_SALES_NEEDS_BRANCH: 'Hãy chọn chi nhánh xuất hàng trước khi bật.',
    CONFLICT: 'Cài đặt vừa được thay đổi ở nơi khác. Trang đã tải lại, hãy kiểm tra rồi lưu lại.',
  },
  save: 'Lưu thay đổi',
  saving: 'Đang lưu…',
  revert: 'Hoàn tác',
  saved: 'Đã lưu cài đặt bán online.',
};

export type OnlineSalesText = typeof vi;

const en: OnlineSalesText = {
  title: 'Online sales',
  intro:
    'Open online selling of cosmetics to members, and set the order limits, the delivery promise and the policy customers must accept.',
  noAccess: 'You are not allowed to see the online sales settings.',
  master: {
    title: 'Online sales switch',
    on: 'On',
    off: 'Off',
    onBody:
      'Members see the buy button on the website, add products to the cart and pay online with PayOS.',
    offBody:
      'The website has no buy button. Visitors only see "Buy in store". The switch stays off until you turn it on.',
    turnOn: 'Turn on online sales',
    turnOff: 'Turn off online sales',
    confirmOnTitle: 'Turn on online sales?',
    confirmOnBody:
      'Members will see the buy button right away and can order online, with free delivery. Goods are shipped from {branch}.',
    confirmOffTitle: 'Turn off online sales?',
    confirmOffBody:
      'The buy button disappears from the website and no new orders can be placed. Orders already paid are handled as usual.',
    busy: 'Saving…',
    paymentMissing:
      'The server is not connected to PayOS yet, so online sales cannot be turned on. Ask the technical team.',
    needsBranch: 'Choose the shipping branch and save before turning on.',
    dirty: 'Save or revert the changes below before turning online sales on or off.',
    done: 'Online sales are on.',
    doneOff: 'Online sales are off.',
  },
  fulfilment: {
    title: 'Shipping',
    hint: 'A whole order is shipped once from this branch, nationwide.',
    branch: 'Shipping branch',
    branchPlaceholder: 'Choose a branch',
  },
  payment: {
    title: 'Payment',
    hint: 'Customers pay the full price in advance with PayOS. No cash on delivery.',
    timeout: 'Payment deadline (minutes)',
    timeoutHint: 'An order not paid after this time is cancelled automatically. 5 to 120.',
    maxUnpaid: 'Most unpaid orders',
    maxUnpaidHint: 'How many orders waiting for payment one member can hold. 1 to 20.',
  },
  cart: {
    title: 'Cart',
    hint: 'Limits that keep the cart tidy and avoid mistakes.',
    maxLines: 'Most lines in the cart',
    maxLinesHint: '1 to 100.',
    maxQuantity: 'Most units of one product',
    maxQuantityHint: '1 to 100.',
  },
  promise: {
    title: 'Delivery promise',
    hint: 'The website says clearly that this is an estimate, not a promise.',
    shipWithin: 'Ship within (working days)',
    shipWithinHint: '1 to 30.',
    transitMin: 'Transit from (days)',
    transitMax: 'Transit to (days)',
    transitHint: '0 to 60. The larger number must not be smaller than the other.',
    preview:
      'Customers read: shipped within {days} working days, transit expected {min} to {max} days; not a promise.',
  },
  fee: {
    title: 'Delivery fee',
    hint: 'The shop currently delivers every online order for free.',
    switch: 'Charge a delivery fee',
    offHelp: 'Delivery is free for every order now. Turn on only when needed.',
    onHelp:
      'Customers pay the delivery fee when they order. Normally keep this off, because delivery is free.',
    amount: 'Fixed delivery fee',
    amountHint: 'Charged per order, in dong.',
    threshold: 'Free delivery from',
    thresholdHint: 'Orders at or above this amount pay no fee. Leave empty for none.',
    unit: '₫',
  },
  policy: {
    title: 'Online purchase policy',
    hint: 'Customers must read and accept it when they order. Leave empty to use the default draft. Changing the text makes a new version and customers must accept again.',
    vi: 'Policy (Vietnamese)',
    en: 'Policy (English)',
    emptyHint: 'Leave empty to use the default draft.',
    version: 'Current policy version: {version}',
    count: '{count} / {max} characters',
    defaultVi: 'Default draft (Vietnamese)',
    defaultEn: 'Default draft (English)',
    defaultNote: 'Contains only what was approved. It is used while the box above is empty.',
  },
  problems: {
    fulfilmentBranchId: 'Choose the shipping branch.',
    unpaidTimeoutMinutes: 'Enter a number from 5 to 120.',
    maxUnpaidOrders: 'Enter a number from 1 to 20.',
    maxCartLines: 'Enter a number from 1 to 100.',
    maxLineQuantity: 'Enter a number from 1 to 100.',
    shipWithinWorkingDays: 'Enter a number from 1 to 30.',
    transitDaysMin: 'Enter a number from 0 to 60.',
    transitDaysMax: 'Enter a number from 0 to 60, not smaller than the one beside it.',
    shippingFeeVnd: 'Enter a valid amount.',
    freeShippingThresholdVnd: 'Enter a valid amount or leave empty.',
    policyVi: 'The text is too long or has invalid characters.',
    policyEn: 'The text is too long or has invalid characters.',
  },
  errors: {
    PAYMENT_METHOD_UNAVAILABLE:
      'The server is not connected to PayOS yet, so online sales cannot be turned on. Ask the technical team.',
    ONLINE_SALES_NEEDS_BRANCH: 'Choose the shipping branch before turning on.',
    CONFLICT:
      'The settings were changed elsewhere. The page was reloaded; check them and save again.',
  },
  save: 'Save changes',
  saving: 'Saving…',
  revert: 'Revert',
  saved: 'Online sales settings saved.',
};

export function onlineSalesDictionary(locale: Locale): OnlineSalesText {
  return locale === 'vi' ? vi : en;
}
