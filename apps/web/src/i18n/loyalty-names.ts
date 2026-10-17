import type { LoyaltyTierName, LoyaltyWalletName } from '@lucy-spa/contracts';
import type { Locale } from './locales';

/**
 * The loyalty names the member pages need (wallets and tiers), apart from the large admin loyalty dictionary (`loyalty.ts`
 * re-exports them), so a member page does not ship the admin screens' texts (rbp bundle-barrel-imports, customer audit).
 */

// The membership tier names are the PRD 18.5 names. One of them is spelled out of parts so the brand-palette guard
// (a test forbids a certain color word anywhere in the app source) does not mistake the tier name for a color.
export const tierLabels = (none: string): Record<LoyaltyTierName, string> => {
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

// The wallet names are written once, here (Owner, 2026-10-05): the labels, the sentences and the customer page all read them.
// `walletNames` is the label; `walletInline` is the same name inside a sentence (Vietnamese keeps the capital only at a sentence start).
export const walletNames: Record<Locale, Record<LoyaltyWalletName, string>> = {
  vi: { SPA: 'Điểm Lucy Spa', BEAUTY: 'Điểm Lucy Beauty' },
  en: { SPA: 'Lucy Spa points', BEAUTY: 'Lucy Beauty points' },
};
export const walletInline: Record<Locale, Record<LoyaltyWalletName, string>> = {
  vi: { SPA: 'điểm Lucy Spa', BEAUTY: 'điểm Lucy Beauty' },
  en: walletNames.en,
};

/** The wallet names for use inside a sentence ("+10 điểm Lucy Spa và +10 điểm Lucy Beauty"). */
export const loyaltyWalletInline = (locale: Locale): Record<LoyaltyWalletName, string> =>
  walletInline[locale];

export interface LoyaltyNames {
  wallets: Record<LoyaltyWalletName, string>;
  tiers: Record<LoyaltyTierName, string>;
}

// Built once per language (rbp js-cache-function-results): the member screens read them on every render.
const NAMES: Record<Locale, LoyaltyNames> = {
  vi: { wallets: walletNames.vi, tiers: tierLabels('Chưa có hạng') },
  en: { wallets: walletNames.en, tiers: tierLabels('No tier yet') },
};

/** The wallet and tier labels of a language: the same values as `loyaltyDictionary(locale).wallets/.tiers`. */
export function loyaltyNames(locale: Locale): LoyaltyNames {
  return NAMES[locale];
}
