import type { Locale } from './locales';

/**
 * Claude integration Wave D (CI-S2 and CI-S3): the words of the customer card for the staff member serving a visit. Short natural
 * Vietnamese; a spa, not a clinic. Only the person assigned to the service sees it, and every view is recorded.
 */
const vi = {
  open: 'Thông tin khách',
  title: 'Thông tin khách',
  titleFor: 'Thông tin khách: {service}',
  intro: 'Chỉ người phục vụ khách này thấy. Mỗi lượt xem đều được ghi lại.',
  close: 'Đóng',
  loadFailed: 'Không mở được thông tin khách. Thử lại sau.',
  forbidden: 'Bạn không xem được thông tin khách này lúc này.',
  blocked: {
    AI_OFF: 'Tính năng này đang tắt.',
    BRIEF_OFF: 'Tính năng này đang tắt.',
    NO_RATE: 'Tính năng này chưa sẵn sàng.',
    NO_KEY: 'Tính năng này chưa sẵn sàng.',
    OTHER: 'Tính năng này chưa dùng được lúc này.',
  },
  facts: {
    title: 'Từ các lượt trước',
    visits: 'Số lượt đến trước đây',
    last: 'Lần gần nhất',
    ktv: 'Người phục vụ lần trước',
    gap: 'Khoảng cách giữa các lần',
    gapDays: '{count} ngày',
    services: 'Dịch vụ hay dùng',
    times: '{name} ({count} lần)',
    products: 'Mỹ phẩm đã mua',
    none: 'Chưa có',
    unknown: 'Khách chưa có tài khoản nên chưa có lịch sử.',
    firstTime: 'Đây là lượt đến đầu tiên của khách tại chi nhánh này.',
  },
  summary: {
    title: 'Ghi chú của nhân viên',
    notes: 'Có {count} ghi chú.',
    loading: 'Đang tóm tắt…',
    none: 'Chưa có ghi chú nào về khách này.',
    unavailable: 'Chưa tóm tắt được các ghi chú. Dữ liệu ở trên vẫn đúng.',
    aiNote: 'Tóm tắt do AI viết, chỉ nhắc lại điều nhân viên đã ghi.',
  },
  suggestions: {
    title: 'Gợi ý nói chuyện về mỹ phẩm',
    intro: 'Chỉ để bạn tham khảo, nói hay không tùy bạn. Không gửi gì cho khách.',
    loading: 'Đang chọn gợi ý…',
    none: 'Chưa có gợi ý phù hợp.',
    unavailable: 'Chưa tạo được gợi ý lúc này.',
  },
};

type BriefText = typeof vi;

const en: BriefText = {
  open: 'Customer info',
  title: 'Customer info',
  titleFor: 'Customer info: {service}',
  intro: 'Only the person serving this customer sees this. Every view is recorded.',
  close: 'Close',
  loadFailed: 'Could not open the customer info. Try again later.',
  forbidden: 'You cannot see this customer’s info right now.',
  blocked: {
    AI_OFF: 'This feature is off.',
    BRIEF_OFF: 'This feature is off.',
    NO_RATE: 'This feature is not ready yet.',
    NO_KEY: 'This feature is not ready yet.',
    OTHER: 'This feature cannot be used right now.',
  },
  facts: {
    title: 'From earlier visits',
    visits: 'Earlier visits',
    last: 'Last visit',
    ktv: 'Served last time by',
    gap: 'Time between visits',
    gapDays: '{count} days',
    services: 'Usual services',
    times: '{name} ({count} times)',
    products: 'Cosmetics bought',
    none: 'None yet',
    unknown: 'This customer has no account, so there is no history.',
    firstTime: 'This is the customer’s first visit at this branch.',
  },
  summary: {
    title: 'Staff notes',
    notes: '{count} notes.',
    loading: 'Summarizing…',
    none: 'No notes about this customer yet.',
    unavailable: 'The notes could not be summarized. The facts above are still right.',
    aiNote: 'Written by AI; it only repeats what staff wrote.',
  },
  suggestions: {
    title: 'Talking points about cosmetics',
    intro:
      'For your information only; say them or not as you like. Nothing is sent to the customer.',
    loading: 'Choosing points…',
    none: 'No fitting point right now.',
    unavailable: 'Could not make points right now.',
  },
};

export function briefDictionary(locale: Locale): BriefText {
  return locale === 'en' ? en : vi;
}
