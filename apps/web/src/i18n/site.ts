import type { Locale } from './locales';

// Text of the shared site chrome and the public pages (home, services): header, menu, tab bar, footer, sections.
// Brand facts (tagline, address, hotline, hours) and the catalogue come from the API, never from here.
export interface SiteText {
  nav: {
    menu: string;
    phone: string;
    home: string;
    services: string;
    /** The cosmetics catalog (Phase 6 P6-6). */
    products: string;
    book: string;
    bookings: string;
    invoices: string;
    account: string;
    /** The booking tab of the phone bar (the one booking call to action). */
    bookNow: string;
    /** The contact page (footer link). */
    contact: string;
  };
  /** The account menu in the header: sign-in and registration, or the account page, rewards and sign-out. */
  member: {
    signIn: string;
    register: string;
    signOut: string;
    /** The account overview page. */
    account: string;
    /** Phase 5 P5-10: points, combos, referrals and gifts. */
    rewards: string;
  };
  /** A page that does not exist and a page that failed: the site chrome stays, the way on is clear. */
  errors: {
    notFoundTitle: string;
    notFoundBody: string;
    home: string;
    errorTitle: string;
    errorBody: string;
    retry: string;
    /** A pre-order ticket link that is wrong or revoked (the same words as the ticket page, here so the 404 needs no shop dictionary). */
    ticketTitle: string;
    ticketBody: string;
  };
  header: {
    brand: string;
    language: string;
    switchLanguage: string;
    account: string;
    /** Signed out, the account control is one link to the sign-in page (C47), whose switch also offers registration. */
    signInOrRegister: string;
    bookNow: string;
    /** The notification bell and its panel (the list's own wording is in the notifications dictionary). */
    bell: {
      /** The bell button and the panel's name. */
      label: string;
      /** With {count}: the button's name when something is unread. */
      unread: string;
      /** The link to the full notifications page. */
      viewAll: string;
    };
  };
  /** Information pages the Owner writes (policies, terms): the table of contents, and the page that is not there. */
  /** `updated` with {date}: the sentence under a page title when the page has no description of its own. */
  infoPage: { toc: string; notFoundTitle: string; newTab: string; updated: string };
  /** The contact page: the map, the address, the hours and the ways to reach the spa. */
  contactPage: {
    title: string;
    lead: string;
    mapTitle: string;
    openMap: string;
    /** The name of the row of contact pills (call, Zalo, Messenger). */
    quickContact: string;
    address: string;
    hotline: string;
    hours: string;
    call: string;
    zalo: string;
    messenger: string;
    loadError: string;
  };
  /** The floating contact button (Owner request 2026-10-06): the button, its group and the three ways to reach the spa. */
  contactFab: {
    open: string;
    close: string;
    group: string;
    zalo: string;
    messenger: string;
    call: string;
    /** The "Chat với Lucy" item (Claude integration Wave B). */
    chat: string;
  };
  /**
   * The website chat panel and its callback form (Claude integration Wave B, design 6.3). The notice at the top is PROVISIONAL wording
   * (the Owner's lawyer item, design 9.3): it says the assistant is automatic, that staff do not read the chat and not to type a phone
   * number or health details.
   */
  chat: {
    title: string;
    close: string;
    notice: string;
    greeting: string;
    messageLabel: string;
    messagePlaceholder: string;
    send: string;
    typing: string;
    you: string;
    assistant: string;
    bookSlot: string;
    leaveNumber: string;
    wait: string;
    fallbackDown: string;
    fallbackCap: string;
    form: {
      title: string;
      phone: string;
      phoneExample: string;
      phoneError: string;
      name: string;
      note: string;
      consent: string;
      consentError: string;
      submit: string;
      submitting: string;
      back: string;
      sendError: string;
      sentTitle: string;
      sentBody: string;
      sentClose: string;
      /** Closing the panel with a number typed asks first (C60, H13). */
      discardTitle: string;
      discardBody: string;
      discardConfirm: string;
      discardKeep: string;
    };
  };
  footer: {
    links: string;
    /** The column of the shop's published policy pages, and the label of the legal line under the columns. */
    policies: string;
    legal: string;
    /** The legal line names the two pages by their role, so the line reads the same whatever the pages are titled. */
    legalTerms: string;
    legalPrivacy: string;
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
    /** The hero heading while the shop has no tagline (C41: the brand name is not a page title). */
    fallbackTitle: string;
    /** The product, in one factual sentence under the tagline. */
    lead: string;
    bookNow: string;
    viewServices: string;
    factsLabel: string;
    brandBandLabel: string;
    brandLink: string;
    brandPause: string;
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
    /** The caption of a fact in the trust band (the hotline's is `hotline`). */
    factAddress: string;
    /** The link under the top services. */
    viewAllServices: string;
    /** The product row: its heading (the Owner's "Nổi bật" flag, never a sales claim), its link, and its two arrow buttons. */
    productsTitle: string;
    viewAllProducts: string;
    rowPrevious: string;
    rowNext: string;
    /** The category grid: the heading, its sentence and the names of its two groups. */
    categoriesTitle: string;
    categoriesLead: string;
    categoryServices: string;
    categoryProducts: string;
    /** The address fact's link to the map (opens in a new tab). */
    directions: string;
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
    /** The heading of the empty list (the sentence is `empty`). */
    emptyTitle: string;
    empty: string;
    detailLead: string;
    /** The button back to the list, under the service. */
    back: string;
    /** The "← Back" button above the page title (same as on the account pages). */
    backLabel: string;
    related: string;
    /** The optional bands of a service page (the Owner writes them in the service form; an empty one is not drawn). */
    included: string;
    steps: string;
    faq: string;
    /** The search field above the list, its clear button, and the line shown when nothing matches (with {query}). */
    searchLabel: string;
    /** An example of what to type, ending with "…" (never the label repeated). */
    searchPlaceholder: string;
    searchClear: string;
    /** The heading of the empty search result (the sentence is `noMatch`). */
    noMatchTitle: string;
    noMatch: string;
    perNailNote: string;
    priceNote: string;
    notFoundTitle: string;
    notFoundBody: string;
    /** The booking band at the bottom of a service page: its heading and one sentence (the page's phone bar uses `bookBar` as its name). */
    ctaTitle: string;
    ctaLead: string;
    bookBar: string;
  };
  /** The public cosmetics catalog (Phase 6 P6-6). Hero and commitment words are the Owner's, from the admin, never from here. */
  products: {
    title: string;
    lead: string;
    sectionTitle: string;
    searchLabel: string;
    searchClear: string;
    sortLabel: string;
    sorts: { featured: string; newest: string; price_asc: string; price_desc: string };
    /** Opens the filter sheet (more input): ends with "…" (C39). */
    filterButton: string;
    /** The same with the number of active filters, `{count}`. */
    filterButtonCount: string;
    filterTitle: string;
    filterDone: string;
    filterReset: string;
    categories: string;
    allCategories: string;
    brands: string;
    allBrands: string;
    /** The accessible name of the second chip row (the sub-categories of the chosen category). */
    subCategories: string;
    badgeNew: string;
    /** "Tiết kiệm {amount}": the saving of a sale price, a small line under it. */
    saleSave: string;
    /** "Còn {days} ngày {time}" / "Còn {time}": the countdown of a sale that has an end date. */
    saleLeftDays: string;
    saleLeft: string;
    outOfStock: string;
    /** With {days}: "Đặt trước, dự kiến 3–5 ngày". */
    preOrder: string;
    /** The headings of the two empty states (nothing published; nothing matches the filters). */
    emptyTitle: string;
    noMatchTitle: string;
    empty: string;
    /** The button under the empty message: where to look meanwhile (the services). */
    emptyAction: string;
    noMatch: string;
    /** An example of what to type, ending with "…". */
    searchPlaceholder: string;
    pager: {
      nav: string;
      first: string;
      previous: string;
      next: string;
      last: string;
      pageNumber: string;
      summary: string;
    };
    backLabel: string;
    back: string;
    detailLead: string;
    gallery: string;
    /** With {n}: the thumbnail that shows picture n. */
    pictureN: string;
    galleryPrevious: string;
    galleryNext: string;
    variants: string;
    descriptionTitle: string;
    /** The fixed headings of the four description sections (Claude integration); the text under each comes from the product. */
    sections: { benefits: string; ingredients: string; usage: string; suitableFor: string };
    related: string;
    /** The related row's heading on a sold-out product, where it is the next step. */
    similar: string;
    notFoundTitle: string;
    notFoundBody: string;
    store: {
      title: string;
      body: string;
      address: string;
      hotline: string;
      directions: string;
      call: string;
    };
  };
}

const text = {
  vi: {
    nav: {
      menu: 'Menu chính',
      phone: 'Menu điện thoại',
      home: 'Trang chủ',
      services: 'Dịch vụ',
      products: 'Mỹ phẩm',
      book: 'Đặt lịch',
      bookings: 'Lịch hẹn',
      invoices: 'Hóa đơn',
      account: 'Tài khoản',
      bookNow: 'Đặt lịch',
      contact: 'Liên hệ',
    },
    member: {
      signIn: 'Đăng nhập',
      register: 'Đăng ký',
      signOut: 'Đăng xuất',
      account: 'Tài khoản của tôi',
      rewards: 'Điểm thưởng',
    },
    errors: {
      notFoundTitle: 'Không tìm thấy trang này',
      notFoundBody: 'Địa chỉ có thể đã gõ sai hoặc trang không còn nữa.',
      home: 'Về trang chủ',
      errorTitle: 'Trang chưa tải được',
      errorBody:
        'Có trục trặc khi mở trang này, bạn thử tải lại sau ít phút hoặc gọi hotline của tiệm.',
      retry: 'Tải lại',
      ticketTitle: 'Không tìm thấy phiếu',
      ticketBody:
        'Liên kết này không đúng, đã bị thu hồi hoặc đã hết hạn. Hãy hỏi cửa hàng để nhận liên kết mới.',
    },
    header: {
      brand: 'Lucy Spa, về trang chủ',
      language: 'Ngôn ngữ',
      switchLanguage: 'English',
      account: 'Tài khoản của tôi',
      signInOrRegister: 'Đăng nhập hoặc đăng ký',
      bookNow: 'Đặt lịch',
      bell: { label: 'Thông báo', unread: '{count} chưa đọc', viewAll: 'Xem tất cả' },
    },
    infoPage: {
      toc: 'Trong trang này',
      notFoundTitle: 'Không tìm thấy trang này',
      newTab: 'mở trong tab mới',
      updated: 'Cập nhật ngày {date}.',
    },
    contactPage: {
      title: 'Liên hệ',
      lead: 'Địa chỉ, giờ mở cửa và các cách liên hệ với Lucy Spa.',
      mapTitle: 'Bản đồ đường đến Lucy Spa',
      openMap: 'Chỉ đường',
      quickContact: 'Liên hệ nhanh',
      address: 'Địa chỉ',
      hotline: 'Điện thoại',
      hours: 'Giờ mở cửa',
      call: 'Gọi ngay',
      zalo: 'Nhắn Zalo',
      messenger: 'Nhắn Messenger',
      loadError: 'Chưa đọc được thông tin liên hệ. Vui lòng tải lại trang.',
    },
    contactFab: {
      open: 'Liên hệ',
      close: 'Đóng các cách liên hệ',
      group: 'Liên hệ Lucy Spa',
      zalo: 'Nhắn Zalo',
      messenger: 'Nhắn Messenger',
      call: 'Gọi Lucy Spa',
      chat: 'Chat với Lucy…',
    },
    chat: {
      title: 'Chat với Lucy',
      close: 'Đóng khung chat',
      notice:
        'Đây là trợ lý tự động, nhân viên không đọc cuộc trò chuyện này. Bạn đừng nhập số điện thoại hay thông tin sức khỏe vào khung chat.',
      greeting:
        'Xin chào! Mình có thể giúp bạn về giá dịch vụ, giờ mở cửa, khuyến mãi, sản phẩm và giờ còn trống.',
      messageLabel: 'Tin nhắn của bạn',
      messagePlaceholder: 'Ví dụ: giờ mở cửa hôm nay…',
      send: 'Gửi',
      typing: 'Lucy đang trả lời…',
      you: 'Bạn',
      assistant: 'Lucy',
      bookSlot: 'Đặt lịch giờ này',
      leaveNumber: 'Để lại số để tiệm gọi lại…',
      wait: 'Bạn nhắn hơi nhanh. Vui lòng chờ một chút rồi thử lại.',
      fallbackDown:
        'Lúc này trợ lý chưa trả lời được. Bạn để lại số điện thoại, tiệm sẽ gọi lại cho bạn.',
      fallbackCap:
        'Hôm nay trợ lý đã trả lời rất nhiều tin. Bạn để lại số điện thoại, tiệm sẽ gọi lại cho bạn.',
      form: {
        title: 'Để tiệm gọi lại',
        phone: 'Số điện thoại',
        phoneExample: 'Ví dụ: 0905 123 456',
        phoneError: 'Số điện thoại chưa đúng.',
        name: 'Tên (không bắt buộc)',
        note: 'Bạn muốn hỏi gì? (không bắt buộc)',
        consent: 'Tôi đồng ý để Lucy Spa gọi lại vào số này.',
        consentError: 'Hãy tích ô đồng ý để tiệm gọi lại.',
        submit: 'Gửi số điện thoại',
        submitting: 'Đang gửi…',
        back: 'Quay lại chat',
        sendError: 'Chưa gửi được. Bạn thử lại sau ít phút hoặc gọi số hotline của tiệm.',
        sentTitle: 'Tiệm đã nhận số của bạn',
        sentBody: 'Nhân viên sẽ gọi lại cho bạn trong giờ mở cửa.',
        sentClose: 'Đóng',
        discardTitle: 'Bỏ thông tin đã nhập?',
        discardBody: 'Số điện thoại và lời nhắn bạn vừa nhập sẽ mất.',
        discardConfirm: 'Bỏ và đóng',
        discardKeep: 'Tiếp tục nhập',
      },
    },
    footer: {
      links: 'Liên kết',
      policies: 'Chính sách',
      legal: 'Thông tin pháp lý',
      legalTerms: 'Điều khoản sử dụng',
      legalPrivacy: 'Chính sách bảo mật',
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
      fallbackTitle: 'Khoảnh khắc dành riêng cho bạn',
      lead: 'Chọn dịch vụ, chọn giờ còn trống và giữ chỗ trực tuyến trong vài phút.',
      bookNow: 'Đặt lịch',
      viewServices: 'Xem dịch vụ',
      factsLabel: 'Thông tin nhanh',
      brandBandLabel: 'Thương hiệu mỹ phẩm tại Lucy Spa',
      brandLink: 'Xem sản phẩm {name}',
      brandPause: 'Tạm dừng dải thương hiệu',
      groupsTitle: 'Bảng giá dịch vụ',
      groupsLead:
        'Giá niêm yết rõ ràng cho từng dịch vụ. Chọn một dịch vụ để xem chi tiết và đặt lịch.',
      viewAll: 'Xem tất cả',
      viewAllOf: 'Xem tất cả dịch vụ nhóm {group}',
      hotline: 'Điện thoại',
      closed: 'Đóng cửa',
      loadError: 'Không tải được {section} lúc này. Vui lòng thử lại sau ít phút.',
      reload: 'Tải lại trang',
      sectionServices: 'danh mục dịch vụ',
      noServices: 'Danh mục dịch vụ đang được cập nhật.',
      factAddress: 'Địa chỉ',
      viewAllServices: 'Xem tất cả dịch vụ',
      productsTitle: 'Sản phẩm nổi bật',
      viewAllProducts: 'Xem tất cả mỹ phẩm',
      rowPrevious: 'Sản phẩm trước',
      rowNext: 'Sản phẩm tiếp theo',
      categoriesTitle: 'Chọn theo nhóm',
      categoriesLead: 'Chọn nhóm dịch vụ hoặc danh mục mỹ phẩm bạn quan tâm.',
      categoryServices: 'Dịch vụ',
      categoryProducts: 'Mỹ phẩm',
      directions: 'Chỉ đường',
    },
    services: {
      title: 'Dịch vụ',
      lead: 'Giá niêm yết và thời gian dự kiến của từng dịch vụ.',
      groupsLabel: 'Nhóm dịch vụ',
      all: 'Tất cả',
      book: 'Đặt lịch',
      estimate: 'Dự kiến',
      price: 'Giá',
      emptyTitle: 'Bảng giá đang được cập nhật',
      empty: 'Chưa có dịch vụ nào để hiển thị.',
      detailLead: 'Giá và thời gian dự kiến của dịch vụ.',
      back: 'Tất cả dịch vụ',
      backLabel: 'Quay lại Dịch vụ',
      related: 'Dịch vụ cùng nhóm',
      included: 'Dịch vụ bao gồm',
      steps: 'Các bước thực hiện',
      faq: 'Câu hỏi thường gặp',
      searchLabel: 'Tìm dịch vụ',
      searchPlaceholder: 'Ví dụ: gội đầu, sơn gel…',
      searchClear: 'Xóa nội dung tìm',
      noMatchTitle: 'Không có dịch vụ phù hợp',
      noMatch: 'Không có dịch vụ nào khớp “{query}”. Thử một tên khác hoặc bỏ nội dung tìm.',
      perNailNote: 'Tính theo số ngón; số ngón và giá cuối cùng được chốt tại tiệm.',
      priceNote: 'Thời gian là dự kiến; giá cuối cùng được chốt tại tiệm.',
      notFoundTitle: 'Không tìm thấy dịch vụ',
      notFoundBody: 'Dịch vụ này không còn hoặc đang tạm ngưng. Xem các dịch vụ khác của tiệm.',
      ctaTitle: 'Sẵn sàng đặt lịch?',
      ctaLead: 'Chọn giờ còn trống và giữ chỗ trực tuyến trong vài phút.',
      bookBar: 'Đặt lịch dịch vụ này',
    },
    products: {
      title: 'Mỹ phẩm',
      lead: 'Mỹ phẩm đang bán tại Lucy Spa, kèm giá niêm yết.',
      sectionTitle: 'Sản phẩm',
      searchLabel: 'Tìm mỹ phẩm',
      searchClear: 'Xóa nội dung tìm',
      sortLabel: 'Sắp xếp',
      sorts: {
        featured: 'Nổi bật',
        newest: 'Mới nhất',
        price_asc: 'Giá thấp đến cao',
        price_desc: 'Giá cao đến thấp',
      },
      filterButton: 'Lọc…',
      filterButtonCount: 'Lọc ({count})…',
      filterTitle: 'Lọc sản phẩm',
      filterDone: 'Xong',
      filterReset: 'Xóa bộ lọc',
      categories: 'Danh mục',
      allCategories: 'Tất cả',
      brands: 'Thương hiệu',
      allBrands: 'Tất cả thương hiệu',
      subCategories: 'Danh mục con',
      badgeNew: 'Mới',
      saleSave: 'Tiết kiệm {amount}',
      saleLeftDays: 'Còn {days}\u00a0ngày {time}',
      saleLeft: 'Còn {time}',
      outOfStock: 'Hết hàng',
      preOrder: 'Đặt trước, dự kiến {days}\u00a0ngày',
      emptyTitle: 'Mỹ phẩm sắp có',
      noMatchTitle: 'Không có sản phẩm phù hợp',
      empty: 'Mỹ phẩm sắp có tại Lucy Spa. Trong lúc chờ, mời bạn xem các dịch vụ của tiệm.',
      emptyAction: 'Xem dịch vụ',
      noMatch: 'Thử đổi từ khóa hoặc bỏ bớt bộ lọc.',
      searchPlaceholder: 'Ví dụ: kem chống nắng…',
      pager: {
        nav: 'Phân trang sản phẩm',
        first: 'Trang đầu',
        previous: 'Trang trước',
        next: 'Trang sau',
        last: 'Trang cuối',
        pageNumber: 'Trang {page}',
        summary: 'Hiển thị {from}–{to} trong {total}',
      },
      backLabel: 'Quay lại Mỹ phẩm',
      back: 'Tất cả mỹ phẩm',
      detailLead: 'Giá niêm yết và tình trạng hàng của sản phẩm.',
      gallery: 'Ảnh sản phẩm',
      pictureN: 'Xem ảnh {n}',
      galleryPrevious: 'Ảnh trước',
      galleryNext: 'Ảnh tiếp theo',
      variants: 'Loại',
      descriptionTitle: 'Mô tả',
      sections: {
        benefits: 'Công dụng',
        ingredients: 'Thành phần',
        usage: 'Cách dùng',
        suitableFor: 'Phù hợp với ai',
      },
      related: 'Sản phẩm cùng danh mục',
      similar: 'Sản phẩm tương tự',
      notFoundTitle: 'Không tìm thấy sản phẩm',
      notFoundBody:
        'Sản phẩm này không còn bán hoặc đang tạm ngưng. Xem các sản phẩm khác của tiệm.',
      store: {
        title: 'Mua trực tiếp tại cửa hàng',
        body: 'Đến Lucy Spa để xem và mua sản phẩm. Nên gọi trước để biết tình trạng hàng.',
        address: 'Địa chỉ',
        hotline: 'Điện thoại',
        directions: 'Chỉ đường',
        call: 'Gọi cửa hàng',
      },
    },
  },
  en: {
    nav: {
      menu: 'Main menu',
      phone: 'Phone menu',
      home: 'Home',
      services: 'Services',
      products: 'Cosmetics',
      book: 'Book',
      bookings: 'Bookings',
      invoices: 'Invoices',
      account: 'Account',
      bookNow: 'Book now',
      contact: 'Contact',
    },
    member: {
      signIn: 'Sign in',
      register: 'Create account',
      signOut: 'Sign out',
      account: 'My account',
      rewards: 'Rewards',
    },
    errors: {
      notFoundTitle: 'This page could not be found',
      notFoundBody: 'The address may be mistyped, or the page is gone.',
      home: 'Back to home',
      errorTitle: 'This page did not load',
      errorBody:
        'Something went wrong opening this page; try again in a few minutes or call the shop hotline.',
      retry: 'Try again',
      ticketTitle: 'Ticket not found',
      ticketBody:
        'This link is not valid, has been revoked or has expired. Ask the shop for a new link.',
    },
    header: {
      brand: 'Lucy Spa, back to the home page',
      language: 'Language',
      switchLanguage: 'Tiếng Việt',
      account: 'My account',
      signInOrRegister: 'Sign in or create an account',
      bookNow: 'Book now',
      bell: { label: 'Notifications', unread: '{count} unread', viewAll: 'View all' },
    },
    infoPage: {
      toc: 'On this page',
      notFoundTitle: 'This page could not be found',
      newTab: 'opens in a new tab',
      updated: 'Updated {date}.',
    },
    contactPage: {
      title: 'Contact',
      lead: 'The address, opening hours and ways to reach Lucy Spa.',
      mapTitle: 'Map to Lucy Spa',
      openMap: 'Directions',
      quickContact: 'Quick contact',
      address: 'Address',
      hotline: 'Phone',
      hours: 'Opening hours',
      call: 'Call now',
      zalo: 'Message on Zalo',
      messenger: 'Message on Messenger',
      loadError: 'The contact details could not be loaded. Please reload the page.',
    },
    contactFab: {
      open: 'Contact',
      close: 'Close contact options',
      group: 'Contact Lucy Spa',
      zalo: 'Message on Zalo',
      messenger: 'Message on Messenger',
      call: 'Call Lucy Spa',
      chat: 'Chat with Lucy…',
    },
    chat: {
      title: 'Chat with Lucy',
      close: 'Close the chat',
      notice:
        'This is an automatic assistant; the shop’s staff do not read this chat. Please do not type a phone number or health details here.',
      greeting:
        'Hello! I can help with service prices, opening hours, promotions, products and free time slots.',
      messageLabel: 'Your message',
      messagePlaceholder: 'For example: opening hours today…',
      send: 'Send',
      typing: 'Lucy is replying…',
      you: 'You',
      assistant: 'Lucy',
      bookSlot: 'Book this time',
      leaveNumber: 'Leave your number for a call back…',
      wait: 'You are writing a little fast. Please wait a moment and try again.',
      fallbackDown:
        'The assistant cannot answer right now. Leave a phone number and the shop will call you back.',
      fallbackCap:
        'The assistant has answered a lot of messages today. Leave a phone number and the shop will call you back.',
      form: {
        title: 'Ask the shop to call you',
        phone: 'Phone number',
        phoneExample: 'Example: 0905 123 456',
        phoneError: 'This phone number does not look right.',
        name: 'Name (optional)',
        note: 'What would you like to ask? (optional)',
        consent: 'I agree that Lucy Spa may call me on this number.',
        consentError: 'Please tick the box so the shop may call you.',
        submit: 'Send my number',
        submitting: 'Sending…',
        back: 'Back to the chat',
        sendError: 'It was not sent. Please try again in a few minutes or call the shop’s hotline.',
        sentTitle: 'The shop has your number',
        sentBody: 'A staff member will call you back during opening hours.',
        sentClose: 'Close',
        discardTitle: 'Discard what you typed?',
        discardBody: 'The phone number and message you typed will be lost.',
        discardConfirm: 'Discard and close',
        discardKeep: 'Keep typing',
      },
    },
    footer: {
      links: 'Links',
      policies: 'Policies',
      legal: 'Legal',
      legalTerms: 'Terms of use',
      legalPrivacy: 'Privacy policy',
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
      fallbackTitle: 'A moment just for you',
      lead: 'Choose your services, pick a free time and book online in minutes.',
      bookNow: 'Book now',
      viewServices: 'View services',
      factsLabel: 'Quick facts',
      brandBandLabel: 'Cosmetics brands at Lucy Spa',
      brandLink: 'See {name} products',
      brandPause: 'Pause the brand band',
      groupsTitle: 'Service price list',
      groupsLead: 'Clear listed prices for every service. Pick one to see the details and book.',
      viewAll: 'View all',
      viewAllOf: 'View all {group} services',
      hotline: 'Phone',
      closed: 'Closed',
      loadError: 'The {section} could not be loaded right now. Please try again in a few minutes.',
      reload: 'Reload the page',
      sectionServices: 'service catalogue',
      noServices: 'The service catalogue is being updated.',
      factAddress: 'Address',
      viewAllServices: 'View all services',
      productsTitle: 'Featured products',
      viewAllProducts: 'View all cosmetics',
      rowPrevious: 'Previous products',
      rowNext: 'Next products',
      categoriesTitle: 'Browse by group',
      categoriesLead: 'Pick a service group or a cosmetics category you like.',
      categoryServices: 'Services',
      categoryProducts: 'Cosmetics',
      directions: 'Directions',
    },
    services: {
      title: 'Services',
      lead: 'Listed prices and the estimated time of each service.',
      groupsLabel: 'Service groups',
      all: 'All',
      book: 'Book',
      estimate: 'Estimated',
      price: 'Price',
      emptyTitle: 'The price list is being updated',
      empty: 'There are no services to show yet.',
      detailLead: 'Price and estimated time of this service.',
      back: 'All services',
      backLabel: 'Back to Services',
      related: 'More in this group',
      included: 'What is included',
      steps: 'How it goes',
      faq: 'Frequently asked questions',
      searchLabel: 'Search services',
      searchPlaceholder: 'For example: hair wash…',
      searchClear: 'Clear the search',
      noMatchTitle: 'No matching services',
      noMatch: 'No service matches “{query}”. Try another name or clear the search.',
      perNailNote:
        'Priced per nail; the number of nails and the final price are settled at the shop.',
      priceNote: 'The time is an estimate; the final price is settled at the shop.',
      notFoundTitle: 'Service not found',
      notFoundBody:
        "This service is no longer offered or is paused. See the shop's other services.",
      ctaTitle: 'Ready to book?',
      ctaLead: 'Pick a free time and book online in minutes.',
      bookBar: 'Book this service',
    },
    products: {
      title: 'Cosmetics',
      lead: 'Cosmetics on sale at Lucy Spa, with listed prices.',
      sectionTitle: 'Products',
      searchLabel: 'Search cosmetics',
      searchClear: 'Clear search',
      sortLabel: 'Sort',
      sorts: {
        featured: 'Featured',
        newest: 'Newest',
        price_asc: 'Price, low to high',
        price_desc: 'Price, high to low',
      },
      filterButton: 'Filter…',
      filterButtonCount: 'Filter ({count})…',
      filterTitle: 'Filter products',
      filterDone: 'Done',
      filterReset: 'Clear filters',
      categories: 'Category',
      allCategories: 'All',
      brands: 'Brand',
      allBrands: 'All brands',
      subCategories: 'Sub-categories',
      badgeNew: 'New',
      saleSave: 'You save {amount}',
      saleLeftDays: '{days}\u00a0days {time} left',
      saleLeft: '{time} left',
      outOfStock: 'Out of stock',
      preOrder: 'Pre-order, expected {days}\u00a0days',
      empty:
        'Cosmetics are coming soon to Lucy Spa. In the meantime, have a look at the shop’s services.',
      emptyTitle: 'Cosmetics are coming soon',
      noMatchTitle: 'No matching products',
      emptyAction: 'See services',
      noMatch: 'Try other words or remove a filter.',
      searchPlaceholder: 'For example: sunscreen…',
      pager: {
        nav: 'Product pages',
        first: 'First page',
        previous: 'Previous page',
        next: 'Next page',
        last: 'Last page',
        pageNumber: 'Page {page}',
        summary: 'Showing {from}–{to} of {total}',
      },
      backLabel: 'Back to Cosmetics',
      back: 'All cosmetics',
      detailLead: 'Listed price and availability of the product.',
      gallery: 'Product pictures',
      pictureN: 'Show picture {n}',
      galleryPrevious: 'Previous picture',
      galleryNext: 'Next picture',
      variants: 'Option',
      descriptionTitle: 'Description',
      sections: {
        benefits: 'Benefits',
        ingredients: 'Ingredients',
        usage: 'How to use',
        suitableFor: 'Who it suits',
      },
      related: 'More in this category',
      similar: 'Similar products',
      notFoundTitle: 'Product not found',
      notFoundBody: "This product is no longer sold or is paused. See the shop's other products.",
      store: {
        title: 'Buy in the shop',
        body: 'Visit Lucy Spa to see and buy the product. Call first to check availability.',
        address: 'Address',
        hotline: 'Phone',
        directions: 'Directions',
        call: 'Call the shop',
      },
    },
  },
} satisfies Record<Locale, SiteText>;

export function getSiteText(locale: Locale): SiteText {
  return text[locale];
}
