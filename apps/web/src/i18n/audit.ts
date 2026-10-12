import type { Locale } from './locales';

/**
 * Phase 8 P8-14: texts of the audit-log screen ("Nhật ký hoạt động"). The log is read-only; what a person sees is decided by the API (design
 * section 9 of the authorization design: pay events need the pay permission, financial events the revenue permission). Lucy Spa is a spa:
 * never "khám".
 */
interface Words {
  title: string;
  intro: string;
  readOnlyNote: string;
  columns: { time: string; who: string; what: string; kind: string; about: string; reason: string };
  system: string;
  bootstrap: string;
  actionFilter: string;
  actionPlaceholder: string;
  actionInvalid: string;
  empty: string;
  more: string;
  loading: string;
  details: string;
  detailsTitle: string;
  fields: {
    time: string;
    who: string;
    action: string;
    about: string;
    entity: string;
    request: string;
    reason: string;
    classification: string;
    before: string;
    after: string;
    none: string;
  };
  classification: { STANDARD: string; EMPLOYEE_PAY: string; FINANCIAL: string };
  areas: Record<string, string>;
}

const areasVi: Record<string, string> = {
  invoice: 'Hóa đơn',
  payment: 'Thanh toán',
  cash: 'Sổ quỹ',
  pay: 'Lương',
  tip: 'Tip',
  stock: 'Kho',
  product: 'Sản phẩm',
  combo: 'Combo',
  discount: 'Giảm giá',
  loyalty: 'Điểm thưởng',
  online: 'Đơn online',
  operations: 'Vận hành',
  access: 'Tài khoản và phân quyền',
  website: 'Website',
  report: 'Báo cáo',
  other: 'Khác',
};

const areasEn: Record<string, string> = {
  invoice: 'Invoices',
  payment: 'Payments',
  cash: 'Cash book',
  pay: 'Pay',
  tip: 'Tips',
  stock: 'Stock',
  product: 'Products',
  combo: 'Combos',
  discount: 'Discounts',
  loyalty: 'Loyalty',
  online: 'Online orders',
  operations: 'Operations',
  access: 'Accounts and access',
  website: 'Website',
  report: 'Reports',
  other: 'Other',
};

const vi: Words = {
  title: 'Nhật ký hoạt động',
  intro: 'Ai đã làm gì và khi nào. Chỉ đọc: nhật ký không bao giờ bị sửa hay xóa.',
  readOnlyNote: 'Bạn chỉ thấy những dòng thuộc chi nhánh và loại dữ liệu bạn được xem.',
  columns: {
    time: 'Thời gian',
    who: 'Người làm',
    what: 'Việc đã làm',
    kind: 'Loại dữ liệu',
    about: 'Liên quan đến',
    reason: 'Lý do',
  },
  system: 'Hệ thống',
  bootstrap: 'Thiết lập ban đầu',
  actionFilter: 'Mã việc',
  actionPlaceholder: 'Mã việc, ví dụ INVOICE_PAID',
  actionInvalid: 'Mã việc gồm chữ in hoa, số và dấu gạch dưới.',
  empty: 'Không có dòng nhật ký nào khớp.',
  more: 'Tải thêm dòng cũ hơn',
  loading: 'Đang tải',
  details: 'Xem chi tiết',
  detailsTitle: 'Chi tiết',
  fields: {
    time: 'Thời gian',
    who: 'Người làm',
    action: 'Mã việc',
    about: 'Liên quan đến',
    entity: 'Đối tượng',
    request: 'Mã yêu cầu',
    reason: 'Lý do',
    classification: 'Loại dữ liệu',
    before: 'Trước',
    after: 'Sau',
    none: 'Không có',
  },
  classification: { STANDARD: 'Thường', EMPLOYEE_PAY: 'Lương', FINANCIAL: 'Tài chính' },
  areas: areasVi,
};

const en: Words = {
  title: 'Activity log',
  intro: 'Who did what and when. Read-only: the log is never edited or deleted.',
  readOnlyNote: 'You only see the rows of the branches and kinds of data you may read.',
  columns: {
    time: 'Time',
    who: 'By',
    what: 'What happened',
    kind: 'Kind of data',
    about: 'About',
    reason: 'Reason',
  },
  system: 'System',
  bootstrap: 'Initial setup',
  actionFilter: 'Action code',
  actionPlaceholder: 'Action code, for example INVOICE_PAID',
  actionInvalid: 'An action code is capital letters, digits and underscores.',
  empty: 'No log row matches.',
  more: 'Load older rows',
  loading: 'Loading',
  details: 'View details',
  detailsTitle: 'Details',
  fields: {
    time: 'Time',
    who: 'By',
    action: 'Action code',
    about: 'About',
    entity: 'Object',
    request: 'Request',
    reason: 'Reason',
    classification: 'Kind of data',
    before: 'Before',
    after: 'After',
    none: 'None',
  },
  classification: { STANDARD: 'Standard', EMPLOYEE_PAY: 'Pay', FINANCIAL: 'Financial' },
  areas: areasEn,
};

export function auditDictionary(locale: Locale): Words {
  return locale === 'en' ? en : vi;
}

export type AuditDictionary = Words;

/** The area an action belongs to, from the start of its code. */
const AREA_PREFIXES: readonly [string, string][] = [
  ['INVOICE_', 'invoice'],
  ['PAYMENT_', 'payment'],
  ['PAYSLIP', 'pay'],
  ['PAY_RUN_', 'pay'],
  ['ADVANCE_', 'pay'],
  ['SALARY_', 'pay'],
  ['BASE_SALARY_', 'pay'],
  ['TOUR_RULE_', 'pay'],
  ['COMMISSION_', 'pay'],
  ['STAFF_CODE_', 'pay'],
  ['COLLABORATOR_', 'pay'],
  ['CASH_', 'cash'],
  ['FINANCE_', 'cash'],
  ['TIP_', 'tip'],
  ['STOCK_', 'stock'],
  ['SUPPLIER_', 'stock'],
  ['PRODUCT_', 'product'],
  ['COMBO_', 'combo'],
  ['DISCOUNT_', 'discount'],
  ['VOUCHER_', 'discount'],
  ['LOYALTY_', 'loyalty'],
  ['REFERRAL_', 'loyalty'],
  ['REWARD_', 'loyalty'],
  ['BIRTHDAY_', 'loyalty'],
  ['ONLINE_', 'online'],
  ['SHIPPING_', 'online'],
  ['BOOKING_', 'operations'],
  ['WALK_IN_', 'operations'],
  ['VISIT_', 'operations'],
  ['KTV_', 'operations'],
  ['QUEUE_', 'operations'],
  ['WAITING_', 'operations'],
  ['SERVICE_', 'operations'],
  ['ROLE_', 'access'],
  ['PERMISSION_', 'access'],
  ['ORGANIZATION_', 'access'],
  ['TEAM_', 'access'],
  ['REGION_', 'access'],
  ['AREA_', 'access'],
  ['BRANCH_', 'access'],
  ['USER_', 'access'],
  ['ACCESS_', 'access'],
  ['OWNER_', 'access'],
  ['PASSWORD_', 'access'],
  ['SESSION', 'access'],
  ['PROFILE_', 'access'],
  ['RECOVERY_', 'access'],
  ['CUSTOMER_', 'access'],
  ['MEDIA_', 'website'],
  ['POPUP_', 'website'],
  ['SLIDE', 'website'],
  ['SEASON_', 'website'],
  ['SHOP_INFO_', 'website'],
  ['REPORT_', 'report'],
];

export function auditArea(action: string): string {
  return AREA_PREFIXES.find(([prefix]) => action.startsWith(prefix))?.[1] ?? 'other';
}
