import type { DateRangePickerLabels } from '@lucy-spa/ui';
import type { Locale } from './locales';

/**
 * Phase 8 (reports): texts of the report screens. Short, natural Vietnamese; the same word for the same thing everywhere
 * ("doanh thu" is money collected minus money given back, "đã thu" the money collected, "hoàn lại" money given back to a customer,
 * "lượt đến" a completed visit). Lucy Spa is a spa: never "khám".
 */
interface Words {
  nav: { revenue: string; refunds: string };
  common: {
    branch: string;
    allBranches: string;
    period: string;
    compare: string;
    compareNone: string;
    comparePrevious: string;
    group: string;
    groupAuto: string;
    compareVsPrevious: string;
    vsPrevious: string;
    reload: string;
    export: string;
    updated: string;
    rangeTooLong: string;
  };
  buckets: { day: string; week: string; month: string; quarter: string; year: string };
  bucketsBy: { day: string; week: string; month: string; quarter: string; year: string };
  picker: DateRangePickerLabels;
  revenue: {
    title: string;
    intro: string;
    kpi: {
      net: string;
      netInfo: string;
      collected: string;
      collectedInfo: string;
      givenBack: string;
      givenBackInfo: string;
      paidInvoices: string;
      paidInvoicesInfo: string;
      visits: string;
      visitsInfo: string;
      held: string;
      heldInfo: string;
      average: string;
      shipping: string;
    };
    chart: { title: string; subtitle: string; partial: string; current: string; previous: string };
    tabs: { branch: string; kind: string; method: string };
    columns: {
      branch: string;
      net: string;
      collected: string;
      refunds: string;
      exchanges: string;
      paidInvoices: string;
      visits: string;
      previous: string;
      group: string;
      by: string;
      item: string;
      kind: string;
      channel: string;
      share: string;
      method: string;
      moneyIn: string;
      moneyOut: string;
    };
    side: Record<string, string>;
    kind: Record<string, string>;
    channel: Record<string, string>;
    method: Record<string, string>;
    unclassified: string;
    definitionTitle: string;
    definition: string;
    empty: string;
    emptyBranches: string;
    donutTitle: string;
    donutOther: string;
    donutTotal: string;
  };
  refunds: {
    title: string;
    intro: string;
    totals: string;
    kinds: Record<string, string>;
    columns: {
      date: string;
      branch: string;
      type: string;
      invoice: string;
      code: string;
      amount: string;
      method: string;
      reason: string;
    };
    failedDelivery: string;
    methods: Record<string, string>;
    empty: string;
    anomalies: string;
    list: string;
  };
  export: {
    title: string;
    intro: string;
    content: string;
    format: string;
    xlsx: string;
    xlsxHint: string;
    csv: string;
    csvHint: string;
    pdf: string;
    pdfHint: string;
    submit: string;
    print: string;
    submitting: string;
    done: string;
    cap: string;
    scope: string;
    noPermission: string;
  };
  exportChoices: Record<string, string>;
  errors: Record<string, string>;
  print: { generated: string; branches: string; period: string };
  dashboard: {
    title: string;
    today: string;
    comparedTo: string;
    sevenDays: string;
    paid: string;
    held: string;
    empty: string;
    open: string;
    info: string;
    cash: string;
    payos: string;
    out: string;
  };
}

const vi: Words = {
  nav: { revenue: 'Doanh thu', refunds: 'Hoàn tiền và điều chỉnh' },
  common: {
    branch: 'Chi nhánh',
    allBranches: 'Tất cả chi nhánh',
    period: 'Khoảng thời gian',
    compare: 'So sánh',
    compareNone: 'Không so sánh',
    comparePrevious: 'Kỳ trước',
    group: 'Nhóm theo',
    groupAuto: 'Nhóm tự động',
    compareVsPrevious: 'So với kỳ trước',
    vsPrevious: 'so với kỳ trước',
    reload: 'Tải lại',
    export: 'Xuất file',
    updated: 'Số liệu lúc {time}',
    rangeTooLong: 'Chọn tối đa {days} ngày mỗi lần xem.',
  },
  buckets: { day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý', year: 'Năm' },
  bucketsBy: {
    day: 'Theo ngày',
    week: 'Theo tuần',
    month: 'Theo tháng',
    quarter: 'Theo quý',
    year: 'Theo năm',
  },
  picker: {
    title: 'Khoảng thời gian',
    placeholder: 'Chọn khoảng thời gian',
    presets: {
      today: 'Hôm nay',
      yesterday: 'Hôm qua',
      last7: '7 ngày qua',
      last30: '30 ngày qua',
      thisMonth: 'Tháng này',
      lastMonth: 'Tháng trước',
    },
    custom: 'Tự chọn',
    apply: 'Áp dụng',
    cancel: 'Hủy',
    close: 'Đóng',
    previousMonth: 'Tháng trước',
    nextMonth: 'Tháng sau',
    pickEnd: 'Chọn ngày cuối.',
    maxRange: 'Tối đa {days} ngày.',
  },
  revenue: {
    title: 'Doanh thu',
    intro: 'Tiền đã thu trừ tiền đã hoàn lại cho khách, tính theo ngày tiền về.',
    kpi: {
      net: 'Doanh thu',
      netInfo:
        'Đã thu trừ đã hoàn lại. Không gồm tiền tip. Gói liệu trình tính lúc bán. Đơn online tính vào ngày giao hàng.',
      collected: 'Đã thu',
      collectedInfo:
        'Tiền mặt và PayOS đã thu trong giai đoạn, không gồm khoản thu bị đảo do nhập nhầm.',
      givenBack: 'Đã hoàn lại',
      givenBackInfo: 'Hoàn tiền sản phẩm và tiền trả lại khi đổi hàng sang món rẻ hơn.',
      paidInvoices: 'Hóa đơn đã thanh toán',
      paidInvoicesInfo: 'Số hóa đơn đã thanh toán đủ trong giai đoạn và tổng giá trị của chúng.',
      visits: 'Lượt đến',
      visitsInfo: 'Số lượt khách đến và đã làm xong dịch vụ trong giai đoạn.',
      held: 'Đã thu, chưa giao',
      heldInfo:
        'Đơn online đã thanh toán nhưng chưa giao tới khách. Số hiện tại, chưa tính vào doanh thu.',
      average: 'Trung bình {amount} một hóa đơn',
      shipping: 'Trong đó phí giao hàng {amount}',
    },
    chart: {
      title: 'Doanh thu theo thời gian',
      subtitle: 'Doanh thu theo {bucket}',
      partial: 'Kỳ đầu và kỳ cuối có thể chưa đủ ngày.',
      current: 'Doanh thu',
      previous: 'Kỳ trước',
    },
    tabs: { branch: 'Chi nhánh', kind: 'Nhóm và loại', method: 'Cách thanh toán' },
    columns: {
      branch: 'Chi nhánh',
      net: 'Doanh thu',
      collected: 'Đã thu',
      refunds: 'Hoàn tiền',
      exchanges: 'Hoàn khi đổi hàng',
      paidInvoices: 'Hóa đơn',
      visits: 'Lượt đến',
      previous: 'Kỳ trước',
      group: 'Nhóm',
      by: 'Phân theo',
      item: 'Mục',
      kind: 'Loại',
      channel: 'Kênh',
      share: 'Tỷ lệ',
      method: 'Cách thanh toán',
      moneyIn: 'Thu vào',
      moneyOut: 'Chi ra',
    },
    side: { SPA: 'Spa', BEAUTY: 'Mỹ phẩm', UNCLASSIFIED: 'Chưa phân loại' },
    kind: { SERVICE: 'Dịch vụ', COMBO: 'Gói liệu trình', PRODUCT: 'Sản phẩm', OTHER: 'Khác' },
    channel: { COUNTER: 'Tại quầy', ONLINE: 'Online' },
    method: { CASH: 'Tiền mặt', PAYOS: 'PayOS', TRANSFER: 'Chuyển khoản thủ công' },
    unclassified:
      'Có {amount} chưa biết thuộc nhóm Spa hay Mỹ phẩm. Số này vẫn nằm trong doanh thu.',
    definitionTitle: 'Cách tính doanh thu',
    definition:
      'Doanh thu là tiền đã thu thực tế (tiền mặt và PayOS) trừ tiền đã hoàn lại cho khách, tính theo ngày tiền về. Không gồm tiền tip. Gói liệu trình tính lúc bán, các buổi dùng sau đó không tính lại. Đơn online tính vào ngày giao hàng; đã thu mà chưa giao thì nằm ở mục "Đã thu, chưa giao". Khoản thu bị đảo vì nhập nhầm không tính.',
    empty: 'Chưa có khoản thu nào trong giai đoạn này.',
    emptyBranches: 'Chưa có chi nhánh nào để xem báo cáo.',
    donutTitle: 'Doanh thu theo nhóm',
    donutOther: 'Khác',
    donutTotal: 'Doanh thu',
  },
  refunds: {
    title: 'Hoàn tiền và điều chỉnh',
    intro:
      'Tiền đã hoàn lại cho khách, tiền trả lại khi đổi hàng và các khoản thu bị đảo do nhập nhầm.',
    totals: 'Hoàn tiền {refunds} · Đổi hàng {exchanges} · Khoản thu bị đảo {reversals}',
    kinds: {
      REFUND: 'Hoàn tiền sản phẩm',
      EXCHANGE: 'Trả lại khi đổi hàng',
      PAYMENT_REVERSAL: 'Đảo khoản thu nhập nhầm',
    },
    columns: {
      date: 'Ngày',
      branch: 'Chi nhánh',
      type: 'Loại',
      invoice: 'Hóa đơn',
      code: 'Mã',
      amount: 'Số tiền',
      method: 'Cách hoàn',
      reason: 'Lý do',
    },
    failedDelivery: 'Giao không thành công',
    methods: { CASH: 'Tiền mặt', TRANSFER: 'Chuyển khoản thủ công', PAYOS: 'PayOS' },
    empty: 'Không có hoàn tiền hay điều chỉnh nào trong giai đoạn này.',
    anomalies: '{count} khoản thanh toán PayOS bất thường trong giai đoạn này.',
    list: 'Danh sách',
  },
  export: {
    title: 'Xuất báo cáo',
    intro: 'File có đúng số liệu đang xem, theo cùng khoảng thời gian và chi nhánh.',
    content: 'Nội dung',
    format: 'Định dạng',
    xlsx: 'Excel (.xlsx)',
    xlsxHint: 'Có thêm trang thông tin: giai đoạn, chi nhánh, người xuất và cách tính doanh thu.',
    csv: 'CSV (.csv)',
    csvHint: 'Chỉ có số liệu, mở được bằng mọi phần mềm bảng tính.',
    pdf: 'PDF',
    pdfHint: 'Mở hộp thoại in của trình duyệt, chọn "Lưu dưới dạng PDF".',
    submit: 'Tải xuống',
    print: 'In trang',
    submitting: 'Đang tạo file...',
    done: 'Đã tạo file {name}.',
    cap: 'Mỗi file tối đa 100.000 dòng.',
    scope: 'Chỉ gồm các chi nhánh bạn được phép xuất báo cáo.',
    noPermission: 'Bạn chưa được phép xuất báo cáo này.',
  },
  exportChoices: {
    'revenue-overview': 'Doanh thu theo thời gian',
    'revenue-by-branch': 'Doanh thu theo chi nhánh',
    'revenue-by-kind': 'Doanh thu theo nhóm và loại',
    'revenue-by-method': 'Doanh thu theo cách thanh toán',
    refunds: 'Hoàn tiền và điều chỉnh',
  },
  errors: {
    REPORT_TIMEOUT: 'Báo cáo quá lớn nên chưa xem được. Hãy chọn khoảng thời gian ngắn hơn.',
    REPORT_RANGE_TOO_LONG: 'Mỗi lần chỉ xem được tối đa 366 ngày.',
    REPORT_RANGE_INVALID: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.',
    REPORT_TOO_MANY_ROWS: 'File sẽ có hơn 100.000 dòng. Hãy chọn khoảng thời gian ngắn hơn.',
    REPORT_TOTALS_DIFFER: 'Các phần của báo cáo không khớp với tổng. Hãy báo cho quản trị viên.',
    EXPORT_BUSY: 'Đang tạo hai file khác. Đợi một chút rồi thử lại.',
    FORBIDDEN: 'Bạn chưa được phép xem hoặc xuất báo cáo này.',
  },
  print: {
    generated: 'In lúc {time}',
    branches: 'Chi nhánh: {names}',
    period: 'Giai đoạn: {period}',
  },
  dashboard: {
    title: 'Doanh thu',
    today: 'Hôm nay',
    comparedTo: 'so với hôm qua',
    sevenDays: 'Doanh thu 7 ngày qua',
    paid: '{count} hóa đơn đã thanh toán',
    held: 'Đã thu, chưa giao: {amount}',
    empty: 'Chưa có khoản thu nào trong 7 ngày qua.',
    open: 'Xem báo cáo',
    info: 'Tiền đã thu trừ tiền đã hoàn lại, tính theo ngày tiền về. Không gồm tiền tip.',
    cash: 'Tiền mặt',
    payos: 'PayOS',
    out: 'Hoàn lại',
  },
};

const en: Words = {
  nav: { revenue: 'Revenue', refunds: 'Refunds and corrections' },
  common: {
    branch: 'Branch',
    allBranches: 'All branches',
    period: 'Period',
    compare: 'Compare',
    compareNone: 'No comparison',
    comparePrevious: 'Previous period',
    group: 'Group by',
    groupAuto: 'Automatic grouping',
    compareVsPrevious: 'Compare with previous period',
    vsPrevious: 'compared with the previous period',
    reload: 'Reload',
    export: 'Export',
    updated: 'Data as of {time}',
    rangeTooLong: 'Choose at most {days} days at a time.',
  },
  buckets: { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' },
  bucketsBy: {
    day: 'By day',
    week: 'By week',
    month: 'By month',
    quarter: 'By quarter',
    year: 'By year',
  },
  picker: {
    title: 'Date range',
    placeholder: 'Choose a period',
    presets: {
      today: 'Today',
      yesterday: 'Yesterday',
      last7: 'Last 7 days',
      last30: 'Last 30 days',
      thisMonth: 'This month',
      lastMonth: 'Last month',
    },
    custom: 'Custom',
    apply: 'Apply',
    cancel: 'Cancel',
    close: 'Close',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    pickEnd: 'Pick the last day.',
    maxRange: 'Longest range: {days} days.',
  },
  revenue: {
    title: 'Revenue',
    intro: 'Money collected minus money given back to customers, on the day the money came in.',
    kpi: {
      net: 'Revenue',
      netInfo:
        'Collected minus given back. Tips are not included. A combo counts when it is sold. An online order counts on its delivery day.',
      collected: 'Collected',
      collectedInfo:
        'Cash and PayOS collected in the period, without payments reversed as a mistake.',
      givenBack: 'Given back',
      givenBackInfo:
        'Product refunds and the money paid back when a customer exchanges for something cheaper.',
      paidInvoices: 'Paid invoices',
      paidInvoicesInfo: 'Invoices paid in full in the period, and their total value.',
      visits: 'Visits',
      visitsInfo: 'Customers who came and had their services done in the period.',
      held: 'Collected, not delivered',
      heldInfo:
        'Online orders that are paid but not delivered yet. The current figure; not in revenue yet.',
      average: 'Average {amount} per invoice',
      shipping: 'Of which shipping {amount}',
    },
    chart: {
      title: 'Revenue over time',
      subtitle: 'Revenue by {bucket}',
      partial: 'The first and last periods may be incomplete.',
      current: 'Revenue',
      previous: 'Previous period',
    },
    tabs: { branch: 'Branches', kind: 'Group and kind', method: 'Payment method' },
    columns: {
      branch: 'Branch',
      net: 'Revenue',
      collected: 'Collected',
      refunds: 'Refunds',
      exchanges: 'Paid back on exchange',
      paidInvoices: 'Invoices',
      visits: 'Visits',
      previous: 'Previous period',
      group: 'Group',
      by: 'Split by',
      item: 'Item',
      kind: 'Kind',
      channel: 'Channel',
      share: 'Share',
      method: 'Payment method',
      moneyIn: 'Money in',
      moneyOut: 'Money out',
    },
    side: { SPA: 'Spa', BEAUTY: 'Cosmetics', UNCLASSIFIED: 'Unclassified' },
    kind: { SERVICE: 'Service', COMBO: 'Combo package', PRODUCT: 'Product', OTHER: 'Other' },
    channel: { COUNTER: 'Counter', ONLINE: 'Online' },
    method: { CASH: 'Cash', PAYOS: 'PayOS', TRANSFER: 'Manual transfer' },
    unclassified: '{amount} could not be placed in Spa or Cosmetics. It is still part of revenue.',
    definitionTitle: 'How revenue is counted',
    definition:
      'Revenue is the money actually collected (cash and PayOS) minus the money given back to customers, on the day the money came in. Tips are not included. A combo counts when it is sold; sessions used later are not counted again. An online order counts on its delivery day; money collected but not delivered yet is under "Collected, not delivered". A payment reversed as a mistake is not counted.',
    empty: 'No money was collected in this period.',
    emptyBranches: 'There is no branch to show a report for.',
    donutTitle: 'Revenue by group',
    donutOther: 'Other',
    donutTotal: 'Revenue',
  },
  refunds: {
    title: 'Refunds and corrections',
    intro:
      'Money given back to customers, money paid back on exchanges and payments reversed as a mistake.',
    totals: 'Refunds {refunds} · Exchanges {exchanges} · Reversed payments {reversals}',
    kinds: {
      REFUND: 'Product refund',
      EXCHANGE: 'Paid back on exchange',
      PAYMENT_REVERSAL: 'Payment reversed as a mistake',
    },
    columns: {
      date: 'Date',
      branch: 'Branch',
      type: 'Type',
      invoice: 'Invoice',
      code: 'Code',
      amount: 'Amount',
      method: 'Paid back by',
      reason: 'Reason',
    },
    failedDelivery: 'Failed delivery',
    methods: { CASH: 'Cash', TRANSFER: 'Manual transfer', PAYOS: 'PayOS' },
    empty: 'No refunds or corrections in this period.',
    anomalies: '{count} unusual PayOS payments in this period.',
    list: 'List',
  },
  export: {
    title: 'Export report',
    intro: 'The file holds exactly the figures on screen, for the same period and branches.',
    content: 'Content',
    format: 'Format',
    xlsx: 'Excel (.xlsx)',
    xlsxHint:
      'Has an extra information sheet: period, branches, who exported it and how revenue is counted.',
    csv: 'CSV (.csv)',
    csvHint: 'Figures only; opens in any spreadsheet program.',
    pdf: 'PDF',
    pdfHint: 'Opens the browser print dialog; choose "Save as PDF".',
    submit: 'Download',
    print: 'Print page',
    submitting: 'Preparing the file...',
    done: 'File {name} is ready.',
    cap: 'A file holds at most 100,000 rows.',
    scope: 'Only the branches you may export reports for.',
    noPermission: 'You may not export this report.',
  },
  exportChoices: {
    'revenue-overview': 'Revenue over time',
    'revenue-by-branch': 'Revenue by branch',
    'revenue-by-kind': 'Revenue by group and kind',
    'revenue-by-method': 'Revenue by payment method',
    refunds: 'Refunds and corrections',
  },
  errors: {
    REPORT_TIMEOUT: 'The report is too large to show. Choose a shorter period.',
    REPORT_RANGE_TOO_LONG: 'You can look at 366 days at most at a time.',
    REPORT_RANGE_INVALID: 'The start date must not be after the end date.',
    REPORT_TOO_MANY_ROWS: 'The file would have more than 100,000 rows. Choose a shorter period.',
    REPORT_TOTALS_DIFFER:
      'The parts of the report do not add up to its total. Tell an administrator.',
    EXPORT_BUSY: 'Two other files are being prepared. Wait a moment and try again.',
    FORBIDDEN: 'You may not view or export this report.',
  },
  print: { generated: 'Printed {time}', branches: 'Branches: {names}', period: 'Period: {period}' },
  dashboard: {
    title: 'Revenue',
    today: 'Today',
    comparedTo: 'compared with yesterday',
    sevenDays: 'Revenue, last 7 days',
    paid: '{count} paid invoices',
    held: 'Collected, not delivered: {amount}',
    empty: 'No money was collected in the last 7 days.',
    open: 'Open the report',
    info: 'Money collected minus money given back, on the day the money came in. Tips are not included.',
    cash: 'Cash',
    payos: 'PayOS',
    out: 'Given back',
  },
};

const dictionaries: Record<Locale, Words> = { vi, en };

export function reportsDictionary(locale: Locale): Words {
  return dictionaries[locale];
}
export type ReportsDictionary = Words;
