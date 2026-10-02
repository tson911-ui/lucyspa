/**
 * Code-owned seasonal theme presets (docs/UXUI_REDESIGN_DESIGN.md 20.1-20.3). Constant data only, shared by the web
 * build (which generates `season.css` from it) and the future mobile app. The database stores only a preset `key`,
 * so a new preset is a registry entry plus ornaments and tests, never a migration.
 *
 * Brand red stays the primary color. A preset adds an accent beside it and never replaces brand, text, surface,
 * border, focus or status tokens. Yellow is allowed only in the decorative ornament colors of `tet`, `mid-autumn`,
 * `reunification-labour` and `national-day` (Owner decision Q-S1, 2026-10-02, extended the same day); accent and
 * frame colors are never yellow in any preset. The two flag-day presets have a brighter red banner (frame) but keep a
 * rose accent: the banner is decoration, never a status color.
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

/**
 * Three decorative colors for the ornament SVGs, drawn on the frame gradient (each at least 3:1 against both frame
 * stops, tested); never read by text, buttons, borders or charts.
 */
export type SeasonOrnamentColors = readonly [string, string, string];

/** One inline-SVG motif per preset (packages/ui `SeasonOrnament`). */
export const SEASON_ORNAMENT_IDS = [
  'mai-blossom',
  'christmas-ornaments',
  'hearts',
  'orchid',
  'pink-lotus',
  'star-lantern-moon',
  'star-fireworks',
  'star-lotus',
] as const;
export type SeasonOrnamentId = (typeof SEASON_ORNAMENT_IDS)[number];

/** What drifts inside the banner (S2): falling petals or snow, rising lanterns or hearts, or nothing. */
export const SEASON_PARTICLE_KINDS = ['petal', 'snow', 'lantern', 'heart', 'none'] as const;
export type SeasonParticleKind = (typeof SEASON_PARTICLE_KINDS)[number];

export interface SeasonPreset {
  key: SeasonPresetKey;
  name: { vi: string; en: string };
  /** Default greeting; the Owner may override it per schedule. Plain text, at most 80 characters. */
  greeting: { vi: string; en: string };
  light: SeasonAccentTokens;
  dark: SeasonAccentTokens;
  ornament: {
    id: SeasonOrnamentId;
    particle: SeasonParticleKind;
    light: SeasonOrnamentColors;
    dark: SeasonOrnamentColors;
  };
  /** Suggested window for solar holidays, prefilled and editable in the admin form; null for lunar holidays. */
  suggestedWindow: {
    start: { month: number; day: number };
    end: { month: number; day: number };
  } | null;
  /** Site-wide art (S6); absent until the preset's kit ships. */
  art?: SeasonArt;
}

/**
 * The site-wide decoration kit of a preset (Step S6, docs/UXUI_REDESIGN_S6_PLAN.md): the colors its drawn art reads,
 * as named tokens (`--ls-art-<name>`, camelCase keys become kebab-case), and the short footer lines. Art colors are
 * decoration only: text, buttons and accents keep the brand tokens. A preset without `art` keeps the S5 banner until
 * its own Step ships. All values are 6-digit hex; yellow-hue colors are allowed only in the four Q-S1 presets.
 */
export interface SeasonArt {
  light: Readonly<Record<string, string>>;
  dark: Readonly<Record<string, string>>;
  /** The footer scene's greeting line; `sub` is a second line (Tet computes its own, from the lunar year). */
  footer: { line: { vi: string; en: string }; sub?: { vi: string; en: string } };
}

/**
 * The iconic motifs every kit must draw as part of its scenes, not just flowers (Owner addition 2026-10-02, recorded in
 * docs/UXUI_REDESIGN_S6_PLAN.md section 4). Keys are stable ids: the art tags each drawing with `data-motif`, and a
 * test fails when a shipped kit lacks one. Kits that have no art yet are listed here so each Step builds to the list.
 */
export const SEASON_MOTIFS: Readonly<Record<string, readonly string[]>> = {
  tet: [
    'li-xi',
    'cau-doi',
    'hoa-mai',
    'hoa-dao',
    'banh-chung',
    'banh-tet',
    'mam-ngu-qua',
    'dua-hau',
    'phao-giay',
    'long-den',
    'zodiac',
  ],
  christmas: [
    'santa',
    'snowman',
    'sleigh-reindeer',
    'gifts',
    'stockings',
    'candy-canes',
    'wreath',
    'bells',
    'tree',
  ],
  valentine: ['roses', 'chocolates', 'love-letters', 'cupid'],
  'womens-day': ['bouquets', 'ao-dai', 'non-la', 'gift-boxes'],
  'vn-womens-day': ['bouquets', 'ao-dai', 'non-la', 'gift-boxes'],
  'mid-autumn': [
    'lion-dance',
    'star-lantern',
    'carp-lantern',
    'spinning-lantern',
    'full-moon',
    'chi-hang-chu-cuoi',
    'jade-rabbit',
    'mooncakes',
  ],
  'reunification-labour': ['flag-bunting', 'fireworks', 'peace-doves', 'lotus'],
  'national-day': ['flag-bunting', 'fireworks', 'peace-doves', 'lotus'],
  'vu-lan': ['rose-on-shirt', 'hoa-dang', 'lotus'],
  celebration: ['balloons', 'confetti', 'ribbons', 'cake'],
};

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
      particle: 'petal',
      light: ['#f5c518', '#ffc2d6', '#ffe9f0'],
      dark: ['#f2c94c', '#f4a6bd', '#e8788f'],
    },
    suggestedWindow: null,
    art: {
      light: {
        red: '#d3263f',
        red2: '#ec5a72',
        red3: '#a51a31',
        yellow: '#f5c518',
        yellow2: '#d49a0a',
        yellow3: '#fde68a',
        mai: '#f7c928',
        mai2: '#ffe27a',
        maiCentre: '#e8851c',
        peach: '#f08fb0',
        peach2: '#ffd0df',
        wood: '#7a4a3a',
        leaf: '#4f8a5b',
        cord: '#b8862b',
        cream: '#fff3e2',
        cream2: '#f0d9bd',
        blush: '#f4a1bd',
        leaf2: '#2f6b3f',
        leaf3: '#7fbf8e',
        ink: '#2b1d1d',
        white: '#ffffff',
        panel: '#f8d4de',
        panelText: '#3a1a22',
        tint1: '#f48fb0',
        tint2: '#f5965a',
      },
      dark: {
        red: '#e84a62',
        red2: '#f47489',
        red3: '#b8263d',
        yellow: '#f2c94c',
        yellow2: '#c9a038',
        yellow3: '#f8dc7e',
        mai: '#f2c94c',
        mai2: '#f8dc7e',
        maiCentre: '#e9963a',
        peach: '#f0a0bb',
        peach2: '#f9c9d8',
        wood: '#a8765f',
        leaf: '#6aa876',
        cord: '#d4a94c',
        cream: '#fbead4',
        cream2: '#dcc3a4',
        blush: '#f0a0bb',
        leaf2: '#4f9a62',
        leaf3: '#8cc79a',
        ink: '#2b1d1d',
        white: '#ffffff',
        panel: '#46303a',
        panelText: '#ffe8f0',
        tint1: '#a0325a',
        tint2: '#c8961e',
      },
      footer: { line: { vi: 'Chúc mừng năm mới', en: 'Happy Lunar New Year' } },
    },
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
      id: 'christmas-ornaments',
      particle: 'snow',
      light: ['#bfe8cf', '#e6f6ec', '#ffc9d1'],
      dark: ['#86d6a6', '#4fa072', '#e08a9a'],
    },
    suggestedWindow: { start: { month: 12, day: 15 }, end: { month: 12, day: 26 } },
    art: {
      light: {
        red: '#c62f3f',
        red2: '#e05a68',
        red3: '#962033',
        pine: '#2f7a4d',
        pine2: '#58a272',
        pine3: '#1d5a38',
        white: '#ffffff',
        snow: '#ffffff',
        snow2: '#d6e4f0',
        ice: '#8fb8de',
        pink: '#f4a8b4',
        wood: '#7a4a3a',
        bulb1: '#e5484d',
        bulb2: '#58b27a',
        bulb3: '#8fc6f0',
        bulb4: '#f6a3c0',
        wire: '#3b5c47',
        star: '#f06a7c',
        ink: '#2a2a35',
        skin: '#f6c9a6',
        carrot: '#e8873a',
        panel: '#ffffff',
        panelText: '#1f2d3a',
        tint1: '#58a272',
        tint2: '#8fb8de',
      },
      dark: {
        red: '#e5484d',
        red2: '#f0727a',
        red3: '#b32a3a',
        pine: '#3f9a63',
        pine2: '#6bbf8a',
        pine3: '#276f47',
        white: '#ffffff',
        snow: '#eef3f8',
        snow2: '#8fa6bf',
        ice: '#b8d4ee',
        pink: '#f0a0ae',
        wood: '#a8765f',
        bulb1: '#f0606a',
        bulb2: '#6bbf8a',
        bulb3: '#a8d3f5',
        bulb4: '#f4b0c8',
        wire: '#8fb8a0',
        star: '#f58294',
        ink: '#44445a',
        skin: '#f6c9a6',
        carrot: '#f09a50',
        panel: '#eef3f8',
        panelText: '#1f2d3a',
        tint1: '#3c8c5a',
        tint2: '#5a82be',
      },
      footer: {
        line: { vi: 'Giáng sinh an lành', en: 'Merry Christmas' },
        sub: { vi: 'Một mùa lễ ấm áp cùng Lucy Spa', en: 'A warm season with Lucy Spa' },
      },
    },
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
      particle: 'heart',
      light: ['#ffd0e2', '#fff0f6', '#ffb8d2'],
      dark: ['#f58bb5', '#e0709e', '#ffc2d8'],
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
      particle: 'petal',
      light: ['#ecd0f7', '#faf0fd', '#dcb0ee'],
      dark: ['#dba6ee', '#b680cc', '#f3d6fb'],
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
      particle: 'petal',
      light: ['#f8cdeb', '#fff0fa', '#f4b0e0'],
      dark: ['#ee9fdb', '#cc6bb4', '#ffd0f2'],
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
      id: 'star-lantern-moon',
      particle: 'lantern',
      light: ['#f5c518', '#ffb199', '#d3d2ff'],
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
      frameFrom: '#d62d3a',
      frameTo: '#a81d2b',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#f09ab7',
      accentSoft: '#3b1a28',
      onAccent: '#280f19',
      frameFrom: '#9c1f2c',
      frameTo: '#5e121c',
      frameText: '#fff1f2',
    },
    ornament: {
      id: 'star-fireworks',
      particle: 'none',
      light: ['#ffd23f', '#fff4f4', '#ffc7cb'],
      dark: ['#ffd84d', '#fff1f2', '#ff9aa3'],
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
      frameFrom: '#da323f',
      frameTo: '#aa202e',
      frameText: '#ffffff',
    },
    dark: {
      accent: '#ee9ab9',
      accentSoft: '#3a1a2a',
      onAccent: '#270f1a',
      frameFrom: '#a2222f',
      frameTo: '#621520',
      frameText: '#fff1f2',
    },
    ornament: {
      id: 'star-lotus',
      particle: 'none',
      light: ['#ffd23f', '#fff4f4', '#ffc7cb'],
      dark: ['#ffd84d', '#fff1f2', '#ff9aa3'],
    },
    suggestedWindow: { start: { month: 8, day: 31 }, end: { month: 9, day: 3 } },
  },
];

export function getSeasonPreset(key: SeasonPresetKey): SeasonPreset {
  const preset = SEASON_PRESETS.find((candidate) => candidate.key === key);
  if (!preset) throw new Error(`Unknown season preset: ${key}`);
  return preset;
}
