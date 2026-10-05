import type { ComboSoldCause, ComboSoldStatus } from '@lucy-spa/contracts';
import type { Locale } from './locales';

/**
 * Phase 5 P5-10b: texts of the "Combo đã bán" list and of a customer's combos and gifts on the staff profile. Lucy Spa is a spa,
 * not a clinic: never the word for a medical examination in Vietnamese (Owner rule, CLAUDE.md).
 */
const vi = {
  tab: 'Combo đã bán',
  title: 'Combo đã bán',
  intro:
    'Mọi combo đã bán, gồm cả combo bị khóa hoặc đã thu hồi. Chỉ đọc: số buổi còn lại ở trên chỉ tính combo đang dùng được; buổi bị khóa nằm riêng.',
  totals: {
    label: 'Buổi còn dùng được',
    paid: 'Buổi đã mua còn lại',
    bonus: 'Buổi tặng còn lại',
    note: 'Chỉ tính combo đang dùng được',
    frozen: 'Buổi đang bị khóa',
    frozenNote: 'Mua {paid} · Tặng {bonus}',
  },
  value: {
    active: 'Tiền trả trước chưa dùng',
    activeNote: 'Combo đang dùng được; buổi tặng tính 0đ',
    apart: 'Tiền trả trước tính riêng',
    frozen: 'Combo bị khóa',
    revoked: 'Combo đã thu hồi',
    apartNote: 'Tiền trả trước, tính riêng, không nằm trong tổng chưa dùng',
    row: 'Còn {amount}',
  },
  statusFilter: 'Trạng thái',
  none: 'Chưa có combo nào được bán.',
  noneFiltered: 'Không có combo nào ở trạng thái này.',
  columns: {
    buyer: 'Người mua',
    combo: 'Combo',
    sessions: 'Buổi còn lại',
    status: 'Trạng thái',
    expires: 'Hạn dùng',
  },
  left: '{left}/{total}',
  paidLeft: 'Mua {left}/{total}',
  bonusLeft: 'Tặng {left}/{total}',
  noBonus: 'Tặng —',
  noExpiry: 'Không giới hạn',
  noDetail: '—',
  openCustomer: 'Xem hồ sơ khách',
  status: {
    ACTIVE: 'Dùng được',
    USED_UP: 'Đã dùng hết',
    EXPIRED: 'Hết hạn',
    FROZEN: 'Bị khóa',
    REVOKED: 'Đã thu hồi',
  } satisfies Record<ComboSoldStatus, string>,
  event: {
    FROZEN: 'Khóa {date}',
    REVOKED: 'Thu hồi {date}',
  },
  cause: {
    SALE_REVERSED: 'thanh toán bị đảo',
    SALE_CANCELLED: 'hóa đơn bị hủy',
  } satisfies Record<ComboSoldCause, string>,
  profile: {
    combosTitle: 'Combo của khách',
    combosNone: 'Khách chưa mua combo nào.',
    giftsTitle: 'Quà tặng của khách',
    giftsNone: 'Khách chưa được tặng quà nào.',
    giftsNotLive: 'Chương trình điểm thưởng chưa bật nên chưa có quà tặng nào.',
    gift: 'Quà tặng',
    kind: 'Loại',
    quantity: 'Số lượng còn',
    status: 'Trạng thái',
    expires: 'Hạn dùng',
  },
};

type Dictionary = typeof vi;

const en: Dictionary = {
  tab: 'Combos sold',
  title: 'Combos sold',
  intro:
    'Every combo that was sold, frozen and revoked ones included. Read only: the sessions left above count only combos that can be used now; frozen sessions are apart.',
  totals: {
    label: 'Sessions usable now',
    paid: 'Purchased left',
    bonus: 'Bonus left',
    note: 'Only combos that can be used now',
    frozen: 'Sessions frozen',
    frozenNote: 'Purchased {paid} · Bonus {bonus}',
  },
  value: {
    active: 'Unused prepaid money',
    activeNote: 'Combos usable now; bonus sessions count as 0',
    apart: 'Prepaid money counted apart',
    frozen: 'Frozen combos',
    revoked: 'Revoked combos',
    apartNote: 'Prepaid money, counted apart, not inside the unused total',
    row: '{amount} left',
  },
  statusFilter: 'Status',
  none: 'No combo has been sold yet.',
  noneFiltered: 'No combo has this status.',
  columns: {
    buyer: 'Buyer',
    combo: 'Combo',
    sessions: 'Sessions left',
    status: 'Status',
    expires: 'Valid until',
  },
  left: '{left}/{total}',
  paidLeft: 'Purchased {left}/{total}',
  bonusLeft: 'Bonus {left}/{total}',
  noBonus: 'Bonus —',
  noExpiry: 'No expiry',
  noDetail: '—',
  openCustomer: "Open the customer's profile",
  status: {
    ACTIVE: 'Available',
    USED_UP: 'Used up',
    EXPIRED: 'Expired',
    FROZEN: 'Frozen',
    REVOKED: 'Revoked',
  },
  event: {
    FROZEN: 'Frozen {date}',
    REVOKED: 'Revoked {date}',
  },
  cause: {
    SALE_REVERSED: 'payment reversed',
    SALE_CANCELLED: 'invoice cancelled',
  },
  profile: {
    combosTitle: "Customer's combos",
    combosNone: 'The customer has not bought a combo.',
    giftsTitle: "Customer's gifts",
    giftsNone: 'The customer has not been given a gift.',
    giftsNotLive: 'The loyalty programme is not on yet, so there are no gifts.',
    gift: 'Gift',
    kind: 'Type',
    quantity: 'Quantity left',
    status: 'Status',
    expires: 'Valid until',
  },
};

export function comboSoldDictionary(locale: Locale): Dictionary {
  return locale === 'vi' ? vi : en;
}
