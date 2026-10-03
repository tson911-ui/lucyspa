import type { Locale } from './locales';

// Text of the shared site chrome (public pages and, from P2-6, the member area): header, menu, tab bar, footer.
export interface SiteText {
  nav: {
    menu: string;
    phone: string;
    home: string;
    services: string;
    book: string;
    bookings: string;
    account: string;
  };
  header: {
    brand: string;
    language: string;
    switchLanguage: string;
    account: string;
    bookNow: string;
    theme: { group: string; light: string; dark: string; auto: string; switchTo: string };
  };
  footer: {
    discover: string;
    member: string;
    signIn: string;
    register: string;
    /** With {year}. */
    rights: string;
  };
}

const text = {
  vi: {
    nav: {
      menu: 'Menu chính',
      phone: 'Menu điện thoại',
      home: 'Trang chủ',
      services: 'Dịch vụ',
      book: 'Đặt lịch',
      bookings: 'Lịch hẹn',
      account: 'Tài khoản',
    },
    header: {
      brand: 'Lucy Spa, về trang chủ',
      language: 'Ngôn ngữ',
      switchLanguage: 'English',
      account: 'Tài khoản của tôi',
      bookNow: 'Đặt lịch ngay',
      theme: {
        group: 'Giao diện',
        light: 'Sáng',
        dark: 'Tối',
        auto: 'Theo giờ',
        switchTo: 'Chuyển sang {name}',
      },
    },
    footer: {
      discover: 'Khám phá',
      member: 'Tài khoản',
      signIn: 'Đăng nhập',
      register: 'Đăng ký',
      rights: '© {year} Lucy Spa',
    },
  },
  en: {
    nav: {
      menu: 'Main menu',
      phone: 'Phone menu',
      home: 'Home',
      services: 'Services',
      book: 'Book',
      bookings: 'Appointments',
      account: 'Account',
    },
    header: {
      brand: 'Lucy Spa, back to the home page',
      language: 'Language',
      switchLanguage: 'Tiếng Việt',
      account: 'My account',
      bookNow: 'Book now',
      theme: {
        group: 'Appearance',
        light: 'Light',
        dark: 'Dark',
        auto: 'By time of day',
        switchTo: 'Switch to {name}',
      },
    },
    footer: {
      discover: 'Explore',
      member: 'Account',
      signIn: 'Sign in',
      register: 'Create account',
      rights: '© {year} Lucy Spa',
    },
  },
} satisfies Record<Locale, SiteText>;

export function getSiteText(locale: Locale): SiteText {
  return text[locale];
}
