import {
  getSeasonPreset,
  isSeasonPresetKey,
  lunarYearForSeasonEnd,
  type PublicSeasonResponse,
} from '@lucy-spa/contracts';
import { isSeasonArtKit, type ParticleDensity, type SeasonArtKit } from '@lucy-spa/ui';
import type { Locale } from '../i18n/locales';

/**
 * Seasonal themes on the web (docs/UXUI_REDESIGN_DESIGN.md 20.2, 20.5, 20.9): what the app does with the public
 * season answer. Pure functions, no network: the server read is in `season-server.ts`. Every function fails closed,
 * so anything unexpected means "no season" and the app looks exactly as it does without the feature.
 */

/** The public season request: anonymous, no cookie, cached for a minute by the API. */
export const publicSeasonUrl = (locale: Locale) => `/api/v1/public/website/season?locale=${locale}`;

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value !== '' && [...value].length <= max ? value : null;

/**
 * The API's body, checked: a preset the registry knows, a greeting of at most 80 characters, a real date and
 * three real booleans; otherwise null. Nothing from the body is ever rendered as markup.
 */
export function parsePublicSeason(value: unknown): PublicSeasonResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const presetKey = body['presetKey'];
  const greeting = text(body['greeting'], 80);
  const endsAt = body['endsAt'];
  if (!isSeasonPresetKey(presetKey) || greeting === null) return null;
  if (typeof endsAt !== 'string' || Number.isNaN(Date.parse(endsAt))) return null;
  const { particles, customer, admin } = body;
  if (
    typeof particles !== 'boolean' ||
    typeof customer !== 'boolean' ||
    typeof admin !== 'boolean'
  ) {
    return null;
  }
  if (!customer && !admin) return null;
  return { presetKey, greeting, endsAt, particles, customer, admin };
}

// ------------------------------------------------------------------ admin hide

/** Per-device "hide the season touch in admin" (Q-S4): a plain cookie, readable by the server layout. */
export const ADMIN_HIDE_COOKIE = 'ls-season-admin';

export const parseAdminHidden = (cookieHeader: string | undefined | null): boolean =>
  (cookieHeader ?? '').split(';').some((part) => part.trim() === `${ADMIN_HIDE_COOKIE}=off`);

export const serializeAdminHidden = (hidden: boolean): string =>
  hidden
    ? `${ADMIN_HIDE_COOKIE}=off; Path=/; Max-Age=31536000; SameSite=Lax`
    : `${ADMIN_HIDE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;

// ------------------------------------------------------------------ document root

/**
 * The attributes of `<html>`: the preset (so tokens exist on first paint) and, when the admin touch is off for the
 * schedule or on this device, `data-season-admin="off"` (which turns the topbar line transparent, season.css).
 */
export function seasonRootAttributes(
  season: PublicSeasonResponse | null,
  adminHidden: boolean,
): { 'data-season'?: string; 'data-season-admin'?: 'off' } {
  if (season === null) return {};
  return {
    'data-season': season.presetKey,
    ...(!season.admin || adminHidden ? { 'data-season-admin': 'off' as const } : {}),
  };
}

// ------------------------------------------------------------------ customer band

export interface SeasonBandSpec {
  presetKey: string;
  ornamentId: ReturnType<typeof getSeasonPreset>['ornament']['id'];
  greeting: string;
  /** The particle kind to drift in the band, or `none`. */
  particle: ReturnType<typeof getSeasonPreset>['ornament']['particle'];
}

/**
 * What the S5 customer band draws, or null when the season is not for the customer side. A preset with site-wide art
 * (S6, `siteDecorSpec`) draws that instead of the band, so it never shows both.
 */
export function seasonBandSpec(season: PublicSeasonResponse | null): SeasonBandSpec | null {
  if (season === null || !season.customer || !isSeasonPresetKey(season.presetKey)) return null;
  if (isSeasonArtKit(season.presetKey)) return null;
  const { ornament } = getSeasonPreset(season.presetKey);
  return {
    presetKey: season.presetKey,
    ornamentId: ornament.id,
    greeting: season.greeting,
    particle: season.particles ? ornament.particle : 'none',
  };
}

// ------------------------------------------------------------------ site-wide decoration (S6)

export interface SiteDecorSpec {
  kit: SeasonArtKit;
  greeting: string;
  /** Whether particles drift (the schedule allows them and the kit has any). */
  particles: boolean;
  density: ParticleDensity;
  /** The footer scene's greeting line and optional second line. */
  footer: { line: string; sub?: string };
  /** The Tet year's zodiac animal key, or null; art is drawn only when it exists for that animal. */
  zodiac: string | null;
  /** The computed can-chi name and year ("Đinh Mùi 2027") for the Tet kit, or null. */
  lunar: { canChi: string; year: number; animal: { vi: string; en: string } } | null;
}

/**
 * What the site-wide decoration draws (docs/UXUI_REDESIGN_S6_PLAN.md), or null when the season is not for the
 * customer side or its preset has no site art yet (then the S5 band applies). The Tet footer's second line and its
 * zodiac animal are computed from the season's end date, never typed (Owner decision 4).
 */
export function siteDecorSpec(
  season: PublicSeasonResponse | null,
  locale: Locale,
): SiteDecorSpec | null {
  if (season === null || !season.customer || !isSeasonPresetKey(season.presetKey)) return null;
  const preset = getSeasonPreset(season.presetKey);
  if (!preset.art || !isSeasonArtKit(preset.key)) return null;
  const lunar = preset.key === 'tet' ? lunarYearForSeasonEnd(season.endsAt) : null;
  const sub = lunar
    ? locale === 'vi'
      ? `Xuân ${lunar.canChi} ${lunar.year}`
      : `${lunar.canChi} ${lunar.year}, Year of the ${lunar.animalName.en}`
    : preset.art.footer.sub?.[locale];
  return {
    kit: preset.key,
    greeting: season.greeting,
    particles: season.particles && preset.ornament.particle !== 'none',
    density: 'medium',
    footer: { line: preset.art.footer.line[locale], ...(sub ? { sub } : {}) },
    zodiac: lunar ? lunar.animal : null,
    lunar: lunar ? { canChi: lunar.canChi, year: lunar.year, animal: lunar.animalName } : null,
  };
}
