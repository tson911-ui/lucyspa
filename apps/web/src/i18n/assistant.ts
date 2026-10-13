import type { Locale } from './locales';

/**
 * Claude integration Wave C (CI-S1): the words of the report assistant's question box. Short natural Vietnamese; a spa, not a clinic.
 * The box is for the holders of "Dùng trợ lý AI"; the answer only quotes numbers taken from the reports the person may already open.
 */
const vi = {
  title: 'Hỏi trợ lý',
  intro:
    'Hỏi về doanh thu, lượt đến, tiền mặt, lương tổng hợp, lợi nhuận hay đánh giá. Trợ lý chỉ đọc số liệu của các báo cáo bạn được xem.',
  label: 'Câu hỏi về số liệu của tiệm',
  placeholder: 'Ví dụ: Doanh thu tuần này so với tuần trước thế nào?',
  characters: '{count}/{max} ký tự',
  ask: 'Hỏi',
  asking: 'Đang tìm số liệu…',
  answerTitle: 'Trả lời',
  period: 'Số liệu từ {from} đến {to}.',
  unsure: 'Trợ lý chưa chắc chắn nên chưa đưa con số. Hãy xem trực tiếp trong báo cáo.',
  openReport: 'Mở báo cáo',
  pages: {
    revenue: 'Doanh thu',
    refunds: 'Hoàn tiền và điều chỉnh',
    sales: 'Bán hàng',
    customers: 'Khách và lịch hẹn',
    cash: 'Tiền mặt và quỹ',
    pay: 'Lương và chi phí nhân sự',
    profit: 'Lợi nhuận tạm tính',
    reviews: 'Đánh giá của khách',
  },
  left: 'Còn {count} câu hỏi trong giờ này.',
  blocked: {
    AI_OFF: 'AI đang tắt. Bật trong Cài đặt AI.',
    ASSISTANT_OFF: 'Trợ lý hỏi đáp đang tắt. Bật trong Cài đặt AI.',
    NO_RATE: 'Chưa nhập tỷ giá đồng cho 1 USD trong Cài đặt AI.',
    NO_KEY: 'Chưa có khóa Anthropic trên máy chủ.',
    OTHER: 'Chưa dùng được trợ lý lúc này.',
  },
  errors: {
    RATE_LIMITED: 'Bạn hỏi hơi nhiều trong thời gian ngắn. Đợi một lát rồi hỏi tiếp.',
    FORBIDDEN: 'Bạn không có quyền dùng trợ lý.',
    VALIDATION_FAILED: 'Câu hỏi cần từ 1 đến 300 ký tự, không có ký tự lạ.',
    OTHER: 'Chưa trả lời được lúc này. Thử lại sau, hoặc xem trực tiếp trong báo cáo.',
  },
  loadFailed: 'Không kiểm tra được trợ lý.',
};

type AssistantText = typeof vi;

const en: AssistantText = {
  title: 'Ask the assistant',
  intro:
    'Ask about revenue, visits, cash, payroll totals, profit or ratings. The assistant only reads the figures of the reports you may open.',
  label: 'Question about the shop’s figures',
  placeholder: 'For example: How is revenue this week compared with last week?',
  characters: '{count}/{max} characters',
  ask: 'Ask',
  asking: 'Looking up the figures…',
  answerTitle: 'Answer',
  period: 'Figures from {from} to {to}.',
  unsure: 'The assistant is not sure, so it gives no figure. Please look in the report itself.',
  openReport: 'Open report',
  pages: {
    revenue: 'Revenue',
    refunds: 'Refunds and corrections',
    sales: 'Sales',
    customers: 'Customers and bookings',
    cash: 'Cash and funds',
    pay: 'Payroll and labour cost',
    profit: 'Provisional profit',
    reviews: 'Customer ratings',
  },
  left: '{count} questions left this hour.',
  blocked: {
    AI_OFF: 'AI is off. Turn it on in AI settings.',
    ASSISTANT_OFF: 'The question assistant is off. Turn it on in AI settings.',
    NO_RATE: 'The VND rate for 1 USD is not typed in AI settings.',
    NO_KEY: 'There is no Anthropic key on the server.',
    OTHER: 'The assistant cannot be used right now.',
  },
  errors: {
    RATE_LIMITED: 'You are asking a lot in a short time. Wait a moment and ask again.',
    FORBIDDEN: 'You do not have the right to use the assistant.',
    VALIDATION_FAILED: 'The question needs 1 to 300 characters, with no odd characters.',
    OTHER: 'Could not answer right now. Try again later, or look in the report itself.',
  },
  loadFailed: 'Could not check the assistant.',
};

export function assistantDictionary(locale: Locale): AssistantText {
  return locale === 'en' ? en : vi;
}
