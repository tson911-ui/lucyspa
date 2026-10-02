import type { Locale } from './locales';

/** The few strings the seasonal band and the admin touch need, kept apart from the large dictionaries. */
export interface SeasonText {
  /** Names the band for assistive technology. */
  band: string;
  fxOff: string;
  fxOn: string;
  chipHide: string;
  chipShow: string;
}

const dictionaries: Record<Locale, SeasonText> = {
  vi: {
    band: 'Lời chúc theo mùa lễ',
    fxOff: 'Tắt hiệu ứng',
    fxOn: 'Bật hiệu ứng',
    chipHide: 'Ẩn mùa lễ',
    chipShow: 'Hiện mùa lễ',
  },
  en: {
    band: 'Seasonal greeting',
    fxOff: 'Turn off effects',
    fxOn: 'Turn on effects',
    chipHide: 'Hide season',
    chipShow: 'Show season',
  },
};

export const seasonText = (locale: Locale): SeasonText => dictionaries[locale];
