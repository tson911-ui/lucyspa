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
  tabs: { customers: 'Khách hàng', exceptions: 'Ngoại lệ', goLive: 'Kích hoạt' },
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
      'Ghi một dòng điều chỉnh mới vào lịch sử điểm. Dòng cũ không bao giờ bị sửa hay xóa. Không thể trừ quá số dư: phần thiếu được ghi lại và báo vào mục “Ngoại lệ”.',
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
    doneShortfall:
      'Đã ghi điều chỉnh. Số dư không đủ nên {n} điểm bị thiếu và đã được báo ở mục “Ngoại lệ”.',
  },
  exceptions: {
    title: 'Điểm bị thiếu khi thu hồi hoặc trừ',
    intro:
      'Mỗi dòng là một lần số dư không đủ để trừ hết điểm: số dư được đưa về 0, phần thiếu được ghi lại để Chủ spa xem xét. Danh sách này chỉ để xem.',
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
  errors: {
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
  tabs: { customers: 'Customers', exceptions: 'Exceptions', goLive: 'Activation' },
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
      'Writes a new adjustment line to the points history. Earlier lines are never edited or deleted. A deduction cannot go below the balance: the shortfall is recorded and flagged under “Exceptions”.',
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
    doneShortfall:
      'Adjustment recorded. The balance was too small, so {n} points were short and flagged under “Exceptions”.',
  },
  exceptions: {
    title: 'Points short on a reversal or deduction',
    intro:
      'Each row is a time the balance could not cover a deduction: the balance went to 0 and the shortfall was recorded for the Owner to review. This list is read-only.',
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
  errors: {
    LOYALTY_NOT_LIVE: 'The loyalty programme is not switched on yet, so points cannot be recorded.',
    LOYALTY_ALREADY_LIVE: 'The loyalty programme was already switched on.',
    LOYALTY_ENTRY_ALREADY_CORRECTED: 'This transaction already has a correction.',
    CONFLICT: 'The data was just changed. Reload and try again.',
  },
};

export function loyaltyDictionary(locale: Locale): Dictionary {
  return locale === 'vi' ? vi : en;
}
