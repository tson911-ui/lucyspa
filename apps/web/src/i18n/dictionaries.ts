import type { Locale } from './locales';

interface Dictionary {
  title: string;
  description: string;
  skipToContent: string;
  language: string;
  eyebrow: string;
  heading: string;
  introduction: string;
  comingSoon: string;
  welcome: string;
  signature: string;
}

const dictionaries = {
  vi: {
    title: 'Lucy Spa — Khoảnh khắc dành riêng cho bạn',
    description: 'Chào mừng bạn đến với Lucy Spa.',
    skipToContent: 'Chuyển đến nội dung chính',
    language: 'Chọn ngôn ngữ',
    eyebrow: 'Chào mừng đến với Lucy Spa',
    heading: 'Một khoảng lặng.\nDành riêng cho bạn.',
    introduction: 'Thả lỏng, chậm lại và dành thời gian chăm sóc chính mình.',
    comingSoon: 'Không gian trực tuyến của Lucy Spa đang được chuẩn bị.',
    welcome: 'Hẹn sớm gặp bạn.',
    signature: 'Dịu dàng chăm sóc. Trọn vẹn yêu thương.',
  },
  en: {
    title: 'Lucy Spa — A moment just for you',
    description: 'Welcome to Lucy Spa.',
    skipToContent: 'Skip to main content',
    language: 'Choose language',
    eyebrow: 'Welcome to Lucy Spa',
    heading: 'A quiet moment.\nJust for you.',
    introduction: 'Unwind, slow down, and take a little time for yourself.',
    comingSoon: 'The Lucy Spa online experience is being prepared.',
    welcome: 'We look forward to welcoming you.',
    signature: 'Gentle care. Thoughtfully yours.',
  },
} satisfies Record<Locale, Dictionary>;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
