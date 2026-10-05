import type {
  CustomerComboStatus,
  CustomerLedgerKind,
  CustomerReferralStatus,
  RewardEntitlementStatus,
  RewardKindName,
} from '@lucy-spa/contracts';
import type { Locale } from './locales';

/**
 * Phase 5 P5-10: texts of the customer's own membership page (design 15). Simple wording only: a staff reason, a shortfall or
 * any internal term never appears. Tier and wallet names come from the loyalty dictionary. Never "khám" (Owner rule).
 */
const vi = {
  title: 'Điểm thưởng và ưu đãi',
  intro: 'Điểm, hạng thành viên, combo, quà tặng và những người bạn đã giới thiệu tại Lucy Spa.',
  notLive:
    'Chương trình điểm thưởng của Lucy Spa chưa bắt đầu. Khi bắt đầu, điểm, combo và quà tặng của bạn sẽ hiện ở đây.',
  points: {
    memberDiscount: 'Ưu đãi hội viên',
    noDiscount: 'Chưa có',
    // Lucy Beauty sells no products yet: no % is promised. Phase 6 (products) must replace this with the real tier % (design 15).
    beautyDiscountPending: 'Áp dụng khi Lucy Beauty mở bán',
    tier: 'Hạng',
    balance: 'Số điểm',
    toGo: 'Còn {n} điểm để lên hạng {tier}',
    topTier: 'Bạn đang ở hạng cao nhất',
  },
  tiers: {
    title: 'Các hạng thành viên',
    rule: '1.000đ thanh toán = 1 điểm. Điểm không hết hạn. Hạng mới áp dụng từ lần thanh toán sau.',
    columns: {
      tier: 'Hạng',
      points: 'Điểm cần có',
      discount: 'Ưu đãi hội viên',
    },
    current: 'Hạng của bạn',
  },
  history: {
    title: 'Lịch sử điểm',
    empty: 'Bạn chưa có giao dịch điểm nào.',
    columns: {
      date: 'Ngày',
      wallet: 'Loại điểm',
      what: 'Nội dung',
      points: 'Điểm',
    },
    kind: {
      EARNED: 'Tích điểm từ hóa đơn',
      TAKEN_BACK: 'Thu hồi điểm của hóa đơn',
      REFERRAL: 'Thưởng giới thiệu',
      ADJUSTED: 'Điều chỉnh bởi Lucy Spa',
    } satisfies Record<CustomerLedgerKind, string>,
  },
  combos: {
    title: 'Combo của tôi',
    hint: 'Buổi đã mua được dùng trước, buổi tặng dùng sau. Combo tạm dừng sẽ dùng lại được khi hóa đơn mua combo được thanh toán lại.',
    empty: 'Bạn chưa có combo nào.',
    columns: {
      combo: 'Combo',
      status: 'Trạng thái',
      paid: 'Buổi đã mua',
      bonus: 'Buổi tặng',
      expires: 'Hạn dùng',
    },
    left: 'Còn {left}/{total}',
    noExpiry: 'Không giới hạn',
    status: {
      ACTIVE: 'Dùng được',
      USED_UP: 'Đã dùng hết',
      EXPIRED: 'Hết hạn',
      PAUSED: 'Tạm dừng',
    } satisfies Record<CustomerComboStatus, string>,
  },
  uses: {
    title: 'Lịch sử dùng combo',
    hint: 'Gồm cả những buổi bạn cho người thân dùng.',
    empty: 'Chưa có buổi combo nào được dùng.',
    columns: {
      date: 'Ngày',
      combo: 'Combo',
      who: 'Người dùng',
      session: 'Buổi',
      branch: 'Chi nhánh',
    },
    owner: 'Bạn',
    relative: 'Người thân',
    relativeNamed: 'Người thân: {name}',
    paid: 'Đã mua',
    bonus: 'Tặng',
  },
  referrals: {
    title: 'Người tôi đã giới thiệu',
    hint: 'Bạn nhận +{n} {spa} và +{n} {beauty} khi người được giới thiệu hoàn tất lượt làm dịch vụ đầu tiên và đã thanh toán bằng tiền.',
    empty: 'Bạn chưa giới thiệu ai.',
    columns: { who: 'Người được giới thiệu', date: 'Ngày ghi nhận', status: 'Trạng thái' },
    status: {
      WAITING: 'Đang chờ',
      REWARDED: 'Đã nhận thưởng',
    } satisfies Record<CustomerReferralStatus, string>,
  },
  gifts: {
    title: 'Quà tặng của tôi',
    empty: 'Bạn chưa có quà tặng nào.',
    columns: {
      gift: 'Quà tặng',
      kind: 'Loại',
      left: 'Số lượng',
      status: 'Trạng thái',
      expires: 'Hạn dùng',
    },
    left: 'Còn {left}/{total}',
    noExpiry: 'Không giới hạn',
    kind: {
      FREE_SERVICE: 'Dịch vụ miễn phí',
      VOUCHER: 'Voucher quà tặng',
      PRODUCT_GIFT: 'Quà hiện vật',
      OTHER: 'Quà tặng',
    } satisfies Record<RewardKindName, string>,
    status: {
      ACTIVE: 'Dùng được',
      USED_UP: 'Đã dùng hết',
      EXPIRED: 'Hết hạn',
      VOIDED: 'Đã thu hồi',
    } satisfies Record<RewardEntitlementStatus, string>,
  },
};

type Dictionary = typeof vi;

const en: Dictionary = {
  title: 'Points and rewards',
  intro: 'Your points, member tier, combos, gifts and the people you referred to Lucy Spa.',
  notLive:
    'The Lucy Spa rewards programme has not started yet. Once it does, your points, combos and gifts will show here.',
  points: {
    memberDiscount: 'Member discount',
    noDiscount: 'None yet',
    beautyDiscountPending: 'Applies when Lucy Beauty opens',
    tier: 'Tier',
    balance: 'Points',
    toGo: '{n} points to reach {tier}',
    topTier: 'You are at the top tier',
  },
  tiers: {
    title: 'Membership tiers',
    rule: 'Every 1,000đ paid = 1 point. Points never expire. A new tier applies from your next payment.',
    columns: {
      tier: 'Tier',
      points: 'Points needed',
      discount: 'Member discount',
    },
    current: 'Your tier',
  },
  history: {
    title: 'Points history',
    empty: 'You have no points activity yet.',
    columns: {
      date: 'Date',
      wallet: 'Points',
      what: 'Details',
      points: 'Points',
    },
    kind: {
      EARNED: 'Earned from an invoice',
      TAKEN_BACK: 'Taken back for an invoice',
      REFERRAL: 'Referral reward',
      ADJUSTED: 'Adjusted by Lucy Spa',
    },
  },
  combos: {
    title: 'My combos',
    hint: 'Purchased sessions are used first, bonus sessions last. A paused combo can be used again once its purchase invoice is paid again.',
    empty: 'You have no combos yet.',
    columns: {
      combo: 'Combo',
      status: 'Status',
      paid: 'Purchased sessions',
      bonus: 'Bonus sessions',
      expires: 'Valid until',
    },
    left: '{left}/{total} left',
    noExpiry: 'No expiry',
    status: {
      ACTIVE: 'Available',
      USED_UP: 'Used up',
      EXPIRED: 'Expired',
      PAUSED: 'Paused',
    },
  },
  uses: {
    title: 'Combo usage',
    hint: 'Includes the sessions you let a relative use.',
    empty: 'No combo session has been used yet.',
    columns: { date: 'Date', combo: 'Combo', who: 'Used by', session: 'Session', branch: 'Branch' },
    owner: 'You',
    relative: 'Relative',
    relativeNamed: 'Relative: {name}',
    paid: 'Purchased',
    bonus: 'Bonus',
  },
  referrals: {
    title: 'People I referred',
    hint: 'You receive +{n} {spa} and +{n} {beauty} when the person you referred completes their first service and has paid with money.',
    empty: 'You have not referred anyone yet.',
    columns: { who: 'Referred person', date: 'Recorded on', status: 'Status' },
    status: {
      WAITING: 'Waiting',
      REWARDED: 'Rewarded',
    },
  },
  gifts: {
    title: 'My gifts',
    empty: 'You have no gifts yet.',
    columns: {
      gift: 'Gift',
      kind: 'Type',
      left: 'Quantity',
      status: 'Status',
      expires: 'Valid until',
    },
    left: '{left}/{total} left',
    noExpiry: 'No expiry',
    kind: {
      FREE_SERVICE: 'Free service',
      VOUCHER: 'Gift voucher',
      PRODUCT_GIFT: 'Gift item',
      OTHER: 'Gift',
    },
    status: {
      ACTIVE: 'Available',
      USED_UP: 'Used up',
      EXPIRED: 'Expired',
      VOIDED: 'Withdrawn',
    },
  },
};

export function customerLoyaltyDictionary(locale: Locale): Dictionary {
  return locale === 'vi' ? vi : en;
}
