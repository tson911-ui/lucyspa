import type { Locale } from './locales';

/**
 * Claude integration Wave A: the words of "Cài đặt AI". Short natural Vietnamese; a spa, not a clinic. Cost is always said in đồng; the
 * rate (VND per USD) is the Owner's own figure. The key is never shown: only whether one is present and what the last check found.
 */
const vi = {
  nav: 'Cài đặt AI',
  title: 'Cài đặt AI',
  intro:
    'Bật hoặc tắt các tính năng AI, đặt hạn mức chi phí mỗi tháng và chọn mô hình. AI chỉ soạn bản nháp; không có gì lên trang web khi chưa có người bấm Áp dụng.',
  noAccess: 'Bạn không có quyền quản lý cài đặt AI.',
  loadFailed: 'Không tải được cài đặt AI.',
  save: 'Lưu cài đặt',
  saving: 'Đang lưu…',
  revert: 'Hoàn tác',
  saved: 'Đã lưu cài đặt AI.',
  key: {
    title: 'Kết nối với Anthropic',
    configured: 'Máy chủ đã có khóa',
    missing: 'Máy chủ chưa có khóa',
    missingBody:
      'Chưa tìm thấy khóa Anthropic trên máy chủ. Hãy tự dán khóa theo hướng dẫn rồi khởi động lại tiến trình xử lý nền; khóa không bao giờ hiện trên màn hình này.',
    check: 'Kiểm tra kết nối',
    checking: 'Đang chờ tiến trình xử lý nền trả lời…',
    never: 'Chưa kiểm tra lần nào.',
    lastCheck: 'Lần kiểm tra gần nhất: {when}',
    statuses: {
      OK: 'Kết nối tốt',
      KEY_MISSING: 'Máy chủ chưa có khóa',
      AUTH_FAILED: 'Khóa bị từ chối (sai hoặc đã bị xóa)',
      UNREACHABLE: 'Không kết nối được tới Anthropic',
      LIMIT_REACHED: 'Đã chạm giới hạn chi tiêu đặt trên trang Anthropic',
      ERROR: 'Có lỗi khác, thử lại sau ít phút',
    },
  },
  usage: {
    title: 'Chi phí tháng này',
    needRate:
      'Hãy nhập tỷ giá đồng/USD ở bên dưới để xem chi phí bằng đồng và để các lần chạy được bắt đầu.',
    spent: 'Đã dùng',
    reserved: 'Đang giữ cho các lần gọi chưa xong',
    cap: 'Hạn mức tháng',
    unknown: 'Chưa có tỷ giá',
    perFeature: 'Theo tính năng',
    note: 'Con số này là của phần mềm Lucy Spa. Chi phí của các bot n8n do Anthropic tính riêng và chỉ bị giới hạn ở trang Anthropic; hãy đối chiếu cả hai.',
    features: {
      PRODUCT_REWRITE: 'Viết lại sản phẩm',
      SEO: 'SEO và tiếng Anh',
      ASSISTANT: 'Trợ lý báo cáo',
      BRIEF: 'Tóm tắt khách và gợi ý',
    },
  },
  switches: {
    title: 'Bật tính năng',
    hint: 'Mọi công tắc đang tắt cho đến khi bạn bật. Tắt công tắc chung là dừng toàn bộ AI ngay.',
    enabled: 'Bật AI (công tắc chung)',
    rewrite: 'Viết lại nội dung sản phẩm',
    seo: 'Mô tả tìm kiếm và tiếng Anh',
    chat: 'Chat với Lucy trên website',
    assistant: 'Trợ lý hỏi đáp về báo cáo',
    brief: 'Tóm tắt khách, gợi ý sản phẩm',
  },
  chat: {
    title: 'Chat trên website',
    hint: 'Khách nhắn trong khung chat; tin được chuyển tới bot n8n của tiệm. Khi bot không trả lời được hoặc hết số tin trong ngày, khung chat mời khách để lại số điện thoại.',
    webhookMissing:
      'Máy chủ chưa có địa chỉ và mã bí mật của n8n cho khung chat, nên khách sẽ chỉ thấy mẫu để lại số điện thoại. Làm theo hướng dẫn n8n rồi khởi động lại API.',
    dailyCap: 'Số tin tối đa mỗi ngày',
    dailyCapHint: 'Từ 0 đến 5.000. Quá số này, khung chat hiện mẫu để lại số điện thoại.',
    botDataOn: 'Cổng dữ liệu cho bot n8n đang bật (đã có mã bí mật trên máy chủ).',
    botDataOff: 'Cổng dữ liệu cho bot n8n đang tắt (chưa có mã bí mật trên máy chủ).',
  },
  models: {
    title: 'Mô hình cho các tính năng khác',
    hint: 'Mỗi tính năng dùng mô hình riêng; chi phí của chúng nằm trong hạn mức tháng.',
    seo: 'Mô tả tìm kiếm và bản tiếng Anh',
    assistant: 'Trợ lý báo cáo',
    brief: 'Tóm tắt khách và gợi ý',
  },
  cost: {
    title: 'Chi phí',
    hint: 'Hạn mức tính bằng đồng. Khi chạm hạn mức, lần chạy tự dừng và không mất bản nháp đã làm.',
    rate: 'Tỷ giá (đồng cho 1 USD)',
    rateHint: 'Bạn tự nhập; hệ thống không tự đoán. Để trống nghĩa là chưa chạy được.',
    monthly: 'Hạn mức mỗi tháng',
    unit: 'đ',
    features: 'Hạn mức theo tính năng',
  },
  model: {
    title: 'Mô hình viết lại sản phẩm',
    hint: 'Mô hình mạnh nhất cho chữ hiện công khai. Mô hình rẻ hơn tốn ít hơn nhưng viết kém hơn.',
    model: 'Mô hình',
    effort: 'Mức suy nghĩ',
    concurrency: 'Số sản phẩm làm cùng lúc',
    concurrencyHint: 'Từ 1 đến 4.',
    fallback: 'Dự phòng khi bị từ chối',
    fallbackHint:
      'Khi một yêu cầu bị từ chối, Anthropic tự chạy lại bằng mô hình dự phòng. Đây là cài đặt của Anthropic cho các mô hình này; bật sẵn.',
    models: {
      'claude-opus-5-5': 'Opus 5.5 (mạnh nhất)',
      'claude-sonnet-5-5': 'Sonnet 5.5 (rẻ hơn)',
      'claude-haiku-5-5': 'Haiku 5.5 (rẻ nhất)',
    },
    efforts: {
      low: 'Thấp',
      medium: 'Vừa (mặc định)',
      high: 'Cao',
      xhigh: 'Rất cao',
      max: 'Tối đa',
    },
  },
  words: {
    title: 'Quy tắc chữ',
    hint: 'Hệ thống luôn chặn lời hứa chữa bệnh, cam kết tuyệt đối và từ không dùng cho spa. Bạn có thể thêm cụm từ của riêng mình.',
    authenticity: 'Cho phép viết "chính hãng"',
    authenticityHint:
      'Chỉ bật sau khi bạn xác nhận nhà cung cấp là nhà phân phối chính thức. Khi tắt, AI không viết chữ này và bản nháp có chữ này bị cảnh báo.',
    banned: 'Cụm từ bị chặn thêm',
    bannedHint: 'Mỗi dòng một cụm từ (2 đến 80 ký tự, tối đa 100 dòng).',
  },
  problems: {
    vndPerUsd: 'Nhập số nguyên từ 1.000 đến 1.000.000, hoặc để trống.',
    monthlyCapVnd: 'Nhập số tiền hợp lệ (số nguyên, không âm).',
    featureCapsVnd: 'Nhập số tiền hợp lệ (số nguyên, không âm).',
    concurrency: 'Nhập số từ 1 đến 4.',
    chatDailyCap: 'Nhập số nguyên từ 0 đến 5.000.',
    bannedPhrases: 'Mỗi cụm từ 2 đến 80 ký tự, tối đa 100 cụm.',
  },
  conflict: 'Cài đặt vừa được người khác đổi. Đã tải lại; hãy kiểm tra rồi lưu lại.',
};

export type AiSettingsText = typeof vi;

const en: AiSettingsText = {
  nav: 'AI settings',
  title: 'AI settings',
  intro:
    'Switch the AI features on or off, set the monthly spending cap and choose the model. The AI only writes drafts; nothing reaches the website until a person presses Apply.',
  noAccess: 'You do not have permission to manage the AI settings.',
  loadFailed: 'The AI settings could not be loaded.',
  save: 'Save settings',
  saving: 'Saving…',
  revert: 'Revert',
  saved: 'AI settings saved.',
  key: {
    title: 'Connection to Anthropic',
    configured: 'The server has a key',
    missing: 'The server has no key yet',
    missingBody:
      'No Anthropic key was found on the server. Paste the key yourself following the guide, then restart the background worker; the key is never shown on this screen.',
    check: 'Check the connection',
    checking: 'Waiting for the background worker to answer…',
    never: 'Never checked.',
    lastCheck: 'Last check: {when}',
    statuses: {
      OK: 'Connected',
      KEY_MISSING: 'The server has no key',
      AUTH_FAILED: 'The key was rejected (wrong or deleted)',
      UNREACHABLE: 'Cannot reach Anthropic',
      LIMIT_REACHED: 'The spending limit set on the Anthropic site was reached',
      ERROR: 'Another error, try again in a few minutes',
    },
  },
  usage: {
    title: 'Cost this month',
    needRate: 'Enter the VND-per-USD rate below to see the cost in đồng and to let runs start.',
    spent: 'Spent',
    reserved: 'Held for calls in progress',
    cap: 'Monthly cap',
    unknown: 'No rate yet',
    perFeature: 'By feature',
    note: 'This figure is Lucy Spa software’s own. The n8n bots’ cost is billed by Anthropic separately and capped only on the Anthropic site; compare both.',
    features: {
      PRODUCT_REWRITE: 'Product rewrite',
      SEO: 'SEO and English',
      ASSISTANT: 'Report assistant',
      BRIEF: 'Customer summary and suggestions',
    },
  },
  switches: {
    title: 'Switch features on',
    hint: 'Every switch is off until you turn it on. The master switch stops all AI at once.',
    enabled: 'AI on (master switch)',
    rewrite: 'Product text rewrite',
    seo: 'Search texts and English drafts',
    chat: 'Chat with Lucy on the website',
    assistant: 'Report question assistant',
    brief: 'Customer summaries and tips',
  },
  chat: {
    title: 'Website chat',
    hint: 'Visitors write in the chat box; the message goes to the shop’s n8n bot. When the bot cannot answer or the day’s limit is reached, the box asks the visitor to leave a phone number.',
    webhookMissing:
      'The server has no n8n address and secret for the chat yet, so visitors will only see the leave-a-number form. Follow the n8n guide, then restart the API.',
    dailyCap: 'Most messages per day',
    dailyCapHint: 'From 0 to 5,000. Past this, the chat box shows the leave-a-number form.',
    botDataOn: 'The data port for the n8n bot is on (the server has its secret).',
    botDataOff: 'The data port for the n8n bot is off (the server has no secret for it).',
  },
  models: {
    title: 'Models for the other features',
    hint: 'Each feature has its own model; their cost counts in the monthly cap.',
    seo: 'Search descriptions and English drafts',
    assistant: 'Report assistant',
    brief: 'Customer summary and talking points',
  },
  cost: {
    title: 'Cost',
    hint: 'Caps are in đồng. When a cap is reached the run stops by itself and the drafts already made are kept.',
    rate: 'Rate (đồng per 1 USD)',
    rateHint: 'You type it; the system never guesses. Empty means runs cannot start.',
    monthly: 'Monthly cap',
    unit: 'đ',
    features: 'Cap by feature',
  },
  model: {
    title: 'Model for the product rewrite',
    hint: 'The strongest model for public text. A cheaper model costs less but writes less well.',
    model: 'Model',
    effort: 'Thinking level',
    concurrency: 'Products processed at once',
    concurrencyHint: 'From 1 to 4.',
    fallback: 'Fallback when refused',
    fallbackHint:
      'When a request is refused, Anthropic re-runs it on a fallback model. This is Anthropic’s own setting for these models; on by default.',
    models: {
      'claude-opus-5-5': 'Opus 5.5 (strongest)',
      'claude-sonnet-5-5': 'Sonnet 5.5 (cheaper)',
      'claude-haiku-5-5': 'Haiku 5.5 (cheapest)',
    },
    efforts: {
      low: 'Low',
      medium: 'Medium (default)',
      high: 'High',
      xhigh: 'Very high',
      max: 'Maximum',
    },
  },
  words: {
    title: 'Wording rules',
    hint: 'The system always blocks medical promises, absolute guarantees and words a spa never uses. You can add your own phrases.',
    authenticity: 'Allow writing "chính hãng" (authentic)',
    authenticityHint:
      'Turn on only after you confirm the supplier is an official distributor. While off, the AI does not write it and a draft containing it gets a warning.',
    banned: 'Extra blocked phrases',
    bannedHint: 'One phrase per line (2 to 80 characters, at most 100 lines).',
  },
  problems: {
    vndPerUsd: 'Enter a whole number from 1,000 to 1,000,000, or leave it empty.',
    monthlyCapVnd: 'Enter a valid amount (a whole number, not negative).',
    featureCapsVnd: 'Enter a valid amount (a whole number, not negative).',
    concurrency: 'Enter a number from 1 to 4.',
    chatDailyCap: 'Enter a whole number from 0 to 5,000.',
    bannedPhrases: 'Each phrase 2 to 80 characters, at most 100 phrases.',
  },
  conflict:
    'The settings were just changed by someone else. They were reloaded; check them and save again.',
};

export function aiSettingsDictionary(locale: Locale): AiSettingsText {
  return locale === 'en' ? en : vi;
}
