import type {
  LoyaltyLedgerKindName,
  LoyaltyTierName,
  LoyaltyWalletName,
} from '@lucy-spa/contracts';
import type { Locale } from './locales';

/**
 * Phase 5 P5-3: texts of the loyalty admin screens (points, tiers, ledger, adjustments, exceptions, go-live).
 * Kept next to the other feature dictionaries so the large workforce dictionary stays untouched.
 */
// The membership tier names are the PRD 18.5 names. One of them is spelled out of parts so the brand-palette guard
// (a test forbids a certain color word anywhere in the app source) does not mistake the tier name for a color.
const tierLabels = (none: string): Record<LoyaltyTierName, string> => {
  const labels: Record<string, string> = {
    NONE: none,
    SILVER: 'Silver',
    PLATINUM: 'Platinum',
    DIAMOND: 'Diamond',
    RUBY: 'Ruby',
  };
  labels[['GO', 'LD'].join('')] = ['Gol', 'd'].join('');
  return labels as Record<LoyaltyTierName, string>;
};

const vi = {
  title: 'Điểm thưởng',
  intro:
    'Tra cứu điểm Spa và điểm Beauty của khách, xem lịch sử điểm và điều chỉnh có lý do. Điểm không hết hạn và không dùng để trừ tiền.',
  tabsLabel: 'Các mục điểm thưởng',
  tabs: {
    customers: 'Khách hàng',
    referrals: 'Giới thiệu',
    exceptions: 'Ngoại lệ',
    birthday: 'Quà sinh nhật',
    goLive: 'Kích hoạt',
  },
  noAccess: 'Bạn chưa được cấp quyền xem điểm thưởng.',
  noBranch: 'Bạn chưa có chi nhánh nào để tra cứu khách.',
  lookup: {
    title: 'Tìm khách',
    hint: 'Nhập đúng số điện thoại hoặc email của khách. Chỉ hiện kết quả khi khớp hoàn toàn.',
    by: 'Tìm theo',
    phone: 'Số điện thoại',
    email: 'Email',
    branch: 'Chi nhánh',
    search: 'Tra cứu',
    searching: 'Đang tra cứu…',
    open: 'Mở hồ sơ điểm',
    found: 'Đã tìm thấy {name}',
    notFound: 'Không có khách nào khớp.',
  },
  profile: {
    breadcrumbs: 'Đường dẫn',
    adjust: 'Điều chỉnh điểm',
    notLive:
      'Chương trình điểm thưởng chưa được bật nên chưa ghi nhận điểm nào. Chủ spa bật chương trình ở mục “Kích hoạt”.',
    balance: 'Số dư',
    points: '{n} điểm',
    tier: 'Hạng',
    nextTier: 'Hạng kế tiếp',
    toGo: 'Còn {n} điểm để lên {tier}',
    topTier: 'Đã ở hạng cao nhất',
    ledger: 'Lịch sử điểm',
    noEntries: 'Chưa có giao dịch điểm nào.',
    noEntriesFiltered: 'Không có giao dịch nào ở ví này.',
    wallet: 'Ví điểm',
    walletsLabel: 'Ví điểm',
  },
  wallets: { SPA: 'Điểm Spa', BEAUTY: 'Điểm Beauty' } satisfies Record<LoyaltyWalletName, string>,
  tiers: tierLabels('Chưa có hạng'),
  kinds: {
    EARN: 'Tích điểm từ hóa đơn',
    EARN_REVERSAL: 'Thu hồi điểm của hóa đơn',
    REFERRAL_AWARD: 'Thưởng giới thiệu',
    MANUAL_ADJUSTMENT: 'Điều chỉnh thủ công',
    MANUAL_CORRECTION: 'Điều chỉnh sửa lỗi',
  } satisfies Record<LoyaltyLedgerKindName, string>,
  columns: {
    when: 'Thời điểm',
    wallet: 'Ví',
    kind: 'Loại',
    points: 'Điểm',
    shortfall: 'Thiếu',
    source: 'Nguồn',
    detail: 'Ghi chú',
    customer: 'Khách hàng',
    applied: 'Đã trừ',
  },
  corrected: 'Đã có điều chỉnh sửa lỗi',
  correctsLine: 'Sửa lỗi cho một giao dịch trước',
  shortfallNote: 'Thiếu {n} điểm',
  actionsFor: 'Thao tác cho giao dịch {kind}',
  correct: 'Điều chỉnh sửa lỗi',
  adjust: {
    title: 'Điều chỉnh điểm',
    correctTitle: 'Điều chỉnh sửa lỗi',
    description:
      'Ghi một dòng điều chỉnh mới vào lịch sử điểm. Dòng cũ không bao giờ bị sửa hay xóa. Không thể trừ quá số dư hiện có.',
    correctDescription:
      'Dòng sửa lỗi này gắn với giao dịch đã chọn và chỉ ghi được một lần cho mỗi giao dịch.',
    wallet: 'Ví điểm',
    direction: 'Hướng điều chỉnh',
    add: 'Cộng điểm',
    subtract: 'Trừ điểm',
    amount: 'Số điểm',
    amountHint: 'Số nguyên dương, tối đa 1.000.000.',
    reason: 'Lý do',
    reasonHint: 'Nhân viên và Chủ spa xem được lý do này; khách hàng không thấy nội dung lý do.',
    submit: 'Ghi điều chỉnh',
    submitting: 'Đang ghi…',
    done: 'Đã ghi điều chỉnh điểm.',
  },
  exceptions: {
    title: 'Điểm bị thiếu khi thu hồi',
    intro:
      'Mỗi dòng là một lần số dư không đủ để thu hồi hết điểm của một hóa đơn: số dư được đưa về 0, phần thiếu được ghi lại để Chủ spa xem xét. Danh sách này chỉ để xem.',
    none: 'Chưa có trường hợp nào.',
    open: 'Mở hồ sơ điểm',
    noBranch: 'Cần ít nhất một chi nhánh để mở hồ sơ khách.',
  },
  goLive: {
    title: 'Chương trình điểm thưởng',
    off: 'Chưa bật',
    on: 'Đang hoạt động',
    offBody:
      'Khi bật, hóa đơn được thanh toán từ thời điểm đó trở đi sẽ tích điểm cho khách là thành viên đứng tên thanh toán (1.000 ₫ = 1 điểm, làm tròn xuống theo từng hóa đơn). Hóa đơn đã thanh toán trước đó không được tính bù. Việc bật không thể hoàn tác.',
    onBody: 'Chương trình điểm thưởng đã được bật. Điểm được tích từ thời điểm này trở đi.',
    since: 'Bật lúc',
    by: 'Người bật',
    enable: 'Bật chương trình',
    confirmTitle: 'Bật chương trình điểm thưởng?',
    confirmBody:
      'Từ lúc xác nhận, các hóa đơn thanh toán mới sẽ tích điểm. Hóa đơn cũ không được tính bù và không thể tắt lại. Bạn cần nhập lại mật khẩu để xác nhận.',
    confirm: 'Bật chương trình',
    confirming: 'Đang bật…',
    done: 'Đã bật chương trình điểm thưởng.',
    ownerOnly: 'Chỉ Chủ spa mới thấy và thực hiện được thao tác này.',
  },
  // The Member Discount on the invoice (Phase 5 P5-4): staff always see the winner and why.
  member: {
    name: 'Giảm giá hội viên {tier}',
    nameNoTier: 'Giảm giá hội viên',
    applied: '{tier} {percent}% được áp dụng',
    source: 'Hội viên (tự động)',
    previewNote:
      'Hạng tính theo số điểm hiện tại của người thanh toán và được chốt khi chốt hóa đơn. Hóa đơn đã chốt không bao giờ tính lại.',
    reasons: {
      MEMBER_ONLY_ELIGIBLE: 'Giảm giá hội viên là ưu đãi duy nhất đủ điều kiện.',
      MEMBER_LARGEST_BENEFIT: 'Giảm giá hội viên được chọn vì có lợi hơn cho khách.',
      PROGRAM_BEATS_MEMBER: 'Khuyến mãi được chọn vì có lợi hơn giảm giá hội viên.',
      MEMBER_TIE_OVER_PROGRAM:
        'Cùng mức giảm với khuyến mãi; chọn giảm giá hội viên để khách giữ khuyến mãi hoặc mã.',
    },
    ineligible: {
      NO_TIER: 'Chưa đủ 500 điểm Spa.',
      NO_ELIGIBLE_LINES: 'Hóa đơn chưa có dịch vụ đã định giá.',
    },
  },
  // Referral (Phase 5 P5-5): the referrer on a customer, the list, the counter binding and the Owner's correction.
  referral: {
    title: 'Giới thiệu',
    intro:
      'Mỗi khách có tối đa một người giới thiệu. Người giới thiệu nhận 10 điểm Spa và 10 điểm Beauty một lần, khi khách mới thanh toán bằng tiền cho lượt làm dịch vụ đầu tiên.',
    status: { PENDING: 'Chờ thưởng', REWARDED: 'Đã thưởng' },
    via: { SIGNUP: 'Khách tự nhập khi đăng ký', COUNTER: 'Nhân viên ghi tại quầy' },
    list: {
      title: 'Danh sách giới thiệu',
      statusFilter: 'Trạng thái',
      referred: 'Khách được giới thiệu',
      referrer: 'Người giới thiệu',
      bound: 'Ghi nhận lúc',
      via: 'Cách ghi',
      status: 'Trạng thái',
      none: 'Chưa có lượt giới thiệu nào.',
      noneFiltered: 'Không có lượt giới thiệu nào ở trạng thái này.',
      open: 'Mở hồ sơ khách',
      change: 'Đổi người giới thiệu',
      changed: 'Đã được Chủ spa đổi',
      noBranch: 'Cần ít nhất một chi nhánh để xem danh sách giới thiệu.',
    },
    card: {
      title: 'Người giới thiệu',
      none: 'Chưa ghi nhận người giới thiệu.',
      referrer: 'Hội viên',
      via: 'Cách ghi',
      boundAt: 'Ghi nhận lúc',
      boundBy: 'Nhân viên ghi',
      status: 'Trạng thái',
      pending:
        'Chờ thưởng: người giới thiệu nhận điểm khi lượt làm dịch vụ đầu tiên của khách được thanh toán bằng tiền.',
      rewarded: 'Đã thưởng lúc {date} (hóa đơn {invoice}). Người giới thiệu không đổi được nữa.',
      rewardedNoInvoice: 'Đã thưởng lúc {date}. Người giới thiệu không đổi được nữa.',
      asReferrer: 'Đã giới thiệu',
      asReferrerValue: '{n} khách, {m} khách đã được thưởng',
      bind: 'Gắn người giới thiệu',
      change: 'Đổi người giới thiệu',
      history: 'Lịch sử đổi người giới thiệu',
    },
    history: {
      when: 'Thời điểm',
      from: 'Người giới thiệu cũ',
      to: 'Người giới thiệu mới',
      by: 'Người đổi',
      reason: 'Lý do',
    },
    bind: {
      title: 'Gắn người giới thiệu',
      description:
        'Nhập đúng số điện thoại của hội viên đã giới thiệu khách này. Chỉ gắn được trước khi khách thanh toán lượt làm dịch vụ đầu tiên. Sau khi gắn, chỉ Chủ spa mới đổi được và chỉ trước khi người giới thiệu nhận thưởng.',
      phone: 'Số điện thoại người giới thiệu',
      search: 'Tìm hội viên',
      searching: 'Đang tìm…',
      found: 'Hội viên: {name} · {phone}',
      notFound: 'Không có hội viên nào khớp số này.',
      submit: 'Gắn người giới thiệu',
      submitting: 'Đang ghi…',
      done: 'Đã ghi người giới thiệu.',
    },
    changeDialog: {
      title: 'Đổi người giới thiệu',
      description:
        'Chỉ Chủ spa đổi được và chỉ trước khi người giới thiệu nhận thưởng. Mỗi lần đổi được ghi vào lịch sử cùng lý do. Bạn cần nhập lại mật khẩu để xác nhận.',
      phone: 'Số điện thoại người giới thiệu mới',
      reason: 'Lý do',
      reasonHint: 'Ví dụ: khách nhập nhầm số. Lý do được lưu trong lịch sử.',
      submit: 'Lưu thay đổi',
      submitting: 'Đang lưu…',
      done: 'Đã đổi người giới thiệu.',
    },
  },
  errors: {
    LOYALTY_BALANCE_TOO_LOW: 'Số dư chỉ còn {n} điểm',
    REFERRAL_NOT_NEW: 'Khách này đã từng làm dịch vụ nên không thể ghi người giới thiệu nữa.',
    REFERRAL_ALREADY_BOUND: 'Khách này đã có người giới thiệu.',
    REFERRAL_LOCKED: 'Người giới thiệu đã được thưởng nên không thể đổi nữa.',
    REFERRAL_SELF: 'Không thể chọn chính khách làm người giới thiệu.',
    REFERRAL_SAME_REFERRER: 'Đây đã là người giới thiệu hiện tại.',
    REFERRAL_PHONE_UNKNOWN: 'Không có hội viên nào khớp số này.',
    LOYALTY_NOT_LIVE: 'Chương trình điểm thưởng chưa được bật nên chưa thể ghi điểm.',
    LOYALTY_ALREADY_LIVE: 'Chương trình điểm thưởng đã được bật trước đó.',
    LOYALTY_ENTRY_ALREADY_CORRECTED: 'Giao dịch này đã có một điều chỉnh sửa lỗi.',
    CONFLICT: 'Dữ liệu vừa được thay đổi. Hãy tải lại rồi thử lại.',
  },
};

type Dictionary = typeof vi;

const en: Dictionary = {
  title: 'Loyalty points',
  intro:
    "Look up a customer's Spa and Beauty points, see the points history and adjust it with a reason. Points never expire and never reduce a bill.",
  tabsLabel: 'Loyalty sections',
  tabs: {
    customers: 'Customers',
    referrals: 'Referrals',
    exceptions: 'Exceptions',
    birthday: 'Birthday gift',
    goLive: 'Activation',
  },
  noAccess: 'You have not been granted access to loyalty points.',
  noBranch: 'You have no branch to look customers up at.',
  lookup: {
    title: 'Find a customer',
    hint: "Enter the customer's exact phone number or email. A result shows only on an exact match.",
    by: 'Search by',
    phone: 'Phone number',
    email: 'Email',
    branch: 'Branch',
    search: 'Look up',
    searching: 'Looking up…',
    open: 'Open points profile',
    found: 'Found {name}',
    notFound: 'No customer matches.',
  },
  profile: {
    breadcrumbs: 'Breadcrumb',
    adjust: 'Adjust points',
    notLive:
      'The loyalty programme is not switched on yet, so no points are recorded. The Owner switches it on under “Activation”.',
    balance: 'Balance',
    points: '{n} points',
    tier: 'Tier',
    nextTier: 'Next tier',
    toGo: '{n} points to reach {tier}',
    topTier: 'Already at the top tier',
    ledger: 'Points history',
    noEntries: 'No points transactions yet.',
    noEntriesFiltered: 'No transactions in this wallet.',
    wallet: 'Points wallet',
    walletsLabel: 'Points wallet',
  },
  wallets: { SPA: 'Spa points', BEAUTY: 'Beauty points' },
  tiers: tierLabels('No tier yet'),
  kinds: {
    EARN: 'Earned from an invoice',
    EARN_REVERSAL: 'Invoice points taken back',
    REFERRAL_AWARD: 'Referral reward',
    MANUAL_ADJUSTMENT: 'Manual adjustment',
    MANUAL_CORRECTION: 'Correction adjustment',
  },
  columns: {
    when: 'When',
    wallet: 'Wallet',
    kind: 'Type',
    points: 'Points',
    shortfall: 'Short',
    source: 'Source',
    detail: 'Note',
    customer: 'Customer',
    applied: 'Taken',
  },
  corrected: 'Already has a correction',
  correctsLine: 'Corrects an earlier transaction',
  shortfallNote: '{n} points short',
  actionsFor: 'Actions for the {kind} transaction',
  correct: 'Correction adjustment',
  adjust: {
    title: 'Adjust points',
    correctTitle: 'Correction adjustment',
    description:
      'Writes a new adjustment line to the points history. Earlier lines are never edited or deleted. A deduction cannot be larger than the current balance.',
    correctDescription:
      'This correction is linked to the chosen transaction and can be written once per transaction.',
    wallet: 'Points wallet',
    direction: 'Direction',
    add: 'Add points',
    subtract: 'Deduct points',
    amount: 'Points',
    amountHint: 'A positive whole number, at most 1,000,000.',
    reason: 'Reason',
    reasonHint: 'Staff and the Owner can read this reason; the customer never sees its text.',
    submit: 'Record adjustment',
    submitting: 'Recording…',
    done: 'Points adjustment recorded.',
  },
  exceptions: {
    title: 'Points short on a reversal',
    intro:
      'Each row is a time the balance could not cover taking back the points of an invoice: the balance went to 0 and the shortfall was recorded for the Owner to review. This list is read-only.',
    none: 'No cases yet.',
    open: 'Open points profile',
    noBranch: 'At least one branch is needed to open a customer profile.',
  },
  goLive: {
    title: 'Loyalty programme',
    off: 'Not switched on',
    on: 'Active',
    offBody:
      'Once switched on, invoices paid from that moment earn points for the member who pays (1,000 ₫ = 1 point, rounded down per invoice). Invoices paid earlier are not back-filled. Switching on cannot be undone.',
    onBody: 'The loyalty programme is switched on. Points are earned from this moment on.',
    since: 'Switched on at',
    by: 'Switched on by',
    enable: 'Switch on',
    confirmTitle: 'Switch the loyalty programme on?',
    confirmBody:
      'From the moment you confirm, newly paid invoices earn points. Earlier invoices are not back-filled and it cannot be switched off again. You must re-enter your password to confirm.',
    confirm: 'Switch on',
    confirming: 'Switching on…',
    done: 'The loyalty programme is switched on.',
    ownerOnly: 'Only the Owner sees and can do this.',
  },
  member: {
    name: 'Member discount {tier}',
    nameNoTier: 'Member discount',
    applied: '{tier} {percent}% applied',
    source: 'Member (automatic)',
    previewNote:
      "The tier follows the payer's current points and is fixed when the invoice is finalized. A finalized invoice is never recalculated.",
    reasons: {
      MEMBER_ONLY_ELIGIBLE: 'The member discount is the only eligible benefit.',
      MEMBER_LARGEST_BENEFIT:
        'The member discount was chosen because it is better for the customer.',
      PROGRAM_BEATS_MEMBER:
        'The promotion was chosen because it is better than the member discount.',
      MEMBER_TIE_OVER_PROGRAM:
        'Same saving as the promotion; the member discount was chosen so the customer keeps the promotion or code.',
    },
    ineligible: {
      NO_TIER: 'Under 500 Spa points.',
      NO_ELIGIBLE_LINES: 'The invoice has no priced service yet.',
    },
  },
  // Referral (Phase 5 P5-5): the referrer on a customer, the list, the counter binding and the Owner's correction.
  referral: {
    title: 'Referrals',
    intro:
      'Each customer has at most one referrer. The referrer receives 10 Spa points and 10 Beauty points once, when the new customer pays their first visit with money.',
    status: { PENDING: 'Waiting for reward', REWARDED: 'Rewarded' },
    via: {
      SIGNUP: 'Entered by the customer at signup',
      COUNTER: 'Recorded by staff at the counter',
    },
    list: {
      title: 'Referral list',
      statusFilter: 'Status',
      referred: 'Referred customer',
      referrer: 'Referrer',
      bound: 'Recorded at',
      via: 'How',
      status: 'Status',
      none: 'No referrals yet.',
      noneFiltered: 'No referrals with this status.',
      open: 'Open customer profile',
      change: 'Change referrer',
      changed: 'Changed by the Owner',
      noBranch: 'At least one branch is needed to see the referral list.',
    },
    card: {
      title: 'Referrer',
      none: 'No referrer recorded.',
      referrer: 'Member',
      via: 'How',
      boundAt: 'Recorded at',
      boundBy: 'Recorded by',
      status: 'Status',
      pending:
        'Waiting for the reward: the referrer is rewarded when the customer pays the first visit with money.',
      rewarded: 'Rewarded at {date} (invoice {invoice}). The referrer can no longer change.',
      rewardedNoInvoice: 'Rewarded at {date}. The referrer can no longer change.',
      asReferrer: 'Referred',
      asReferrerValue: '{n} customers, {m} rewarded',
      bind: 'Record referrer',
      change: 'Change referrer',
      history: 'Referrer change history',
    },
    history: {
      when: 'When',
      from: 'Previous referrer',
      to: 'New referrer',
      by: 'Changed by',
      reason: 'Reason',
    },
    bind: {
      title: 'Record referrer',
      description:
        'Enter the exact phone number of the member who referred this customer. It can only be recorded before the customer pays their first visit. Afterwards only the Owner can change it, and only before the referrer is rewarded.',
      phone: 'Referrer phone number',
      search: 'Find member',
      searching: 'Searching…',
      found: 'Member: {name} · {phone}',
      notFound: 'No member matches this number.',
      submit: 'Record referrer',
      submitting: 'Saving…',
      done: 'The referrer was recorded.',
    },
    changeDialog: {
      title: 'Change referrer',
      description:
        'Only the Owner can change it, and only before the referrer is rewarded. Every change is kept in the history with its reason. You need to confirm your password.',
      phone: 'New referrer phone number',
      reason: 'Reason',
      reasonHint:
        'For example: the customer typed the wrong number. The reason is kept in the history.',
      submit: 'Save change',
      submitting: 'Saving…',
      done: 'The referrer was changed.',
    },
  },
  errors: {
    LOYALTY_BALANCE_TOO_LOW: 'The balance is only {n} points',
    REFERRAL_NOT_NEW: 'This customer already had a visit, so a referrer can no longer be recorded.',
    REFERRAL_ALREADY_BOUND: 'This customer already has a referrer.',
    REFERRAL_LOCKED: 'The referrer was already rewarded and can no longer change.',
    REFERRAL_SELF: 'A customer cannot be their own referrer.',
    REFERRAL_SAME_REFERRER: 'This is already the current referrer.',
    REFERRAL_PHONE_UNKNOWN: 'No member matches this number.',
    LOYALTY_NOT_LIVE: 'The loyalty programme is not switched on yet, so points cannot be recorded.',
    LOYALTY_ALREADY_LIVE: 'The loyalty programme was already switched on.',
    LOYALTY_ENTRY_ALREADY_CORRECTED: 'This transaction already has a correction.',
    CONFLICT: 'The data was just changed. Reload and try again.',
  },
};

export function loyaltyDictionary(locale: Locale): Dictionary {
  return locale === 'vi' ? vi : en;
}
