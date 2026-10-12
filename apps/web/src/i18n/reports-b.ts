import type { Locale } from './locales';

/**
 * Phase 8 P8-10 (Wave B reports): texts of the sales, customers, staff and stock screens. Same words as `reports.ts`: "doanh thu" is money
 * collected minus money given back, "lượt đến" a completed visit, "hoàn lại" money given back to a customer. Lucy Spa is a spa: never "khám".
 * Labels of things that already have a name elsewhere (loyalty tiers and entries, stock movements) are read from their own dictionaries.
 */
interface Words {
  nav: { sales: string; customers: string; staff: string; stock: string };
  common: {
    truncated: string;
    noAccess: string;
    asOfNow: string;
    days: string;
    daysOptions: Record<'30' | '60' | '90' | '180', string>;
    total: string;
  };
  col: Record<string, string>;
  sales: {
    title: string;
    intro: string;
    tabs: { services: string; products: string; combos: string; discounts: string; online: string };
    by: { variant: string; brand: string; category: string };
    byLabel: string;
    other: string;
    empty: Record<'services' | 'products' | 'combos' | 'discounts' | 'online', string>;
    discountTypes: Record<string, string>;
    onlineStates: Record<string, string>;
    campaigns: string;
    kpi: {
      net: string;
      quantity: string;
      sold: string;
      revenue: string;
      sessionsUsed: string;
      sessionsRemaining: string;
      sessionsExpired: string;
      discount: string;
      discountInfo: string;
      discountedInvoices: string;
      discountShare: string;
      orders: string;
      awaiting: string;
      delivered: string;
      cancelled: string;
      held: string;
      heldInfo: string;
      failedRefunds: string;
      staffCode: string;
    };
  };
  customers: {
    title: string;
    intro: string;
    tabs: { visits: string; bookings: string; loyalty: string; top: string };
    kpi: {
      visits: string;
      people: string;
      newPeople: string;
      returningPeople: string;
      unidentified: string;
      unidentifiedInfo: string;
      bookings: string;
      came: string;
      cameInfo: string;
      noShow: string;
      noShowInfo: string;
      outstandingSpa: string;
      outstandingBeauty: string;
      referrals: string;
      referralsNote: string;
      rewards: string;
      birthday: string;
    };
    chartVisits: string;
    chartBy: string;
    chartBookings: string;
    byBranch: string;
    byChannel: string;
    channels: Record<string, string>;
    points: string;
    tiers: string;
    branchless: string;
    top: string;
    topNote: string;
    empty: Record<'visits' | 'bookings' | 'loyalty' | 'top', string>;
  };
  staff: {
    title: string;
    intro: string;
    note: string;
    noPay: string;
    empty: string;
    actual: string;
  };
  stock: {
    title: string;
    intro: string;
    tabs: {
      best: string;
      low: string;
      slow: string;
      expiry: string;
      value: string;
      movements: string;
      receipts: string;
    };
    empty: Record<'best' | 'low' | 'slow' | 'expiry' | 'value' | 'movements' | 'receipts', string>;
    kpi: {
      onHand: string;
      withCost: string;
      value: string;
      valueInfo: string;
      coverage: string;
      coverageInfo: string;
      withoutCost: string;
    };
    expired: string;
    today: string;
    neverSold: string;
    noSupplier: string;
    noCost: string;
    noCostColumn: string;
    slowIntro: string;
    expiryIntro: string;
    lowIntro: string;
    valueIntro: string;
  };
  exportChoices: Record<string, string>;
  widgets: {
    stockInfo: string;
    low: string;
    expiring: string;
    stockEmpty: string;
    openStock: string;
    refundsInfo: string;
    refundsAmount: string;
    refundsNote: string;
    refundsAnomalies: string;
    refundsEmpty: string;
    openRefunds: string;
    onlineInfo: string;
    awaiting: string;
    held: string;
    onlineEmpty: string;
    openOnline: string;
  };
}

const vi: Words = {
  nav: {
    sales: 'Chi tiết bán hàng',
    customers: 'Khách hàng',
    staff: 'Hoạt động nhân viên',
    stock: 'Báo cáo kho',
  },
  common: {
    truncated: 'Chỉ hiện {count} dòng đầu. Tổng ở trên vẫn tính đủ; tệp xuất có đầy đủ.',
    noAccess: 'Bạn không xem được báo cáo này ở chi nhánh đã chọn.',
    asOfNow: 'Số liệu tại thời điểm xem.',
    days: 'Số ngày',
    daysOptions: { '30': '30 ngày', '60': '60 ngày', '90': '90 ngày', '180': '180 ngày' },
    total: 'Tổng',
  },
  col: {
    name: 'Tên',
    code: 'Mã',
    category: 'Nhóm',
    brand: 'Thương hiệu',
    sku: 'SKU',
    quantity: 'Số lượng',
    net: 'Doanh thu',
    share: 'Tỷ trọng',
    unitsSold: 'Đã bán',
    unitsReturned: 'Khách trả',
    unitsNet: 'Còn lại sau trả',
    sold: 'Đã bán',
    voided: 'Đã hủy',
    soldPrice: 'Giá niêm yết',
    revenue: 'Doanh thu',
    sessionsSold: 'Buổi đã bán',
    sessionsUsed: 'Đã dùng',
    sessionsRemaining: 'Còn lại',
    sessionsExpired: 'Hết hạn',
    type: 'Loại',
    invoices: 'Hóa đơn',
    amount: 'Số tiền',
    units: 'Số lượng',
    order: 'Đơn',
    invoice: 'Hóa đơn',
    branch: 'Chi nhánh',
    date: 'Ngày',
    state: 'Trạng thái',
    customer: 'Khách',
    phone: 'Điện thoại',
    total: 'Tổng',
    collected: 'Đã thu',
    refunded: 'Hoàn lại',
    deliveredOn: 'Ngày giao',
    staffCode: 'Mã nhân viên',
    period: 'Kỳ',
    visits: 'Lượt đến',
    people: 'Số khách',
    newPeople: 'Khách mới',
    returningPeople: 'Khách quay lại',
    bookings: 'Lịch hẹn',
    checkedIn: 'Đã đến',
    cancelled: 'Đã hủy',
    lateCancelled: 'Hủy muộn',
    noShow: 'Vắng mặt',
    open: 'Chưa xử lý',
    channel: 'Kênh',
    wallet: 'Ví',
    kind: 'Loại',
    points: 'Điểm',
    entries: 'Số lần ghi',
    tier: 'Hạng',
    members: 'Số khách',
    paid: 'Đã thanh toán',
    employee: 'Nhân viên',
    services: 'Lượt làm dịch vụ',
    customersServed: 'Số khách đã làm',
    actualMinutes: 'Phút làm thực tế',
    plannedMinutes: 'Phút theo kế hoạch',
    serviceSales: 'Doanh số dịch vụ',
    productSales: 'Doanh số sản phẩm',
    referralOrders: 'Đơn dùng mã giới thiệu',
    referralTotal: 'Tổng hóa đơn dùng mã',
    tips: 'Tip',
    tour: 'Tiền tour',
    commission: 'Hoa hồng',
    attendanceDays: 'Ngày chấm công',
    attendanceMinutes: 'Phút chấm công',
    leaveDays: 'Ngày nghỉ phép',
    onHand: 'Tồn kho',
    reserved: 'Đang giữ',
    available: 'Có thể bán',
    threshold: 'Ngưỡng báo',
    lastSold: 'Bán gần nhất',
    daysSinceSale: 'Ngày chưa bán',
    costValue: 'Giá trị theo giá vốn',
    lot: 'Lô',
    expiry: 'Hạn dùng',
    daysLeft: 'Còn lại',
    unitsWithCost: 'Có giá vốn',
    value: 'Giá trị',
    movement: 'Biến động',
    reason: 'Lý do',
    entriesCount: 'Số lần',
    unitsIn: 'Nhập vào',
    unitsOut: 'Xuất ra',
    supplier: 'Nhà cung cấp',
    receipts: 'Phiếu nhập',
    receiptCost: 'Giá vốn nhập',
    noCostLines: 'Dòng chưa có giá vốn',
  },
  sales: {
    title: 'Chi tiết bán hàng',
    intro:
      'Bán được gì, bao nhiêu và giảm giá ra sao. Doanh thu ở đây cộng lại đúng bằng trang Doanh thu.',
    tabs: {
      services: 'Dịch vụ',
      products: 'Sản phẩm',
      combos: 'Combo',
      discounts: 'Giảm giá',
      online: 'Đơn online',
    },
    by: { variant: 'Theo mặt hàng', brand: 'Theo thương hiệu', category: 'Theo nhóm' },
    byLabel: 'Xem theo',
    other: 'Khác',
    empty: {
      services: 'Chưa có dịch vụ nào được thanh toán trong kỳ này.',
      products: 'Chưa bán sản phẩm nào trong kỳ này.',
      combos: 'Chưa có combo nào được bán hoặc dùng trong kỳ này.',
      discounts: 'Kỳ này không có giảm giá nào.',
      online: 'Không có đơn online nào trong kỳ này.',
    },
    discountTypes: {
      PROGRAM: 'Chương trình giảm giá',
      VOUCHER: 'Mã giảm giá',
      MEMBER: 'Ưu đãi hạng thành viên',
      BIRTHDAY: 'Ưu đãi sinh nhật',
      OTHER: 'Giảm giá khác',
    },
    onlineStates: {
      AWAITING_DELIVERY: 'Chờ giao',
      DELIVERED: 'Đã giao',
      CANCELLED: 'Đã hủy',
    },
    campaigns: 'Chiến dịch sản phẩm',
    kpi: {
      net: 'Doanh thu',
      quantity: 'Số lượng',
      sold: 'Combo đã bán',
      revenue: 'Doanh thu combo',
      sessionsUsed: 'Buổi đã dùng',
      sessionsRemaining: 'Buổi còn lại',
      sessionsExpired: 'Buổi hết hạn',
      discount: 'Đã giảm',
      discountInfo: 'Tiền đã trừ khỏi các hóa đơn thanh toán trong kỳ.',
      discountedInvoices: 'Hóa đơn có giảm giá',
      discountShare: 'Tỷ lệ giảm',
      orders: 'Đơn đặt',
      awaiting: 'Chờ giao',
      delivered: 'Đã giao',
      cancelled: 'Đã hủy',
      held: 'Đã thu, chưa giao',
      heldInfo:
        'Tiền đã thu cho các đơn chưa giao và chưa hủy, tính đến lúc xem. Chưa tính vào doanh thu.',
      failedRefunds: 'Hoàn lại do giao không được',
      staffCode: 'Đơn có mã nhân viên',
    },
  },
  customers: {
    title: 'Khách hàng',
    intro:
      'Khách đến, lịch hẹn và điểm thưởng. Lượt đến là một lần khách đến làm dịch vụ, dù đi cùng bao nhiêu người.',
    tabs: {
      visits: 'Lượt đến',
      bookings: 'Lịch hẹn',
      loyalty: 'Điểm thưởng',
      top: 'Khách chi nhiều',
    },
    kpi: {
      visits: 'Lượt đến',
      people: 'Số khách',
      newPeople: 'Khách mới',
      returningPeople: 'Khách quay lại',
      unidentified: 'Khách chưa có tên hoặc số',
      unidentifiedInfo:
        'Khách đi cùng không có tài khoản và không để lại số điện thoại nên không đếm được là mới hay quay lại.',
      bookings: 'Lịch hẹn',
      came: 'Tỷ lệ đến',
      cameInfo: 'Số lịch đã đến trên số lịch không bị hủy.',
      noShow: 'Tỷ lệ vắng mặt',
      noShowInfo: 'Số lịch vắng mặt trên số lịch không bị hủy.',
      outstandingSpa: 'Điểm Lucy Spa đang giữ',
      outstandingBeauty: 'Điểm Lucy Beauty đang giữ',
      referrals: 'Khách được giới thiệu',
      referralsNote: 'Đã thưởng {count}',
      rewards: 'Lượt đổi quà',
      birthday: 'Ưu đãi sinh nhật đã dùng',
    },
    chartVisits: 'Lượt đến và số khách',
    chartBy: 'Theo {bucket}',
    chartBookings: 'Lịch hẹn',
    byBranch: 'Theo chi nhánh',
    byChannel: 'Theo kênh đặt',
    channels: { ONLINE: 'Đặt online', DESK: 'Tại quầy' },
    points: 'Điểm trong kỳ',
    tiers: 'Khách theo hạng (tính đến lúc xem)',
    branchless:
      'Điểm không gắn với chi nhánh (điều chỉnh tay, thưởng giới thiệu) chỉ hiện cho người xem được mọi chi nhánh.',
    top: 'Khách đã thanh toán nhiều nhất',
    topNote: 'Tối đa {count} khách. Số điện thoại hiện đầy đủ.',
    empty: {
      visits: 'Chưa có lượt đến nào trong kỳ này.',
      bookings: 'Chưa có lịch hẹn nào trong kỳ này.',
      loyalty: 'Chưa có điểm nào được ghi trong kỳ này.',
      top: 'Chưa có khách nào thanh toán trong kỳ này.',
    },
  },
  staff: {
    title: 'Hoạt động nhân viên',
    intro: 'Mỗi nhân viên đã làm gì trong kỳ. Chỉ là số liệu, không xếp hạng.',
    note: 'Cột doanh số cần quyền xem doanh thu; cột tip, tour và hoa hồng cần quyền xem lương. Cột bạn không có quyền sẽ không hiện.',
    noPay: 'Không có quyền xem lương nên các cột tiền công không hiện.',
    empty: 'Chưa có hoạt động nào của nhân viên trong kỳ này.',
    actual: 'thực tế / kế hoạch',
  },
  stock: {
    title: 'Báo cáo kho',
    intro: 'Hàng bán chạy, hàng sắp hết, hàng bán chậm và hàng sắp hết hạn.',
    tabs: {
      best: 'Bán chạy',
      low: 'Sắp hết',
      slow: 'Bán chậm',
      expiry: 'Hạn dùng',
      value: 'Giá trị tồn',
      movements: 'Biến động',
      receipts: 'Nhập kho',
    },
    empty: {
      best: 'Chưa bán sản phẩm nào trong kỳ này.',
      low: 'Không có mặt hàng nào dưới ngưỡng báo.',
      slow: 'Không có mặt hàng nào bán chậm trong khoảng này.',
      expiry: 'Không có lô nào hết hạn hoặc sắp hết hạn trong khoảng này.',
      value: 'Kho chưa có hàng.',
      movements: 'Chưa có biến động kho nào trong kỳ này.',
      receipts: 'Chưa có phiếu nhập nào được xác nhận trong kỳ này.',
    },
    kpi: {
      onHand: 'Số lượng tồn',
      withCost: 'Số lượng có giá vốn',
      value: 'Giá trị theo giá vốn',
      valueInfo: 'Chỉ cộng những lô đã có giá vốn. Lô chưa có giá vốn không được ước tính.',
      coverage: 'Tỷ lệ hàng có giá vốn',
      coverageInfo:
        'Số lượng có giá vốn trên tổng số lượng tồn. Dưới 100% nghĩa là giá trị thật cao hơn con số trên.',
      withoutCost: 'Mặt hàng chưa đủ giá vốn',
    },
    expired: 'Đã hết hạn',
    today: 'Hết hạn hôm nay',
    neverSold: 'Chưa bán lần nào',
    noSupplier: 'Không ghi nhà cung cấp',
    noCost: 'Chưa có',
    noCostColumn: 'Bạn chưa có quyền xem giá vốn nên cột giá vốn không hiện.',
    slowIntro: 'Còn hàng nhưng không bán được trong khoảng đã chọn.',
    expiryIntro: 'Lô đã hết hạn hoặc sẽ hết hạn trong khoảng đã chọn, hết hạn sớm nhất ở trên.',
    lowIntro: 'Mặt hàng có số tồn bằng hoặc thấp hơn ngưỡng báo.',
    valueIntro: 'Kho đang giữ bao nhiêu tiền theo giá vốn.',
  },
  exportChoices: {
    'revenue-by-service': 'Doanh thu theo dịch vụ',
    'revenue-by-product': 'Doanh thu theo sản phẩm',
    combos: 'Combo',
    'discounts-campaigns': 'Giảm giá và chiến dịch',
    'online-orders': 'Đơn online',
    'customers-visits': 'Khách và lượt đến',
    'bookings-funnel': 'Lịch hẹn',
    loyalty: 'Điểm thưởng',
    'top-customers': 'Khách chi nhiều nhất',
    'staff-activity': 'Hoạt động của nhân viên',
    'stock-best-sellers': 'Hàng bán chạy',
    'stock-low': 'Hàng sắp hết',
    'stock-slow': 'Hàng bán chậm',
    'stock-expiry': 'Hạn dùng',
    'stock-value': 'Giá trị tồn kho',
    'stock-movements': 'Biến động kho',
    'stock-receipts': 'Nhập kho theo nhà cung cấp',
  },
  widgets: {
    stockInfo:
      'Số mặt hàng dưới ngưỡng báo và số lô đã hết hạn hoặc hết hạn trong 30 ngày tới, ở các chi nhánh bạn xem được.',
    low: 'Mặt hàng sắp hết',
    expiring: 'Lô hết hạn hoặc sắp hết hạn',
    stockEmpty: 'Kho ổn: không có hàng sắp hết hay sắp hết hạn.',
    openStock: 'Mở báo cáo kho',
    refundsInfo:
      'Tiền hoàn lại sản phẩm, chênh lệch đổi hàng và thanh toán tiền mặt bị hủy trong ngày.',
    refundsAmount: 'Đã hoàn hôm nay',
    refundsNote: '{count} khoản hoàn',
    refundsAnomalies: '{count} khoản PayOS cần xem lại',
    refundsEmpty: 'Hôm nay chưa có khoản hoàn nào.',
    openRefunds: 'Xem hoàn tiền',
    onlineInfo:
      'Đơn online đặt trong 30 ngày qua đang chờ giao, và tiền đã thu cho các đơn chưa giao.',
    awaiting: 'Đơn chờ giao',
    held: 'Đã thu, chưa giao {amount}',
    onlineEmpty: 'Không có đơn online nào đang chờ giao.',
    openOnline: 'Xem đơn online',
  },
};

const en: Words = {
  nav: {
    sales: 'Sales detail',
    customers: 'Customers',
    staff: 'Staff activity',
    stock: 'Stock report',
  },
  common: {
    truncated:
      'Showing the first {count} rows. The totals above still count everything; the export file has them all.',
    noAccess: 'You cannot see this report at the selected branch.',
    asOfNow: 'Figures as of now.',
    days: 'Days',
    daysOptions: { '30': '30 days', '60': '60 days', '90': '90 days', '180': '180 days' },
    total: 'Total',
  },
  col: {
    name: 'Name',
    code: 'Code',
    category: 'Group',
    brand: 'Brand',
    sku: 'SKU',
    quantity: 'Quantity',
    net: 'Revenue',
    share: 'Share',
    unitsSold: 'Sold',
    unitsReturned: 'Taken back',
    unitsNet: 'Net after returns',
    sold: 'Sold',
    voided: 'Voided',
    soldPrice: 'List price',
    revenue: 'Revenue',
    sessionsSold: 'Sessions sold',
    sessionsUsed: 'Used',
    sessionsRemaining: 'Remaining',
    sessionsExpired: 'Expired',
    type: 'Type',
    invoices: 'Invoices',
    amount: 'Amount',
    units: 'Units',
    order: 'Order',
    invoice: 'Invoice',
    branch: 'Branch',
    date: 'Date',
    state: 'Status',
    customer: 'Customer',
    phone: 'Phone',
    total: 'Total',
    collected: 'Collected',
    refunded: 'Given back',
    deliveredOn: 'Delivered',
    staffCode: 'Staff code',
    period: 'Period',
    visits: 'Visits',
    people: 'Customers',
    newPeople: 'New customers',
    returningPeople: 'Returning customers',
    bookings: 'Bookings',
    checkedIn: 'Came',
    cancelled: 'Cancelled',
    lateCancelled: 'Late cancellations',
    noShow: 'No-shows',
    open: 'Not handled',
    channel: 'Channel',
    wallet: 'Wallet',
    kind: 'Kind',
    points: 'Points',
    entries: 'Entries',
    tier: 'Tier',
    members: 'Customers',
    paid: 'Paid',
    employee: 'Employee',
    services: 'Services performed',
    customersServed: 'Customers served',
    actualMinutes: 'Minutes worked',
    plannedMinutes: 'Minutes planned',
    serviceSales: 'Service sales',
    productSales: 'Product sales',
    referralOrders: 'Orders with referral code',
    referralTotal: 'Invoice total with code',
    tips: 'Tips',
    tour: 'Tour pay',
    commission: 'Commission',
    attendanceDays: 'Attendance days',
    attendanceMinutes: 'Attendance minutes',
    leaveDays: 'Leave days',
    onHand: 'On hand',
    reserved: 'Reserved',
    available: 'Available',
    threshold: 'Alert threshold',
    lastSold: 'Last sold',
    daysSinceSale: 'Days without a sale',
    costValue: 'Stock at cost',
    lot: 'Lot',
    expiry: 'Expiry date',
    daysLeft: 'Days left',
    unitsWithCost: 'With a cost',
    value: 'Value',
    movement: 'Movement',
    reason: 'Reason',
    entriesCount: 'Entries',
    unitsIn: 'In',
    unitsOut: 'Out',
    supplier: 'Supplier',
    receipts: 'Receipts',
    receiptCost: 'Cost received',
    noCostLines: 'Lines without a cost',
  },
  sales: {
    title: 'Sales detail',
    intro:
      'What was sold, how much, and how it was discounted. The revenue here adds up to exactly the Revenue page.',
    tabs: {
      services: 'Services',
      products: 'Products',
      combos: 'Combos',
      discounts: 'Discounts',
      online: 'Online orders',
    },
    by: { variant: 'By item', brand: 'By brand', category: 'By group' },
    byLabel: 'View by',
    other: 'Other',
    empty: {
      services: 'No service was paid in this period.',
      products: 'No product was sold in this period.',
      combos: 'No combo was sold or used in this period.',
      discounts: 'No discount was given in this period.',
      online: 'There are no online orders in this period.',
    },
    discountTypes: {
      PROGRAM: 'Discount program',
      VOUCHER: 'Voucher code',
      MEMBER: 'Member tier benefit',
      BIRTHDAY: 'Birthday benefit',
      OTHER: 'Other discount',
    },
    onlineStates: {
      AWAITING_DELIVERY: 'Awaiting delivery',
      DELIVERED: 'Delivered',
      CANCELLED: 'Cancelled',
    },
    campaigns: 'Product campaigns',
    kpi: {
      net: 'Revenue',
      quantity: 'Quantity',
      sold: 'Combos sold',
      revenue: 'Combo revenue',
      sessionsUsed: 'Sessions used',
      sessionsRemaining: 'Sessions remaining',
      sessionsExpired: 'Sessions expired',
      discount: 'Discounted',
      discountInfo: 'Money taken off the invoices paid in the period.',
      discountedInvoices: 'Invoices with a discount',
      discountShare: 'Discount rate',
      orders: 'Orders',
      awaiting: 'Awaiting delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      held: 'Collected, not delivered',
      heldInfo:
        'Money collected for orders not delivered and not cancelled, as of now. Not yet counted as revenue.',
      failedRefunds: 'Given back for failed deliveries',
      staffCode: 'Orders with a staff code',
    },
  },
  customers: {
    title: 'Customers',
    intro:
      'Who came, bookings and loyalty points. A visit is one time customers came for a service, however many people came together.',
    tabs: {
      visits: 'Visits',
      bookings: 'Bookings',
      loyalty: 'Loyalty points',
      top: 'Top customers',
    },
    kpi: {
      visits: 'Visits',
      people: 'Customers',
      newPeople: 'New customers',
      returningPeople: 'Returning customers',
      unidentified: 'Customers without a name or phone',
      unidentifiedInfo:
        'Companions with no account and no phone number cannot be counted as new or returning.',
      bookings: 'Bookings',
      came: 'Came',
      cameInfo: 'Bookings that came, out of bookings that were not cancelled.',
      noShow: 'No-show rate',
      noShowInfo: 'No-shows out of bookings that were not cancelled.',
      outstandingSpa: 'Lucy Spa points held',
      outstandingBeauty: 'Lucy Beauty points held',
      referrals: 'Customers referred',
      referralsNote: 'Rewarded {count}',
      rewards: 'Rewards redeemed',
      birthday: 'Birthday benefits used',
    },
    chartVisits: 'Visits and customers',
    chartBy: 'By {bucket}',
    chartBookings: 'Bookings',
    byBranch: 'By branch',
    byChannel: 'By booking channel',
    channels: { ONLINE: 'Online', DESK: 'At the desk' },
    points: 'Points in the period',
    tiers: 'Customers by tier (as of now)',
    branchless:
      'Points that belong to no branch (manual adjustments, referral rewards) are shown only to people who can read every branch.',
    top: 'Customers who paid most',
    topNote: 'Up to {count} customers. Phone numbers are shown in full.',
    empty: {
      visits: 'No visits in this period.',
      bookings: 'No bookings in this period.',
      loyalty: 'No points were recorded in this period.',
      top: 'No customer paid in this period.',
    },
  },
  staff: {
    title: 'Staff activity',
    intro: 'What each employee did in the period. Facts only, no ranking.',
    note: 'Sales columns need the permission to see revenue; tips, tour and commission columns need the permission to see pay. Columns you may not see are left out.',
    noPay: 'No permission to see pay, so the pay columns are left out.',
    empty: 'No staff activity in this period.',
    actual: 'actual / planned',
  },
  stock: {
    title: 'Stock report',
    intro: 'Best sellers, items running out, slow movers and items about to expire.',
    tabs: {
      best: 'Best sellers',
      low: 'Running low',
      slow: 'Slow movers',
      expiry: 'Expiry',
      value: 'Stock value',
      movements: 'Movements',
      receipts: 'Receipts',
    },
    empty: {
      best: 'No product was sold in this period.',
      low: 'No item is below its alert threshold.',
      slow: 'No slow movers in this window.',
      expiry: 'No lot has expired or is about to expire in this window.',
      value: 'There is no stock yet.',
      movements: 'No stock movements in this period.',
      receipts: 'No receipts were confirmed in this period.',
    },
    kpi: {
      onHand: 'Units on hand',
      withCost: 'Units with a cost',
      value: 'Stock at cost',
      valueInfo:
        'Only lots with a recorded cost are added up. Lots without a cost are not estimated.',
      coverage: 'Share of stock with a cost',
      coverageInfo:
        'Units with a cost out of all units on hand. Below 100% the real value is higher than the figure above.',
      withoutCost: 'Items missing a cost',
    },
    expired: 'Expired',
    today: 'Expires today',
    neverSold: 'Never sold',
    noSupplier: 'No supplier recorded',
    noCost: 'None',
    noCostColumn: 'You may not see costs, so the cost column is left out.',
    slowIntro: 'In stock but not sold in the selected window.',
    expiryIntro: 'Lots that have expired or will expire in the selected window, soonest first.',
    lowIntro: 'Items at or below their alert threshold.',
    valueIntro: 'How much money the stock holds at cost.',
  },
  exportChoices: {
    'revenue-by-service': 'Revenue by service',
    'revenue-by-product': 'Revenue by product',
    combos: 'Combos',
    'discounts-campaigns': 'Discounts and campaigns',
    'online-orders': 'Online orders',
    'customers-visits': 'Customers and visits',
    'bookings-funnel': 'Bookings',
    loyalty: 'Loyalty points',
    'top-customers': 'Top customers',
    'staff-activity': 'Staff activity',
    'stock-best-sellers': 'Best sellers',
    'stock-low': 'Running low',
    'stock-slow': 'Slow movers',
    'stock-expiry': 'Expiry dates',
    'stock-value': 'Stock value',
    'stock-movements': 'Stock movements',
    'stock-receipts': 'Receipts by supplier',
  },
  widgets: {
    stockInfo:
      'Items below their alert threshold and lots that expired or expire within 30 days, at the branches you can see.',
    low: 'Items running low',
    expiring: 'Lots expired or expiring',
    stockEmpty: 'Stock is fine: nothing running low or about to expire.',
    openStock: 'Open the stock report',
    refundsInfo: 'Product refunds, exchange differences and cash payments reversed today.',
    refundsAmount: 'Given back today',
    refundsNote: '{count} refunds',
    refundsAnomalies: '{count} PayOS items need a look',
    refundsEmpty: 'No refunds today.',
    openRefunds: 'See refunds',
    onlineInfo:
      'Online orders placed in the last 30 days that are waiting for delivery, and the money collected for them.',
    awaiting: 'Orders awaiting delivery',
    held: 'Collected, not delivered {amount}',
    onlineEmpty: 'No online order is waiting for delivery.',
    openOnline: 'See online orders',
  },
};

export function reportsBDictionary(locale: Locale): Words {
  return locale === 'en' ? en : vi;
}

export type ReportsBDictionary = Words;
