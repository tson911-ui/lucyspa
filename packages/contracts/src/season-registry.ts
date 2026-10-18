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
  'vu-lan',
  'celebration',
] as const;
export type SeasonPresetKey = (typeof SEASON_PRESET_KEYS)[number];

export function isSeasonPresetKey(value: unknown): value is SeasonPresetKey {
  return (SEASON_PRESET_KEYS as readonly unknown[]).includes(value);
}

/** The only tokens a preset may set (besides the ornament colors). All values are 6-digit hex. */
export interface SeasonAccentTokens {
  /** Accent text and boundary on page and surfaces (4.5:1). */
  accent: string;
  /** A light tint that accent text can sit on (4.5:1). */
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
  'lotus-lantern',
  'balloons-confetti',
] as const;
export type SeasonOrnamentId = (typeof SEASON_ORNAMENT_IDS)[number];

/** What drifts inside the banner (S2): falling petals or snow, rising lanterns or hearts, or nothing. */
export const SEASON_PARTICLE_KINDS = [
  'petal',
  'snow',
  'lantern',
  'heart',
  'confetti',
  'none',
] as const;
export type SeasonParticleKind = (typeof SEASON_PARTICLE_KINDS)[number];

export interface SeasonPreset {
  key: SeasonPresetKey;
  name: { vi: string; en: string };
  /** Default greeting; the Owner may override it per schedule. Plain text, at most 80 characters. */
  greeting: { vi: string; en: string };
  /** The only palette: the app is light only (Owner, 2026-10-18), so a preset has no dark set. */
  light: SeasonAccentTokens;
  ornament: {
    id: SeasonOrnamentId;
    particle: SeasonParticleKind;
    light: SeasonOrnamentColors;
  };
  /** Suggested window for solar holidays, prefilled and editable in the admin form; null for lunar holidays. */
  suggestedWindow: {
    start: { month: number; day: number };
    end: { month: number; day: number };
  } | null;
  /** Site-wide art (S6); absent until the preset's kit ships. */
  art?: SeasonArt;
  /**
   * A base kit for custom events (S6b): it has no calendar date of its own, so the form asks for the event name and
   * the days instead of prefilling them (solar holidays) or noting that they are lunar.
   */
  customEvent?: true;
  /**
   * Set to false when a new season of this kit starts with the particles switch off (Vu Lan is calm: the slow
   * floating lanterns are an option, Owner decision 6). Absent means on.
   */
  particlesDefault?: false;
}

/**
 * The seven decoration slots of a season (S6, plan section 3). Every one can be switched off per event, and every
 * one can be replaced by one image from the media library (S6b).
 */
export const SEASON_SLOTS = [
  'particles',
  'header',
  'logo',
  'corners',
  'dividers',
  'footer',
  'tint',
] as const;
export type SeasonSlot = (typeof SEASON_SLOTS)[number];

export function isSeasonSlot(value: unknown): value is SeasonSlot {
  return (SEASON_SLOTS as readonly unknown[]).includes(value);
}

/** How many particles drift: low / medium / high is 12 / 24 / 40 on a desktop and 6 / 12 / 20 on a phone. */
export const SEASON_DENSITIES = ['low', 'medium', 'high'] as const;
export type SeasonDensity = (typeof SEASON_DENSITIES)[number];
export const DEFAULT_SEASON_DENSITY: SeasonDensity = 'medium';

export function isSeasonDensity(value: unknown): value is SeasonDensity {
  return (SEASON_DENSITIES as readonly unknown[]).includes(value);
}

/** Slot name -> on or off. A kit without a slot ignores its switch. */
export type SeasonSlotSwitches = Record<SeasonSlot, boolean>;

/** Everything on: what a new season and the rows saved before S6b mean. */
export const ALL_SEASON_SLOTS_ON: Readonly<SeasonSlotSwitches> = Object.freeze({
  particles: true,
  header: true,
  logo: true,
  corners: true,
  dividers: true,
  footer: true,
  tint: true,
});

/**
 * The site-wide decoration kit of a preset (Step S6, docs/UXUI_REDESIGN_S6_PLAN.md): the colors its drawn art reads,
 * as named tokens (`--ls-art-<name>`, camelCase keys become kebab-case), and the short footer lines. Art colors are
 * decoration only: text, buttons and accents keep the brand tokens. A preset without `art` keeps the S5 banner until
 * its own Step ships. All values are 6-digit hex; yellow-hue colors are allowed only in the four Q-S1 presets.
 */
export interface SeasonArt {
  light: Readonly<Record<string, string>>;
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
  valentine: ['roses', 'chocolates', 'love-letters', 'teddy-bears', 'arrow-heart'],
  'womens-day': ['bouquets', 'ao-dai', 'non-la', 'gift-boxes'],
  'vn-womens-day': ['bouquets', 'ao-dai', 'non-la', 'gift-boxes'],
  'mid-autumn': [
    'lion-dance',
    'ong-dia',
    'drum-cymbals',
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

/** The two flag-day kits (30/4-1/5 and 2/9) draw one family of art, so they share one palette. */
const FLAG_DAY_ART_COLORS = {
  light: {
    red: '#da2f3f',
    red2: '#ef6470',
    red3: '#a81d2b',
    yellow: '#ffd23f',
    yellow2: '#e9ab12',
    yellow3: '#ffe88a',
    string: '#a8847c',
    ink: '#3a1a1e',
    dove: '#ffffff',
    dove2: '#d6e2f0',
    leaf: '#4f8a5b',
    leaf2: '#2f6b3f',
    lotus: '#f08cb4',
    lotus2: '#fbd0e0',
    lotus3: '#d4608f',
    white: '#ffffff',
    cream: '#fff4f2',
    cream2: '#fbdcd8',
    panel: '#ffffff',
    panelText: '#4a1a22',
    tint1: '#ef6470',
    tint2: '#ffd23f',
  },
} as const;

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
    ornament: {
      id: 'mai-blossom',
      particle: 'petal',
      light: ['#f5c518', '#ffc2d6', '#ffe9f0'],
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
    ornament: {
      id: 'christmas-ornaments',
      particle: 'snow',
      light: ['#bfe8cf', '#e6f6ec', '#ffc9d1'],
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
    ornament: {
      id: 'hearts',
      particle: 'heart',
      light: ['#ffd0e2', '#fff0f6', '#ffb8d2'],
    },
    suggestedWindow: { start: { month: 2, day: 12 }, end: { month: 2, day: 15 } },
    art: {
      light: {
        rose: '#d6335f',
        rose2: '#ef7195',
        rose3: '#a31d47',
        pink: '#f9b9cd',
        pink2: '#fde3ec',
        leaf: '#4f8a5b',
        leaf2: '#2f6b3f',
        choc: '#6b3a2a',
        choc2: '#8f5a46',
        cream: '#fff0f4',
        cream2: '#f9d3e0',
        paper: '#fffaf5',
        ribbon: '#e04877',
        skin: '#f6c9a6',
        string: '#b08494',
        ink: '#3a1a28',
        white: '#ffffff',
        panel: '#ffffff',
        panelText: '#4a1a30',
        tint1: '#f48fb0',
        tint2: '#f9b4c8',
      },
      footer: {
        line: { vi: 'Valentine ngọt ngào', en: "Happy Valentine's Day" },
        sub: { vi: 'Yêu thương cùng Lucy Spa', en: 'With love from Lucy Spa' },
      },
    },
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
    ornament: {
      id: 'orchid',
      particle: 'petal',
      light: ['#ecd0f7', '#faf0fd', '#dcb0ee'],
    },
    suggestedWindow: { start: { month: 3, day: 6 }, end: { month: 3, day: 9 } },
    art: {
      light: {
        bloom: '#9a4db3',
        bloom2: '#c98ee0',
        bloom3: '#6f2f86',
        rose: '#e0507a',
        rose2: '#f08cab',
        rose3: '#a8325b',
        pink: '#f6cde3',
        pink2: '#fbe8f2',
        leaf: '#4f8a5b',
        leaf2: '#2f6b3f',
        ao: '#8a4fb5',
        ao2: '#e9d3f5',
        hat: '#f0dcb4',
        hat2: '#d1b992',
        skin: '#f6c9a6',
        ribbon: '#b84fa0',
        trousers: '#ffffff',
        cream: '#fbf1fa',
        cream2: '#ecd3f2',
        string: '#a98bb8',
        ink: '#2d1f36',
        white: '#ffffff',
        panel: '#ffffff',
        panelText: '#2d1a3a',
        tint1: '#c98ee0',
        tint2: '#f6cde3',
      },
      footer: {
        line: { vi: 'Chúc mừng Quốc tế Phụ nữ 8/3', en: "Happy Women's Day" },
        sub: { vi: 'Yêu thương bản thân mỗi ngày', en: 'Love yourself every day' },
      },
    },
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
    ornament: {
      id: 'pink-lotus',
      particle: 'petal',
      light: ['#f8cdeb', '#fff0fa', '#f4b0e0'],
    },
    suggestedWindow: { start: { month: 10, day: 18 }, end: { month: 10, day: 21 } },
    art: {
      light: {
        bloom: '#d2479f',
        bloom2: '#f08cc8',
        bloom3: '#9c2a78',
        rose: '#f0648f',
        rose2: '#f79fba',
        rose3: '#b02a5c',
        pink: '#f9c9e4',
        pink2: '#fdebf6',
        leaf: '#4f8a5b',
        leaf2: '#2f6b3f',
        ao: '#b83a8f',
        ao2: '#fbd3ec',
        hat: '#f0dcb4',
        hat2: '#d1b992',
        skin: '#f6c9a6',
        ribbon: '#c8409a',
        trousers: '#ffffff',
        cream: '#fcf0f8',
        cream2: '#f6d3ea',
        string: '#b58aa8',
        ink: '#34202e',
        white: '#ffffff',
        panel: '#ffffff',
        panelText: '#3a1a33',
        tint1: '#f08cc8',
        tint2: '#f9c9e4',
      },
      footer: {
        line: { vi: 'Chúc mừng 20/10', en: "Happy Vietnamese Women's Day" },
        sub: { vi: 'Rạng rỡ cùng Lucy Spa', en: 'Radiant with Lucy Spa' },
      },
    },
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
    ornament: {
      id: 'star-lantern-moon',
      particle: 'lantern',
      light: ['#f5c518', '#ffb199', '#d3d2ff'],
    },
    suggestedWindow: null,
    art: {
      light: {
        red: '#d8393f',
        red2: '#f0665f',
        red3: '#a82630',
        orange: '#f08a3c',
        orange2: '#f7b36e',
        yellow: '#f5c518',
        yellow2: '#d49a0a',
        yellow3: '#fde68a',
        green: '#3f9a63',
        green2: '#2f7a4d',
        white: '#ffffff',
        ink: '#2a2440',
        cord: '#b8862b',
        string: '#b8a98a',
        moon: '#fdf0b8',
        moon2: '#e8c860',
        cloud: '#ffffff',
        cloud2: '#dcdaf5',
        jade: '#eaf6f0',
        jade2: '#9fcdb6',
        blush: '#f6b6c4',
        crust: '#c98a4a',
        crust2: '#a8692f',
        filling: '#f7e3b0',
        cream: '#f1effc',
        cream2: '#e0def7',
        banyan: '#3b7a52',
        banyan2: '#5aa070',
        trunk: '#6a4a3a',
        skin: '#f6c9a6',
        hat: '#f0dcb4',
        lilac: '#c8b6f2',
        pink: '#f4a8c0',
        panel: '#ffffff',
        panelText: '#1f1e44',
        tint1: '#b0aef4',
        tint2: '#f6c85f',
      },
      footer: {
        line: { vi: 'Trung thu vui vẻ', en: 'Happy Mid-Autumn' },
        sub: { vi: 'Mùa trăng đoàn viên', en: 'A reunion under the moon' },
      },
    },
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
    ornament: {
      id: 'star-fireworks',
      particle: 'none',
      light: ['#ffd23f', '#fff4f4', '#ffc7cb'],
    },
    suggestedWindow: { start: { month: 4, day: 28 }, end: { month: 5, day: 2 } },
    art: {
      ...FLAG_DAY_ART_COLORS,
      footer: {
        line: { vi: 'Mừng lễ 30/4 và 1/5', en: 'Happy 30/4 and 1/5' },
        sub: { vi: 'Thư thái cùng Lucy Spa', en: 'Relax with Lucy Spa' },
      },
    },
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
    ornament: {
      id: 'star-lotus',
      particle: 'none',
      light: ['#ffd23f', '#fff4f4', '#ffc7cb'],
    },
    suggestedWindow: { start: { month: 8, day: 31 }, end: { month: 9, day: 3 } },
    art: {
      ...FLAG_DAY_ART_COLORS,
      footer: {
        line: { vi: 'Mừng ngày 2/9', en: 'Happy National Day' },
        sub: { vi: 'Bình an cùng Lucy Spa', en: 'Peace with Lucy Spa' },
      },
    },
  },
  {
    key: 'vu-lan',
    name: { vi: 'Vu Lan', en: 'Vu Lan Festival' },
    greeting: {
      vi: 'Vu Lan báo hiếu: Lucy Spa kính chúc quý khách và gia đình bình an.',
      en: 'Wishing you and your family peace this Vu Lan season, from Lucy Spa.',
    },
    light: {
      accent: '#2f6b63',
      accentSoft: '#e3f1ee',
      onAccent: '#ffffff',
      frameFrom: '#367a6f',
      frameTo: '#24574f',
      frameText: '#ffffff',
    },
    ornament: {
      id: 'lotus-lantern',
      particle: 'lantern',
      light: ['#bfe8df', '#e6f6f2', '#ffc9c0'],
    },
    // A lunar holiday (the 15th of the 7th lunar month): the Owner types the days.
    suggestedWindow: null,
    particlesDefault: false,
    art: {
      light: {
        lotus: '#f2a0c0',
        lotus2: '#fbd6e4',
        lotus3: '#d4608f',
        leaf: '#4f8a78',
        leaf2: '#2f6b5f',
        water: '#bfe6e0',
        water2: '#8fcfc6',
        water3: '#e3f5f2',
        glow: '#ffb38a',
        glow2: '#ffd9c2',
        rose: '#d6334f',
        rose2: '#ef6b82',
        rose3: '#a31d3a',
        shirt: '#ffffff',
        shirt2: '#b8c8cc',
        white: '#ffffff',
        cream: '#eef8f6',
        cream2: '#d3ece8',
        panel: '#ffffff',
        panelText: '#12332e',
        tint1: '#8fd3c6',
        tint2: '#f2a0c0',
      },
      footer: {
        line: { vi: 'Vu Lan an lành', en: 'A peaceful Vu Lan' },
        sub: {
          vi: 'Tri ân cha mẹ cùng Lucy Spa',
          en: 'Gratitude to our parents, with Lucy Spa',
        },
      },
    },
  },
  {
    key: 'celebration',
    name: { vi: 'Sự kiện, chúc mừng', en: 'Celebration' },
    greeting: {
      vi: 'Chúc mừng! Lucy Spa vui cùng quý khách trong ngày đặc biệt này.',
      en: 'Celebrate with us! Lucy Spa is happy to share this special day with you.',
    },
    light: {
      accent: '#6a3fa8',
      accentSoft: '#f0e8fa',
      onAccent: '#ffffff',
      frameFrom: '#7c4cc0',
      frameTo: '#5a2f96',
      frameText: '#ffffff',
    },
    ornament: {
      id: 'balloons-confetti',
      particle: 'confetti',
      light: ['#ffb3d1', '#b8f0e6', '#d9c7ff'],
    },
    // A custom event has no calendar date: the Owner types the name and the days.
    suggestedWindow: null,
    customEvent: true,
    art: {
      light: {
        pink: '#ec5f94',
        pink2: '#f8a3c3',
        violet: '#8a5cd6',
        violet2: '#c3a9f2',
        teal: '#1fa39a',
        teal2: '#7fd8cd',
        sky: '#4b9fe0',
        coral: '#f2705a',
        mint: '#9fe0c0',
        cream: '#fff4f0',
        cream2: '#f6d9e2',
        string: '#8d7f99',
        white: '#ffffff',
        ink: '#3a2b4a',
        panel: '#ffffff',
        panelText: '#2d1f40',
        tint1: '#c9a8f2',
        tint2: '#f4a1c4',
      },
      footer: {
        line: { vi: 'Chúc mừng', en: 'Congratulations' },
        sub: { vi: 'Một ngày đáng nhớ cùng Lucy Spa', en: 'A day to remember at Lucy Spa' },
      },
    },
  },
];

export function getSeasonPreset(key: SeasonPresetKey): SeasonPreset {
  const preset = SEASON_PRESETS.find((candidate) => candidate.key === key);
  if (!preset) throw new Error(`Unknown season preset: ${key}`);
  return preset;
}
