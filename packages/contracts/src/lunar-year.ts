/**
 * The lunar year of a Tet season: its can-chi name and zodiac animal (Owner decision 4 of Step S6, 2026-10-02).
 * Computed, never typed. The cycle is the **Vietnamese** one (Suu is the buffalo, Mao is the cat), so it differs from
 * the Chinese cycle in two places. Pure and shared by web and the future mobile app.
 *
 * A Tet season is entered with its window; the lunar year is the Gregorian year of the window's **last day**
 * (Vietnam time): Tet falls between 21 January and 20 February, so the last day is always in the year Tet is named
 * after, even when the window starts in the previous December.
 */

/** The ten heavenly stems (can), from Giap. */
export const LUNAR_CAN = [
  'Giáp',
  'Ất',
  'Bính',
  'Đinh',
  'Mậu',
  'Kỷ',
  'Canh',
  'Tân',
  'Nhâm',
  'Quý',
] as const;

/** The twelve earthly branches (chi), from Ty. */
export const LUNAR_CHI = [
  'Tý',
  'Sửu',
  'Dần',
  'Mão',
  'Thìn',
  'Tỵ',
  'Ngọ',
  'Mùi',
  'Thân',
  'Dậu',
  'Tuất',
  'Hợi',
] as const;

/** One key per branch, in cycle order; art is looked up by this key. */
export const ZODIAC_KEYS = [
  'ty',
  'suu',
  'dan',
  'mao',
  'thin',
  'ti',
  'ngo',
  'mui',
  'than',
  'dau',
  'tuat',
  'hoi',
] as const;
export type ZodiacKey = (typeof ZODIAC_KEYS)[number];

/** The Vietnamese twelve animals, with English names. */
export const ZODIAC_ANIMALS: Record<ZodiacKey, { vi: string; en: string }> = {
  ty: { vi: 'chuột', en: 'Rat' },
  suu: { vi: 'trâu', en: 'Buffalo' },
  dan: { vi: 'hổ', en: 'Tiger' },
  mao: { vi: 'mèo', en: 'Cat' },
  thin: { vi: 'rồng', en: 'Dragon' },
  ti: { vi: 'rắn', en: 'Snake' },
  ngo: { vi: 'ngựa', en: 'Horse' },
  mui: { vi: 'dê', en: 'Goat' },
  than: { vi: 'khỉ', en: 'Monkey' },
  dau: { vi: 'gà', en: 'Rooster' },
  tuat: { vi: 'chó', en: 'Dog' },
  hoi: { vi: 'lợn', en: 'Pig' },
};

export interface LunarYear {
  /** The Gregorian year Tet falls in. */
  year: number;
  can: string;
  chi: string;
  /** For example "Đinh Mùi". */
  canChi: string;
  animal: ZodiacKey;
  animalName: { vi: string; en: string };
}

const mod = (value: number, size: number): number => ((value % size) + size) % size;

/** The lunar year named after a Gregorian year (4 CE was Giap Ty). */
export function lunarYear(year: number): LunarYear {
  const can = LUNAR_CAN[mod(year + 6, 10)]!;
  const chiIndex = mod(year + 8, 12);
  const chi = LUNAR_CHI[chiIndex]!;
  const animal = ZODIAC_KEYS[chiIndex]!;
  return { year, can, chi, canChi: `${can} ${chi}`, animal, animalName: ZODIAC_ANIMALS[animal] };
}

/** Vietnam is UTC+7 all year (no daylight saving). */
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * The lunar year of a Tet season from its exclusive end (`endsAt`, ISO): the Gregorian year of the last day inclusive,
 * in Vietnam time. Null for an unreadable date.
 */
export function lunarYearForSeasonEnd(endsAt: string): LunarYear | null {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return null;
  return lunarYear(new Date(end - 1 + VIETNAM_OFFSET_MS).getUTCFullYear());
}
