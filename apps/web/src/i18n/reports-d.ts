import type { Locale } from './locales';

/**
 * Phase 8 P8-17 (Wave D): texts of the customer-reviews report. Numbers only (no comments); a branch or a person with fewer than 5 ratings is
 * "chưa đủ đánh giá" instead of an average. Private: the people rated do not see it unless the Owner decides so. Lucy Spa is a spa: never "khám".
 */
interface Words {
  nav: string;
  title: string;
  intro: string;
  privateNote: string;
  kpi: {
    ratings: string;
    average: string;
    averageInfo: string;
    response: string;
    responseInfo: string;
  };
  notEnough: string;
  byBranch: string;
  byStaff: string;
  col: Record<string, string>;
  empty: string;
  emptyStaff: string;
  exportChoice: string;
}

const vi: Words = {
  nav: 'Đánh giá của khách',
  title: 'Đánh giá của khách',
  intro: 'Khách chấm bao nhiêu sao sau khi thanh toán, theo chi nhánh và theo người phục vụ.',
  privateNote:
    'Đánh giá chỉ dùng nội bộ, không đăng công khai và người được chấm chưa xem được. Báo cáo chỉ có số liệu, không có lời nhắn của khách.',
  kpi: {
    ratings: 'Số đánh giá',
    average: 'Trung bình',
    averageInfo: 'Số sao trung bình. Cần ít nhất 5 đánh giá mới hiện, vì ít hơn thì chưa đáng tin.',
    response: 'Tỷ lệ khách đánh giá',
    responseInfo: 'Số đánh giá trên số hóa đơn đã thanh toán của khách có tài khoản trong kỳ.',
  },
  notEnough: 'Chưa đủ đánh giá',
  byBranch: 'Theo chi nhánh',
  byStaff: 'Theo người phục vụ',
  col: {
    branch: 'Chi nhánh',
    name: 'Nhân viên',
    code: 'Mã',
    count: 'Số đánh giá',
    average: 'Trung bình',
    star1: '1 sao',
    star2: '2 sao',
    star3: '3 sao',
    star4: '4 sao',
    star5: '5 sao',
  },
  empty: 'Chưa có đánh giá nào trong kỳ này.',
  emptyStaff: 'Chưa có đánh giá riêng cho người phục vụ trong kỳ này.',
  exportChoice: 'Đánh giá của khách',
};

const en: Words = {
  nav: 'Customer reviews',
  title: 'Customer reviews',
  intro: 'How many stars customers gave after paying, by branch and by the person who served.',
  privateNote:
    'Reviews are for internal use only, never posted, and the people rated cannot see them yet. The report holds numbers only, not what customers wrote.',
  kpi: {
    ratings: 'Ratings',
    average: 'Average',
    averageInfo: 'Average stars. It shows only from 5 ratings, because fewer cannot be relied on.',
    response: 'Share of customers who reviewed',
    responseInfo: 'Reviews over the paid invoices of customers with an account in the period.',
  },
  notEnough: 'Not enough ratings',
  byBranch: 'By branch',
  byStaff: 'By person',
  col: {
    branch: 'Branch',
    name: 'Employee',
    code: 'Code',
    count: 'Ratings',
    average: 'Average',
    star1: '1 star',
    star2: '2 stars',
    star3: '3 stars',
    star4: '4 stars',
    star5: '5 stars',
  },
  empty: 'No reviews in this period.',
  emptyStaff: 'No ratings of people in this period.',
  exportChoice: 'Customer reviews',
};

export function reportsDDictionary(locale: Locale): Words {
  return locale === 'en' ? en : vi;
}

export type ReportsDDictionary = Words;
