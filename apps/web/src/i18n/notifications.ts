import type { LeaveType, NotificationCategory, NotificationType } from '@lucy-spa/contracts';
import type { Locale } from './locales';

/** Templates rendered from structured, validated notification params (never free text). */
interface FinanceTexts {
  paid: string;
  paymentSucceeded: string;
  anomaly: string;
  anomalyKinds: Record<'AMOUNT_MISMATCH' | 'INVOICE_NOT_PAYABLE' | 'EXCEEDS_BALANCE', string>;
  reversed: string;
  cancelledAlert: string;
  cancelledFrom: Record<'PENDING_PAYMENT' | 'PAID', string>;
  methods: Record<'CASH' | 'PAYOS', string>;
  summary: string;
  notApplicable: string;
  openInvoice: string;
}

const vi = {
  title: 'Thông báo',
  intro: 'Thông báo trong ứng dụng về lịch hẹn, dịch vụ và công việc của bạn.',
  unread: 'Chưa đọc',
  read: 'Đã đọc',
  archivedBadge: 'Đã lưu trữ',
  markRead: 'Đánh dấu đã đọc',
  markAllRead: 'Đánh dấu tất cả đã đọc',
  archive: 'Lưu trữ',
  working: 'Đang lưu…',
  empty: 'Chưa có thông báo.',
  emptyFiltered: 'Không có thông báo phù hợp với bộ lọc.',
  emptyArchived: 'Chưa có thông báo nào được lưu trữ.',
  loading: 'Đang tải…',
  refresh: 'Tải lại',
  more: 'Tải thêm',
  open: 'Xem công việc',
  openLeave: 'Mở trang nghỉ phép',
  error: 'Không thể tải hoặc lưu thông báo. Vui lòng thử lại.',
  countUnavailable: 'Chưa tải được số thông báo chưa đọc',
  bell: 'Thông báo',
  bellUnread: 'chưa đọc',
  filters: 'Bộ lọc thông báo',
  allCategories: 'Tất cả',
  unreadOnly: 'Chỉ chưa đọc',
  showArchived: 'Đã lưu trữ',
  showInbox: 'Hộp thư',
  category: 'Nhóm thông báo',
  view: 'Hiển thị',
  columnMessage: 'Thông báo',
  columnTime: 'Thời gian',
  columnSource: 'Nguồn',
  columnStatus: 'Trạng thái',
  columnActions: 'Thao tác',
  actionsFor: 'Thao tác cho thông báo {code}',
  categories: {
    OPERATIONS: 'Vận hành',
    HR: 'Nhân sự',
    FINANCE: 'Tài chính',
  } satisfies Record<NotificationCategory, string>,
  types: {
    BOOKING_CREATED: 'Lịch hẹn đã được xác nhận.',
    BOOKING_CANCELLED: 'Lịch hẹn đã bị hủy.',
    LATE_CANCELLATION: 'Khách đã hủy sát giờ hẹn. Quản lý cần lưu ý.',
    BOOKING_NO_SHOW: 'Lịch hẹn được ghi nhận khách không đến.',
    CUSTOMER_ARRIVED: 'Khách đã đến và đang chờ phục vụ.',
    BOOKING_KTV_CONFLICT:
      'KTV nghỉ phép trùng lịch phục vụ. Cần giải quyết với khách và điều phối.',
    KTV_REASSIGNED: 'KTV phụ trách dịch vụ đã được thay đổi qua điều phối.',
    START_OVERDUE: 'Dịch vụ đã quá giờ bắt đầu và chưa START. Vui lòng kiểm tra.',
    PRE_END: 'Dịch vụ sắp đến giờ kết thúc dự kiến. Vui lòng theo dõi.',
    END_OVERDUE: 'Dịch vụ đã quá giờ kết thúc dự kiến và chưa END. KTV vẫn đang bận.',
    LEAVE_REQUESTED: 'Có đơn xin nghỉ cần bạn xử lý.',
    LEAVE_DECIDED: 'Đơn xin nghỉ của bạn đã có quyết định.',
    INVOICE_PAID: 'Hóa đơn của bạn đã được thanh toán.',
    INVOICE_CANCELLED: 'Hóa đơn của bạn đã bị hủy.',
    PAYOS_PAYMENT_SUCCEEDED: 'Yêu cầu thanh toán PayOS bạn tạo đã thành công.',
    PAYOS_PAYMENT_ANOMALY: 'Có giao dịch PayOS bất thường cần xem xét.',
    PAYMENT_REVERSED: 'Một khoản thanh toán đã được hoàn tác (điều chỉnh).',
    INVOICE_CANCELLED_ALERT: 'Một hóa đơn đã hoàn tất vừa bị hủy.',
    REVENUE_DAILY_SUMMARY: 'Tổng kết doanh thu trong ngày.',
  } satisfies Record<NotificationType, string>,
  leave: {
    requested: 'Có đơn xin nghỉ ({type}) từ {from} đến {to} cần bạn xử lý.',
    approved: 'Đơn xin nghỉ ({type}) từ {from} đến {to} của bạn đã được duyệt.',
    rejected: 'Đơn xin nghỉ ({type}) từ {from} đến {to} của bạn đã bị từ chối.',
    types: {
      ANNUAL: 'phép năm',
      SICK: 'nghỉ ốm',
      PERSONAL: 'việc cá nhân',
      FAMILY_EVENT: 'việc gia đình',
      MATERNITY: 'thai sản',
      OTHER: 'khác',
    } satisfies Record<LeaveType, string>,
  },
  finance: {
    paid: 'Hóa đơn của bạn đã được thanh toán đủ ({amount}).',
    paymentSucceeded: 'Yêu cầu thanh toán PayOS bạn tạo đã thành công ({amount}).',
    anomaly:
      'Giao dịch PayOS bất thường ({kind}): nhận {received}, dự kiến {expected}. Chưa được ghi nhận vào hóa đơn.',
    anomalyKinds: {
      AMOUNT_MISMATCH: 'sai số tiền',
      INVOICE_NOT_PAYABLE: 'hóa đơn không còn nhận thanh toán',
      EXCEEDS_BALANCE: 'vượt số còn phải trả',
    },
    reversed:
      'Một khoản thanh toán {method} ({amount}) đã được hoàn tác (điều chỉnh, không phải hoàn tiền).',
    cancelledAlert: 'Hóa đơn ({amount}) đã bị hủy khi đang ở trạng thái {from}.',
    cancelledFrom: { PENDING_PAYMENT: 'chờ thanh toán', PAID: 'đã thanh toán' },
    methods: { CASH: 'tiền mặt', PAYOS: 'PayOS' },
    summary:
      'Tổng kết ngày {date} (đến 21:30): đã thu {total} (tiền mặt {cash}, PayOS {payos}); {paid} hóa đơn đã thanh toán; {pending} hóa đơn chờ thanh toán.',
    notApplicable: 'không có',
    openInvoice: 'Xem hóa đơn',
  } satisfies FinanceTexts,
};
type Dictionary = {
  [K in keyof typeof vi]: K extends 'types'
    ? Record<NotificationType, string>
    : K extends 'categories'
      ? Record<NotificationCategory, string>
      : K extends 'finance'
        ? FinanceTexts
        : K extends 'leave'
          ? {
              requested: string;
              approved: string;
              rejected: string;
              types: Record<LeaveType, string>;
            }
          : string;
};
const en: Dictionary = {
  title: 'Notifications',
  intro: 'In-app updates about your bookings, service work and tasks.',
  unread: 'Unread',
  read: 'Read',
  archivedBadge: 'Archived',
  markRead: 'Mark read',
  markAllRead: 'Mark all as read',
  archive: 'Archive',
  working: 'Saving…',
  empty: 'No notifications yet.',
  emptyFiltered: 'No notifications match the filters.',
  emptyArchived: 'No archived notifications.',
  loading: 'Loading…',
  refresh: 'Refresh',
  more: 'Load more',
  open: 'View work',
  openLeave: 'Open leave page',
  error: 'Could not load or save notifications. Please try again.',
  countUnavailable: 'Unread count is unavailable',
  bell: 'Notifications',
  bellUnread: 'unread',
  filters: 'Notification filters',
  allCategories: 'All',
  unreadOnly: 'Unread only',
  showArchived: 'Archived',
  showInbox: 'Inbox',
  category: 'Notification group',
  view: 'Show',
  columnMessage: 'Notification',
  columnTime: 'Time',
  columnSource: 'Source',
  columnStatus: 'Status',
  columnActions: 'Actions',
  actionsFor: 'Actions for notification {code}',
  categories: {
    OPERATIONS: 'Operations',
    HR: 'People',
    FINANCE: 'Finance',
  },
  types: {
    BOOKING_CREATED: 'The booking was confirmed.',
    BOOKING_CANCELLED: 'The booking was cancelled.',
    LATE_CANCELLATION:
      'The customer cancelled close to the appointment. Management attention is needed.',
    BOOKING_NO_SHOW: 'The booking was marked as a no-show.',
    CUSTOMER_ARRIVED: 'The customer has arrived for service.',
    BOOKING_KTV_CONFLICT:
      'Approved leave conflicts with assigned work. Customer and operational resolution is needed.',
    KTV_REASSIGNED: 'The assigned service staff member was changed through reassignment.',
    START_OVERDUE: 'The service is overdue to START. Please check the assigned work.',
    PRE_END: 'The service is approaching its expected end. Please check progress.',
    END_OVERDUE: 'The expected end has passed without END. The staff member remains busy.',
    LEAVE_REQUESTED: 'A leave request needs your attention.',
    LEAVE_DECIDED: 'Your leave request has been decided.',
    INVOICE_PAID: 'Your invoice has been paid.',
    INVOICE_CANCELLED: 'Your invoice was cancelled.',
    PAYOS_PAYMENT_SUCCEEDED: 'The PayOS payment request you created succeeded.',
    PAYOS_PAYMENT_ANOMALY: 'A PayOS transaction needs review.',
    PAYMENT_REVERSED: 'A payment was reversed (a correction).',
    INVOICE_CANCELLED_ALERT: 'A completed invoice was cancelled.',
    REVENUE_DAILY_SUMMARY: 'Daily revenue summary.',
  },
  leave: {
    requested: 'A leave request ({type}) from {from} to {to} needs your attention.',
    approved: 'Your leave request ({type}) from {from} to {to} was approved.',
    rejected: 'Your leave request ({type}) from {from} to {to} was rejected.',
    types: {
      ANNUAL: 'annual leave',
      SICK: 'sick leave',
      PERSONAL: 'personal',
      FAMILY_EVENT: 'family event',
      MATERNITY: 'maternity',
      OTHER: 'other',
    },
  },
  finance: {
    paid: 'Your invoice has been paid in full ({amount}).',
    paymentSucceeded: 'The PayOS payment request you created succeeded ({amount}).',
    anomaly:
      'PayOS anomaly ({kind}): received {received}, expected {expected}. It was not applied to the invoice.',
    anomalyKinds: {
      AMOUNT_MISMATCH: 'amount mismatch',
      INVOICE_NOT_PAYABLE: 'invoice no longer payable',
      EXCEEDS_BALANCE: 'exceeds the balance',
    },
    reversed: 'A {method} payment ({amount}) was reversed (a correction, not a refund).',
    cancelledAlert: 'An invoice ({amount}) was cancelled while {from}.',
    cancelledFrom: { PENDING_PAYMENT: 'awaiting payment', PAID: 'paid' },
    methods: { CASH: 'cash', PAYOS: 'PayOS' },
    summary:
      'Summary for {date} (up to 21:30): collected {total} (cash {cash}, PayOS {payos}); {paid} paid invoices; {pending} awaiting payment.',
    notApplicable: 'n/a',
    openInvoice: 'View invoice',
  },
};
export function getNotificationDictionary(locale: Locale): Dictionary {
  return locale === 'vi' ? vi : en;
}
