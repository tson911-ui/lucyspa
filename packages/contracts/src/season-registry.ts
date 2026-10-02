/**
 * Code-owned seasonal theme presets (docs/UXUI_REDESIGN_DESIGN.md 20.1-20.3). Constant data only, shared by the web
 * build (which generates `season.css` from it) and the future mobile app. The database stores only a preset `key`,
 * so a new preset is a registry entry plus ornaments and tests, never a migration.
 *
 * Brand red stays the primary color. A preset adds an accent beside it and never replaces brand, text, surface,
 * border, focus or status tokens. Yellow is allowed only in the decorative ornament colors of `tet` and `mid-autumn`
 * (Owner decision Q-S1, 2026-10-02); accent and frame colors are never yellow in any preset.
 */
export const SEASON_PRESET_KEYS = [
  'tet',
  'christmas',
  'valentine',
  'womens-day',
  'vn-womens-day',
  'mid-autumn',
  'reunification-labour',
  'national-day',
] as const;
export type SeasonPresetKey = (typeof SEASON_PRESET_KEYS)[number];

export function isSeasonPresetKey(value: unknown): value is SeasonPresetKey {
  return (SEASON_PRESET_KEYS as readonly unknown[]).includes(value);
}

/** The only tokens a preset may set (besides the ornament colors). All values are 6-digit hex. */
export interface SeasonAccentTokens {
  /** Accent text and boundary on page and surfaces (4.5:1). */
  accent: string;
  /** A light (dark theme: deep) tint that accent text can sit on (4.5:1). */
  accentSoft: string;
  /** Text on an accent fill (4.5:1). */
  onAccent: string;
  frameFrom: string;
  frameTo: string;
  /** Text on both frame stops (4.5:1). */
  frameText: string;
}

/** Three decorative colors for the ornament SVGs; never read by text, buttons, borders or charts. */
export type SeasonOrnamentColors = readonly [string, string, string];

export interface SeasonPreset {
  key: SeasonPresetKey;
  name: { vi: string; en: string };
  /** Default greeting; the Owner may override it per schedule. Plain text, at most 80 characters. */
  greeting: { vi: string; en: string };
  light: SeasonAccentTokens;
  dark: SeasonAccentTokens;
  ornament: { id: string; light: SeasonOrnamentColors; dark: SeasonOrnamentColors };
  /** Suggested window for solar holidays, prefilled and editable in the admin form; null for lunar holidays. */
  suggestedWindow: {
    start: { month: number; day: number };
    end: { month: number; day: number };
  } | null;
}

export const SEASON_GREETING_MAX_LENGTH = 80;

export const SEASON_PRESETS: readonly SeasonPreset[] = [
  {
    key: 'tet',
    name: { vi: 'Tết Nguyên đán', en: 'Lunar New Year' },
    greeting: {
      vi: 'Chúc mừng năm mới! Lucy Spa kính chúc quý khách an khang, thịnh vượng.',
      en: 'Happy Lunar New Year from Lucy Spa. Wishing you health and prosperity.',
    },
    light: {
      accent: '#a8385f',
      accentSoft: '#fbe8ee',
      onAccent: '#ffffff',
      frameFrom: '#b8426a',
      frameTo: '#8a1f3e',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#f09ab8',
      accentSoft: '#3d1a28',
      onAccent: '#2a0f18',
      frameFrom: '#5e1a33',
      frameTo: '#3a0f20',
      frameText: '#ffe8f0',
    },
    ornament: {
      id: 'mai-blossom',
      light: ['#e8b923', '#e88aa8', '#b3263f'],
      dark: ['#f2c94c', '#f4a6bd', '#e8788f'],
    },
    suggestedWindow: null,
  },
  {
    key: 'christmas',
    name: { vi: 'Giáng sinh', en: 'Christmas' },
    greeting: {
      vi: 'Giáng sinh an lành! Lucy Spa chúc quý khách một mùa lễ ấm áp.',
      en: 'Merry Christmas from Lucy Spa. Warm wishes for the season.',
    },
    light: {
      accent: '#23643f',
      accentSoft: '#e4f2ea',
      onAccent: '#ffffff',
      frameFrom: '#2f7a4d',
      frameTo: '#17482c',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#86d6a6',
      accentSoft: '#16301f',
      onAccent: '#0c2214',
      frameFrom: '#1c4a2d',
      frameTo: '#102a1a',
      frameText: '#e6f6ec',
    },
    ornament: {
      id: 'pine-branch',
      light: ['#2f7a4d', '#6fb58a', '#782b37'],
      dark: ['#86d6a6', '#4fa072', '#e08a9a'],
    },
    suggestedWindow: { start: { month: 12, day: 15 }, end: { month: 12, day: 26 } },
  },
  {
    key: 'valentine',
    name: { vi: 'Valentine', en: "Valentine's Day" },
    greeting: {
      vi: 'Valentine ngọt ngào: dành thời gian chăm sóc người thương cùng Lucy Spa.',
      en: "Happy Valentine's Day: treat someone you love at Lucy Spa.",
    },
    light: {
      accent: '#b0265f',
      accentSoft: '#fbe6ef',
      onAccent: '#ffffff',
      frameFrom: '#c23a74',
      frameTo: '#8c1c4a',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#f58bb5',
      accentSoft: '#3e1626',
      onAccent: '#2a0b17',
      frameFrom: '#611735',
      frameTo: '#3b0d20',
      frameText: '#ffe6f0',
    },
    ornament: {
      id: 'hearts',
      light: ['#c23a74', '#f08db3', '#8c1c4a'],
      dark: ['#f58bb5', '#c24b7f', '#ffc2d8'],
    },
    suggestedWindow: { start: { month: 2, day: 12 }, end: { month: 2, day: 15 } },
  },
  {
    key: 'womens-day',
    name: { vi: 'Quốc tế Phụ nữ 8/3', en: "International Women's Day" },
    greeting: {
      vi: 'Chúc mừng Quốc tế Phụ nữ 8/3! Hãy dành cho mình một chút yêu thương.',
      en: "Happy International Women's Day. Take a moment just for you.",
    },
    light: {
      accent: '#843a99',
      accentSoft: '#f3e8f7',
      onAccent: '#ffffff',
      frameFrom: '#9448a8',
      frameTo: '#672b7a',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#dba6ee',
      accentSoft: '#2f1a38',
      onAccent: '#220f2c',
      frameFrom: '#4b2260',
      frameTo: '#2f1240',
      frameText: '#f6e9fb',
    },
    ornament: {
      id: 'orchid',
      light: ['#9448a8', '#d2a0e0', '#672b7a'],
      dark: ['#dba6ee', '#a066bd', '#f3d6fb'],
    },
    suggestedWindow: { start: { month: 3, day: 6 }, end: { month: 3, day: 9 } },
  },
  {
    key: 'vn-womens-day',
    name: { vi: 'Phụ nữ Việt Nam 20/10', en: "Vietnamese Women's Day" },
    greeting: {
      vi: 'Chúc mừng Ngày Phụ nữ Việt Nam 20/10! Lucy Spa chúc quý khách luôn rạng rỡ.',
      en: "Happy Vietnamese Women's Day from all of us at Lucy Spa.",
    },
    light: {
      accent: '#a02d86',
      accentSoft: '#f9e7f4',
      onAccent: '#ffffff',
      frameFrom: '#b23c98',
      frameTo: '#7f2069',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#ee9fdb',
      accentSoft: '#3a1634',
      onAccent: '#2a0c25',
      frameFrom: '#5f1a53',
      frameTo: '#3c0e35',
      frameText: '#ffe8f8',
    },
    ornament: {
      id: 'pink-lotus',
      light: ['#b23c98', '#ea9ad6', '#7f2069'],
      dark: ['#ee9fdb', '#b34d9c', '#ffd0f2'],
    },
    suggestedWindow: { start: { month: 10, day: 18 }, end: { month: 10, day: 21 } },
  },
  {
    key: 'mid-autumn',
    name: { vi: 'Trung thu', en: 'Mid-Autumn Festival' },
    greeting: {
      vi: 'Trung thu vui vẻ! Chúc quý khách và gia đình một mùa trăng đoàn viên.',
      en: 'Happy Mid-Autumn Festival. Wishing you and your family a joyful reunion.',
    },
    light: {
      accent: '#41409c',
      accentSoft: '#ebebfa',
      onAccent: '#ffffff',
      frameFrom: '#4f4eae',
      frameTo: '#2f2e7c',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#b0aef4',
      accentSoft: '#1f1e44',
      onAccent: '#14133a',
      frameFrom: '#2f2e78',
      frameTo: '#1a1950',
      frameText: '#ececff',
    },
    ornament: {
      id: 'lantern',
      light: ['#f0b429', '#e4694f', '#4f4eae'],
      dark: ['#f6c85f', '#f08a74', '#b0aef4'],
    },
    suggestedWindow: null,
  },
  {
    key: 'reunification-labour',
    name: { vi: '30/4 – 1/5', en: 'Reunification and Labour Day' },
    greeting: {
      vi: 'Mừng lễ 30/4 và 1/5! Chúc quý khách kỳ nghỉ thư thái cùng Lucy Spa.',
      en: 'Happy holidays on 30/4 and 1/5. Enjoy a relaxing break with Lucy Spa.',
    },
    light: {
      accent: '#a63a62',
      accentSoft: '#fae8ee',
      onAccent: '#ffffff',
      frameFrom: '#b64a72',
      frameTo: '#8a2a50',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#f09ab7',
      accentSoft: '#3b1a28',
      onAccent: '#280f19',
      frameFrom: '#5c2038',
      frameTo: '#3a1124',
      frameText: '#ffe9f0',
    },
    ornament: {
      id: 'line-star',
      light: ['#b64a72', '#f0a0bb', '#8a2a50'],
      dark: ['#f09ab7', '#c05a7e', '#ffd0df'],
    },
    suggestedWindow: { start: { month: 4, day: 28 }, end: { month: 5, day: 2 } },
  },
  {
    key: 'national-day',
    name: { vi: 'Quốc khánh 2/9', en: 'National Day' },
    greeting: {
      vi: 'Mừng Quốc khánh 2/9! Chúc quý khách một kỳ nghỉ vui vẻ và bình an.',
      en: 'Happy National Day, 2 September. Wishing you a joyful, peaceful holiday.',
    },
    light: {
      accent: '#9e3463',
      accentSoft: '#f9e7ef',
      onAccent: '#ffffff',
      frameFrom: '#ae4472',
      frameTo: '#82284d',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#ee9ab9',
      accentSoft: '#3a1a2a',
      onAccent: '#270f1a',
      frameFrom: '#5a2039',
      frameTo: '#391125',
      frameText: '#ffe8f1',
    },
    ornament: {
      id: 'lotus',
      light: ['#ae4472', '#eea0bd', '#82284d'],
      dark: ['#ee9ab9', '#bf5880', '#ffd0e0'],
    },
    suggestedWindow: { start: { month: 8, day: 31 }, end: { month: 9, day: 3 } },
  },
];

export function getSeasonPreset(key: SeasonPresetKey): SeasonPreset {
  const preset = SEASON_PRESETS.find((candidate) => candidate.key === key);
  if (!preset) throw new Error(`Unknown season preset: ${key}`);
  return preset;
}
