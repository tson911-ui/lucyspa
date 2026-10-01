import type { Locale } from './locales';

interface Dictionary {
  title: string;
  description: string;
  skipToContent: string;
  language: string;
  eyebrow: string;
  heading: string;
  introduction: string;
  welcome: string;
  signature: string;
  book: string;
  signIn: string;
  register: string;
  /** The promotional popup's name when it has no title, and its close button. */
  promoLabel: string;
  promoClose: string;
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
    welcome: 'Hẹn sớm gặp bạn.',
    signature: 'Dịu dàng chăm sóc. Trọn vẹn yêu thương.',
    book: 'Đặt lịch hẹn',
    signIn: 'Đăng nhập thành viên',
    register: 'Đăng ký thành viên',
    promoLabel: 'Ưu đãi từ Lucy Spa',
    promoClose: 'Đóng thông báo',
  },
  en: {
    title: 'Lucy Spa — A moment just for you',
    description: 'Welcome to Lucy Spa.',
    skipToContent: 'Skip to main content',
    language: 'Choose language',
    eyebrow: 'Welcome to Lucy Spa',
    heading: 'A quiet moment.\nJust for you.',
    introduction: 'Unwind, slow down, and take a little time for yourself.',
    welcome: 'We look forward to welcoming you.',
    signature: 'Gentle care. Thoughtfully yours.',
    book: 'Book an appointment',
    signIn: 'Member sign in',
    register: 'Become a member',
    promoLabel: 'Offer from Lucy Spa',
    promoClose: 'Close notice',
  },
} satisfies Record<Locale, Dictionary>;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
