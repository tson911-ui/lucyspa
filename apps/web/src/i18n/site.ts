import type { Locale } from './locales';

// Text of the shared site chrome and the public pages (home, services): header, menu, tab bar, footer, sections.
// Brand facts (tagline, address, hotline, hours) and the catalogue come from the API, never from here.
export interface SiteText {
  nav: {
    menu: string;
    phone: string;
    home: string;
    services: string;
    book: string;
    bookings: string;
    invoices: string;
    account: string;
    /** The booking tab of the phone bar (the one booking call to action). */
    bookNow: string;
  };
  /** The account menu in the header and the row under it in the member area. */
  member: {
    signIn: string;
    register: string;
    signOut: string;
    overview: string;
    bookings: string;
    invoices: string;
    notifications: string;
    /** Accessible name of the member-area row. */
    tabs: string;
    /** With {count}: the unread notifications, in the account button's name. */
    unread: string;
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
    links: string;
    contact: string;
    /** One entry for both: Đăng nhập / Đăng ký. */
    signInUp: string;
    /** With {value}: "Điện thoại: 0934 936 101". */
    phone: string;
    /** With {year}. */
    rights: string;
    /** The group name of the row of social icons. */
    social: string;
    /** With {name}: the accessible name of a link that opens another site in a new tab ("Facebook (mở trong tab mới)"). */
    newTab: string;
    /** The official wording of each store badge, for the accessible name of its link (before the new-tab note). */
    googlePlay: string;
    appStore: string;
    /** The brand names of the networks the social icons link to. */
    networks: {
      facebook: string;
      zalo: string;
      tiktok: string;
      instagram: string;
      youtube: string;
      messenger: string;
    };
  };
  home: {
    /** The product, in one factual sentence under the tagline. */
    lead: string;
    bookNow: string;
    viewServices: string;
    factsLabel: string;
    groupsTitle: string;
    groupsLead: string;
    viewAll: string;
    /** With {group}. */
    viewAllOf: string;
    hotline: string;
    closed: string;
    /** With {section}. */
    loadError: string;
    reload: string;
    sectionServices: string;
    noServices: string;
  };
  services: {
    title: string;
    lead: string;
    groupsLabel: string;
    all: string;
    book: string;
    /** Time estimate label. */
    estimate: string;
    price: string;
    empty: string;
    detailLead: string;
    /** The button back to the list, under the service. */
    back: string;
    /** The "← Back" button above the page title (same as on the account pages). */
    backLabel: string;
    related: string;
    perNailNote: string;
    priceNote: string;
    notFoundTitle: string;
    notFoundBody: string;
    breadcrumbs: string;
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
      invoices: 'Hóa đơn',
      account: 'Tài khoản',
      bookNow: 'Đặt lịch ngay',
    },
    member: {
      signIn: 'Đăng nhập',
      register: 'Đăng ký',
      signOut: 'Đăng xuất',
      overview: 'Tổng quan',
      bookings: 'Lịch hẹn',
      invoices: 'Hóa đơn',
      notifications: 'Thông báo',
      tabs: 'Khu vực thành viên',
      unread: '{count} chưa đọc',
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
      links: 'Liên kết',
      contact: 'Liên hệ',
      signInUp: 'Đăng nhập / Đăng ký',
      phone: 'Điện thoại: {value}',
      rights: '© {year} Lucy Spa',
      social: 'Mạng xã hội',
      newTab: '{name} (mở trong tab mới)',
      googlePlay: 'Tải trên Google Play',
      appStore: 'Tải về trên App Store',
      networks: {
        facebook: 'Facebook',
        zalo: 'Zalo',
        tiktok: 'TikTok',
        instagram: 'Instagram',
        youtube: 'YouTube',
        messenger: 'Messenger',
      },
    },
    home: {
      lead: 'Chọn dịch vụ, chọn giờ còn trống và giữ chỗ trực tuyến trong vài phút.',
      bookNow: 'Đặt lịch ngay',
      viewServices: 'Xem dịch vụ',
      factsLabel: 'Thông tin nhanh',
      groupsTitle: 'Nhóm dịch vụ nổi bật',
      groupsLead: 'Giá niêm yết rõ ràng, chọn dịch vụ và đặt lịch chỉ trong vài phút.',
      viewAll: 'Xem tất cả',
      viewAllOf: 'Xem tất cả dịch vụ nhóm {group}',
      hotline: 'Hotline',
      closed: 'Đóng cửa',
      loadError: 'Không tải được {section} lúc này. Vui lòng thử lại sau ít phút.',
      reload: 'Tải lại trang',
      sectionServices: 'danh mục dịch vụ',
      noServices: 'Danh mục dịch vụ đang được cập nhật.',
    },
    services: {
      title: 'Dịch vụ',
      lead: 'Giá niêm yết và thời gian dự kiến của từng dịch vụ.',
      groupsLabel: 'Nhóm dịch vụ',
      all: 'Tất cả',
      book: 'Đặt lịch',
      estimate: 'Dự kiến',
      price: 'Giá',
      empty: 'Chưa có dịch vụ nào để hiển thị.',
      detailLead: 'Giá và thời gian dự kiến của dịch vụ.',
      back: 'Tất cả dịch vụ',
      backLabel: 'Quay lại',
      related: 'Dịch vụ cùng nhóm',
      perNailNote: 'Tính theo số ngón; số ngón và giá cuối cùng được chốt tại tiệm.',
      priceNote: 'Thời gian là dự kiến; giá cuối cùng được chốt tại tiệm.',
      notFoundTitle: 'Không tìm thấy dịch vụ',
      notFoundBody: 'Dịch vụ này không còn hoặc đang tạm ngưng. Xem các dịch vụ khác của tiệm.',
      breadcrumbs: 'Đường dẫn',
    },
  },
  en: {
    nav: {
      menu: 'Main menu',
      phone: 'Phone menu',
      home: 'Home',
      services: 'Services',
      book: 'Book',
      bookings: 'Bookings',
      invoices: 'Invoices',
      account: 'Account',
      bookNow: 'Book now',
    },
    member: {
      signIn: 'Sign in',
      register: 'Create account',
      signOut: 'Sign out',
      overview: 'Overview',
      bookings: 'Bookings',
      invoices: 'Invoices',
      notifications: 'Notifications',
      tabs: 'Member area',
      unread: '{count} unread',
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
      links: 'Links',
      contact: 'Contact',
      signInUp: 'Sign in / Create account',
      phone: 'Phone: {value}',
      rights: '© {year} Lucy Spa',
      social: 'Social media',
      newTab: '{name} (opens in a new tab)',
      googlePlay: 'Get it on Google Play',
      appStore: 'Download on the App Store',
      networks: {
        facebook: 'Facebook',
        zalo: 'Zalo',
        tiktok: 'TikTok',
        instagram: 'Instagram',
        youtube: 'YouTube',
        messenger: 'Messenger',
      },
    },
    home: {
      lead: 'Choose your services, pick a free time and book online in minutes.',
      bookNow: 'Book now',
      viewServices: 'View services',
      factsLabel: 'Quick facts',
      groupsTitle: 'Featured service groups',
      groupsLead: 'Clear listed prices; pick a service and book in a few minutes.',
      viewAll: 'View all',
      viewAllOf: 'View all {group} services',
      hotline: 'Hotline',
      closed: 'Closed',
      loadError: 'We could not load the {section} right now. Please try again in a few minutes.',
      reload: 'Reload the page',
      sectionServices: 'service catalogue',
      noServices: 'The service catalogue is being updated.',
    },
    services: {
      title: 'Services',
      lead: 'Listed prices and the estimated time of each service.',
      groupsLabel: 'Service groups',
      all: 'All',
      book: 'Book',
      estimate: 'Estimated',
      price: 'Price',
      empty: 'There are no services to show yet.',
      detailLead: 'Price and estimated time of this service.',
      back: 'All services',
      backLabel: 'Back',
      related: 'More in this group',
      perNailNote:
        'Priced per nail; the number of nails and the final price are settled at the shop.',
      priceNote: 'The time is an estimate; the final price is settled at the shop.',
      notFoundTitle: 'Service not found',
      notFoundBody: 'This service is no longer offered or is paused. See the shop other services.',
      breadcrumbs: 'Breadcrumbs',
    },
  },
} satisfies Record<Locale, SiteText>;

export function getSiteText(locale: Locale): SiteText {
  return text[locale];
}
