import {
  ALL_SEASON_SLOTS_ON,
  DEFAULT_SEASON_DENSITY,
  getSeasonPreset,
  isSeasonPresetKey,
  lunarYearForSeasonEnd,
  SEASON_GREETING_MAX_LENGTH,
  type SeasonDensity,
  type SeasonPreset,
  type SeasonSlot,
  type WebsiteSeasonInput,
  type WebsiteSeasonResponse,
  type WebsiteSeasonStatus,
} from '@lucy-spa/contracts';
import { hasZodiacArt } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { ApiError } from '../api/client';
import type { SeasonPreviewDraft } from '../season-preview';
import { isoToVnLocal, vnLocalToIso } from './discounts';

/**
 * Seasonal themes, admin side (docs/UXUI_REDESIGN_DESIGN.md 20.4, 20.7). The server is authoritative for every
 * rule; these helpers only save a round trip and shape the form. Dates are typed in Vietnam time (Q-CM6) as whole
 * days: the Owner enters the first and the LAST day (inclusive) and the request sends the start of the first day
 * and the start of the day after the last one (the exclusive end the API stores).
 */

export const SEASON_PAGE_SIZE = 20;
export const SEASON_LABEL_MAX = 80;

export type SeasonTone = 'neutral' | 'info' | 'success' | 'warning';

export const seasonTone = (status: WebsiteSeasonStatus): SeasonTone =>
  status === 'ACTIVE'
    ? 'success'
    : status === 'SCHEDULED'
      ? 'info'
      : status === 'ENDED'
        ? 'neutral'
        : 'warning';

export const SEASON_STATUSES: readonly WebsiteSeasonStatus[] = [
  'ACTIVE',
  'SCHEDULED',
  'ENDED',
  'DRAFT',
];

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, '0');
const dayText = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;

/** The calendar day after `YYYY-MM-DD` (null when malformed). */
export function nextDay(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])] as [
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, date));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== date
  ) {
    return null;
  }
  return new Date(probe.getTime() + DAY_MS).toISOString().slice(0, 10);
}

/** Today in Vietnam, as `YYYY-MM-DD`. */
export const vnToday = (now: Date = new Date()): string =>
  isoToVnLocal(now.toISOString()).slice(0, 10);

/**
 * The registry's suggested window for a solar holiday, for the first occurrence whose last day is not already
 * past (Q-S3: prefilled, editable, saved only when the Owner saves). Lunar holidays have none.
 */
export function suggestedDates(
  preset: SeasonPreset,
  now: Date = new Date(),
): { startDate: string; lastDate: string } | null {
  const window = preset.suggestedWindow;
  if (window === null) return null;
  const today = vnToday(now);
  const thisYear = Number(today.slice(0, 4));
  for (const year of [thisYear, thisYear + 1]) {
    const startDate = dayText(year, window.start.month, window.start.day);
    const endYear =
      window.end.month < window.start.month ||
      (window.end.month === window.start.month && window.end.day < window.start.day)
        ? year + 1
        : year;
    const lastDate = dayText(endYear, window.end.month, window.end.day);
    if (lastDate >= today) return { startDate, lastDate };
  }
  return null;
}

// ------------------------------------------------------------------ form

export interface SeasonForm {
  presetKey: string;
  label: string;
  /** `YYYY-MM-DD` in Vietnam time. */
  startDate: string;
  /** The last day, inclusive. */
  lastDate: string;
  greetingVi: string;
  greetingEn: string;
  applyCustomer: boolean;
  applyAdmin: boolean;
  /** Slot 1 (particles). */
  particlesEnabled: boolean;
  /** Slots 2 to 7 (S6b). */
  slotHeader: boolean;
  slotLogo: boolean;
  slotCorners: boolean;
  slotDividers: boolean;
  slotFooter: boolean;
  slotTint: boolean;
  /** Greeting in the strip under the header and in the footer scene. */
  greetingStrip: boolean;
  greetingFooter: boolean;
  particleDensity: SeasonDensity;
  /** Media-library image per slot: slot name -> media asset id. */
  slotMedia: Partial<Record<SeasonSlot, string>>;
  isEnabled: boolean;
}

/** The preset a new season starts on, with its suggested days when it has them. */
export function emptySeasonForm(presetKey: string = 'tet', now: Date = new Date()): SeasonForm {
  const preset = isSeasonPresetKey(presetKey) ? getSeasonPreset(presetKey) : null;
  const dates = preset ? suggestedDates(preset, now) : null;
  const today = vnToday(now);
  return {
    presetKey,
    label: '',
    startDate: dates?.startDate ?? today,
    lastDate: dates?.lastDate ?? today,
    greetingVi: '',
    greetingEn: '',
    applyCustomer: true,
    applyAdmin: true,
    particlesEnabled: true,
    slotHeader: ALL_SEASON_SLOTS_ON.header,
    slotLogo: ALL_SEASON_SLOTS_ON.logo,
    slotCorners: ALL_SEASON_SLOTS_ON.corners,
    slotDividers: ALL_SEASON_SLOTS_ON.dividers,
    slotFooter: ALL_SEASON_SLOTS_ON.footer,
    slotTint: ALL_SEASON_SLOTS_ON.tint,
    greetingStrip: true,
    greetingFooter: true,
    particleDensity: DEFAULT_SEASON_DENSITY,
    slotMedia: {},
    isEnabled: false,
  };
}

export function formOfSeason(season: WebsiteSeasonResponse): SeasonForm {
  return {
    presetKey: season.presetKey,
    label: season.label,
    startDate: isoToVnLocal(season.startsAt).slice(0, 10),
    // The end is exclusive: the last day is the one that contains the instant just before it.
    lastDate: isoToVnLocal(new Date(Date.parse(season.endsAt) - 1).toISOString()).slice(0, 10),
    greetingVi: season.greetingVi ?? '',
    greetingEn: season.greetingEn ?? '',
    applyCustomer: season.applyCustomer,
    applyAdmin: season.applyAdmin,
    particlesEnabled: season.particlesEnabled,
    slotHeader: season.slotHeader,
    slotLogo: season.slotLogo,
    slotCorners: season.slotCorners,
    slotDividers: season.slotDividers,
    slotFooter: season.slotFooter,
    slotTint: season.slotTint,
    greetingStrip: season.greetingStrip,
    greetingFooter: season.greetingFooter,
    particleDensity: season.particleDensity,
    slotMedia: { ...season.slotMedia },
    isEnabled: season.isEnabled,
  };
}

const text = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export type SeasonProblem =
  'presetKey' | 'label' | 'greetingVi' | 'greetingEn' | 'startDate' | 'lastDate' | 'window';

/** The form field a problem belongs to (the first invalid control to focus). */
export const problemField = (problem: SeasonProblem): keyof SeasonForm =>
  problem === 'window' ? 'lastDate' : problem;

const length = (value: string) => [...value.trim()].length;

/** The request for the API, or the first problem found (so the form can say what to fix). */
export function seasonInputOf(
  form: SeasonForm,
): { body: WebsiteSeasonInput } | { problem: SeasonProblem } {
  if (!isSeasonPresetKey(form.presetKey)) return { problem: 'presetKey' };
  if (text(form.label) === null || length(form.label) > SEASON_LABEL_MAX) {
    return { problem: 'label' };
  }
  if (length(form.greetingVi) > SEASON_GREETING_MAX_LENGTH) return { problem: 'greetingVi' };
  if (length(form.greetingEn) > SEASON_GREETING_MAX_LENGTH) return { problem: 'greetingEn' };
  const startsAt = vnLocalToIso(`${form.startDate}T00:00`);
  if (startsAt === null) return { problem: 'startDate' };
  const after = nextDay(form.lastDate);
  const endsAt = after === null ? null : vnLocalToIso(`${after}T00:00`);
  if (endsAt === null) return { problem: 'lastDate' };
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return { problem: 'window' };
  return {
    body: {
      presetKey: form.presetKey,
      label: form.label.trim().replace(/\s+/g, ' '),
      startsAt,
      endsAt,
      greetingVi: text(form.greetingVi),
      greetingEn: text(form.greetingEn),
      applyCustomer: form.applyCustomer,
      applyAdmin: form.applyAdmin,
      particlesEnabled: form.particlesEnabled,
      slotHeader: form.slotHeader,
      slotLogo: form.slotLogo,
      slotCorners: form.slotCorners,
      slotDividers: form.slotDividers,
      slotFooter: form.slotFooter,
      slotTint: form.slotTint,
      greetingStrip: form.greetingStrip,
      greetingFooter: form.greetingFooter,
      particleDensity: form.particleDensity,
      slotMedia: form.slotMedia,
      isEnabled: form.isEnabled,
    },
  };
}

export const seasonFormChanged = (a: SeasonForm, b: SeasonForm): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);

// ------------------------------------------------------------------ names and lists

/** A `YYYY-MM-DD` day as the reader writes it: dd/mm/yyyy in Vietnamese, the ISO form in English. */
export function formatDay(day: string, locale: Locale): string {
  const [y = '', m = '', d = ''] = day.split('-');
  return locale === 'vi' ? `${d}/${m}/${y}` : day;
}

/** "First day - last day", the last day inclusive, in Vietnam time. */
export function seasonWindowText(
  season: Pick<WebsiteSeasonResponse, 'startsAt' | 'endsAt'>,
  locale: Locale,
): string {
  const lastDay = isoToVnLocal(new Date(Date.parse(season.endsAt) - 1).toISOString()).slice(0, 10);
  const firstDay = isoToVnLocal(season.startsAt).slice(0, 10);
  return `${formatDay(firstDay, locale)} – ${formatDay(lastDay, locale)}`;
}

/** A preset's name in the visitor's language; an unknown key (a preset removed from the registry) shows as is. */
export function presetName(presetKey: string, locale: Locale): string {
  return isSeasonPresetKey(presetKey) ? getSeasonPreset(presetKey).name[locale] : presetKey;
}

/** The greeting the season shows in one language: the Owner's text, else the preset default. */
export function previewGreeting(form: SeasonForm, locale: Locale): string {
  const own = text(locale === 'vi' ? form.greetingVi : form.greetingEn);
  if (own !== null) return own;
  return isSeasonPresetKey(form.presetKey) ? getSeasonPreset(form.presetKey).greeting[locale] : '';
}

/**
 * What the full-page preview draws for the form as it stands, saved or not (S6b). The exclusive end comes from the
 * last day (so the Tet year name follows it); an unreadable day falls back to the day after today, which only
 * affects the computed Tet year name, never anything saved.
 */
export function draftOfForm(
  form: SeasonForm,
  locale: Locale,
  now: Date = new Date(),
): SeasonPreviewDraft {
  const after = nextDay(form.lastDate);
  const endsAt = (after === null ? null : vnLocalToIso(`${after}T00:00`)) ?? nextDayIso(now);
  return {
    presetKey: form.presetKey,
    greeting: previewGreeting(form, locale),
    endsAt,
    customer: form.applyCustomer,
    particles: form.particlesEnabled,
    slots: {
      particles: form.particlesEnabled,
      header: form.slotHeader,
      logo: form.slotLogo,
      corners: form.slotCorners,
      dividers: form.slotDividers,
      footer: form.slotFooter,
      tint: form.slotTint,
    },
    density: form.particleDensity,
    greetingStrip: form.greetingStrip,
    greetingFooter: form.greetingFooter,
    mediaIds: form.slotMedia,
  };
}

const nextDayIso = (now: Date): string => new Date(now.getTime() + DAY_MS).toISOString();

/**
 * The year name the Tet kit computes from the last day (never typed, Owner decision 4): the Vietnamese can-chi name
 * and Gregorian year, the animal, and whether the kit has art for that animal. Null for any other kit.
 */
export function computedYearName(
  form: Pick<SeasonForm, 'presetKey' | 'lastDate'>,
  locale: Locale,
): { name: string; animal: string; animalKey: string; hasArt: boolean } | null {
  if (form.presetKey !== 'tet') return null;
  const after = nextDay(form.lastDate);
  const endsAt = after === null ? null : vnLocalToIso(`${after}T00:00`);
  const year = endsAt === null ? null : lunarYearForSeasonEnd(endsAt);
  if (year === null) return null;
  return {
    name: `${year.canChi} ${year.year}`,
    animal: year.animalName[locale],
    animalKey: year.animal,
    hasArt: hasZodiacArt(year.animal),
  };
}

/** The year a season belongs to in the year filter: the year of its first day in Vietnam. */
export const seasonYear = (season: Pick<WebsiteSeasonResponse, 'startsAt'>): number =>
  Number(isoToVnLocal(season.startsAt).slice(0, 4));

export function filterSeasons(
  items: readonly WebsiteSeasonResponse[],
  filters: { status: string; year: string },
): WebsiteSeasonResponse[] {
  return items.filter(
    (season) =>
      (filters.status === '' || season.status === filters.status) &&
      (filters.year === '' || String(seasonYear(season)) === filters.year),
  );
}

/** The years that have at least one season, newest first. */
export const seasonYears = (items: readonly WebsiteSeasonResponse[]): number[] =>
  [...new Set(items.map(seasonYear))].sort((a, b) => b - a);

// ------------------------------------------------------------------ errors

/** The other season an overlap refusal names (the API sends its id as the field). */
export const seasonOverlapId = (error: unknown): string | null =>
  error instanceof ApiError && error.code === 'SEASON_OVERLAP' ? error.field : null;
