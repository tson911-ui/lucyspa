import type { Locale } from './locales';

/**
 * Claude integration Wave B: the words of "Yêu cầu gọi lại", the inbox of the website chat's callback requests. Short natural Vietnamese;
 * a spa, not a clinic. The shop calls the visitor back; nothing is sent to the visitor from this screen.
 */
const vi = {
  nav: 'Yêu cầu gọi lại',
  title: 'Yêu cầu gọi lại',
  intro:
    'Số điện thoại khách để lại trên website khi trợ lý chưa trả lời được. Gọi cho khách, rồi đánh dấu đã gọi.',
  noAccessTitle: 'Chưa có quyền xem yêu cầu gọi lại',
  noAccess: 'Nhờ chủ spa cấp quyền xem yêu cầu gọi lại cho tài khoản của bạn.',
  table: 'Danh sách yêu cầu',
  emptyTitle: 'Chưa có yêu cầu gọi lại',
  empty: 'Yêu cầu mới từ trợ lý trên website sẽ hiện ở đây.',
  emptyFilteredTitle: 'Không có yêu cầu phù hợp',
  emptyFiltered: 'Không có yêu cầu nào ở trạng thái này.',
  showAll: 'Xem tất cả yêu cầu',
  closeTitle: 'Đóng yêu cầu?',
  closeBody:
    'Yêu cầu đã đóng không mở lại được. Số điện thoại và ghi chú tự xóa 90 ngày sau khi đóng.',
  closeKeep: 'Chưa đóng',
  filterStatus: 'Trạng thái',
  columns: {
    customer: 'Khách',
    phone: 'Số điện thoại',
    note: 'Ghi chú',
    branch: 'Chi nhánh',
    reason: 'Lý do',
    status: 'Trạng thái',
    created: 'Gửi lúc',
  },
  statuses: { NEW: 'Mới', CALLED: 'Đã gọi', CLOSED: 'Đã đóng' },
  reasons: {
    N8N_DOWN: 'Trợ lý chưa trả lời được',
    CAP_REACHED: 'Hết số tin trong ngày',
    OFF: 'Trợ lý đang tắt',
    VISITOR: 'Khách tự để lại',
  },
  purged: 'Đã xóa',
  noName: '—',
  menu: { called: 'Đã gọi', closed: 'Đóng yêu cầu' },
  menuLabel: 'Thao tác với yêu cầu của {name}',
  calledToast: 'Đã đánh dấu đã gọi.',
  closedToast: 'Đã đóng yêu cầu.',
  failed: 'Chưa cập nhật được. Danh sách đã tải lại; hãy kiểm tra rồi thử lại.',
  loadFailed: 'Không tải được các yêu cầu gọi lại.',
};

export type ChatRequestsText = typeof vi;

const en: ChatRequestsText = {
  nav: 'Callback requests',
  title: 'Callback requests',
  intro:
    'Numbers visitors left on the website when the assistant could not answer. Call them, then mark the request called.',
  noAccessTitle: 'No access to callback requests',
  noAccess: 'Ask the spa owner to give your account access to callback requests.',
  table: 'Request list',
  emptyTitle: 'No callback requests yet',
  empty: 'New requests from the website assistant will show here.',
  emptyFilteredTitle: 'No matching requests',
  emptyFiltered: 'No requests have this status.',
  showAll: 'Show all requests',
  closeTitle: 'Close this request?',
  closeBody:
    'A closed request cannot be reopened. The number and note are cleared 90 days after it is closed.',
  closeKeep: 'Keep open',
  filterStatus: 'Status',
  columns: {
    customer: 'Visitor',
    phone: 'Phone number',
    note: 'Note',
    branch: 'Branch',
    reason: 'Reason',
    status: 'Status',
    created: 'Sent',
  },
  statuses: { NEW: 'New', CALLED: 'Called', CLOSED: 'Closed' },
  reasons: {
    N8N_DOWN: 'The assistant could not answer',
    CAP_REACHED: 'Daily message limit reached',
    OFF: 'The assistant is off',
    VISITOR: 'Left by the visitor',
  },
  purged: 'Cleared',
  noName: '—',
  menu: { called: 'Mark called', closed: 'Close request' },
  menuLabel: 'Actions for the request of {name}',
  calledToast: 'Marked as called.',
  closedToast: 'Request closed.',
  failed: 'It could not be updated. The list was reloaded; please check and try again.',
  loadFailed: 'The callback requests could not be loaded.',
};

export function chatRequestsDictionary(locale: Locale): ChatRequestsText {
  return locale === 'vi' ? vi : en;
}
