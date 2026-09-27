import type { NotificationType } from '@lucy-spa/contracts';
import type { Locale } from './locales';

const vi = {
  title: 'Thông báo',
  intro: 'Thông báo trong ứng dụng về lịch hẹn và dịch vụ của bạn.',
  unread: 'Chưa đọc',
  read: 'Đã đọc',
  markRead: 'Đánh dấu đã đọc',
  working: 'Đang lưu…',
  empty: 'Chưa có thông báo.',
  loading: 'Đang tải…',
  refresh: 'Tải lại',
  more: 'Tải thêm',
  open: 'Xem công việc',
  error: 'Không thể tải hoặc lưu thông báo. Vui lòng thử lại.',
  countUnavailable: 'Chưa tải được số thông báo chưa đọc',
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
  } satisfies Record<NotificationType, string>,
};
type Dictionary = {
  [K in keyof typeof vi]: K extends 'types' ? Record<NotificationType, string> : string;
};
const en: Dictionary = {
  title: 'Notifications',
  intro: 'In-app updates about your bookings and service work.',
  unread: 'Unread',
  read: 'Read',
  markRead: 'Mark read',
  working: 'Saving…',
  empty: 'No notifications yet.',
  loading: 'Loading…',
  refresh: 'Refresh',
  more: 'Load more',
  open: 'View work',
  error: 'Could not load or save notifications. Please try again.',
  countUnavailable: 'Unread count is unavailable',
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
  },
};
export function getNotificationDictionary(locale: Locale): Dictionary {
  return locale === 'vi' ? vi : en;
}
