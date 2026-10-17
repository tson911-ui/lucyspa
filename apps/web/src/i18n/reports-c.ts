import type { Locale } from './locales';

/**
 * Phase 8 P8-14 (Wave C reports): texts of the cash, pay and profit screens. Same words as the rest of the report area: "doanh thu" is money
 * collected minus money given back; "chênh lệch" is what a day's count differs from the book; "lãi tạm tính" is a provisional figure and says so.
 * Lucy Spa is a spa: never "khám".
 */
interface Words {
  nav: { cash: string; pay: string; profit: string };
  col: Record<string, string>;
  cash: {
    title: string;
    intro: string;
    tabs: { daily: string; funds: string; differences: string };
    notStarted: string;
    status: { closed: string; open: string };
    kinds: { CASH: string; BANK: string };
    categories: Record<string, string>;
    byCategory: string;
    alert: string;
    bankNote: string;
    empty: { daily: string; funds: string; differences: string };
    kpi: {
      cashIn: string;
      cashOut: string;
      difference: string;
      differenceInfo: string;
      closedDays: string;
      openDays: string;
      cashBalance: string;
      bankBalance: string;
      days: string;
      alerts: string;
      alertsInfo: string;
    };
  };
  pay: {
    title: string;
    intro: string;
    tabs: { tips: string; payroll: string; labour: string; advances: string };
    notStarted: string;
    status: Record<'DRAFT' | 'CLOSED' | 'PAID', string>;
    kinds: Record<string, string>;
    empty: { tips: string; payroll: string; labour: string; advances: string };
    kpi: {
      tipsTotal: string;
      tipsCash: string;
      tipsTransfer: string;
      tipsOwed: string;
      tipsOwedInfo: string;
      net: string;
      netInfo: string;
      tips: string;
      outstanding: string;
      outstandingInfo: string;
      pending: string;
    };
    labourNote: string;
    noRevenue: string;
    shopWide: string;
  };
  profit: {
    title: string;
    intro: string;
    notStarted: string;
    disclaimerTitle: string;
    disclaimer: string;
    lines: Record<
      'revenue' | 'cogs' | 'tour' | 'commission' | 'salaries' | 'expenses' | 'profit',
      string
    >;
    notes: {
      cogs: string;
      salaries: string;
      partialMonths: string;
      missingMonths: string;
      draftMonths: string;
    };
    coverage: string;
    coverageInfo: string;
    coverageWarning: string;
    withoutCost: string;
    emptyWithoutCost: string;
    kpi: { profit: string; profitInfo: string; revenue: string; coverage: string };
    statement: string;
  };
  widgets: {
    cashInfo: string;
    cashAlerts: string;
    cashDays: string;
    cashEmpty: string;
    cashNotStarted: string;
    openCash: string;
    payInfo: string;
    payUnpaid: string;
    payOutstanding: string;
    payEmpty: string;
    payNotStarted: string;
    openPay: string;
  };
  exportChoices: Record<string, string>;
}

const vi: Words = {
  nav: { cash: 'Báo cáo quỹ', pay: 'Báo cáo lương', profit: 'Lãi tạm tính' },
  col: {
    date: 'Ngày',
    branch: 'Chi nhánh',
    state: 'Trạng thái',
    openingFloat: 'Tiền đầu ngày',
    cashIn: 'Thu',
    cashOut: 'Chi',
    expected: 'Dự kiến',
    counted: 'Đếm thực tế',
    difference: 'Chênh lệch',
    withdrawal: 'Rút về',
    reason: 'Lý do',
    category: 'Loại bút toán',
    fund: 'Quỹ',
    fundKind: 'Loại quỹ',
    openingBalance: 'Số dư đầu',
    balance: 'Số dư cuối kỳ',
    lastClosed: 'Chốt gần nhất',
    closedBy: 'Người chốt',
    name: 'Nhân viên',
    code: 'Mã',
    tipsCash: 'Tiền mặt',
    tipsTransfer: 'Chuyển khoản',
    tipsTotal: 'Tổng tip',
    tipsInRun: 'Đã vào kỳ lương',
    tipsOwed: 'Còn nợ',
    entries: 'Số lần',
    month: 'Tháng',
    people: 'Số người',
    net: 'Thực lĩnh',
    tips: 'Tip',
    paymentDay: 'Ngày trả',
    labour: 'Chi phí nhân sự',
    revenue: 'Doanh thu',
    share: 'Tỷ lệ',
    advPaid: 'Đã ứng',
    advRecovered: 'Đã thu hồi',
    advOutstanding: 'Còn nợ',
    advPendingCount: 'Đơn chờ',
    advPending: 'Tiền chờ',
    line: 'Khoản mục',
    amount: 'Số tiền',
    note: 'Ghi chú',
    sku: 'SKU',
    product: 'Sản phẩm',
    units: 'Số lượng chưa có giá vốn',
  },
  cash: {
    title: 'Báo cáo quỹ',
    intro:
      'Tiền mặt từng ngày, số dư các quỹ và những ngày kiểm quỹ bị lệch. Số liệu lấy từ sổ quỹ, không ước tính.',
    tabs: { daily: 'Theo ngày', funds: 'Số dư các quỹ', differences: 'Chênh lệch' },
    notStarted: 'Chưa bắt đầu sổ quỹ. Khi chủ spa bắt đầu sổ quỹ, số liệu sẽ hiện ở đây.',
    status: { closed: 'Đã chốt', open: 'Chưa chốt' },
    kinds: { CASH: 'Tiền mặt', BANK: 'Ngân hàng' },
    categories: {
      SALE_CASH: 'Bán hàng thu tiền mặt',
      SALE_BANK: 'Bán hàng chuyển khoản',
      PAYMENT_REVERSAL: 'Hủy thanh toán',
      PRODUCT_REFUND: 'Hoàn tiền sản phẩm',
      EXCHANGE_DIFFERENCE: 'Chênh lệch đổi hàng',
      FAILED_DELIVERY_REFUND: 'Hoàn tiền giao không được',
      TIP_IN: 'Thu tip',
      TIP_OUT: 'Chi tip',
      SALARY_PAYOUT: 'Trả lương',
      ADVANCE: 'Tạm ứng lương',
      MANUAL_INCOME: 'Thu khác',
      MANUAL_EXPENSE: 'Chi khác',
      OWNER_WITHDRAWAL: 'Chủ rút tiền',
      DEPOSIT: 'Nộp tiền vào ngân hàng',
      FUND_TRANSFER: 'Chuyển giữa các quỹ',
      COUNT_DIFFERENCE: 'Chênh lệch kiểm quỹ',
      CORRECTION: 'Điều chỉnh sửa lỗi',
    },
    byCategory: 'Theo loại bút toán',
    alert: 'Vượt ngưỡng cảnh báo',
    bankNote: 'Quỹ ngân hàng chỉ hiện cho người xem được quỹ ở mọi chi nhánh.',
    empty: {
      daily: 'Chưa có ngày nào có tiền ra vào trong kỳ này.',
      funds: 'Chưa có quỹ nào để hiện.',
      differences: 'Không có ngày nào bị lệch trong kỳ này.',
    },
    kpi: {
      cashIn: 'Tiền mặt thu vào',
      cashOut: 'Tiền mặt chi ra',
      difference: 'Chênh lệch các ngày đã chốt',
      differenceInfo: 'Đếm thực tế trừ dự kiến, cộng các ngày đã chốt trong kỳ. Âm là thiếu tiền.',
      closedDays: 'Ngày đã chốt',
      openDays: 'Ngày chưa chốt',
      cashBalance: 'Tiền mặt các chi nhánh',
      bankBalance: 'Ngân hàng',
      days: 'Ngày bị lệch',
      alerts: 'Lệch vượt ngưỡng',
      alertsInfo: 'Số ngày lệch bằng hoặc hơn ngưỡng cảnh báo của cửa hàng.',
    },
  },
  pay: {
    title: 'Báo cáo lương',
    intro:
      'Tip, bảng lương từng tháng, chi phí nhân sự so với doanh thu và các khoản tạm ứng chưa thu hồi.',
    tabs: { tips: 'Tip', payroll: 'Bảng lương', labour: 'Chi phí nhân sự', advances: 'Tạm ứng' },
    notStarted: 'Chưa bắt đầu sổ quỹ và bảng lương nên chưa có số liệu.',
    status: { DRAFT: 'Nháp', CLOSED: 'Đã chốt', PAID: 'Đã trả' },
    kinds: {
      BASE_SALARY: 'Lương cơ bản',
      CTV_WORK: 'Công cộng tác viên',
      TOUR: 'Tiền tour',
      COMMISSION: 'Hoa hồng',
      BONUS: 'Thưởng',
      ADJUSTMENT: 'Điều chỉnh',
      DEDUCTION: 'Khấu trừ',
      ADVANCE_RECOVERY: 'Thu hồi tạm ứng',
    },
    empty: {
      tips: 'Chưa có tip nào trong kỳ này.',
      payroll: 'Chưa có kỳ lương nào trong khoảng này.',
      labour: 'Chưa có kỳ lương nào trong khoảng này.',
      advances: 'Không có khoản tạm ứng nào chưa thu hồi hoặc đang chờ.',
    },
    kpi: {
      tipsTotal: 'Tổng tip',
      tipsCash: 'Tip tiền mặt',
      tipsTransfer: 'Tip chuyển khoản',
      tipsOwed: 'Tip chưa vào kỳ lương',
      tipsOwedInfo: 'Tip đã ghi nhưng chưa nằm trong bảng lương nào, còn nợ nhân viên.',
      net: 'Thực lĩnh',
      netInfo: 'Tổng các khoản lương của những tháng đang xem, chưa gồm tip.',
      tips: 'Tip',
      outstanding: 'Tạm ứng chưa thu hồi',
      outstandingInfo: 'Tiền đã ứng cho nhân viên và chưa trừ hết vào lương.',
      pending: 'Tạm ứng đang chờ',
    },
    labourNote:
      'Chi phí nhân sự là thực lĩnh cộng tip của kỳ lương. Doanh thu là doanh thu của cùng tháng ở mọi chi nhánh, tính như trang Doanh thu.',
    noRevenue: 'Chưa có doanh thu',
    shopWide:
      'Báo cáo này tính cho cả cửa hàng nên chỉ hiện với người xem được lương ở mọi chi nhánh.',
  },
  profit: {
    title: 'Lãi tạm tính',
    intro: 'Doanh thu trừ các chi phí đã có trong hệ thống. Chỉ chủ spa xem được.',
    notStarted: 'Chưa bắt đầu sổ quỹ và bảng lương nên lương và chi phí nhập tay chưa có trong sổ.',
    disclaimerTitle: 'Chỉ là số tạm tính, không phải báo cáo thuế',
    disclaimer:
      'Tiền thuê, điện nước, thuế và các chi phí khác chưa có trong hệ thống nên không được tính và không bị đoán.',
    lines: {
      revenue: 'Doanh thu',
      cogs: 'Trừ: giá vốn hàng bán',
      tour: 'Trừ: tiền tour',
      commission: 'Trừ: hoa hồng sản phẩm',
      salaries: 'Trừ: lương',
      expenses: 'Trừ: chi phí nhập tay trong sổ quỹ',
      profit: 'Lãi tạm tính',
    },
    notes: {
      cogs: '{percent} số lượng bán có giá vốn',
      salaries: '{counted} tháng đã tính',
      partialMonths: '{count} tháng chỉ nằm một phần trong kỳ nên chưa tính',
      missingMonths: '{count} tháng chưa có kỳ lương',
      draftMonths: '{count} tháng là bảng lương nháp',
    },
    coverage: 'Hàng bán có giá vốn',
    coverageInfo:
      'Số lượng bán có giá vốn trên tổng số lượng bán. Dưới 100% nghĩa là giá vốn thật cao hơn con số trên và lãi thật thấp hơn.',
    coverageWarning:
      'Một số sản phẩm chưa có giá vốn nên giá vốn hàng bán đang thấp hơn thực tế. Hãy nhập giá vốn cho các sản phẩm dưới đây.',
    withoutCost: 'Sản phẩm chưa có giá vốn',
    emptyWithoutCost: 'Mọi sản phẩm đã bán đều có giá vốn.',
    kpi: {
      profit: 'Lãi tạm tính',
      profitInfo:
        'Doanh thu trừ giá vốn, tour, hoa hồng, lương và chi phí nhập tay. Không gồm tiền thuê, điện nước, thuế.',
      revenue: 'Doanh thu',
      coverage: 'Hàng bán có giá vốn',
    },
    statement: 'Từng khoản',
  },
  widgets: {
    cashInfo:
      'Số ngày kiểm quỹ bị lệch trong 30 ngày qua ở các chi nhánh bạn xem được, và số ngày lệch vượt ngưỡng cảnh báo.',
    cashAlerts: 'Ngày lệch vượt ngưỡng',
    cashDays: 'Ngày lệch trong 30 ngày: {count}',
    cashEmpty: 'Không có ngày nào bị lệch trong 30 ngày qua.',
    cashNotStarted: 'Chưa bắt đầu sổ quỹ.',
    openCash: 'Xem báo cáo quỹ',
    payInfo: 'Bảng lương các tháng trước chưa trả xong và tiền tạm ứng chưa thu hồi.',
    payUnpaid: 'Bảng lương chưa trả',
    payOutstanding: 'Tạm ứng chưa thu hồi {amount}',
    payEmpty: 'Không có bảng lương nào chờ trả và không có tạm ứng nào treo.',
    payNotStarted: 'Chưa bắt đầu bảng lương.',
    openPay: 'Xem báo cáo lương',
  },
  exportChoices: {
    'cash-daily': 'Quỹ tiền mặt theo ngày',
    'cash-funds': 'Số dư các quỹ',
    'cash-differences': 'Chênh lệch kiểm quỹ',
    tips: 'Tip',
    'payroll-monthly': 'Bảng lương theo tháng',
    'labour-cost': 'Chi phí nhân sự so với doanh thu',
    advances: 'Tạm ứng lương',
    profit: 'Lãi tạm tính',
  },
};

const en: Words = {
  nav: { cash: 'Cash report', pay: 'Pay report', profit: 'Provisional profit' },
  col: {
    date: 'Date',
    branch: 'Branch',
    state: 'Status',
    openingFloat: 'Opening float',
    cashIn: 'In',
    cashOut: 'Out',
    expected: 'Expected',
    counted: 'Counted',
    difference: 'Difference',
    withdrawal: 'Withdrawn',
    reason: 'Reason',
    category: 'Kind of entry',
    fund: 'Fund',
    fundKind: 'Fund type',
    openingBalance: 'Opening balance',
    balance: 'Balance at end of period',
    lastClosed: 'Last closed',
    closedBy: 'Closed by',
    name: 'Employee',
    code: 'Code',
    tipsCash: 'Cash',
    tipsTransfer: 'Transfer',
    tipsTotal: 'Total tips',
    tipsInRun: 'In a pay run',
    tipsOwed: 'Still owed',
    entries: 'Entries',
    month: 'Month',
    people: 'People',
    net: 'Net pay',
    tips: 'Tips',
    paymentDay: 'Payment day',
    labour: 'Labour cost',
    revenue: 'Revenue',
    share: 'Share',
    advPaid: 'Advanced',
    advRecovered: 'Recovered',
    advOutstanding: 'Outstanding',
    advPendingCount: 'Waiting',
    advPending: 'Amount waiting',
    line: 'Item',
    amount: 'Amount',
    note: 'Note',
    sku: 'SKU',
    product: 'Product',
    units: 'Units without a cost',
  },
  cash: {
    title: 'Cash report',
    intro:
      'Cash of each day, fund balances and the days when the count was off. Figures come from the cash book, nothing is estimated.',
    tabs: { daily: 'By day', funds: 'Fund balances', differences: 'Differences' },
    notStarted:
      'The cash book has not been started. Once the owner starts it, the figures show here.',
    status: { closed: 'Closed', open: 'Open' },
    kinds: { CASH: 'Cash', BANK: 'Bank' },
    categories: {
      SALE_CASH: 'Cash sales',
      SALE_BANK: 'Bank sales',
      PAYMENT_REVERSAL: 'Payment reversed',
      PRODUCT_REFUND: 'Product refund',
      EXCHANGE_DIFFERENCE: 'Exchange difference',
      FAILED_DELIVERY_REFUND: 'Failed delivery refund',
      TIP_IN: 'Tips received',
      TIP_OUT: 'Tips paid out',
      SALARY_PAYOUT: 'Salary paid',
      ADVANCE: 'Salary advance',
      MANUAL_INCOME: 'Other income',
      MANUAL_EXPENSE: 'Other expense',
      OWNER_WITHDRAWAL: 'Owner withdrawal',
      DEPOSIT: 'Deposit to bank',
      FUND_TRANSFER: 'Transfer between funds',
      COUNT_DIFFERENCE: 'Cash count difference',
      CORRECTION: 'Correction',
    },
    byCategory: 'By kind of entry',
    alert: 'Over the alert threshold',
    bankNote: 'The bank fund is shown only to people who can read the cash at every branch.',
    empty: {
      daily: 'No day with money in or out in this period.',
      funds: 'No fund to show.',
      differences: 'No day was off in this period.',
    },
    kpi: {
      cashIn: 'Cash in',
      cashOut: 'Cash out',
      difference: 'Difference of closed days',
      differenceInfo:
        'Counted minus expected, added up over the days closed in the period. Negative means money is missing.',
      closedDays: 'Closed days',
      openDays: 'Open days',
      cashBalance: 'Branch cash',
      bankBalance: 'Bank',
      days: 'Days off',
      alerts: 'Over the threshold',
      alertsInfo: 'Days off by at least the shop’s alert threshold.',
    },
  },
  pay: {
    title: 'Pay report',
    intro:
      'Tips, payroll by month, labour cost against revenue and salary advances not yet recovered.',
    tabs: { tips: 'Tips', payroll: 'Payroll', labour: 'Labour cost', advances: 'Advances' },
    notStarted: 'The cash book and payroll have not been started, so there are no figures yet.',
    status: { DRAFT: 'Draft', CLOSED: 'Closed', PAID: 'Paid' },
    kinds: {
      BASE_SALARY: 'Base salary',
      CTV_WORK: 'Collaborator work',
      TOUR: 'Tour pay',
      COMMISSION: 'Commission',
      BONUS: 'Bonus',
      ADJUSTMENT: 'Adjustment',
      DEDUCTION: 'Deduction',
      ADVANCE_RECOVERY: 'Advance recovery',
    },
    empty: {
      tips: 'No tips in this period.',
      payroll: 'No pay run in this range.',
      labour: 'No pay run in this range.',
      advances: 'No advance is outstanding or waiting.',
    },
    kpi: {
      tipsTotal: 'Total tips',
      tipsCash: 'Cash tips',
      tipsTransfer: 'Transfer tips',
      tipsOwed: 'Tips not yet in a pay run',
      tipsOwedInfo: 'Tips recorded that are not in any pay run yet, still owed to employees.',
      net: 'Net pay',
      netInfo: 'All pay items of the months shown, not counting tips.',
      tips: 'Tips',
      outstanding: 'Advances not recovered',
      outstandingInfo: 'Money advanced to employees and not yet taken off their pay.',
      pending: 'Advances waiting',
    },
    labourNote:
      'Labour cost is the pay run net plus tips. Revenue is the revenue of the same month at every branch, counted as on the Revenue page.',
    noRevenue: 'No revenue',
    shopWide:
      'This report covers the whole shop, so it shows only to people who can see pay at every branch.',
  },
  profit: {
    title: 'Provisional profit',
    intro: 'Revenue minus the costs the system has. Only the owner can see it.',
    notStarted:
      'The cash book and payroll have not been started, so salaries and manual expenses are not in the books yet.',
    disclaimerTitle: 'A provisional figure, not a tax report',
    disclaimer:
      'Rent, electricity, tax and other costs are not in the system, so they are not counted and not guessed.',
    lines: {
      revenue: 'Revenue',
      cogs: 'Less: cost of goods sold',
      tour: 'Less: tour pay',
      commission: 'Less: product commission',
      salaries: 'Less: salaries',
      expenses: 'Less: manual expenses in the cash book',
      profit: 'Provisional profit',
    },
    notes: {
      cogs: '{percent} of units sold had a cost',
      salaries: '{counted} months counted',
      partialMonths: '{count} months only partly inside the period are not counted',
      missingMonths: '{count} months have no pay run',
      draftMonths: '{count} months are draft payrolls',
    },
    coverage: 'Goods sold with a cost',
    coverageInfo:
      'Units sold that had a cost out of all units sold. Below 100% the real cost is higher than shown and the real profit is lower.',
    coverageWarning:
      'Some products have no cost, so the cost of goods sold is lower than the truth. Enter a cost for the products below.',
    withoutCost: 'Products without a cost',
    emptyWithoutCost: 'Every product sold has a cost.',
    kpi: {
      profit: 'Provisional profit',
      profitInfo:
        'Revenue minus cost of goods, tour, commission, salaries and manual expenses. Rent, electricity and tax are not included.',
      revenue: 'Revenue',
      coverage: 'Goods sold with a cost',
    },
    statement: 'Line by line',
  },
  widgets: {
    cashInfo:
      'Days in the last 30 when the count was off at the branches you can see, and how many were over the alert threshold.',
    cashAlerts: 'Days over the threshold',
    cashDays: 'Days off in 30 days: {count}',
    cashEmpty: 'No day was off in the last 30 days.',
    cashNotStarted: 'The cash book has not been started.',
    openCash: 'Open the cash report',
    payInfo: 'Pay runs of earlier months not fully paid yet, and advances not recovered.',
    payUnpaid: 'Unpaid pay runs',
    payOutstanding: 'Advances not recovered {amount}',
    payEmpty: 'No pay run waits to be paid and no advance is outstanding.',
    payNotStarted: 'Payroll has not been started.',
    openPay: 'Open the pay report',
  },
  exportChoices: {
    'cash-daily': 'Daily cash',
    'cash-funds': 'Fund balances',
    'cash-differences': 'Cash count differences',
    tips: 'Tips',
    'payroll-monthly': 'Payroll by month',
    'labour-cost': 'Labour cost against revenue',
    advances: 'Salary advances',
    profit: 'Provisional profit',
  },
};

export function reportsCDictionary(locale: Locale): Words {
  return locale === 'en' ? en : vi;
}

export type ReportsCDictionary = Words;
