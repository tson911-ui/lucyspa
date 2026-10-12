/**
 * Phase 8 P8-4: the words in a report file. A file leaves the product, so its headers cannot depend on the screen's i18n: they are fixed
 * here, Vietnamese by default and English on request. Natural Vietnamese; Lucy Spa is a spa, never "khám".
 */
export type ExportLocale = 'vi' | 'en';

interface Words {
  sheetData: string;
  sheetInfo: string;
  info: Record<
    | 'report'
    | 'period'
    | 'branches'
    | 'exportedAt'
    | 'exportedBy'
    | 'definition'
    | 'rows'
    | 'compared',
    string
  >;
  definition: string;
  reports: Record<string, string>;
  side: Record<string, string>;
  kind: Record<string, string>;
  channel: Record<string, string>;
  method: Record<string, string>;
  refundKind: Record<string, string>;
  col: Record<string, string>;
}

const vi: Words = {
  sheetData: 'Dữ liệu',
  sheetInfo: 'Thông tin',
  info: {
    report: 'Báo cáo',
    period: 'Giai đoạn',
    branches: 'Chi nhánh',
    exportedAt: 'Xuất lúc',
    exportedBy: 'Người xuất',
    definition: 'Cách tính doanh thu',
    rows: 'Số dòng',
    compared: 'So sánh với',
  },
  definition:
    'Doanh thu = tiền đã thu thực tế (tiền mặt và PayOS) trừ tiền đã hoàn lại cho khách (hoàn trả sản phẩm và chênh lệch khi đổi hàng), tính theo ngày tiền về. Không gồm tiền tip. Gói liệu trình tính lúc bán. Đơn online tính vào ngày giao hàng; đã thu mà chưa giao thì chưa tính. Khoản thu bị đảo do nhập nhầm không tính.',
  reports: {
    'revenue-overview': 'Doanh thu theo thời gian',
    'revenue-by-branch': 'Doanh thu theo chi nhánh',
    'revenue-by-kind': 'Doanh thu theo nhóm và loại',
    'revenue-by-method': 'Doanh thu theo cách thanh toán',
    refunds: 'Hoàn tiền và điều chỉnh',
  },
  side: { SPA: 'Spa', BEAUTY: 'Mỹ phẩm', UNCLASSIFIED: 'Chưa phân loại' },
  kind: { SERVICE: 'Dịch vụ', COMBO: 'Gói liệu trình', PRODUCT: 'Sản phẩm', OTHER: 'Khác' },
  channel: { COUNTER: 'Tại quầy', ONLINE: 'Online' },
  method: { CASH: 'Tiền mặt', PAYOS: 'PayOS', TRANSFER: 'Chuyển khoản thủ công' },
  refundKind: {
    REFUND: 'Hoàn tiền sản phẩm',
    EXCHANGE: 'Hoàn chênh lệch khi đổi hàng',
    PAYMENT_REVERSAL: 'Đảo khoản thu nhập nhầm',
  },
  col: {
    date: 'Ngày',
    periodStart: 'Từ ngày',
    net: 'Doanh thu',
    collected: 'Đã thu',
    refunds: 'Hoàn tiền',
    exchanges: 'Hoàn khi đổi hàng',
    branchCode: 'Mã chi nhánh',
    branch: 'Chi nhánh',
    paidInvoices: 'Số hóa đơn đã thanh toán',
    visits: 'Số lượt đến',
    previousNet: 'Doanh thu kỳ trước',
    side: 'Nhóm',
    kind: 'Loại',
    channel: 'Kênh',
    method: 'Cách thanh toán',
    moneyIn: 'Thu vào',
    moneyOut: 'Chi ra',
    type: 'Loại',
    invoice: 'Hóa đơn',
    amount: 'Số tiền',
    reason: 'Lý do',
    code: 'Mã',
    failedDelivery: 'Giao thất bại',
    yes: 'Có',
    no: 'Không',
  },
};

const en: Words = {
  sheetData: 'Data',
  sheetInfo: 'Information',
  info: {
    report: 'Report',
    period: 'Period',
    branches: 'Branches',
    exportedAt: 'Exported at',
    exportedBy: 'Exported by',
    definition: 'How revenue is counted',
    rows: 'Rows',
    compared: 'Compared with',
  },
  definition:
    'Revenue = money actually collected (cash and PayOS) minus money given back to customers (product refunds and the difference paid back on an exchange), counted on the day the money came in. Tips are not included. A combo counts when it is sold. An online order counts on its delivery day; money collected but not delivered yet is not counted. A payment reversed as a mistake is not counted.',
  reports: {
    'revenue-overview': 'Revenue over time',
    'revenue-by-branch': 'Revenue by branch',
    'revenue-by-kind': 'Revenue by group and kind',
    'revenue-by-method': 'Revenue by payment method',
    refunds: 'Refunds and corrections',
  },
  side: { SPA: 'Spa', BEAUTY: 'Cosmetics', UNCLASSIFIED: 'Unclassified' },
  kind: { SERVICE: 'Service', COMBO: 'Combo package', PRODUCT: 'Product', OTHER: 'Other' },
  channel: { COUNTER: 'Counter', ONLINE: 'Online' },
  method: { CASH: 'Cash', PAYOS: 'PayOS', TRANSFER: 'Manual transfer' },
  refundKind: {
    REFUND: 'Product refund',
    EXCHANGE: 'Exchange difference paid back',
    PAYMENT_REVERSAL: 'Payment reversed as a mistake',
  },
  col: {
    date: 'Date',
    periodStart: 'From',
    net: 'Revenue',
    collected: 'Collected',
    refunds: 'Refunds',
    exchanges: 'Paid back on exchange',
    branchCode: 'Branch code',
    branch: 'Branch',
    paidInvoices: 'Paid invoices',
    visits: 'Visits',
    previousNet: 'Revenue, previous period',
    side: 'Group',
    kind: 'Kind',
    channel: 'Channel',
    method: 'Payment method',
    moneyIn: 'Money in',
    moneyOut: 'Money out',
    type: 'Type',
    invoice: 'Invoice',
    amount: 'Amount',
    reason: 'Reason',
    code: 'Code',
    failedDelivery: 'Failed delivery',
    yes: 'Yes',
    no: 'No',
  },
};

export const exportWords = (locale: ExportLocale): Words => (locale === 'en' ? en : vi);
export type { Words as ExportWords };
